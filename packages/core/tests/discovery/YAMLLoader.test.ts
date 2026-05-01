import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YAMLLoader } from '../../src/discovery/YAMLLoader.js';

describe('YAMLLoader', () => {
  let loader: YAMLLoader;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.homedir(), '.eamilos', 'agents');
    fs.mkdirSync(testDir, { recursive: true });
    loader = new YAMLLoader();
  });

  afterEach(() => {
    try {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('creates loader successfully', () => {
    expect(loader).toBeDefined();
  });

  it('loads no agents when directory is empty', async () => {
    const agents = await loader.loadAgents();
    expect(agents).toEqual([]);
  });

  it('loads valid YAML agent definitions', async () => {
    const yamlContent = `id: test-agent
name: Test Agent
type: custom
capabilities:
  - code
  - analysis
systemPrompt: "You are a test agent."
preferredTier: strong
`;
    fs.writeFileSync(path.join(testDir, 'test-agent.yml'), yamlContent);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('test-agent');
    expect(agents[0].name).toBe('Test Agent');
    expect(agents[0].source).toBe('custom');
    expect(agents[0].capabilities).toEqual(['code', 'analysis']);
    expect(agents[0].preferredTier).toBe('strong');
  });

  it('loads .yaml files in addition to .yml', async () => {
    const yamlContent = `id: yaml-agent
name: YAML Agent
type: custom
capabilities:
  - writing
`;
    fs.writeFileSync(path.join(testDir, 'yaml-agent.yaml'), yamlContent);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('yaml-agent');
  });

  it('skips invalid YAML files gracefully', async () => {
    fs.writeFileSync(path.join(testDir, 'valid.yml'), `id: valid
name: Valid Agent
type: custom
`);
    fs.writeFileSync(path.join(testDir, 'invalid.yml'), `not a valid agent file
`);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('valid');
  });

  it('skips files without id or name', async () => {
    fs.writeFileSync(path.join(testDir, 'no-id.yml'), `name: No ID Agent
type: custom
`);
    fs.writeFileSync(path.join(testDir, 'no-name.yml'), `id: no-name
type: custom
`);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(0);
  });

  it('applies defaults for missing optional fields', async () => {
    const yamlContent = `id: minimal
name: Minimal Agent
`;
    fs.writeFileSync(path.join(testDir, 'minimal.yml'), yamlContent);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].role).toBe('custom');
    expect(agents[0].capabilities).toEqual(['general']);
    expect(agents[0].preferredTier).toBe('strong');
    expect(agents[0].maxTokens).toBe(4096);
    expect(agents[0].temperature).toBe(0.2);
    expect(agents[0].maxRetries).toBe(3);
    expect(agents[0].timeoutSeconds).toBe(300);
  });

  it('respects custom settings from YAML', async () => {
    const yamlContent = `id: custom-settings
name: Custom Settings Agent
maxTokens: 8192
temperature: 0.8
maxRetries: 5
timeoutSeconds: 600
permissions:
  fileRead: false
  commandExecute: true
`;
    fs.writeFileSync(path.join(testDir, 'custom.yml'), yamlContent);

    const agents = await loader.loadAgents();
    expect(agents[0].maxTokens).toBe(8192);
    expect(agents[0].temperature).toBe(0.8);
    expect(agents[0].maxRetries).toBe(5);
    expect(agents[0].timeoutSeconds).toBe(600);
    expect(agents[0].permissions.fileRead).toBe(false);
    expect(agents[0].permissions.commandExecute).toBe(true);
  });

  it('loads multiple agents', async () => {
    fs.writeFileSync(path.join(testDir, 'agent1.yml'), `id: agent1
name: Agent One
`);
    fs.writeFileSync(path.join(testDir, 'agent2.yml'), `id: agent2
name: Agent Two
`);
    fs.writeFileSync(path.join(testDir, 'agent3.yaml'), `id: agent3
name: Agent Three
`);

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(3);
  });

  it('creates a template agent file', async () => {
    const filePath = await loader.createTemplate('My Custom Agent');
    expect(filePath).toContain('my-custom-agent.yml');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('id: my-custom-agent');
    expect(content).toContain('name: My Custom Agent');
  });

  it('ignores non-YAML files in directory', async () => {
    fs.writeFileSync(path.join(testDir, 'agent.yml'), `id: agent
name: Agent
`);
    fs.writeFileSync(path.join(testDir, 'readme.md'), '# Readme');
    fs.writeFileSync(path.join(testDir, 'config.json'), '{}');

    const agents = await loader.loadAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe('agent');
  });
});
