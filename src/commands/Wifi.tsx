import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { InteractiveTable } from '../components/InteractiveTable.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getWifiClients, type WifiClient } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';
import { getDeviceInfo } from '../lib/devices.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'done' | 'error';

interface ClientRow {
  mac: string;
  band: string;
  hostname: string;
  ip: string;
  device: string;
  connected: string;
}

export function Wifi({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [clients, setClients] = useState<ClientRow[]>([]);
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
      const wifiClients = await getWifiClients(ip, cookie);

      const rows: ClientRow[] = wifiClients.map((c) => {
        const info = getDeviceInfo(c.ip);
        return {
          mac: c.mac,
          band: c.band,
          hostname: c.hostname,
          ip: c.ip,
          device: info?.name ?? 'Unknown',
          connected: c.connectedTime,
        };
      });

      setClients(rows);
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
        {phase === 'fetch' && <Status label="Fetching WiFi clients" state="loading" />}
      </Box>
    );
  }

  const count5 = clients.filter((c) => c.band === '5GHz').length;
  const count24 = clients.filter((c) => c.band === '2.4GHz').length;

  return (
    <Box flexDirection="column">
      <Status label="Router" state="success" detail={routerIp} />
      <Text bold color="cyan">{'\n'}WiFi Clients ({clients.length})</Text>
      <Box marginTop={1}>
        <Text dimColor>5GHz: {count5} clients  |  2.4GHz: {count24} clients</Text>
      </Box>
      {clients.length > 0 ? (
        <Box marginTop={1}>
          <InteractiveTable
            data={clients}
            columns={[
              { key: 'band', label: 'Band', width: 8, color: 'yellow' },
              { key: 'device', label: 'Device', width: 24 },
              { key: 'hostname', label: 'Hostname', width: 20 },
              { key: 'ip', label: 'IP', width: 16 },
              { key: 'mac', label: 'MAC', width: 18 },
              { key: 'connected', label: 'Connected', width: 12 },
            ]}
            ipKey="ip"
            onBack={onBack}
          />
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>No WiFi clients connected.</Text>
          <BackPrompt onBack={onBack} />
        </Box>
      )}
    </Box>
  );
}
