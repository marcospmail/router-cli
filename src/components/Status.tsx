import React from 'react';
import { Text, Box } from 'ink';
import Spinner from 'ink-spinner';

interface StatusProps {
  label: string;
  state: 'loading' | 'success' | 'error' | 'info';
  detail?: string;
}

const icons = {
  loading: '',
  success: '✓',
  error: '✗',
  info: '→',
};

const colors = {
  loading: 'yellow',
  success: 'green',
  error: 'red',
  info: 'blue',
} as const;

export function Status({ label, state, detail }: StatusProps) {
  return (
    <Box>
      {state === 'loading' ? (
        <Text color="yellow">
          <Spinner type="dots" />{' '}
        </Text>
      ) : (
        <Text color={colors[state]}>{icons[state]} </Text>
      )}
      <Text>{label}</Text>
      {detail && <Text dimColor> {detail}</Text>}
    </Box>
  );
}
