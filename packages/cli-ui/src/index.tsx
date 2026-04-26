#!/usr/bin/env node

import React, { useState, useEffect, useRef } from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';

// Constants - FIXED DIMENSIONS
const HEADER_HEIGHT = 2;
const FOOTER_HEIGHT = 1;
const MODE_INDICATOR_HEIGHT = 1;

// Inline bridge
class InlineBridge {
  constructor() {}
  async initialize() {
    console.error('[Bridge] Mock mode');
  }
  async createTask(input: string) {
    return { taskId: `task-${Date.now()}` };
  }
  async shutdown() {}
}

const bridge = new InlineBridge();
bridge.initialize();

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
}

function EamilOS() {
  const [mode, setMode] = useState<'chat' | 'dashboard'>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [renderCount, setRenderCount] = useState(0);
  
  const inputRef = useRef('');

  // CRITICAL: Clear screen ONCE on mount only
  useEffect(() => {
    process.stdout.write('\x1Bc');
    setRenderCount(c => c + 1);
  }, []); // Empty array = run once on mount

  // CRITICAL: Keyboard handler - run once on mount
  useEffect(() => {
    if (!process.stdin) return;
    
    const onData = (data: Buffer) => {
      const key = data.toString();
      
      if (key === '\t') {
        setMode(m => m === 'chat' ? 'dashboard' : 'chat');
      } else if (key === 'q' || key === '\x03') {
        process.exit(0);
      } else if (key === '\r' || key === '\n') {
        if (inputRef.current.trim()) {
          doSend(inputRef.current);
          inputRef.current = '';
          setInput('');
        }
      } else if (key === '\x7f' || key === '\b') {
        inputRef.current = inputRef.current.slice(0, -1);
        setInput(inputRef.current);
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        inputRef.current += key;
        setInput(inputRef.current);
      }
    };

    process.stdin.on('data', onData);
    return () => {
      try { process.stdin?.off('data', onData); } catch {}
    };
  }, []);

  const doSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsTyping(true);
    
    try {
      const result = await bridge.createTask(text);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Task created: ${result.taskId}`,
        agent: 'claude-main',
        duration: '1s'
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { 
        role: 'system', 
        content: `Error: ${e?.message || String(e)}` 
      }]);
    }
    
    setIsTyping(false);
  };

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* HEADER - border bottom ONLY */}
      <Box width="100%" height={HEADER_HEIGHT} borderStyle="single" borderColor="gray">
        <Box justifyContent="space-between" width="100%" paddingX={1}>
          <Text color="cyan" bold>⚡ EamilOS v1.0</Text>
          <Text dimColor>Mode: {mode}</Text>
          <Text dimColor>R{renderCount}</Text>
        </Box>
      </Box>

      {/* MODE INDICATOR - NO BORDER */}
      <Box width="100%" height={MODE_INDICATOR_HEIGHT}>
        <Text color="magenta" bold>{mode === 'chat' ? '💬 Chat Mode' : '🔧 Power Mode'}</Text>
        <Text> | Tab to switch</Text>
      </Box>

      {/* CONTENT - NO BORDERS, just padding */}
      <Box flexGrow={1} flexDirection="column" padding={1}>
        {mode === 'chat' ? (
          <>
            {/* Messages area - border sides only */}
            <Box flexGrow={1} borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
              {messages.length === 0 ? (
                <Box alignItems="center" justifyContent="center" flexGrow={1}>
                  <Box flexDirection="column" alignItems="center">
                    <Text bold color="cyan">⚡ EamilOS</Text>
                    <Text>Your AI agent fleet, ready to build.</Text>
                    <Text dimColor>Type and press Enter</Text>
                  </Box>
                </Box>
              ) : (
                <Box flexDirection="column">
                  {messages.map((m, i) => (
                    <Box key={i} justifyContent={m.role === 'user' ? 'flex-end' : 'flex-start'} marginBottom={1}>
                      <Box 
                        width="80%" 
                        borderStyle={m.role === 'assistant' ? 'round' : 'single'} 
                        borderColor={m.role === 'assistant' ? 'cyan' : 'green'} 
                        padding={1}
                      >
                        {m.role === 'assistant' && <Text color="cyan">🤖 </Text>}
                        <Text>{m.content}</Text>
                        {m.agent && <Text dimColor> | {m.agent} • {m.duration}</Text>}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* Input - FULL BORDER HERE ONLY */}
            <Box marginTop={1} borderStyle="double" borderColor="green" padding={1}>
              <Text color="green">❯ </Text>
              <Text>{input || '_'}</Text>
            </Box>
          </>
        ) : (
          <Box alignItems="center" justifyContent="center" flexGrow={1} borderStyle="round" borderColor="cyan" padding={1}>
            <Box flexDirection="column" alignItems="center">
              <Text bold color="magenta">🔧 Power Mode</Text>
              <Text>Press Tab to return to chat</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* FOOTER - border top ONLY */}
      <Box width="100%" height={FOOTER_HEIGHT} borderStyle="single" borderColor="gray">
        <Box justifyContent="space-between" width="100%" paddingX={1}>
          <Text dimColor>Enter: send | Tab: mode | h: help</Text>
          <Text dimColor>q: quit</Text>
        </Box>
      </Box>
    </Box>
  );
}

async function main() {
  // Allow bypass for testing or use force flag
  const forceTTY = process.env.FORCE_TTY === 'true' || process.argv.includes('--force');
  
  // Try to set raw mode if TTY available
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    } else if (!forceTTY) {
      console.error('❌ Interactive terminal required');
      console.error('   Use --force to bypass (testing only)');
      process.exit(1);
    }
  } catch {
    // May fail in some environments
  }

  const { waitUntilExit } = render(React.createElement(EamilOS), {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false
  });

  const cleanup = async () => {
    process.stdout.write('\x1B[?25h');
    process.stdin?.setRawMode(false);
    bridge.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await waitUntilExit();
}

main().catch((error) => {
  process.stdout.write('\x1B[?25h');
  console.error('Fatal:', error);
  process.exit(1);
});