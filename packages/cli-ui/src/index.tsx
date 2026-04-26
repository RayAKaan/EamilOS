#!/usr/bin/env node

import React, { useState, useEffect, useCallback } from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { createBridge } from './bridge.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
}

// Initialize bridge ONCE outside React
let bridge = createBridge({ mockMode: true });

async function initBridge() {
  await bridge.initialize();
  console.error('[Bridge] Initialized');
}

// Run init immediately
initBridge().catch(e => console.error('[Bridge] Init error:', e));

function EamilOS() {
  const [mode, setMode] = useState<'chat' | 'dashboard'>('chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !process.stdin) return;
    
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
  }, [ready, input]);

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
      <Box borderStyle="round" borderColor="gray" paddingX={1} height={1}>
        <Text color="cyan" bold>⚡ EamilOS v1.0</Text>
        <Text> | </Text>
        <Text dimColor>Mode: {mode}</Text>
      </Box>

      <Box flexGrow={1} borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
        {mode === 'chat' ? (
          messages.length === 0 ? (
            <Box alignItems="center" justifyContent="center" height="100%">
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
          )
        ) : (
          <Box alignItems="center" justifyContent="center" height="100%">
            <Box flexDirection="column" alignItems="center">
              <Text bold color="magenta">🔧 Power Mode</Text>
              <Text>Press Tab to return to chat</Text>
            </Box>
          </Box>
        )}
        
        {isTyping && (
          <Box borderStyle="round" borderColor="gray" padding={1} alignItems="center">
            <Text color="cyan">claude-main thinking...</Text>
          </Box>
        )}
      </Box>

      {mode === 'chat' && messages.length === 0 && (
        <Box borderStyle="round" borderColor="yellow" padding={1} marginTop={1}>
          <Text bold>Quick:</Text>
          <Text> </Text>
          <Text color="yellow">🏗️ REST API</Text>
        </Box>
      )}

      <Box borderStyle="double" borderColor="green" padding={1} marginTop={1}>
        <Text color="green">❯ </Text>
        <Text>{input || '_'}</Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" paddingX={1} height={1}>
        <Text dimColor>Enter: send | Tab: mode | q: quit</Text>
      </Box>
    </Box>
  );
}

async function main() {
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