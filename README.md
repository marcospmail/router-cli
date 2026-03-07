# router-cli

CLI tool for managing your Vivo router (Askey RTF8225VW firmware). Built with [Ink](https://github.com/vadimdemedes/ink) for a rich terminal UI.

## Features

- List connected devices via DHCP leases
- Show WiFi clients per band (2.4GHz / 5GHz)
- View router status: WAN IP, GPON, optical power, ethernet ports
- View system logs with severity filtering
- View firewall rules (read-only)
- Reboot router with live progress tracking

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

### Direct commands

```bash
router-cli devices    # List connected devices (DHCP)
router-cli wifi       # Show WiFi clients per band
router-cli status     # Router status (WAN, device info, GPON)
router-cli logs       # View system logs
router-cli firewall   # View firewall rules
router-cli reboot     # Reboot the router
router-cli help       # Show help
router-cli --version  # Show version
```

### Menu shortcuts

When in the interactive menu, press a single key to navigate:

| Key | Command  |
|-----|----------|
| `d` | Devices  |
| `w` | WiFi     |
| `s` | Status   |
| `l` | Logs     |
| `f` | Firewall |
| `r` | Reboot   |
| `q` | Quit     |

## Credentials

On first run of any authenticated command, router-cli will prompt for your router username and password. Credentials are stored securely via the [`conf`](https://github.com/sindresorhus/conf) package in the system's app data directory.

To clear saved credentials: `router-cli clear-creds`

## Router Discovery

The router IP is automatically discovered from the system's default gateway (`route -n get default`). No manual IP configuration needed.

## Development

```bash
pnpm dev    # Build with watch mode
pnpm build  # Production build
```

## Tech Stack

- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs
- [ink-select-input](https://github.com/vadimdemedes/ink-select-input) — Menu navigation
- [ink-spinner](https://github.com/vadimdemedes/ink-spinner) — Loading indicators
- [conf](https://github.com/sindresorhus/conf) — Persistent credential storage
- [tsup](https://github.com/egoist/tsup) — TypeScript bundler
