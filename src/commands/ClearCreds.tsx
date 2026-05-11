import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { clearCredentials, getCredentials } from '../lib/credentials.js';
import { BackPrompt } from '../components/BackPrompt.js';

type ClearPhase = 'pending' | 'cleared' | 'none-found';

export function ClearCreds({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<ClearPhase>('pending');

  useEffect(() => {
    const had = getCredentials();
    if (had) {
      clearCredentials();
      setPhase('cleared');
    } else {
      setPhase('none-found');
    }
  }, []);

  if (phase === 'pending') {
    return null;
  }

  if (phase === 'none-found') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No cached credentials found.</Text>
        <BackPrompt onBack={onBack} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Cached credentials cleared.</Text>
      <BackPrompt onBack={onBack} />
    </Box>
  );
}
