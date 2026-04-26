import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeyboard } from '../../hooks/useKeyboard';

interface SearchBarProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  onClose: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ placeholder = 'Search...', onSearch, onClose }) => {
  const [query, setQuery] = useState('');

  useKeyboard((keyId) => {
    const key = keyId.toLowerCase();
    if (key === 'escape') {
      onClose();
    } else if (key === 'enter') {
      onSearch(query);
      onClose();
    } else if (key === 'backspace' || key === 'delete') {
      setQuery(q => q.slice(0, -1));
    } else if (key.length === 1 && !key.includes('ctrl') && !key.includes('shift')) {
      setQuery(q => q + key);
    }
  });

  return (
    <Box paddingX={2} paddingY={1} borderStyle="round" borderColor="green">
      <Text color="green">/</Text>
      <Text> </Text>
      <Text>{query || placeholder}</Text>
      {!query && <Text dimColor>_</Text>}
    </Box>
  );
};