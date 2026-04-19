import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const result = await Bun.build({
  entrypoints: ['src/cli.tsx'],
  outdir: 'dist',
  target: 'bun',
  format: 'esm',
  minify: false,
  packages: 'external',
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Prepend shebang to the output file
const outPath = join('dist', 'cli.js');
const content = readFileSync(outPath, 'utf-8');
writeFileSync(outPath, `#!/usr/bin/env bun\n${content}`);

console.log('Build complete: dist/cli.js');
