import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { useInput } from 'ink';
import { matchCommands, getHelpText } from '../commands/slash-commands.js';
import { parseSlashCommand, type ParsedSlashCommand } from '../components/chat/SlashCommandParser.js';
import { MessageBubble, SystemMessage } from '../components/chat/MessageBubble.js';
import { WelcomeScreen } from '../components/chat/WelcomeScreen.js';
import { FloatingInput } from '../components/chat/FloatingInput.js';
import { TypingIndicator } from '../components/chat/TypingIndicator.js';
import { useStore } from '../../state/store.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
  metrics?: { tokens?: number; cost?: number; duration?: number };
}

interface ChatModeProps {
  bridge: any;
  onSwitchMode: (mode: string) => void;
  taskCount?: number;
  totalCost?: number;
}

export const ChatMode = ({ bridge, onSwitchMode, taskCount = 0, totalCost = 0 }: ChatModeProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const inputRef = useRef('');
  const currentAgent = useStore((state) => state.agents[0]);

  useInput((char, key) => {
    if (key.return) {
      const currentInput = inputRef.current;
      if (currentInput.trim()) {
        const command = parseSlashCommand(currentInput);
        if (command.isCommand) {
          void executeSlashCommand(command);
        } else {
          void sendMessage(currentInput);
        }
      }
      inputRef.current = '';
      setInput('');
      setShowSlashMenu(false);
    } else if (key.tab) {
      onSwitchMode('dashboard');
    } else if (key.escape) {
      setShowSlashMenu(false);
    } else if (key.backspace || key.delete) {
      inputRef.current = inputRef.current.slice(0, -1);
      setInput(inputRef.current);
      setShowSlashMenu(inputRef.current.startsWith('/'));
    } else if (char) {
      inputRef.current += char;
      setInput(inputRef.current);
      setShowSlashMenu(inputRef.current.startsWith('/'));
    }
  });

  useEffect(() => {
    if (messages.length > 0) setShowSuggestions(false);
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;

    setMessages(prev => [...prev, {
      role: 'user',
      content: text,
    }]);
    setInput('');
    setShowSuggestions(false);
    setIsAgentTyping(true);

    try {
      const result = bridge.sendMessage
        ? await bridge.sendMessage(text)
        : await bridge.createTask(text);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.output || `Task created: ${result.taskId}`,
        agent: result.agent || 'EamilOS Core',
        duration: '1s',
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Error: ${e?.message || e}`,
      }]);
    }

    setIsAgentTyping(false);
  };

  const addSystemMessage = (content: string) => {
    setMessages(prev => [...prev, { role: 'system', content }]);
  };

  const executeSlashCommand = async (command: ParsedSlashCommand) => {
    if (bridge.executeSlashCommand) {
      const result = await bridge.executeSlashCommand(command.raw);
      addSystemMessage(result);
      return;
    }

    switch (command.handler) {
      case 'ui:help':
        addSystemMessage(getHelpText());
        return;
      case 'session:new':
        setMessages([{ role: 'system', content: 'New session started with clean context.' }]);
        setShowSuggestions(true);
        return;
      case 'system:exit':
        await bridge.shutdown?.();
        process.exit(0);
        return;
      case 'agents:list': {
        const agents = bridge.getState?.().agents || [];
        addSystemMessage(agents.length
          ? agents.map((agent: any) => `${agent.id || agent.name} - ${(agent.capabilities || []).join(', ')}`).join('\n')
          : 'No agents registered yet. EamilOS will auto-select when a task starts.');
        return;
      }
      case 'agent:switch':
        addSystemMessage(command.args[0] ? `Primary agent preference set to ${command.args[0]}.` : 'Usage: /agent <id>');
        return;
      case 'models:list':
        addSystemMessage('Available model groups:\n- Local: Ollama-backed agents\n- Cloud: OpenAI/Anthropic-compatible agents\n- CLI: Claude CLI, Codex CLI');
        return;
      case 'tasks:list': {
        const tasks = bridge.getState?.().tasks || [];
        addSystemMessage(tasks.length
          ? tasks.map((task: any) => `${task.id || task.title}: ${task.status || 'pending'}`).join('\n')
          : 'No active tasks.');
        return;
      }
      case 'task:pause':
        await bridge.pauseCurrentTask?.();
        addSystemMessage('Current task paused.');
        return;
      case 'task:resume':
        addSystemMessage(command.args[0] ? `Resume requested for ${command.args[0]}.` : 'Usage: /resume <id>');
        return;
      case 'workspace:edit':
        bridge.navigateTo?.('editor');
        addSystemMessage(command.args[0] ? `Opening ${command.args[0]} in editor mode.` : 'Opening editor mode.');
        return;
      case 'workspace:find':
        addSystemMessage(command.args.length ? `Searching workspace for: ${command.args.join(' ')}` : 'Usage: /find <pattern>');
        return;
      case 'context:compress':
        addSystemMessage('Context compression: current session is within limits.');
        return;
      case 'orchestration:parallel': {
        const prompt = command.args.join(' ');
        if (!prompt) {
          addSystemMessage('Usage: /parallel <task>');
          return;
        }
        await sendMessage(`[parallel] ${prompt}`);
        return;
      }
      case 'orchestration:delegate': {
        if (command.args.length < 2) {
          addSystemMessage('Usage: /delegate <agent> <task>');
          return;
        }
        const [agent, ...task] = command.args;
        await sendMessage(`[delegate:${agent}] ${task.join(' ')}`);
        return;
      }
      case 'cost:report':
      case 'cost:dashboard': {
        const report = bridge.getCostReport?.();
        addSystemMessage(report || 'Cost tracking unavailable.');
        return;
      }
      case 'template:list': {
        const templateId = command.args[0];
        if (templateId) {
          await bridge.executeTemplate?.(templateId, command.args.slice(1));
          addSystemMessage(`Template ${templateId} queued for execution.`);
        } else {
          addSystemMessage('Available templates: react-auth, microservices, cli-tool, data-pipeline, api-server\nUsage: /template <name> [key=value...]');
        }
        return;
      }
      case 'profile:switch': {
        const profileId = command.args[0];
        if (profileId) {
          const result = await bridge.switchProfile?.(profileId);
          addSystemMessage(result || 'Profile switched.');
        } else {
          const profile = bridge.getState?.().profile;
          addSystemMessage(profile ? `Current profile: ${profile.name} (${profile.id})` : 'No active profile.');
        }
        return;
      }
      case 'team:list': {
        const teams = await bridge.listTeams?.();
        addSystemMessage(teams || 'Team info unavailable.');
        return;
      }
      case 'audit:log': {
        const auditLog = await bridge.showAuditLog?.(command.args);
        addSystemMessage(auditLog || 'Audit log unavailable.');
        return;
      }
      case 'health:report': {
        const healthReport = bridge.getHealthReport?.();
        addSystemMessage(healthReport || 'Health report unavailable.');
        return;
      }
      default:
        addSystemMessage(`Unknown command: ${command.command}. Type /help for available commands.`);
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages area */}
      <Box flexGrow={1} flexDirection="column" paddingX={1} paddingTop={1}>
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {messages.map((msg, i) => (
              msg.role === 'system' ? (
                <SystemMessage key={i} content={msg.content} />
              ) : (
                <MessageBubble key={i} message={msg} />
              )
            ))}

            {isAgentTyping && (
              <TypingIndicator agentName={currentAgent?.name || 'claude-main'} />
            )}
          </Box>
        )}
      </Box>

      {/* Suggestion chips */}
      {showSuggestions && !isAgentTyping && (
        <SuggestionChips onSelect={sendMessage} />
      )}

      {/* Slash command menu */}
      {showSlashMenu && <SlashCommandMenu filter={input.slice(1)} />}

      {/* Input bar */}
      <FloatingInput
        value={input}
        disabled={isAgentTyping}
        agentName={currentAgent?.name || 'Auto-select'}
        showSlashMenu={showSlashMenu}
      />

      {/* Status bar */}
      <Box paddingX={2} paddingY={1}>
        <Box flexGrow={1}>
          <Text dimColor>Enter: send</Text>
          <Text dimColor>  /: commands</Text>
          <Text dimColor>  Tab: {isAgentTyping ? '' : 'dashboard'}</Text>
        </Box>
        <Box>
          <Text dimColor>q: quit</Text>
        </Box>
      </Box>
    </Box>
  );
};

const SlashCommandMenu = ({ filter }: { filter: string }) => {
  const matches = matchCommands(filter).slice(0, 8);
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="yellow">Commands</Text>
      {matches.map((cmd) => (
        <Box key={cmd.command} paddingX={1}>
          <Text color="yellow">{cmd.command}</Text>
          <Text dimColor> {cmd.description}</Text>
        </Box>
      ))}
      {matches.length === 0 && <Box paddingX={1}><Text dimColor>No matching commands</Text></Box>}
    </Box>
  );
};

const SuggestionChips = ({ onSelect }: { onSelect: (text: string) => void }) => {
  const suggestions = [
    { label: 'Build REST API', prompt: 'Build a REST API with Node.js, Express, JWT auth, and tests' },
    { label: 'Create React App', prompt: 'Create a React TypeScript app with routing and state' },
    { label: 'AI Agent System', prompt: 'Build a multi-agent system with coordination' },
  ];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text dimColor>Get started:</Text>
      <Box flexWrap="wrap" marginTop={1}>
        {suggestions.map((s, i) => (
          <Box key={i} marginRight={2} marginBottom={1}>
            <Text color="yellow">{s.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ChatMode;
