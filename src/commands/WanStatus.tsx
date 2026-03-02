import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { Status } from '../components/Status.js';
import { CredentialPrompt } from '../components/CredentialPrompt.js';
import { BackPrompt } from '../components/BackPrompt.js';
import { discoverRouter } from '../lib/router-discovery.js';
import {
  login,
  getWanStatus,
  getRouterDeviceInfo,
  getDhcpConfig,
  type WanStatus as WanStatusData,
  type RouterDeviceInfo,
  type DhcpConfig,
} from '../lib/router-auth.js';
import { getCredentials, saveCredentials } from '../lib/credentials.js';

type Phase = 'check-creds' | 'prompt-creds' | 'discover' | 'auth' | 'fetch' | 'done' | 'error';

export function WanStatus({ onBack }: { onBack?: () => void }) {
  const [phase, setPhase] = useState<Phase>('check-creds');
  const [routerIp, setRouterIp] = useState('');
  const [wan, setWan] = useState<WanStatusData | null>(null);
  const [device, setDevice] = useState<RouterDeviceInfo | null>(null);
  const [dhcp, setDhcp] = useState<DhcpConfig | null>(null);
  const [error, setError] = useState('');

  const runWithCreds = async (username: string, password: string, isNew: boolean) => {
    try {
      setPhase('discover');
      const ip = await discoverRouter();
      setRouterIp(ip);

      setPhase('auth');
      const cookie = await login(ip, { username, password });
      if (isNew) saveCredentials({ username, password });

      setPhase('fetch');
      const [wanData, deviceData, dhcpData] = await Promise.all([
        getWanStatus(ip, cookie),
        getRouterDeviceInfo(ip, cookie),
        getDhcpConfig(ip, cookie),
      ]);

      setWan(wanData);
      setDevice(deviceData);
      setDhcp(dhcpData);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
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

  if (phase !== 'done' || !wan || !device || !dhcp) {
    return (
      <Box flexDirection="column">
        <Status label="Discovering router" state={phase === 'discover' ? 'loading' : routerIp ? 'success' : 'info'} detail={routerIp} />
        {(phase === 'auth' || phase === 'fetch') && <Status label="Authenticating" state={phase === 'auth' ? 'loading' : 'success'} />}
        {phase === 'fetch' && <Status label="Fetching router status" state="loading" />}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Status label="Router" state="success" detail={routerIp} />

      <Text bold color="cyan">{'\n'}Device</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>Model:     <Text color="white" bold>{device.vendor} {device.model}</Text></Text>
        <Text>Firmware:  <Text color="white">{device.softwareVersion}</Text></Text>
        <Text>Hardware:  <Text color="white">{device.hardwareVersion}</Text></Text>
        <Text>Serial:    <Text dimColor>{device.serialNumber}</Text></Text>
        <Text>WAN MAC:   <Text dimColor>{device.wanMac}</Text></Text>
        <Text>LAN MAC:   <Text dimColor>{device.lanMac}</Text></Text>
      </Box>

      <Text bold color="cyan">{'\n'}WAN Connection</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>GPON:      <Text color="green" bold>{wan.gponStatus}</Text></Text>
        <Text>Optical:   <Text dimColor>TX {wan.opticalPower.tx}  RX {wan.opticalPower.rx}</Text></Text>
        <Text>IPv4:      <Text color="white" bold>{wan.ipv4Address}</Text></Text>
        <Text>Gateway:   <Text dimColor>{wan.ipv4Gateway}</Text></Text>
        <Text>DNS:       <Text dimColor>{wan.dns4.join(', ')}</Text></Text>
        {wan.ipv6Address && <Text key="ipv6">IPv6:      <Text color="white">{wan.ipv6Address}</Text></Text>}
        {wan.ipv6Address && <Text key="ipv6gw">v6 GW:     <Text dimColor>{wan.ipv6Gateway}</Text></Text>}
        {wan.ipv6Address && <Text key="ipv6dns">v6 DNS:    <Text dimColor>{wan.dns6.join(', ')}</Text></Text>}
      </Box>

      <Text bold color="cyan">{'\n'}DHCP Server</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>Status:    <Text color={dhcp.enabled ? 'green' : 'red'} bold>{dhcp.enabled ? 'Enabled' : 'Disabled'}</Text></Text>
        <Text>Router IP: <Text color="white">{dhcp.routerIp}</Text></Text>
        <Text>Net Mask:  <Text dimColor>{dhcp.netMask}</Text></Text>
        <Text>Range:     <Text color="white">{dhcp.rangeStart}</Text> — <Text color="white">{dhcp.rangeEnd}</Text></Text>
        <Text>DNS:       <Text color="white">{dhcp.primaryDns}</Text>{dhcp.secondaryDns ? <Text dimColor> / {dhcp.secondaryDns}</Text> : null}</Text>
        <Text>Lease:     <Text dimColor>{dhcp.leaseTimeMinutes} minutes</Text></Text>
      </Box>

      <Text bold color="cyan">{'\n'}Ethernet Ports</Text>
      <Box marginLeft={2}>
        {wan.ethernetPorts.map((p, i) => (
          <Box key={`eth-${i}-${p.port}`} marginRight={2}>
            <Text>Port {p.port}: <Text color={p.connected ? 'green' : 'red'}>{p.connected ? 'Connected' : 'Disconnected'}</Text></Text>
          </Box>
        ))}
      </Box>

      <Text bold color="cyan">{'\n'}WiFi</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>2.4GHz:    <Text color={wan.wifi24.enabled ? 'green' : 'red'}>{wan.wifi24.enabled ? 'On' : 'Off'}</Text>  SSID: <Text color="white">{wan.wifi24.ssid}</Text>  Ch: <Text dimColor>{wan.wifi24.channel}</Text></Text>
        <Text>5GHz:      <Text color={wan.wifi5.enabled ? 'green' : 'red'}>{wan.wifi5.enabled ? 'On' : 'Off'}</Text>  SSID: <Text color="white">{wan.wifi5.ssid}</Text>  Ch: <Text dimColor>{wan.wifi5.channel}</Text></Text>
      </Box>

      <BackPrompt onBack={onBack} />
    </Box>
  );
}
