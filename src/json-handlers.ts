import { exec } from 'child_process';
import { promisify } from 'util';
import { discoverRouter } from './lib/router-discovery.js';
import { login, getDhcpLeases, getWanStatus, getRouterDeviceInfo, getDhcpConfig, getWifiClients, getSystemLogs, getFirewallData, getRebootSessionKey, rebootRouter } from './lib/router-auth.js';
import { getCredentials } from './lib/credentials.js';
import { getDeviceInfo } from './lib/devices.js';
import { pingSweep, getArpTable } from './lib/network-scan.js';
import { connectAdbWifi, resetAdbServer, NO_DEBUG_PORT_ERROR } from './lib/adb-wifi.js';
import { enableWirelessDebugging, getSyncDeviceName } from './lib/tasker.js';

const execAsync = promisify(exec);

// macOS: ping -W is in milliseconds. Linux: ping -W is in seconds.
const PING_WAIT_1S = process.platform === 'darwin' ? '1000' : '1';

function output(data: unknown): void {
  console.log(JSON.stringify(data));
}

function outputError(message: string): void {
  output({ error: message });
  process.exit(1);
}

async function getAuthenticatedSession(): Promise<{ routerIp: string; cookie: string }> {
  const creds = getCredentials();
  if (!creds) {
    outputError('No saved credentials. Run without --json first to set up credentials.');
    throw new Error('unreachable');
  }

  const routerIp = await discoverRouter();
  const cookie = await login(routerIp, creds);
  return { routerIp, cookie };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const ANDROID_PATTERNS = ['S25', 'Pixel', 'Tab S9'];
const PER_DEVICE_TIMEOUT_MS = 30000;

const ENABLE_DEBUG_POLL_INTERVAL_MS = 5000;
const ENABLE_DEBUG_TOTAL_BUDGET_MS = 3 * 60 * 1000;

async function connectDeviceJson(ip: string, syncDevice?: string): Promise<{ status: string; detail: string; phases: string[] }> {
  const phases: string[] = [];
  const log = (msg: string) => phases.push(msg);
  const onProgress = (p: { phase: string; detail?: string }) => log(`${p.phase}: ${p.detail ?? ''}`);

  try {
    await withTimeout(
      connectAdbWifi(ip, onProgress, undefined, syncDevice),
      PER_DEVICE_TIMEOUT_MS,
      `ADB connect ${ip}`,
    );
    return { status: 'connected', detail: `Connected to ${ip}:5555`, phases };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== NO_DEBUG_PORT_ERROR || !syncDevice) {
      return { status: 'error', detail: msg, phases };
    }

    log('Enabling wireless debugging via Tasker...');
    try {
      await enableWirelessDebugging(syncDevice);
    } catch (taskerErr) {
      return { status: 'error', detail: taskerErr instanceof Error ? taskerErr.message : String(taskerErr), phases };
    }

    const deadline = Date.now() + ENABLE_DEBUG_TOTAL_BUDGET_MS;
    let attempt = 0;
    let lastErr = msg;

    while (Date.now() < deadline) {
      attempt++;
      const remainingSec = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      log(`Waiting ${ENABLE_DEBUG_POLL_INTERVAL_MS / 1000}s before attempt ${attempt} (${remainingSec}s left)...`);
      await new Promise((r) => setTimeout(r, ENABLE_DEBUG_POLL_INTERVAL_MS));

      log(`Attempt ${attempt}...`);
      try {
        await withTimeout(
          connectAdbWifi(ip, onProgress, undefined, syncDevice),
          PER_DEVICE_TIMEOUT_MS,
          `ADB retry ${ip}`,
        );
        return { status: 'connected', detail: `Connected to ${ip}:5555 (after enabling debug, attempt ${attempt})`, phases };
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        lastErr = retryMsg;
        if (retryMsg !== NO_DEBUG_PORT_ERROR && !retryMsg.startsWith('Timeout:')) {
          return { status: 'error', detail: retryMsg, phases };
        }
      }
    }

    return { status: 'error', detail: `Gave up after ${ENABLE_DEBUG_TOTAL_BUDGET_MS / 1000}s of polling (${attempt} attempts). Last error: ${lastErr}`, phases };
  }
}

async function handleAdb(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const leases = await getDhcpLeases(routerIp, cookie);

  const androidDevices: { ip: string; name: string; syncDevice?: string }[] = [];
  for (const lease of leases) {
    const info = getDeviceInfo(lease.ip);
    if (!info) continue;
    const isAndroid = ANDROID_PATTERNS.some((p) => info.name.includes(p));
    if (isAndroid) {
      androidDevices.push({ ip: lease.ip, name: info.name, syncDevice: getSyncDeviceName(info.name) });
    }
  }

  if (androidDevices.length === 0) {
    outputError('No Android devices found on the network');
    return;
  }

  await resetAdbServer();

  const results = await Promise.all(
    androidDevices.map(async (dev) => {
      try {
        const result = await connectDeviceJson(dev.ip, dev.syncDevice);
        return { ip: dev.ip, name: dev.name, ...result };
      } catch (err) {
        return { ip: dev.ip, name: dev.name, status: 'error', detail: err instanceof Error ? err.message : String(err), phases: [] };
      }
    }),
  );

  output({ routerIp, devices: results });
}

async function handleDevices(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const leases = await getDhcpLeases(routerIp, cookie);

  const devices = leases
    .sort((a, b) => {
      const aNum = parseInt(a.ip.split('.').pop()!, 10);
      const bNum = parseInt(b.ip.split('.').pop()!, 10);
      return aNum - bNum;
    })
    .map((l) => {
      const info = getDeviceInfo(l.ip);
      return {
        ip: l.ip,
        hostname: l.hostname,
        name: info?.name,
        mac: l.mac,
        category: info?.category,
        leaseSeconds: l.leaseSeconds,
      };
    });

  output({ routerIp, devices });
}

async function handleStatus(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const [wan, device, dhcp] = await Promise.all([
    getWanStatus(routerIp, cookie),
    getRouterDeviceInfo(routerIp, cookie),
    getDhcpConfig(routerIp, cookie),
  ]);

  output({ routerIp, wan, device, dhcp });
}

async function handleScan(): Promise<void> {
  const routerIp = await discoverRouter();
  const subnet = routerIp.split('.').slice(0, 3).join('.');

  await pingSweep(subnet);
  const arpDevices = await getArpTable();
  const subnetDevices = arpDevices.filter((d) => d.ip.startsWith(subnet + '.'));

  const devices = subnetDevices
    .sort((a, b) => {
      const aNum = parseInt(a.ip.split('.').pop()!, 10);
      const bNum = parseInt(b.ip.split('.').pop()!, 10);
      return aNum - bNum;
    })
    .map((d) => {
      const info = getDeviceInfo(d.ip);
      return {
        ip: d.ip,
        name: info?.name,
        category: info?.category,
        mac: d.mac,
        status: 'online',
      };
    });

  output({ subnet: `${subnet}.0/24`, devices });
}

async function handleWifi(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const wifiClients = await getWifiClients(routerIp, cookie);

  const clients = wifiClients.map((c) => {
    const info = getDeviceInfo(c.ip);
    return {
      mac: c.mac,
      band: c.band,
      hostname: c.hostname,
      ip: c.ip,
      device: info?.name,
      connectedTime: c.connectedTime,
    };
  });

  output({ routerIp, clients });
}

async function handleLogs(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const entries = await getSystemLogs(routerIp, cookie);

  output({ routerIp, entries });
}

async function handleFirewall(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const data = await getFirewallData(routerIp, cookie);

  output({ routerIp, ...data });
}

const MAX_OFFLINE_WAIT_MS = 5 * 60 * 1000;
const MAX_ONLINE_WAIT_MS = 10 * 60 * 1000;

async function pingHost(ip: string): Promise<boolean> {
  try {
    await execAsync(`ping -c 1 -W ${PING_WAIT_1S} ${ip}`);
    return true;
  } catch {
    return false;
  }
}

async function waitForOffline(ip: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_OFFLINE_WAIT_MS) {
    if (!(await pingHost(ip))) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out waiting for router to go offline (5 min)');
}

async function waitForOnline(ip: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < MAX_ONLINE_WAIT_MS) {
    if (await pingHost(ip)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Timed out waiting for router to come back online (10 min)');
}

async function handleReboot(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const sessionKey = await getRebootSessionKey(routerIp, cookie);
  await rebootRouter(routerIp, cookie, sessionKey);

  await waitForOffline(routerIp);
  await waitForOnline(routerIp);

  output({ routerIp, status: 'rebooted' });
}

const handlers: Record<string, () => Promise<void>> = {
  adb: handleAdb,
  devices: handleDevices,
  status: handleStatus,
  scan: handleScan,
  wifi: handleWifi,
  logs: handleLogs,
  firewall: handleFirewall,
  reboot: handleReboot,
};

export async function runJsonHandler(command: string): Promise<void> {
  const handler = handlers[command];
  if (!handler) {
    outputError(`Unknown command for --json mode: ${command}`);
    return;
  }

  try {
    await handler();
  } catch (err) {
    outputError(err instanceof Error ? err.message : String(err));
  }
}
