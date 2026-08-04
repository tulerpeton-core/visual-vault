const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const input = process.argv[2];
const output = process.argv[3];
const width = Number(process.argv[4] || 1600);
const height = Number(process.argv[5] || 1000);
const clickText = process.argv[6];

if (!input || !output) {
  console.error('Usage: electron capture-page.cjs <input> <output> [width] [height]');
  process.exit(2);
}

app.setPath('userData', path.resolve('.electron-test-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#111111',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (typeof level === 'object') {
      console.log(`[renderer:${level.level}] ${level.message} (${level.sourceId}:${level.lineNumber})`);
      return;
    }
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Load failed ${code} ${description}: ${url}`);
  });

  const source = /^[a-z]+:\/\//i.test(input)
    ? input
    : pathToFileURL(path.resolve(input)).toString();
  await window.loadURL(source);

  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (clickText) {
    await window.webContents.executeJavaScript(`
      (() => {
        const target = ${JSON.stringify(clickText)};
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim() === target);
        if (!button) throw new Error('Button not found: ' + target);
        button.click();
      })()
    `);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const diagnostics = await window.webContents.executeJavaScript(`({
    title: document.title,
    bodyText: document.body?.innerText?.slice(0, 300),
    htmlLength: document.documentElement?.outerHTML?.length,
    customElement: Boolean(customElements.get('x-dc'))
  })`);
  console.log(JSON.stringify(diagnostics));
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), image.toPNG());
  await window.close();
  app.quit();
});
