import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export async function discoverRouter(): Promise<string> {
  if (process.platform === 'darwin') {
    return discoverRouterMacOS();
  }
  return discoverRouterLinux();
}

async function discoverRouterMacOS(): Promise<string> {
  // Enumerate network services to find router IP, avoiding VPN default-route overrides.
  try {
    const { stdout: servicesOut } = await execAsync('networksetup -listallnetworkservices');
    // First line is a header ("An asterisk (*)..."), disabled services start with '*'
    const services = servicesOut
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('*') && !s.startsWith('An asterisk'));

    for (const service of services) {
      try {
        const { stdout } = await execFileAsync('networksetup', ['-getinfo', service]);
        const match = stdout.match(/^Router:\s+([\d.]+)/m);
        if (match) return match[1];
      } catch {}
    }
  } catch {}

  // Fall back to default gateway via route
  const { stdout } = await execAsync('route -n get default');
  const match = stdout.match(/gateway:\s+([\d.]+)/);
  if (!match) {
    throw new Error('Could not discover router IP from default gateway');
  }
  return match[1];
}

async function discoverRouterLinux(): Promise<string> {
  const { stdout } = await execAsync('ip route show default');
  const match = stdout.match(/default via ([\d.]+)/);
  if (!match) {
    throw new Error('Could not discover router IP from default gateway');
  }
  return match[1];
}
