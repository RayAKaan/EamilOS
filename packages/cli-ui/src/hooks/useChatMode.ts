import { useEffect, useState, useCallback } from 'react';
import type { UIBridge } from '../bridge.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  timestamp: number;
  metrics?: { tokens?: number; cost?: number; duration?: number };
}

export const useChatMode = (bridge: UIBridge) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [costReport, setCostReport] = useState<string | null>(null);

  useEffect(() => {
    const state = bridge.getState();
    setMessages(state.messages || []);
  }, [bridge]);

  useEffect(() => {
    const onMessage = (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    };
    const onTyping = (data: { active: boolean }) => {
      setIsAgentTyping(data.active);
    };
    const onComplete = () => {
      setIsAgentTyping(false);
    };

    bridge.on('message:add', onMessage);
    bridge.on('agent:typing', onTyping);
    bridge.on('task:complete', onComplete);
    bridge.on('task:failed', onComplete);

    return () => {
      bridge.off('message:add', onMessage);
      bridge.off('agent:typing', onTyping);
      bridge.off('task:complete', onComplete);
      bridge.off('task:failed', onComplete);
    };
  }, [bridge]);

  const sendMessage = useCallback(async (text: string) => {
    setIsAgentTyping(true);
    await bridge.sendMessage(text);
  }, [bridge]);

  const executeSlashCommand = useCallback(async (command: string) => {
    const result = await bridge.executeSlashCommand(command);
    setMessages((prev) => [
      ...prev,
      {
        role: 'system',
        content: result,
        timestamp: Date.now(),
      },
    ]);
  }, [bridge]);

  const executeTemplate = useCallback(async (templateId: string, variables: string[]) => {
    const result = await bridge.executeTemplate?.(templateId, variables);
    if (result) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: result,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [bridge]);

  const fetchCostReport = useCallback(async () => {
    const report = bridge.getCostReport?.();
    if (report) {
      setCostReport(report);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: report,
          timestamp: Date.now(),
        },
      ]);
    }
  }, [bridge]);

  return {
    messages,
    isAgentTyping,
    costReport,
    sendMessage,
    executeSlashCommand,
    executeTemplate,
    fetchCostReport,
  };
};
