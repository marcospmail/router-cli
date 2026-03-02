import { render } from 'ink';
import React from 'react';
import { createRequire } from 'module';
import { App } from './components/App.js';

const command = process.argv[2] ?? 'menu';

if (command === '--version' || command === '-v') {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  console.log(pkg.version);
} else {
  render(<App command={command} />);
}
