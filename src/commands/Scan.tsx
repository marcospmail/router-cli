import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { Table } from '../components/Table.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { pingSweep, getArpTable, type ScannedDevice } from '../lib/network-scan.js';
import { getDeviceInfo } from '../lib/devices.js';
import { BackPrompt } from '../components/BackPrompt.js';

type Phase = 'discover' | 'sweep' | 'arp' | 'done' | 'error';

interface ScanRow {
  ip: string;
  name: string;
  category: string;
  mac: string;
  status: string;
}

export function Scan({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('discover');
  const [subnet, setSubnet] = useState('');
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ScanRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setPhase('discover');
        const routerIp = await discoverRouter();
        const sub = routerIp.split('.').slice(0, 3).join('.');
        setSubnet(sub);

        setPhase('sweep');
        await pingSweep(sub, (current, total) => {
          setProgress(Math.round((current / total) * 100));
        });

        setPhase('arp');
        const devices = await getArpTable();

        const subnetDevices = devices.filter((d) => d.ip.startsWith(sub + '.'));

        const rows: ScanRow[] = subnetDevices
          .sort((a, b) => {
            const aNum = parseInt(a.ip.split('.').pop()!, 10);
            const bNum = parseInt(b.ip.split('.').pop()!, 10);
            return aNum - bNum;
          })
          .map((d) => {
            const info = getDeviceInfo(d.ip);
            return {
              ip: d.ip,
              name: info?.name ?? 'Unknown',
              category: info?.category ?? '?',
              mac: d.mac,
              status: 'online',
            };
          });

        setResults(rows);
        setPhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
  }, []);

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
        <Status
          label="Discovering network"
          state={phase === 'discover' ? 'loading' : 'success'}
          detail={subnet ? `${subnet}.0/24` : undefined}
        />
        {(phase === 'sweep' || phase === 'arp') && (
          <Status label={`Ping sweep ${progress}%`} state={phase === 'sweep' ? 'loading' : 'success'} />
        )}
        {phase === 'arp' && <Status label="Reading ARP table" state="loading" />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">Network Scan Results — {subnet}.0/24 ({results.length} devices)</Text>
      <Box marginTop={1}>
        <Table
          data={results}
          columns={[
            { key: 'ip', label: 'IP', width: 16 },
            { key: 'name', label: 'Device', width: 30 },
            { key: 'category', label: 'Category', width: 15, color: 'yellow' },
            { key: 'mac', label: 'MAC', width: 18 },
            { key: 'status', label: 'Status', width: 8, color: 'green' },
          ]}
        />
      </Box>
      <BackPrompt onBack={onBack} />
    </Box>
  );
}
