export const DEVICES: Record<string, { name: string; category: string }> = {
  '1': { name: 'Vivo Router', category: 'Infra' },
  '10': { name: 'Desktop PC (Marcos)', category: 'Personal' },
  '11': { name: 'MacBook (Marcos)', category: 'Personal' },
  '12': { name: 'Samsung S25 Ultra', category: 'Personal' },
  '13': { name: 'Google Pixel 9 Pro', category: 'Personal' },
  '14': { name: 'iPhone (Marcos)', category: 'Personal' },
  '15': { name: 'Samsung Galaxy Tab S9', category: 'Personal' },
  '16': { name: 'Samsung Galaxy Watch 7', category: 'Personal' },
  '20': { name: 'PlayStation 5', category: 'Entertainment' },
  '21': { name: 'LG Smart TV', category: 'Entertainment' },
  '30': { name: 'Smart Plug (TV Room Lights)', category: 'Plug' },
  '31': { name: 'Smart Plug (Kitchen Camera)', category: 'Plug' },
  '32': { name: 'Smart Plug (Room Camera)', category: 'Plug' },
  '33': { name: 'Smart Plug (Humidifier)', category: 'Plug' },
  '34': { name: 'Smart Plug (AC)', category: 'Plug' },
  '40': { name: 'Camera (Kitchen)', category: 'Camera' },
  '41': { name: 'Camera (Room)', category: 'Camera' },
  '50': { name: 'Infrared Device (Room)', category: 'IoT' },
  '51': { name: 'Infrared Device (TV Room)', category: 'IoT' },
  '52': { name: 'Cat Feeder', category: 'IoT' },
  '53': { name: 'Xiaomi Robot Vacuum', category: 'IoT' },
};

export function getDeviceInfo(ip: string): { name: string; category: string } | undefined {
  const lastOctet = ip.split('.').pop();
  if (!lastOctet) return undefined;
  return DEVICES[lastOctet];
}
