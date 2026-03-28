# router-cli

CLI tool for managing a Vivo router (Askey RTF8225VW firmware). Provides a rich terminal UI (TUI) via [Ink](https://github.com/vadimdemedes/ink) and a structured JSON output mode for automation.

## Installation

```bash
pnpm install
pnpm build
pnpm link --global
```

## Usage

### Interactive menu

```bash
router-cli
```

Launches an interactive menu. Press a single key to navigate:

| Key | Command                        |
|-----|--------------------------------|
| `d` | List connected devices (DHCP)  |
| `w` | WiFi clients per band          |
| `s` | Router status (WAN/device info)|
| `l` | System logs                    |
| `f` | Firewall rules                 |
| `a` | ADB WiFi connect               |
| `r` | Reboot router                  |
| `q` | Quit                           |

### Command flags

Run a specific command directly, bypassing the menu:

| Flag                | Description                                              |
|---------------------|----------------------------------------------------------|
| `-d`, `--devices`   | List connected devices from router DHCP leases           |
| `-w`, `--wifi`      | Show WiFi clients per band (2.4 GHz / 5 GHz)            |
| `-s`, `--status`    | Router status: WAN IP, GPON, optical power, ports        |
| `-l`, `--logs`      | View system logs with severity info                      |
| `-f`, `--firewall`  | View firewall rules (read-only)                          |
| `-a`, `--adb`       | ADB WiFi connect to detected Android devices             |
| `-r`, `--reboot`    | Reboot the router with live progress tracking            |
| `scan`              | Network scan via ping sweep + ARP (JSON mode only)       |
| `-h`, `--help`      | Show available commands                                  |
| `-v`, `--version`   | Show version                                             |

Examples:

```bash
router-cli --devices
router-cli --status
router-cli --reboot
```

## JSON mode

Append `--json` to any command flag to skip the TUI and output structured JSON to stdout. This is designed for scripting, automation pipelines, and non-TTY environments.

```bash
router-cli --devices --json
router-cli --wifi --json
router-cli --status --json
router-cli --logs --json
router-cli --firewall --json
router-cli --adb --json
router-cli --reboot --json
router-cli scan --json
```

Errors are also returned as JSON:

```json
{ "error": "No saved credentials. Run without --json first to set up credentials." }
```

### Example: `--devices --json`

```json
{
  "routerIp": "192.168.1.1",
  "devices": [
    {
      "ip": "192.168.1.10",
      "hostname": "macbook-pro",
      "name": "MacBook Pro",
      "mac": "aa:bb:cc:dd:ee:ff",
      "category": "laptop",
      "leaseSeconds": 86400
    },
    {
      "ip": "192.168.1.20",
      "hostname": "pixel-8",
      "name": "Pixel 8",
      "mac": "11:22:33:44:55:66",
      "category": "phone",
      "leaseSeconds": 43200
    }
  ]
}
```

### Example: `--status --json`

```json
{
  "routerIp": "192.168.1.1",
  "wan": {
    "ip": "179.x.x.x",
    "status": "connected",
    "uptime": 432000
  },
  "device": {
    "model": "RTF8225VW",
    "firmware": "1.0.23",
    "serialNumber": "ASKEY123456"
  },
  "dhcp": {
    "start": "192.168.1.100",
    "end": "192.168.1.200",
    "leaseTime": 86400
  }
}
```

### Example: `scan --json`

Does not require router credentials — discovers devices via ping sweep and ARP table.

```json
{
  "subnet": "192.168.1.0/24",
  "devices": [
    {
      "ip": "192.168.1.1",
      "name": "Router",
      "category": "router",
      "mac": "aa:bb:cc:00:11:22",
      "status": "online"
    },
    {
      "ip": "192.168.1.10",
      "name": "MacBook Pro",
      "category": "laptop",
      "mac": "aa:bb:cc:dd:ee:ff",
      "status": "online"
    }
  ]
}
```

## Credentials

On first run of any authenticated command, router-cli will prompt for your router username and password. Credentials are stored via the [`conf`](https://github.com/sindresorhus/conf) package in the system's app data directory.

To clear saved credentials:

```bash
router-cli clear-creds
```

> The `scan` command does not require credentials — it uses ping sweep and the local ARP table.

## Router discovery

The router IP is automatically discovered from the system's default gateway (`route -n get default`). No manual configuration needed.

## Development

```bash
pnpm dev    # Build with watch mode
pnpm build  # Production build
```

## Tech stack

| Package | Role |
|---------|------|
| [Ink](https://github.com/vadimdemedes/ink) | React for CLIs |
| [ink-select-input](https://github.com/vadimdemedes/ink-select-input) | Menu navigation |
| [ink-spinner](https://github.com/vadimdemedes/ink-spinner) | Loading indicators |
| [ink-text-input](https://github.com/vadimdemedes/ink-text-input) | Credential prompts |
| [conf](https://github.com/sindresorhus/conf) | Persistent credential storage |
| [tsup](https://github.com/egoist/tsup) | TypeScript bundler |
