import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
  timestamp: number;
}

interface ChatModeProps {
  bridge: any;
  onSwitchMode: (mode: string) => void;
}

export const ChatMode = ({ bridge, onSwitchMode }: ChatModeProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    if (messages.length > 0) setShowSuggestions(false);
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: text, 
      timestamp: Date.now() 
    }]);
    setInput('');
    setShowSuggestions(false);
    setIsAgentTyping(true);

    try {
      const result = await bridge.createTask(text);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Task created: ${result.taskId}`,
        agent: 'claude-main',
        duration: '1s',
        timestamp: Date.now()
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Error: ${e}`,
        timestamp: Date.now()
      }]);
    }
    
    setIsAgentTyping(false);
  };

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="round" borderColor="gray" paddingX={1} height={1}>
        <Text color="cyan" bold>⚡ EamilOS</Text>
        <Text> | </Text>
        <Text dimColor>Tab: power mode</Text>
      </Box>

      <Box flexGrow={1} borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
        {messages.length === 0 ? (
          <WelcomeMessage />
        ) : (
          <MessageList messages={messages} />
        )}
        
        {isAgentTyping && <TypingIndicator agentName="claude-main" />}
      </Box>

      {showSuggestions && !isAgentTyping && (
        <Box borderStyle="round" borderColor="yellow" padding={1} marginTop={1}>
          <SuggestionChips onSelect={sendMessage} />
        </Box>
      )}

      <Box borderStyle="double" borderColor="green" padding={1} marginTop={1}>
        <ChatInput value={input} onChange={setInput} onSubmit={sendMessage} />
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} height={1}>
        <Text dimColor>Enter: send | Tab: dashboard | h: help | q: quit</Text>
      </Box>
    </Box>
  );
};

const WelcomeMessage = () => (
  <Box flexDirection="column" alignItems="center" justifyContent="center" height="100%">
    <Text bold color="cyan">⚡ EamilOS</Text>
    <Box>
      <Text dimColor>Your AI agent fleet, ready to build.</Text>
    </Box>
    <Text dimColor>Press Tab for power mode.</Text>
  </Box>
);

const MessageList = ({ messages }: { messages: Message[] }) => (
  <Box flexDirection="column">
    {messages.map((msg, i) => (
      <MessageBubble key={i} message={msg} />
    ))}
  </Box>
);

const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const isAgent = message.role === 'assistant';
  
  return (
    <Box marginBottom={1} justifyContent={isUser ? 'flex-end' : 'flex-start'}>
      <Box 
        width="80%" 
        borderStyle={isAgent ? 'round' : 'single'}
        borderColor={isAgent ? 'cyan' : 'green'}
        padding={1}
      >
        <Box>
          {isAgent && <Text color="cyan">🤖 </Text>}
          <Text>{message.content}</Text>
        </Box>
        {isAgent && message.agent && (
          <Box>
            <Text> | </Text>
            <Text dimColor>{message.agent} • {message.duration}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

const TypingIndicator = ({ agentName }: { agentName: string }) => {
  const [dots, setDots] = useState(1);
  
  useEffect(() => {
    const interval = setInterval(() => setDots(d => (d % 3) + 1), 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <Box borderStyle="round" borderColor="gray" padding={1} alignItems="center">
      <Text color="cyan">{agentName}</Text>
      <Text> </Text>
      <Text dimColor>thinking</Text>
      <Text dimColor>{'.'.repeat(dots)}</Text>
    </Box>
  );
};

const ChatInput = ({ value, onChange, onSubmit }: any) => (
  <Box flexDirection="column" width="100%">
    <Box>
      <Text color="green">❯ </Text>
      <Text>{value || '_'}</Text>
    </Box>
  </Box>
);

const SuggestionChips = ({ onSelect }: any) => {
  const suggestions = [
    { label: '🏗️ Build REST API', prompt: 'Build a REST API with Node.js, Express, JWT auth, and tests' },
    { label: '🎨 Create React App', prompt: 'Create a React TypeScript app with routing and state' },
    { label: '🤖 AI Agent System', prompt: 'Build a multi-agent system with coordination' },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Get started:</Text>
      <Box flexWrap="wrap">
        {suggestions.map((s, i) => (
          <Box key={i} borderStyle="round" borderColor="yellow" paddingX={1} marginRight={1}>
            <Text color="yellow" bold>{s.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ChatMode;