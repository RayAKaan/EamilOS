import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'yaml';
import { PathValidator, LeakDetector, OllamaDetector, ConfigNormalizer } from '@eamilos/core';

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  message: string;
  autoFixable: boolean;
  fixInstruction?: string;
  fix?: () => Promise<void>;
}

export async function doctorCommand(options: {
  fix: boolean;
  verbose: boolean;
}): Promise<void> {
  console.log('\n  EamilOS System Doctor\n');
  console.log('  ' + '─'.repeat(50));

  const checks: DoctorCheck[] = [];
  let fixesApplied = 0;
  let fixesFailed = 0;

  checks.push(checkNodeVersion());
  checks.push(await checkConfiguration(options.fix));
  checks.push(await checkConfigNormalization());
  checks.push(await checkProviderInitialization());
  checks.push(await checkOllamaConnectivity(options.verbose));
  checks.push(checkOpenAIConfiguration());
  checks.push(checkAnthropicConfiguration());
  checks.push(await checkModelAvailability(options.verbose));
  checks.push(await checkSecuritySystem());
  checks.push(await checkPathValidation());
  checks.push(await checkPluginSystem());
  checks.push(await checkWorkspacePermissions());
  checks.push(await checkDependencies());
  checks.push(checkDiskSpace());

  console.log('\n  ' + '─'.repeat(50));
  console.log('  RESULTS\n');

  let passed = 0;
  let warned = 0;
  let failed = 0;

  for (const check of checks) {
    const icon = check.status === 'pass' ? '✅' :
                 check.status === 'warn' ? '⚠️ ' :
                 check.status === 'fail' ? '❌' : '⏭️ ';

    console.log(`  ${icon} ${check.name}`);

    if (check.status !== 'pass') {
      console.log(`     ${check.message}`);

      if (check.fix) {
        if (options.fix && check.autoFixable) {
          try {
            await check.fix();
            console.log(`     Auto-fixed!`);
            fixesApplied++;
          } catch (e) {
            console.log(`     Auto-fix failed: ${e instanceof Error ? e.message : String(e)}`);
            fixesFailed++;
          }
        } else if (check.fixInstruction) {
          console.log(`     Fix: ${check.fixInstruction}`);
        }
      }
    }

    if (check.status === 'pass') passed++;
    else if (check.status === 'warn') warned++;
    else if (check.status === 'fail') failed++;
  }

  console.log('\n  ' + '─'.repeat(50));
  console.log(`  ✅ Passed: ${passed}   ⚠️  Warnings: ${warned}   ❌ Failed: ${failed}`);

  if (fixesApplied > 0) {
    console.log(`  Auto-fixes applied: ${fixesApplied}`);
  }

  if (failed === 0 && warned === 0) {
    console.log('\n  System is healthy! Ready to use.\n');
  } else if (failed === 0) {
    console.log('\n  System is functional with minor warnings.\n');
  } else {
    console.log('\n  System has issues that need attention.');
    if (!options.fix) {
      console.log('  Run: eamilos doctor --fix  to attempt auto-repairs.\n');
    }
  }
}

function checkNodeVersion(): DoctorCheck {
  const major = parseInt(process.version.slice(1).split('.')[0], 10);

  if (major >= 20) {
    return { name: 'Node.js version', status: 'pass', message: `${process.version}`, autoFixable: false };
  } else if (major >= 18) {
    return {
      name: 'Node.js version',
      status: 'warn',
      message: `${process.version} — works but Node.js 20+ recommended`,
      autoFixable: false,
      fixInstruction: 'Upgrade Node.js: https://nodejs.org/'
    };
  } else {
    return {
      name: 'Node.js version',
      status: 'fail',
      message: `${process.version} — Node.js 18+ required`,
      autoFixable: false,
      fixInstruction: 'Install Node.js 18 or later: https://nodejs.org/'
    };
  }
}

async function checkConfiguration(_canFix: boolean): Promise<DoctorCheck> {
  const configPath = 'eamilos.config.yaml';
  if (fs.existsSync(configPath)) {
    try {
      const config = parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      if (!config.provider || !config.model) {
        return {
          name: 'Configuration file',
          status: 'warn',
          message: `${configPath} exists but missing provider/model`,
          autoFixable: true,
          fixInstruction: 'Run: eamilos setup',
          fix: async () => {
            console.log('     Run eamilos setup to configure properly');
          }
        };
      }
      return {
        name: 'Configuration file',
        status: 'pass',
        message: `${configPath} valid (provider: ${config.provider}, model: ${config.model})`,
        autoFixable: false
      };
    } catch (e) {
      return {
        name: 'Configuration file',
        status: 'fail',
        message: `${configPath} exists but contains invalid YAML`,
        autoFixable: true,
        fixInstruction: 'Run: eamilos setup  to regenerate config',
        fix: async () => {
          const backup = configPath + '.backup.' + Date.now();
          fs.renameSync(configPath, backup);
          console.log(`     Backed up corrupt config to ${backup}`);
        }
      };
    }
  } else {
    return {
      name: 'Configuration file',
      status: 'fail',
      message: 'No eamilos.config.yaml found',
      autoFixable: false,
      fixInstruction: 'Run: eamilos setup  or  eamilos init'
    };
  }
}

async function checkConfigNormalization(): Promise<DoctorCheck> {
  const configPaths = ['eamilos.yaml', '.eamilos.yaml', 'eamilos.config.yaml', '.eamilos.config.yaml'];
  let configPath = null;
  
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    return {
      name: 'Config normalization',
      status: 'warn',
      message: 'No config file — will be auto-created on first run',
      autoFixable: false,
    };
  }

  try {
    const raw = parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const normalizer = new ConfigNormalizer();
    const config = normalizer.normalize(raw);

    return {
      name: 'Config normalization',
      status: 'pass',
      message: `Normalized: ${config.providers.length} provider(s), default: ${config.defaultModel}`,
      autoFixable: false,
    };
  } catch (e) {
    return {
      name: 'Config normalization',
      status: 'fail',
      message: `Failed: ${e instanceof Error ? e.message : String(e)}`,
      autoFixable: true,
      fixInstruction: 'Run: eamilos doctor --fix',
      fix: async () => {
        const healer = await import('@eamilos/core');
        await healer.ConfigHealer.heal(configPath!);
      }
    };
  }
}

async function checkProviderInitialization(): Promise<DoctorCheck> {
  const configPaths = ['eamilos.yaml', '.eamilos.yaml', 'eamilos.config.yaml', '.eamilos.config.yaml'];
  let configPath = null;
  
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    return { 
      name: 'Provider initialization', 
      status: 'skip',
      message: 'No config — skipping', 
      autoFixable: false 
    };
  }

  try {
    const raw = parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const normalizer = new ConfigNormalizer();
    normalizer.normalize(raw);

    const detector = new OllamaDetector();
    const status = await detector.detect();

    if (status.running && status.models.length > 0) {
      return {
        name: 'Provider initialization',
        status: 'pass',
        message: `Ollama ready with ${status.models.length} model(s)`,
        autoFixable: false,
      };
    } else if (process.env.OPENAI_API_KEY) {
      return {
        name: 'Provider initialization',
        status: 'pass',
        message: 'OpenAI API key available',
        autoFixable: false,
      };
    } else {
      return {
        name: 'Provider initialization',
        status: 'fail',
        message: 'No providers available',
        autoFixable: false,
        fixInstruction: 'Start Ollama: ollama serve  or  export OPENAI_API_KEY',
      };
    }
  } catch (e) {
    return {
      name: 'Provider initialization',
      status: 'fail',
      message: `Error: ${e instanceof Error ? e.message : String(e)}`,
      autoFixable: false,
    };
  }
}

async function checkOllamaConnectivity(verbose: boolean): Promise<DoctorCheck> {
  const detector = new OllamaDetector();
  const status = await detector.detect();

  if (!status.installed) {
    return {
      name: 'Ollama',
      status: 'fail',
      message: 'Ollama is not installed',
      autoFixable: false,
      fixInstruction: 'Install from: https://ollama.ai/download'
    };
  }

  if (!status.running) {
    return {
      name: 'Ollama',
      status: 'warn',
      message: 'Ollama is installed but not running',
      autoFixable: false,
      fixInstruction: 'Start with: ollama serve'
    };
  }

  if (status.models.length === 0) {
    return {
      name: 'Ollama',
      status: 'warn',
      message: `Ollama ${status.version || ''} is running but has no models`,
      autoFixable: false,
      fixInstruction: 'Install a model: ollama pull phi3:mini'
    };
  }

  const modelCount = status.models.length;
  const modelNames = verbose
    ? status.models.map(m => m.name).join(', ')
    : status.models.slice(0, 5).map(m => m.name).join(', ');

  const message = modelCount > 5 && !verbose
    ? `${modelCount} models installed (${modelNames}, ...)`
    : `${modelCount} model(s): ${modelNames}`;

  return {
    name: 'Ollama',
    status: 'pass',
    message: message.trim(),
    autoFixable: false
  };
}

function checkOpenAIConfiguration(): DoctorCheck {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      name: 'OpenAI provider',
      status: 'skip',
      message: 'OPENAI_API_KEY not set (optional — skip if using Ollama)',
      autoFixable: false
    };
  }
  if (!key.startsWith('sk-') || key.length < 40) {
    return {
      name: 'OpenAI provider',
      status: 'fail',
      message: 'OPENAI_API_KEY format looks invalid',
      autoFixable: false,
      fixInstruction: 'Check your API key at: https://platform.openai.com/api-keys'
    };
  }
  return {
    name: 'OpenAI provider',
    status: 'pass',
    message: `API key configured (${key.slice(0, 7)}...${key.slice(-4)})`,
    autoFixable: false
  };
}

function checkAnthropicConfiguration(): DoctorCheck {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      name: 'Anthropic provider',
      status: 'skip',
      message: 'ANTHROPIC_API_KEY not set (optional)',
      autoFixable: false
    };
  }
  if (!key.startsWith('sk-ant-') || key.length < 40) {
    return {
      name: 'Anthropic provider',
      status: 'fail',
      message: 'ANTHROPIC_API_KEY format looks invalid',
      autoFixable: false,
      fixInstruction: 'Check your API key at: https://console.anthropic.com/'
    };
  }
  return {
    name: 'Anthropic provider',
    status: 'pass',
    message: `API key configured (${key.slice(0, 10)}...${key.slice(-4)})`,
    autoFixable: false
  };
}

async function checkModelAvailability(_verbose: boolean): Promise<DoctorCheck> {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const data = await response.json() as { models?: Array<{ name: string }> };
      if (data.models && data.models.length > 0) {
        return {
          name: 'Model availability',
          status: 'pass',
          message: `${data.models.length} Ollama model(s) available`,
          autoFixable: false
        };
      }
    }
  } catch {}

  if (!hasOpenAI && !hasAnthropic) {
    return {
      name: 'Model availability',
      status: 'fail',
      message: 'No AI models available. Need at least one provider with one model.',
      autoFixable: false,
      fixInstruction: 'Install Ollama + model: ollama pull phi3:mini\nOR set OPENAI_API_KEY'
    };
  }

  return {
    name: 'Model availability',
    status: 'pass',
    message: `Cloud providers configured: ${[hasOpenAI && 'OpenAI', hasAnthropic && 'Anthropic'].filter(Boolean).join(', ')}`,
    autoFixable: false
  };
}

async function checkSecuritySystem(): Promise<DoctorCheck> {
  try {
    const detector = new LeakDetector();
    const testResult = detector.scan('safe content no secrets here');

    if (testResult.safe !== true) {
      return {
        name: 'Security: Leak detector',
        status: 'fail',
        message: 'LeakDetector returning false positives on safe content',
        autoFixable: false,
        fixInstruction: 'Check LeakDetector pattern configuration'
      };
    }

    const secretResult = detector.scan('API_KEY=sk-test1234567890abcdefghijklmnop');
    if (secretResult.safe !== false) {
      return {
        name: 'Security: Leak detector',
        status: 'fail',
        message: 'LeakDetector failed to detect test API key',
        autoFixable: false,
        fixInstruction: 'LeakDetector patterns may be misconfigured'
      };
    }

    return {
      name: 'Security: Leak detector',
      status: 'pass',
      message: 'Leak detection working correctly',
      autoFixable: false
    };
  } catch (e) {
    return {
      name: 'Security: Leak detector',
      status: 'fail',
      message: `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`,
      autoFixable: false
    };
  }
}

async function checkPathValidation(): Promise<DoctorCheck> {
  try {
    const validator = new PathValidator(process.cwd());

    const traversalResult = validator.validate('../../etc/passwd');
    if (traversalResult.safe) {
      return {
        name: 'Security: Path validation',
        status: 'fail',
        message: 'CRITICAL: Path traversal not blocked',
        autoFixable: false,
        fixInstruction: 'PathValidator is compromised — do not use system until fixed'
      };
    }

    const normalResult = validator.validate('src/app.py');
    if (!normalResult.safe) {
      return {
        name: 'Security: Path validation',
        status: 'fail',
        message: 'PathValidator rejecting valid paths',
        autoFixable: false
      };
    }

    return {
      name: 'Security: Path validation',
      status: 'pass',
      message: 'Path validation working correctly',
      autoFixable: false
    };
  } catch (e) {
    return {
      name: 'Security: Path validation',
      status: 'fail',
      message: `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`,
      autoFixable: false
    };
  }
}

async function checkPluginSystem(): Promise<DoctorCheck> {
  const pluginsDir = path.join(os.homedir(), '.eamilos', 'plugins', 'installed');
  if (!fs.existsSync(pluginsDir)) {
    return {
      name: 'Plugin system',
      status: 'pass',
      message: 'No plugins installed (plugin directory will be created on first install)',
      autoFixable: false
    };
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const pluginCount = entries.filter(e => e.isDirectory()).length;

  return {
    name: 'Plugin system',
    status: 'pass',
    message: `${pluginCount} plugin(s) installed`,
    autoFixable: false
  };
}

async function checkWorkspacePermissions(): Promise<DoctorCheck> {
  const testFile = path.join(process.cwd(), '.eamilos-doctor-test');
  try {
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return {
      name: 'Workspace permissions',
      status: 'pass',
      message: `Write access confirmed in ${process.cwd()}`,
      autoFixable: false
    };
  } catch {
    return {
      name: 'Workspace permissions',
      status: 'fail',
      message: `Cannot write to ${process.cwd()}`,
      autoFixable: false,
      fixInstruction: 'Run from a directory where you have write permission'
    };
  }
}

async function checkDependencies(): Promise<DoctorCheck> {
  const critical = ['path', 'fs', 'os', 'crypto'];
  const missing = critical.filter(dep => {
    try { require(dep); return false; } catch { return true; }
  });

  if (missing.length > 0) {
    return {
      name: 'Core dependencies',
      status: 'fail',
      message: `Missing: ${missing.join(', ')}`,
      autoFixable: false,
      fixInstruction: 'Reinstall: npm install'
    };
  }

  return {
    name: 'Core dependencies',
    status: 'pass',
    message: 'All core dependencies available',
    autoFixable: false
  };
}

function checkDiskSpace(): DoctorCheck {
  try {
    const stats = fs.statfsSync(process.cwd());
    const freeGB = (stats.bsize * stats.bavail) / (1024 * 1024 * 1024);

    if (freeGB < 0.5) {
      return {
        name: 'Disk space',
        status: 'fail',
        message: `Only ${freeGB.toFixed(2)} GB free — need at least 500 MB`,
        autoFixable: false,
        fixInstruction: 'Free up disk space'
      };
    } else if (freeGB < 2) {
      return {
        name: 'Disk space',
        status: 'warn',
        message: `${freeGB.toFixed(1)} GB free — low but functional`,
        autoFixable: false
      };
    }

    return {
      name: 'Disk space',
      status: 'pass',
      message: `${freeGB.toFixed(1)} GB free`,
      autoFixable: false
    };
  } catch {
    return {
      name: 'Disk space',
      status: 'pass',
      message: 'Could not check (non-critical)',
      autoFixable: false
    };
  }
}
