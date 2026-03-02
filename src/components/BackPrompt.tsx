import React from 'react';
import { Text, Box, useInput } from 'ink';

interface BackPromptProps {
  onBack?: () => void;
}

export function BackPrompt({ onBack }: BackPromptProps) {
  useInput(() => {
    onBack?.();
  });

  if (!onBack) return null;

  return (
    <Box marginTop={1}>
      <Text dimColor>Press any key to return to menu</Text>
    </Box>
  );
}
