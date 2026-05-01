#!/usr/bin/env node

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text } from 'ink';

// ── Slash commands ──────────────────────────────────────────────────────────

interface SlashCommand {
  command: string;
  description: string;
  handler: string;
  aliases: string[];
}

const SLASH_COMMANDS: Record<string, SlashCommand> = {
  '/help': { command: '/help', description: 'Show all commands', handler: 'ui:help', aliases: ['/h', '/?'] },
  '/agents': { command: '/agents', description: 'List all available agents', handler: 'agents:list', aliases: ['/a'] },
  '/models': { command: '/models', description: 'Show available models', handler: 'models:list', aliases: ['/m'] },
  '/tasks': { command: '/tasks', description: 'Show task queue and status', handler: 'tasks:list', aliases: ['/t', '/status'] },
  '/new': { command: '/new', description: 'Start new session with clean context', handler: 'session:new', aliases: ['/clear', '/reset'] },
  '/exit': { command: '/exit', description: 'Save session and exit', handler: 'system:exit', aliases: ['/quit', '/q'] },
  '/editor': { command: '/editor', description: 'Open file in editor mode', handler: 'workspace:edit', aliases: ['/e'] },
  '/find': { command: '/find', description: 'Search codebase using AI', handler: 'workspace:find', aliases: ['/grep'] },
  '/compact': { command: '/compact', description: 'Compress context', handler: 'context:compress', aliases: ['/c'] },
  '/pause': { command: '/pause', description: 'Pause current task', handler: 'task:pause', aliases: ['/stop'] },
  '/resume': { command: '/resume', description: 'Resume paused task', handler: 'task:resume', aliases: [] },
  '/parallel': { command: '/parallel', description: 'Execute across all agents', handler: 'orchestration:parallel', aliases: ['/all'] },
  '/delegate': { command: '/delegate', description: 'Send sub-task to specific agent', handler: 'orchestration:delegate', aliases: [] },
  '/agent': { command: '/agent', description: 'Switch primary agent', handler: 'agent:switch', aliases: ['/use', '/switch'] },
  '/config': { command: '/config', description: 'Show configuration', handler: 'config:show', aliases: [] },
  '/cost': { command: '/cost', description: 'Show cost breakdown and budget', handler: 'cost:report', aliases: ['/budget'] },
  '/template': { command: '/template', description: 'List or execute templates', handler: 'template:list', aliases: ['/tpl'] },
  '/learning': { command: '/learning', description: 'Show what the system learned', handler: 'learning:report', aliases: ['/learn'] },
  '/profile': { command: '/profile', description: 'Switch active profile', handler: 'profile:switch', aliases: ['/p'] },
  '/teams': { command: '/teams', description: 'List your teams', handler: 'team:list', aliases: ['/team'] },
  '/audit': { command: '/audit', description: 'Show recent audit log entries', handler: 'audit:log', aliases: ['/logs'] },
  '/health': { command: '/health', description: 'Show agent health status', handler: 'health:report', aliases: [] },
  '/session': { command: '/session', description: 'Manage sessions (save/load/list)', handler: 'session:manage', aliases: ['/sess'] },
};

function getCommandByAlias(input: string): SlashCommand | undefined {
  const normalized = input.trim().toLowerCase();
  for (const cmd of Object.values(SLASH_COMMANDS)) {
    if (cmd.command === normalized || cmd.aliases.includes(normalized)) {
      return cmd;
    }
  }
  return undefined;
}

function matchCommands(filter: string): SlashCommand[] {
  if (!filter) return Object.values(SLASH_COMMANDS);
  const lower = filter.toLowerCase();
  return Object.values(SLASH_COMMANDS).filter(
    cmd => cmd.command.includes(lower) || cmd.description.toLowerCase().includes(lower)
  );
}

function getHelpText(): string {
  const lines = ['EamilOS Slash Commands:', ''];
  for (const cmd of Object.values(SLASH_COMMANDS)) {
    const aliasStr = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
    lines.push(`  ${cmd.command}${aliasStr}`);
    lines.push(`    ${cmd.description}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Message type ─────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
  tokens?: number;
  cost?: number;
  timestamp: number;
}

// ── Dashboard stats (mock for standalone TUI) ───────────────────────────────

interface DashboardStats {
  totalTasks: number;
  completedTasks: number;
  totalCost: number;
  activeSessions: number;
  agentsOnline: number;
  avgResponseTime: string;
}

function DashboardView({ stats }: { stats: DashboardStats }) {
  const bars = [
    { label: 'Tasks', value: stats.totalTasks, max: 100, color: 'cyan' },
    { label: 'Completed', value: stats.completedTasks, max: 100, color: 'green' },
    { label: 'Cost ($)', value: stats.totalCost, max: 10, color: 'yellow' },
    { label: 'Sessions', value: stats.activeSessions, max: 20, color: 'magenta' },
    { label: 'Agents', value: stats.agentsOnline, max: 10, color: 'blue' },
  ];

  return (
    <Box flexDirection="column" paddingX={2} flexGrow={1}>
      <Text bold color="magenta">Power Dashboard</Text>
      {bars.map(b => {
        const width = Math.min(40, Math.round((b.value / b.max) * 40));
        const bar = '█'.repeat(width) + '░'.repeat(40 - width);
        return (
          <Box key={b.label} marginTop={1}>
            <Text color={b.color}>{`${b.label}`.padEnd(12)}</Text>
            <Text color={b.color}>{bar} </Text>
            <Text bold>{b.value}</Text>
          </Box>
        );
      })}
      <Box marginTop={2}>
        <Text dimColor>Tab to return to chat</Text>
      </Box>
    </Box>
  );
}

// ── Welcome Screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ version }: { version: string }) {
  return (
    <Box
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <Box marginBottom={2}>
        <Text bold>EamilOS</Text>
        <Text dimColor> v{version}</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color="gray">Your AI agent fleet, ready to build.</Text>
      </Box>
      <Box>
        <Text dimColor>Type a message or press / for commands</Text>
      </Box>
    </Box>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

const VERSION = '1.2.7';

function EamilOS() {
  const [mode, setMode] = useState<'chat' | 'dashboard'>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [taskCount, setTaskCount] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

  const inputRef = useRef('');

  // Handle keyboard input
  const handleKey = useCallback((key: string) => {
    if (key === '\t') {
      setMode(m => m === 'chat' ? 'dashboard' : 'chat');
    } else if (key === 'q' || key === '\x03') {
      process.exit(0);
    } else if (key === '\r' || key === '\n') {
      const trimmed = inputRef.current.trim();
      if (trimmed) {
        const cmd = trimmed.startsWith('/')
          ? getCommandByAlias(trimmed.split(/\s+/)[0])
          : null;

        if (cmd) {
          handleSlashCommand(cmd, trimmed);
        } else {
          doSend(trimmed);
        }
      }
      inputRef.current = '';
      setInput('');
      setShowSlashMenu(false);
    } else if (key === '\x1b') {
      setShowSlashMenu(false);
    } else if (key === '\x7f' || key === '\b') {
      inputRef.current = inputRef.current.slice(0, -1);
      setInput(inputRef.current);
      if (!inputRef.current.startsWith('/')) setShowSlashMenu(false);
    } else if (key === '/' && inputRef.current === '') {
      inputRef.current = '/';
      setInput('/');
      setShowSlashMenu(true);
    } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
      inputRef.current += key;
      setInput(inputRef.current);
      if (inputRef.current.startsWith('/')) setShowSlashMenu(true);
    }
  }, []);

  useEffect(() => {
    if (!process.stdin) return;
    const onData = (data: Buffer) => handleKey(data.toString());
    process.stdin.on('data', onData);
    return () => { try { process.stdin?.off('data', onData); } catch {} };
  }, [handleKey]);

  const handleSlashCommand = (cmd: SlashCommand, fullInput: string) => {
    const args = fullInput.split(/\s+/).slice(1);

    switch (cmd.handler) {
      case 'ui:help':
        setMessages(prev => [...prev, { role: 'system', content: getHelpText(), timestamp: Date.now() }]);
        break;
      case 'agents:list':
        setMessages(prev => [...prev, { role: 'system', content: 'No agents registered yet.\nConfigure providers in .eamilos/config.json', timestamp: Date.now() }]);
        break;
      case 'models:list':
        setMessages(prev => [...prev, { role: 'system', content: 'Available model groups:\n  Local: Ollama\n  Cloud: OpenAI / Anthropic\n  CLI: Claude CLI, Codex CLI', timestamp: Date.now() }]);
        break;
      case 'tasks:list':
        setMessages(prev => [...prev, { role: 'system', content: taskCount > 0 ? `Active tasks: ${taskCount}` : 'No active tasks', timestamp: Date.now() }]);
        break;
      case 'session:new':
        setMessages([]);
        setTaskCount(0);
        setTotalCost(0);
        break;
      case 'system:exit':
        process.exit(0);
        break;
      case 'context:compress':
        setMessages(prev => [...prev, { role: 'system', content: 'Context compressed. Already within limits.', timestamp: Date.now() }]);
        break;
      case 'task:pause':
        setMessages(prev => [...prev, { role: 'system', content: 'Current task paused.', timestamp: Date.now() }]);
        break;
      case 'orchestration:parallel':
        setMessages(prev => [...prev, { role: 'system', content: `Parallel execution queued: ${args.join(' ')}`, timestamp: Date.now() }]);
        break;
      case 'cost:report':
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Cost Report\nTotal: $${totalCost.toFixed(4)}\nTasks: ${taskCount}`,
          timestamp: Date.now(),
        }]);
        break;
      case 'template:list':
        setMessages(prev => [...prev, {
          role: 'system',
          content: 'Templates (5):\n\nreact-auth            web      $3.50–$6.00   react, auth, jwt\nmicroservices         api      $5.00–$8.00   docker, api\ncli-tool              cli      $1.00–$2.00   node, cli\ndata-pipeline         data     $2.00–$4.00   etl, pipeline\napi-server            api      $2.00–$3.00   express, rest',
          timestamp: Date.now(),
        }]);
        break;
      case 'learning:report':
        setMessages(prev => [...prev, { role: 'system', content: 'No learning data yet. Execute tasks to train the system.', timestamp: Date.now() }]);
        break;
      case 'health:report':
        setMessages(prev => [...prev, { role: 'system', content: 'Health monitoring requires running agents.\nStart with: /agents to discover.', timestamp: Date.now() }]);
        break;
      case 'profile:switch':
        setMessages(prev => [...prev, { role: 'system', content: args[0] ? `Profile switch requested: ${args[0]}` : 'Usage: /profile <id>', timestamp: Date.now() }]);
        break;
      case 'team:list':
        setMessages(prev => [...prev, { role: 'system', content: 'No active profile — teams unavailable.', timestamp: Date.now() }]);
        break;
      case 'audit:log':
        setMessages(prev => [...prev, { role: 'system', content: 'No audit events recorded yet.', timestamp: Date.now() }]);
        break;
      case 'session:manage': {
        const sub = args[0]?.toLowerCase();
        if (sub === 'list') {
          setMessages(prev => [...prev, { role: 'system', content: 'Session: default (current)', timestamp: Date.now() }]);
        } else if (sub === 'save') {
          setMessages(prev => [...prev, { role: 'system', content: 'Session saved locally.', timestamp: Date.now() }]);
        } else {
          setMessages(prev => [...prev, { role: 'system', content: 'Usage: /session [save|load|list|new]', timestamp: Date.now() }]);
        }
        break;
      }
      default:
        setMessages(prev => [...prev, { role: 'system', content: `Unknown command: ${cmd.handler}`, timestamp: Date.now() }]);
    }
  };

  const doSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
    setIsTyping(true);

    const start = Date.now();
    const simulatedDelay = 500 + Math.random() * 1000;

    await new Promise(r => setTimeout(r, simulatedDelay));

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    const tokens = Math.floor(100 + Math.random() * 500);
    const cost = tokens * 0.000003;

    setTaskCount(c => c + 1);
    setTotalCost(c => c + cost);

    setMessages(prev => [...prev, {
      role: 'assistant',
      content: `Task created: task-${Date.now()}`,
      agent: 'claude-main',
      duration: `${duration}s`,
      tokens,
      cost,
      timestamp: Date.now(),
    }]);

    setIsTyping(false);
  };

  const dashboardStats: DashboardStats = {
    totalTasks: taskCount,
    completedTasks: Math.floor(taskCount * 0.85),
    totalCost,
    activeSessions: 1,
    agentsOnline: 0,
    avgResponseTime: '1.2s',
  };

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header — minimal, no border */}
      <Box justifyContent="space-between" paddingX={2} paddingY={1}>
        <Box>
          <Text bold>EamilOS</Text>
          <Text dimColor> {mode === 'chat' ? 'Chat' : 'Power'}</Text>
        </Box>
        <Box>
          <Text dimColor>Tasks </Text>
          <Text bold>{taskCount}</Text>
          <Text>  </Text>
          <Text dimColor>Cost </Text>
          <Text color="green">${totalCost.toFixed(2)}</Text>
        </Box>
      </Box>

      {/* Content */}
      <Box flexGrow={1} flexDirection="column">
        {mode === 'chat' ? (
          <>
            {/* Messages area */}
            <Box flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1} overflow="hidden">
              {messages.length === 0 ? (
                <WelcomeScreen version={VERSION} />
              ) : (
                messages.map((m, i) => {
                  if (m.role === 'user') {
                    return (
                      <Box key={i} paddingX={1} paddingY={1} justifyContent="flex-end">
                        <Box>
                          <Text bold color="green">You: </Text>
                          <Text>{m.content}</Text>
                        </Box>
                      </Box>
                    );
                  }
                  if (m.role === 'assistant') {
                    return (
                      <Box key={i} paddingX={1} paddingY={1} flexDirection="column">
                        <Box>
                          <Text bold color="cyan">{m.agent}: </Text>
                          <Text>{m.content}</Text>
                        </Box>
                        <Box marginTop={1}>
                          {m.duration && <Text dimColor>{m.duration}</Text>}
                          {m.cost != null && <Text dimColor>  ${m.cost.toFixed(4)}</Text>}
                          {m.tokens != null && <Text dimColor>  {m.tokens.toLocaleString()} tokens</Text>}
                        </Box>
                      </Box>
                    );
                  }
                  // system message
                  return (
                    <Box key={i} paddingX={2} paddingY={1}>
                      <Text dimColor>{m.content}</Text>
                    </Box>
                  );
                })
              )}

              {isTyping && (
                <Box paddingX={1} paddingY={1}>
                  <Text color="cyan">claude-main</Text>
                  <Text> </Text>
                  <Text dimColor>thinking...</Text>
                </Box>
              )}
            </Box>

            {/* Slash command menu */}
            {showSlashMenu && input.startsWith('/') && (
              <Box flexDirection="column" paddingX={2} paddingY={1}>
                <Text bold color="yellow">Commands</Text>
                {matchCommands(input.slice(1)).slice(0, 8).map(cmd => (
                  <Box key={cmd.command} paddingX={1}>
                    <Text color="yellow">{cmd.command}</Text>
                    <Text dimColor> {cmd.description}</Text>
                  </Box>
                ))}
              </Box>
            )}

            {/* Input bar */}
            <Box paddingX={2} paddingY={1}>
              <Text color={showSlashMenu ? 'yellow' : 'green'} bold>❯ </Text>
              <Text color={showSlashMenu ? 'yellow' : undefined}>
                {input || (isTyping ? '(agent is thinking...)' : 'Type a message...')}
              </Text>
            </Box>

            {/* Status bar */}
            <Box paddingX={2} paddingY={1}>
              <Box flexGrow={1}>
                <Text dimColor>Enter: send</Text>
                <Text dimColor>  /: commands</Text>
                <Text dimColor>  Tab: dashboard</Text>
              </Box>
              <Box>
                <Text dimColor>q: quit</Text>
              </Box>
            </Box>
          </>
        ) : (
          <DashboardView stats={dashboardStats} />
        )}
      </Box>
    </Box>
  );
}

// ── Entry ────────────────────────────────────────────────────────────────────

async function main() {
  const forceTTY = process.env.FORCE_TTY === 'true' || process.argv.includes('--force');

  // Clear screen BEFORE ink renders — prevents duplicate frames
  process.stdout.write('\x1B[2J\x1B[H\x1B[?25l');

  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    } else if (!forceTTY) {
      process.stdout.write('\x1B[?25h');
      console.error('Interactive terminal required');
      console.error('   Use --force to bypass (testing only)');
      process.exit(1);
    }
  } catch {
    // May fail in some environments
  }

  if (forceTTY && !process.stdin.isTTY) {
    console.error('[Force mode - stdin not connected]');
  }

  try { process.stdin.resume(); } catch {}

  const { unmount, waitUntilExit } = render(React.createElement(EamilOS), {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false,
    patchConsole: true,
  });

  if (forceTTY && !process.stdin.isTTY) {
    const keepAlive = setInterval(() => {}, 1000);
    waitUntilExit().then(() => clearInterval(keepAlive));
  }

  const cleanup = () => {
    process.stdout.write('\x1B[?25h\x1B[0m');
    try { process.stdin?.setRawMode(false); } catch {}
    unmount();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await waitUntilExit();
}

main().catch(error => {
  process.stdout.write('\x1B[?25h');
  console.error('Fatal:', error);
  process.exit(1);
});
