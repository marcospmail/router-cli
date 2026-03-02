import React from 'react';
import { Text, Box } from 'ink';
import { clearCredentials, getCredentials } from '../lib/credentials.js';
import { BackPrompt } from '../components/BackPrompt.js';

export function ClearCreds({ onBack }: { onBack?: () => void }) {
  const had = getCredentials();
  if (!had) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No cached credentials found.</Text>
        <BackPrompt onBack={onBack} />
      </Box>
    );
  }
  clearCredentials();
  return (
    <Box flexDirection="column">
      <Text color="green">Cached credentials cleared.</Text>
      <BackPrompt onBack={onBack} />
    </Box>
  );
}
