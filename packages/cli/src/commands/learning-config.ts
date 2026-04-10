import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface LearningConfigOptions {
  set?: string;
  get?: string;
  reset?: boolean;
  list?: boolean;
  export?: string;
  import?: string;
}

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.eamilos', 'learning', 'config.json');

interface LearningSettings {
  emaAlpha: number;
  minSamples: number;
  explorationBonus: number;
  autoApplyEnabled: boolean;
  maxAutoApplyDuration: number;
  dampingFactor: number;
  confidenceThreshold: number;
}

const DEFAULT_SETTINGS: LearningSettings = {
  emaAlpha: 0.3,
  minSamples: 5,
  explorationBonus: 0.15,
  autoApplyEnabled: true,
  maxAutoApplyDuration: 1800000,
  dampingFactor: 0.5,
  confidenceThreshold: 0.7,
};

export async function learningConfigCommand(options: LearningConfigOptions): Promise<void> {
  if (options.list) {
    await listConfig();
    return;
  }

  if (options.get) {
    await getSetting(options.get);
    return;
  }

  if (options.set) {
    await setSetting(options.set);
    return;
  }

  if (options.reset) {
    await resetConfig();
    return;
  }

  if (options.export) {
    await exportConfig(options.export);
    return;
  }

  if (options.import) {
    await importConfig(options.import);
    return;
  }

  await showCurrentConfig();
}

async function loadConfig(): Promise<LearningSettings> {
  try {
    if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
      const data = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS;
}

async function saveConfig(config: LearningSettings): Promise<void> {
  const dir = path.dirname(DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function showCurrentConfig(): Promise<void> {
  const config = await loadConfig();

  console.log('\n=== Learning Configuration ===\n');

  console.log('Statistical Parameters\n');
  console.log(`  emaAlpha:             ${config.emaAlpha}`);
  console.log(`  minSamples:           ${config.minSamples}`);
  console.log(`  explorationBonus:     ${config.explorationBonus}`);
  console.log(`  confidenceThreshold:  ${config.confidenceThreshold}`);

  console.log('\nAuto-Tuning\n');
  console.log(`  dampingFactor:        ${config.dampingFactor}`);
  console.log(`  autoApplyEnabled:     ${config.autoApplyEnabled}`);

  console.log('\nSafety Limits\n');
  console.log(`  maxAutoApplyDuration: ${(config.maxAutoApplyDuration / 60000).toFixed(0)} min`);

  console.log('\nUsage:\n');
  console.log('  eamilos learning-config --list');
  console.log('  eamilos learning-config --get <key>');
  console.log('  eamilos learning-config --set key=value');
  console.log('  eamilos learning-config --reset');
  console.log('  eamilos learning-config --export <file>');
  console.log('  eamilos learning-config --import <file>\n');
}

async function listConfig(): Promise<void> {
  const config = await loadConfig();
  console.log(JSON.stringify(config, null, 2));
}

async function getSetting(key: string): Promise<void> {
  const config = await loadConfig();
  const value = (config as unknown as Record<string, unknown>)[key];

  if (value === undefined) {
    console.log('Unknown setting: ' + key);
    console.log('Valid settings: ' + Object.keys(DEFAULT_SETTINGS).join(', '));
    return;
  }

  console.log(key + ' = ' + value);
}

async function setSetting(keyValue: string): Promise<void> {
  const [key, valueStr] = keyValue.split('=');

  if (!key || !valueStr) {
    console.log('Invalid format. Use: key=value');
    return;
  }

  if (!(key in DEFAULT_SETTINGS)) {
    console.log('Unknown setting: ' + key);
    console.log('Valid settings: ' + Object.keys(DEFAULT_SETTINGS).join(', '));
    return;
  }

  const config = await loadConfig();
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(valueStr);
  } catch {
    parsedValue = valueStr;
  }

  (config as unknown as Record<string, unknown>)[key] = parsedValue;
  await saveConfig(config);

  console.log('Updated: ' + key + ' = ' + parsedValue);
}

async function resetConfig(): Promise<void> {
  await saveConfig(DEFAULT_SETTINGS);
  console.log('Configuration reset to defaults');
}

async function exportConfig(filePath: string): Promise<void> {
  const config = await loadConfig();
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  console.log('Exported to: ' + filePath);
}

async function importConfig(filePath: string): Promise<void> {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const imported = JSON.parse(data);
    const config = { ...DEFAULT_SETTINGS, ...imported };
    await saveConfig(config);
    console.log('Imported from: ' + filePath);
  } catch (error) {
    console.log('Failed to import: ' + (error as Error).message);
  }
}
