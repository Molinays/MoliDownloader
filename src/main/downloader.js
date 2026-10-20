/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const binaries = require('./binaries');
const resolver = require('./resolver');
const prefs = require('./settings');

const jobs = new Map();
const queue = [];
let active = 0;
const emitter = new EventEmitter();

/** Download attivi insieme: valore scelto nelle impostazioni (default 2). */
function maxActive() {
  try {
    const value = Number(prefs.get().maxParallel);
    if (Number.isFinite(value) && value > 0) return Math.min(8, Math.max(1, value));
  } catch {
    /* impostazioni non ancora leggibili: resta il default */
  }
  return 2;
}

/** Browser installati di cui yt-dlp può leggere i cookie. */
function installedBrowsers() {
  const local = process.env.LOCALAPPDATA || '';
  const roaming = process.env.APPDATA || '';
  const home = require('os').homedir();
  const candidates = binaries.isWin
    ? [
        ['chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
        ['edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
        ['firefox', path.join(roaming, 'Mozilla', 'Firefox', 'Profiles')],
        ['brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
        ['opera', path.join(roaming, 'Opera Software', 'Opera Stable')],
      ]
    : [
        ['chrome', path.join(home, '.config', 'google-chrome')],
        ['edge', path.join(home, '.config', 'microsoft-edge')],
        ['firefox', path.join(home, '.mozilla', 'firefox')],
        ['brave', path.join(home, '.config', 'BraveSoftware', 'Brave-Browser')],
        ['chromium', path.join(home, '.config', 'chromium')],
      ];
  return candidates.filter(([, dir]) => dir && fs.existsSync(dir)).map(([name]) => name);
}

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
    note: job.note || '',
    resolvedFrom: job.resolvedFrom || '',
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

function safeFileName(value) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return cleaned.slice(0, 120);
}

/** Titoli dei player che non dicono nulla sul video: meglio il link. */
const GENERIC_TITLES = /^(?:vixcloud|vixsrc|megaplay|player|video|stream|playlist|master|index|untitled|home|watch)$/i;

function usableTitle(value) {
  const clean = safeFileName(value);
  return clean && !GENERIC_TITLES.test(clean) ? clean : '';
}

/** Titolo leggibile ricavato dal link, quando la pagina non ne dichiara uno. */
function titleFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(segments.pop() || '').replace(/\.(?:html?|php|m3u8|mp4)$/i, '');
    const cleaned = last.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned || /^\d+$/.test(cleaned)) return '';
    const words = cleaned.split(' ').map((word) => {
      const lower = word.toLowerCase();
      if (['ita', 'sub', 'hd', '4k', 'ova'].includes(lower)) return lower.toUpperCase();
      if (lower === 'ep' || lower === 'episode') return 'Episodio';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
    return safeFileName(words.join(' '));
  } catch {
    return '';
  }
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
    // Per i link dei player yt-dlp vede solo il nome della playlist: resta il
    // titolo letto dalla pagina del sito.
    if (title && (!job.resolvedFrom || !usableTitle(job.title))) job.title = title;
    if (usableTitle(job.title)) job.artifactPrefix = usableTitle(job.title);
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

function buildArgs(url, settings, ytdlpPath, ffmpegDir, jsRuntime, extra = {}) {
  const outputDir = (settings.output_dir || '').trim() || path.join(require('os').homedir(), 'Downloads');
  const fallbackTemplate = (settings.output_template || '%(title)s.%(ext)s').trim() || '%(title)s.%(ext)s';
  const title = usableTitle(extra.title);
  // Il titolo della pagina è il nome del file: il flusso HLS da solo
  // porterebbe il nome dell'id del CDN (es. 74657.mp4).
  const template = title ? `${title.replace(/%/g, '%%')}.%(ext)s` : fallbackTemplate;
  fs.mkdirSync(outputDir, { recursive: true });

  const fmt = settings.format === 'audio' ? 'audio' : 'video';
  const quality = String(settings.quality || 'best');
  const retries = Math.max(1, Math.min(99, parseInt(settings.retries, 10) || 10));
  const fragments = Math.max(1, Math.min(16, parseInt(settings.concurrent_fragments, 10) || 8));
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
    // YouTube (e altri CDN) limitano la velocità di ogni singola richiesta:
    // scaricare a blocchi da 10 MB e con un buffer più grande evita il throttle.
    '--http-chunk-size',
    '10M',
    '--buffer-size',
    '1M',
    '--socket-timeout',
    '30',
  ];
  // File temporanei (.part, .ytdl, frammenti) fuori dalla cartella di output:
  // se il download viene annullato si eliminano senza lasciare residui.
  if (extra.tempDir) args.push('--paths', `temp:${extra.tempDir}`);

  if (ffmpegDir) {
    args.push('--ffmpeg-location', ffmpegDir);
  }

  const headers = extra.headers || {};
  const userAgent = headers['user-agent'] || resolver.UA;
  args.push('--user-agent', userAgent);
  if (headers.referer) args.push('--add-header', `Referer:${headers.referer}`);
  if (headers.origin) args.push('--add-header', `Origin:${headers.origin}`);

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
      // L'ultima alternativa ignora la qualità: molti flussi HLS (player
      // protetti, live) non hanno tutte le risoluzioni richieste e senza il
      // fallback yt-dlp rifiuterebbe il download.
      args.push(
        '-f',
        `bv*[height<=${quality}][ext=mp4]+ba[ext=m4a]/bv*[height<=${quality}]+ba/b[height<=${quality}]/bv*+ba/b`,
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
  if (settings.metadata) {
    args.push('--embed-metadata');
    // Nelle proprietà del file deve restare solo il nome: niente campo Titolo.
    args.push('--replace-in-metadata', 'post_process:title', '.*', '');
  }
  if (settings.sponsorblock) {
    args.push('--sponsorblock-remove', 'sponsor,intro,outro,selfpromo,interaction');
  }
  if ((settings.rate_limit || '').trim()) args.push('-r', settings.rate_limit.trim());
  if ((settings.cookies_from || '').trim()) args.push('--cookies-from-browser', settings.cookies_from.trim());
  if (extra.cookies) args.push('--cookies-from-browser', extra.cookies);
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

/** Esegue yt-dlp e restituisce il codice di uscita. */
function runYtDlp(job, executable, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
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

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (buffer.trim()) handleLine(job, buffer);
      resolve(code);
    });
  });
}

function errorFromLog(job, from) {
  const lines = job.log.slice(from);
  const errorLine = [...lines].reverse().find((line) => /ERROR:|error:/i.test(line));
  return errorLine ? errorLine.replace(/^ERROR:\s*/i, '').slice(0, 400) : '';
}

/** Risolve il link del sito con il resolver dedicato, con un nuovo tentativo. */
async function resolveLink(job) {
  let resolved = null;
  let resolveError = null;
  for (let attempt = 0; attempt < 2 && !resolved; attempt += 1) {
    if (attempt > 0) {
      addLog(job, '[app] Nuovo tentativo di risoluzione...');
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    try {
      resolved = await resolver.resolve(job.url, (line) => addLog(job, `[resolve] ${line}`));
    } catch (error) {
      resolveError = error;
    }
  }
  if (!resolved) throw resolveError;
  if (resolved.title && !job.title) job.title = resolved.title;
  job.resolvedFrom = job.url;
  emit(job, true);
  return resolved;
}

/** Elimina i .part/.ytdl rimasti nella cartella di output dopo un annullamento. */
function removeJobLeftovers(job, tempDir) {
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* file già chiusi o cartella rimossa */
    }
  }
  const prefix = String(job.artifactPrefix || '');
  const outputDir = String((job.settings && job.settings.output_dir) || '').trim();
  if (!prefix || !outputDir) return;
  let names = [];
  try {
    names = fs.readdirSync(outputDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    if (!/\.(?:part|ytdl|temp)(?:$|[.-])/i.test(name) && !/\.part-Frag\d+/i.test(name)) continue;
    const file = path.join(outputDir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      // Non toccare file di altri download partiti prima di questo.
      if (job.startedAt && stat.mtimeMs + 5000 < job.startedAt) continue;
      fs.rmSync(file, { force: true });
      addLog(job, `[app] Rimosso file parziale: ${name}`);
    } catch {
      /* file già rimosso dal processo */
    }
  }
}

async function runJob(job) {
  active += 1;
  job.status = 'running';
  job.startedAt = Date.now();
  job.note = '';
  let tempDir = '';
  emit(job, true);

  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `molidowloader-${job.id}-`));
    const tools = await binaries.ensureToolLinks();
    const current = binaries.getBinaries();
    const ytdlp = current.ytdlp;
    if (!ytdlp.path) {
      throw new Error('yt-dlp non trovato. Aggiorna i binari dalle impostazioni.');
    }

    const settings = job.settings || {};
    let targetUrl = job.url;
    let extra = {};
    let resolvedOnce = false;

    if (resolver.isSupported(job.url)) {
      addLog(job, `[app] Risoluzione del link di ${new URL(job.url).hostname}`);
      const resolved = await resolveLink(job);
      targetUrl = resolved.url;
      extra = { title: resolved.title, headers: resolved.headers };
      resolvedOnce = true;
    }

    // Se il download fallisce, l'app riprova da sola con altre impostazioni:
    // prima i cookie del browser (TikTok, Instagram, siti con accesso),
    // poi la ricerca del vero flusso dentro la pagina (player nascosti).
    const strategies = [{ label: 'impostazioni scelte', cookies: '' }];
    const automatic = settings.auto_retry !== false;
    const isTikTok = (() => {
      try {
        const host = new URL(job.url).hostname.toLowerCase();
        return host === 'tiktok.com' || host.endsWith('.tiktok.com');
      } catch {
        return false;
      }
    })();
    if (automatic) {
      // TikTok: il player pubblico dà un solo mp4 con il titolo giusto, mentre
      // yt-dlp sui link embed produce file doppi e nomi generici.
      if (isTikTok) {
        strategies.unshift({ label: 'player TikTok', resolve: true });
        resolvedOnce = true;
      }
      const cookieSources = settings.cookie_fallback === false ? [] : installedBrowsers();
      const chosen = String(settings.cookies_from || '').trim();
      for (const browser of cookieSources) {
        if (browser === chosen) continue;
        strategies.push({ label: `cookie di ${browser}`, cookies: browser });
        if (strategies.filter((strategy) => strategy.cookies).length >= 2) break;
      }
      if (!resolvedOnce) strategies.push({ label: 'ricerca del flusso nella pagina', resolve: true });
    }

    let failure = '';
    for (let index = 0; index < strategies.length; index += 1) {
      if (job.cancelled) break;
      const strategy = strategies[index];
      let attemptUrl = targetUrl;
      let attemptExtra = { ...extra };

      if (index > 0) {
        job.note = strategy.label;
        job.progress = 0;
        job.speed = '';
        job.eta = '';
        addLog(job, `[app] Nuovo tentativo: ${strategy.label}`);
        emit(job, true);
      }
      if (strategy.cookies) attemptExtra = { ...attemptExtra, cookies: strategy.cookies };

      if (strategy.resolve) {
        try {
          const found = await resolver.resolveAuto(job.url, (line) => addLog(job, `[resolve] ${line}`));
          if (!found || !found.url) {
            failure = 'Nessun video trovato nella pagina: il sito non espone un flusso scaricabile.';
            addLog(job, `[app] ${failure}`);
            continue;
          }
          attemptUrl = found.url;
          attemptExtra = {
            title: found.title || attemptExtra.title || titleFromUrl(job.url),
            headers: { ...(attemptExtra.headers || {}), ...(found.headers || {}) },
          };
          if (found.title) job.title = found.title;
          job.resolvedFrom = job.url;
          addLog(job, `[app] Flusso trovato (${new URL(found.url).hostname}).`);
          emit(job, true);
        } catch (error) {
          failure = error && error.message ? error.message : String(error);
          addLog(job, `[app] Ricerca del flusso non riuscita: ${failure}`);
          continue;
        }
      }

      if (!usableTitle(attemptExtra.title)) {
        const inferred = titleFromUrl(job.url);
        if (inferred) attemptExtra = { ...attemptExtra, title: inferred };
      }

      job.artifactPrefix = usableTitle(attemptExtra.title) || job.artifactPrefix || '';
      const args = buildArgs(attemptUrl, settings, ytdlp.path, tools.binDir, process.execPath, {
        ...attemptExtra,
        tempDir,
      });
      addLog(
        job,
        `[app] yt-dlp avviato (${args.includes('--no-playlist') ? 'video singolo' : 'playlist'})${
          strategy.cookies ? ` · cookie di ${strategy.cookies}` : ''
        }`,
      );
      const logStart = job.log.length;
      let code = -1;
      try {
        code = await runYtDlp(job, ytdlp.path, args);
      } catch (error) {
        addLog(job, `[app error] ${error && error.message ? error.message : error}`);
      }
      job.proc = null;

      if (job.cancelled) {
        job.status = 'cancelled';
        break;
      }
      if (code === 0) {
        job.status = 'done';
        job.progress = 100;
        job.eta = '';
        job.note = '';
        if (!job.files.length) {
          for (const line of job.log) {
            const file = line.match(/FILE\|(.+)$/);
            if (file) addFile(job, file[1]);
          }
        }
        break;
      }

      failure = errorFromLog(job, logStart) || `yt-dlp è terminato con codice ${code}`;
      addLog(job, `[app] Tentativo non riuscito: ${failure}`);
    }

    if (job.cancelled) {
      job.status = 'cancelled';
    } else if (job.status !== 'done') {
      job.status = 'error';
      job.note = '';
      job.error = failure || 'Download non riuscito.';
      // I link dei player scadono: il messaggio aiuta a rifare la risoluzione.
      if (job.resolvedFrom && /403|401|forbidden|expired|token/i.test(`${job.error} ${job.log.join(' ')}`)) {
        job.error = `${job.error} — Il link del player potrebbe essere scaduto: riprova a risolverlo dal sito.`;
      }
    }
  } catch (error) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    job.error = job.error || (error && error.message ? error.message : String(error));
    job.note = '';
    addLog(job, `[app error] ${job.error}`);
  } finally {
    job.proc = null;
    if (job.cancelled) removeJobLeftovers(job, tempDir);
    else if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* cartella già rimossa */
      }
    }
    job.finishedAt = Date.now();
    emit(job, true);
    active -= 1;
    schedule();
  }
}

function schedule() {
  while (active < maxActive() && queue.length) {
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
      note: '',
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
  schedule,
  maxActive,
  buildArgs,
  titleFromUrl,
  usableTitle,
  installedBrowsers,
  toFileUrl,
};
