'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app } = require('electron');
const binaries = require('./binaries');
const core = require('./media-core');

const cacheDir = () => path.join(app.getPath('userData'), 'cache');
const analysisCache = new Map();

function fileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function fileKey(filePath) {
  const stat = fs.statSync(filePath);
  return crypto
    .createHash('sha1')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}|v2`)
    .digest('hex')
    .slice(0, 24);
}

function ensureCacheDir() {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function analyze(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error('File non trovato');
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('Il percorso non è un file');

  const cached = analysisCache.get(resolved);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.result;
  }

  const tools = binaries.getBinaries();
  if (!tools.ffprobe.path) throw new Error('ffprobe non trovato');
  if (!tools.ffmpeg.path) throw new Error('FFmpeg non trovato');

  const info = await core.probe(tools.ffprobe.path, resolved);
  const dir = ensureCacheDir();
  const key = fileKey(resolved);
  const thumbFile = path.join(dir, `${key}.jpg`);
  const waveFile = path.join(dir, `${key}.png`);

  const jobs = [];
  const hasThumb = fs.existsSync(thumbFile);
  const hasWave = fs.existsSync(waveFile);

  if (info.hasVideo && !hasThumb) {
    jobs.push(
      core
        .createThumbnail(tools.ffmpeg.path, resolved, thumbFile, info.duration)
        .catch(() => false),
    );
  } else {
    jobs.push(Promise.resolve(hasThumb));
  }

  if (info.hasAudio && !hasWave) {
    jobs.push(core.createWaveform(tools.ffmpeg.path, resolved, waveFile).catch(() => false));
  } else {
    jobs.push(Promise.resolve(hasWave));
  }

  const [thumbReady, waveReady] = await Promise.all(jobs);

  const result = {
    ...info,
    path: resolved,
    mediaUrl: fileUrl(resolved),
    thumbnailUrl: thumbReady && info.hasVideo ? fileUrl(thumbFile) : null,
    waveformUrl: waveReady && info.hasAudio ? fileUrl(waveFile) : null,
  };

  analysisCache.set(resolved, { size: stat.size, mtimeMs: stat.mtimeMs, result });
  return result;
}

function exportProject(project, outputPath, onProgress) {
  const tools = binaries.getBinaries();
  if (!tools.ffmpeg.path) return Promise.reject(new Error('FFmpeg non trovato'));
  if (!tools.ffprobe.path) return Promise.reject(new Error('ffprobe non trovato'));

  const inner = core.exportMontage({
    ffmpegPath: tools.ffmpeg.path,
    ffprobePath: tools.ffprobe.path,
    project,
    outputPath,
    onProgress,
  });

  const promise = inner.then((result) => ({
    ...result,
    url: fileUrl(result.path),
    name: path.basename(result.path),
  }));

  promise.cancel = () => {
    if (typeof inner.cancel === 'function') inner.cancel();
  };

  return promise;
}

module.exports = {
  analyze,
  exportProject,
  fileUrl,
  filePathFromUrl: (url) => {
    try {
      return decodeURIComponent(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    } catch {
      return null;
    }
  },
};
