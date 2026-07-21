import { spawn } from 'child_process';

const MDNS_SERVICE_TYPE = '_adb-tls-connect._tcp';
const MDNS_DOMAIN = 'local.';
// mDNS is local multicast (single-digit ms for real answers); these upper bounds only matter for the no-answer case.
const MDNS_BROWSE_TIMEOUT_MS = 600;
const MDNS_RESOLVE_TIMEOUT_MS = 750;
const MDNS_SETTLE_MS = 300;
// Outer safety net only — independent of the per-step timeouts above, since steps normally resolve via the settle window.
const MDNS_TOTAL_BUDGET_MS = 6000;

const BROWSE_ADD_LINE_RE = /^\s*\S+\s+Add\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+?)\s*$/;
const RESOLVE_ADDRESS_RE = /can be reached at\s+([^\s:]+):(\d+)/g;
const RESOLVE_IP_ADD_LINE_RE = /^\s*\S+\s+Add\s+\S+\s+\S+\s+(\S+)\s+(\d{1,3}(?:\.\d{1,3}){3})\s+\S+\s*$/;
const MDNS_TOKEN_RE = /^[A-Za-z0-9._-]{1,255}$/;

export interface ResolvedMdnsService {
  host: string;
  port: number;
}

export type MdnsFailureReason =
  | 'unsupported-platform'
  | 'binary-unavailable'
  | 'browse-failed'
  | 'no-instances'
  | 'unresolvable-instances'
  | 'no-ip-match'
  | 'budget-exceeded';

export type MdnsOutcome =
  | { found: true; port: number }
  | { found: false; reason: 'unsupported-platform' | 'binary-unavailable' | 'browse-failed' }
  | { found: false; reason: 'no-instances'; rejectedCount?: number }
  | { found: false; reason: 'unresolvable-instances' | 'no-ip-match' | 'budget-exceeded'; instanceCount: number };

export interface MdnsChildProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): void } | null;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: () => void): void;
  kill(): void;
}

export type SpawnDnsSd = (args: string[]) => MdnsChildProcess;

export interface MdnsDiscoveryOptions {
  spawnDnsSd?: SpawnDnsSd;
  platform?: string;
  browseTimeoutMs?: number;
  resolveTimeoutMs?: number;
  settleMs?: number;
  totalBudgetMs?: number;
}

function defaultSpawnDnsSd(args: string[]): MdnsChildProcess {
  return spawn('dns-sd', args) as unknown as MdnsChildProcess;
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Cancelled');
}

function isValidMdnsToken(token: string): boolean {
  return MDNS_TOKEN_RE.test(token);
}

export interface RunDnsSdOptions {
  timeoutMs: number;
  settleMs: number;
  isMatch: (stdout: string) => boolean;
  signal?: AbortSignal;
}

// dns-sd streams forever for -B/-L/-G, so this resolves on first isMatch (plus settleMs) or on the timeoutMs upper bound — whichever comes first.
export function runDnsSd(args: string[], spawnDnsSd: SpawnDnsSd, opts: RunDnsSdOptions): Promise<string> {
  const { timeoutMs, settleMs, isMatch, signal } = opts;
  return new Promise((resolve, reject) => {
    let child: MdnsChildProcess;
    try {
      child = spawnDnsSd(args);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stdout = '';
    let settled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(hardTimer);
      if (settleTimer) clearTimeout(settleTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { child.kill(); } catch {}
      if (err) reject(err);
      else resolve(stdout);
    };

    const onAbort = () => finish(new Error('Cancelled'));
    signal?.addEventListener('abort', onAbort);

    const hardTimer = setTimeout(() => finish(), timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
      if (!settleTimer && isMatch(stdout)) {
        settleTimer = setTimeout(() => finish(), settleMs);
      }
    });
    child.on('error', (err) => finish(err));
    child.on('exit', () => finish());
  });
}

export function parseBrowseOutput(stdout: string): string[] {
  const instances: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(BROWSE_ADD_LINE_RE);
    if (match) instances.push(match[1]);
  }
  return instances;
}

export function parseResolveOutput(stdout: string): ResolvedMdnsService | null {
  let result: ResolvedMdnsService | null = null;
  RESOLVE_ADDRESS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RESOLVE_ADDRESS_RE.exec(stdout)) !== null) {
    const port = parseInt(match[2], 10);
    if (port >= 1 && port <= 65535) {
      result = { host: match[1], port };
    }
  }
  return result;
}

export function parseResolveIpOutput(stdout: string, expectedHost: string): string[] {
  const addresses: string[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(RESOLVE_IP_ADD_LINE_RE);
    if (match && match[1] === expectedHost) addresses.push(match[2]);
  }
  return addresses;
}

// Returns a discriminated outcome instead of throwing, except AbortSignal cancellation which still propagates as Error('Cancelled').
export async function discoverPortViaMdns(
  ip: string,
  signal?: AbortSignal,
  options: MdnsDiscoveryOptions = {},
): Promise<MdnsOutcome> {
  const {
    spawnDnsSd = defaultSpawnDnsSd,
    platform = process.platform,
    browseTimeoutMs = MDNS_BROWSE_TIMEOUT_MS,
    resolveTimeoutMs = MDNS_RESOLVE_TIMEOUT_MS,
    settleMs = MDNS_SETTLE_MS,
    totalBudgetMs = MDNS_TOTAL_BUDGET_MS,
  } = options;

  if (platform !== 'darwin') return { found: false, reason: 'unsupported-platform' };

  const deadline = Date.now() + totalBudgetMs;
  checkAborted(signal);

  let browseOut: string;
  try {
    browseOut = await runDnsSd(['-B', MDNS_SERVICE_TYPE, MDNS_DOMAIN], spawnDnsSd, {
      timeoutMs: browseTimeoutMs,
      settleMs,
      isMatch: (out) => parseBrowseOutput(out).length > 0,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Cancelled') throw err;
    const isEnoent = err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
    return { found: false, reason: isEnoent ? 'binary-unavailable' : 'browse-failed' };
  }

  const rawInstances = parseBrowseOutput(browseOut);
  const instances = rawInstances.filter(isValidMdnsToken);
  if (instances.length === 0) {
    const rejectedCount = rawInstances.length;
    return rejectedCount > 0 ? { found: false, reason: 'no-instances', rejectedCount } : { found: false, reason: 'no-instances' };
  }

  let anyResolved = false;

  for (const instance of instances) {
    if (Date.now() >= deadline) return { found: false, reason: 'budget-exceeded', instanceCount: instances.length };
    checkAborted(signal);

    let resolveOut: string;
    try {
      resolveOut = await runDnsSd(['-L', instance, MDNS_SERVICE_TYPE, MDNS_DOMAIN], spawnDnsSd, {
        timeoutMs: resolveTimeoutMs,
        settleMs,
        isMatch: (out) => parseResolveOutput(out) !== null,
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') throw err;
      continue;
    }
    const resolved = parseResolveOutput(resolveOut);
    if (!resolved || !isValidMdnsToken(resolved.host)) continue;
    anyResolved = true;

    if (Date.now() >= deadline) return { found: false, reason: 'budget-exceeded', instanceCount: instances.length };
    checkAborted(signal);

    let ipOut: string;
    try {
      ipOut = await runDnsSd(['-G', 'v4', resolved.host], spawnDnsSd, {
        timeoutMs: resolveTimeoutMs,
        settleMs,
        isMatch: (out) => parseResolveIpOutput(out, resolved.host).length > 0,
        signal,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'Cancelled') throw err;
      continue;
    }
    if (parseResolveIpOutput(ipOut, resolved.host).includes(ip)) {
      return { found: true, port: resolved.port };
    }
  }

  return anyResolved
    ? { found: false, reason: 'no-ip-match', instanceCount: instances.length }
    : { found: false, reason: 'unresolvable-instances', instanceCount: instances.length };
}
