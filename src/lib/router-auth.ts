import type { Credentials } from './credentials.js';

function xorEncode(str: string): string {
  return Array.from(str)
    .map((c) => String.fromCharCode(c.charCodeAt(0) ^ 0x1f))
    .join('');
}

export async function login(routerIp: string, creds: Credentials): Promise<string> {
  // Step 1: Get session cookie
  const loginPageRes = await fetch(`http://${routerIp}/login.asp`);
  const cookies = loginPageRes.headers.getSetCookie();
  const sessionCookie = cookies.find((c) => c.includes('_httpdSessionId_'));
  if (!sessionCookie) {
    throw new Error('Failed to get session cookie from router');
  }
  const cookieValue = sessionCookie.split(';')[0];

  // Step 2: POST encoded credentials
  const encodedUser = xorEncode(creds.username);
  const encodedPass = xorEncode(creds.password);
  const body = new URLSearchParams({
    curWebPage: '/index.asp',
    loginUsername: encodedUser,
    loginPassword: encodedPass,
  });

  await fetch(`http://${routerIp}/cgi-bin/te_acceso_router.cgi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `http://${routerIp}/login.asp`,
      Cookie: cookieValue,
    },
    body: body.toString(),
  });

  // Step 3: Verify login by checking we don't get redirected back to login
  const verifyRes = await fetch(`http://${routerIp}/settings-local-network.asp`, {
    headers: { Cookie: cookieValue },
  });
  const verifyBody = await verifyRes.text();
  if (!verifyRes.ok || verifyBody.includes('loginUsername')) {
    throw new Error('Authentication failed — invalid credentials');
  }

  return cookieValue;
}

export async function getDhcpLeases(routerIp: string, cookie: string): Promise<DhcpLease[]> {
  let res: Response;
  try {
    res = await fetch(`http://${routerIp}/cgi-bin/sv_getvar.cmd?varName=dhcpLease`, {
      headers: {
        Referer: `http://${routerIp}/settings-local-network.asp`,
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookie,
      },
    });
  } catch (err) {
    throw new Error('Failed to fetch DHCP leases — credentials may be incorrect');
  }
  if (!res.ok) {
    throw new Error('Failed to fetch DHCP leases — credentials may be incorrect');
  }
  const text = await res.text();
  return parseDhcpLeases(text);
}

export interface DhcpLease {
  iid: string;
  hostname: string;
  mac: string;
  ip: string;
  leaseSeconds: number;
  group: string;
  flag: string;
}

function parseDhcpLeases(raw: string): DhcpLease[] {
  return raw
    .split('|')
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => {
      const [iid, hostname, mac, ip, leaseSeconds, , group, flag] = entry.split('/');
      return {
        iid,
        hostname,
        mac,
        ip,
        leaseSeconds: parseInt(leaseSeconds, 10),
        group,
        flag,
      };
    })
    .filter((lease) => lease.leaseSeconds > 0);
}

export async function getRebootSessionKey(routerIp: string, cookie: string): Promise<string> {
  const res = await fetch(`http://${routerIp}/popup-reboot.asp`, {
    headers: {
      Referer: `http://${routerIp}/device-management-resets.asp`,
      Cookie: cookie,
    },
  });
  const html = await res.text();
  const match = html.match(/sessionKey='([^']+)'/);
  if (!match) {
    throw new Error('Failed to extract reboot session key');
  }
  return match[1];
}

export async function rebootRouter(routerIp: string, cookie: string, sessionKey: string): Promise<void> {
  await fetch(`http://${routerIp}/cgi-bin/cbReboot.xml?sessionKey=${sessionKey}`, {
    method: 'POST',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: `http://${routerIp}/popup-reboot.asp`,
      Origin: `http://${routerIp}`,
      Cookie: cookie,
    },
    body: '',
  });
}

// ── Helper: extract inline JS variable from HTML ──

function extractVar(html: string, name: string): string {
  const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*'([^']*)'`));
  return m ? m[1] : '';
}

function fetchPage(routerIp: string, path: string, cookie: string, referer?: string): Promise<Response> {
  return fetch(`http://${routerIp}${path}`, {
    headers: {
      Cookie: cookie,
      Referer: `http://${routerIp}${referer ?? '/index.asp'}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

function postPage(routerIp: string, path: string, cookie: string, referer?: string): Promise<Response> {
  return fetch(`http://${routerIp}${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Referer: `http://${routerIp}${referer ?? '/index.asp'}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: '',
  });
}

// ── System Logs ──

export interface LogEntry {
  date: string;
  domain: string;
  level: string;
  severity: string;
  module: string;
  message: string;
}

// NOTE on sv_setvar.cmd for log retrieval:
// This is the same endpoint the router's web UI calls from device-management-system-logs.asp
// (the loadSysLog/applySetting function). varValue=1 triggers log retrieval, not a config
// change — logging is already enabled on this router. This call is idempotent; repeated
// invocations have no side effects. There is no GET-based alternative for log retrieval
// on this firmware (Askey RTF8225VW).
export async function getSystemLogs(
  routerIp: string,
  cookie: string,
  facility = 'ALL',
  severity = '7',
): Promise<LogEntry[]> {
  const pageRes = await fetchPage(routerIp, '/device-management-system-logs.asp', cookie);
  const pageHtml = await pageRes.text();
  const sessionKey = pageHtml.match(/sessionKey='(\d+)'/)?.[1];
  if (!sessionKey) throw new Error('Failed to get system logs session key');

  const url =
    `/cgi-bin/sv_setvar.cmd?sessionKey=${sessionKey}` +
    `&varName=sysLog&varValue=1&facility=${facility}&severity=${severity}`;
  const res = await postPage(routerIp, url, cookie, '/device-management-system-logs.asp');
  const text = await res.text();

  return parseSystemLogs(text);
}

function parseSystemLogs(raw: string): LogEntry[] {
  // Response is JS code that populates SYSLOG array
  // Format: SYSLOG.push(['date','domain','level','module','message'])
  // Or: var item=[['date','domain','level','module','message'], ...]
  const entries: LogEntry[] = [];
  const re = /\[\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const [levelFull, severityName] = m[3].split('.');
    entries.push({
      date: m[1],
      domain: m[2],
      level: levelFull,
      severity: severityName ?? m[3],
      module: m[4],
      message: m[5],
    });
  }
  return entries;
}

// ── Firewall (READ-ONLY) ──

export interface FirewallRule {
  name: string;
  protocol: string;
  localPort: string;
  localAddress: string;
  action: string;
  remoteAddress: string;
  remotePort: string;
  enabled: boolean;
}

export interface FirewallData {
  defaultPolicy: string;
  echoEnabled: boolean;
  rules: FirewallRule[];
}

const PROTOCOL_MAP: Record<string, string> = {
  '176': 'TCP/UDP',
  '1': 'ICMP',
  '58': 'ICMP',
  '6': 'TCP',
  '17': 'UDP',
};

export async function getFirewallData(routerIp: string, cookie: string): Promise<FirewallData> {
  const pageRes = await fetchPage(routerIp, '/settings-firewall.asp', cookie);
  const html = await pageRes.text();

  const sessionKey = html.match(/sessionKey='(\d+)'/)?.[1];
  if (!sessionKey) throw new Error('Failed to get firewall session key');

  const defaultPolicy = extractVar(html, 'firewallDefaultPolicy') === '1' ? 'Accept' : 'Reject';
  const echoEnabled = extractVar(html, 'firewallEchoEnable') === '1';
  const ruleIndexList = extractVar(html, 'firewallRuleIndexList');
  const intfList = extractVar(html, 'firewallInterfaceList');

  const [wanIntf, lanIntf] = intfList.split(',');

  if (!ruleIndexList) {
    return { defaultPolicy, echoEnabled, rules: [] };
  }

  const ruleIds = ruleIndexList.split('|');

  // Fetch all rules in parallel (action=show is read-only)
  const responses = await Promise.all(
    ruleIds.map((id) => {
      const url = `/cgi-bin/sv_firewall.cmd?action=show&inst=${id}&sessionKey=${sessionKey}`;
      return postPage(routerIp, url, cookie, '/settings-firewall.asp').then((r) => r.text());
    }),
  );

  const rules: FirewallRule[] = [];
  for (const resp of responses) {
    const instMatch = resp.match(/inst=(.+)/);
    if (!instMatch) continue;

    const f = instMatch[1].split(',');
    const name = f[4];
    // Skip reserved system rules
    if (name.includes('Accept traffic from LAN to HSI WAN') || name.includes('GVT_PINHOLE')) continue;

    const actionCode = f[5]; // '1'=accept, '0'=reject
    const dstIntfAll = f[9];
    const srcIntf = f[10];
    const srcIntfAll = f[12];

    let actionStr: string;
    if (dstIntfAll === '1' && srcIntfAll === '1') {
      actionStr = actionCode === '1' ? 'acptBoth' : 'rjctBoth';
    } else if (srcIntf === wanIntf) {
      actionStr = actionCode === '1' ? 'acptRemote' : 'rjctRemote';
    } else {
      actionStr = actionCode === '1' ? 'acptLocal' : 'rjctLocal';
    }

    const protocol = PROTOCOL_MAP[f[20]] ?? f[20];
    const isLocal = actionStr === 'acptLocal' || actionStr === 'rjctLocal';

    const dstAddr = f[14] === '*' ? '*' : f[14] + (f[15] !== '-1' ? `/${f[15]}` : '');
    const srcAddr = f[17] === '*' ? '*' : f[17] + (f[18] !== '-1' ? `/${f[18]}` : '');
    const dstPort = formatPort(f[22], f[23]);
    const srcPort = formatPort(f[25], f[26]);

    const remoteAddress = isLocal ? dstAddr : srcAddr;
    const localAddress = isLocal ? srcAddr : dstAddr;
    const remotePort = isLocal ? dstPort : srcPort;
    const localPort = isLocal ? srcPort : dstPort;

    const actionDisplay = actionStr.startsWith('acpt') ? 'Accept' : 'Reject';
    const dirDisplay = actionStr.includes('Local')
      ? 'from LAN'
      : actionStr.includes('Remote')
        ? 'from WAN'
        : 'both';

    rules.push({
      name,
      protocol,
      localPort,
      localAddress,
      action: `${actionDisplay} ${dirDisplay}`,
      remoteAddress,
      remotePort,
      enabled: f[2] === '1',
    });
  }

  return { defaultPolicy, echoEnabled, rules };
}

function formatPort(port: string, rangeMax: string): string {
  if (port === '-1') return '*';
  if (rangeMax === '-1' || rangeMax === port) return port;
  return `${port}:${rangeMax}`;
}

// ── WAN / Internet Status ──

export interface WanStatus {
  ipv4Address: string;
  ipv4Gateway: string;
  dns4: string[];
  ipv6Address: string;
  ipv6Gateway: string;
  dns6: string[];
  gponStatus: string;
  opticalPower: { tx: string; rx: string };
  ethernetPorts: { port: number; interface: string; connected: boolean }[];
  wifi24: { enabled: boolean; ssid: string; channel: string };
  wifi5: { enabled: boolean; ssid: string; channel: string };
}

export async function getWanStatus(routerIp: string, cookie: string): Promise<WanStatus> {
  const res = await fetchPage(routerIp, '/index_cliente.asp', cookie);
  const html = await res.text();

  const optRaw = extractVar(html, 'opticalPower');
  const txMatch = optRaw.match(/TX:([\d.-]+)/);
  const rxMatch = optRaw.match(/RX:([\d.-]+)/);

  const enetRaw = extractVar(html, 'enetStatus');
  const ethernetPorts = enetRaw
    .split('|')
    .filter(Boolean)
    .map((e) => {
      const [port, intf, status] = e.split(',');
      return { port: parseInt(port, 10) + 1, interface: intf, connected: status === '1' };
    });

  return {
    ipv4Address: extractVar(html, 'pppIpv4Address'),
    ipv4Gateway: extractVar(html, 'pppIpv4Gateway'),
    dns4: extractVar(html, 'dns4').split(',').filter(Boolean),
    ipv6Address: extractVar(html, 'pppIpv6Address'),
    ipv6Gateway: extractVar(html, 'pppIpv6Gateway'),
    dns6: extractVar(html, 'dns6').split(',').filter(Boolean),
    gponStatus: extractVar(html, 'gponStatus'),
    opticalPower: {
      tx: txMatch ? `${parseFloat(txMatch[1]).toFixed(2)} dBm` : 'N/A',
      rx: rxMatch ? `${parseFloat(rxMatch[1]).toFixed(2)} dBm` : 'N/A',
    },
    ethernetPorts,
    wifi24: {
      enabled: extractVar(html, 'wlEnbl_main0') === '1',
      ssid: extractVar(html, 'wlSsid_main0'),
      channel: extractVar(html, 'wlCurrentChannel_main0'),
    },
    wifi5: {
      enabled: extractVar(html, 'wlEnbl_main1') === '1',
      ssid: extractVar(html, 'wlSsid_main1'),
      channel: extractVar(html, 'wlCurrentChannel_main1'),
    },
  };
}

// ── DHCP Configuration ──

export interface DhcpConfig {
  enabled: boolean;
  routerIp: string;
  netMask: string;
  rangeStart: string;
  rangeEnd: string;
  primaryDns: string;
  secondaryDns: string;
  leaseTimeMinutes: number;
}

export async function getDhcpConfig(routerIp: string, cookie: string): Promise<DhcpConfig> {
  const res = await fetchPage(routerIp, '/settings-local-network.asp', cookie);
  const html = await res.text();

  const dnsServers = extractVar(html, 'dhcpDns').split(',');

  // Lease time is declared as: var leaseTime = parseInt(14400/60);
  const leaseMatch = html.match(/var\s+leaseTime\s*=\s*parseInt\((\d+)\/(\d+)\)/);
  const leaseMinutes = leaseMatch ? Math.floor(parseInt(leaseMatch[1], 10) / parseInt(leaseMatch[2], 10)) : 0;

  return {
    enabled: extractVar(html, 'dhcpEnbl') === '1',
    routerIp: extractVar(html, 'lanIp'),
    netMask: extractVar(html, 'lanMask'),
    rangeStart: extractVar(html, 'dhcpStart'),
    rangeEnd: extractVar(html, 'dhcpEnd'),
    primaryDns: dnsServers[0] ?? '',
    secondaryDns: dnsServers[1] ?? '',
    leaseTimeMinutes: leaseMinutes,
  };
}

// ── Device Info ──

export interface RouterDeviceInfo {
  vendor: string;
  model: string;
  softwareVersion: string;
  hardwareVersion: string;
  serialNumber: string;
  wanMac: string;
  lanMac: string;
}

export async function getRouterDeviceInfo(routerIp: string, cookie: string): Promise<RouterDeviceInfo> {
  const res = await fetchPage(routerIp, '/about-power-box.asp', cookie);
  const html = await res.text();

  // Extract from HTML table cells: label in first <td>, value in second <td>
  const cellPairs = [...html.matchAll(/<td[^>]*>\s*(.*?)\s*<\/td>\s*<td[^>]*>\s*(.*?)\s*<\/td>/gs)];
  const data: Record<string, string> = {};
  for (const [, label, value] of cellPairs) {
    const cleanLabel = label.replace(/<[^>]+>/g, '').trim().replace(/:$/, '');
    const cleanValue = value.replace(/<[^>]+>/g, '').trim();
    if (cleanLabel && cleanValue) data[cleanLabel] = cleanValue;
  }

  return {
    vendor: data['Vendor'] ?? '',
    model: data['Model'] ?? '',
    softwareVersion: data['Software Version'] ?? '',
    hardwareVersion: data['Hardware Version'] ?? '',
    serialNumber: data['Serial Number'] ?? '',
    wanMac: data['WAN MAC Address'] ?? '',
    lanMac: data['LAN MAC Address'] ?? '',
  };
}

// ── WiFi Clients ──

export interface WifiClient {
  mac: string;
  band: '2.4GHz' | '5GHz';
  connectedTime: string;
  hostname: string;
  ip: string;
}

export async function getWifiClients(routerIp: string, cookie: string): Promise<WifiClient[]> {
  // Fetch stats page (wifi client MACs) and index page (host list) in parallel
  const [statsRes, indexRes] = await Promise.all([
    fetchPage(routerIp, '/device-management-statistics.asp', cookie),
    fetchPage(routerIp, '/index_cliente.asp', cookie),
  ]);
  const [statsHtml, indexHtml] = await Promise.all([statsRes.text(), indexRes.text()]);

  // Build MAC → {hostname, ip} map from mngHostList
  const hostMap = new Map<string, { hostname: string; ip: string }>();
  const hostList = extractVar(indexHtml, 'mngHostList');
  for (const entry of hostList.split('|')) {
    const parts = entry.split('/');
    if (parts.length >= 4) {
      const mac = parts[2].toLowerCase();
      hostMap.set(mac, { hostname: parts[1], ip: parts[3] });
    }
  }

  const clients: WifiClient[] = [];

  const parse = (raw: string, band: '2.4GHz' | '5GHz') => {
    if (!raw) return;
    for (const entry of raw.split('/')) {
      if (!entry.trim()) continue;
      const [mac, timeStr] = entry.split(',');
      if (!mac) continue;
      const host = hostMap.get(mac.toLowerCase());
      clients.push({
        mac: mac.toUpperCase(),
        band,
        connectedTime: formatConnectedTime(timeStr),
        hostname: host?.hostname ?? '—',
        ip: host?.ip ?? '—',
      });
    }
  };

  parse(extractVar(statsHtml, 'wlan5GAssociatedList'), '5GHz');
  parse(extractVar(statsHtml, 'wlan2dot4GAssociatedList'), '2.4GHz');

  return clients;
}

function formatConnectedTime(raw: string): string {
  if (!raw) return '—';
  const parts = raw.split(':').map(Number);
  if (parts.length !== 4) return raw;
  const [days, hours, minutes, seconds] = parts;
  const segs: string[] = [];
  if (days > 0) segs.push(`${days}d`);
  if (hours > 0) segs.push(`${hours}h`);
  if (minutes > 0) segs.push(`${minutes}m`);
  if (segs.length === 0) segs.push(`${seconds}s`);
  return segs.join(' ');
}

