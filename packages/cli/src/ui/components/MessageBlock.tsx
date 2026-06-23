import React from 'react';
import type { Message } from '../types/ui.js';
import { UserMessage } from './UserMessage.js';
import { AgentMessage } from './AgentMessage.js';
import { SystemEvent } from './SystemEvent.js';
import { GraphStats } from './GraphStats.js';

interface MessageBlockProps {
  message: Message;
}

export const MessageBlock: React.FC<MessageBlockProps> = ({ message }) => {
  switch (message.type) {
    case 'user':
      return <UserMessage message={message} />;
    case 'opencode':
    case 'gemini':
    case 'thinking':
      return <AgentMessage message={message} />;
    case 'system':
    case 'error':
      return <SystemEvent message={message} />;
    case 'graph-stats':
      return <GraphStats message={message} />;
    default:
      return null;
  }
};
