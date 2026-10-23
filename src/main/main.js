/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} = require('electron');

const binaries = require('./binaries');
const downloader = require('./downloader');
const settings = require('./settings');

// Editor, compressore e aggiornamento pesano all'avvio e non servono per il
// primo paint: si caricano la prima volta che una funzione li usa davvero.
const editor = () => require('./editor');
const hardware = () => require('./hardware');
const compressCore = () => require('./compress-core');
const updater = () => require('./updater');

let mainWindow = null;
let currentExport = null;
let exporting = false;
let currentCompress = null;
let compressing = false;
let gpuScanCache = null;
let binariesProbed = false;
let updaterStarted = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function sanitizeName(value) {
  const cleaned = String(value || 'Timeline')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned.slice(0, 120) || 'Timeline';
}

function defaultDownloads() {
  try {
    return app.getPath('downloads');
  } catch {
    return require('os').homedir();
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1020,
    minHeight: 660,
    backgroundColor: '#080808',
    autoHideMenuBar: true,
    show: false,
    title: 'MoliDowloader',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.once('did-finish-load', () => {
    if (binariesProbed) return;
    binariesProbed = true;
    // Le versioni dei tool si leggono dopo il primo paint: all'avvio servono
    // solo i percorsi, cosi` la finestra compare subito.
    binaries
      .probeInBackground()
      .then((tools) => broadcast('binaries:ready', tools))
      .catch(() => {});
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.control && input.key.toLowerCase() === 'r') {
      mainWindow.webContents.reload();
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (currentExport) {
      try {
        currentExport.cancel();
      } catch {
        /* ignore */
      }
      currentExport = null;
    }
    if (currentCompress) {
      try {
        currentCompress.cancel();
      } catch {
        /* ignore */
      }
      currentCompress = null;
    }
  });
}

function shellReveal(target) {
  if (!target || typeof target !== 'string') return false;
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return false;
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    shell.openPath(resolved);
  } else {
    shell.showItemInFolder(resolved);
  }
  return true;
}

function registerIpc() {
  ipcMain.handle('app:defaults', () => {
    const tools = binaries.getBinariesFast();
    const saved = settings.get();
    return {
      downloads: saved.downloadsDir || defaultDownloads(),
      outputDir: saved.downloadsDir || defaultDownloads(),
      settings: saved,
      folders: settings.defaults(),
      appVersion: app.getVersion(),
      platform: process.platform,
      userBinDir: tools.userBinDir,
      binaries: {
        ytdlp: tools.ytdlp,
        ffmpeg: tools.ffmpeg,
        ffprobe: tools.ffprobe,
      },
    };
  });

  ipcMain.handle('settings:get', () => settings.get());

  ipcMain.handle('settings:set', (_event, patch) => {
    const saved = settings.set(patch);
    // Il limite di download paralleli vale subito anche per la coda in corso.
    downloader.schedule();
    return saved;
  });

  ipcMain.handle('dialog:pickFolder', async (event, current) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the output folder',
      defaultPath: current && typeof current === 'string' ? current : defaultDownloads(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickMedia', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Import video or audio clips',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Video and audio',
          extensions: [
            'mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', 'ts', 'flv',
            'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma',
          ],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('dialog:pickAudio', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a music track',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickCompressSource', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the video to compress',
      properties: ['openFile'],
      filters: [
        {
          name: 'Video',
          extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v', 'mpeg', 'mpg', 'ts', 'flv', 'wmv'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:pickCompressOutput', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const container = ['mp4', 'mkv', 'webm'].includes(payload && payload.container)
      ? payload.container
      : 'mp4';
    const extension = compressCore().containerExtension(container);
    const base = sanitizeName((payload && payload.sourceName) || 'video')
      .replace(/\.[a-z0-9]{2,5}$/i, '');
    const result = await dialog.showSaveDialog(win, {
      title: 'Save the compressed video',
      defaultPath: path.join(
        settings.ensure('compressDir') || defaultDownloads(),
        `${base}-compresso.${extension}`,
      ),
      filters: [
        container === 'mkv'
          ? { name: 'Video MKV', extensions: ['mkv'] }
          : container === 'webm'
            ? { name: 'Video WebM', extensions: ['webm'] }
            : { name: 'Video MP4', extensions: ['mp4'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  });

  ipcMain.handle('download:start', (_event, payload) => {
    return downloader.start(payload || {});
  });

  ipcMain.handle('download:retry', (_event, id) => downloader.retry(String(id || '')));

  ipcMain.handle('download:cancel', (_event, id) => downloader.cancel(String(id || '')));

  ipcMain.handle('download:get', (_event, id) => downloader.get(String(id || '')));

  ipcMain.handle('download:list', () => downloader.list());

  ipcMain.handle('download:clear', () => downloader.clearFinished());

  ipcMain.handle('ytdlp:update', async (event) => {
    const sender = event.sender;
    let last = 0;
    const updated = await binaries.updateYtDlp((progress) => {
      const now = Date.now();
      if (now - last < 120 && progress.percent !== 1) return;
      last = now;
      if (!sender.isDestroyed()) sender.send('ytdlp:progress', progress);
    });
    return updated;
  });

  ipcMain.handle('editor:probe', async (_event, filePath) => {
    return editor().analyze(filePath);
  });

  ipcMain.handle('editor:export', async (event, project) => {
    if (exporting) throw new Error('An export is already running');
    if (!project || !Array.isArray(project.clips) || !project.clips.length) {
      throw new Error('Add at least one clip to the timeline');
    }

    const format = project.format === 'm4a' ? 'm4a' : project.format === 'mkv' ? 'mkv' : 'mp4';
    const extension = format;
    let outputPath = project.outputPath ? path.resolve(project.outputPath) : null;

    if (!outputPath) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(win, {
        title: 'Export timeline',
        defaultPath: path.join(
          settings.ensure('editorDir') || defaultDownloads(),
          `${sanitizeName(project.name)}.${extension}`,
        ),
        filters: [
          format === 'mp4'
            ? { name: 'Video MP4', extensions: ['mp4'] }
            : format === 'mkv'
              ? { name: 'Video MKV', extensions: ['mkv'] }
              : { name: 'Audio M4A', extensions: ['m4a'] },
        ],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      outputPath = result.filePath;
    }

    const outputParts = path.parse(outputPath);
    if (outputParts.ext.toLowerCase() !== `.${extension}`) {
      outputPath = path.join(outputParts.dir, `${outputParts.name}.${extension}`);
    }

    exporting = true;
    let lastSent = 0;
    const promise = editor().exportProject(project, outputPath, (progress) => {
      const now = Date.now();
      if (now - lastSent < 120 && progress.progress < 1) return;
      lastSent = now;
      if (!event.sender.isDestroyed()) event.sender.send('export:progress', progress);
    });
    currentExport = promise;

    try {
      const result = await promise;
      return { ok: true, ...result };
    } catch (error) {
      if (String(error && error.message).toLowerCase().includes('cancelled')) {
        try {
          fs.unlinkSync(outputPath);
        } catch {
          /* ignore */
        }
        return { ok: false, canceled: true };
      }
      throw error;
    } finally {
      exporting = false;
      currentExport = null;
    }
  });

  ipcMain.handle('editor:cancel', () => {
    if (!currentExport) return { ok: false };
    try {
      currentExport.cancel();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('editor:snapshot', async (_event, payload) => {
    const dataUrl = String((payload && payload.dataUrl) || '');
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Invalid snapshot');
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) throw new Error('Empty snapshot');
    if (buffer.length > 40 * 1024 * 1024) throw new Error('Snapshot is too large');
    const extension = match[1] === 'jpeg' ? 'jpg' : 'png';
    let baseDir = '';
    try {
      baseDir = app.getPath('pictures');
    } catch {
      baseDir = '';
    }
    if (!baseDir) baseDir = settings.ensure('editorDir') || defaultDownloads();
    const dir = path.join(baseDir, 'MoliDowloader');
    fs.mkdirSync(dir, { recursive: true });
    const base = sanitizeName((payload && payload.name) || 'frame') || 'frame';
    let target = path.join(dir, `${base}.${extension}`);
    let counter = 1;
    while (fs.existsSync(target)) {
      target = path.join(dir, `${base}-${counter}.${extension}`);
      counter += 1;
    }
    fs.writeFileSync(target, buffer);
    return { ok: true, path: target, name: path.basename(target), size: buffer.length, dir };
  });

  ipcMain.handle('compress:catalog', () => hardware().catalog());

  ipcMain.handle('compress:scan', async (_event, force) => {
    if (gpuScanCache && !force) return gpuScanCache;
    const tools = binaries.getBinaries();
    gpuScanCache = await hardware().scanSystem({ ffmpegPath: tools.ffmpeg.path });
    return gpuScanCache;
  });

  ipcMain.handle('compress:probe', async (_event, filePath) => {
    const tools = binaries.getBinaries();
    return compressCore().probeSource(tools.ffprobe.path, filePath);
  });

  ipcMain.handle('compress:detectCrop', async (_event, payload) => {
    const tools = binaries.getBinaries();
    if (!tools.ffmpeg.path) throw new Error('FFmpeg not found');
    const data = payload || {};
    return compressCore().detectCrop(tools.ffmpeg.path, String(data.filePath || ''), {
      duration: Number(data.duration) || 0,
      width: Number(data.width) || 0,
      height: Number(data.height) || 0,
    });
  });

  ipcMain.handle('compress:start', async (event, payload) => {
    if (compressing) throw new Error('A compression is already running');
    const sourcePath = payload && payload.sourcePath;
    if (!sourcePath || typeof sourcePath !== 'string') throw new Error('Choose a video to compress');
    if (!fs.existsSync(sourcePath)) throw new Error('The selected file no longer exists');

    const options = (payload && payload.options) || {};
    const container = ['mp4', 'mkv', 'webm'].includes(options.container)
      ? options.container
      : 'mp4';
    const extension = compressCore().containerExtension(container);
    let outputPath = payload && payload.outputPath ? path.resolve(payload.outputPath) : null;
    const win = BrowserWindow.fromWebContents(event.sender);

    if (!outputPath) {
      const base = sanitizeName(path.basename(sourcePath)).replace(/\.[a-z0-9]{2,5}$/i, '');
      const result = await dialog.showSaveDialog(win, {
        title: 'Save the compressed video',
        defaultPath: path.join(
          settings.get().compressDir || defaultDownloads(),
          `${base}-compresso.${extension}`,
        ),
        filters: [
          container === 'mkv'
            ? { name: 'Video MKV', extensions: ['mkv'] }
            : container === 'webm'
              ? { name: 'Video WebM', extensions: ['webm'] }
              : { name: 'Video MP4', extensions: ['mp4'] },
        ],
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      outputPath = result.filePath;
    }

    const parsed = path.parse(outputPath);
    outputPath = path.join(parsed.dir, `${parsed.name}.${extension}`);
    if (path.resolve(outputPath) === path.resolve(sourcePath)) {
      throw new Error('The output file must be different from the source video');
    }

    const tools = binaries.getBinaries();
    compressing = true;
    let lastSent = 0;
    const promise = compressCore().compressVideo({
      ffmpegPath: tools.ffmpeg.path,
      ffprobePath: tools.ffprobe.path,
      sourcePath,
      options: { ...options, container },
      outputPath,
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastSent < 120 && progress.progress !== 1) return;
        lastSent = now;
        if (!event.sender.isDestroyed()) event.sender.send('compress:progress', progress);
      },
    });
    currentCompress = promise;

    try {
      const result = await promise;
      return { ok: true, ...result };
    } catch (error) {
      if (String(error && error.message).toLowerCase().includes('cancelled')) {
        return { ok: false, canceled: true };
      }
      throw error;
    } finally {
      compressing = false;
      currentCompress = null;
    }
  });

  ipcMain.handle('compress:cancel', () => {
    if (!currentCompress) return { ok: false };
    try {
      currentCompress.cancel();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('system:info', () => {
    const tools = binaries.getBinariesFast();
    const cpus = os.cpus();
    return {
      system: {
        platform: process.platform,
        arch: process.arch,
        type: os.type(),
        release: os.release(),
        hostname: os.hostname(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
        cpuModel: cpus[0] ? cpus[0].model : '',
        cpuCores: cpus.length,
        cpuSpeed: cpus[0] ? cpus[0].speed : 0,
      },
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        v8: process.versions.v8,
      },
      paths: {
        userData: app.getPath('userData'),
        downloads: defaultDownloads(),
      },
      binaries: {
        ytdlp: tools.ytdlp,
        ffmpeg: tools.ffmpeg,
        ffprobe: tools.ffprobe,
        userBinDir: tools.userBinDir,
      },
      gpu: gpuScanCache,
    };
  });

  ipcMain.handle('update:check', () => updater().check(true));
  ipcMain.handle('update:state', () => updater().state());
  ipcMain.handle('update:install', () => updater().install());

  ipcMain.handle('deps:download', async (event, tool) => {
    const sender = event.sender;
    let lastSent = 0;
    const updated = await binaries.downloadTool(String(tool || ''), (progress) => {
      const now = Date.now();
      if (now - lastSent < 120 && progress.percent !== 1) return;
      lastSent = now;
      if (!sender.isDestroyed()) sender.send('deps:progress', { tool: String(tool || ''), ...progress });
    });
    gpuScanCache = null;
    return { ok: true, ...updated };
  });

  ipcMain.handle('shell:reveal', (_event, target) => shellReveal(target));

  // Apre la pagina di accesso del sito nel browser predefinito: li` l'utente
  // e` gia` loggato e i cookie restano disponibili ai download successivi.
  ipcMain.handle('shell:openExternal', async (_event, target) => {
    if (!target || typeof target !== 'string') return false;
    let parsed = null;
    try {
      parsed = new URL(target);
    } catch {
      return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    await shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle('shell:open', async (_event, target) => {
    if (!target || typeof target !== 'string') return false;
    const resolved = path.resolve(target);
    if (!fs.existsSync(resolved)) return false;
    const error = await shell.openPath(resolved);
    return !error;
  });
}

downloader.onUpdate((job) => broadcast('download:update', job));

app.whenReady().then(() => {
  app.setAppUserModelId('com.moli.molidowloader');
  let documentsDir = '';
  try {
    documentsDir = app.getPath('documents');
  } catch {
    documentsDir = '';
  }
  settings.setBase(defaultDownloads(), documentsDir);
  registerIpc();
  createWindow();
  // Cartelle e controllo aggiornamenti arrivano dopo il primo paint: l'avvio
  // deve solo mostrare la finestra.
  setTimeout(() => settings.ensureAll(), 600);
  setTimeout(() => {
    updaterStarted = true;
    updater().start(broadcast);
  }, 1500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (updaterStarted) {
    try {
      updater().stop();
    } catch {
      /* l'updater non e` mai stato caricato */
    }
  }
  if (currentExport) {
    try {
      currentExport.cancel();
    } catch {
      /* ignore */
    }
  }
  if (currentCompress) {
    try {
      currentCompress.cancel();
    } catch {
      /* ignore */
    }
  }
});
