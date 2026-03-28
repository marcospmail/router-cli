import React, { useState } from 'react';
import { Text, Box, useApp, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { Devices } from '../commands/Devices.js';
import { Logs } from '../commands/Logs.js';
import { Firewall } from '../commands/Firewall.js';
import { WanStatus } from '../commands/WanStatus.js';
import { Wifi } from '../commands/Wifi.js';
import { Reboot } from '../commands/Reboot.js';
import { AdbConnect } from '../commands/AdbConnect.js';

interface AppProps {
  command: string;
}

const menuItems = [
  { label: '[d] List connected devices (DHCP)', value: 'devices', key: 'd' },
  { label: '[w] WiFi clients', value: 'wifi', key: 'w' },
  { label: '[s] Router status (WAN/device info)', value: 'status', key: 's' },
  { label: '[l] System logs', value: 'logs', key: 'l' },
  { label: '[f] Firewall rules', value: 'firewall', key: 'f' },
  { label: '[a] ADB connect (Android devices)', value: 'adb', key: 'a' },
  { label: '[r] Reboot router', value: 'reboot', key: 'r' },
  { label: '[h] Help (available commands)', value: 'help', key: 'h' },
  { label: '[q] Quit', value: 'quit', key: 'q' },
];

const shortcuts: Record<string, string> = Object.fromEntries(
  menuItems.map((item) => [item.key, item.value])
);

function Menu() {
  const { exit } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (item: { value: string }) => {
    if (item.value === 'quit') {
      exit();
      return;
    }
    setSelected(item.value);
  };

  useInput((input) => {
    if (selected) return;
    const command = shortcuts[input];
    if (command) handleSelect({ value: command });
  });

  const handleBack = () => setSelected(null);

  if (selected) {
    return <CommandView command={selected} onBack={handleBack} />;
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">router-cli</Text>
      <Text dimColor>CLI tool for managing your Vivo router</Text>
      <Text>{''}</Text>
      <SelectInput items={menuItems} onSelect={handleSelect} />
    </Box>
  );
}

function HelpMessage() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">router-cli</Text>
      <Text dimColor>CLI tool for managing your Vivo router</Text>
      <Text>{''}</Text>
      <Text bold>Flags:</Text>
      <Text>  <Text color="green">-d, --devices</Text>    List connected devices via router DHCP</Text>
      <Text>  <Text color="green">-w, --wifi</Text>       Show WiFi clients per band</Text>
      <Text>  <Text color="green">-s, --status</Text>     Router status (WAN, device info, GPON)</Text>
      <Text>  <Text color="green">-l, --logs</Text>       View system logs</Text>
      <Text>  <Text color="green">-f, --firewall</Text>   View firewall rules</Text>
      <Text>  <Text color="green">-a, --adb</Text>        ADB WiFi connect to Android devices</Text>
      <Text>  <Text color="green">-r, --reboot</Text>     Reboot the router</Text>
      <Text>  <Text color="green">-h, --help</Text>       Show this help message</Text>
      <Text>  <Text color="green">-v, --version</Text>    Show version</Text>
      <Text>{''}</Text>
      <Text dimColor>Run without arguments for interactive menu.</Text>
    </Box>
  );
}

function CommandView({ command, onBack }: { command: string; onBack?: () => void }) {
  switch (command) {
    case 'devices':
      return <Devices onBack={onBack} />;
    case 'logs':
      return <Logs onBack={onBack} />;
    case 'firewall':
      return <Firewall onBack={onBack} />;
    case 'status':
      return <WanStatus onBack={onBack} />;
    case 'wifi':
      return <Wifi onBack={onBack} />;
    case 'adb':
      return <AdbConnect onBack={onBack} />;
    case 'reboot':
      return <Reboot onBack={onBack} />;
    default:
      return <HelpMessage />;
  }
}

export function App({ command }: AppProps) {
  if (command === 'menu') {
    return <Menu />;
  }
  return <CommandView command={command} />;
}
