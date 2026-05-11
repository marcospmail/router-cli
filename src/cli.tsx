import { createRequire } from 'module';
import { runJsonHandler } from './json-handlers.js';

const flags: Record<string, string> = {
  '-d': 'devices',
  '--devices': 'devices',
  '-w': 'wifi',
  '--wifi': 'wifi',
  '-s': 'status',
  '--status': 'status',
  '-l': 'logs',
  '--logs': 'logs',
  '-f': 'firewall',
  '--firewall': 'firewall',
  '-a': 'adb',
  '--adb': 'adb',
  '-r': 'reboot',
  '--reboot': 'reboot',
  '-h': 'help',
  '--help': 'help',
  'scan': 'scan',
};

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const arg = args.find((a) => a !== '--json');

if (arg === '--version' || arg === '-v') {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  console.log(pkg.version);
} else if (!arg) {
  if (jsonMode) {
    console.log(JSON.stringify({ error: '--json requires a command flag (e.g. --devices --json)' }));
    process.exit(1);
  }
  const { render } = await import('ink');
  const React = await import('react');
  const { App } = await import('./components/App.js');
  render(React.createElement(App, { command: 'menu' }));
} else {
  const command = flags[arg];
  if (!command) {
    console.error(`Unknown flag: ${arg}`);
    console.error('Run router-cli --help to see available commands.');
    process.exit(1);
  }
  if (command === 'help') {
    const { render } = await import('ink');
    const React = await import('react');
    const { App } = await import('./components/App.js');
    render(React.createElement(App, { command: 'help' }));
  } else if (jsonMode) {
    await runJsonHandler(command);
  } else {
    const { render } = await import('ink');
    const React = await import('react');
    const { App } = await import('./components/App.js');
    render(React.createElement(App, { command }));
  }
}
