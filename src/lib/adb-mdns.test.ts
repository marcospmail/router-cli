import { describe, test, expect } from 'bun:test';
import { EventEmitter } from 'events';
import {
  parseBrowseOutput,
  parseResolveOutput,
  parseResolveIpOutput,
  runDnsSd,
  discoverPortViaMdns,
  type SpawnDnsSd,
  type MdnsChildProcess,
} from './adb-mdns.js';

const BROWSE_SAMPLE = [
  'Browsing for _adb-tls-connect._tcp.local.',
  'Timestamp     A/R    Flags  if Domain               Service Type         Instance Name',
  ' 9:39:36.672  Add        2  14 local.               _adb-tls-connect._tcp. adb-RQCY10AFN7L-QvoJUF',
].join('\n');

const RESOLVE_SAMPLE = [
  'Lookup adb-RQCY10AFN7L-QvoJUF._adb-tls-connect._tcp.local.',
  ' 9:39:43.819  adb-RQCY10AFN7L-QvoJUF._adb-tls-connect._tcp.local. can be reached at Android.local.:44669 (interface 14)',
  ' api=36.1 name=SM-S938B v=1',
].join('\n');

const RESOLVE_IP_SAMPLE = [
  'Timestamp     A/R  Flags         IF  Hostname                               Address                                      TTL',
  ' 9:52:25.100  Add  40000002      14  Android.local.                         192.168.15.12                                120',
].join('\n');

// Parsers

describe('parseBrowseOutput', () => {
  test('parses a single instance from real dns-sd -B output', () => {
    expect(parseBrowseOutput(BROWSE_SAMPLE)).toEqual(['adb-RQCY10AFN7L-QvoJUF']);
  });

  test('parses multiple instances', () => {
    const multi = BROWSE_SAMPLE + '\n 9:40:01.000  Add        2  14 local.               _adb-tls-connect._tcp. adb-OTHERDEVICE123';
    expect(parseBrowseOutput(multi)).toEqual(['adb-RQCY10AFN7L-QvoJUF', 'adb-OTHERDEVICE123']);
  });

  test('ignores Rmv (removal) lines', () => {
    const withRmv = BROWSE_SAMPLE + '\n 9:40:05.000  Rmv        2  14 local.               _adb-tls-connect._tcp. adb-RQCY10AFN7L-QvoJUF';
    expect(parseBrowseOutput(withRmv)).toEqual(['adb-RQCY10AFN7L-QvoJUF']);
  });

  test('returns empty array for empty output', () => {
    expect(parseBrowseOutput('')).toEqual([]);
  });

  test('returns empty array for malformed output', () => {
    expect(parseBrowseOutput('not a real dns-sd line\nneither is this')).toEqual([]);
  });

  test('returns empty array when only header/banner lines present', () => {
    const headerOnly = BROWSE_SAMPLE.split('\n').slice(0, 2).join('\n');
    expect(parseBrowseOutput(headerOnly)).toEqual([]);
  });
});

describe('parseResolveOutput', () => {
  test('parses host and port from real dns-sd -L output', () => {
    expect(parseResolveOutput(RESOLVE_SAMPLE)).toEqual({ host: 'Android.local.', port: 44669 });
  });

  test('returns null for empty output', () => {
    expect(parseResolveOutput('')).toBeNull();
  });

  test('returns null for malformed output', () => {
    expect(parseResolveOutput('Lookup failed\nsome other text')).toBeNull();
  });

  test('rejects out-of-range ports (0 and >65535)', () => {
    expect(parseResolveOutput('x can be reached at host.local.:0 (interface 1)')).toBeNull();
    expect(parseResolveOutput('x can be reached at host.local.:70000 (interface 1)')).toBeNull();
  });

  test('prefers the last valid match when dns-sd re-emits an updated line', () => {
    const updated =
      RESOLVE_SAMPLE +
      '\n 9:39:44.000  adb-RQCY10AFN7L-QvoJUF._adb-tls-connect._tcp.local. can be reached at Android.local.:55000 (interface 14)';
    expect(parseResolveOutput(updated)).toEqual({ host: 'Android.local.', port: 55000 });
  });

  test('falls back to the last valid match when the last line is out of range', () => {
    const withInvalidTail = RESOLVE_SAMPLE + '\n x can be reached at Android.local.:99999 (interface 14)';
    expect(parseResolveOutput(withInvalidTail)).toEqual({ host: 'Android.local.', port: 44669 });
  });
});

describe('parseResolveIpOutput', () => {
  test('parses IPv4 address from real dns-sd -G v4 output', () => {
    expect(parseResolveIpOutput(RESOLVE_IP_SAMPLE, 'Android.local.')).toEqual(['192.168.15.12']);
  });

  test('returns empty array for empty output', () => {
    expect(parseResolveIpOutput('', 'Android.local.')).toEqual([]);
  });

  test('returns empty array for malformed output', () => {
    expect(parseResolveIpOutput('Timestamp header only\nno data rows here', 'Android.local.')).toEqual([]);
  });

  test('ignores Rmv lines', () => {
    const rmvOnly = ' 9:52:25.100  Rmv  40000002      14  Android.local.                         192.168.15.12                                120';
    expect(parseResolveIpOutput(rmvOnly, 'Android.local.')).toEqual([]);
  });

  test('excludes rows for a different hostname', () => {
    expect(parseResolveIpOutput(RESOLVE_IP_SAMPLE, 'Other.local.')).toEqual([]);
  });

  test('returns every matching address across multiple interfaces for the same host', () => {
    const twoInterfaces =
      RESOLVE_IP_SAMPLE +
      '\n 9:52:25.300  Add  40000003      15  Android.local.                         10.0.0.7                                     120';
    expect(parseResolveIpOutput(twoInterfaces, 'Android.local.')).toEqual(['192.168.15.12', '10.0.0.7']);
  });
});

// runDnsSd — the process-spawning/timeout/kill mechanics, the only path real dns-sd invocations exercise

interface FakeChildHooks {
  emitStdout: (data: string) => void;
  emitError: (err: Error) => void;
  emitExit: () => void;
  killCount: () => number;
}

function makeFakeChild(): { proc: MdnsChildProcess; hooks: FakeChildHooks } {
  const emitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  let kills = 0;
  const proc: MdnsChildProcess = {
    stdout: { on: stdoutEmitter.on.bind(stdoutEmitter) },
    on: emitter.on.bind(emitter) as MdnsChildProcess['on'],
    kill: () => { kills++; },
  };
  return {
    proc,
    hooks: {
      emitStdout: (data: string) => stdoutEmitter.emit('data', data),
      emitError: (err: Error) => emitter.emit('error', err),
      emitExit: () => emitter.emit('exit'),
      killCount: () => kills,
    },
  };
}

describe('runDnsSd', () => {
  test('resolves via the hard timeout when nothing ever matches, and kills the child exactly once', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;

    const promise = runDnsSd(['-B'], spawnDnsSd, {
      timeoutMs: 20,
      settleMs: 10,
      isMatch: () => false,
    });
    hooks.emitStdout('Browsing for _adb-tls-connect._tcp.local.\n');
    const result = await promise;

    expect(result).toBe('Browsing for _adb-tls-connect._tcp.local.\n');
    expect(hooks.killCount()).toBe(1);
  });

  test('resolves via the settle window once isMatch holds, without waiting for the full timeout', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;

    const promise = runDnsSd(['-B'], spawnDnsSd, {
      timeoutMs: 5000,
      settleMs: 15,
      isMatch: (out) => out.includes('Add'),
    });

    const start = Date.now();
    hooks.emitStdout('9:39:36  Add  2  14 local. _adb-tls-connect._tcp. adb-FIRST\n');
    setTimeout(() => hooks.emitStdout('9:39:36  Add  2  14 local. _adb-tls-connect._tcp. adb-SECOND\n'), 5);

    const result = await promise;
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result).toContain('adb-FIRST');
    expect(result).toContain('adb-SECOND');
    expect(hooks.killCount()).toBe(1);
  });

  test('a chunk boundary that splits a port number mid-digit does not truncate the result, given settleMs > 0', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;

    const promise = runDnsSd(['-L'], spawnDnsSd, {
      timeoutMs: 2000,
      settleMs: 15,
      isMatch: (out) => parseResolveOutput(out) !== null,
    });
    // "446" alone is already a valid port, so isMatch fires early — settleMs lets the rest ("69") land first.
    hooks.emitStdout(' 9:39:43.819  adb-X._adb-tls-connect._tcp.local. can be reached at Android.local.:446');
    setTimeout(() => hooks.emitStdout('69 (interface 14)'), 5);

    const result = await promise;
    expect(parseResolveOutput(result)).toEqual({ host: 'Android.local.', port: 44669 });
  });

  test('resolves immediately on exit with whatever was buffered, and kills the child', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;

    const promise = runDnsSd(['-L'], spawnDnsSd, { timeoutMs: 5000, settleMs: 300, isMatch: () => false });
    hooks.emitStdout('partial output');
    hooks.emitExit();
    const result = await promise;

    expect(result).toBe('partial output');
    expect(hooks.killCount()).toBe(1);
  });

  test('rejects on spawn error (e.g. ENOENT) and still kills the child', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;
    const enoent = Object.assign(new Error('spawn dns-sd ENOENT'), { code: 'ENOENT' });

    const promise = runDnsSd(['-B'], spawnDnsSd, { timeoutMs: 5000, settleMs: 300, isMatch: () => false });
    hooks.emitError(enoent);

    await expect(promise).rejects.toThrow('spawn dns-sd ENOENT');
    expect(hooks.killCount()).toBe(1);
  });

  test('rejects immediately on AbortSignal cancellation, well before the timeout', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;
    const controller = new AbortController();

    const promise = runDnsSd(['-B'], spawnDnsSd, {
      timeoutMs: 5000,
      settleMs: 300,
      isMatch: () => false,
      signal: controller.signal,
    });
    const start = Date.now();
    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow('Cancelled');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(hooks.killCount()).toBe(1);
  });

  test('only settles once even if exit fires after the hard timeout already resolved it', async () => {
    const { proc, hooks } = makeFakeChild();
    const spawnDnsSd: SpawnDnsSd = () => proc;

    const result = await runDnsSd(['-B'], spawnDnsSd, { timeoutMs: 10, settleMs: 10, isMatch: () => false });
    hooks.emitExit();
    hooks.emitExit();

    expect(result).toBe('');
    expect(hooks.killCount()).toBe(1);
  });
});

// discoverPortViaMdns — full orchestration

const FAST_OPTIONS = { platform: 'darwin', browseTimeoutMs: 200, resolveTimeoutMs: 200, settleMs: 10, totalBudgetMs: 5000 };

function makeScriptedSpawnDnsSd(handlers: {
  browse?: (hooks: FakeChildHooks) => void;
  resolve?: (instance: string, hooks: FakeChildHooks) => void;
  resolveIp?: (host: string, hooks: FakeChildHooks) => void;
}, calls: string[][] = []): SpawnDnsSd {
  return (args) => {
    calls.push(args);
    const { proc, hooks } = makeFakeChild();
    // Defer: runDnsSd only attaches its listeners after spawnDnsSd() returns.
    setTimeout(() => {
      if (args[0] === '-B') {
        handlers.browse?.(hooks);
      } else if (args[0] === '-L') {
        handlers.resolve?.(args[1], hooks);
      } else if (args[0] === '-G') {
        handlers.resolveIp?.(args[2], hooks);
      }
    }, 0);
    return proc;
  };
}

describe('discoverPortViaMdns', () => {
  test('returns the port when the resolved IP matches the target', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitStdout(BROWSE_SAMPLE),
      resolve: (_i, h) => h.emitStdout(RESOLVE_SAMPLE),
      resolveIp: (_h, h2) => h2.emitStdout(RESOLVE_IP_SAMPLE),
    });
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: true, port: 44669 });
  });

  test('returns no-ip-match when the resolved IP does not match the target', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitStdout(BROWSE_SAMPLE),
      resolve: (_i, h) => h.emitStdout(RESOLVE_SAMPLE),
      resolveIp: (_h, h2) => h2.emitStdout(RESOLVE_IP_SAMPLE),
    });
    const outcome = await discoverPortViaMdns('10.0.0.99', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'no-ip-match', instanceCount: 1 });
  });

  test('returns no-instances when nothing is found on the network', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitStdout('Browsing for _adb-tls-connect._tcp.local.'),
    });
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'no-instances' });
  });

  test('tries the next instance when the first does not match — proves multi-device correlation actually reaches instance #2', async () => {
    const multiInstanceBrowse =
      BROWSE_SAMPLE + '\n 9:40:01.000  Add        2  14 local.               _adb-tls-connect._tcp. adb-OTHERDEVICE123';
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitStdout(multiInstanceBrowse),
      resolve: (instance, h) => {
        if (instance === 'adb-RQCY10AFN7L-QvoJUF') h.emitStdout(RESOLVE_SAMPLE);
        else if (instance === 'adb-OTHERDEVICE123') {
          h.emitStdout(
            ' 9:41:00.000  adb-OTHERDEVICE123._adb-tls-connect._tcp.local. can be reached at Other.local.:12345 (interface 14)',
          );
        }
      },
      resolveIp: (host, h) => {
        if (host === 'Android.local.') h.emitStdout(RESOLVE_IP_SAMPLE);
        else if (host === 'Other.local.') {
          h.emitStdout(' 9:41:05.000  Add  40000002      14  Other.local.                           10.0.0.50                                    120');
        }
      },
    });

    const start = Date.now();
    const outcome = await discoverPortViaMdns('10.0.0.50', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: true, port: 12345 });
    // must resolve well under the old fixed-6s budget, proving it isn't burning full step timeouts
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('checks every address dns-sd reports for a multi-interface host, not just the first', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitStdout(BROWSE_SAMPLE),
      resolve: (_i, h) => h.emitStdout(RESOLVE_SAMPLE),
      resolveIp: (_host, h) => {
        h.emitStdout(RESOLVE_IP_SAMPLE); // non-WiFi interface first: 192.168.15.12
        setTimeout(
          () => h.emitStdout('\n 9:52:25.300  Add  40000003      15  Android.local.                         10.0.0.7                                     120'),
          2,
        );
      },
    });
    const outcome = await discoverPortViaMdns('10.0.0.7', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: true, port: 44669 });
  });

  test('falls back to binary-unavailable when the dns-sd binary is missing (ENOENT)', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitError(Object.assign(new Error('spawn dns-sd ENOENT'), { code: 'ENOENT' })),
    });
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'binary-unavailable' });
  });

  test('falls back to browse-failed (not binary-unavailable) for a spawn error that is not ENOENT', async () => {
    const spawnDnsSd = makeScriptedSpawnDnsSd({
      browse: (h) => h.emitError(Object.assign(new Error('spawn dns-sd EACCES'), { code: 'EACCES' })),
    });
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'browse-failed' });
  });

  test('returns budget-exceeded when the total mDNS budget runs out between instances', async () => {
    const multiInstanceBrowse =
      BROWSE_SAMPLE + '\n 9:40:01.000  Add        2  14 local.               _adb-tls-connect._tcp. adb-OTHERDEVICE123';
    const calls: string[][] = [];
    const spawnDnsSd = makeScriptedSpawnDnsSd(
      {
        browse: (h) => h.emitStdout(multiInstanceBrowse),
        resolve: () => {}, // never matches -> first instance exhausts its step timeout
      },
      calls,
    );
    const outcome = await discoverPortViaMdns('10.0.0.50', undefined, {
      spawnDnsSd,
      platform: 'darwin',
      browseTimeoutMs: 40,
      resolveTimeoutMs: 40,
      settleMs: 5,
      totalBudgetMs: 30,
    });
    expect(outcome).toEqual({ found: false, reason: 'budget-exceeded', instanceCount: 2 });
    // only the browse + first instance's resolve should have been attempted
    expect(calls.filter((c) => c[0] === '-L').length).toBe(1);
  });

  test('propagates cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnDnsSd = makeScriptedSpawnDnsSd({ browse: (h) => h.emitStdout(BROWSE_SAMPLE) });
    await expect(
      discoverPortViaMdns('192.168.15.12', controller.signal, { spawnDnsSd, ...FAST_OPTIONS }),
    ).rejects.toThrow('Cancelled');
  });

  test('returns unsupported-platform on non-darwin without spawning', async () => {
    const calls: string[][] = [];
    const spawnDnsSd = makeScriptedSpawnDnsSd({ browse: (h) => h.emitStdout(BROWSE_SAMPLE) }, calls);
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, {
      spawnDnsSd,
      ...FAST_OPTIONS,
      platform: 'linux',
    });
    expect(outcome).toEqual({ found: false, reason: 'unsupported-platform' });
    expect(calls.length).toBe(0);
  });

  test('filters out instance names with disallowed characters before passing them to dns-sd argv', async () => {
    const browseWithBadInstance =
      'Browsing for _adb-tls-connect._tcp.local.\n 9:40:01.000  Add        2  14 local.               _adb-tls-connect._tcp. adb; rm -rf /';
    const calls: string[][] = [];
    const spawnDnsSd = makeScriptedSpawnDnsSd({ browse: (h) => h.emitStdout(browseWithBadInstance) }, calls);
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'no-instances', rejectedCount: 1 });
    expect(calls.filter((c) => c[0] === '-L').length).toBe(0);
  });

  test('skips a resolved host with disallowed characters instead of passing it to dns-sd argv', async () => {
    const calls: string[][] = [];
    const spawnDnsSd = makeScriptedSpawnDnsSd(
      {
        browse: (h) => h.emitStdout(BROWSE_SAMPLE),
        resolve: (_i, h) =>
          h.emitStdout(' 9:39:43.819  x can be reached at evil.local;whoami:44669 (interface 14)'),
      },
      calls,
    );
    const outcome = await discoverPortViaMdns('192.168.15.12', undefined, { spawnDnsSd, ...FAST_OPTIONS });
    expect(outcome).toEqual({ found: false, reason: 'unresolvable-instances', instanceCount: 1 });
    expect(calls.filter((c) => c[0] === '-G').length).toBe(0);
  });
});
