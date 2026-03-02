import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { Table } from '../components/Table.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getFirewallData, type FirewallData } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'done' | 'error';

interface RuleRow {
  name: string;
  protocol: string;
  localPort: string;
  localAddr: string;
  action: string;
  remoteAddr: string;
  remotePort: string;
}

export function Firewall({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [data, setData] = useState<FirewallData | null>(null);
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
      const fw = await getFirewallData(ip, cookie);

      setData(fw);
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

  if (phase !== 'done' || !data) {
    return (
      <Box flexDirection="column">
        <Status label="Discovering router" state={phase === 'discover' ? 'loading' : routerIp ? 'success' : 'info'} detail={routerIp} />
        {(phase === 'auth' || phase === 'fetch') && <Status label="Authenticating" state={phase === 'auth' ? 'loading' : 'success'} />}
        {phase === 'fetch' && <Status label="Fetching firewall rules" state="loading" />}
      </Box>
    );
  }

  const rows: RuleRow[] = data.rules.map((r) => ({
    name: r.name.length > 25 ? r.name.slice(0, 24) + '…' : r.name,
    protocol: r.protocol,
    localPort: r.localPort,
    localAddr: r.localAddress,
    action: r.action,
    remoteAddr: r.remoteAddress,
    remotePort: r.remotePort,
  }));

  return (
    <Box flexDirection="column">
      <Status label="Router" state="success" detail={routerIp} />
      <Text bold color="cyan">{'\n'}Firewall Rules (read-only)</Text>
      <Box marginTop={1} flexDirection="column" gap={0}>
        <Text>Default Policy: <Text color={data.defaultPolicy === 'Accept' ? 'green' : 'red'} bold>{data.defaultPolicy}</Text></Text>
        <Text>WAN Ping Echo: <Text color={data.echoEnabled ? 'green' : 'red'} bold>{data.echoEnabled ? 'Accept' : 'Reject'}</Text></Text>
      </Box>
      {rows.length > 0 ? (
        <Box marginTop={1}>
          <Table
            data={rows}
            columns={[
              { key: 'name', label: 'Rule Name', width: 26, color: 'cyan' },
              { key: 'protocol', label: 'Proto', width: 8, colorFn: (v) => v === 'TCP' ? 'blue' : v === 'UDP' ? 'magenta' : v === 'ICMP' ? 'yellow' : undefined },
              { key: 'localAddr', label: 'Local IP', width: 18 },
              { key: 'localPort', label: 'L.Port', width: 12 },
              { key: 'action', label: 'Action', width: 16, colorFn: (v) => v.includes('Accept') ? 'green' : v.includes('Reject') || v.includes('Drop') ? 'red' : 'yellow' },
              { key: 'remoteAddr', label: 'Remote IP', width: 18 },
              { key: 'remotePort', label: 'R.Port', width: 12 },
            ]}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text dimColor>No user-defined firewall rules.</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>{rows.length} user-defined rules</Text>
      </Box>
      <BackPrompt onBack={onBack} />
    </Box>
  );
}
