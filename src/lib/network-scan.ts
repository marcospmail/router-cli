import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// macOS: ping -W is in milliseconds. Linux: ping -W is in seconds.
const PING_WAIT_1S = process.platform === 'darwin' ? '1000' : '1';

export interface ScannedDevice {
  ip: string;
  mac: string;
  status: 'online';
}

const PING_CONCURRENCY = 50;
const HOST_TOTAL = 254;

export async function pingSweep(subnet: string, onProgress?: (current: number, total: number) => void): Promise<void> {
  const ips = Array.from({ length: HOST_TOTAL }, (_, i) => `${subnet}.${i + 1}`);
  let completed = 0;

  for (let i = 0; i < ips.length; i += PING_CONCURRENCY) {
    const batch = ips.slice(i, i + PING_CONCURRENCY);
    await Promise.all(
      batch.map(async (ip) => {
        try {
          await execAsync(`ping -c 1 -W ${PING_WAIT_1S} ${ip}`);
        } catch {}
        completed++;
        if (onProgress) onProgress(completed, HOST_TOTAL);
      })
    );
  }
}

export async function getArpTable(): Promise<ScannedDevice[]> {
  const { stdout } = await execAsync('arp -an');
  const devices: ScannedDevice[] = [];

  for (const line of stdout.split('\n')) {
    const match = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-f:]+)/i);
    if (match && match[2] !== '(incomplete)' && match[2] !== 'ff:ff:ff:ff:ff:ff') {
      devices.push({
        ip: match[1],
        mac: match[2],
        status: 'online',
      });
    }
  }

  return devices;
}
