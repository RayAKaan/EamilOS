import { describe, expect, it } from 'vitest';
import { classifyTool, renderToolCard, renderToolGroup } from './toolCards.js';

const tool = (name: string, result = '') => ({ name, args: 'src/example.ts', status: 'done' as const, result, lines: result ? result.split(/\r?\n/).length : 0 });

describe('phase 2 tool cards', () => {
  it('classifies the four specialized card types', () => {
    expect(classifyTool('exec').kind).toBe('terminal');
    expect(classifyTool('apply_diff').kind).toBe('diff');
    expect(classifyTool('run_tests').kind).toBe('test');
    expect(classifyTool('request_approval').kind).toBe('approval');
  });

  it('renders terminal output with command and result', () => {
    const lines = renderToolCard(tool('exec', 'hello\nworld'), 80, 0, 'expanded');
    expect(lines.some(line => line.includes('$ src/example.ts'))).toBe(true);
    expect(lines.some(line => line.includes('hello'))).toBe(true);
  });

  it('renders diff output without losing +/- lines', () => {
    const lines = renderToolCard(tool('apply_diff', '+new\n-old\n@@ section'), 80, 0, 'expanded');
    expect(lines.some(line => line.includes('+new'))).toBe(true);
    expect(lines.some(line => line.includes('-old'))).toBe(true);
  });

  it('renders test and approval states', () => {
    expect(renderToolCard(tool('run_tests', '3 passed'), 80, 0, 'normal').join('\n')).toContain('3 passed');
    expect(renderToolCard({ ...tool('request_approval'), status: 'running' }, 80, 0, 'normal').join('\n')).toContain('Awaiting approval decision');
  });

  it('folds read-only output into a compact summary', () => {
    const lines = renderToolGroup([tool('read_file'), tool('grep'), tool('read_file')], 100, 0);
    expect(lines.join('\n')).toContain('3 read-only calls');
    expect(lines.join('\n')).toContain('Ctrl+O');
  });
});
