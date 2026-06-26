import React from 'react';
import { Box } from 'ink';

interface Props {
  children: React.ReactNode;
}

export const Container: React.FC<Props> = ({ children }) => (
  <Box
    width="100%"
    height="100%"
    flexDirection="column"
  >
    {children}
  </Box>
);
