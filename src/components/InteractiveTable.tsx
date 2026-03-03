import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Table, type Column } from './Table.js';
import { execSync, spawn, type ChildProcess } from 'child_process';

interface InteractiveTableProps<T extends Record<string, unknown>> {
  data: T[];
  columns: Column<T>[];
  ipKey?: keyof T;
  onBack?: () => void;
}

type Mode = 'navigate' | 'filter' | 'ping' | 'detail';

const PAGE_SIZE = 10;

export function InteractiveTable<T extends Record<string, unknown>>({
  data,
  columns,
  ipKey,
  onBack,
}: InteractiveTableProps<T>) {
  const [selectedRow, setSelectedRow] = useState(0);
  const [mode, setMode] = useState<Mode>('navigate');
  const [filterText, setFilterText] = useState('');
  const [pingOutput, setPingOutput] = useState('');
  const [pingDone, setPingDone] = useState(false);
  const lastKeyRef = useRef('');
  const pingProcessRef = useRef<ChildProcess | null>(null);

  const filteredData = useMemo(() => {
    if (!filterText) return data;
    const lower = filterText.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(lower))
    );
  }, [data, columns, filterText]);

  const clampedRow = Math.min(selectedRow, Math.max(filteredData.length - 1, 0));
  if (clampedRow !== selectedRow && filteredData.length > 0) {
    setSelectedRow(clampedRow);
  }

  const selectedItem = filteredData[clampedRow];

  const startPing = useCallback((ip: string) => {
    setMode('ping');
    setPingOutput('');
    setPingDone(false);

    const proc = spawn('ping', ['-c', '3', ip]);
    pingProcessRef.current = proc;

    proc.stdout.on('data', (chunk: Buffer) => {
      setPingOutput((prev) => prev + chunk.toString());
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      setPingOutput((prev) => prev + chunk.toString());
    });

    proc.on('close', () => {
      setPingDone(true);
      pingProcessRef.current = null;
    });

    proc.on('error', (err) => {
      setPingOutput((prev) => prev + '\n' + err.message);
      setPingDone(true);
      pingProcessRef.current = null;
    });
  }, []);

  useInput((input, key) => {
    if (mode === 'filter') {
      if (key.escape) {
        if (filterText) {
          setFilterText('');
        } else {
          setMode('navigate');
        }
        lastKeyRef.current = '';
        return;
      }
      if (key.return) {
        setMode('navigate');
        lastKeyRef.current = '';
        return;
      }
      lastKeyRef.current = '';
      return;
    }

    if (mode === 'ping') {
      if (input === 'c' && pingOutput) {
        try {
          execSync(`echo -n ${JSON.stringify(pingOutput)} | pbcopy`);
        } catch {}
        lastKeyRef.current = '';
        return;
      }
      if (pingDone) {
        setMode('navigate');
        setPingOutput('');
        setPingDone(false);
      } else if (input === 'q' || key.escape) {
        pingProcessRef.current?.kill();
        setMode('navigate');
        setPingOutput('');
        setPingDone(false);
      }
      lastKeyRef.current = '';
      return;
    }

    if (mode === 'detail') {
      if (input === 'c' && selectedItem) {
        const text = columns.map((col) => `${col.label}: ${String(selectedItem[col.key] ?? '')}`).join('\n');
        try {
          execSync(`echo -n ${JSON.stringify(text)} | pbcopy`);
        } catch {}
        lastKeyRef.current = '';
        return;
      }
      setMode('navigate');
      lastKeyRef.current = '';
      return;
    }

    // navigate mode — vim keybindings
    if (input === 'k' || key.upArrow) {
      setSelectedRow((r) => Math.max(0, r - 1));
      lastKeyRef.current = input;
      return;
    }
    if (input === 'j' || key.downArrow) {
      setSelectedRow((r) => Math.min(filteredData.length - 1, r + 1));
      lastKeyRef.current = input;
      return;
    }

    // gg = go to top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        setSelectedRow(0);
        lastKeyRef.current = '';
      } else {
        lastKeyRef.current = 'g';
      }
      return;
    }

    // G = go to bottom
    if (input === 'G') {
      setSelectedRow(Math.max(filteredData.length - 1, 0));
      lastKeyRef.current = input;
      return;
    }

    // Ctrl+d = half page down
    if (key.ctrl && input === 'd') {
      setSelectedRow((r) => Math.min(filteredData.length - 1, r + PAGE_SIZE));
      lastKeyRef.current = '';
      return;
    }

    // Ctrl+u = half page up
    if (key.ctrl && input === 'u') {
      setSelectedRow((r) => Math.max(0, r - PAGE_SIZE));
      lastKeyRef.current = '';
      return;
    }

    if (input === '/') {
      setMode('filter');
      lastKeyRef.current = '';
      return;
    }

    if (input === 'q' || key.escape) {
      onBack?.();
      lastKeyRef.current = '';
      return;
    }

    if (!selectedItem) {
      lastKeyRef.current = input;
      return;
    }

    if (input === 'p' && ipKey) {
      const ip = String(selectedItem[ipKey] ?? '');
      if (ip) startPing(ip);
      lastKeyRef.current = '';
      return;
    }

    if (input === 'c' && ipKey) {
      const ip = String(selectedItem[ipKey] ?? '');
      if (ip) {
        try {
          execSync(`echo -n "${ip}" | pbcopy`);
        } catch {}
      }
      lastKeyRef.current = '';
      return;
    }

    if (input === 'i') {
      setMode('detail');
      lastKeyRef.current = '';
      return;
    }

    lastKeyRef.current = input;
  });

  if (mode === 'ping') {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Ping Result</Text>
        <Box marginTop={1}>
          <Text>{pingOutput || 'Pinging…'}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>{pingDone ? 'c copy  any key to return' : 'c copy  q cancel'}</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'detail' && selectedItem) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">Detail View</Text>
        <Box marginTop={1} flexDirection="column">
          {columns.map((col) => (
            <Text key={String(col.key)}>
              <Text bold color="yellow">{col.label}: </Text>
              <Text>{String(selectedItem[col.key] ?? '')}</Text>
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>c copy  any key to return</Text>
        </Box>
      </Box>
    );
  }

  const ipActions = ipKey ? '  p ping  c copy' : '';
  const filterActive = mode === 'filter';

  return (
    <Box flexDirection="column">
      {filterActive && (
        <Box marginBottom={1}>
          <Text bold color="yellow">Filter: </Text>
          <TextInput value={filterText} onChange={setFilterText} />
        </Box>
      )}
      {!filterActive && filterText && (
        <Box marginBottom={1}>
          <Text dimColor>Filter: "{filterText}" ({filteredData.length} matches)</Text>
        </Box>
      )}
      <Table data={filteredData} columns={columns} highlightRow={clampedRow} />
      {filteredData.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No matching rows.</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>/ filter  i detail{ipActions}  q back</Text>
      </Box>
    </Box>
  );
}
