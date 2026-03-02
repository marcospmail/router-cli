import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ScannedDevice {
  ip: string;
  mac: string;
  status: 'online';
}

export async function pingSweep(subnet: string, onProgress?: (current: number, total: number) => void): Promise<void> {
  const promises: Promise<void>[] = [];
  const total = 254;

  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    const p = execAsync(`ping -c 1 -W 1 ${ip}`)
      .then(() => onProgress?.(i, total))
      .catch(() => onProgress?.(i, total));
    promises.push(p);
  }

  await Promise.all(promises);
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
