import { describe, it, expect } from 'vitest';
import { PathValidator } from '../../src/security/index.js';
import { parseResponse } from '../../src/parsers/ResponseParser.js';

describe('Production Hardening: PathValidator', () => {

  describe('Fix 1: Path Safety (P-STRESS-8)', () => {
    const validator = new PathValidator('/home/user/workspace');

    describe('Unsafe paths (must be rejected)', () => {
      it('should reject absolute unix paths', () => {
        expect(validator.validate('/etc/passwd').safe).toBe(false);
      });

      it('should reject absolute windows paths', () => {
        expect(validator.validate('C:\\Windows\\System32\\config').safe).toBe(false);
      });

      it('should reject UNC paths', () => {
        expect(validator.validate('\\\\server\\share\\file.txt').safe).toBe(false);
      });

      it('should reject traversal with ../', () => {
        expect(validator.validate('../../etc/passwd').safe).toBe(false);
      });

      it('should reject traversal with ..\\', () => {
        expect(validator.validate('..\\..\\windows\\system32').safe).toBe(false);
      });

      it('should reject embedded traversal', () => {
        expect(validator.validate('normal/../../../etc/shadow').safe).toBe(false);
      });

      it('should reject unix absolute paths', () => {
        expect(validator.validate('/absolute/path/file.py').safe).toBe(false);
      });

      it('should reject windows drive letters', () => {
        expect(validator.validate('D:/Users/file.txt').safe).toBe(false);
      });

      it('should reject empty paths', () => {
        expect(validator.validate('').safe).toBe(false);
      });

      it('should reject whitespace-only paths', () => {
        expect(validator.validate('   ').safe).toBe(false);
      });

      it('should reject null bytes in paths', () => {
        expect(validator.validate('file\x00name.py').safe).toBe(false);
      });

      it('should reject windows reserved names (CON)', () => {
        expect(validator.validate('CON.txt').safe).toBe(false);
      });

      it('should reject windows reserved names (NUL)', () => {
        expect(validator.validate('NUL').safe).toBe(false);
      });

      it('should reject angle brackets in paths', () => {
        expect(validator.validate('file<name>.py').safe).toBe(false);
      });
    });

    describe('Safe paths (must be accepted)', () => {
      it('should accept simple filenames', () => {
        expect(validator.validate('calculator.py').safe).toBe(true);
      });

      it('should accept nested paths', () => {
        expect(validator.validate('src/utils/helper.ts').safe).toBe(true);
      });

      it('should accept project paths', () => {
        expect(validator.validate('my-project/README.md').safe).toBe(true);
      });

      it('should accept extensionless files like Makefile', () => {
        expect(validator.validate('Makefile').safe).toBe(true);
      });

      it('should accept dotfiles like .gitignore', () => {
        expect(validator.validate('.gitignore').safe).toBe(true);
      });
    });
  });

  describe('Fix 2: Case-Insensitive Filename Blocking (P-STRESS-9)', () => {

    describe('Blocked filenames (case-insensitive)', () => {
      it('should block .env', () => {
        expect(PathValidator.isBlockedFilename('.env').blocked).toBe(true);
      });

      it('should block .ENV (uppercase)', () => {
        expect(PathValidator.isBlockedFilename('.ENV').blocked).toBe(true);
      });

      it('should block .Env (mixed case)', () => {
        expect(PathValidator.isBlockedFilename('.Env').blocked).toBe(true);
      });

      it('should block .env.local', () => {
        expect(PathValidator.isBlockedFilename('.env.local').blocked).toBe(true);
      });

      it('should block .ENV.LOCAL (all uppercase)', () => {
        expect(PathValidator.isBlockedFilename('.ENV.LOCAL').blocked).toBe(true);
      });

      it('should block data.json', () => {
        expect(PathValidator.isBlockedFilename('data.json').blocked).toBe(true);
      });

      it('should block DATA.JSON (uppercase)', () => {
        expect(PathValidator.isBlockedFilename('DATA.JSON').blocked).toBe(true);
      });

      it('should block Data.Json (mixed case)', () => {
        expect(PathValidator.isBlockedFilename('Data.Json').blocked).toBe(true);
      });

      it('should block output.txt', () => {
        expect(PathValidator.isBlockedFilename('output.txt').blocked).toBe(true);
      });

      it('should block OUTPUT.TXT (uppercase)', () => {
        expect(PathValidator.isBlockedFilename('OUTPUT.TXT').blocked).toBe(true);
      });

      it('should block .DS_Store', () => {
        expect(PathValidator.isBlockedFilename('.DS_Store').blocked).toBe(true);
      });

      it('should block .ds_store (lowercase)', () => {
        expect(PathValidator.isBlockedFilename('.ds_store').blocked).toBe(true);
      });

      it('should block id_rsa', () => {
        expect(PathValidator.isBlockedFilename('id_rsa').blocked).toBe(true);
      });

      it('should block ID_RSA (uppercase)', () => {
        expect(PathValidator.isBlockedFilename('ID_RSA').blocked).toBe(true);
      });

      it('should block files with "secret" in name', () => {
        expect(PathValidator.isBlockedFilename('my_secret_config.yml').blocked).toBe(true);
      });

      it('should block files with "password" in name', () => {
        expect(PathValidator.isBlockedFilename('db_password.txt').blocked).toBe(true);
      });

      it('should block private_key.pem', () => {
        expect(PathValidator.isBlockedFilename('private_key.pem').blocked).toBe(true);
      });

      it('should block PRIVATE_KEY.PEM (uppercase)', () => {
        expect(PathValidator.isBlockedFilename('PRIVATE_KEY.PEM').blocked).toBe(true);
      });
    });

    describe('Safe filenames', () => {
      it('should allow calculator.py', () => {
        expect(PathValidator.isBlockedFilename('calculator.py').blocked).toBe(false);
      });

      it('should allow index.html', () => {
        expect(PathValidator.isBlockedFilename('index.html').blocked).toBe(false);
      });

      it('should allow app.js', () => {
        expect(PathValidator.isBlockedFilename('app.js').blocked).toBe(false);
      });

      it('should allow style.css', () => {
        expect(PathValidator.isBlockedFilename('style.css').blocked).toBe(false);
      });

      it('should allow README.md', () => {
        expect(PathValidator.isBlockedFilename('README.md').blocked).toBe(false);
      });

      it('should allow Makefile', () => {
        expect(PathValidator.isBlockedFilename('Makefile').blocked).toBe(false);
      });

      it('should allow Dockerfile', () => {
        expect(PathValidator.isBlockedFilename('Dockerfile').blocked).toBe(false);
      });

      it('should allow .gitignore', () => {
        expect(PathValidator.isBlockedFilename('.gitignore').blocked).toBe(false);
      });

      it('should allow .gitattributes', () => {
        expect(PathValidator.isBlockedFilename('.gitattributes').blocked).toBe(false);
      });

      it('should allow config.yaml', () => {
        expect(PathValidator.isBlockedFilename('config.yaml').blocked).toBe(false);
      });

      it('should allow nested paths', () => {
        expect(PathValidator.isBlockedFilename('src/utils/helper.ts').blocked).toBe(false);
      });

      it('should allow database.py', () => {
        expect(PathValidator.isBlockedFilename('database.py').blocked).toBe(false);
      });
    });
  });

  describe('Fix 3: Unicode Normalization', () => {
    const validator = new PathValidator('/workspace');

    it('should accept NFC normalized café', () => {
      const nfc = 'caf\u00E9.py';
      expect(validator.validate(nfc).safe).toBe(true);
    });

    it('should accept NFD normalized café', () => {
      const nfd = 'cafe\u0301.py';
      expect(validator.validate(nfd).safe).toBe(true);
    });

    it('should normalize NFC and NFD to same path', () => {
      const nfc = 'caf\u00E9.py';
      const nfd = 'cafe\u0301.py';
      const resultNFC = validator.validate(nfc);
      const resultNFD = validator.validate(nfd);
      expect(resultNFC.normalizedPath).toBe(resultNFD.normalizedPath);
    });

    it('should reject null bytes', () => {
      expect(validator.validate('file\x00name.py').safe).toBe(false);
    });

    it('should reject escape characters', () => {
      expect(validator.validate('file\x1Bname.py').safe).toBe(false);
    });

    it('should reject bidi override characters', () => {
      expect(validator.validate('file\u202Ename.py').safe).toBe(false);
    });

    it('should reject zero-width characters', () => {
      expect(validator.validate('file\u200Bname.py').safe).toBe(false);
    });

    it('should accept CJK characters', () => {
      expect(validator.validate('hello_世界.py').safe).toBe(true);
    });

    it('should accept Spanish characters', () => {
      expect(validator.validate('ñoño.py').safe).toBe(true);
    });
  });

  describe('Fix 4: JSON Parsing Edge Cases', () => {

    describe('BOM and whitespace handling', () => {
      it('should handle BOM prefix', () => {
        const input = '\uFEFF{"summary":"bom","files":[{"path":"app.py","content":"x=1"}]}';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
      });

      it('should handle trailing whitespace and newlines', () => {
        const input = '  \n\n{"summary":"ws","files":[{"path":"app.py","content":"x=1"}]}\n\n  ';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
      });

      it('should handle invisible unicode whitespace', () => {
        const input = '\u00A0{"summary":"inv","files":[{"path":"app.py","content":"x=1"}]}\u00A0';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
      });

      it('should handle surrounding null bytes', () => {
        const input = '\x00{"summary":"null","files":[{"path":"app.py","content":"x=1"}]}\x00';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('Trailing comma repair', () => {
      it('should repair trailing comma', () => {
        const input = '{"summary":"comma","files":[{"path":"app.py","content":"x=1",}]}';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
        expect(result.extractionMethod).toBe('DIRECT_PARSE');
      });
    });

    describe('Content null byte cleaning', () => {
      it('should clean null bytes from content', () => {
        const input = '{"summary":"null","files":[{"path":"app.py","content":"x = 1\\u0000y = 2"}]}';
        const result = parseResponse(input);
        expect(result.success).toBe(true);
        expect(result.files[0].content).toBe('x = 1y = 2');
      });
    });
  });
});
