import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { InteractiveTable } from '../components/InteractiveTable.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getSystemLogs, type LogEntry } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'done' | 'error';

interface LogRow {
  date: string;
  severity: string;
  domain: string;
  module: string;
  message: string;
}

export function Logs({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState('');

  const runWithCreds = async (username: string, password: string, isNew: boolean) => {
    try {
      setPhase('discover');
      const ip = await discoverRouter();
      setRouterIp(ip);

      setPhase('auth');
      const cookie = await login(ip, { username, password });
      if (isNew) saveCredentials({ username, password });

      setPhase('fetch');
      const entries = await getSystemLogs(ip, cookie);

      const rows: LogRow[] = entries.map((e) => ({
        date: e.date,
        severity: e.severity,
        domain: e.domain,
        module: e.module,
        message: e.message.length > 60 ? e.message.slice(0, 59) + '…' : e.message,
      }));

      setLogs(rows);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      runWithCreds(creds.username, creds.password, false);
    } else {
      setPhase('prompt-creds');
    }
  }, []);

  const handleCredentials = (username: string, password: string) => {
    runWithCreds(username, password, true);
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

  if (phase !== 'done') {
    return (
      <Box flexDirection="column">
        <Status label="Discovering router" state={phase === 'discover' ? 'loading' : routerIp ? 'success' : 'info'} detail={routerIp} />
        {(phase === 'auth' || phase === 'fetch') && <Status label="Authenticating" state={phase === 'auth' ? 'loading' : 'success'} />}
        {phase === 'fetch' && <Status label="Fetching system logs" state="loading" />}
      </Box>
    );
  }

  if (logs.length === 0) {
    return (
      <Box flexDirection="column">
        <Status label="Router" state="success" detail={routerIp} />
        <Text bold color="cyan">{'\n'}System Logs</Text>
        <Box marginTop={1}>
          <Text dimColor>No log entries found. System logging may be empty.</Text>
        </Box>
        <BackPrompt onBack={onBack} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Status label="Router" state="success" detail={routerIp} />
      <Text bold color="cyan">{'\n'}System Logs ({logs.length} entries)</Text>
      <Box marginTop={1}>
        <InteractiveTable
          data={logs}
          columns={[
            { key: 'date', label: 'Date', width: 18 },
            { key: 'severity', label: 'Level', width: 10, color: 'yellow' },
            { key: 'domain', label: 'Domain', width: 12 },
            { key: 'module', label: 'Module', width: 14 },
            { key: 'message', label: 'Message', width: 60 },
          ]}
          onBack={onBack}
        />
      </Box>
    </Box>
  );
}
