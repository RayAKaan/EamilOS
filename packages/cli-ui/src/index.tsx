#!/usr/bin/env node

import React, { useState, useEffect, useMemo } from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { createBridge } from './bridge.js';

// Layout constants
const LAYOUT = {
  headerHeight: 1,
  footerHeight: 1,
  sidebarWidth: 35,
  minWidthForSidebar: 80,
};

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
}

// Initialize bridge ONCE
const bridge = createBridge({ mockMode: true });
bridge.initialize().catch(e => console.error('[Bridge] Init error:', e));

function EamilOS() {
  const [mode, setMode] = useState<'chat' | 'dashboard'>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    process.stdin?.setRawMode(true);
    process.stdin?.resume();
  }, []);

  useEffect(() => {
    if (!process.stdin) return;
    
    const onData = (data: Buffer) => {
      const key = data.toString();
      
      if (key === '\t') {
        setMode(m => m === 'chat' ? 'dashboard' : 'chat');
      } else if (key === 'q' || key === '\x03') {
        process.exit(0);
      } else if (key === '\r' || key === '\n') {
        if (input.trim()) {
          doSend(input);
          setInput('');
        }
      } else if (key === '\x7f' || key === '\b') {
        setInput(s => s.slice(0, -1));
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        setInput(s => s + key);
      }
    };

    process.stdin.on('data', onData);
    return () => {
      try { process.stdin?.off('data', onData); } catch {}
    };
  }, [input]);

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

  // Memoize layout calculations
  const layout = useMemo(() => ({
    canShowSidebar: mode === 'dashboard' && false, // Always false for now
  }), [mode]);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* HEADER - single line */}
      <Box height={LAYOUT.headerHeight}>
        <Box borderStyle="single" borderColor="gray" paddingX={1} height={1}>
          <Box justifyContent="space-between" width="100%">
            <Text color="cyan" bold>⚡ EamilOS v1.0</Text>
            <Text dimColor>Mode: {mode}</Text>
            <Text dimColor>Tab: switch | q: quit</Text>
          </Box>
        </Box>
      </Box>

      {/* MAIN CONTENT */}
      <Box flexGrow={1} flexDirection="column">
        {mode === 'chat' ? (
          // CHAT MODE
          <Box flexDirection="column" flexGrow={1}>
            {/* Messages area */}
            <Box flexGrow={1} borderStyle="round" borderColor="cyan" padding={1}>
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
                      <Box width="80%" borderStyle={m.role === 'assistant' ? 'round' : 'single'} borderColor={m.role === 'assistant' ? 'cyan' : 'green'} padding={1}>
                        {m.role === 'assistant' && <Text color="cyan">🤖 </Text>}
                        <Text>{m.content}</Text>
                        {m.agent && <Text dimColor> | {m.agent} • {m.duration}</Text>}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* Suggestions */}
            {messages.length === 0 && !isTyping && (
              <Box paddingX={1}>
                <Text bold>Quick:</Text>
                <Text> </Text>
                <Text color="yellow">🏗️ REST API</Text>
                <Text> </Text>
                <Text color="yellow">🎨 React</Text>
              </Box>
            )}

            {/* Input */}
            <Box borderStyle="double" borderColor="green" padding={1}>
              <Text color="green">❯ </Text>
              <Text>{input || '_'}</Text>
            </Box>
          </Box>
        ) : (
          // DASHBOARD MODE
          <Box alignItems="center" justifyContent="center" flexGrow={1} borderStyle="round" borderColor="cyan" padding={1}>
            <Box flexDirection="column" alignItems="center">
              <Text bold color="magenta">🔧 Power Mode</Text>
              <Text>Press Tab to return to chat</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* FOOTER - single line */}
      <Box height={LAYOUT.footerHeight}>
        <Box borderStyle="single" borderColor="gray" paddingX={1} height={1}>
          <Text dimColor>Enter: send | Tab: mode | q: quit | h: help</Text>
        </Box>
      </Box>
    </Box>
  );
}

async function main() {
  // Clear screen first
  process.stdout.write('\x1Bc');
  
  if (!process.stdin.isTTY) {
    console.error('❌ EamilOS UI requires an interactive terminal');
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();

  const { waitUntilExit } = render(React.createElement(EamilOS), {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: false
  });

  const cleanup = async () => {
    process.stdin.setRawMode(false);
    bridge.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await waitUntilExit();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});