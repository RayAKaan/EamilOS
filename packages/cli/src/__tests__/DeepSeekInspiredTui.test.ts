import { describe, expect, it } from 'vitest';
import { initialModel } from '../tui/model.js';
import { update } from '../tui/update.js';
import { renderMessage } from '../tui/components/message.js';

function plain(lines: string[]): string {
  return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
}

describe('DeepSeek-inspired TUI presentation', () => {
  it('renders tool calls as bounded semantic cards', () => {
    const model = initialModel(120, 40);
    const started = update(model, { type: 'AGENT_STARTED', agentId: 'codex-cli' });
    const withTool = update(started, { type: 'TOOL_STARTED', agentId: 'codex-cli', tool: 'terminal', args: 'npm test' });
    const rendered = plain(renderMessage(withTool.messages.at(-1)!, 100, 0, 'normal'));
    expect(rendered).toContain('⏱ npm test');
    expect(rendered).toContain('npm test');
  });

  it('supports compact, expanded, and hidden transcript density', () => {
    const model = initialModel(120, 40);
    const started = update(model, { type: 'AGENT_STARTED', agentId: 'codex-cli' });
    const withTool = update(started, { type: 'TOOL_STARTED', agentId: 'codex-cli', tool: 'terminal', args: 'echo hello' });
    const normal = plain(renderMessage(withTool.messages.at(-1)!, 100, 0, 'normal'));
    const hidden = plain(renderMessage(withTool.messages.at(-1)!, 100, 0, 'hidden'));
    expect(normal).toContain('⏱ echo hello');
    expect(hidden).not.toContain('echo hello');
  });

  it('records tool completion and bounded output in session-facing UI state', () => {
    const model = initialModel(120, 40);
    const started = update(model, { type: 'AGENT_STARTED', agentId: 'codex-cli' });
    const running = update(started, { type: 'TOOL_STARTED', agentId: 'codex-cli', tool: 'read', args: 'README.md' });
    const done = update(running, { type: 'TOOL_OUTPUT', agentId: 'codex-cli', tool: 'read', result: 'line 1\nline 2' });
    expect(done.messages.at(-1)!.tools.at(-1)).toMatchObject({ name: 'read', status: 'done', lines: 2 });
  });

  it('cycles transcript density without changing mission state', () => {
    const model = initialModel(120, 40);
    const next = update(model, { type: 'TOGGLE_TRANSCRIPT_DENSITY' });
    expect(next.transcriptDensity).toBe('expanded');
    expect(next.missionState).toBe(model.missionState);
  });
});
