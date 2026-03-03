import Conf from 'conf';

interface DeviceEntry {
  name: string;
  category: string;
}

const config = new Conf<{ devices: Record<string, DeviceEntry> }>({
  projectName: 'router-cli',
  configName: 'devices',
  defaults: {
    devices: {},
  },
});

export function getDeviceInfo(ip: string): DeviceEntry | undefined {
  const lastOctet = ip.split('.').pop();
  if (!lastOctet) return undefined;
  const devices = config.get('devices');
  return devices[lastOctet];
}

export function getAllDevices(): Record<string, DeviceEntry> {
  return config.get('devices');
}

export function getDevicesConfigPath(): string {
  return config.path;
}
