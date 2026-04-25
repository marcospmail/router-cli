import { execFile } from 'child_process';
import { promisify } from 'util';
import net from 'net';
import { disableWirelessDebugging } from './tasker.js';

const execFileAsync = promisify(execFile);

const PORT_START = 30000;
const PORT_END = 50000;
const MAX_RETRIES = 1;
const SCAN_CONCURRENCY = 200;
const SCAN_TIMEOUT_MS = 500;

async function adb(args: string): Promise<string> {
  const { stdout } = await execFileAsync('adb', args.split(' '), { timeout: 10000 });
  return stdout.trim();
}

async function adbConnect(target: string): Promise<boolean> {
  let output: string;
  try {
    output = await adb(`connect ${target}`);
  } catch {
    // adb connect can throw on timeout or non-zero exit when hitting a
    // non-ADB port (e.g., other Samsung services). Treat as failed connect.
    return false;
  }
  if (output.includes('connected to')) {
    // Verify device is actually online (not "offline" state)
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const devices = await adb('devices');
      const line = devices.split('\n').find((l) => l.startsWith(target));
      return !!line && line.includes('\tdevice');
    } catch {
      return false;
    }
  }
  return false;
}

async function disconnectStale(ip: string): Promise<void> {
  try {
    const devices = await adb('devices');
    const lines = devices.split('\n').filter((l) => l.includes(ip));
    for (const line of lines) {
      const dev = line.split('\t')[0];
      if (dev) {
        try { await adb(`disconnect ${dev}`); } catch {}
      }
    }
  } catch {}
}

function checkPort(ip: string, port: number, timeout = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Cancelled');
}

async function scanPorts(ip: string, onBatch?: (start: number, end: number) => void, signal?: AbortSignal): Promise<number[]> {
  const ports = Array.from({ length: PORT_END - PORT_START + 1 }, (_, i) => PORT_START + i);
  const found: number[] = [];

  for (let i = 0; i < ports.length; i += SCAN_CONCURRENCY) {
    checkAborted(signal);
    const batch = ports.slice(i, i + SCAN_CONCURRENCY);
    onBatch?.(batch[0], batch[batch.length - 1]);
    const results = await Promise.all(
      batch.map(async (port) => {
        const open = await checkPort(ip, port, SCAN_TIMEOUT_MS);
        return open ? port : null;
      }),
    );
    for (const port of results) {
      if (port !== null) found.push(port);
    }
  }

  return found;
}

const TASKER_PACKAGE = 'net.dinglisch.android.taskerm';
const TASKER_PERMISSIONS = [
  'android.permission.WRITE_SECURE_SETTINGS',
  'android.permission.READ_LOGS',
  'android.permission.DUMP',
  'android.permission.CHANGE_CONFIGURATION',
  'android.permission.SET_VOLUME_KEY_LONG_PRESS_LISTENER',
  'android.permission.INTERACT_ACROSS_USERS',
];

export type AdbPhase =
  | 'checking-5555'
  | 'scanning'
  | 'connecting'
  | 'switching'
  | 'finalizing'
  | 'disconnecting'
  | 'disabling-debug'
  | 'cleanup'
  | 'granting-permissions'
  | 'enabling-debug'
  | 'done'
  | 'error';

export const NO_DEBUG_PORT_ERROR = 'No wireless debugging port found';

export interface AdbProgress {
  phase: AdbPhase;
  detail?: string;
  retry?: number;
}

export async function connectAdbWifi(
  ip: string,
  onProgress: (progress: AdbProgress) => void,
  signal?: AbortSignal,
  syncDevice?: string,
): Promise<void> {
  // Clean up stale/offline connections for this IP
  await disconnectStale(ip);

  // Check if port 5555 is already open
  checkAborted(signal);
  onProgress({ phase: 'checking-5555', detail: `Checking ${ip}:5555` });
  if (await checkPort(ip, 5555)) {
    checkAborted(signal);
    onProgress({ phase: 'connecting', detail: 'Port 5555 already open, connecting...' });
    const connected = await adbConnect(`${ip}:5555`);
    if (connected) {
      await disableDebug(ip, syncDevice, onProgress);
      await grantTaskerPermissions(ip, onProgress);
      onProgress({ phase: 'done', detail: `Connected to ${ip}:5555` });
      return;
    }
    onProgress({ phase: 'connecting', detail: 'Port 5555 open but ADB failed, scanning...' });
  }

  // Scan for wireless debugging port
  onProgress({ phase: 'scanning', detail: 'Scanning for wireless debugging port...' });
  let ports: number[] = [];
  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    checkAborted(signal);
    onProgress({ phase: 'scanning', retry: retry + 1 });
    if (retry > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    ports = await scanPorts(ip, (start, end) => {
      onProgress({ phase: 'scanning', retry: retry + 1, detail: `Ports ${start}–${end}` });
    }, signal);
    if (ports.length > 0) break;
  }

  if (ports.length === 0) {
    onProgress({
      phase: 'error',
      detail: 'No wireless debugging port found. Make sure Wireless Debugging is enabled.',
    });
    throw new Error(NO_DEBUG_PORT_ERROR);
  }

  // Try each found port until one actually connects via ADB
  let connectedPort: number | null = null;
  for (const port of ports) {
    checkAborted(signal);
    onProgress({ phase: 'connecting', detail: `Found port ${port}, connecting to ${ip}:${port}` });
    const connected = await adbConnect(`${ip}:${port}`);
    if (connected) {
      connectedPort = port;
      break;
    }
    onProgress({ phase: 'connecting', detail: `Port ${port} is not ADB, trying next...` });
    try { await adb(`disconnect ${ip}:${port}`); } catch {}
  }

  if (connectedPort === null) {
    onProgress({
      phase: 'error',
      detail: `Found ${ports.length} open port(s) but none responded to ADB. Ensure Wireless Debugging is enabled.`,
    });
    throw new Error(NO_DEBUG_PORT_ERROR);
  }

  await new Promise((r) => setTimeout(r, 2000));
  checkAborted(signal);

  // Switch to port 5555
  onProgress({ phase: 'switching', detail: `Switching ${ip}:${connectedPort} to tcpip 5555` });
  await adb(`-s ${ip}:${connectedPort} tcpip 5555`);

  await new Promise((r) => setTimeout(r, 2000));
  checkAborted(signal);

  // Connect on 5555
  onProgress({ phase: 'finalizing', detail: `Connecting to ${ip}:5555` });
  const finalConnected = await adbConnect(`${ip}:5555`);
  if (!finalConnected) {
    throw new Error(`Failed to connect to ${ip}:5555 after tcpip switch`);
  }

  // Disconnect from wireless debugging port
  onProgress({ phase: 'disconnecting', detail: `Disconnecting debug port ${ip}:${connectedPort}` });
  try { await adb(`disconnect ${ip}:${connectedPort}`); } catch {}

  // Disable wireless debugging
  await disableDebug(ip, syncDevice, onProgress);

  // Disconnect any extra connections, keep only 5555
  onProgress({ phase: 'cleanup', detail: 'Cleaning up extra connections' });
  try {
    const devices = await adb('devices');
    const lines = devices.split('\n').filter((l) => l.includes('\t'));
    for (const line of lines) {
      const dev = line.split('\t')[0];
      if (dev && !dev.includes(`${ip}:5555`)) {
        onProgress({ phase: 'cleanup', detail: `Disconnecting ${dev}` });
        try { await adb(`disconnect ${dev}`); } catch {}
      }
    }
  } catch {}

  await grantTaskerPermissions(ip, onProgress);
  onProgress({ phase: 'done', detail: `Connected to ${ip}:5555` });
}

async function disableDebug(ip: string, syncDevice: string | undefined, onProgress: (progress: AdbProgress) => void) {
  onProgress({ phase: 'disabling-debug', detail: 'Disabling wireless debugging (ADB)' });
  try { await adb(`-s ${ip}:5555 shell svc wifi debug disable`); } catch {}
  try { await adb(`-s ${ip}:5555 shell settings put global adb_wifi_enabled 0`); } catch {}
  if (syncDevice) {
    onProgress({ phase: 'disabling-debug', detail: `Disabling wireless debugging via Tasker (${syncDevice})` });
    try {
      await disableWirelessDebugging(syncDevice);
    } catch (err) {
      onProgress({ phase: 'disabling-debug', detail: `Tasker disable failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

async function grantTaskerPermissions(ip: string, onProgress: (progress: AdbProgress) => void) {
  for (let i = 0; i < TASKER_PERMISSIONS.length; i++) {
    const perm = TASKER_PERMISSIONS[i];
    const shortName = perm.replace('android.permission.', '');
    onProgress({
      phase: 'granting-permissions',
      detail: `Tasker: ${shortName} (${i + 1}/${TASKER_PERMISSIONS.length})`,
    });
    try { await adb(`-s ${ip}:5555 shell pm grant ${TASKER_PACKAGE} ${perm}`); } catch {}
  }
}
