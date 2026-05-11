import React, { useState, useEffect, useRef } from 'react';
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

// macOS: ping -W is in milliseconds. Linux: ping -W is in seconds.
const PING_WAIT_1S = process.platform === 'darwin' ? '1000' : '1';

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
  const mountedRef = useRef(true);
  const abortRef = useRef(new AbortController());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current.abort();
    };
  }, []);

  const safeSetPhase = (p: Phase) => { if (mountedRef.current) setPhase(p); };
  const safeSetRouterIp = (ip: string) => { if (mountedRef.current) setRouterIp(ip); };
  const safeSetError = (e: string) => { if (mountedRef.current) setError(e); };
  const safeSetElapsed = (s: number) => { if (mountedRef.current) setElapsed(s); };

  const run = async (username: string, password: string, isNew: boolean) => {
    const signal = abortRef.current.signal;
    try {
      safeSetPhase('discover');
      const ip = await discoverRouter();
      safeSetRouterIp(ip);

      safeSetPhase('auth');
      const cookie = await login(ip, { username, password });
      if (isNew) saveCredentials({ username, password });

      safeSetPhase('reboot-init');
      const sessionKey = await getRebootSessionKey(ip, cookie);
      await rebootRouter(ip, cookie, sessionKey);

      safeSetPhase('wait-offline');
      await waitForOffline(ip, safeSetElapsed, signal);

      safeSetPhase('wait-online');
      safeSetElapsed(0);
      await waitForOnline(ip, safeSetElapsed, signal);

      safeSetPhase('done');
    } catch (err) {
      if (signal.aborted) return;
      safeSetError(err instanceof Error ? err.message : String(err));
      safeSetPhase('error');
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
const OFFLINE_POLL_INTERVAL_MS = 1000;
const ONLINE_POLL_INTERVAL_MS = 2000;

async function waitForOffline(ip: string, onElapsed: (s: number) => void, signal: AbortSignal): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_OFFLINE_WAIT_MS) {
    if (signal.aborted) return;
    onElapsed(Math.round((Date.now() - start) / 1000));
    try {
      await execAsync(`ping -c 1 -W ${PING_WAIT_1S} ${ip}`);
      await sleep(OFFLINE_POLL_INTERVAL_MS);
    } catch {
      return;
    }
  }
  throw new Error('Timed out waiting for router to go offline (5 min)');
}

async function waitForOnline(ip: string, onElapsed: (s: number) => void, signal: AbortSignal): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_ONLINE_WAIT_MS) {
    if (signal.aborted) return;
    onElapsed(Math.round((Date.now() - start) / 1000));
    try {
      await execAsync(`ping -c 1 -W ${PING_WAIT_1S} ${ip}`);
      return;
    } catch {
      await sleep(ONLINE_POLL_INTERVAL_MS);
    }
  }
  throw new Error('Timed out waiting for router to come back online (10 min)');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
