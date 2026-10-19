'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const binaries = require('./binaries');

const MAX_ACTIVE = 2;
const jobs = new Map();
const queue = [];
let active = 0;
const emitter = new EventEmitter();

function newId() {
  return crypto.randomBytes(4).toString('hex');
}

function toFileUrl(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function publicJob(job) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    size: job.size,
    files: job.files,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function emit(job, immediate = false) {
  if (!job) return;
  if (immediate) {
    if (job.emitTimer) {
      clearTimeout(job.emitTimer);
      job.emitTimer = null;
    }
    emitter.emit('update', publicJob(job));
    return;
  }
  if (job.emitTimer) return;
  job.emitTimer = setTimeout(() => {
    job.emitTimer = null;
    emitter.emit('update', publicJob(job));
  }, 250);
}

function addLog(job, line) {
  if (!line) return;
  job.log.push(line);
  if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
}

function addFile(job, filePath) {
  if (!filePath) return;
  const cleaned = filePath.trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return;
  let stat;
  try {
    stat = fs.statSync(cleaned);
  } catch {
    return;
  }
  if (!stat.isFile()) return;
  const resolved = path.resolve(cleaned);
  if (job.files.some((f) => f.path === resolved)) return;
  job.files.push({
    path: resolved,
    url: toFileUrl(resolved),
    name: path.basename(resolved),
    size: stat.size,
  });
}

function parseClock(clock) {
  if (!clock) return '';
  const match = String(clock).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) return '';
  return clock.trim();
}

function handleLine(job, rawLine) {
  const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
  if (!line) return;
  addLog(job, line);

  if (line.startsWith('TITLE|')) {
    const title = line.slice(6).trim();
    if (title) job.title = title;
    emit(job, true);
    return;
  }

  if (line.startsWith('FILE|')) {
    addFile(job, line.slice(5));
    emit(job, true);
    return;
  }

  if (line.startsWith('DLPROGRESS|')) {
    const [, percentRaw, speedRaw, etaRaw, sizeRaw] = line.split('|');
    const percent = parseFloat(String(percentRaw).replace('%', '').trim());
    if (Number.isFinite(percent)) {
      job.progress = Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    }
    const speed = (speedRaw || '').trim();
    if (speed && speed !== 'NA' && speed !== 'Unknown') job.speed = speed;
    const eta = parseClock(etaRaw);
    if (eta) job.eta = eta;
    const size = (sizeRaw || '').trim();
    if (size && size !== 'NA' && size !== 'N/A') job.size = size;
    emit(job);
    return;
  }

  // Fallback per versioni di yt-dlp senza progress-template.
  if (line.startsWith('[download]') && line.includes('%')) {
    const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
    if (percentMatch) {
      job.progress = Math.max(0, Math.min(100, Math.round(Number(percentMatch[1]) * 10) / 10));
    }
    const speedMatch = line.match(/\bat\s+([\d.]+\s*[KMGT]i?B\/s)/i);
    if (speedMatch) job.speed = speedMatch[1].replace(/\s+/g, '');
    const etaMatch = line.match(/ETA\s+(\d+:\d+(?::\d+)?)/i);
    if (etaMatch) job.eta = etaMatch[1];
    emit(job);
  }

  const destination = line.match(/^\[(?:download|Merger|ExtractAudio|MoveFiles)\][^"]*?"(.+?)"/);
  if (destination) addFile(job, destination[1]);

  const destination2 = line.match(/^\[(?:ExtractAudio|MoveFiles|download)\]\s+(?:Destination|Moving file .* to):\s*(.+)$/);
  if (destination2) addFile(job, destination2[1]);
}

function buildArgs(url, settings, ytdlpPath, ffmpegDir, jsRuntime) {
  const outputDir = (settings.output_dir || '').trim() || path.join(require('os').homedir(), 'Downloads');
  const template = (settings.output_template || '%(title)s.%(ext)s').trim() || '%(title)s.%(ext)s';
  fs.mkdirSync(outputDir, { recursive: true });

  const fmt = settings.format === 'audio' ? 'audio' : 'video';
  const quality = String(settings.quality || 'best');
  const retries = Math.max(1, Math.min(99, parseInt(settings.retries, 10) || 10));
  const fragments = Math.max(1, Math.min(16, parseInt(settings.concurrent_fragments, 10) || 4));
  const args = [
    '--color',
    'no_color',
    '--newline',
    '--progress',
    '--progress-template',
    'download:DLPROGRESS|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_estimate_str)s',
    '--no-simulate',
    '--print',
    'before_dl:TITLE|%(title)s',
    '--print',
    'after_move:FILE|%(filepath)s',
    '--no-mtime',
    '-o',
    path.join(outputDir, template),
    '--retries',
    String(retries),
    '--fragment-retries',
    String(retries),
    '--concurrent-fragments',
    String(fragments),
    '--socket-timeout',
    '30',
  ];

  if (ffmpegDir) {
    args.push('--ffmpeg-location', ffmpegDir);
  }

  // yt-dlp richiede un runtime JavaScript per le sfide di YouTube.
  // Usiamo Electron stesso in modalità Node, senza dipendenze esterne.
  args.push('--js-runtimes', `node:${jsRuntime || process.execPath}`);

  if (fmt === 'audio') {
    args.push('-x');
    const audioFormat = String(settings.audio_format || 'mp3');
    if (audioFormat && audioFormat !== 'best') {
      args.push('--audio-format', audioFormat);
    } else {
      args.push('--audio-format', 'best');
    }
    const bitrate = String(settings.audio_quality || '192').replace(/[^0-9]/g, '');
    if (bitrate && audioFormat !== 'wav' && audioFormat !== 'flac') {
      args.push('--audio-quality', `${bitrate}K`);
    }
  } else {
    if (quality === 'best') {
      args.push(
        '-f',
        'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b',
        '--merge-output-format',
        'mp4',
      );
    } else if (['2160', '1440', '1080', '720', '480', '360'].includes(quality)) {
      args.push(
        '-f',
        `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
        '--merge-output-format',
        'mp4',
      );
    } else {
      args.push('-f', 'bv*+ba/b', '--merge-output-format', 'mp4');
    }
  }

  if (!settings.playlist) args.push('--no-playlist');
  if (settings.subtitles) {
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', (settings.sub_langs || 'en').trim() || 'en');
    if (settings.embed_subs) args.push('--embed-subs');
  }
  if (settings.embed_thumb) args.push('--embed-thumbnail');
  if (settings.metadata) args.push('--embed-metadata');
  if (settings.sponsorblock) {
    args.push('--sponsorblock-remove', 'sponsor,intro,outro,selfpromo,interaction');
  }
  if ((settings.rate_limit || '').trim()) args.push('-r', settings.rate_limit.trim());
  if ((settings.cookies_from || '').trim()) args.push('--cookies-from-browser', settings.cookies_from.trim());
  if ((settings.proxy || '').trim()) args.push('--proxy', settings.proxy.trim());
  if (settings.geo_bypass) args.push('--geo-bypass');

  args.push(url);
  return args;
}

function killTree(proc) {
  if (!proc || !proc.pid) return;
  if (binaries.isWin) {
    try {
      execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500);
    } catch {
      /* ignore */
    }
  }
}

async function runJob(job) {
  active += 1;
  job.status = 'running';
  job.startedAt = Date.now();
  emit(job, true);

  let proc = null;
  try {
    const tools = await binaries.ensureToolLinks();
    const current = binaries.getBinaries();
    const ytdlp = current.ytdlp;
    if (!ytdlp.path) {
      throw new Error('yt-dlp non trovato. Aggiorna i binari dalle impostazioni.');
    }

    const args = buildArgs(job.url, job.settings, ytdlp.path, tools.binDir, process.execPath);
    addLog(job, `[app] ${path.basename(ytdlp.path)} ${args.includes('--no-playlist') ? '(singolo video)' : '(playlist)'}`);
    addLog(job, '[app] runtime JavaScript YouTube: Electron (Node)');

    proc = spawn(ytdlp.path, args, {
      cwd: job.settings.output_dir || process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    job.proc = proc;

    let buffer = '';
    const consume = (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(job, line);
    };

    proc.stdout.on('data', consume);
    proc.stderr.on('data', consume);

    const code = await new Promise((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', resolve);
    });

    if (buffer.trim()) handleLine(job, buffer);

    if (job.cancelled) {
      job.status = 'cancelled';
    } else if (code === 0) {
      job.status = 'done';
      job.progress = 100;
      job.eta = '';
      if (!job.files.length) {
        for (const line of job.log) {
          const file = line.match(/FILE\|(.+)$/);
          if (file) addFile(job, file[1]);
        }
      }
    } else {
      job.status = 'error';
      const errorLine = [...job.log].reverse().find((line) => /ERROR:|error:/i.test(line));
      job.error = errorLine
        ? errorLine.replace(/^ERROR:\s*/i, '').slice(0, 400)
        : `yt-dlp è terminato con codice ${code}`;
    }
  } catch (error) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    job.error = job.error || (error && error.message ? error.message : String(error));
    addLog(job, `[app error] ${job.error}`);
  } finally {
    job.proc = null;
    job.finishedAt = Date.now();
    emit(job, true);
    active -= 1;
    schedule();
  }
}

function schedule() {
  while (active < MAX_ACTIVE && queue.length) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job || job.status !== 'queued') continue;
    runJob(job);
  }
}

function start(payload) {
  const urls = Array.isArray(payload && payload.urls) ? payload.urls : [];
  const settings = (payload && payload.settings) || {};
  const valid = [];
  for (const raw of urls) {
    let value = String(raw || '').trim();
    if (!value) continue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      valid.push(parsed.toString());
    } catch {
      /* ignora URL non validi */
    }
  }

  if (!valid.length) throw new Error('Inserisci almeno un link valido (http/https).');
  if (valid.length > 20) throw new Error('Massimo 20 link per volta.');

  const created = [];
  for (const url of valid) {
    const job = {
      id: newId(),
      url,
      settings,
      title: '',
      status: 'queued',
      progress: 0,
      speed: '',
      eta: '',
      size: '',
      files: [],
      error: '',
      log: [],
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      proc: null,
      cancelled: false,
      emitTimer: null,
    };
    jobs.set(job.id, job);
    queue.push(job.id);
    created.push(publicJob(job));
    emit(job, true);
  }

  schedule();
  return created;
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job) throw new Error('Download non trovato');
  if (!['queued', 'running'].includes(job.status)) return publicJob(job);
  job.cancelled = true;
  if (job.proc) killTree(job.proc);
  job.status = 'cancelled';
  job.eta = '';
  emit(job, true);
  return publicJob(job);
}

function list() {
  return Array.from(jobs.values()).map(publicJob);
}

function get(id) {
  const job = jobs.get(id);
  if (!job) return null;
  return { ...publicJob(job), log: job.log.slice(-400) };
}

function clearFinished() {
  for (const [id, job] of jobs) {
    if (['done', 'error', 'cancelled'].includes(job.status)) {
      if (job.emitTimer) clearTimeout(job.emitTimer);
      jobs.delete(id);
    }
  }
  return list();
}

function onUpdate(listener) {
  emitter.on('update', listener);
  return () => emitter.off('update', listener);
}

module.exports = {
  start,
  cancel,
  list,
  get,
  clearFinished,
  onUpdate,
  buildArgs,
  toFileUrl,
};
