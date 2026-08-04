import fs from 'node:fs';
import path from 'node:path';

const required = [
  'app/index.html',
  'app/react-globals.js',
  'app/support.js',
  'assets/system-icon-dark.png',
  'assets/system-icon-light.png',
  'assets/tray-icon-dark.png',
  'assets/tray-icon-light.png',
  'electron/main.cjs',
  'electron/preload.cjs',
  'package-lock.json',
];

const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));
if (missing.length) {
  console.error(`Missing required files:\n${missing.join('\n')}`);
  process.exit(1);
}

const html = fs.readFileSync(path.resolve('app/index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.resolve('package-lock.json'), 'utf8'));
const checks = [
  ['local React runtime', html.includes('./react-globals.js')],
  ['design runtime', html.includes('./support.js')],
  ['Visual Vault shell', html.includes('Visual Vault')],
  ['desktop API bridge', html.includes('window.visualVault')],
  ['package version synced', packageJson.version === packageLock.version],
  ['portable builder config', fs.existsSync(path.resolve('electron-builder.portable.cjs'))],
  ['local-only CSP', html.includes("connect-src 'none'")],
];

const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failures.length) {
  console.error(`Validation failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log('Visual Vault validation passed.');
