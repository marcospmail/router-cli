import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getRebootSessionKey, rebootRouter } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type Phase =
  | 'check-creds'
  | 'prompt-creds'
  | 'discover'
  | 'auth'
  | 'reboot-init'
  | 'wait-offline'
  | 'wait-online'
  | 'done'
  | 'error';

export function Reboot({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const run = async (username: string, password: string, isNew: boolean) => {
    try {
      setPhase('discover');
      const ip = await discoverRouter();
      setRouterIp(ip);

      setPhase('auth');
      const cookie = await login(ip, { username, password });
      if (isNew) saveCredentials({ username, password });

      setPhase('reboot-init');
      const sessionKey = await getRebootSessionKey(ip, cookie);
      await rebootRouter(ip, cookie, sessionKey);

      setPhase('wait-offline');
      await waitForOffline(ip, setElapsed);

      setPhase('wait-online');
      setElapsed(0);
      await waitForOnline(ip, setElapsed);

      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      run(creds.username, creds.password, false);
    } else {
      setPhase('prompt-creds');
    }
  }, []);

  const handleCredentials = (username: string, password: string) => {
    run(username, password, true);
  };

  if (phase === 'prompt-creds') {
    return <CredentialPrompt onSubmit={handleCredentials} />;
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column">
        <Status label={error} state="error" />
        <BackPrompt onBack={onBack} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Router Reboot</Text>
      <Box marginTop={1} flexDirection="column">
        <Status
          label="Discover router"
          state={phase === 'discover' ? 'loading' : routerIp ? 'success' : 'info'}
          detail={routerIp}
        />
        {isAfter(phase, 'discover') && (
          <Status label="Authenticate" state={phase === 'auth' ? 'loading' : 'success'} />
        )}
        {isAfter(phase, 'auth') && (
          <Status label="Send reboot command" state={phase === 'reboot-init' ? 'loading' : 'success'} />
        )}
        {isAfter(phase, 'reboot-init') && (
          <Status
            label="Waiting for router to go offline"
            state={phase === 'wait-offline' ? 'loading' : 'success'}
            detail={phase === 'wait-offline' ? `${elapsed}s` : undefined}
          />
        )}
        {isAfter(phase, 'wait-offline') && (
          <Status
            label="Waiting for router to come back online"
            state={phase === 'wait-online' ? 'loading' : 'success'}
            detail={phase === 'wait-online' ? `${elapsed}s` : undefined}
          />
        )}
        {phase === 'done' && (
          <Box marginTop={1}>
            <Text bold color="green">Router is back online!</Text>
          </Box>
        )}
        {(phase === 'done') && <BackPrompt onBack={onBack} />}
      </Box>
    </Box>
  );
}

const PHASE_ORDER: Phase[] = [
  'check-creds',
  'prompt-creds',
  'discover',
  'auth',
  'reboot-init',
  'wait-offline',
  'wait-online',
  'done',
  'error',
];

function isAfter(current: Phase, target: Phase): boolean {
  return PHASE_ORDER.indexOf(current) > PHASE_ORDER.indexOf(target);
}

const MAX_OFFLINE_WAIT_MS = 5 * 60 * 1000;
const MAX_ONLINE_WAIT_MS = 10 * 60 * 1000;

async function waitForOffline(ip: string, onElapsed: (s: number) => void): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_OFFLINE_WAIT_MS) {
    onElapsed(Math.round((Date.now() - start) / 1000));
    try {
      await execAsync(`ping -c 1 -W 1000 ${ip}`);
      await sleep(1000);
    } catch {
      return;
    }
  }
  throw new Error('Timed out waiting for router to go offline (5 min)');
}

async function waitForOnline(ip: string, onElapsed: (s: number) => void): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_ONLINE_WAIT_MS) {
    onElapsed(Math.round((Date.now() - start) / 1000));
    try {
      await execAsync(`ping -c 1 -W 1000 ${ip}`);
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error('Timed out waiting for router to come back online (10 min)');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
