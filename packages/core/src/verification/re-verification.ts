import { parseResponse } from '../parsers/ResponseParser.js';
import { PathValidator } from '../security/index.js';

console.log("========================================");
console.log("RE-VERIFICATION TESTS R-1 through R-9");
console.log("========================================\n");

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function test(id: string, name: string, fn: () => boolean, details: string = "") {
  try {
    const passed = fn();
    results.push({ id, name, passed, details });
    console.log(`${passed ? '✅' : '❌'} ${id}: ${name}`);
    if (details && !passed) {
      console.log(`   Details: ${details}`);
    }
  } catch (e) {
    results.push({ id, name, passed: false, details: String(e) });
    console.log(`❌ ${id}: ${name} - ERROR: ${e}`);
  }
}

// R-1: P-STRESS-8 Retest (Absolute Paths)
test("R-1", "P-STRESS-8 Retest - Absolute Paths", () => {
  const input = '{"summary":"hack","files":[' +
    '{"path":"/etc/passwd","content":"root:x:0:0"},' +
    '{"path":"C:\\\\Windows\\\\System32\\\\config","content":"bad"},' +
    '{"path":"\\\\\\\\server\\\\share\\\\file.txt","content":"unc"},' +
    '{"path":"../../etc/shadow","content":"shadow"},' +
    '{"path":"normal_file.py","content":"print(1)"}' +
  ']}';
  
  const result = parseResponse(input);
  
  if (result.success) {
    const hasNormal = result.files.some(f => f.path === "normal_file.py");
    const hasDangerous = result.files.filter(f => 
      f.path.includes("passwd") || 
      f.path.includes("shadow") || 
      f.path.includes("config")
    ).length > 0;
    
    return hasNormal && !hasDangerous && result.files.length === 1;
  }
  
  return result.failureReason === 'NO_VALID_FILES' || result.failureReason === 'INVALID_STRUCTURE';
}, "Should only accept normal_file.py, reject all dangerous paths");

// R-2: P-STRESS-9 Retest (Case-Insensitive)
test("R-2", "P-STRESS-9 Retest - Case-Insensitive Blocking", () => {
  const input = '{"summary":"case","files":[' +
    '{"path":".ENV","content":"SECRET=bad"},' +
    '{"path":"DATA.JSON","content":"{}"},' +
    '{"path":"Output.Txt","content":"out"},' +
    '{"path":".Env.Local","content":"DB_PASS=123"},' +
    '{"path":"real_app.py","content":"print(1)"}' +
  ']}';
  
  const result = parseResponse(input);
  
  if (result.success) {
    const hasReal = result.files.some(f => f.path === "real_app.py");
    const blockedCount = result.files.filter(f => 
      f.path.toLowerCase().includes('env') || 
      f.path.toLowerCase().includes('data') || 
      f.path.toLowerCase().includes('output')
    ).length;
    
    return hasReal && blockedCount === 0 && result.files.length === 1;
  }
  
  return result.failureReason === 'NO_VALID_FILES' || result.failureReason === 'INVALID_STRUCTURE';
}, "Should only accept real_app.py, reject all case variants");

// R-3: Unicode Normalization
test("R-3", "Unicode Normalization", () => {
  const input = '{"summary":"unicode","files":[' +
    '{"path":"caf\\u00E9.py","content":"print(1)"},' +
    '{"path":"hello_\\u4E16\\u754C.py","content":"print(2)"}' +
  ']}';
  
  const result = parseResponse(input);
  
  if (result.success) {
    return result.files.length === 2 && 
           result.files.every(f => 
             f.path.includes("caf") || f.path.includes("hello") ||
             f.path.includes("\u00E9") || f.path.includes("世界")
           );
  }
  
  return false;
}, "Both files with unicode should be accepted");

// R-4: JSON with BOM and whitespace
test("R-4", "JSON with BOM and whitespace", () => {
  const input = '\uFEFF  \n {"summary":"bom","files":[{"path":"app.py","content":"x=1"}]} \n  ';
  
  const result = parseResponse(input);
  
  return result.success && result.files.length === 1 && result.files[0].path === "app.py";
}, "BOM and whitespace should not prevent parsing");

// R-5: Trailing comma repair
test("R-5", "Trailing comma repair", () => {
  const input = '{"summary":"comma","files":[{"path":"app.py","content":"def f(): pass",}]}';
  
  const result = parseResponse(input);
  
  return result.success && result.files.length === 1 && result.files[0].path === "app.py";
}, "Trailing comma should be repaired and parsed");

// R-6: Content with null bytes cleaned
test("R-6", "Content with null bytes cleaned", () => {
  const input = '{"summary":"null","files":[{"path":"app.py","content":"x = 1\\u0000y = 2"}]}';
  
  const result = parseResponse(input);
  
  if (result.success) {
    const hasCleanContent = result.files[0].content === "x = 1y = 2";
    return hasCleanContent;
  }
  
  return false;
}, "Null bytes in content should be removed");

// R-7: Workspace write safety
test("R-7", "Workspace write safety", () => {
  const validator = new PathValidator("/workspace");
  
  const tests = [
    { path: "calculator.py", expectSafe: true },
    { path: "/etc/passwd", expectSafe: false },
    { path: "../../hack.py", expectSafe: false },
    { path: "normal/nested/deep.py", expectSafe: true },
  ];
  
  const results = tests.map(t => ({
    path: t.path,
    safe: validator.validate(t.path).safe,
    expected: t.expectSafe,
    match: validator.validate(t.path).safe === t.expectSafe
  }));
  
  return results.every(r => r.match);
}, "PathValidator should block dangerous paths and allow safe paths");

// R-8: Full pipeline test
test("R-8", "Full pipeline with parser", () => {
  const input = '{"summary":"calculator","files":[{"path":"calculator.py","content":"def add(a, b):\\n    return a + b\\n\\ndef subtract(a, b):\\n    return a - b"}]}';
  
  const result = parseResponse(input);
  
  if (result.success) {
    const hasCalculator = result.files.some(f => f.path === "calculator.py");
    const hasCode = result.files.every(f => 
      f.content.includes("def") && !f.content.includes("This file")
    );
    
    return hasCalculator && hasCode;
  }
  
  return false;
}, "Pipeline should produce valid code files");

// R-9: Regression tests
test("R-9", "Regression - Previously passing tests", () => {
  const testCases = [
    { name: "Multiple JSON objects", input: '{"summary":"first","files":[{"path":"a.py","content":"x=1"}]} and also {"summary":"second","files":[{"path":"b.py","content":"y=2"}]}' },
    { name: "JSON + markdown", input: '```json\n{"summary":"calc","files":[{"path":"calc.py","content":"def add(a,b):\\n    return a+b"}]}\n```' },
    { name: "Deeply nested", input: '{"wrapper":{"data":{"summary":"nested","files":[{"path":"deep.py","content":"print(1)"}]}}}' },
    { name: "Empty files array", input: '{"summary":"empty","files":[]}' },
    { name: "Description content", input: '{"summary":"desc","files":[{"path":"f.py","content":"def real_function():\\n    return 42"}]}' },
    { name: "No files key", input: '{"summary":"nofiles","results":[{"path":"x.py","content":"y"}]}' },
    { name: "Null files", input: '{"summary":"null","files":null}' },
  ];
  
  const results = testCases.map(tc => {
    const result = parseResponse(tc.input);
    return { name: tc.name, success: result.success };
  });
  
  const expectedResults = [
    { name: "Multiple JSON objects", success: true },
    { name: "JSON + markdown", success: true },
    { name: "Deeply nested", success: false },
    { name: "Empty files array", success: false },
    { name: "Description content", success: true },
    { name: "No files key", success: false },
    { name: "Null files", success: false },
  ];
  
  const allMatch = results.every((r, i) => r.success === expectedResults[i].success);
  
  if (!allMatch) {
    console.log("\n   Regression details:");
    results.forEach((r, i) => {
      if (r.success !== expectedResults[i].success) {
        console.log(`   - ${expectedResults[i].name}: expected ${expectedResults[i].success}, got ${r.success}`);
      }
    });
  }
  
  return allMatch;
}, "All previously passing tests should still pass");

console.log("\n========================================");
console.log("RESULTS SUMMARY");
console.log("========================================");

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`\nPassed: ${passed}/9`);
console.log(`Failed: ${failed}/9`);

if (failed > 0) {
  console.log("\nFailed tests:");
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.id}: ${r.name}`);
    if (r.details) {
      console.log(`    ${r.details}`);
    }
  });
}

console.log(failed === 0 ? "\n✅ All re-verification tests PASSED!" : "\n❌ Some re-verification tests FAILED!");

process.exit(failed === 0 ? 0 : 1);
