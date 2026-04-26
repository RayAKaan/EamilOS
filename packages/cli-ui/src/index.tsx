#!/usr/bin/env node

import React, { useState, useEffect, useRef } from 'react';
import { render } from 'ink';
import { Box, Text } from 'ink';
import { createBridge } from './bridge.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  duration?: string;
}

let bridge: any = null;
let inputBuffer = '';
let currentMode: 'chat' | 'dashboard' = 'chat';

function EamilOS() {
  const [key, setKey] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [renderCount, setRenderCount] = useState(0);

  useEffect(() => {
    setRenderCount(r => r + 1);
  }, []);

  useEffect(() => {
    if (renderCount > 1) return;
    
    const init = async () => {
      try {
        bridge = createBridge({ mockMode: true });
        await bridge.initialize();
      } catch (e) {
        console.error('Init error:', e);
      }
    };
    init();
  }, [renderCount]);

  useEffect(() => {
    if (!process.stdin || renderCount > 1) return;
    
    const handler = (data: Buffer) => {
      const pressedKey = data.toString();
      setKey(pressedKey);
      
      if (pressedKey === '\t') {
        currentMode = currentMode === 'chat' ? 'dashboard' : 'chat';
        return;
      }
      
      if (pressedKey === 'q') {
        process.exit(0);
        return;
      }
      
      if (pressedKey === '\r' || pressedKey === '\n') {
        if (inputBuffer.trim()) {
          handleSend(inputBuffer);
          inputBuffer = '';
        }
        return;
      }
      
      if (pressedKey === '\x7f' || pressedKey === '\b') {
        inputBuffer = inputBuffer.slice(0, -1);
        return;
      }
      
      if (pressedKey.length === 1) {
        inputBuffer += pressedKey;
      }
    };
    
    process.stdin.on('data', handler);
    return () => {
      try { process.stdin?.off('data', handler); } catch {}
    };
  }, [renderCount]);

  const handleSend = async (text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsTyping(true);
    
    try {
      const result = await bridge?.createTask?.(text);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Task created: ${result?.taskId || 'task-1'}`,
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
        <Text dimColor>Mode: {currentMode}</Text>
        <Text> | </Text>
        <Text dimColor>Render: {renderCount}</Text>
      </Box>

      <Box flexGrow={1} borderStyle="round" borderColor="cyan" padding={1} flexDirection="column">
        {currentMode === 'chat' ? (
          messages.length === 0 ? (
            <Box alignItems="center" justifyContent="center" height="100%">
              <Box flexDirection="column" alignItems="center">
                <Text bold color="cyan">⚡ EamilOS</Text>
                <Box marginTop={1}>
                  <Text>Your AI agent fleet, ready to build.</Text>
                </Box>
                <Text dimColor>Type a message and press Enter</Text>
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
                    <Box flexDirection="column">
                      {m.role === 'assistant' && <Text color="cyan">🤖</Text>}
                      <Text>{m.content}</Text>
                      {m.agent && (
                        <Text dimColor>{m.agent} • {m.duration}</Text>
                      )}
                    </Box>
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
            <Text color="cyan">claude-main</Text>
            <Text> thinking...</Text>
          </Box>
        )}
      </Box>

      {currentMode === 'chat' && messages.length === 0 && (
        <Box borderStyle="round" borderColor="yellow" padding={1} marginTop={1}>
          <Text bold>Quick starts:</Text>
          <Box marginLeft={2}>
            <Text color="yellow">🏗️ REST API</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="yellow">🎨 React App</Text>
          </Box>
        </Box>
      )}

      <Box borderStyle="double" borderColor="green" padding={1} marginTop={1}>
        <Text color="green">❯ </Text>
        <Text>{inputBuffer || '_'}</Text>
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
    bridge?.shutdown();
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