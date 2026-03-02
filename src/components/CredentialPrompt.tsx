import React, { useState } from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';

interface CredentialPromptProps {
  onSubmit: (username: string, password: string) => void;
}

export function CredentialPrompt({ onSubmit }: CredentialPromptProps) {
  const [step, setStep] = useState<'username' | 'password'>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleUsernameSubmit = (value: string) => {
    setUsername(value);
    setStep('password');
  };

  const handlePasswordSubmit = (value: string) => {
    setPassword(value);
    onSubmit(username, value);
  };

  return (
    <Box flexDirection="column">
      <Text bold color="yellow">Router credentials required</Text>
      <Text dimColor>Credentials will be cached for future use.</Text>
      <Box marginTop={1}>
        {step === 'username' ? (
          <>
            <Text>Username: </Text>
            <TextInput value={username} onChange={setUsername} onSubmit={handleUsernameSubmit} />
          </>
        ) : (
          <>
            <Text>Password: </Text>
            <TextInput value={password} onChange={setPassword} onSubmit={handlePasswordSubmit} mask="*" />
          </>
        )}
      </Box>
    </Box>
  );
}
