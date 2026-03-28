import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SYNC_API_URL = 'https://api.marcosp.com/sync/send';

const SYNC_DEVICE_MAP: Record<string, string> = {
  'S25': 's25',
  'Pixel': 'Pixel',
  'Tab S9': 'Tab',
};

let cachedApiKey: string | undefined;

function getSyncApiKey(): string {
  if (cachedApiKey) return cachedApiKey;

  let envFile: string;
  try {
    envFile = readFileSync(join(homedir(), '.env'), 'utf-8');
  } catch {
    throw new Error('~/.env file not found. Create it with SYNC_API_KEY=your_key');
  }

  const match = envFile.match(/^SYNC_API_KEY=(.+)$/m);
  if (!match) throw new Error('SYNC_API_KEY not found in ~/.env');
  cachedApiKey = match[1].trim().replace(/^["']|["']$/g, '');
  return cachedApiKey;
}

export function getSyncDeviceName(dhcpName: string): string | undefined {
  for (const [pattern, syncName] of Object.entries(SYNC_DEVICE_MAP)) {
    if (dhcpName.includes(pattern)) return syncName;
  }
  return undefined;
}

async function triggerTaskerTask(taskName: string, syncDevice: string): Promise<void> {
  const apiKey = getSyncApiKey();
  const response = await fetch(SYNC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      content: `:trigger:${taskName}`,
      devices: [syncDevice],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tasker trigger failed: ${response.status} ${text}`);
  }
}

export async function enableWirelessDebugging(syncDevice: string): Promise<void> {
  await triggerTaskerTask('Enable wireless debugging', syncDevice);
}

export async function disableWirelessDebugging(syncDevice: string): Promise<void> {
  await triggerTaskerTask('Disable wireless debugging', syncDevice);
}
