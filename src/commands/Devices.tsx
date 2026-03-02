import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { Table } from '../components/Table.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getDhcpLeases, type DhcpLease } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';
import { getDeviceInfo } from '../lib/devices.js';
import { BackPrompt } from '../components/BackPrompt.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'done' | 'error';

interface DeviceRow {
  ip: string;
  hostname: string;
  name: string;
  mac: string;
  category: string;
  lease: string;
}

export function Devices({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [devices, setDevices] = useState<DeviceRow[]>([]);
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
      const leases = await getDhcpLeases(ip, cookie);

      const rows: DeviceRow[] = leases
        .sort((a, b) => {
          const aNum = parseInt(a.ip.split('.').pop()!, 10);
          const bNum = parseInt(b.ip.split('.').pop()!, 10);
          return aNum - bNum;
        })
        .map((l) => {
          const info = getDeviceInfo(l.ip);
          return {
            ip: l.ip,
            hostname: l.hostname || '—',
            name: info?.name ?? 'Unknown',
            mac: l.mac,
            category: info?.category ?? '?',
            lease: formatLease(l.leaseSeconds),
          };
        });

      setDevices(rows);
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
        {phase === 'fetch' && <Status label="Fetching DHCP leases" state="loading" />}
      </Box>
    );
  }

  const categories = [...new Set(devices.map((d) => d.category))];

  return (
    <Box flexDirection="column">
      <Status label="Router" state="success" detail={routerIp} />
      <Text bold color="cyan">{'\n'}Connected Devices ({devices.length})</Text>
      <Box marginTop={1}>
        <Table
          data={devices}
          columns={[
            { key: 'ip', label: 'IP', width: 16 },
            { key: 'name', label: 'Device', width: 30 },
            { key: 'category', label: 'Category', width: 15, color: 'yellow' },
            { key: 'mac', label: 'MAC', width: 18 },
            { key: 'hostname', label: 'Hostname', width: 20 },
            { key: 'lease', label: 'Lease', width: 10 },
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Categories: {categories.join(', ')}</Text>
      </Box>
      <BackPrompt onBack={onBack} />
    </Box>
  );
}

function formatLease(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
