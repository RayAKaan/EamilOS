import React from 'react';
import { Box, Text } from 'ink';
import type { ExecutionNode } from '../types/ui';
import { StatusIcon, getStatusColor } from './StatusIcon';
import { QuestionNode } from './QuestionNode';
import { useAgentDialogue } from '../hooks/useAgentDialogue';

interface TreeNodeProps {
  node: ExecutionNode;
  depth: number;
  isLast: boolean;
  parentPrefix: string;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = ({ node, depth, isLast, parentPrefix }) => {
  const { pendingQuestion, answerQuestion } = useAgentDialogue();
  
  const connector = isLast ? '└─' : '├─';
  const vertical = isLast ? '  ' : '│ ';
  const childPrefix = parentPrefix + vertical;

  const labelColor = getStatusColor(node.status);
  const hasChildren = node.children && node.children.length > 0;
  const hasQuestion = !!node.question;
  const isQuestionFocused = pendingQuestion?.id === node.question?.id;

  const handleAnswer = (answer: string) => {
    answerQuestion(answer);
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor={depth > 0}>{parentPrefix}</Text>
        <Text color="gray">{connector} </Text>
        <StatusIcon status={node.status} />
        <Text 
          color={labelColor as 'green' | 'cyan' | 'red' | 'gray' | 'yellow'} 
          bold={node.status === 'running'}
        >
          {' '}{node.label}
        </Text>
        
        {node.metadata?.attempt && node.metadata.attempt > 1 && (
          <Text dimColor>{` (Attempt ${node.metadata.attempt})`}</Text>
        )}
        
        {node.metadata?.model && (
          <Text dimColor>{` [${node.metadata.model}]`}</Text>
        )}
      </Box>

      {node.reason && (
        <Box>
          <Text dimColor>{childPrefix}</Text>
          <Text dimColor italic>  {node.reason}</Text>
        </Box>
      )}

      {hasQuestion && node.question && (
        <QuestionNode
          question={node.question}
          onAnswer={handleAnswer}
          focused={isQuestionFocused}
        />
      )}

      {!node.blocked && hasChildren && (
        <Box flexDirection="column">
          {node.children.map((child: ExecutionNode, index: number) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={index === node.children.length - 1}
              parentPrefix={childPrefix}
            />
          ))}
        </Box>
      )}

      {node.blocked && !hasQuestion && (
        <Box>
          <Text dimColor>{childPrefix}</Text>
          <Text dimColor>  ⏳ Waiting for response...</Text>
        </Box>
      )}
    </Box>
  );
};

export const TreeNode = React.memo(TreeNodeComponent);
TreeNode.displayName = 'TreeNode';
