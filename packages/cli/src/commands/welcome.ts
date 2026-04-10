import { OllamaDetector } from '@eamilos/core';
import { AutoInit } from '@eamilos/core';
import * as os from 'os';

export interface WelcomeOptions {
  skip: boolean;
}

export async function welcomeCommand(_options: WelcomeOptions): Promise<void> {
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║     ██████╗ ███████╗███╗   ███╗██╗███████╗██████╗  ██████╗  ║
  ║     ██╔══██╗██╔════╝████╗ ████║██║██╔════╝██╔══██╗██╔═══██╗ ║
  ║     ██████╔╝█████╗  ██╔████╔██║██║███████╗██████╔╝██║   ██║ ║
  ║     ██╔═══╝ ██╔══╝  ██║╚██╔╝██║██║╚════██║██╔══██╗██║   ██║ ║
  ║     ██║     ███████╗██║ ╚═╝ ██║██║███████║██║  ██║╚██████╔╝ ║
  ║     ╚═╝     ╚══════╝╚═╝     ╚═╝╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ║
  ║                                                              ║
  ║     AI Execution Kernel v1.0.0                              ║
  ║     Zero-Friction Local AI Development                       ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
  `);

  console.log('  Welcome to EamilOS!\n');
  console.log('  Let\'s get you set up in seconds...\n');

  const detector = new OllamaDetector();
  const status = await detector.detect();

  console.log('  Checking your environment...\n');

  if (status.installed) {
    console.log(`    \x1b[32m✓\x1b[0m Ollama installed (${status.version || 'unknown version'})`);
  } else {
    console.log('    \x1b[33m!\x1b[0m Ollama not installed');
  }

  if (status.running) {
    console.log(`    \x1b[32m✓\x1b[0m Ollama is running`);

    if (status.models.length > 0) {
      console.log(`    \x1b[32m✓\x1b[0m ${status.models.length} model(s) available`);

      if (status.recommended) {
        console.log(`    \x1b[36m→\x1b[0m Recommended: \x1b[1m${status.recommended}\x1b[0m`);

        if (status.recommended.includes('phi3')) {
          console.log('      \x1b[2m(Good for testing, consider: ollama pull qwen2.5-coder:7b for coding)\x1b[0m');
        }
      }
    } else {
      console.log('    \x1b[33m!\x1b[0m No models installed');
    }
  } else if (status.installed) {
    console.log('    \x1b[33m!\x1b[0m Ollama installed but not running');
    console.log('      Start with: \x1b[1mollama serve\x1b[0m');
  }

  if (process.env.OPENAI_API_KEY) {
    console.log('    \x1b[32m✓\x1b[0m OpenAI API key detected');
  }

  if (process.env.ANTHROPIC_API_KEY) {
    console.log('    \x1b[32m✓\x1b[0m Anthropic API key detected');
  }

  console.log('\n  ' + '─'.repeat(56));

  const existingConfig = AutoInit.findConfig();

  if (existingConfig) {
    console.log('\n  \x1b[32m✓\x1b[0m Configuration found:\x1b[0m', existingConfig);
    console.log('\n  You\'re ready to go! Try:');
    console.log('    \x1b[36meamilos run "Build a simple web server"\x1b[0m\n');
  } else {
    console.log('\n  Setting up configuration...\n');

    try {
      const result = await AutoInit.run();

      if (result.created) {
        console.log('  \x1b[32m✓\x1b[0m Configuration created at:', result.configPath);
        console.log(`  \x1b[32m✓\x1b[0m Using: \x1b[1m${result.provider}/${result.model}\x1b[0m\n`);

        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            console.log('    \x1b[33m!\x1b[0m', w);
          }
          console.log('');
        }

        if (result.errors.length > 0) {
          for (const e of result.errors) {
            console.log('    \x1b[31m✗\x1b[0m', e);
          }
          console.log('');
        }

        console.log('  Quick start:');
        console.log('    \x1b[36meamilos run "Build a simple web server"\x1b[0m\n');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.log('  \x1b[31m✗\x1b[0m Setup failed:', message);
      console.log('\n  Run \x1b[1meamilos setup\x1b[0m for interactive configuration.\n');
    }
  }

  console.log('  ' + '─'.repeat(56));
  console.log('\n  Useful commands:');
  console.log('    \x1b[2meamilos doctor\x1b[0m    - Check system health');
  console.log('    \x1b[2meamilos validate\x1b[0m - Check config');
  console.log('    \x1b[2meamilos help\x1b[0m     - Show all commands\n');
}

export async function checkFirstRun(): Promise<boolean> {
  const configPath = AutoInit.findConfig();
  return configPath === null;
}

export async function isFirstRun(): Promise<boolean> {
  const homeDir = os.homedir();
  const markerPath = `${homeDir}/.eamilos/.first_run_completed`;

  try {
    const fs = await import('fs');
    return !fs.existsSync(markerPath);
  } catch {
    return true;
  }
}

export async function markFirstRunComplete(): Promise<void> {
  const homeDir = os.homedir();
  const dirPath = `${homeDir}/.eamilos`;
  const markerPath = `${dirPath}/.first_run_completed`;

  try {
    const fs = await import('fs');

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8');
  } catch {
    // Silently fail - marker is not critical
  }
}
