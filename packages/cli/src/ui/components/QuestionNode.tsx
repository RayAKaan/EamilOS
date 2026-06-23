import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { AgentQuestion } from '../types/ui';

interface QuestionNodeProps {
  question: AgentQuestion;
  onAnswer: (answer: string) => void;
  focused?: boolean;
}

export const QuestionNode: React.FC<QuestionNodeProps> = ({
  question,
  onAnswer,
  focused = true,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [textInput, setTextInput] = useState(question.default || '');
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    if (question.type !== 'text') return;
    const interval = setInterval(() => setShowCursor(s => !s), 500);
    return () => clearInterval(interval);
  }, [question.type]);

  const handleChoiceSelect = (index: number) => {
    if (question.options) {
      onAnswer(question.options[index]);
    }
  };

  const handleTextSubmit = () => {
    const answer = textInput.trim() || question.default || '';
    if (answer || !question.required) {
      onAnswer(answer);
    }
  };

  const handleConfirm = (yes: boolean) => {
    onAnswer(yes ? 'yes' : 'no');
  };

  const renderChoice = () => {
    if (!question.options) return null;
    return (
      <Box flexDirection="row" gap={1} marginTop={1}>
        {question.options.map((opt, i) => (
          <Box
            key={opt}
            paddingX={1}
            borderStyle="round"
            borderColor={focused && i === selectedIndex ? 'cyan' : 'gray'}
          >
            <Text color={focused && i === selectedIndex ? 'cyan' : 'white'}>
              {i + 1}. {opt}
            </Text>
          </Box>
        ))}
      </Box>
    );
  };

  const renderText = () => (
    <Box flexDirection="row" marginTop={1}>
      <Text color="cyan">{'>>> '}</Text>
      <Text>
        {textInput}
        {focused && showCursor && <Text color="cyan">█</Text>}
      </Text>
      {question.default && !textInput && (
        <Text dimColor> (default: {question.default})</Text>
      )}
    </Box>
  );

  const renderConfirm = () => (
    <Box flexDirection="row" gap={1} marginTop={1}>
      <Box
        paddingX={1}
        borderStyle="round"
        borderColor={focused && selectedIndex === 0 ? 'cyan' : 'gray'}
      >
        <Text color={focused && selectedIndex === 0 ? 'cyan' : 'white'}>
          [Y] Yes
        </Text>
      </Box>
      <Box
        paddingX={1}
        borderStyle="round"
        borderColor={focused && selectedIndex === 1 ? 'cyan' : 'gray'}
      >
        <Text color={focused && selectedIndex === 1 ? 'cyan' : 'white'}>
          [N] No
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      padding={1}
      marginLeft={2}
      marginTop={1}
    >
      <Box flexDirection="row">
        <Text color="yellow">{'[?] '}</Text>
        <Text color="yellow">{question.question}</Text>
      </Box>
      
      {question.context && (
        <Text dimColor>    {question.context}</Text>
      )}
      
      {question.type === 'choice' && renderChoice()}
      {question.type === 'text' && renderText()}
      {question.type === 'confirm' && renderConfirm()}
      
      <Box marginTop={1}>
        <Text dimColor>
          {question.type === 'choice' && '1-9 Select  Enter Confirm'}
          {question.type === 'text' && 'Type answer  Enter Submit  Esc Default'}
          {question.type === 'confirm' && 'Y/N Select  Enter Confirm'}
        </Text>
      </Box>
    </Box>
  );
};
