# CLAUDE.md

This file provides guidance to Claude Code when working with the router-cli codebase.

## Project Overview

router-cli is a terminal UI (TUI) CLI tool for managing a Vivo router (Askey RTF8225VW firmware). It uses [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) to render interactive terminal components, BullMQ for job queuing, and a session-based HTTP API to communicate with the router's web interface.

## Architecture

### Stack

- **UI**: Ink (React-based TUI) with ink-select-input, ink-spinner, ink-text-input
- **Build**: tsup (bundles `src/` → `dist/`)
- **Language**: TypeScript (ESM, Node.js)
- **Credential storage**: `conf` package (system app data directory)

### Directory Structure

```
src/
  cli.tsx              Entry point — parses argv[2], renders <App command={command} />
  components/
    App.tsx            Root component: interactive menu or direct command dispatch
    BackPrompt.tsx     "Press any key to go back" component
    CredentialPrompt.tsx  First-run credential input form
    InteractiveTable.tsx  Scrollable table component
    Status.tsx         Loading/success/error status line component
    Table.tsx          Static table renderer
  commands/
    ClearCreds.tsx     Clear saved credentials
    Devices.tsx        DHCP device list
    Firewall.tsx       Firewall rules (read-only)
    Logs.tsx           System logs viewer
    Reboot.tsx         Router reboot with live phase tracking
    Scan.tsx           Network scan
    WanStatus.tsx      WAN/internet status + device info
    Wifi.tsx           WiFi clients per band
  lib/
    credentials.ts     Load/save credentials via conf
    devices.ts         Device-related helpers
    network-scan.ts    Network scanning logic
    router-auth.ts     All router HTTP API calls (login, reboot, DHCP, firewall, logs, WiFi, WAN)
    router-discovery.ts  Discover router IP from default gateway
```

### Key Implementation Details

**Router Discovery**: Uses `route -n get default` to find the default gateway IP — no manual config needed.

**Authentication**: Session-based. Flow: `GET /login.asp` (get session cookie) → `POST /cgi-bin/te_acceso_router.cgi` (XOR-encoded credentials) → verify by checking `/settings-local-network.asp`.

**Reboot Flow** (`src/commands/Reboot.tsx`):
1. Discover router IP
2. Authenticate
3. GET `/popup-reboot.asp` to extract session key
4. POST `/cgi-bin/cbReboot.xml?sessionKey=<key>` to trigger reboot
5. Poll ping until router goes offline (max 5 min)
6. Poll ping until router comes back online (max 5 min)

**Credentials**: Stored via `conf` package. First-run prompts for username/password, then saves them. Use `clear-creds` command to wipe.

## Running the CLI

```bash
# Globally linked via pnpm
router-cli reboot
router-cli devices
router-cli status
router-cli wifi
router-cli logs
router-cli firewall

# Interactive menu
router-cli
```

## Development Commands

```bash
pnpm dev      # Watch mode — rebuilds on save
pnpm build    # Production build to dist/
pnpm typecheck  # Type check without building (if configured)
```

## Available Commands

| Command    | Description                                      |
|------------|--------------------------------------------------|
| `devices`  | List DHCP-connected devices (hostname, IP, MAC)  |
| `wifi`     | WiFi clients by band (2.4GHz / 5GHz)            |
| `status`   | WAN IP, GPON status, optical power, ethernet     |
| `logs`     | System logs with severity                        |
| `firewall` | Firewall rules (read-only)                       |
| `reboot`   | Reboot router with live progress display         |

## Router API Notes

- **Firmware**: Askey RTF8225VW (Vivo Brasil)
- **Credentials encoding**: XOR with `0x1f` before POST
- **Session key**: Required for reboot and other mutating operations — extracted from HTML via regex `sessionKey='([^']+)'`
- **DHCP leases format**: Pipe-separated entries, slash-separated fields: `iid/hostname/mac/ip/leaseSeconds/…`
- **System logs**: Retrieved via `sv_setvar.cmd` with `varValue=1` — this is idempotent and read-safe despite using setvar endpoint

## Adding New Commands

1. Create `src/commands/NewCommand.tsx` — export a React component
2. Add to `App.tsx` menu items array and `CommandView` switch
3. Add router API calls to `src/lib/router-auth.ts` if needed
4. Rebuild: `pnpm build`
