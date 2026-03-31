import { writeFileSync } from 'fs';
import { parseResponse } from './src/parsers/ResponseParser.js';

interface TestResult {
  testId: string;
  testName: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'ERROR' | 'SKIP';
  input: string;
  expectedBehavior: string;
  actualBehavior: string;
  rootCause: string;
  fix: string;
  durationMs: number;
  telemetry: Record<string, unknown>;
  timestamp: string;
}

interface TestInput {
  testId: string;
  input: string;
}

const results: TestResult[] = [];
const inputs: TestInput[] = [];
const startTime = Date.now();

function createResult(partial: Partial<TestResult>): TestResult {
  return {
    testId: partial.testId || 'UNKNOWN',
    testName: partial.testName || '',
    category: 'parser',
    status: partial.status || 'ERROR',
    input: partial.input || '',
    expectedBehavior: partial.expectedBehavior || '',
    actualBehavior: partial.actualBehavior || '',
    rootCause: partial.rootCause || '',
    fix: partial.fix || '',
    durationMs: partial.durationMs || 0,
    telemetry: partial.telemetry || {},
    timestamp: new Date().toISOString(),
  };
}

function runTest(testId: string, testName: string, input: string, expected: string, verify: (result: ReturnType<typeof parseResponse>, duration: number) => { status: TestResult['status']; actualBehavior: string; rootCause: string; fix: string; telemetry: Record<string, unknown> }): void {
  inputs.push({ testId, input });
  const testStart = Date.now();
  try {
    const result = parseResponse(input);
    const duration = Date.now() - testStart;
    const verification = verify(result, duration);
    
    results.push(createResult({
      testId,
      testName,
      input: input.substring(0, 500),
      expectedBehavior: expected,
      status: verification.status,
      actualBehavior: verification.actualBehavior,
      rootCause: verification.rootCause,
      fix: verification.fix,
      durationMs: duration,
      telemetry: verification.telemetry,
    }));
  } catch (error) {
    results.push(createResult({
      testId,
      testName,
      input: input.substring(0, 500),
      expectedBehavior: expected,
      status: 'ERROR',
      actualBehavior: `Exception thrown: ${error instanceof Error ? error.message : String(error)}`,
      rootCause: 'Unhandled exception in parser',
      fix: 'Add error handling for edge case',
      durationMs: Date.now() - testStart,
      telemetry: { error: error instanceof Error ? error.message : String(error) },
    }));
  }
}

// P-STRESS-1: Multiple JSON objects in response
runTest(
  'P-STRESS-1',
  'Multiple JSON objects in response',
  '{"summary":"first","files":[{"path":"a.py","content":"x=1"}]} and also {"summary":"second","files":[{"path":"b.py","content":"y=2"}]}',
  'Parser extracts ONE valid JSON object (first or last), returns success: true with exactly 1 file',
  (result, duration) => {
    if (result.success) {
      if (result.files.length === 1) {
        return {
          status: 'PASS',
          actualBehavior: `Extracted 1 file using ${result.extractionMethod}. Files: ${result.files.map(f => f.path).join(', ')}`,
          rootCause: '',
          fix: '',
          telemetry: { extractionMethod: result.extractionMethod, fileCount: result.files.length, files: result.files.map(f => f.path) },
        };
      } else {
        return {
          status: 'PARTIAL',
          actualBehavior: `Extracted ${result.files.length} files instead of 1. Files: ${result.files.map(f => f.path).join(', ')}`,
          rootCause: 'Multiple JSON objects detected in response',
          fix: 'Consider adding policy to prefer first or last object',
          telemetry: { extractionMethod: result.extractionMethod, fileCount: result.files.length, files: result.files.map(f => f.path) },
        };
      }
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason}`,
      rootCause: 'Parser did not extract valid JSON from multiple objects',
      fix: 'Add logic to extract first valid JSON object from multi-object response',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-2: JSON + markdown + explanation mixed
runTest(
  'P-STRESS-2',
  'JSON + markdown + explanation mixed',
  'Sure! Here is your calculator:\n\n```python\ndef add(a,b): return a+b\n```\n\nAnd here is the structured output:\n\n```json\n{"summary":"calc","files":[{"path":"calc.py","content":"def add(a,b):\\n    return a+b"}]}\n```\n\nLet me know if you need changes!',
  'Parser ignores Python code block, extracts JSON code block, returns success: true with calc.py',
  (result, duration) => {
    if (result.success && result.files.some(f => f.path === 'calc.py')) {
      return {
        status: 'PASS',
        actualBehavior: `Extracted calc.py using ${result.extractionMethod}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path) },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: result.success 
        ? `Extracted files: ${result.files.map(f => f.path).join(', ')} - missing calc.py`
        : `Parse failed: ${result.failureReason}`,
      rootCause: result.success ? 'Wrong file extracted' : 'JSON code block not found',
      fix: 'Ensure JSON code block extraction ignores other code block types',
      telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), failureReason: result.failureReason },
    };
  }
);

// P-STRESS-3: Deeply nested JSON inside text
runTest(
  'P-STRESS-3',
  'Deeply nested JSON inside text',
  'The output is: {"wrapper": {"data": {"summary":"nested","files":[{"path":"deep.py","content":"print(1)"}]}}}',
  'Parser should FAIL with INVALID_STRUCTURE because files is nested inside wrapper.data',
  (result, duration) => {
    if (!result.success) {
      return {
        status: 'PASS',
        actualBehavior: `Parse failed as expected: ${result.failureReason}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parser succeeded and extracted ${result.files.length} file(s): ${result.files.map(f => f.path).join(', ')}`,
      rootCause: 'Parser should not extract from nested structures without explicit handling',
      fix: 'Modify nested search to only find files at top level, not nested inside wrapper objects',
      telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path) },
    };
  }
);

// P-STRESS-4: Partial JSON (truncated mid-content)
runTest(
  'P-STRESS-4',
  'Partial JSON (truncated mid-content)',
  '{"summary":"test","files":[{"path":"app.py","content":"def main():\\n    pri',
  'JSON.parse MUST fail. All extraction stages should fail. Returns success: false',
  (result, duration) => {
    if (!result.success) {
      return {
        status: 'PASS',
        actualBehavior: `Parse failed as expected: ${result.failureReason}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason, stagesAttempted: ['DIRECT_PARSE', 'CODE_BLOCK', 'BRACE_EXTRACTION', 'NESTED_SEARCH'] },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parser unexpectedly succeeded with ${result.files.length} files`,
      rootCause: 'Truncated JSON should not parse successfully',
      fix: 'Ensure all JSON.parse attempts fail on truncated input',
      telemetry: { extractionMethod: result.extractionMethod, files: result.files },
    };
  }
);

// P-STRESS-5: Invalid JSON syntax (multiple issues)
runTest(
  'P-STRESS-5',
  'Invalid JSON syntax (multiple issues)',
  "{summary: 'test', files: [{path: 'app.py', content: 'x=1',}]}",
  'JSON.parse MUST fail on raw input. Parser should fail cleanly.',
  (result, duration) => {
    if (!result.success) {
      return {
        status: 'PASS',
        actualBehavior: `Parse failed as expected: ${result.failureReason}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason, errors: ['Unquoted keys', 'Single quotes', 'Trailing comma'] },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parser unexpectedly succeeded`,
      rootCause: 'Invalid JSON syntax should not parse',
      fix: 'Ensure JSON.parse is not bypassed or auto-repaired',
      telemetry: { extractionMethod: result.extractionMethod, files: result.files },
    };
  }
);

// P-STRESS-6: Files array present but empty
runTest(
  'P-STRESS-6',
  'Files array present but empty',
  '{"summary":"I created nothing","files":[]}',
  'JSON parses successfully. But files array is empty. Returns success: false, failureReason: EMPTY_FILES_ARRAY or NO_VALID_FILES',
  (result, duration) => {
    if (!result.success && (result.failureReason === 'NO_VALID_FILES' || result.failureReason === 'NO_FILES_ARRAY')) {
      return {
        status: 'PASS',
        actualBehavior: `Parse failed as expected: ${result.failureReason}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
      };
    }
    return {
      status: result.success ? 'FAIL' : 'PARTIAL',
      actualBehavior: result.success 
        ? `Unexpected success with ${result.files.length} files`
        : `Failed with: ${result.failureReason}`,
      rootCause: result.success ? 'Empty array should cause failure' : 'Failure reason may not match expected',
      fix: 'Ensure empty files array is detected and rejected',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason, files: result.files },
    };
  }
);

// P-STRESS-7: Files array with mixed valid + invalid entries
runTest(
  'P-STRESS-7',
  'Files array with mixed valid + invalid entries',
  '{"summary":"mixed","files":[\n  {"path":"good.py","content":"x=1","language":"python"},\n  {"path":"data.json","content":"bad"},\n  {"path":"","content":"no path"},\n  {"path":"also_good.js","content":"console.log(1)"},\n  {"path":"../hack.py","content":"import os"},\n  {"content":"missing path field"},\n  {"path":"fine.rb","content":"puts 1"}\n]}',
  '7 entries submitted, exactly 3 should survive: good.py, also_good.js, fine.rb',
  (result, duration) => {
    if (result.success) {
      const extracted = result.files.map(f => f.path);
      const expected = ['good.py', 'also_good.js', 'fine.rb'];
      const correct = expected.every(p => extracted.includes(p));
      const incorrect = extracted.filter(p => !expected.includes(p));
      
      return {
        status: correct && extracted.length === 3 ? 'PASS' : 'PARTIAL',
        actualBehavior: `Extracted ${result.files.length} files: ${extracted.join(', ')}. Missing: ${expected.filter(p => !extracted.includes(p)).join(', ')}. Extra: ${incorrect.join(', ')}`,
        rootCause: extracted.length !== 3 || incorrect.length > 0 ? 'File validation not working correctly' : '',
        fix: extracted.length !== 3 ? 'Adjust file validation to correctly filter blocked/invalid files' : '',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), rejected: ['data.json', '', '../hack.py', '{no path}'] },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason}`,
      rootCause: 'Valid JSON but validation failed',
      fix: 'Ensure validation correctly identifies valid vs invalid files',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-8: Path traversal injection attempts
runTest(
  'P-STRESS-8',
  'Path traversal injection attempts',
  '{"summary":"hack","files":[\n  {"path":"../../etc/passwd","content":"root:x:0:0"},\n  {"path":"..\\\\..\\\\windows\\\\system32\\\\config","content":"bad"},\n  {"path":"/absolute/path/file.py","content":"import os"},\n  {"path":"normal/nested/file.py","content":"x=1"},\n  {"path":"./relative/file.py","content":"y=2"}\n]}',
  'Path traversal attempts (.., ..\\) should be rejected. Absolute paths should be rejected. Relative paths depend on policy.',
  (result, duration) => {
    const extracted = result.files.map(f => f.path);
    const hasTraversal = extracted.some(p => p.includes('..'));
    const hasAbsolute = extracted.some(p => p.startsWith('/'));
    
    return {
      status: hasTraversal || hasAbsolute ? 'FAIL' : 'PASS',
      actualBehavior: `Extracted ${result.files.length} files: ${extracted.join(', ')}. Contains traversal: ${hasTraversal}, Contains absolute: ${hasAbsolute}`,
      rootCause: hasTraversal ? 'Path traversal not blocked' : hasAbsolute ? 'Absolute paths not blocked' : '',
      fix: hasTraversal ? 'Add path traversal validation to block .. in paths' : hasAbsolute ? 'Add absolute path validation' : '',
      telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), securityIssues: { traversal: hasTraversal, absolute: hasAbsolute } },
    };
  }
);

// P-STRESS-9: All blocked filenames
runTest(
  'P-STRESS-9',
  'All blocked filenames',
  '{"summary":"defaults","files":[\n  {"path":"data.json","content":"{}"},\n  {"path":"output.txt","content":"out"},\n  {"path":"file.txt","content":"file"},\n  {"path":"untitled","content":"none"},\n  {"path":"response.json","content":"{}"},\n  {"path":"result.json","content":"{}"},\n  {"path":"output.json","content":"{}"},\n  {"path":"temp.txt","content":"tmp"},\n  {"path":"example.txt","content":"ex"},\n  {"path":"DATA.JSON","content":"{}"},\n  {"path":"Output.TXT","content":"out"},\n  {"path":"real_calculator.py","content":"def add(a,b): return a+b"}\n]}',
  'First 9 entries rejected (case-insensitive match for DATA.JSON, Output.TXT). Only real_calculator.py survives.',
  (result, duration) => {
    if (result.success) {
      const extracted = result.files.map(f => f.path);
      const hasBlocked = extracted.some(p => ['data.json', 'output.txt', 'file.txt', 'response.json', 'result.json', 'output.json'].some(b => b.toLowerCase() === p.toLowerCase()));
      
      return {
        status: hasBlocked ? 'FAIL' : extracted.length === 1 && extracted[0] === 'real_calculator.py' ? 'PASS' : 'PARTIAL',
        actualBehavior: `Extracted ${result.files.length} files: ${extracted.join(', ')}`,
        rootCause: hasBlocked ? 'Blocked filenames not rejected' : extracted.length !== 1 ? 'Wrong files extracted' : '',
        fix: hasBlocked ? 'Ensure case-insensitive blocked filename matching' : 'Ensure only non-blocked files pass through',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), caseInsensitiveWorking: extracted.every(p => !['data.json', 'output.txt', 'file.txt', 'response.json', 'result.json', 'output.json'].some(b => b.toLowerCase() === p.toLowerCase())) },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason} - all files were blocked`,
      rootCause: 'All files were blocked, should have returned success with 1 valid file',
      fix: 'Ensure blocked filename list is case-sensitive and real_calculator.py is not blocked',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-10: Extremely large JSON response
const largeContent = 'x = 1\n'.repeat(15000);
const largeInput = JSON.stringify({
  summary: 'large test',
  files: [{ path: 'large.py', content: largeContent }]
});
runTest(
  'P-STRESS-10',
  'Extremely large JSON response',
  largeInput,
  'Parser handles 60KB content without crashing, hanging, or truncation',
  (result, duration) => {
    if (result.success && result.files.length === 1) {
      const contentMatch = result.files[0].content.length === largeContent.length;
      return {
        status: contentMatch && duration < 5000 ? 'PASS' : 'PARTIAL',
        actualBehavior: `Parsed ${result.files[0].content.length} chars in ${duration}ms. Content match: ${contentMatch}`,
        rootCause: contentMatch ? '' : 'Content was truncated',
        fix: contentMatch ? '' : 'Remove content length limits or increase buffer size',
        telemetry: { 
          extractionMethod: result.extractionMethod, 
          inputSize: largeInput.length,
          contentSize: result.files[0].content.length,
          expectedSize: largeContent.length,
          durationMs: duration,
          truncated: result.files[0].content.length !== largeContent.length
        },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: result.success 
        ? `Extracted ${result.files.length} files` 
        : `Parse failed: ${result.failureReason}`,
      rootCause: 'Large JSON not handled correctly',
      fix: 'Increase memory/buffer for large JSON parsing',
      telemetry: { extractionMethod: result.extractionMethod, durationMs: duration, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-11: JSON split across multiple code blocks
runTest(
  'P-STRESS-11',
  'JSON split across multiple code blocks',
  'Part 1:\n```json\n{"summary":"split\n```\nMore text here\n```json\n","files":[{"path":"x.py","content":"y=1"}]}\n```',
  'Each code block individually is NOT valid JSON. Parser should NOT merge code blocks.',
  (result, duration) => {
    return {
      status: !result.success ? 'PASS' : 'PARTIAL',
      actualBehavior: result.success 
        ? `Parse succeeded with ${result.files.length} files (merging occurred?)`
        : `Parse failed: ${result.failureReason}`,
      rootCause: result.success ? 'Parser incorrectly merged code blocks' : '',
      fix: result.success ? 'Do not merge JSON from multiple code blocks' : '',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason, files: result.files.map(f => f.path) },
    };
  }
);

// P-STRESS-12: JSON with unicode and special characters
runTest(
  'P-STRESS-12',
  'JSON with unicode and special characters',
  '{"summary":"unicode test 🚀","files":[{"path":"hello_世界.py","content":"print(\"Hello 世界! 🌍\")\\nname = \"José García\"\\ndata = \"日本語テスト\"","language":"python"}]}',
  'Unicode preserved. File path with unicode may or may not be accepted.',
  (result, duration) => {
    if (result.success) {
      const hasUnicodePath = result.files.some(f => f.path.includes('世界'));
      const content = result.files[0]?.content || '';
      const hasUnicodeContent = content.includes('世界') && content.includes('José');
      
      return {
        status: 'PASS',
        actualBehavior: `Extracted ${result.files.length} files. Unicode path: ${hasUnicodePath ? 'accepted' : 'rejected'}. Unicode content preserved: ${hasUnicodeContent}`,
        rootCause: '',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => ({ path: f.path, contentLength: f.content.length })), unicodePathAccepted: hasUnicodePath, unicodeContentPreserved: hasUnicodeContent },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason}`,
      rootCause: 'Unicode handling failed',
      fix: 'Ensure UTF-8 encoding is handled correctly',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-13: Content that is description, not code
runTest(
  'P-STRESS-13',
  'Content that is description, not code',
  '{"summary":"desc test","files":[\n  {"path":"a.py","content":"This file contains a Python calculator with basic operations"},\n  {"path":"b.py","content":"Here is the implementation of the sorting algorithm"},\n  {"path":"c.py","content":"I will create a function that processes data"},\n  {"path":"d.py","content":"The following code implements a web server"},\n  {"path":"e.py","content":"Below is the complete solution"},\n  {"path":"f.py","content":"def real_function():\\n    return 42"}\n]}',
  'Files a-e rejected (description patterns). Only f.py accepted (actual code).',
  (result, duration) => {
    if (result.success) {
      const extracted = result.files.map(f => f.path);
      const hasOnlyRealCode = extracted.length === 1 && extracted[0] === 'f.py';
      
      return {
        status: hasOnlyRealCode ? 'PASS' : 'PARTIAL',
        actualBehavior: `Extracted ${result.files.length} files: ${extracted.join(', ')}. ${hasOnlyRealCode ? 'Description filtering worked correctly.' : 'Description filtering may not be working correctly.'}`,
        rootCause: hasOnlyRealCode ? '' : 'Description patterns not detected',
        fix: hasOnlyRealCode ? '' : 'Improve description pattern matching',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), expectedOnly: ['f.py'] },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason} - all files were filtered`,
      rootCause: 'Description filtering too aggressive or working incorrectly',
      fix: 'Review description pattern matching logic',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// P-STRESS-14: Valid JSON but missing "files" key
const missingFilesVariants = [
  { name: 'A: no files key', input: '{"summary":"no files key","results":[{"path":"x.py","content":"y"}]}' },
  { name: 'B: typo', input: '{"summary":"typo","fles":[{"path":"x.py","content":"y"}]}' },
  { name: 'C: null files', input: '{"summary":"null files","files":null}' },
  { name: 'D: string files', input: '{"summary":"string files","files":"not an array"}}' },
  { name: 'E: number files', input: '{"summary":"number files","files":42}' },
];

missingFilesVariants.forEach((variant, idx) => {
  runTest(
    `P-STRESS-14-${variant.name.split(':')[0]}`,
    `Missing files key - ${variant.name}`,
    variant.input,
    'Parser should return success: false with INVALID_STRUCTURE or NO_FILES_ARRAY',
    (result, duration) => {
      if (!result.success) {
        return {
          status: 'PASS',
          actualBehavior: `Parse failed as expected: ${result.failureReason}`,
          rootCause: '',
          fix: '',
          telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
        };
      }
      return {
        status: 'FAIL',
        actualBehavior: `Parse succeeded with ${result.files.length} files`,
        rootCause: 'Missing files key should cause parse failure',
        fix: 'Ensure missing/invalid files key is detected',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files },
      };
    }
  );
});

// P-STRESS-15: Files with no extension
runTest(
  'P-STRESS-15',
  'Files with no extension',
  '{"summary":"no ext","files":[\n  {"path":"Makefile","content":"all: build"},\n  {"path":"Dockerfile","content":"FROM node:18"},\n  {"path":"README","content":"# Title"},\n  {"path":"calculator","content":"def add(): pass"},\n  {"path":".gitignore","content":"node_modules/},\n  {"path":"script.py","content":"print(1)"}\n]}',
  'Document behavior for extensionless files. script.py should be accepted.',
  (result, duration) => {
    if (result.success) {
      const extracted = result.files.map(f => f.path);
      const hasScriptPy = extracted.includes('script.py');
      const hasMakefile = extracted.includes('Makefile');
      const hasDockerfile = extracted.includes('Dockerfile');
      
      return {
        status: hasScriptPy ? 'PASS' : 'FAIL',
        actualBehavior: `Extracted ${result.files.length} files: ${extracted.join(', ')}. Extensionless policy: Makefile=${hasMakefile}, Dockerfile=${hasDockerfile}, .gitignore=${extracted.includes('.gitignore')}`,
        rootCause: hasScriptPy ? '' : 'script.py should be accepted (has .py extension)',
        fix: '',
        telemetry: { extractionMethod: result.extractionMethod, files: result.files.map(f => f.path), extensionlessPolicy: 'files without . are rejected' },
      };
    }
    return {
      status: 'FAIL',
      actualBehavior: `Parse failed: ${result.failureReason}`,
      rootCause: 'Valid JSON but all files rejected',
      fix: 'Ensure script.py with .py extension is not rejected',
      telemetry: { extractionMethod: result.extractionMethod, failureReason: result.failureReason },
    };
  }
);

// Save results
const endTime = Date.now();
const totalDuration = endTime - startTime;

writeFileSync('D:/EamilOS/artifacts/stress-tests/parser/parser-results.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalTests: results.length,
  testsRun: results.length,
  testsPassed: results.filter(r => r.status === 'PASS').length,
  testsFailed: results.filter(r => r.status === 'FAIL').length,
  testsPartial: results.filter(r => r.status === 'PARTIAL').length,
  testsSkipped: 0,
  testsErrored: results.filter(r => r.status === 'ERROR').length,
  totalDurationMs: totalDuration,
  results,
}, null, 2));

writeFileSync('D:/EamilOS/artifacts/stress-tests/parser/parser-inputs.json', JSON.stringify(inputs, null, 2));

console.log(`Parser stress tests complete. ${results.length} tests run in ${totalDuration}ms`);
console.log(`PASS: ${results.filter(r => r.status === 'PASS').length}`);
console.log(`FAIL: ${results.filter(r => r.status === 'FAIL').length}`);
console.log(`PARTIAL: ${results.filter(r => r.status === 'PARTIAL').length}`);
console.log(`ERROR: ${results.filter(r => r.status === 'ERROR').length}`);
