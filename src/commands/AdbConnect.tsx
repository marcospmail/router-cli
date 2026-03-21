import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { Status } from '../components/Status.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import { login, getDhcpLeases } from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';
import { getDeviceInfo } from '../lib/devices.js';
import { connectAdbWifi, type AdbProgress } from '../lib/adb-wifi.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'connecting' | 'done' | 'error';

const ANDROID_PATTERNS = ['S25', 'Pixel', 'Tab S9'];

interface AndroidDevice {
  ip: string;
  name: string;
  status: 'pending' | 'connecting' | 'done' | 'error';
  adbPhase?: string;
  detail?: string;
  permissionDetail?: string;
}

export function AdbConnect({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [error, setError] = useState('');
  const abortRef = useRef(new AbortController());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current.abort();
    };
  }, []);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      abortRef.current.abort();
      onBack?.();
    }
  });

  const safeSetPhase = (p: Phase) => { if (mountedRef.current) setPhase(p); };
  const safeSetDevices = (fn: Parameters<typeof setDevices>[0]) => { if (mountedRef.current) setDevices(fn); };
  const safeSetError = (e: string) => { if (mountedRef.current) setError(e); };
  const safeSetRouterIp = (ip: string) => { if (mountedRef.current) setRouterIp(ip); };

  const runWithCreds = async (username: string, password: string, isNew: boolean) => {
    try {
      safeSetPhase('discover');
      const ip = await discoverRouter();
      safeSetRouterIp(ip);

      safeSetPhase('auth');
      const cookie = await login(ip, { username, password });
      if (isNew) saveCredentials({ username, password });

      safeSetPhase('fetch');
      const leases = await getDhcpLeases(ip, cookie);

      // Filter to Android devices only
      const androidDevices: AndroidDevice[] = [];
      for (const lease of leases) {
        const info = getDeviceInfo(lease.ip);
        if (!info) continue;
        const isAndroid = ANDROID_PATTERNS.some((p) => info.name.includes(p));
        if (isAndroid) {
          androidDevices.push({
            ip: lease.ip,
            name: info.name,
            status: 'pending',
          });
        }
      }

      if (androidDevices.length === 0) {
        safeSetError('No Android devices found on the network');
        safeSetPhase('error');
        return;
      }

      safeSetDevices(androidDevices);
      safeSetPhase('connecting');

      // Connect to all devices in parallel
      await Promise.all(
        androidDevices.map((dev, i) => {
          safeSetDevices((prev) =>
            prev.map((d, idx) => (idx === i ? { ...d, status: 'connecting' } : d)),
          );

          return connectAdbWifi(dev.ip, (progress) => {
            safeSetDevices((prev) =>
              prev.map((d, idx) => {
                if (idx !== i) return d;
                const update: Partial<AndroidDevice> = { adbPhase: progress.phase, detail: progress.detail };
                if (progress.phase === 'granting-permissions') {
                  update.permissionDetail = progress.detail;
                } else if (progress.phase === 'done') {
                  update.permissionDetail = undefined;
                }
                return { ...d, ...update };
              }),
            );
          }, abortRef.current.signal)
            .then(() => {
              safeSetDevices((prev) =>
                prev.map((d, idx) => (idx === i ? { ...d, status: 'done' } : d)),
              );
            })
            .catch((err) => {
              safeSetDevices((prev) =>
                prev.map((d, idx) =>
                  idx === i
                    ? { ...d, status: 'error', detail: err instanceof Error ? err.message : String(err) }
                    : d,
                ),
              );
            });
        }),
      );

      safeSetPhase('done');
    } catch (err) {
      safeSetError(err instanceof Error ? err.message : String(err));
      safeSetPhase('error');
    }
  };

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      runWithCreds(creds.username, creds.password, false);
    } else {
      setPhase('prompt-creds');
    }
  }, []);

  const handleCredentials = (username: string, password: string) => {
    runWithCreds(username, password, true);
  };

  if (phase === 'prompt-creds') {
    return <CredentialPrompt onSubmit={handleCredentials} />;
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column">
        <Status label={error} state="error" />
        <BackPrompt onBack={onBack} />
      </Box>
    );
  }

  const adbPhaseLabel = (dev: AndroidDevice): string => {
    switch (dev.adbPhase) {
      case 'checking-5555': return 'Checking port 5555';
      case 'scanning': return dev.detail ? `Scanning ${dev.detail}` : 'Scanning for debug port';
      case 'connecting': return dev.detail ?? 'Connecting';
      case 'switching': return 'Switching to port 5555';
      case 'finalizing': return 'Finalizing connection';
      case 'granting-permissions': return 'Granting permissions';
      case 'done': return dev.detail ?? 'Connected';
      case 'error': return dev.detail ?? 'Failed';
      default: return 'Waiting';
    }
  };

  return (
    <Box flexDirection="column">
      <Status label="Router" state={routerIp ? 'success' : 'loading'} detail={routerIp} />
      {(phase === 'discover') && <Status label="Discovering router" state="loading" />}
      {(phase === 'auth') && <Status label="Authenticating" state="loading" />}
      {(phase === 'fetch') && <Status label="Fetching devices" state="loading" />}

      {devices.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="cyan">Android Devices ({devices.length})</Text>
          {devices.map((dev) => (
            <Box key={dev.ip} marginTop={1} flexDirection="column">
              <Status
                label={`${dev.name} (${dev.ip})`}
                state={
                  dev.status === 'done' ? 'success' :
                  dev.status === 'error' ? 'error' :
                  dev.status === 'connecting' ? 'loading' : 'info'
                }
                detail={dev.status === 'pending' ? 'Waiting' : adbPhaseLabel(dev)}
              />
              {dev.permissionDetail && (
                <Text dimColor>    └ {dev.permissionDetail}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {phase === 'done' && <BackPrompt onBack={onBack} />}
    </Box>
  );
}
