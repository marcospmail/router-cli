import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function discoverRouter(): Promise<string> {
  // Prefer Wi-Fi interface gateway (avoids VPN overriding default route)
  try {
    const { stdout } = await execAsync('networksetup -getinfo Wi-Fi');
    const match = stdout.match(/^Router:\s+([\d.]+)/m);
    if (match) return match[1];
  } catch {}

  // Fallback to default gateway
  const { stdout } = await execAsync('route -n get default');
  const match = stdout.match(/gateway:\s+([\d.]+)/);
  if (!match) {
    throw new Error('Could not discover router IP from default gateway');
  }
  return match[1];
}
