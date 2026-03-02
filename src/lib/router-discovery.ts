import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function discoverRouter(): Promise<string> {
  const { stdout } = await execAsync('route -n get default');
  const match = stdout.match(/gateway:\s+([\d.]+)/);
  if (!match) {
    throw new Error('Could not discover router IP from default gateway');
  }
  return match[1];
}
