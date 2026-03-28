import { exec } from 'child_process';
import { promisify } from 'util';
import { discoverRouter } from './lib/router-discovery.js';
import { login, getDhcpLeases, getWanStatus, getRouterDeviceInfo, getDhcpConfig, getWifiClients, getSystemLogs, getFirewallData, getRebootSessionKey, rebootRouter } from './lib/router-auth.js';
import { getCredentials } from './lib/credentials.js';
import { getDeviceInfo } from './lib/devices.js';
import { pingSweep, getArpTable } from './lib/network-scan.js';

const execAsync = promisify(exec);

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

async function adbQuick(args: string): Promise<string> {
  const { stdout } = await execAsync(`adb ${args}`, { timeout: 5000 });
  return stdout.trim();
}

async function isDeviceOnline(ip: string): Promise<boolean> {
  try {
    const result = await adbQuick('devices');
    const lines = result.split('\n');
    return lines.some((l) => l.includes(`${ip}:5555`) && l.includes('\tdevice'));
  } catch {
    return false;
  }
}

const ANDROID_PATTERNS = ['S25', 'Pixel', 'Tab S9'];
const PER_DEVICE_TIMEOUT_MS = 30000;

async function connectDeviceJson(ip: string): Promise<{ status: string; detail: string }> {
  // Try connecting on port 5555
  await adbQuick(`connect ${ip}:5555`);

  // Check if actually online
  const online = await isDeviceOnline(ip);
  if (!online) {
    return { status: 'offline', detail: `${ip}:5555 connected but device offline` };
  }

  return { status: 'connected', detail: `Connected to ${ip}:5555` };
}

async function handleAdb(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const leases = await getDhcpLeases(routerIp, cookie);

  const androidDevices: { ip: string; name: string }[] = [];
  for (const lease of leases) {
    const info = getDeviceInfo(lease.ip);
    if (!info) continue;
    const isAndroid = ANDROID_PATTERNS.some((p) => info.name.includes(p));
    if (isAndroid) {
      androidDevices.push({ ip: lease.ip, name: info.name });
    }
  }

  if (androidDevices.length === 0) {
    outputError('No Android devices found on the network');
    return;
  }

  const results = await Promise.all(
    androidDevices.map(async (dev) => {
      try {
        const result = await withTimeout(
          connectDeviceJson(dev.ip),
          PER_DEVICE_TIMEOUT_MS,
          `ADB connect ${dev.name}`,
        );
        return { ip: dev.ip, name: dev.name, ...result };
      } catch (err) {
        return { ip: dev.ip, name: dev.name, status: 'error', detail: err instanceof Error ? err.message : String(err) };
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

async function handleReboot(): Promise<void> {
  const { routerIp, cookie } = await getAuthenticatedSession();
  const sessionKey = await getRebootSessionKey(routerIp, cookie);
  await rebootRouter(routerIp, cookie, sessionKey);

  output({ routerIp, status: 'rebooting' });
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
