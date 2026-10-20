import { spawnSync } from 'node:child_process';

const testArgs = ['run', '--silent=passed-only'];
if (process.argv.includes('--coverage')) testArgs.push('--coverage');
const steps = [
  ['No legacy runtime', 'scripts/check-no-legacy.mjs', []],
  ['Icon inventory', 'scripts/generate-icons.mjs', ['--check']],
  ['TypeScript', 'node_modules/typescript/bin/tsc', ['--noEmit']],
  ['ESLint', 'node_modules/eslint/bin/eslint.js', ['src', '--quiet']],
  ['Tests', 'node_modules/vitest/vitest.mjs', testArgs],
  ['Build', 'node_modules/vite/bin/vite.js', ['build', '--logLevel', 'warn']],
  ['Packaging', 'scripts/check-package.mjs', []],
];
for (const [name, cli, args] of steps) {
  console.log(`Checking ${name}`);
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
