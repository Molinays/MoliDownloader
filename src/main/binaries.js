/* MoliDowloader — Copyright © 2026 Molinays. Tutti i diritti riservati. */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { app } = require('electron');

const isWin = process.platform === 'win32';
const exeName = (name) => (isWin ? `${name}.exe` : name);

let cache = null;

function projectRoot() {
  return path.join(__dirname, '..', '..');
}

function isFile(candidate) {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function unpacked(candidate) {
  if (!candidate) return candidate;
  if (candidate.includes('app.asar')) {
    const alt = candidate.replace('app.asar', 'app.asar.unpacked');
    if (isFile(alt)) return alt;
  }
  return candidate;
}

function safeRequire(id) {
  try {
    return require(id);
  } catch {
    return null;
  }
}

function which(cmd) {
  const finder = isWin ? 'where' : 'which';
  try {
    const result = spawnSync(finder, [cmd], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.status !== 0) return null;
    const first = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

function probeVersion(command, args) {
  if (!command) return null;
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return null;
    const line = (result.stdout || result.stderr || '').split(/\r?\n/).find((l) => l.trim());
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

function ytdlpCandidates() {
  const list = [
    process.env.YTDLP_PATH,
    path.join(app.getPath('userData'), 'bin', exeName('ytd')),
    path.join(app.getPath('userData'), 'bin', exeName('yt-dlp')),
    app.isPackaged ? path.join(process.resourcesPath, exeName('ytd')) : null,
    path.join(projectRoot(), 'resources', exeName('ytd')),
    path.join(projectRoot(), 'resources', exeName('yt-dlp')),
    path.join(projectRoot(), exeName('ytd')),
    path.join(projectRoot(), exeName('yt-dlp')),
    path.join(projectRoot(), 'bin', exeName('yt-dlp')),
  ];
  return list.filter(Boolean);
}

function resolveYtDlp() {
  for (const candidate of ytdlpCandidates()) {
    if (!isFile(candidate)) continue;
    const version = probeVersion(candidate, ['--version']);
    if (version) return { path: candidate, version, source: 'bundled' };
  }

  const system = which(isWin ? 'yt-dlp.exe' : 'yt-dlp') || which('yt-dlp');
  if (system) {
    const version = probeVersion(system, ['--version']);
    if (version) return { path: system, version, source: 'system' };
  }

  return { path: null, version: null, source: null };
}

function ffmpegCandidates() {
  const staticPath = safeRequire('ffmpeg-static');
  const list = [
    process.env.FFMPEG_PATH,
    path.join(app.getPath('userData'), 'bin', exeName('ffmpeg')),
    app.isPackaged ? path.join(process.resourcesPath, 'bin', exeName('ffmpeg')) : null,
    path.join(projectRoot(), 'resources', 'bin', exeName('ffmpeg')),
    path.join(projectRoot(), 'bin', exeName('ffmpeg')),
    staticPath ? unpacked(staticPath) : null,
  ];
  return list.filter(Boolean);
}

function resolveFfmpeg() {
  for (const candidate of ffmpegCandidates()) {
    if (!isFile(candidate)) continue;
    const version = probeVersion(candidate, ['-version']);
    if (version) return { path: candidate, version, source: 'bundled' };
  }

  const system = which(isWin ? 'ffmpeg.exe' : 'ffmpeg') || which('ffmpeg');
  if (system) {
    const version = probeVersion(system, ['-version']);
    if (version) return { path: system, version, source: 'system' };
  }

  return { path: null, version: null, source: null };
}

function ffprobeCandidates() {
  const pkg = safeRequire('@ffprobe-installer/ffprobe');
  const list = [
    process.env.FFPROBE_PATH,
    path.join(app.getPath('userData'), 'bin', exeName('ffprobe')),
    app.isPackaged ? path.join(process.resourcesPath, 'bin', exeName('ffprobe')) : null,
    path.join(projectRoot(), 'resources', 'bin', exeName('ffprobe')),
    path.join(projectRoot(), 'bin', exeName('ffprobe')),
    pkg && pkg.path ? unpacked(pkg.path) : null,
  ];
  return list.filter(Boolean);
}

function resolveFfprobe() {
  for (const candidate of ffprobeCandidates()) {
    if (!isFile(candidate)) continue;
    const version = probeVersion(candidate, ['-version']);
    if (version) return { path: candidate, version, source: 'bundled' };
  }

  const system = which(isWin ? 'ffprobe.exe' : 'ffprobe') || which('ffprobe');
  if (system) {
    const version = probeVersion(system, ['-version']);
    if (version) return { path: system, version, source: 'system' };
  }

  return { path: null, version: null, source: null };
}

function getBinaries(force = false) {
  if (cache && !force) return cache;
  cache = {
    ytdlp: resolveYtDlp(),
    ffmpeg: resolveFfmpeg(),
    ffprobe: resolveFfprobe(),
    userBinDir: path.join(app.getPath('userData'), 'bin'),
  };
  return cache;
}

function linkOrCopy(source, destination) {
  if (!isFile(source)) return false;
  try {
    if (isFile(destination)) {
      const a = fs.statSync(source);
      const b = fs.statSync(destination);
      if (a.size === b.size) return true;
      fs.unlinkSync(destination);
    }
    fs.linkSync(source, destination);
    return true;
  } catch {
    try {
      fs.copyFileSync(source, destination);
      if (!isWin) fs.chmodSync(destination, 0o755);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * yt-dlp cerca ffmpeg/ffprobe accanto al proprio eseguibile o nel PATH.
 * Creiamo una cartella bin in userData con i due tool, così i download
 * funzionano anche su PC senza ffmpeg installato.
 */
async function ensureToolLinks() {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const current = getBinaries();
  const ffmpegSource = current.ffmpeg.path;
  const ffprobeSource = current.ffprobe.path;

  let ffmpeg = path.join(binDir, exeName('ffmpeg'));
  let ffprobe = path.join(binDir, exeName('ffprobe'));

  if (ffmpegSource && path.resolve(ffmpegSource) !== path.resolve(ffmpeg)) {
    if (!linkOrCopy(ffmpegSource, ffmpeg)) ffmpeg = ffmpegSource;
  }
  if (ffprobeSource && path.resolve(ffprobeSource) !== path.resolve(ffprobe)) {
    if (!linkOrCopy(ffprobeSource, ffprobe)) ffprobe = ffprobeSource;
  }

  cache = null;
  getBinaries();
  return { binDir, ffmpeg, ffprobe };
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const visit = (currentUrl, redirects = 0) => {
      if (redirects > 8) {
        reject(new Error('Troppi redirect durante il download'));
        return;
      }
      const request = https.get(
        currentUrl,
        { headers: { 'User-Agent': 'MoliDowloader/2.1', Accept: '*/*' } },
        (response) => {
          const status = response.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.resume();
            visit(new URL(response.headers.location, currentUrl).href, redirects + 1);
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`Download fallito (HTTP ${status})`));
            return;
          }

          const total = Number(response.headers['content-length']) || 0;
          let received = 0;
          const out = fs.createWriteStream(destination);

          response.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress({ received, total, percent: total ? received / total : null });
          });
          response.on('error', reject);
          out.on('error', reject);
          out.on('finish', () => out.close(() => resolve(destination)));
          response.pipe(out);
        },
      );
      request.on('error', reject);
      request.setTimeout(30000, () => request.destroy(new Error('Timeout durante il download')));
    };

    visit(url);
  });
}

function ytDlpAsset() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
  return 'yt-dlp_linux';
}

async function updateYtDlp(onProgress) {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  // Il binario viene salvato con lo stesso nome rinominato usato dal progetto (ytd).
  const destination = path.join(binDir, exeName('ytd'));
  const temporary = `${destination}.download`;
  const asset = ytDlpAsset();
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

  if (isFile(temporary)) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* ignore */
    }
  }

  await downloadFile(url, temporary, onProgress);
  if (!isWin) fs.chmodSync(temporary, 0o755);

  try {
    if (isFile(destination)) fs.unlinkSync(destination);
    fs.renameSync(temporary, destination);
  } catch {
    fs.copyFileSync(temporary, destination);
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* ignore */
    }
  }

  cache = null;
  const updated = getBinaries(true).ytdlp;
  if (!updated.path) throw new Error('Aggiornamento completato ma yt-dlp non è eseguibile');
  return updated;
}

function binDirForYtDlp() {
  const current = getBinaries();
  const binDir = path.join(app.getPath('userData'), 'bin');
  try {
    if (
      current.ffmpeg.path &&
      path.resolve(current.ffmpeg.path) === path.resolve(path.join(binDir, exeName('ffmpeg'))) &&
      current.ffprobe.path &&
      path.resolve(current.ffprobe.path) === path.resolve(path.join(binDir, exeName('ffprobe')))
    ) {
      return binDir;
    }
  } catch {
    /* ignore */
  }
  if (current.ffmpeg.path) return path.dirname(current.ffmpeg.path);
  return null;
}

const FFMPEG_STATIC_RELEASE = 'b6.1.1';

function ffmpegPlatformKey() {
  if (isWin) return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function ffmpegArchKey() {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function ffmpegToolUrl(tool) {
  const asset = `${tool}-${ffmpegPlatformKey()}-${ffmpegArchKey()}.gz`;
  return `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_STATIC_RELEASE}/${asset}`;
}

function downloadGzFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const visit = (currentUrl, redirects = 0) => {
      if (redirects > 8) {
        reject(new Error('Troppi redirect durante il download'));
        return;
      }
      const request = https.get(
        currentUrl,
        { headers: { 'User-Agent': 'MoliDowloader/2.1', Accept: '*/*' } },
        (response) => {
          const status = response.statusCode || 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.resume();
            visit(new URL(response.headers.location, currentUrl).href, redirects + 1);
            return;
          }
          if (status !== 200) {
            response.resume();
            reject(new Error(`Download fallito (HTTP ${status})`));
            return;
          }

          const total = Number(response.headers['content-length']) || 0;
          let received = 0;
          const temporary = `${destination}.download`;
          try {
            if (isFile(temporary)) fs.unlinkSync(temporary);
          } catch {
            /* ignore */
          }
          const out = fs.createWriteStream(temporary);
          const gunzip = zlib.createGunzip();

          response.on('data', (chunk) => {
            received += chunk.length;
            if (onProgress) onProgress({ received, total, percent: total ? received / total : null });
          });
          const fail = (error) => {
            try {
              out.close();
            } catch {
              /* ignore */
            }
            try {
              if (isFile(temporary)) fs.unlinkSync(temporary);
            } catch {
              /* ignore */
            }
            reject(error);
          };
          response.on('error', fail);
          gunzip.on('error', fail);
          out.on('error', fail);
          out.on('finish', () => {
            out.close(() => {
              try {
                const stat = fs.statSync(temporary);
                if (!stat.size) throw new Error('Il file scaricato è vuoto');
                if (isWin) {
                  const fd = fs.openSync(temporary, 'r');
                  const magic = Buffer.alloc(2);
                  fs.readSync(fd, magic, 0, 2, 0);
                  fs.closeSync(fd);
                  if (magic.toString() !== 'MZ') throw new Error('Il file scaricato non è un eseguibile valido');
                }
                if (isFile(destination)) fs.unlinkSync(destination);
                fs.renameSync(temporary, destination);
                if (!isWin) fs.chmodSync(destination, 0o755);
                resolve(destination);
              } catch (error) {
                try {
                  if (isFile(temporary)) fs.unlinkSync(temporary);
                } catch {
                  /* ignore */
                }
                reject(error);
              }
            });
          });
          response.pipe(gunzip).pipe(out);
        },
      );
      request.on('error', reject);
      request.setTimeout(180000, () => request.destroy(new Error('Timeout durante il download')));
    };
    visit(url);
  });
}

async function downloadFfmpegTool(tool, onProgress) {
  if (tool !== 'ffmpeg' && tool !== 'ffprobe') throw new Error(`Tool non supportato: ${tool}`);
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const destination = path.join(binDir, exeName(tool));
  await downloadGzFile(ffmpegToolUrl(tool), destination, onProgress);
  const version = probeVersion(destination, ['-version']);
  if (!version) throw new Error(`Il binario ${tool} scaricato non è eseguibile`);
  return destination;
}

/**
 * Controlla e ripristina una dipendenza mancante scaricandola direttamente da GitHub.
 */
async function downloadTool(tool, onProgress) {
  const name = String(tool || '');
  if (!['ytdlp', 'ffmpeg', 'ffprobe'].includes(name)) {
    throw new Error('Dipendenza non supportata');
  }
  if (name === 'ytdlp') {
    await updateYtDlp(onProgress);
  } else {
    await downloadFfmpegTool(name, onProgress);
  }
  cache = null;
  const updated = getBinaries(true);
  const key = name === 'ytdlp' ? 'ytdlp' : name;
  if (!updated[key] || !updated[key].path) {
    throw new Error(`Download completato ma ${name} non è eseguibile`);
  }
  return {
    tool: name,
    binaries: {
      ytdlp: updated.ytdlp,
      ffmpeg: updated.ffmpeg,
      ffprobe: updated.ffprobe,
    },
  };
}

module.exports = {
  getBinaries,
  ensureToolLinks,
  updateYtDlp,
  downloadTool,
  binDirForYtDlp,
  exeName,
  isWin,
};
