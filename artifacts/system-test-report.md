# EamilOS System Test Report

**Date:** 2026-03-30  
**Version:** v0.2-working-execution  
**Test Runner:** Automated CLI tests  

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tests | 10 |
| Passed | 4 |
| Partial Pass | 4 |
| Failed | 2 |

---

## Detailed Results

### Test 1: Baseline Execution

**Status:** PASS  

**Command:** `eamilos run "Create a Python file hello.py that prints Hello World"`

**Details:**
- Project created successfully (ID: C16KWtuyQNoDDGHt3o88Q)
- Fallback parser triggered (tools disabled for phi3:mini)
- File created: `hello.py`
- Execution output: `Hello World`

**Artifacts:**
- `hello.py` - `print("Hello World")`

---

### Test 2: Multi-Task Flow

**Status:** FAIL  

**Command:** `eamilos run "Create two Python files: a.py prints A, b.py prints B"`

**Details:**
- Only 1 file created: `of` (incorrect filename)
- Fallback parser misidentified filename from `with open()` statement
- LLM returned a script that would create files, not the files themselves

**Artifacts:**
- `of` - Incorrect file (should have been `a.py` and `b.py`)

**Root Cause:** Fallback parser extracts filenames from code block context, but when LLM returns a script that creates files, the parser misinterprets variable names.

---

### Test 3: Dependency Simulation

**Status:** PARTIAL PASS  

**Command:** `eamilos run "Create a Python module utils.py with a function greet(), then create main.py that imports and uses it"`

**Details:**
- Both files created: `utils.py` and `main.py`
- `utils.py` content correct (contains `greet()` function)
- `main.py` content incorrect (contains philosophical thoughts, not importing utils)
- LLM ignored import instruction

**Artifacts:**
- `utils.py` - Correct function definition
- `main.py` - Wrong content (not importing utils)

**Root Cause:** LLM (phi3:mini) doesn't follow complex multi-step instructions reliably.

---

### Test 4: Invalid/Ambiguous Input

**Status:** PARTIAL PASS  

**Command:** `eamilos run "Make something useful in Python"`

**Details:**
- System made reasonable assumption (todo app)
- Artifact produced: `todoapp.py`
- Generated code has syntax errors (indentation issues)
- System doesn't validate generated code

**Artifacts:**
- `todoapp.py` - Contains `IndentationError` when executed

**Root Cause:** No code validation/QA step in the pipeline.

---

### Test 5: No Tool Response (Force Fallback)

**Status:** PASS  

**Command:** `eamilos run "Create a file test.py that prints Testing"`

**Details:**
- Tools confirmed disabled: `Tools enabled: false`
- Fallback parser triggered successfully
- File created: `test.py`
- Content correct, runs successfully

**Artifacts:**
- `test.py` - `print("Testing")`

---

### Test 6: Large Output

**Status:** PARTIAL PASS  

**Command:** `eamilos run "Create a Python script with 100 print statements"`

**Details:**
- File created with loop generating 100 prints
- File not truncated, no corruption
- Filename incorrectly derived from project ID (`trpscjsju2nut6ge3psy3.py`)
- System handles size safely (uses loop instead of 100 explicit prints)

**Artifacts:**
- `trpscjsju2nut6ge3psy3.py` - Contains `for i in range(1, 101): print(...)`

**Root Cause:** Fallback parser defaults to `inferFilePath()` when no filename detected in context.

---

### Test 7: Invalid Code Generation

**Status:** PARTIAL PASS  

**Command:** `eamilos run "Create a Python file with intentional syntax error"`

**Details:**
- LLM refused to create bad code (good behavior)
- No file created
- Task failed gracefully
- System has no code validation

**Artifacts:** None (LLM refused request)

**Root Cause:** LLM was smart enough to refuse, but system doesn't validate code syntax.

---

### Test 8: Repeat Execution (Idempotency)

**Status:** PASS  

**Command:** Run same command twice: `eamilos run "Create hello.py that prints Hello World"`

**Details:**
- First run: Created project `SqBkrF6rAOOXtvMN79QUc`, file content `print("Hello World")`
- Second run: Created new project `xJ01fcgmokU5jjg6rYdE4`, file content `print("Hello, World!")`
- No collision or corruption
- Each run isolated in separate project

**Artifacts:**
- Project 1: `hello.py` - `print("Hello World")`
- Project 2: `hello.py` - `print("Hello, World!")`

---

### Test 9: Resource/Limit Test

**Status:** FAIL  

**Command:** `eamilos run "Generate 10 Python files each printing a number"`

**Details:**
- No files created
- Task failed
- LLM returned script that would create files instead of individual files
- Fallback parser couldn't extract 10 separate file definitions

**Artifacts:** None

**Root Cause:** Fallback parser limitation with multi-file extraction.

---

### Test 10: Failure Recovery

**Status:** PASS  

**Command:** Interrupt execution mid-task with `timeout 5`

**Details:**
- Process interrupted cleanly
- Recovery mechanism triggered: `"Recovering 1 stuck tasks in project..."`
- Task marked as "interrupted"
- No corrupted state
- System ready for retry

**Artifacts:** N/A (no files created before interruption)

---

## Failures & Root Causes

| Issue | Cause | Suggested Fix |
|-------|-------|--------------|
| Multi-file extraction fails | Fallback parser misidentifies filenames from scripts | Improve parser to handle file creation scripts, or use tool calling |
| Filename inference wrong | `inferFilePath()` uses project ID as fallback | Add better default naming or require explicit filename |
| Code not validated | No QA step in pipeline | Add syntax validation before artifact commit |
| LLM ignores complex instructions | phi3:mini capability limitations | Use stronger model or improve system prompt |

---

## System Weaknesses Identified

1. **Fallback Parser Limitations**
   - Can't extract multiple files from a single code block
   - Misidentifies filenames from `with open()` statements
   - No filename context in LLM response defaults to project ID

2. **No Code Validation**
   - Generated code not syntax-checked before commit
   - Invalid code can be saved as artifact

3. **LLM Reliability**
   - phi3:mini ignores complex multi-step instructions
   - Tool calling not supported on phi3

4. **Response Time**
   - Ollama phi3:mini slow (30-90 seconds per request)
   - Timeout handling critical

---

## Recommendations

### High Priority
1. **Implement tool calling** for stronger Ollama models (qwen2.5, mixtral)
2. **Add code validation** step before artifact commit
3. **Improve fallback parser** for multi-file scenarios

### Medium Priority
1. **Better filename inference** - Don't use project ID as default
2. **Timeout handling** - Show progress for slow LLM responses
3. **Retry logic** - For transient Ollama failures

### Low Priority
1. **Code formatting** - Auto-format generated code
2. **Type hints** - Validate Python type annotations
3. **Dependency resolution** - Detect missing imports

---

## Conclusion

EamilOS v0.2 demonstrates **functional end-to-end execution** with Ollama + phi3:mini. The system successfully:
- Creates projects and tasks
- Executes LLM requests
- Uses fallback parser for non-tool models
- Creates artifacts (single files)
- Recovers from failures

However, significant gaps exist for production use:
- Multi-file scenarios fail
- No code validation
- LLM reliability issues with phi3:mini

**Next milestone:** Enable tool calling with stronger models and add code validation pipeline.
