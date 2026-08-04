import fs from 'node:fs';

const main = fs.readFileSync('electron/main.cjs', 'utf8');
const preload = fs.readFileSync('electron/preload.cjs', 'utf8');
const htmlFiles = ['app/index.html', 'app/splash.html', 'app/pinned.html'];

const checks = [
  ['context isolation enabled', /contextIsolation:\s*true/g.test(main)],
  ['Node integration disabled', /nodeIntegration:\s*false/g.test(main)],
  ['renderer sandbox enabled', /sandbox:\s*true/g.test(main)],
  ['new windows denied', main.includes("setWindowOpenHandler(() => ({ action: 'deny' }))")],
  ['renderer navigation denied', main.includes("on('will-navigate'")],
  ['permissions denied by default', main.includes('setPermissionRequestHandler')],
  ['image payload validation enabled', main.includes('decodeImageDataUrl(dataUrl)')],
  ['SVG imports disabled', !main.includes("'.svg': 'image/svg+xml'")],
  ['preload imports Electron only', [...preload.matchAll(/require\(([^)]+)\)/g)].every((match) => match[1] === "'electron'")],
];

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)/)?.[1] || '';
  checks.push([`${file}: CSP present`, Boolean(csp)]);
  checks.push([`${file}: object-src disabled`, csp.includes("object-src 'none'")]);
  checks.push([`${file}: base-uri disabled`, csp.includes("base-uri 'none'")]);
}

const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failures.length) {
  console.error(`Security checks failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Security checks passed (${checks.length}).`);
