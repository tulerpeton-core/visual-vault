const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  shell,
  Tray,
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const APP_USER_MODEL_ID = 'com.visualvault.desktop.v5';
const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
const MAX_SETTINGS_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BACKUP_FILE_BYTES = 512 * 1024 * 1024;
const MAX_BACKUP_OUTPUT_BYTES = 1024 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vault',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function loadSystemIcon(kind, dark, size = null) {
  const fileName = `${kind}-icon-${dark ? 'dark' : 'light'}.png`;
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '..', 'assets', fileName),
  );
  return size && !icon.isEmpty()
    ? icon.resize({ width: size, height: size, quality: 'best' })
    : icon;
}

function applySystemIcons(dark) {
  const trayIcon = loadSystemIcon('tray', dark, 20);
  if (tray && !tray.isDestroyed() && !trayIcon.isEmpty()) {
    tray.setImage(trayIcon);
  }
}

let mainWindow;
let splashWindow;
let tray;
let db;
let vaultRoot;
let originalsDir;
let backupsDir;
let mainReady = false;
let splashStartedAt = 0;
let splashRevealTimer;
let splashCloseTimer;
const splashDurationOverride = Number(process.env.VV_SPLASH_MIN_MS);
const SPLASH_MIN_MS =
  Number.isFinite(splashDurationOverride) && splashDurationOverride >= 400
    ? Math.min(10000, splashDurationOverride)
    : 2000;
const TITLEBAR_TRANSPARENT = '#00000000';
let clipboardWatchTimer;
let lastClipboardHash = '';
const pinnedWindows = new Map();
const integrationRoot =
  process.env.VV_TEST_MODE === '1'
    ? path.join(process.env.TEMP || app.getPath('temp'), 'VisualVault-Integration')
    : null;

const defaultSettings = {
  autoCapture: 'ask',
  autostart: false,
  backupKeep: 10,
  lastBackupAt: '',
  lastBackupName: '',
  closeAction: 'tray',
  retentionDays: 0,
  shortcut: 'CommandOrControl+Shift+V',
  storageLimitGB: 25,
  demoLibraryInitialized: false,
};

const demoTags = [
  ['Reference', '#F07868'],
  ['UI', '#E7BA42'],
  ['Work', '#8B70DB'],
  ['Illustration', '#6F9BD8'],
  ['Mood', '#68B98A'],
  ['Inspiration', '#E18A46'],
];

const demoImages = [
  { file: 'abstract-waves.png', name: 'Abstract Waves.png', tags: ['Reference', 'Inspiration'] },
  { file: 'architecture.png', name: 'Architecture.png', tags: ['Reference'] },
  { file: 'botanical-study.png', name: 'Botanical Study.png', tags: ['Illustration', 'Mood'] },
  { file: 'geometric-objects.png', name: 'Geometric Objects.png', tags: ['Work', 'Inspiration'] },
  { file: 'mountain-lake.png', name: 'Mountain Lake.png', tags: ['Mood', 'Reference'] },
  { file: 'ui-reference.png', name: 'UI Reference.png', tags: ['UI', 'Work'] },
];

const mimeByExt = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const supportedImageMimes = new Set(Object.values(mimeByExt));

if (process.env.VV_TEST_MODE === '1') {
  fs.mkdirSync(integrationRoot, { recursive: true });
  app.setPath('userData', path.join(integrationRoot, 'userData'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  // Required by Chromium offscreen capture on this Windows QA runner only.
  app.commandLine.appendSwitch('no-sandbox');
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.round(parsed)))
    : fallback;
}

function cleanText(value, fallback = '', maxLength = 255) {
  const normalized = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (normalized || fallback).slice(0, maxLength);
}

function cleanId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid record id');
  return id;
}

function cleanTagColor(value, fallback = '#8B7BD6') {
  const color = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : fallback;
}

function normalizeSettingValue(key, value) {
  if (!(key in defaultSettings)) throw new Error('Unsupported setting');
  if (key === 'autoCapture') {
    return ['off', 'ask', 'auto'].includes(value) ? value : defaultSettings.autoCapture;
  }
  if (key === 'closeAction') {
    return ['tray', 'quit'].includes(value) ? value : defaultSettings.closeAction;
  }
  if (key === 'autostart') return Boolean(value);
  if (key === 'storageLimitGB') return clampInteger(value, 0, 10240, 0);
  if (key === 'retentionDays') return clampInteger(value, 0, 3650, 0);
  if (key === 'backupKeep') return clampInteger(value, 1, 999, 10);
  if (key === 'shortcut') return cleanText(value, defaultSettings.shortcut, 80);
  if (key === 'lastBackupAt') return cleanText(value, '', 64);
  if (key === 'lastBackupName') return cleanText(value, '', 255);
  return value;
}

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['avif', 'avis', 'mif1', 'msf1'].includes(brand)) return 'image/avif';
  }
  return null;
}

function decodeImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('Invalid image data');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid image data');
  const encoded = match[2].replace(/\s/g, '');
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) {
    throw new Error('Image exceeds the 200 MB limit');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 200 MB limit');
  }
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || !supportedImageMimes.has(detectedMime)) {
    throw new Error('Unsupported or invalid image file');
  }
  const decoded = nativeImage.createFromBuffer(buffer);
  if (decoded.isEmpty()) throw new Error('Unsupported or invalid image file');
  return { buffer, mime: detectedMime, dimensions: decoded.getSize() };
}

function readFileWithLimit(filePath, maxBytes, label) {
  const size = fs.statSync(filePath).size;
  if (size > maxBytes) throw new Error(`${label} is too large`);
  return fs.readFileSync(filePath);
}

function hardenWindow(browserWindow) {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const ses = browserWindow.webContents.session;
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function repairLegacyTagEncoding() {
  const replacements = new Map([
    ['ÐœÐµÐ¼', 'Мем'],
    ['Ð ÐµÑ„ÐµÑ€ÐµÐ½Ñ', 'Референс'],
    ['Ð Ð°Ð±Ð¾Ñ‚Ð°', 'Работа'],
    ['Ð‘Ð°Ð³', 'Баг'],
    ['Ð˜Ð»Ð»ÑŽÑÑ‚Ñ€Ð°Ñ†Ð¸Ñ', 'Иллюстрация'],
    ['ÐšÐ¾Ð´', 'Код'],
  ]);
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  for (const [broken, correct] of replacements) {
    const brokenTag = findTag.get(broken);
    if (!brokenTag) continue;
    const correctTag = findTag.get(correct);
    if (!correctTag) {
      db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(correct, brokenTag.id);
      continue;
    }
    db.prepare(
      `INSERT OR IGNORE INTO image_tags (image_id, tag_id)
       SELECT image_id, ? FROM image_tags WHERE tag_id = ?`,
    ).run(correctTag.id, brokenTag.id);
    db.prepare('DELETE FROM image_tags WHERE tag_id = ?').run(brokenTag.id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(brokenTag.id);
  }
}

function setupStorage() {
  vaultRoot =
    process.env.VV_TEST_MODE === '1'
      ? path.join(integrationRoot, 'vault')
      : path.join(app.getPath('pictures'), 'Visual Vault');
  originalsDir = path.join(vaultRoot, 'originals');
  backupsDir = path.join(vaultRoot, 'backups');
  fs.mkdirSync(originalsDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });

  db = new DatabaseSync(path.join(vaultRoot, 'vault.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL UNIQUE,
      source TEXT,
      created_at TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (image_id, tag_id),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  addColumnIfMissing('images', 'trashed_at', 'TEXT');
  addColumnIfMissing('images', 'width', 'INTEGER');
  addColumnIfMissing('images', 'height', 'INTEGER');
  addColumnIfMissing('images', 'ocr', 'TEXT');

  repairLegacyTagEncoding();
  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(value),
    );
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return defaultSettings[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return defaultSettings[key];
  }
}

function setSetting(key, value) {
  if (!(key in defaultSettings)) throw new Error(`Unknown setting: ${key}`);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
  return value;
}

function allSettings() {
  return Object.fromEntries(
    Object.keys(defaultSettings).map((key) => [key, getSetting(key)]),
  );
}

function imageRow(id) {
  const image = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!image) return null;
  image.tags = db
    .prepare(
      `SELECT tags.id, tags.name, tags.color
       FROM tags
       JOIN image_tags ON image_tags.tag_id = tags.id
       WHERE image_tags.image_id = ?
       ORDER BY tags.name`,
    )
    .all(id);
  image.favorite = Boolean(image.favorite);
  image.trash = Boolean(image.trashed_at);
  image.missing = !fs.existsSync(path.join(originalsDir, image.filename));
  image.url = `vault://image/${image.id}`;
  return image;
}

function listImages() {
  return db
    .prepare('SELECT id FROM images ORDER BY created_at DESC')
    .all()
    .map(({ id }) => imageRow(id));
}

function sumFileSizes(paths) {
  return paths.reduce((total, filePath) => {
    try {
      return total + fs.statSync(filePath).size;
    } catch {
      return total;
    }
  }, 0);
}

function storageInfo() {
  const rows = db
    .prepare('SELECT bytes, trashed_at FROM images')
    .all();
  const originalsBytes = rows
    .filter((row) => !row.trashed_at)
    .reduce((total, row) => total + Number(row.bytes || 0), 0);
  const trashBytes = rows
    .filter((row) => row.trashed_at)
    .reduce((total, row) => total + Number(row.bytes || 0), 0);
  const dbPath = path.join(vaultRoot, 'vault.db');
  const databaseBytes = sumFileSizes([dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
  let totalBytes = 0;
  let freeBytes = 0;
  try {
    const stats = fs.statfsSync(vaultRoot);
    totalBytes = Number(stats.blocks) * Number(stats.bsize);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch {}
  const backupBytes = fs.existsSync(backupsDir)
    ? sumFileSizes(
        fs
          .readdirSync(backupsDir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(backupsDir, entry.name)),
      )
    : 0;
  return {
    root: vaultRoot,
    shortcut: getSetting('shortcut'),
    usedBytes: originalsBytes + trashBytes + databaseBytes + backupBytes,
    originalsBytes,
    trashBytes,
    databaseBytes,
    backupBytes,
    totalBytes,
    freeBytes,
    imageCount: rows.length,
    storageLimitGB: Number(getSetting('storageLimitGB') || 0),
  };
}

function ensureStorageCapacity(incomingBytes) {
  const limitGB = Number(getSetting('storageLimitGB') || 0);
  if (!limitGB) return;
  const usedBytes = storageInfo().usedBytes;
  if (Number(usedBytes) + incomingBytes > limitGB * 1024 ** 3) {
    const error = new Error('Storage limit reached');
    error.code = 'VV_STORAGE_LIMIT';
    throw error;
  }
}

function registerCaptureShortcut(shortcut = getSetting('shortcut')) {
  globalShortcut.unregisterAll();
  const ok = globalShortcut.register(shortcut, () => showCapture());
  return { ok, shortcut };
}

function applyAutostart(enabled = Boolean(getSetting('autostart'))) {
  if (process.env.VV_TEST_MODE === '1') return false;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
  });
  return app.getLoginItemSettings().openAtLogin;
}

function cleanExpiredTrash() {
  const days = Number(getSetting('retentionDays') || 0);
  if (!days) return 0;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db
    .prepare(
      'SELECT id, filename FROM images WHERE trashed_at IS NOT NULL AND trashed_at < ?',
    )
    .all(cutoff);
  const removeTags = db.prepare('DELETE FROM image_tags WHERE image_id = ?');
  const removeImage = db.prepare('DELETE FROM images WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const filePath = path.join(originalsDir, row.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      removeTags.run(row.id);
      removeImage.run(row.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return rows.length;
}

function uniqueFilename(originalName, mime) {
  const extFromName = path.extname(originalName || '').toLowerCase();
  const extFromMime =
    Object.entries(mimeByExt).find(([, value]) => value === mime)?.[0] || '.png';
  const ext = mimeByExt[extFromName] ? extFromName : extFromMime;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${crypto.randomBytes(3).toString('hex')}${ext}`;
}

function addImage({
  dataUrl,
  originalName = 'clipboard.png',
  mime = 'image/png',
  source = '',
  tagIds = [],
  allowDuplicate = false,
}) {
  const decoded = decodeImageDataUrl(dataUrl);
  const actualMime = decoded.mime;
  const { buffer, dimensions } = decoded;
  ensureStorageCapacity(buffer.length);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const duplicate = db.prepare('SELECT id FROM images WHERE hash = ?').get(hash);
  if (duplicate && !allowDuplicate) {
    return { image: imageRow(duplicate.id), duplicate: true };
  }
  const storedHash = allowDuplicate
    ? `${hash}:${crypto.randomBytes(4).toString('hex')}`
    : hash;

  const safeOriginalName = path.basename(cleanText(originalName, 'image.png', 240));
  const filename = uniqueFilename(safeOriginalName, actualMime);
  const outputPath = path.join(originalsDir, filename);
  fs.writeFileSync(outputPath, buffer);
  db.exec('BEGIN');
  try {
    const result = db
      .prepare(
        `INSERT INTO images (
          filename, original_name, mime, bytes, hash, source, created_at, width, height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        filename,
        safeOriginalName,
        actualMime,
        buffer.length,
        storedHash,
        cleanText(source, '', 2048),
        new Date().toISOString(),
        dimensions.width || null,
        dimensions.height || null,
      );
    const imageId = Number(result.lastInsertRowid);
    const link = db.prepare(
      'INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)',
    );
    const safeTagIds = Array.isArray(tagIds)
      ? [...new Set(tagIds.slice(0, 100).map(cleanId))]
      : [];
    safeTagIds.forEach((tagId) => link.run(imageId, tagId));
    db.exec('COMMIT');
    return { image: imageRow(imageId), duplicate: false };
  } catch (error) {
    db.exec('ROLLBACK');
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }
}

function initializeDemoLibrary() {
  if (
    (process.env.VV_TEST_MODE === '1' && process.env.VV_TEST_DEMO_LIBRARY !== '1') ||
    getSetting('demoLibraryInitialized')
  ) return;

  if (db.prepare('SELECT COUNT(*) AS count FROM images').get().count > 0) {
    setSetting('demoLibraryInitialized', true);
    return;
  }

  const insertTag = db.prepare(
    `INSERT INTO tags (name, color) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET color = excluded.color
     RETURNING id`,
  );
  const tagIds = new Map(
    demoTags.map(([name, color]) => [name, Number(insertTag.get(name, color).id)]),
  );
  const demoDir = path.join(__dirname, '..', 'app', 'assets', 'demo');

  for (const item of demoImages) {
    const filePath = path.join(demoDir, item.file);
    const buffer = readFileWithLimit(filePath, MAX_IMAGE_BYTES, 'Demo image');
    addImage({
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
      originalName: item.name,
      mime: 'image/png',
      source: 'Visual Vault demo library',
      tagIds: item.tags.map((name) => tagIds.get(name)),
    });
  }

  setSetting('demoLibraryInitialized', true);
}

function fileToPayload(filePath) {
  const mime = mimeByExt[path.extname(filePath).toLowerCase()] || 'image/png';
  const buffer = readFileWithLimit(filePath, MAX_IMAGE_BYTES, 'Image');
  return {
    dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    originalName: path.basename(filePath),
    mime,
    source: filePath,
    tagIds: [],
  };
}

function createSplashWindow() {
  const splashTest =
    process.env.VV_TEST_MODE === '1' && process.env.VV_TEST_SPLASH === '1';
  if (process.env.VV_TEST_MODE === '1' && !splashTest) return;
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashStartedAt = Date.now();
  splashWindow = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: splashTest,
    },
  });
  hardenWindow(splashWindow);
  const showSplash = () => {
    if (!splashWindow || splashWindow.isDestroyed() || splashWindow.isVisible())
      return;
    if (splashTest) return;
    splashWindow.center();
    splashWindow.show();
  };
  splashWindow.once('ready-to-show', showSplash);
  splashWindow.webContents.once('did-finish-load', showSplash);
  if (splashTest && process.env.VV_SPLASH_CAPTURE_PATH) {
    splashWindow.webContents.once('did-finish-load', async () => {
      const requestedDelay = Number(process.env.VV_SPLASH_CAPTURE_DELAY_MS);
      const captureDelay = Number.isFinite(requestedDelay)
        ? Math.max(0, Math.min(2500, requestedDelay))
        : 360;
      await new Promise((resolve) => setTimeout(resolve, captureDelay));
      const image = await splashWindow.webContents.capturePage();
      fs.mkdirSync(path.dirname(path.resolve(process.env.VV_SPLASH_CAPTURE_PATH)), {
        recursive: true,
      });
      fs.writeFileSync(
        path.resolve(process.env.VV_SPLASH_CAPTURE_PATH),
        image.toPNG(),
      );
      app.isQuitting = true;
      app.quit();
    });
  }
  splashWindow
    .loadFile(path.join(__dirname, '..', 'app', 'splash.html'), {
      query: { theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' },
    })
    .then(showSplash)
    .catch(() => {});
  setTimeout(showSplash, 220);
}

function revealMainWindow() {
  if (!mainReady || !mainWindow) return;
  clearTimeout(splashRevealTimer);
  clearTimeout(splashCloseTimer);
  const remaining = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStartedAt));
  splashRevealTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    splashWindow?.webContents
      .executeJavaScript("document.documentElement.classList.add('exit')")
      .catch(() => {});
    splashCloseTimer = setTimeout(() => {
      splashWindow?.close();
      splashWindow = null;
      mainWindow.show();
      mainWindow.focus();
    }, 170);
  }, remaining);
}

function createWindow() {
  const appIcon = loadSystemIcon('system', nativeTheme.shouldUseDarkColors);
  const testWidth = clampInteger(process.env.VV_TEST_WIDTH, 760, 3840, 1200);
  const testHeight = clampInteger(process.env.VV_TEST_HEIGHT, 560, 2160, 820);
  mainWindow = new BrowserWindow({
    width: testWidth,
    height: testHeight,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151421' : '#EEECF9',
    icon: appIcon,
    title: 'Visual Vault',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TITLEBAR_TRANSPARENT,
      symbolColor: nativeTheme.shouldUseDarkColors ? '#F7F6FF' : '#37324E',
      height: 38,
    },
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.VV_TEST_MODE === '1',
    },
  });
  hardenWindow(mainWindow);
  if (process.env.VV_TEST_MODE === '1') {
    mainWindow.webContents.on('console-message', (_event, details) => {
      if (typeof details === 'object') {
        console.log(`[renderer:${details.level}] ${details.message}`);
      }
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainReady = true;
    revealMainWindow();
  });
  mainWindow.on('maximize', () =>
    mainWindow.webContents.send('window:maximized', true),
  );
  mainWindow.on('unmaximize', () =>
    mainWindow.webContents.send('window:maximized', false),
  );
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      if (getSetting('closeAction') === 'quit') {
        event.preventDefault();
        app.isQuitting = true;
        app.quit();
        return;
      }
      event.preventDefault();
      mainWindow.hide();
    }
  });
  if (process.env.VV_CAPTURE_PATH) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (process.env.VV_SKIP_ONBOARDING === '1') {
        await mainWindow.webContents.executeJavaScript(`
          [...document.querySelectorAll('button')]
            .find((button) => ['Skip', 'Пропустить'].includes(button.textContent.trim()))
            ?.click()
        `);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      if (process.env.VV_TEST_ACTION === 'capture-menu') {
        await mainWindow.webContents.executeJavaScript(`
          document.querySelector('button[aria-haspopup="menu"]')?.click()
        `);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (process.env.VV_TEST_ACTION === 'window-picker') {
        await mainWindow.webContents.executeJavaScript(`
          document.querySelector('button[aria-haspopup="menu"]')?.click()
        `);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await mainWindow.webContents.executeJavaScript(`
          [...document.querySelectorAll('[role="menuitem"]')][1]?.click()
        `);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (process.env.VV_TEST_ACTION === 'card-menu') {
        await mainWindow.webContents.executeJavaScript(`
          document.querySelector('.vv-card-preview')?.parentElement.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: ${process.env.VV_TEST_MENU_EDGE === '1' ? 1188 : 310},
              clientY: ${process.env.VV_TEST_MENU_EDGE === '1' ? 808 : 168}
            })
          )
        `);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (process.env.VV_TEST_MODE === '1') {
        const diagnostics = await mainWindow.webContents.executeJavaScript(`({
          viewport:[window.innerWidth,window.innerHeight],
          bodyText:document.body.innerText.slice(0,200),
          menuText:document.querySelector('[role="menu"]')?.innerText || '',
          dialogText:[...document.querySelectorAll('[role="dialog"]')].at(-1)?.innerText?.slice(0,500) || '',
          titlebar:[...document.querySelectorAll('div')].find(el=>el.textContent.trim().startsWith('Visual Vault'))?.getBoundingClientRect().toJSON(),
          main:document.querySelector('main')?.getBoundingClientRect().toJSON(),
          aside:document.querySelector('aside')?.getBoundingClientRect().toJSON()
        })`);
        console.log('CAPTURE_DIAGNOSTICS', JSON.stringify(diagnostics));
      }
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.resolve(process.env.VV_CAPTURE_PATH), image.toPNG());
      app.isQuitting = true;
      app.quit();
    });
  }
  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

function showCapture(dataUrl = null) {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  const image = dataUrl ? nativeImage.createFromDataURL(dataUrl) : clipboard.readImage();
  mainWindow.webContents.send(
    'capture:open',
    image.isEmpty() ? null : image.toDataURL(),
  );
}

function clipboardImageState() {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const buffer = image.toPNG();
  return {
    dataUrl: image.toDataURL(),
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function startClipboardWatcher() {
  if (process.env.VV_TEST_MODE === '1') return;
  lastClipboardHash = clipboardImageState()?.hash || '';
  clipboardWatchTimer = setInterval(() => {
    const mode = getSetting('autoCapture');
    if (mode === 'off') return;
    const current = clipboardImageState();
    if (!current || current.hash === lastClipboardHash) return;
    lastClipboardHash = current.hash;
    if (mode === 'ask') {
      showCapture(current.dataUrl);
      return;
    }
    if (mode !== 'auto') return;
    const stamp = new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/:\d{2}\.\d{3}Z$/, '');
    try {
      const result = addImage({
        dataUrl: current.dataUrl,
        originalName: `Screenshot ${stamp}.png`,
        mime: 'image/png',
        source: 'clipboard',
        tagIds: [],
      });
      mainWindow?.webContents.send('vault:changed', {
        reason: 'auto-capture',
        image: result.image,
      });
    } catch (error) {
      mainWindow?.webContents.send('vault:error', {
        code: error.code || 'VV_AUTO_CAPTURE_FAILED',
        message: error.message,
      });
    }
  }, 1200);
  clipboardWatchTimer.unref?.();
}

async function capturePrimaryScreen() {
  const display = screen.getPrimaryDisplay();
  const wasVisible = mainWindow?.isVisible();
  if (wasVisible) mainWindow.hide();
  await new Promise((resolve) => setTimeout(resolve, 180));
  try {
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
    };
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false,
    });
    const source =
      sources.find((item) => String(item.display_id) === String(display.id)) ||
      sources[0];
    return source?.thumbnail?.isEmpty() ? null : source.thumbnail.toDataURL();
  } finally {
    if (wasVisible) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

async function listDesktopCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 420, height: 260 },
    fetchWindowIcons: true,
  });
  const blockedWindowNames = [
    /^Visual Vault$/i,
    /^Codex Computer Use Cursor Overlay$/i,
    /^NVIDIA GeForce Overlay$/i,
    /^Program Manager$/i,
  ];
  return sources
    .filter(
      (source) =>
        source.id.startsWith('screen:') ||
        !blockedWindowNames.some((pattern) => pattern.test(source.name.trim())),
    )
    .map((source) => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
    appIcon:
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.toDataURL()
        : null,
    }));
}

async function captureDesktopSource(sourceId) {
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(
    1920,
    ...displays.map((display) =>
      Math.round(display.size.width * display.scaleFactor),
    ),
  );
  const maxHeight = Math.max(
    1080,
    ...displays.map((display) =>
      Math.round(display.size.height * display.scaleFactor),
    ),
  );
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false,
  });
  const source = sources.find((item) => item.id === sourceId);
  return !source || source.thumbnail.isEmpty()
    ? null
    : source.thumbnail.toDataURL();
}

function togglePinnedWindow(id) {
  const existing = pinnedWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    existing.close();
    return false;
  }
  const image = db
    .prepare('SELECT original_name, width, height FROM images WHERE id = ?')
    .get(id);
  if (!image) return false;
  const aspect =
    image.width && image.height ? image.width / image.height : 4 / 3;
  const width = 360;
  const height = Math.max(220, Math.min(520, Math.round(width / aspect) + 36));
  const pinned = new BrowserWindow({
    width,
    height,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#151421',
    title: image.original_name || 'Visual Vault reference',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenWindow(pinned);
  pinnedWindows.set(id, pinned);
  pinned.loadFile(path.join(__dirname, '..', 'app', 'pinned.html'), {
    query: {
      id: String(id),
      name: image.original_name || 'Visual Vault reference',
    },
  });
  pinned.on('closed', () => {
    pinnedWindows.delete(id);
    mainWindow?.webContents.send('image:pin-state', { id, pinned: false });
  });
  return true;
}

function createBackupPayload() {
  const images = db.prepare('SELECT * FROM images ORDER BY id').all();
  const tags = db.prepare('SELECT * FROM tags ORDER BY id').all();
  const imageTags = db.prepare('SELECT * FROM image_tags').all();
  return {
    format: 'visual-vault-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    settings: allSettings(),
    tags,
    imageTags,
    images: images.flatMap((image) => {
      const filePath = path.join(originalsDir, image.filename);
      if (!fs.existsSync(filePath)) return [];
      return [{
        ...image,
        file: fs.readFileSync(filePath).toString('base64'),
      }];
    }),
  };
}

function pruneBackups(keep = Number(getSetting('backupKeep') || 10)) {
  if (!fs.existsSync(backupsDir) || keep >= 999) return 0;
  const backups = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.vvbackup'))
    .map((entry) => {
      const backupPath = path.join(backupsDir, entry.name);
      return {
        path: backupPath,
        mtimeMs: fs.statSync(backupPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const backup of backups.slice(keep)) fs.unlinkSync(backup.path);
  return Math.max(0, backups.length - keep);
}

async function createBackup() {
  const now = new Date();
  const stamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, '');
  const filePath = path.join(backupsDir, `VisualVault-${stamp}.vvbackup`);
  const compressed = zlib.gzipSync(
    Buffer.from(JSON.stringify(createBackupPayload()), 'utf8'),
    { level: 9 },
  );
  fs.writeFileSync(filePath, compressed);
  setSetting('lastBackupAt', now.toISOString());
  setSetting('lastBackupName', path.basename(filePath));

  pruneBackups();
  return {
    canceled: false,
    filePath,
    bytes: compressed.length,
  };
}

async function restoreBackup() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Восстановить резервную копию Visual Vault',
    defaultPath: backupsDir,
    properties: ['openFile'],
    filters: [{ name: 'Visual Vault backup', extensions: ['vvbackup'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const backupBuffer = readFileWithLimit(
    result.filePaths[0],
    MAX_BACKUP_FILE_BYTES,
    'Backup',
  );
  const payload = JSON.parse(
    zlib.gunzipSync(backupBuffer, { maxOutputLength: MAX_BACKUP_OUTPUT_BYTES }).toString('utf8'),
  );
  if (payload.format !== 'visual-vault-backup' || payload.version !== 1) {
    throw new Error('Unsupported Visual Vault backup');
  }
  const tagMap = new Map();
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const insertTag = db.prepare(
    'INSERT INTO tags (name, color) VALUES (?, ?) RETURNING id',
  );
  for (const tag of Array.isArray(payload.tags) ? payload.tags.slice(0, 10000) : []) {
    const tagName = cleanText(tag?.name, '', 64);
    if (!tagName) continue;
    const tagColor = cleanTagColor(tag?.color);
    const found = findTag.get(tagName);
    const newId = found?.id || insertTag.get(tagName, tagColor).id;
    tagMap.set(tag.id, Number(newId));
  }
  const linksByImage = new Map();
  for (const link of Array.isArray(payload.imageTags) ? payload.imageTags.slice(0, 1000000) : []) {
    if (!linksByImage.has(link.image_id)) linksByImage.set(link.image_id, []);
    linksByImage.get(link.image_id).push(tagMap.get(link.tag_id));
  }
  let restored = 0;
  let skipped = 0;
  for (const image of Array.isArray(payload.images) ? payload.images.slice(0, 100000) : []) {
    if (!image || typeof image.file !== 'string') {
      skipped += 1;
      continue;
    }
    if (db.prepare('SELECT id FROM images WHERE hash = ?').get(image.hash)) {
      skipped += 1;
      continue;
    }
    const restoredImage = addImage({
      dataUrl: `data:${image.mime};base64,${image.file}`,
      originalName: image.original_name || image.filename,
      mime: image.mime,
      source: image.source || '',
      tagIds: (linksByImage.get(image.id) || []).filter(Boolean),
    }).image;
    if (image.favorite) {
      db.prepare('UPDATE images SET favorite = 1 WHERE id = ?').run(
        restoredImage.id,
      );
    }
    if (image.trashed_at) {
      db.prepare('UPDATE images SET trashed_at = ? WHERE id = ?').run(
        image.trashed_at,
        restoredImage.id,
      );
    }
    restored += 1;
  }
  for (const [key, value] of Object.entries(payload.settings || {})) {
    if (key in defaultSettings) setSetting(key, normalizeSettingValue(key, value));
  }
  applyAutostart();
  registerCaptureShortcut();
  return { canceled: false, restored, skipped };
}

async function exportSettingsAndTags() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспортировать настройки и теги',
    defaultPath: path.join(
      app.getPath('documents'),
      'visualvault-settings.json',
    ),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const payload = {
    format: 'visual-vault-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: allSettings(),
    tags: db.prepare('SELECT name, color FROM tags ORDER BY id').all(),
  };
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath };
}

async function importSettingsAndTags() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Импортировать настройки и теги',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const payload = JSON.parse(
    readFileWithLimit(
      result.filePaths[0],
      MAX_SETTINGS_FILE_BYTES,
      'Settings file',
    ).toString('utf8'),
  );
  if (payload.format !== 'visual-vault-settings' || payload.version !== 1) {
    throw new Error('Unsupported Visual Vault settings file');
  }
  for (const [key, value] of Object.entries(payload.settings || {})) {
    if (key in defaultSettings) setSetting(key, normalizeSettingValue(key, value));
  }
  const upsertTag = db.prepare(
    `INSERT INTO tags (name, color) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET color = excluded.color`,
  );
  for (const tag of Array.isArray(payload.tags) ? payload.tags.slice(0, 10000) : []) {
    const name = cleanText(tag?.name, '', 64);
    if (name) upsertTag.run(name, cleanTagColor(tag?.color));
  }
  applyAutostart();
  const shortcut = registerCaptureShortcut();
  return { canceled: false, shortcut, settings: allSettings() };
}

function setupTray() {
  const icon = loadSystemIcon('tray', nativeTheme.shouldUseDarkColors, 20);
  tray = new Tray(icon);
  tray.setToolTip('Visual Vault');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Открыть Visual Vault',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: 'Быстрый захват',
        accelerator: getSetting('shortcut'),
        click: () => showCapture(),
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function registerIpc() {
  ipcMain.handle('images:list', () => listImages());
  ipcMain.handle('tags:list', () =>
    db.prepare('SELECT * FROM tags ORDER BY id').all(),
  );
  ipcMain.handle('tags:create', (_event, { name, color }) => {
    const cleanName = cleanText(name, '', 64);
    if (!cleanName) throw new Error('Tag name is required');
    const result = db
      .prepare('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *')
      .get(cleanName, cleanTagColor(color));
    return result;
  });
  ipcMain.handle('tags:update', (_event, { id, name, color }) => {
    id = cleanId(id);
    const current = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!current) return null;
    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(
      cleanText(name, current.name, 64),
      cleanTagColor(color, current.color),
      id,
    );
    return db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  });
  ipcMain.handle('tags:delete', (_event, id) => {
    id = cleanId(id);
    db.prepare('DELETE FROM image_tags WHERE tag_id = ?').run(id);
    return db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;
  });
  ipcMain.handle('storage:info', () => storageInfo());
  ipcMain.handle('storage:open', () => shell.openPath(vaultRoot));
  ipcMain.handle('settings:get', () => ({
    ...allSettings(),
    autostart:
      process.env.VV_TEST_MODE === '1'
        ? false
        : app.getLoginItemSettings().openAtLogin,
  }));
  ipcMain.handle('settings:set', (_event, { key, value }) => {
    value = normalizeSettingValue(key, value);
    setSetting(key, value);
    if (key === 'autostart') value = applyAutostart(Boolean(value));
    if (key === 'retentionDays') cleanExpiredTrash();
    if (key === 'backupKeep') pruneBackups(Number(value));
    return { key, value };
  });
  ipcMain.handle('shortcut:set', (_event, shortcut) => {
    shortcut = cleanText(shortcut, defaultSettings.shortcut, 80);
    const previous = getSetting('shortcut');
    globalShortcut.unregisterAll();
    const ok = globalShortcut.register(shortcut, () => showCapture());
    if (!ok) {
      globalShortcut.register(previous, () => showCapture());
      return { ok: false, shortcut: previous };
    }
    setSetting('shortcut', shortcut);
    return { ok: true, shortcut };
  });
  ipcMain.handle('backup:create', () => createBackup());
  ipcMain.handle('backup:restore', () => restoreBackup());
  ipcMain.handle('database:verify', () => {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const ok = rows.every((row) => Object.values(row).includes('ok'));
    return { ok, details: rows, records: listImages().length };
  });
  ipcMain.handle('settings:export', () => exportSettingsAndTags());
  ipcMain.handle('settings:import', () => importSettingsAndTags());
  ipcMain.handle('image:add', (_event, payload) => addImage(payload));
  ipcMain.handle('image:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Добавить изображения',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Изображения',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
        },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => addImage(fileToPayload(filePath)));
  });
  ipcMain.handle('capture:clipboard', () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image.toDataURL();
  });
  ipcMain.handle('capture:screen', () => capturePrimaryScreen());
  ipcMain.handle('capture:sources', () => listDesktopCaptureSources());
  ipcMain.handle('app:locale', () => app.getLocale());
  ipcMain.handle('capture:source', (_event, sourceId) =>
    captureDesktopSource(sourceId),
  );
  ipcMain.handle('image:favorite', (_event, id) => {
    id = cleanId(id);
    db.prepare(
      'UPDATE images SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?',
    ).run(id);
    return imageRow(id);
  });
  ipcMain.handle('image:rename', (_event, { id, name }) => {
    id = cleanId(id);
    name = cleanText(name, 'Untitled image', 240);
    db.prepare('UPDATE images SET original_name = ? WHERE id = ?').run(name, id);
    return imageRow(id);
  });
  ipcMain.handle('image:tags', (_event, { id, tagIds }) => {
    id = cleanId(id);
    tagIds = Array.isArray(tagIds)
      ? [...new Set(tagIds.slice(0, 100).map(cleanId))]
      : [];
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(id);
      const insert = db.prepare(
        'INSERT INTO image_tags (image_id, tag_id) VALUES (?, ?)',
      );
      tagIds.forEach((tagId) => insert.run(id, tagId));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return imageRow(id);
  });
  ipcMain.handle('image:trash', (_event, { id, trash }) => {
    id = cleanId(id);
    db.prepare('UPDATE images SET trashed_at = ? WHERE id = ?').run(
      trash ? new Date().toISOString() : null,
      id,
    );
    return imageRow(id);
  });
  ipcMain.handle('image:delete', (_event, id) => {
    id = cleanId(id);
    const image = db
      .prepare('SELECT filename, trashed_at FROM images WHERE id = ?')
      .get(id);
    if (!image || !image.trashed_at) return false;
    const filePath = path.join(originalsDir, image.filename);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(id);
      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return true;
  });
  ipcMain.handle('image:copy', (_event, id) => {
    id = cleanId(id);
    const image = db.prepare('SELECT filename FROM images WHERE id = ?').get(id);
    if (!image) return false;
    const original = nativeImage.createFromPath(
      path.join(originalsDir, image.filename),
    );
    if (original.isEmpty()) return false;
    clipboard.writeImage(original);
    return true;
  });
  ipcMain.handle('image:open', (_event, id) => {
    id = cleanId(id);
    const image = db.prepare('SELECT filename FROM images WHERE id = ?').get(id);
    if (!image) return false;
    shell.openPath(path.join(originalsDir, image.filename));
    return true;
  });
  ipcMain.handle('image:reveal', (_event, id) => {
    id = cleanId(id);
    const image = db.prepare('SELECT filename FROM images WHERE id = ?').get(id);
    if (!image) return false;
    shell.showItemInFolder(path.join(originalsDir, image.filename));
    return true;
  });
  ipcMain.handle('image:pin', (_event, id) => togglePinnedWindow(cleanId(id)));
  ipcMain.handle('image:locate', async (_event, id) => {
    id = cleanId(id);
    const image = db
      .prepare('SELECT filename FROM images WHERE id = ?')
      .get(id);
    if (!image) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Указать оригинал изображения',
      properties: ['openFile'],
      filters: [
        {
          name: 'Изображения',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const payload = fileToPayload(result.filePaths[0]);
    const decoded = decodeImageDataUrl(payload.dataUrl);
    const { buffer, mime, dimensions } = decoded;
    ensureStorageCapacity(buffer.length);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const duplicate = db
      .prepare('SELECT id FROM images WHERE hash = ? AND id <> ?')
      .get(hash, id);
    if (duplicate) {
      const error = new Error('Selected file already exists in the vault');
      error.code = 'VV_DUPLICATE_LOCATE';
      throw error;
    }
    const previousPath = path.join(originalsDir, image.filename);
    const filename = uniqueFilename(payload.originalName, mime);
    const replacementPath = path.join(originalsDir, filename);
    fs.writeFileSync(replacementPath, buffer);
    try {
      db.prepare(
        `UPDATE images SET filename = ?, mime = ?, bytes = ?, hash = ?, width = ?, height = ?
         WHERE id = ?`,
      ).run(
        filename,
        mime,
        buffer.length,
        hash,
        dimensions.width || null,
        dimensions.height || null,
        id,
      );
      if (previousPath !== replacementPath && fs.existsSync(previousPath)) {
        fs.unlinkSync(previousPath);
      }
    } catch (error) {
      if (fs.existsSync(replacementPath)) fs.unlinkSync(replacementPath);
      throw error;
    }
    return imageRow(id);
  });
  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => {
    if (getSetting('closeAction') === 'quit') {
      app.isQuitting = true;
      app.quit();
      return 'quit';
    }
    mainWindow.hide();
    return 'tray';
  });
  ipcMain.handle('window:is-maximized', () => mainWindow.isMaximized());
  ipcMain.handle('window:titlebar-theme', (_event, dark) => {
    mainWindow.setTitleBarOverlay({
      color: TITLEBAR_TRANSPARENT,
      symbolColor: dark ? '#F7F6FF' : '#37324E',
      height: 38,
    });
    applySystemIcons(Boolean(dark));
    return true;
  });
}

const hasLock =
  process.env.VV_TEST_MODE === '1' ? true : app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.hide();
  createSplashWindow();
  revealMainWindow();
});

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  createSplashWindow();
  setupStorage();
  initializeDemoLibrary();
  if (
    process.env.VV_TEST_MODE === '1' &&
    process.env.VV_TEST_ACTION === 'card-menu' &&
    listImages().length === 0
  ) {
    addImage({
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLmtQAAAABJRU5ErkJggg==',
      originalName: 'Context menu QA.png',
      mime: 'image/png',
      source: 'integration-test',
      tagIds: [],
    });
  }
  cleanExpiredTrash();
  applyAutostart();
  protocol.handle('vault', (request) => {
    const id = Number(new URL(request.url).pathname.replace('/', ''));
    const image = db.prepare('SELECT filename FROM images WHERE id = ?').get(id);
    if (!image) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(originalsDir, image.filename)).toString());
  });
  registerIpc();
  createWindow();
  setupTray();
  registerCaptureShortcut();
  startClipboardWatcher();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (clipboardWatchTimer) clearInterval(clipboardWatchTimer);
  globalShortcut.unregisterAll();
  for (const pinned of pinnedWindows.values()) pinned.close();
  db?.close();
});

app.on('window-all-closed', () => {});
