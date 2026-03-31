import { parseResponse } from '../parsers/ResponseParser.js';
import { PathValidator } from '../security/index.js';

console.log("========================================");
console.log("INLINE VERIFICATION - Fix 1: PathValidator");
console.log("========================================\n");

const validator = new PathValidator("/home/user/workspace");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

console.log("\n--- Unsafe paths (must be rejected) ---");

assert(validator.validate("/etc/passwd").safe === false, "FAIL: absolute unix path allowed");
assert(validator.validate("C:\\Windows\\System32\\config").safe === false, "FAIL: absolute windows path allowed");
assert(validator.validate("\\\\server\\share\\file.txt").safe === false, "FAIL: UNC path allowed");
assert(validator.validate("../../etc/passwd").safe === false, "FAIL: traversal with ../ allowed");
assert(validator.validate("..\\..\\windows\\system32").safe === false, "FAIL: traversal with ..\\ allowed");
assert(validator.validate("normal/../../../etc/shadow").safe === false, "FAIL: embedded traversal allowed");
assert(validator.validate("/absolute/path/file.py").safe === false, "FAIL: unix absolute allowed");
assert(validator.validate("D:/Users/file.txt").safe === false, "FAIL: windows drive letter allowed");
assert(validator.validate("").safe === false, "FAIL: empty path allowed");
assert(validator.validate("   ").safe === false, "FAIL: whitespace path allowed");
assert(validator.validate("file\x00name.py").safe === false, "FAIL: null byte in path allowed");
assert(validator.validate("CON.txt").safe === false, "FAIL: windows reserved name allowed");
assert(validator.validate("NUL").safe === false, "FAIL: windows reserved name without extension allowed");
assert(validator.validate("file<name>.py").safe === false, "FAIL: angle brackets allowed");

console.log("\n--- Safe paths (must be accepted) ---");

assert(validator.validate("calculator.py").safe === true, "FAIL: simple filename rejected");
assert(validator.validate("src/utils/helper.ts").safe === true, "FAIL: nested path rejected");
assert(validator.validate("my-project/README.md").safe === true, "FAIL: project path rejected");
assert(validator.validate("Makefile").safe === true, "FAIL: extensionless file rejected");
assert(validator.validate(".gitignore").safe === true, "FAIL: dotfile rejected");

console.log("\n========================================");
console.log("INLINE VERIFICATION - Fix 2: Case-Insensitive Blocking");
console.log("========================================\n");

function isBlocked(path: string): boolean {
  return PathValidator.isBlockedFilename(path).blocked;
}

console.log("\n--- Blocked filenames (case-insensitive) ---");

assert(isBlocked(".env") === true, "FAIL: .env not blocked");
assert(isBlocked(".ENV") === true, "FAIL: .ENV not blocked");
assert(isBlocked(".Env") === true, "FAIL: .Env not blocked");
assert(isBlocked(".env.local") === true, "FAIL: .env.local not blocked");
assert(isBlocked(".ENV.LOCAL") === true, "FAIL: .ENV.LOCAL not blocked");
assert(isBlocked("data.json") === true, "FAIL: data.json not blocked");
assert(isBlocked("DATA.JSON") === true, "FAIL: DATA.JSON not blocked");
assert(isBlocked("Data.Json") === true, "FAIL: Data.Json not blocked");
assert(isBlocked("output.txt") === true, "FAIL: output.txt not blocked");
assert(isBlocked("OUTPUT.TXT") === true, "FAIL: OUTPUT.TXT not blocked");
assert(isBlocked(".DS_Store") === true, "FAIL: .DS_Store not blocked");
assert(isBlocked(".ds_store") === true, "FAIL: .ds_store not blocked");
assert(isBlocked("id_rsa") === true, "FAIL: id_rsa not blocked");
assert(isBlocked("ID_RSA") === true, "FAIL: ID_RSA not blocked");
assert(isBlocked("my_secret_config.yml") === true, "FAIL: secret in name not blocked");
assert(isBlocked("db_password.txt") === true, "FAIL: password in name not blocked");
assert(isBlocked("private_key.pem") === true, "FAIL: private_key not blocked");
assert(isBlocked("PRIVATE_KEY.PEM") === true, "FAIL: PRIVATE_KEY.PEM not blocked");

console.log("\n--- Safe filenames ---");

assert(isBlocked("calculator.py") === false, "FAIL: calculator.py wrongly blocked");
assert(isBlocked("index.html") === false, "FAIL: index.html wrongly blocked");
assert(isBlocked("app.js") === false, "FAIL: app.js wrongly blocked");
assert(isBlocked("style.css") === false, "FAIL: style.css wrongly blocked");
assert(isBlocked("README.md") === false, "FAIL: README.md wrongly blocked");
assert(isBlocked("Makefile") === false, "FAIL: Makefile wrongly blocked");
assert(isBlocked("Dockerfile") === false, "FAIL: Dockerfile wrongly blocked");
assert(isBlocked(".gitignore") === false, "FAIL: .gitignore wrongly blocked");
assert(isBlocked(".gitattributes") === false, "FAIL: .gitattributes wrongly blocked");
assert(isBlocked("config.yaml") === false, "FAIL: config.yaml wrongly blocked");
assert(isBlocked("src/utils/helper.ts") === false, "FAIL: nested path wrongly blocked");
assert(isBlocked("database.py") === false, "FAIL: database.py wrongly blocked");

console.log("\n========================================");
console.log("INLINE VERIFICATION - Fix 3: Unicode Normalization");
console.log("========================================\n");

const nfc = "caf\u00E9.py";
const nfd = "cafe\u0301.py";
const resultNFC = validator.validate(nfc);
const resultNFD = validator.validate(nfd);

assert(resultNFC.safe === true, "FAIL: NFC café rejected");
assert(resultNFD.safe === true, "FAIL: NFD café rejected");
assert(
  resultNFC.normalizedPath === resultNFD.normalizedPath,
  "FAIL: NFC and NFD café did not normalize to same path. " +
  "Got: '" + resultNFC.normalizedPath + "' vs '" + resultNFD.normalizedPath + "'"
);

assert(validator.validate("file\x00name.py").safe === false, "FAIL: null byte in filename allowed");
assert(validator.validate("file\x1Bname.py").safe === false, "FAIL: escape char in filename allowed");
assert(validator.validate("file\u202Ename.py").safe === false, "FAIL: bidi override in filename allowed");
assert(validator.validate("file\u200Bname.py").safe === false, "FAIL: zero-width space in filename allowed");
assert(validator.validate("hello_世界.py").safe === true, "FAIL: CJK characters in filename wrongly rejected");
assert(validator.validate("ñoño.py").safe === true, "FAIL: Spanish characters wrongly rejected");

console.log("\n========================================");
console.log("INLINE VERIFICATION - Fix 4: JSON Parsing Edge Cases");
console.log("========================================\n");

const bomInput = '\uFEFF{"summary":"bom","files":[{"path":"app.py","content":"x=1"}]}';
const bomResult = parseResponse(bomInput);
assert(bomResult.success === true, "FAIL: BOM prefix caused parse failure - got: " + (bomResult.failureReason || 'unknown'));

const trailingInput = '  \n\n{"summary":"ws","files":[{"path":"app.py","content":"x=1"}]}\n\n  ';
const trailingResult = parseResponse(trailingInput);
assert(trailingResult.success === true, "FAIL: trailing whitespace caused parse failure - got: " + (trailingResult.failureReason || 'unknown'));

const commaInput = '{"summary":"comma","files":[{"path":"app.py","content":"x=1",}]}';
const commaResult = parseResponse(commaInput);
assert(commaResult.success === true, "FAIL: trailing comma not repaired - got: " + (commaResult.failureReason || 'unknown'));

const crlfInput = '{"summary":"crlf","files":[{"path":"app.py","content":"x=1\\r\\ny=2"}]}';
const crlfResult = parseResponse(crlfInput);
assert(crlfResult.success === true, "FAIL: CRLF in content caused failure - got: " + (crlfResult.failureReason || 'unknown'));

const invisibleInput = '\u00A0{"summary":"inv","files":[{"path":"app.py","content":"x=1"}]}\u00A0';
const invisibleResult = parseResponse(invisibleInput);
assert(invisibleResult.success === true, "FAIL: invisible unicode whitespace caused failure - got: " + (invisibleResult.failureReason || 'unknown'));

const nullInput = '\x00{"summary":"null","files":[{"path":"app.py","content":"x=1"}]}\x00';
const nullResult = parseResponse(nullInput);
assert(nullResult.success === true, "FAIL: surrounding null bytes caused failure - got: " + (nullResult.failureReason || 'unknown'));

console.log("\n========================================");
console.log("SUMMARY");
console.log("========================================");
console.log(`Total passed: ${passed}`);
console.log(`Total failed: ${failed}`);
console.log(failed === 0 ? "\n✅ All assertions passed!" : "\n❌ Some assertions failed!");

process.exit(failed === 0 ? 0 : 1);
