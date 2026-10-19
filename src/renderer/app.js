'use strict';

const api = window.moli;

const state = {
  view: 'download',
  currentTab: 'video',
  jobs: new Map(),
  clips: [],
  selectedId: null,
  music: null,
  exporting: false,
  editorBusy: 0,
  logJobId: null,
  logTimer: null,
  previewStopAt: null,
  lastExport: null,
  downloadsDir: '',
  defaults: null,
  updateBusy: false,
  compressCatalog: null,
  compressSystem: null,
  compressScanning: false,
  compressScanError: '',
  compressSource: null,
  compressBusy: false,
  compressPercent: 0,
  compressPreset: 'balanced',
  compressAudioSelected: new Set(),
  compressSubtitleSelected: new Set(),
  compressGains: {},
  lastCompress: null,
  info: null,
  infoLoading: false,
  infoScanning: false,
  depsBusy: false,
  depsDownloading: null,
  depsPercent: 0,
  depsMessage: '',
  update: null,
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[character];
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function fmtTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '0:00.0';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
  }
  return `${minutes}:${secs.toFixed(1).padStart(4, '0')}`;
}

function fmtUptime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days}g ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function errorMessage(error) {
  return String((error && error.message) || error || 'Errore')
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
}

function shortenUrl(url) {
  return String(url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 70);
}

let toastTimer = null;
function toast(message, type = 'ok') {
  const element = $('toast');
  if (!element) return;
  element.textContent = message;
  element.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = 'toast';
  }, 4200);
}

/* ============================ BOOTSTRAP ============================ */

document.addEventListener('DOMContentLoaded', init);

async function init() {
  createParticles();
  bindEvents();

  if (!api) {
    toast('API Electron non disponibile. Avvia con "npm start".', 'err');
    return;
  }

  try {
    const defaults = await api.defaults();
    state.defaults = defaults;
    state.downloadsDir = defaults.downloads || '';
    $('outputDir').value = defaults.outputDir || '';
    $('outputDirAudio').value = defaults.outputDir || '';
    renderEngineInfo(defaults);
  } catch (error) {
    $('statusDot').classList.add('error');
    toast(errorMessage(error), 'err');
  }

  api.on('download:update', onJobUpdate);
  api.on('export:progress', onExportProgress);
  api.on('ytdlp:progress', onUpdateProgress);
  api.on('compress:progress', onCompressProgress);
  api.on('deps:progress', onDepsProgress);
  api.on('update:status', onUpdateStatus);
  api.updateState().then(onUpdateStatus).catch(() => {});

  await loadCompressCatalog();
  refreshInfo();
  await refreshJobs();
  renderEditor();
}

function createParticles() {
  const container = $('particles-container');
  if (!container) return;
  for (let index = 0; index < 60; index += 1) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    const size = Math.random() * 2 + 1;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.animationDuration = `${Math.random() * 12 + 6}s`;
    particle.style.animationDelay = `${Math.random() * 10}s`;
    particle.style.opacity = String(Math.random() * 0.5 + 0.1);
    container.appendChild(particle);
  }
}

function bindEvents() {
  document.querySelectorAll('.view-tab').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });

  $('dlBtn').addEventListener('click', startDownload);
  $('btnClearDone').addEventListener('click', clearDone);
  $('btnUpdateYtdlp').addEventListener('click', updateYtdlp);
  $('btnOpenDownloads').addEventListener('click', () => {
    if (state.downloadsDir) api.openPath(state.downloadsDir);
  });

  document.querySelectorAll('[data-pick-folder]').forEach((button) => {
    button.addEventListener('click', () => pickFolder(button.dataset.pickFolder));
  });

  $('jobsList').addEventListener('click', onJobsClick);
  $('btnCloseLog').addEventListener('click', closeLog);
  $('logModal').addEventListener('click', (event) => {
    if (event.target === $('logModal')) closeLog();
  });

  $('urlInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      startDownload();
    }
  });

  $('btnImport').addEventListener('click', importMedia);
  $('btnAddMusic').addEventListener('click', addMusic);
  $('btnMusicPick').addEventListener('click', addMusic);
  $('btnClearProject').addEventListener('click', clearProject);
  $('btnExportTop').addEventListener('click', startExport);
  $('btnExport').addEventListener('click', startExport);
  $('btnCancelExport').addEventListener('click', cancelExport);
  $('btnPreviewPlay').addEventListener('click', playSelection);
  $('btnOpenExport').addEventListener('click', () => {
    if (state.lastExport) api.openPath(state.lastExport);
  });
  $('btnRevealExport').addEventListener('click', () => {
    if (state.lastExport) api.reveal(state.lastExport);
  });

  $('inspector').addEventListener('input', onInspectorInput);
  $('inspector').addEventListener('change', onInspectorChange);
  $('inspector').addEventListener('click', onInspectorClick);
  $('timeline').addEventListener('click', onTimelineClick);
  $('timeline').addEventListener('dragstart', onTimelineDragStart);
  $('timeline').addEventListener('dragend', onTimelineDragEnd);
  $('timeline').addEventListener('dragover', onTimelineDragOver);
  $('timeline').addEventListener('drop', onTimelineDrop);

  $('musicVolume').addEventListener('input', (event) => {
    if (!state.music) return;
    state.music.volume = Number(event.target.value) / 100;
    $('musicVolumeLabel').textContent = `${event.target.value}%`;
  });
  $('musicFadeIn').addEventListener('change', (event) => {
    if (!state.music) return;
    state.music.fadeIn = Math.max(0, Number(event.target.value) || 0);
    event.target.value = state.music.fadeIn;
  });
  $('musicFadeOut').addEventListener('change', (event) => {
    if (!state.music) return;
    state.music.fadeOut = Math.max(0, Number(event.target.value) || 0);
    event.target.value = state.music.fadeOut;
  });
  $('musicLoop').addEventListener('change', (event) => {
    if (!state.music) return;
    state.music.loop = event.target.checked;
  });
  $('btnMusicRemove').addEventListener('click', () => {
    state.music = null;
    renderMusic();
    toast('Traccia musicale rimossa');
  });

  $('exportFormat').addEventListener('change', syncExportMode);
  bindCompressEvents();
  bindInfoEvents();

  const video = $('edVideo');
  video.addEventListener('timeupdate', onVideoTime);
  video.addEventListener('error', () => {
    if (!selectedClip()) return;
    $('previewBadge').hidden = false;
    $('previewBadge').textContent = 'ANTEPRIMA NON DISPONIBILE';
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLog();
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (state.view !== 'editor') return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'BUTTON', 'A'].includes(tag)) return;
    event.preventDefault();
    removeSelectedClip();
  });

  ['dragenter', 'dragover'].forEach((name) => {
    document.addEventListener(name, (event) => {
      event.preventDefault();
      document.body.classList.add('dragging');
    });
  });
  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) document.body.classList.remove('dragging');
  });
  document.addEventListener('drop', async (event) => {
    event.preventDefault();
    document.body.classList.remove('dragging');
    const paths = api.getDroppedPaths(event.dataTransfer.files);
    if (paths.length) {
      if (state.view === 'compress') {
        await loadCompressSource(paths[0]);
      } else {
        switchView('editor');
        await addPathsToEditor(paths);
      }
      return;
    }
    const text = event.dataTransfer.getData('text');
    if (text && /^https?:\/\//i.test(text.trim())) {
      $('urlInput').value = text.trim();
      switchView('download');
    }
  });
}

/* ============================== VIEWS ============================== */

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  $('viewDownload').hidden = view !== 'download';
  $('viewEditor').hidden = view !== 'editor';
  $('viewCompress').hidden = view !== 'compress';
  $('viewInfo').hidden = view !== 'info';
  if (view === 'editor') {
    renderEditor();
  } else if (view === 'compress') {
    openCompressView();
  } else if (view === 'info') {
    openInfoView();
  } else {
    refreshJobs();
  }
  syncExportMode();
}

function setTab(tab) {
  state.currentTab = tab === 'audio' ? 'audio' : 'video';
  $('tabVideo').className = state.currentTab === 'video' ? 'tab active' : 'tab';
  $('tabAudio').className = state.currentTab === 'audio' ? 'tab active' : 'tab';
  $('videoSettings').style.display = state.currentTab === 'video' ? '' : 'none';
  $('audioSettings').style.display = state.currentTab === 'audio' ? '' : 'none';
}

function renderEngineInfo(defaults) {
  const binaries = (defaults && defaults.binaries) || {};
  const ytdlp = binaries.ytdlp || {};
  const ffmpeg = binaries.ffmpeg || {};

  const ytdlpLabel = $('ytdlpVersion');
  ytdlpLabel.textContent = ytdlp.version || 'non trovato';
  ytdlpLabel.classList.toggle('bad', !ytdlp.path);

  const fullFfmpegVersion = String(ffmpeg.version || '');
  const ffmpegVersion = (fullFfmpegVersion.match(/ffmpeg version (\d+(?:\.\d+)*)/i) || [])[1];
  const ffmpegLabel = $('ffmpegVersion');
  ffmpegLabel.textContent = ffmpegVersion || fullFfmpegVersion || 'non trovato';
  ffmpegLabel.title = fullFfmpegVersion;
  ffmpegLabel.classList.toggle('bad', !ffmpeg.path);

  const dot = $('statusDot');
  const ready = Boolean(ytdlp.path && ffmpeg.path);
  dot.classList.toggle('error', !ready);
  dot.title = ready ? 'Motori locali pronti' : 'yt-dlp o FFmpeg non trovati';
}

/* ============================ DOWNLOADER ============================ */

async function pickFolder(which) {
  const input = $(which === 'audio' ? 'outputDirAudio' : 'outputDir');
  try {
    const folder = await api.pickFolder(input.value);
    if (folder) input.value = folder;
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function collectSettings() {
  return {
    format: state.currentTab,
    quality: $('quality').value,
    audio_format: $('audioFormat').value,
    audio_quality: $('audioQuality').value,
    output_dir: (state.currentTab === 'audio' ? $('outputDirAudio').value : $('outputDir').value).trim(),
    output_template: $('outputTmpl').value.trim() || '%(title)s.%(ext)s',
    subtitles: $('subtitles').checked,
    sub_langs: $('subLangs').value.trim() || 'en',
    embed_subs: $('embedSubs').checked,
    embed_thumb: $('embedThumb').checked,
    playlist: $('playlist').checked,
    metadata: $('metadata').checked,
    sponsorblock: $('sponsorblock').checked,
    geo_bypass: $('geoBypass').checked,
    rate_limit: $('rateLimit').value.trim(),
    retries: parseInt($('retries').value, 10) || 10,
    concurrent_fragments: parseInt($('concurrentFragments').value, 10) || 4,
    cookies_from: $('cookiesFrom').value,
    proxy: $('proxy').value.trim(),
  };
}

async function startDownload() {
  const raw = $('urlInput').value.trim();
  if (!raw) {
    toast('Inserisci almeno un link', 'err');
    return;
  }

  const urls = raw.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  if (!urls.length) {
    toast('Inserisci almeno un link valido', 'err');
    return;
  }

  const button = $('dlBtn');
  button.disabled = true;
  button.textContent = 'Avvio...';

  try {
    const jobs = await api.startDownloads({ urls, settings: collectSettings() });
    $('urlInput').value = '';
    toast(`${jobs.length} download in coda`);
    await refreshJobs();
  } catch (error) {
    toast(errorMessage(error), 'err');
  } finally {
    button.disabled = false;
    button.textContent = 'Scarica';
  }
}

function onJobUpdate(job) {
  if (!job || !job.id) return;
  const previous = state.jobs.get(job.id);
  state.jobs.set(job.id, { ...(previous || {}), ...job });

  if (previous && previous.status !== job.status) {
    if (job.status === 'done') {
      toast(`Completato: ${job.title || shortenUrl(job.url)}`);
    } else if (job.status === 'error') {
      const message = errorMessage(job.error || 'Download fallito');
      const unsupported = /unsupported url|no suitable extractor|is not a valid url|no video formats found/i.test(message);
      toast(
        unsupported
          ? `${message} — Sito non gestito da yt-dlp: aggiorna yt-dlp dalla scheda Info o usa un link supportato.`
          : message,
        'err',
      );
    }
  }

  renderJobs();
  if (state.logJobId === job.id) loadLog(job.id);
}

async function refreshJobs() {
  if (!api) return;
  try {
    const jobs = await api.listJobs();
    state.jobs = new Map(jobs.map((job) => [job.id, job]));
    renderJobs();
  } catch {
    /* ignore */
  }
}

function jobStatusLabel(status) {
  return {
    queued: 'in coda',
    running: 'download',
    done: 'completato',
    error: 'errore',
    cancelled: 'annullato',
  }[status] || status;
}

function renderJobs() {
  const container = $('jobsList');
  const jobs = Array.from(state.jobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!jobs.length) {
    container.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span>Nessun download ancora</div>';
    return;
  }

  container.innerHTML = jobs.map((job) => {
    const status = job.status || 'queued';
    const active = status === 'queued' || status === 'running';
    const percent = clamp(Number(job.progress) || 0, 0, 100);
    const title = job.title || shortenUrl(job.url);
    const meta = [];
    if (job.size) meta.push(esc(job.size));
    if (job.speed) meta.push(esc(job.speed));
    if (job.eta) meta.push(`ETA ${esc(job.eta)}`);
    meta.push(`${percent.toFixed(percent < 10 ? 1 : 0)}%`);

    const files = (job.files || []).map((file) => `
      <div class="job-file">
        <span class="job-file-name" title="${esc(file.path)}">${esc(file.name)}</span>
        <span class="job-file-size">${fmtBytes(file.size)}</span>
        <button class="btn-sm" data-action="editor" data-path="${esc(file.path)}">Editor</button>
        <button class="btn-sm" data-action="reveal" data-path="${esc(file.path)}" title="Mostra nella cartella">Cartella</button>
      </div>`).join('');

    return `<div class="job-card ${status}">
      <div class="job-header">
        <span class="job-url" title="${esc(job.url)}">${esc(title)}</span>
        <span class="job-status ${status}">${jobStatusLabel(status)}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="job-meta">${meta.join(' · ')}</div>
      ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ''}
      ${files ? `<div class="job-files">${files}</div>` : ''}
      <div class="job-actions">
        ${active ? `<button class="btn-sm btn-cancel" data-action="cancel" data-id="${esc(job.id)}">✕ Annulla</button>` : ''}
        <button class="btn-sm" data-action="log" data-id="${esc(job.id)}">Log</button>
        <button class="btn-sm" data-action="reveal-job" data-id="${esc(job.id)}">Cartella</button>
      </div>
    </div>`;
  }).join('');
}

function onJobsClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'cancel') {
    cancelJob(button.dataset.id);
  } else if (action === 'log') {
    openLog(button.dataset.id);
  } else if (action === 'editor') {
    switchView('editor');
    addPathsToEditor([button.dataset.path]);
  } else if (action === 'reveal') {
    api.reveal(button.dataset.path);
  } else if (action === 'reveal-job') {
    const job = state.jobs.get(button.dataset.id);
    if (job && job.files && job.files.length) api.reveal(job.files[job.files.length - 1].path);
    else if (state.downloadsDir) api.openPath(state.downloadsDir);
  }
}

async function cancelJob(id) {
  if (!id || !window.confirm('Annullare questo download?')) return;
  try {
    await api.cancelDownload(id);
    toast('Download annullato');
    await refreshJobs();
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function clearDone() {
  try {
    const jobs = await api.clearFinished();
    state.jobs = new Map(jobs.map((job) => [job.id, job]));
    renderJobs();
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function openLog(id) {
  state.logJobId = id;
  $('modalTitle').textContent = 'Log download';
  $('logModal').classList.add('open');
  $('logModal').setAttribute('aria-hidden', 'false');
  await loadLog(id);
  clearInterval(state.logTimer);
  state.logTimer = setInterval(() => loadLog(state.logJobId), 1000);
}

async function loadLog(id) {
  if (!id) return;
  try {
    const job = await api.getJob(id);
    if (!job) {
      $('logBox').textContent = 'Download non trovato';
      return;
    }
    $('modalTitle').textContent = `Log — ${job.title || shortenUrl(job.url)}`;
    const box = $('logBox');
    box.textContent = (job.log || []).join('\n') || '(nessun output ancora)';
    box.scrollTop = box.scrollHeight;
  } catch (error) {
    $('logBox').textContent = errorMessage(error);
  }
}

function closeLog() {
  $('logModal').classList.remove('open');
  $('logModal').setAttribute('aria-hidden', 'true');
  clearInterval(state.logTimer);
  state.logTimer = null;
  state.logJobId = null;
}

async function updateYtdlp() {
  if (state.updateBusy) return;
  state.updateBusy = true;
  const button = $('btnUpdateYtdlp');
  button.disabled = true;
  $('updateStatus').textContent = 'Scarico l\'ultima versione...';
  try {
    const updated = await api.updateYtDlp();
    if (state.defaults) state.defaults.binaries.ytdlp = updated;
    renderEngineInfo(state.defaults);
    $('updateStatus').textContent = `Aggiornato a ${updated.version || 'ultima versione'}`;
    toast('yt-dlp aggiornato');
  } catch (error) {
    $('updateStatus').textContent = errorMessage(error);
    toast(errorMessage(error), 'err');
  } finally {
    state.updateBusy = false;
    button.disabled = false;
  }
}

function onUpdateProgress(progress) {
  if (!state.updateBusy) return;
  const percent = Number.isFinite(progress && progress.percent)
    ? `${Math.round(progress.percent * 100)}%`
    : fmtBytes(progress && progress.received);
  $('updateStatus').textContent = `Aggiornamento yt-dlp... ${percent}`;
}

/* ============================== EDITOR ============================== */

function selectedClip() {
  return state.clips.find((clip) => clip.id === state.selectedId) || null;
}

function projectDuration() {
  return state.clips.reduce((total, clip) => {
    const duration = Math.max(0, clip.out - clip.in);
    return total + duration / (clip.speed || 1);
  }, 0);
}

function updateEditorMeta() {
  const total = projectDuration();
  const label = state.editorBusy > 0 ? 'Analisi file...' : `${state.clips.length} clip · ${fmtTime(total)}`;
  $('editorMeta').textContent = label;
  $('timelineMeta').textContent = `${state.clips.length} clip · ${fmtTime(total)}`;
}

async function importMedia() {
  try {
    const paths = await api.pickMedia();
    if (paths.length) await addPathsToEditor(paths);
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function addPathsToEditor(paths) {
  if (!paths || !paths.length) return;
  state.editorBusy += 1;
  updateEditorMeta();

  let added = 0;
  for (const filePath of paths) {
    try {
      const info = await api.probeFile(filePath);
      if (!info || !(info.duration > 0.05)) {
        throw new Error(`${info && info.name ? info.name : 'File'}: durata non valida`);
      }
      const clip = {
        id: uid(),
        path: info.path,
        name: info.name,
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
        mediaUrl: info.mediaUrl,
        thumbnailUrl: info.thumbnailUrl,
        waveformUrl: info.waveformUrl,
        in: 0,
        out: info.duration,
        volume: 1,
        mute: false,
        fadeIn: 0,
        fadeOut: 0,
        speed: 1,
      };
      state.clips.push(clip);
      state.selectedId = clip.id;
      added += 1;
    } catch (error) {
      toast(`Import: ${errorMessage(error)}`, 'err');
    }
  }

  state.editorBusy = Math.max(0, state.editorBusy - 1);
  renderEditor();
  if (added && selectedClip()) loadPreview();
  if (added) toast(`${added} clip aggiunte all'editor`);
}

function renderEditor() {
  renderTimeline();
  renderInspector();
  renderMusic();
  updateEditorMeta();
}

function renderTimeline() {
  const timeline = $('timeline');
  if (!state.clips.length) {
    timeline.innerHTML = '<div class="timeline-empty">La timeline è vuota — importa una clip per iniziare</div>';
    return;
  }

  timeline.innerHTML = state.clips.map((clip, index) => {
    const inPercent = clamp((clip.in / clip.duration) * 100, 0, 100);
    const outPercent = clamp((clip.out / clip.duration) * 100, 0, 100);
    const selected = clip.id === state.selectedId;
    const thumbnail = clip.thumbnailUrl
      ? `<img src="${esc(clip.thumbnailUrl)}" alt="">`
      : `<span class="tl-noimg">${clip.hasVideo ? '🎞️' : '🎵'}</span>`;
    const waveform = clip.waveformUrl
      ? `<img class="tl-wave-img" src="${esc(clip.waveformUrl)}" alt="">`
      : '';

    return `<div class="tl-clip ${selected ? 'selected' : ''}" draggable="true" data-clip-id="${clip.id}">
      <div class="tl-thumb">
        ${thumbnail}
        <span class="tl-index">${index + 1}</span>
        <span class="tl-dur">${fmtTime((clip.out - clip.in) / (clip.speed || 1))}</span>
      </div>
      <div class="tl-body">
        <div class="tl-name" title="${esc(clip.name)}">${esc(clip.name)}</div>
        <div class="tl-wave">
          ${waveform}
          <span class="tl-cut" style="width:${inPercent}%"></span>
          <span class="tl-cut right" style="width:${100 - outPercent}%"></span>
        </div>
        <div class="tl-meta">${Math.round((clip.mute ? 0 : clip.volume) * 100)}% · ${clip.speed}x${clip.fadeIn || clip.fadeOut ? ' · fade' : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function renderInspector() {
  const clip = selectedClip();
  const inspector = $('inspector');

  if (!clip) {
    inspector.innerHTML = '<div class="muted">Seleziona una clip dalla timeline per tagliarla e modificarne l\'audio.</div>';
    return;
  }

  const inPercent = clamp((clip.in / clip.duration) * 100, 0, 100);
  const outPercent = clamp((clip.out / clip.duration) * 100, 0, 100);
  const wave = clip.waveformUrl
    ? `<div class="wave-wrap">
        <img class="wave-img" src="${esc(clip.waveformUrl)}" alt="">
        <span class="wave-cut" style="width:${inPercent}%"></span>
        <span class="wave-cut right" style="width:${100 - outPercent}%"></span>
        <span class="wave-selection" style="left:${inPercent}%;right:${100 - outPercent}%"></span>
      </div>`
    : '<div class="wave-empty">Forma d\'onda non disponibile</div>';

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  inspector.innerHTML = `
    <div class="inspector-head">
      <div class="inspector-titles">
        <div class="inspector-title" title="${esc(clip.name)}">${esc(clip.name)}</div>
        <div class="inspector-sub">${clip.hasVideo ? `${clip.width}×${clip.height} · ${(clip.fps || 0).toFixed(2)} fps` : 'Solo audio'}${clip.hasAudio ? ' · audio' : ' · senza audio'}</div>
      </div>
      <span class="inspector-badge">${fmtTime(clip.duration)}</span>
    </div>
    ${wave}
    <div class="trim-block">
      <div class="field">
        <label for="clipIn">Inizio <span class="range-value" id="clipInValue">${fmtTime(clip.in)}</span></label>
        <input id="clipIn" type="range" min="0" max="${clip.duration}" step="0.05" value="${clip.in}">
      </div>
      <div class="field">
        <label for="clipOut">Fine <span class="range-value" id="clipOutValue">${fmtTime(clip.out)}</span></label>
        <input id="clipOut" type="range" min="0" max="${clip.duration}" step="0.05" value="${clip.out}">
      </div>
      <div class="trim-quick">
        <button class="btn-sm" data-trim="in">IN = cursore</button>
        <button class="btn-sm" data-trim="out">OUT = cursore</button>
        <button class="btn-sm" data-trim="reset">Reset</button>
      </div>
      <div class="clip-duration">Durata selezione <strong id="clipDuration">${fmtTime((clip.out - clip.in) / (clip.speed || 1))}</strong></div>
    </div>
    <div class="settings-grid compact">
      <div class="field">
        <label for="clipVolume">Volume <span id="clipVolumeValue">${Math.round(clip.volume * 100)}%</span></label>
        <input id="clipVolume" type="range" min="0" max="200" step="1" value="${Math.round(clip.volume * 100)}" ${clip.mute ? 'disabled' : ''}>
      </div>
      <div class="field">
        <label for="clipSpeed">Velocità</label>
        <select id="clipSpeed">
          ${speeds.map((speed) => `<option value="${speed}" ${Math.abs(clip.speed - speed) < 0.01 ? 'selected' : ''}>${speed}x</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="clipFadeIn">Fade in (s)</label>
        <input id="clipFadeIn" type="number" min="0" step="0.1" value="${Number(clip.fadeIn.toFixed(2))}">
      </div>
      <div class="field">
        <label for="clipFadeOut">Fade out (s)</label>
        <input id="clipFadeOut" type="number" min="0" step="0.1" value="${Number(clip.fadeOut.toFixed(2))}">
      </div>
    </div>
    <label class="toggle-item compact-toggle">
      <span class="toggle-label">Muto</span>
      <span class="toggle"><input id="clipMute" type="checkbox" ${clip.mute ? 'checked' : ''}><span class="slider"></span></span>
    </label>
    <div class="clip-actions">
      <button class="btn-sm" data-act="left" title="Sposta a sinistra">←</button>
      <button class="btn-sm" data-act="right" title="Sposta a destra">→</button>
      <button class="btn-sm" data-act="duplicate">Duplica</button>
      <button class="btn-sm btn-cancel" data-act="remove">Rimuovi</button>
    </div>`;
}

function refreshInspectorValues() {
  const clip = selectedClip();
  if (!clip) return;
  const inInput = $('clipIn');
  const outInput = $('clipOut');
  if (inInput) {
    inInput.max = String(clip.duration);
    inInput.value = String(clip.in);
  }
  if (outInput) {
    outInput.max = String(clip.duration);
    outInput.value = String(clip.out);
  }
  if ($('clipInValue')) $('clipInValue').textContent = fmtTime(clip.in);
  if ($('clipOutValue')) $('clipOutValue').textContent = fmtTime(clip.out);
  if ($('clipDuration')) $('clipDuration').textContent = fmtTime((clip.out - clip.in) / (clip.speed || 1));
  if ($('clipVolumeValue')) $('clipVolumeValue').textContent = `${Math.round(clip.volume * 100)}%`;
  if ($('clipVolume')) $('clipVolume').value = String(Math.round(clip.volume * 100));

  const inPercent = clamp((clip.in / clip.duration) * 100, 0, 100);
  const outPercent = clamp((clip.out / clip.duration) * 100, 0, 100);
  const wave = document.querySelector('#inspector .wave-wrap');
  if (wave) {
    const cuts = wave.querySelectorAll('.wave-cut');
    if (cuts[0]) cuts[0].style.width = `${inPercent}%`;
    if (cuts[1]) cuts[1].style.width = `${100 - outPercent}%`;
    const selection = wave.querySelector('.wave-selection');
    if (selection) {
      selection.style.left = `${inPercent}%`;
      selection.style.right = `${100 - outPercent}%`;
    }
  }

  syncTimelineClip(clip);
  updateEditorMeta();
}

function syncTimelineClip(clip) {
  const card = document.querySelector(`.tl-clip[data-clip-id="${clip.id}"]`);
  if (!card) return;
  const inPercent = clamp((clip.in / clip.duration) * 100, 0, 100);
  const outPercent = clamp((clip.out / clip.duration) * 100, 0, 100);
  const cuts = card.querySelectorAll('.tl-cut');
  if (cuts[0]) cuts[0].style.width = `${inPercent}%`;
  if (cuts[1]) cuts[1].style.width = `${100 - outPercent}%`;
  const meta = card.querySelector('.tl-meta');
  if (meta) {
    meta.textContent = `${Math.round((clip.mute ? 0 : clip.volume) * 100)}% · ${clip.speed}x${clip.fadeIn || clip.fadeOut ? ' · fade' : ''}`;
  }
  const duration = card.querySelector('.tl-dur');
  if (duration) duration.textContent = fmtTime((clip.out - clip.in) / (clip.speed || 1));
}

function selectClip(id) {
  if (!state.clips.some((clip) => clip.id === id)) return;
  state.selectedId = id;
  renderTimeline();
  renderInspector();
  loadPreview();
}

function loadPreview() {
  const clip = selectedClip();
  const video = $('edVideo');

  if (!clip) {
    video.pause();
    delete video.dataset.clipId;
    video.removeAttribute('src');
    video.load();
    $('previewEmpty').hidden = false;
    $('previewBadge').hidden = true;
    $('edSelection').textContent = 'Nessuna clip selezionata';
    $('edTime').textContent = '00:00.0 / 00:00.0';
    return;
  }

  $('previewEmpty').hidden = true;
  $('previewBadge').hidden = false;
  $('previewBadge').textContent = clip.hasVideo ? (clip.hasAudio ? 'VIDEO' : 'MUTO') : 'AUDIO';
  $('edSelection').textContent = `${clip.name} · ${fmtTime((clip.out - clip.in) / (clip.speed || 1))}`;
  state.previewStopAt = null;
  video.volume = clip.mute ? 0 : Math.min(1, clip.volume);

  if (video.dataset.clipId !== clip.id) {
    video.dataset.clipId = clip.id;
    video.src = clip.mediaUrl;
    video.load();
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (!selectedClip() || selectedClip().id !== clip.id) return;
        video.currentTime = Math.min(clip.in + 0.01, Math.max(0, clip.duration - 0.05));
        updateVideoTime();
      },
      { once: true },
    );
  } else {
    video.currentTime = Math.min(clip.in + 0.01, Math.max(0, clip.duration - 0.05));
  }
  updateVideoTime();
}

function updateVideoTime() {
  const video = $('edVideo');
  const clip = selectedClip();
  if (!clip) return;
  const total = Number.isFinite(video.duration) ? video.duration : clip.duration;
  $('edTime').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(total)}`;
}

function onVideoTime() {
  updateVideoTime();
  const video = $('edVideo');
  if (state.previewStopAt != null && video.currentTime >= state.previewStopAt - 0.03) {
    state.previewStopAt = null;
    video.pause();
  }
}

function playSelection() {
  const clip = selectedClip();
  if (!clip) {
    toast('Seleziona una clip', 'err');
    return;
  }
  const video = $('edVideo');
  video.currentTime = clip.in;
  state.previewStopAt = clip.out;
  video.play().catch(() => {
    toast('Anteprima non disponibile per questo formato', 'err');
    state.previewStopAt = null;
  });
}

function onInspectorInput(event) {
  const clip = selectedClip();
  if (!clip) return;
  const target = event.target;

  if (target.id === 'clipIn') {
    clip.in = clamp(Number(target.value) || 0, 0, Math.max(0, clip.out - 0.05));
    target.value = String(clip.in);
    refreshInspectorValues();
  } else if (target.id === 'clipOut') {
    clip.out = clamp(Number(target.value) || 0, clip.in + 0.05, clip.duration);
    target.value = String(clip.out);
    refreshInspectorValues();
  } else if (target.id === 'clipVolume') {
    clip.volume = clamp(Number(target.value) / 100, 0, 2);
    $('clipVolumeValue').textContent = `${target.value}%`;
    syncTimelineClip(clip);
    const video = $('edVideo');
    video.volume = clip.mute ? 0 : Math.min(1, clip.volume);
  }
}

function onInspectorChange(event) {
  const clip = selectedClip();
  if (!clip) return;
  const target = event.target;

  if (target.id === 'clipIn' || target.id === 'clipOut') {
    renderTimeline();
    refreshInspectorValues();
  } else if (target.id === 'clipSpeed') {
    clip.speed = clamp(Number(target.value) || 1, 0.5, 2);
    renderTimeline();
    refreshInspectorValues();
    $('edSelection').textContent = `${clip.name} · ${fmtTime((clip.out - clip.in) / clip.speed)}`;
  } else if (target.id === 'clipFadeIn') {
    clip.fadeIn = clamp(Number(target.value) || 0, 0, (clip.out - clip.in) / 2);
    target.value = String(Number(clip.fadeIn.toFixed(2)));
    syncTimelineClip(clip);
  } else if (target.id === 'clipFadeOut') {
    clip.fadeOut = clamp(Number(target.value) || 0, 0, (clip.out - clip.in) / 2);
    target.value = String(Number(clip.fadeOut.toFixed(2)));
    syncTimelineClip(clip);
  } else if (target.id === 'clipMute') {
    clip.mute = target.checked;
    $('edVideo').volume = clip.mute ? 0 : Math.min(1, clip.volume);
    const volume = $('clipVolume');
    if (volume) volume.disabled = clip.mute;
    syncTimelineClip(clip);
  }
}

function onInspectorClick(event) {
  const clip = selectedClip();
  if (!clip) return;
  const trimButton = event.target.closest('[data-trim]');
  if (trimButton) {
    const action = trimButton.dataset.trim;
    if (action === 'reset') {
      clip.in = 0;
      clip.out = clip.duration;
    } else {
      const video = $('edVideo');
      if (video.dataset.clipId !== clip.id || !Number.isFinite(video.currentTime)) {
        toast('Carica la clip nel player per usare il cursore', 'err');
        return;
      }
      if (action === 'in') {
        clip.in = clamp(video.currentTime, 0, Math.max(0, clip.out - 0.05));
      } else {
        clip.out = clamp(video.currentTime, clip.in + 0.05, clip.duration);
      }
    }
    renderTimeline();
    refreshInspectorValues();
    return;
  }

  const actionButton = event.target.closest('[data-act]');
  if (!actionButton) return;
  const action = actionButton.dataset.act;
  const index = state.clips.findIndex((item) => item.id === clip.id);

  if (action === 'left' && index > 0) {
    [state.clips[index - 1], state.clips[index]] = [state.clips[index], state.clips[index - 1]];
  } else if (action === 'right' && index < state.clips.length - 1) {
    [state.clips[index + 1], state.clips[index]] = [state.clips[index], state.clips[index + 1]];
  } else if (action === 'duplicate') {
    const copy = { ...clip, id: uid(), name: `${clip.name} (copia)` };
    state.clips.splice(index + 1, 0, copy);
    state.selectedId = copy.id;
    renderEditor();
    loadPreview();
    return;
  } else if (action === 'remove') {
    removeSelectedClip();
    return;
  }
  renderEditor();
}

function removeSelectedClip() {
  if (!state.clips.length) return;
  const index = state.clips.findIndex((clip) => clip.id === state.selectedId);
  if (index < 0) return;
  state.clips.splice(index, 1);
  const next = state.clips[Math.min(index, state.clips.length - 1)];
  state.selectedId = next ? next.id : null;
  renderEditor();
  loadPreview();
}

function clearProject() {
  if (!state.clips.length && !state.music) return;
  if (!window.confirm('Svuotare il montaggio? Le clip importate non verranno cancellate dal disco.')) return;
  state.clips = [];
  state.selectedId = null;
  state.music = null;
  $('edVideo').pause();
  delete $('edVideo').dataset.clipId;
  $('edVideo').removeAttribute('src');
  $('edVideo').load();
  state.lastExport = null;
  $('exportResult').hidden = true;
  $('exportBar').style.width = '0%';
  $('exportStatus').textContent = 'Pronto per esportare.';
  renderEditor();
  loadPreview();
}

/* ---------------------------- timeline DnD ---------------------------- */

let dragClipId = null;

function onTimelineClick(event) {
  const card = event.target.closest('[data-clip-id]');
  if (!card) return;
  if (card.dataset.clipId === state.selectedId) return;
  selectClip(card.dataset.clipId);
}

function onTimelineDragStart(event) {
  const card = event.target.closest('[data-clip-id]');
  if (!card) return;
  dragClipId = card.dataset.clipId;
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragClipId);
}

function onTimelineDragEnd(event) {
  dragClipId = null;
  document.querySelectorAll('.tl-clip.dragging').forEach((card) => card.classList.remove('dragging'));
  document.querySelectorAll('.tl-clip.drop-target').forEach((card) => card.classList.remove('drop-target'));
}

function onTimelineDragOver(event) {
  event.preventDefault();
  const card = event.target.closest('[data-clip-id]');
  document.querySelectorAll('.tl-clip.drop-target').forEach((item) => item.classList.remove('drop-target'));
  if (card && card.dataset.clipId !== dragClipId) card.classList.add('drop-target');
}

function onTimelineDrop(event) {
  event.preventDefault();
  const card = event.target.closest('[data-clip-id]');
  const sourceId = dragClipId;
  dragClipId = null;
  document.querySelectorAll('.tl-clip.dragging, .tl-clip.drop-target').forEach((item) => {
    item.classList.remove('dragging', 'drop-target');
  });
  if (!card || !sourceId || card.dataset.clipId === sourceId) return;

  const fromIndex = state.clips.findIndex((clip) => clip.id === sourceId);
  const toIndex = state.clips.findIndex((clip) => clip.id === card.dataset.clipId);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = state.clips.splice(fromIndex, 1);
  state.clips.splice(toIndex, 0, moved);
  state.selectedId = moved.id;
  renderTimeline();
  loadPreview();
}

/* ------------------------------- music ------------------------------- */

async function addMusic() {
  if (!api) return;
  try {
    const filePath = await api.pickAudio();
    if (!filePath) return;
    const info = await api.probeFile(filePath);
    if (!info.hasAudio) throw new Error('Il file non contiene audio');
    state.music = {
      path: info.path,
      name: info.name,
      duration: info.duration,
      volume: 0.35,
      fadeIn: 0,
      fadeOut: 0,
      loop: true,
    };
    renderMusic();
    toast('Traccia musicale aggiunta');
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function renderMusic() {
  const music = state.music;
  $('musicEmpty').hidden = Boolean(music);
  $('musicBody').hidden = !music;
  if (!music) return;
  $('musicName').textContent = `${music.name} · ${fmtTime(music.duration)}`;
  $('musicVolume').value = String(Math.round(music.volume * 100));
  $('musicVolumeLabel').textContent = `${Math.round(music.volume * 100)}%`;
  $('musicFadeIn').value = String(Number(music.fadeIn.toFixed(2)));
  $('musicFadeOut').value = String(Number(music.fadeOut.toFixed(2)));
  $('musicLoop').checked = Boolean(music.loop);
}

/* ------------------------------ export ------------------------------- */

function syncExportMode() {
  const audioOnly = $('exportFormat').value === 'm4a';
  $('exportRes').disabled = audioOnly;
  $('exportFps').disabled = audioOnly;
}

async function startExport() {
  if (state.exporting) return;
  if (!state.clips.length) {
    toast('Aggiungi almeno una clip al montaggio', 'err');
    return;
  }

  const format = $('exportFormat').value;
  const project = {
    name: $('projectName').value.trim() || 'Montaggio',
    clips: state.clips.map((clip) => ({
      path: clip.path,
      in: clip.in,
      out: clip.out,
      volume: clip.volume,
      mute: clip.mute,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      speed: clip.speed,
    })),
    music: state.music
      ? {
          path: state.music.path,
          volume: state.music.volume,
          fadeIn: state.music.fadeIn,
          fadeOut: state.music.fadeOut,
          loop: state.music.loop,
        }
      : null,
    resolution: $('exportRes').value,
    fps: $('exportFps').value === 'source' ? 'source' : Number($('exportFps').value),
    format,
    crf: Number($('exportCrf').value),
    preset: 'medium',
  };

  state.exporting = true;
  state.lastExport = null;
  $('exportResult').hidden = true;
  $('exportBar').style.width = '0%';
  $('exportStatus').textContent = 'Preparazione del montaggio...';
  setExportBusy(true);

  try {
    const result = await api.exportProject(project);
    if (result.canceled) {
      $('exportStatus').textContent = 'Esportazione annullata.';
      $('exportBar').style.width = '0%';
    } else if (result.ok) {
      state.lastExport = result.path;
      $('exportBar').style.width = '100%';
      $('exportStatus').textContent = `Esportato: ${result.name} (${fmtBytes(result.size)})`;
      $('exportResult').hidden = false;
      toast('Montaggio esportato');
    }
  } catch (error) {
    const message = errorMessage(error);
    if (/annullata/i.test(message)) {
      $('exportStatus').textContent = 'Esportazione annullata.';
      $('exportBar').style.width = '0%';
    } else {
      $('exportStatus').textContent = `Errore: ${message}`;
      toast(message, 'err');
    }
  } finally {
    state.exporting = false;
    setExportBusy(false);
  }
}

function setExportBusy(busy) {
  $('btnExport').disabled = busy;
  $('btnExportTop').disabled = busy;
  $('btnExport').textContent = busy ? 'Esportazione...' : 'Esporta montaggio';
  $('btnCancelExport').hidden = !busy;
}

async function cancelExport() {
  if (!state.exporting) return;
  $('exportStatus').textContent = 'Annullamento in corso...';
  try {
    await api.cancelExport();
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function onExportProgress(progress) {
  if (!state.exporting) return;
  const percent = clamp((Number(progress.progress) || 0) * 100, 0, 100);
  $('exportBar').style.width = `${percent.toFixed(1)}%`;
  $('exportStatus').textContent = `Esportazione ${percent.toFixed(0)}% · ${fmtTime(progress.seconds || 0)} / ${fmtTime(progress.total || 0)}`;
}

/* ============================= COMPRIMI ============================= */

const COMPRESS_HW_ORDER = [
  'av1_nvenc',
  'av1_qsv',
  'av1_amf',
  'hevc_nvenc',
  'hevc_qsv',
  'hevc_amf',
  'hevc_videotoolbox',
  'h264_nvenc',
  'h264_qsv',
  'h264_amf',
  'h264_videotoolbox',
];

const COMPRESS_TEXT_SUBS = new Set([
  'subrip',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
  'subviewer',
  'subviewer1',
  'microdvd',
  'sami',
  'realtext',
  'eia_608',
  'hdmv_text_subtitle',
]);

const COMPRESS_PRESETS = {
  max: {
    container: 'mp4',
    software: 'libx265',
    hardwareCodec: ['av1', 'hevc', 'h264'],
    quality: 30,
    speed: 'slow',
    resolution: '1080p',
    audioTracks: 'first',
    audioCodec: 'aac',
    audioBitrate: 96,
    subtitleTracks: 'all',
  },
  balanced: {
    container: 'mp4',
    software: 'libx265',
    hardwareCodec: ['hevc', 'h264', 'av1'],
    quality: 24,
    speed: 'medium',
    resolution: 'source',
    audioTracks: 'all',
    audioCodec: 'aac',
    audioBitrate: 128,
    subtitleTracks: 'all',
  },
  quality: {
    container: 'mkv',
    software: 'libx265',
    hardwareCodec: ['hevc', 'av1', 'h264'],
    quality: 19,
    speed: 'slow',
    resolution: 'source',
    audioTracks: 'all',
    audioCodec: 'aac',
    audioBitrate: 192,
    subtitleTracks: 'all',
  },
  social: {
    container: 'mp4',
    software: 'libx264',
    hardwareCodec: ['h264', 'hevc'],
    quality: 23,
    speed: 'medium',
    resolution: '1080p',
    audioTracks: 'first',
    audioCodec: 'aac',
    audioBitrate: 128,
    subtitleTracks: 'none',
  },
  archive: {
    container: 'mkv',
    software: 'libx265',
    hardwareCodec: ['hevc', 'av1'],
    quality: 18,
    speed: 'slow',
    resolution: 'source',
    audioTracks: 'all',
    audioCodec: 'copy',
    audioBitrate: 192,
    subtitleTracks: 'all',
  },
  gpu: {
    container: 'mp4',
    software: 'libx265',
    hardwareCodec: ['hevc', 'av1', 'h264'],
    quality: 24,
    speed: 'medium',
    resolution: '1080p',
    audioTracks: 'all',
    audioCodec: 'aac',
    audioBitrate: 128,
    subtitleTracks: 'all',
    forceGpu: true,
  },
  webm: {
    container: 'webm',
    software: 'libvpx-vp9',
    hardwareCodec: ['av1'],
    quality: 35,
    speed: 'fast',
    resolution: '1080p',
    audioTracks: 'first',
    audioCodec: 'libopus',
    audioBitrate: 96,
    subtitleTracks: 'all',
  },
};

const FALLBACK_COMPRESS_CATALOG = {
  containers: [
    { id: 'mp4', label: 'MP4', extension: 'mp4' },
    { id: 'mkv', label: 'MKV', extension: 'mkv' },
    { id: 'webm', label: 'WebM', extension: 'webm' },
  ],
  levels: ['auto', '3.0', '3.1', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2', '6.0', '6.1', '6.2'],
  audioCodecs: [
    { id: 'aac', label: 'AAC', containers: ['mp4', 'mkv'], lossy: true, defaultBitrate: 128, merge: true },
    { id: 'libopus', label: 'Opus', containers: ['mkv', 'webm'], lossy: true, defaultBitrate: 128, merge: true },
    { id: 'libmp3lame', label: 'MP3', containers: ['mp4', 'mkv'], lossy: true, defaultBitrate: 192, merge: true },
    { id: 'flac', label: 'FLAC', containers: ['mkv'], lossy: false, defaultBitrate: 0, merge: true },
    { id: 'libvorbis', label: 'Vorbis', containers: ['mkv', 'webm'], lossy: true, defaultBitrate: 160, merge: true },
    { id: 'copy', label: 'Copia', containers: ['mp4', 'mkv'], lossy: false, defaultBitrate: 0, merge: false },
  ],
  videoEncoders: [
    {
      id: 'libx265', label: 'H.265 / HEVC · x265 (software)', short: 'H.265 x265', family: 'x265', codec: 'hevc',
      hardware: false, containers: ['mp4', 'mkv'], defaultPreset: 'medium',
      presets: [
        { value: 'ultrafast', label: 'Ultrafast' }, { value: 'veryfast', label: 'Very fast' },
        { value: 'fast', label: 'Fast' }, { value: 'medium', label: 'Medium' },
        { value: 'slow', label: 'Slow' }, { value: 'slower', label: 'Slower' }, { value: 'veryslow', label: 'Very slow' },
      ],
      tunes: ['', 'film', 'animation', 'grain'], profiles: ['auto', 'main', 'main10'],
      quality: { min: 0, max: 51, step: 1, default: 24, label: 'CRF' }, twoPass: true,
      customParam: 'x265-params', pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
    },
    {
      id: 'libx264', label: 'H.264 / AVC · x264 (software)', short: 'H.264 x264', family: 'x264', codec: 'h264',
      hardware: false, containers: ['mp4', 'mkv'], defaultPreset: 'medium',
      presets: [
        { value: 'ultrafast', label: 'Ultrafast' }, { value: 'veryfast', label: 'Very fast' },
        { value: 'fast', label: 'Fast' }, { value: 'medium', label: 'Medium' },
        { value: 'slow', label: 'Slow' }, { value: 'slower', label: 'Slower' }, { value: 'veryslow', label: 'Very slow' },
      ],
      tunes: ['', 'film', 'animation', 'grain'], profiles: ['auto', 'baseline', 'main', 'high'],
      quality: { min: 0, max: 51, step: 1, default: 23, label: 'CRF' }, twoPass: true,
      customParam: 'x264-params', pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
    },
    {
      id: 'libvpx-vp9', label: 'VP9 · libvpx (software)', short: 'VP9', family: 'vp9', codec: 'vp9',
      hardware: false, containers: ['mkv', 'webm'], defaultPreset: '2',
      presets: [
        { value: '0', label: '0 · massima qualità' }, { value: '2', label: '2 · equilibrato' },
        { value: '4', label: '4' }, { value: '6', label: '6 · veloce' }, { value: '8', label: '8 · massima velocità' },
      ],
      tunes: [], profiles: ['auto', '0', '1', '2', '3'],
      quality: { min: 0, max: 63, step: 1, default: 32, label: 'CRF' }, twoPass: false,
      customParam: null, pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
    },
    {
      id: 'libaom-av1', label: 'AV1 · libaom (software, lento)', short: 'AV1 libaom', family: 'aom', codec: 'av1',
      hardware: false, containers: ['mp4', 'mkv', 'webm'], defaultPreset: '6',
      presets: [
        { value: '0', label: '0 · massima qualità' }, { value: '4', label: '4' },
        { value: '6', label: '6 · equilibrato' }, { value: '8', label: '8 · massima velocità' },
      ],
      tunes: [], profiles: ['auto', 'main'],
      quality: { min: 0, max: 63, step: 1, default: 30, label: 'CRF' }, twoPass: false,
      customParam: null, pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
    },
  ],
};

function compressContainer() {
  return $('compressContainer') ? $('compressContainer').value : 'mp4';
}

function compressCatalogEncoder(id) {
  const catalog = state.compressCatalog || FALLBACK_COMPRESS_CATALOG;
  return catalog.videoEncoders.find((encoder) => encoder.id === id) || null;
}

function currentCompressEncoder() {
  const select = $('compressEncoder');
  if (!select || !select.value) return null;
  return compressCatalogEncoder(select.value);
}

function compressWorkingSet() {
  return new Set((state.compressSystem && state.compressSystem.working) || []);
}

function syncCompressForceWithEncoder() {
  const force = $('forceGpu');
  const encoder = currentCompressEncoder();
  if (!force || !encoder) return;
  if (encoder.hardware) force.checked = true;
  else if (state.compressSystem && state.compressSystem.hardwareAvailable) force.checked = false;
}

function bestCompressHardware(container, codecPreference) {
  const working = compressWorkingSet();
  if (!working.size) return null;
  const catalog = state.compressCatalog || FALLBACK_COMPRESS_CATALOG;
  const candidates = COMPRESS_HW_ORDER.map((id) => catalog.videoEncoders.find((encoder) => encoder.id === id))
    .filter(
      (encoder) =>
        encoder && encoder.hardware && working.has(encoder.id) && encoder.containers.includes(container),
    );
  if (!candidates.length) return null;
  if (Array.isArray(codecPreference)) {
    for (const codec of codecPreference) {
      const match = candidates.find((encoder) => encoder.codec === codec);
      if (match) return match.id;
    }
  }
  return candidates[0].id;
}

function compressFallbackEncoder(container, preferred) {
  const catalog = state.compressCatalog || FALLBACK_COMPRESS_CATALOG;
  const list = catalog.videoEncoders.filter((encoder) => encoder.containers.includes(container));
  if (preferred) {
    const match = list.find((encoder) => encoder.id === preferred);
    if (match) return match.id;
  }
  const software = list.find((encoder) => !encoder.hardware);
  return (software && software.id) || (list[0] && list[0].id) || 'libx264';
}

async function loadCompressCatalog() {
  if (state.compressCatalog) return state.compressCatalog;
  try {
    const catalog = await api.compressCatalog();
    if (catalog && Array.isArray(catalog.videoEncoders) && catalog.videoEncoders.length) {
      state.compressCatalog = catalog;
    }
  } catch {
    state.compressCatalog = null;
  }
  if (!state.compressCatalog) state.compressCatalog = FALLBACK_COMPRESS_CATALOG;
  populateCompressEncoderSelect();
  updateCompressEncoderUi({ resetQuality: true });
  return state.compressCatalog;
}

async function openCompressView() {
  if (!state.compressCatalog) await loadCompressCatalog();
  renderCompress();
  if (!state.compressSystem && !state.compressScanning) scanCompressGpu(false);
}

function renderCompress() {
  if (!state.compressCatalog) return;
  renderCompressSource();
  populateCompressEncoderSelect();
  updateCompressEncoderUi({ resetQuality: false });
  renderCompressTracks();
  renderCompressGpuPanel();
  updateCompressRateFields();
  applyCompressOutputExtension();
  updateCompressSummary();
}

function renderCompressSource() {
  const source = state.compressSource;
  const name = $('compressSourceName');
  const meta = $('compressSourceMeta');
  const start = $('btnStartCompress');

  if (!source) {
    name.textContent = 'Nessun video selezionato';
    meta.textContent = 'Scegli un file o trascinalo qui per iniziare';
    if (start) start.disabled = true;
    updateCompressVideoTrackSelect();
    return;
  }

  const video = source.videoTracks[0];
  const parts = [];
  if (video && video.width && video.height) parts.push(`${video.width}×${video.height}`);
  if (video && video.fps) parts.push(`${video.fps.toFixed(2)} fps`);
  parts.push(fmtTime(source.duration));
  if (source.size) parts.push(fmtBytes(source.size));
  if (video && video.codec) parts.push(video.codec.toUpperCase());
  if (source.audioTracks.length) parts.push(`${source.audioTracks.length} audio`);
  if (source.subtitleTracks.length) parts.push(`${source.subtitleTracks.length} sub`);

  name.textContent = source.name;
  name.title = source.path;
  meta.textContent = parts.join(' · ');
  if (start) start.disabled = state.compressBusy;
  updateCompressVideoTrackSelect();
}

function updateCompressVideoTrackSelect() {
  const select = $('compressVideoTrack');
  if (!select) return;
  const source = state.compressSource;
  if (!source || !source.videoTracks.length) {
    select.innerHTML = '<option value="0">Principale</option>';
    select.disabled = true;
    return;
  }
  const previous = select.value;
  select.disabled = source.videoTracks.length < 2;
  select.innerHTML = source.videoTracks
    .map((track) => {
      const label = `${track.width}×${track.height} · ${track.codec.toUpperCase()}${track.default ? ' · default' : ''}`;
      return `<option value="${track.index}">${esc(label)}</option>`;
    })
    .join('');
  if (source.videoTracks.some((track) => String(track.index) === previous)) select.value = previous;
  else select.value = String(source.videoTracks[0].index);
}

function populateCompressEncoderSelect(preferredId) {
  const select = $('compressEncoder');
  if (!select || !state.compressCatalog) return;
  const container = compressContainer();
  const catalog = state.compressCatalog;
  const list = catalog.videoEncoders.filter((encoder) => encoder.containers.includes(container));
  const working = compressWorkingSet();
  if (!list.length) {
    select.innerHTML = '<option value="">Nessun encoder</option>';
    return;
  }
  const usable = (encoder) => !encoder.hardware || working.has(encoder.id);
  const currentValue = preferredId || select.value;
  let chosen = list.find((encoder) => encoder.id === currentValue && usable(encoder));
  const forceEnabled = Boolean($('forceGpu') && $('forceGpu').checked && !$('forceGpu').disabled);
  if (forceEnabled) {
    const best = bestCompressHardware(container, null);
    const bestEncoder = best ? list.find((encoder) => encoder.id === best) : null;
    if (bestEncoder) chosen = bestEncoder;
    else if (chosen && chosen.hardware) chosen = null;
  } else if (!chosen && $('forceGpu') && $('forceGpu').checked) {
    const best = bestCompressHardware(container, null);
    if (best) chosen = list.find((encoder) => encoder.id === best);
  }
  if (!chosen) {
    const softwareOrder = ['libx265', 'libx264', 'libvpx-vp9', 'libaom-av1'];
    for (const id of softwareOrder) {
      const match = list.find((encoder) => encoder.id === id);
      if (match) {
        chosen = match;
        break;
      }
    }
  }
  if (!chosen) chosen = list.find((encoder) => !encoder.hardware) || list[0];

  const software = list.filter((encoder) => !encoder.hardware);
  const hardware = list.filter((encoder) => encoder.hardware);
  const softwareOptions = software
    .map((encoder) => `<option value="${encoder.id}">${esc(encoder.label)}</option>`)
    .join('');
  const hardwareOptions = hardware
    .map((encoder) => {
      const available = working.has(encoder.id);
      const suffix = available ? '' : ' · non disponibile';
      return `<option value="${encoder.id}" ${available ? '' : 'disabled'}>${esc(encoder.label)}${suffix}</option>`;
    })
    .join('');
  select.innerHTML =
    (softwareOptions ? `<optgroup label="Software (CPU)">${softwareOptions}</optgroup>` : '') +
    (hardwareOptions ? `<optgroup label="Hardware (GPU)">${hardwareOptions}</optgroup>` : '');
  if (chosen) select.value = chosen.id;
}

function compressPresetValue(encoder, speed) {
  if (!encoder || !encoder.presets.length) return '';
  const has = (value) => encoder.presets.some((preset) => preset.value === value);
  let value = speed;
  if (encoder.family === 'nvenc') value = speed === 'slow' ? 'p6' : speed === 'medium' ? 'p5' : 'p4';
  else if (encoder.family === 'aom') value = speed === 'slow' ? '4' : speed === 'medium' ? '6' : '7';
  else if (encoder.family === 'vp9') value = speed === 'slow' ? '2' : speed === 'medium' ? '4' : '6';
  else if (encoder.family === 'amf') {
    if (encoder.codec === 'h264') value = speed === 'slow' ? '2' : speed === 'medium' ? '1' : '0';
    else if (encoder.codec === 'hevc') value = speed === 'slow' ? '10' : speed === 'medium' ? '5' : '0';
    else value = speed === 'slow' ? '100' : speed === 'medium' ? '50' : '0';
  }
  else if (encoder.family === 'videotoolbox') value = '';
  if (value && has(value)) return value;
  if (has(encoder.defaultPreset)) return encoder.defaultPreset;
  return encoder.presets[0].value;
}

function updateCompressEncoderUi({ resetQuality = true } = {}) {
  const encoder = currentCompressEncoder();
  if (!encoder) return;
  const badge = $('compressEncoderBadge');
  const note = $('compressEncoderNote');
  badge.textContent = encoder.hardware ? 'gpu' : 'software';
  badge.classList.toggle('hw', encoder.hardware);

  if (encoder.hardware) {
    const gpu = (state.compressSystem && state.compressSystem.gpus.find((item) => item.vendor === encoder.vendor)) || null;
    note.textContent = `Render forzato su ${gpu ? gpu.name : 'GPU'} · ${encoder.short}. Nessun fallback automatico al software.`;
    note.className = 'encoder-note hw';
  } else {
    note.textContent = `Encoding su CPU (${encoder.short}). Se attivi “Forza la GPU”, uso l'encoder hardware migliore disponibile.`;
    note.className = 'encoder-note';
  }

  const hwToggle = $('compressHwAccel');
  if (hwToggle) {
    hwToggle.disabled = !encoder.hardware;
    hwToggle.title = encoder.hardware
      ? 'Decodifica hardware (NVDEC/D3D11VA) con fallback automatico sul software se il formato non è supportato.'
      : 'Disponibile solo con encoder GPU.';
  }

  const presetSelect = $('compressPreset');
  const currentPreset = presetSelect.value;
  presetSelect.innerHTML = encoder.presets.length
    ? encoder.presets.map((preset) => `<option value="${esc(preset.value)}">${esc(preset.label)}</option>`).join('')
    : '<option value="">Unico</option>';
  if (encoder.presets.some((preset) => preset.value === currentPreset)) presetSelect.value = currentPreset;
  else if (encoder.defaultPreset) presetSelect.value = encoder.defaultPreset;
  presetSelect.disabled = !encoder.presets.length;

  const tuneSelect = $('compressTune');
  const currentTune = tuneSelect.value;
  tuneSelect.innerHTML = ['<option value="">Auto</option>']
    .concat(encoder.tunes.filter(Boolean).map((tune) => `<option value="${esc(tune)}">${esc(tune)}</option>`))
    .join('');
  tuneSelect.value = encoder.tunes.includes(currentTune) ? currentTune : '';
  $('compressTuneField').hidden = !encoder.tunes.filter(Boolean).length;

  const profileSelect = $('compressProfile');
  const currentProfile = profileSelect.value;
  profileSelect.innerHTML = encoder.profiles
    .map((profile) => `<option value="${esc(profile)}">${profile === 'auto' ? 'Auto' : esc(profile)}</option>`)
    .join('');
  profileSelect.value = encoder.profiles.includes(currentProfile) ? currentProfile : 'auto';
  $('compressProfileField').hidden = encoder.profiles.length <= 1;

  const pixFmtSelect = $('compressPixFmt');
  const currentPixFmt = pixFmtSelect.value;
  pixFmtSelect.innerHTML = (encoder.pixelFormats || ['auto'])
    .map((format) => `<option value="${esc(format)}">${format === 'auto' ? 'Auto' : esc(format)}</option>`)
    .join('');
  pixFmtSelect.value = (encoder.pixelFormats || ['auto']).includes(currentPixFmt) ? currentPixFmt : 'auto';

  const isSoftwareX = encoder.family === 'x264' || encoder.family === 'x265';
  $('compressBframesField').hidden = !isSoftwareX;
  $('compressRefsField').hidden = !isSoftwareX;
  $('compressCustomField').hidden = !encoder.customParam;
  $('compressNvencAqField').hidden = encoder.family !== 'nvenc';

  const quality = encoder.quality;
  $('compressQuality').min = String(quality.min);
  $('compressQuality').max = String(quality.max);
  $('compressQuality').step = String(quality.step);
  $('compressQualityNum').min = String(quality.min);
  $('compressQualityNum').max = String(quality.max);
  $('compressQualityNum').step = String(quality.step);
  $('compressQualityLabel').textContent = quality.label;
  const currentQuality = Number($('compressQuality').value);
  const qualityValue = resetQuality || !Number.isFinite(currentQuality) ? quality.default : clamp(currentQuality, quality.min, quality.max);
  setCompressQuality(qualityValue);

  const twoPassOption = $('compressQualityMode').querySelector('option[value="twopass"]');
  twoPassOption.disabled = !encoder.twoPass;
  if (!encoder.twoPass && $('compressQualityMode').value === 'twopass') {
    $('compressQualityMode').value = 'bitrate';
  }
  updateCompressRateFields();
}

function setCompressQuality(value) {
  const encoder = currentCompressEncoder();
  const min = encoder ? encoder.quality.min : 0;
  const max = encoder ? encoder.quality.max : 51;
  const parsed = clamp(Math.round(Number(value)), min, max);
  $('compressQuality').value = String(parsed);
  $('compressQualityNum').value = String(parsed);
  $('compressQualityValue').textContent = String(parsed);
}

function updateCompressRateFields() {
  const encoder = currentCompressEncoder();
  const twoPassOption = $('compressQualityMode').querySelector('option[value="twopass"]');
  if (twoPassOption) twoPassOption.disabled = !encoder || !encoder.twoPass;
  if ($('compressQualityMode').value === 'twopass' && (!encoder || !encoder.twoPass)) {
    $('compressQualityMode').value = 'bitrate';
  }
  const mode = $('compressQualityMode').value;
  const qualityMode = mode === 'quality';
  $('compressQualityField').hidden = !qualityMode;
  $('compressRateFields').hidden = qualityMode;
  $('compressNvencAqField').hidden = !encoder || encoder.family !== 'nvenc';
}

function setCompressAudioCodec(codec) {
  const select = $('compressAudioCodec');
  if (!select) return;
  const option = Array.from(select.options).find((item) => item.value === codec);
  if (option) select.value = codec;
  syncCompressAudioCodecUi();
}

function populateCompressAudioCodecs() {
  const select = $('compressAudioCodec');
  if (!select || !state.compressCatalog) return;
  const container = compressContainer();
  const merge = $('compressMerge').checked;
  const list = state.compressCatalog.audioCodecs.filter(
    (codec) => codec.containers.includes(container) && (!merge || codec.merge),
  );
  const previous = select.value;
  select.innerHTML = list
    .map((codec) => `<option value="${codec.id}">${esc(codec.label)}</option>`)
    .join('');
  const preferred = list.some((codec) => codec.id === previous)
    ? previous
    : merge
      ? container === 'webm'
        ? 'libopus'
        : 'aac'
      : list.some((codec) => codec.id === 'copy')
        ? 'copy'
        : list[0] && list[0].id;
  if (preferred) select.value = preferred;
  syncCompressAudioCodecUi();
}

function syncCompressAudioCodecUi() {
  const source = state.compressSource;
  const hasAudio = Boolean(source && source.audioTracks.length);
  const select = $('compressAudioCodec');
  const codec = select ? select.value : 'copy';
  const passthrough = codec === 'copy';
  $('compressAudioCodec').disabled = !hasAudio;
  $('compressAudioBitrate').disabled = passthrough || codec === 'flac' || !hasAudio;
  $('compressAudioChannels').disabled = passthrough || !hasAudio;
  $('compressAudioSampleRate').disabled = passthrough || !hasAudio;
  $('compressAudioBitrateField').style.opacity = $('compressAudioBitrate').disabled ? '0.45' : '1';
  $('compressMerge').disabled = !hasAudio;
  const merge = $('compressMerge').checked;
  const hint = $('compressAudioHint');
  if (!hasAudio) hint.textContent = 'Il video non contiene audio: l\'output sarà muto.';
  else if (merge) {
    hint.textContent = `Le ${state.compressAudioSelected.size} tracce selezionate verranno mixate in un\'unica traccia. Regola il volume accanto a ciascuna traccia.`;
  } else if (passthrough) {
    hint.textContent = `${state.compressAudioSelected.size} tracce mantenute senza ricodifica.`;
  } else {
    hint.textContent = `${state.compressAudioSelected.size} tracce ricodificate in ${codec.toUpperCase()}.`;
  }
}

function renderCompressAudioTracks() {
  const container = $('compressAudioTracks');
  const source = state.compressSource;
  if (!source || !source.audioTracks.length) {
    container.innerHTML = '<div class="muted">Nessuna traccia audio.</div>';
    return;
  }
  const merge = $('compressMerge').checked;
  container.innerHTML = source.audioTracks
    .map((track) => {
      const selected = state.compressAudioSelected.has(track.index);
      const gain = state.compressGains[track.index] == null ? 100 : Math.round(state.compressGains[track.index] * 100);
      const title = track.title || `Traccia ${track.order + 1}`;
      const meta = [
        track.codec.toUpperCase(),
        `${track.channels} canali`,
        track.sampleRate ? `${Math.round(track.sampleRate / 1000)} kHz` : '',
        track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<label class="track-row ${selected ? 'selected' : ''}" data-audio-row="${track.index}">
        <input class="track-checkbox" type="checkbox" data-audio-index="${track.index}" ${selected ? 'checked' : ''}>
        <div class="track-main">
          <div class="track-title">${esc(title)}${track.language ? ` · ${esc(track.language)}` : ''}</div>
          <div class="track-meta">${esc(meta)}</div>
        </div>
        ${track.default ? '<span class="track-badge default">default</span>' : ''}
        ${merge ? `<span class="track-gain-wrap"><input class="track-gain" type="number" min="0" max="200" step="5" data-audio-gain="${track.index}" value="${gain}">%</span>` : ''}
      </label>`;
    })
    .join('');
}

function renderCompressSubtitleTracks() {
  const container = $('compressSubtitleTracks');
  const source = state.compressSource;
  if (!source || !source.subtitleTracks.length) {
    container.innerHTML = '<div class="muted">Nessuna traccia sottotitoli.</div>';
    return;
  }
  const targetContainer = compressContainer();
  container.innerHTML = source.subtitleTracks
    .map((track) => {
      const compatible = targetContainer === 'mkv' || COMPRESS_TEXT_SUBS.has(track.codec);
      if (!compatible) state.compressSubtitleSelected.delete(track.index);
      const selected = state.compressSubtitleSelected.has(track.index);
      const meta = [track.codec.toUpperCase(), track.language || '', track.forced ? 'forzati' : '']
        .filter(Boolean)
        .join(' · ');
      return `<label class="track-row ${selected ? 'selected' : ''} ${compatible ? '' : 'disabled'}" data-sub-row="${track.index}">
        <input class="track-checkbox" type="checkbox" data-sub-index="${track.index}" ${selected ? 'checked' : ''} ${compatible ? '' : 'disabled'}>
        <div class="track-main">
          <div class="track-title">${esc(track.title || `Sottotitoli ${track.order + 1}`)}</div>
          <div class="track-meta">${esc(meta)}</div>
        </div>
        ${compatible ? '' : `<span class="track-badge warn">no ${esc(targetContainer.toUpperCase())}</span>`}
      </label>`;
    })
    .join('');
}

function renderCompressTracks() {
  renderCompressAudioTracks();
  renderCompressSubtitleTracks();
  populateCompressAudioCodecs();
  const container = compressContainer();
  const hint = $('compressSubtitleHint');
  hint.textContent =
    container === 'mkv'
      ? 'In MKV i sottotitoli vengono copiati integralmente, anche quelli bitmap (PGS/DVD).'
      : 'In ' +
        container.toUpperCase() +
        ' vengono convertiti solo i sottotitoli testuali; quelli bitmap sono disponibili solo in MKV.';
  const mergeToggle = $('compressMerge');
  mergeToggle.disabled = !(state.compressSource && state.compressSource.audioTracks.length);
  syncCompressAudioCodecUi();
}

function compressVramLabel(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '';
  return `${(value / 1024 / 1024 / 1024).toFixed(value >= 1024 * 1024 * 1024 ? 1 : 0)} GB`;
}

function renderCompressGpuPanel() {
  const status = $('gpuScanStatus');
  const list = $('gpuList');
  const hint = $('gpuEncoderHint');
  const force = $('forceGpu');
  const system = state.compressSystem;
  const working = compressWorkingSet();
  const available = working.size > 0;

  if (state.compressScanning) {
    status.className = 'gpu-scan-status busy';
    status.textContent = 'Test degli encoder hardware in corso (NVENC, Quick Sync, AMF, VideoToolbox)...';
    list.innerHTML = '';
    hint.textContent = 'Sto verificando quali encoder si inizializzano davvero su questa macchina.';
    force.disabled = true;
    return;
  }

  if (state.compressScanError) {
    status.className = 'gpu-scan-status warn';
    status.textContent = `Scansione non riuscita: ${state.compressScanError}`;
    list.innerHTML = '';
    hint.textContent = 'Puoi comunque comprimere con gli encoder software.';
    force.disabled = true;
    force.checked = false;
    return;
  }

  if (!system) {
    status.className = 'gpu-scan-status';
    status.textContent = 'Scansione non ancora eseguita.';
    list.innerHTML = '';
    hint.textContent = 'Premi “Scansiona” per rilevare GPU ed encoder hardware.';
    force.disabled = true;
    return;
  }

  const gpus = system.gpus || [];
  const workingChips = (system.working || []).map((id) => {
    const encoder = compressCatalogEncoder(id);
    return `<span class="gpu-chip working">${esc(encoder ? encoder.short : id)}</span>`;
  });
  const failedChips = (system.failed || []).map((item) => {
    const encoder = compressCatalogEncoder(item.id);
    return `<span class="gpu-chip failed" title="${esc(item.error || '')}">${esc(encoder ? encoder.short : item.id)}</span>`;
  });
  list.innerHTML =
    (gpus.length
      ? gpus
          .map(
            (gpu) => `<div class="gpu-item">
              <div class="gpu-name">${esc(gpu.name)}</div>
              <div class="gpu-meta">${esc(gpu.vendor.toUpperCase())}${gpu.vram ? ` · ${compressVramLabel(gpu.vram)}` : ''}${gpu.driver ? ` · driver ${esc(gpu.driver)}` : ''}</div>
            </div>`,
          )
          .join('')
      : '<div class="gpu-item"><div class="gpu-name">Nessuna GPU rilevata</div></div>') +
    `<div class="gpu-chips">${workingChips.join('')}${failedChips.length && !workingChips.length ? failedChips.join('') : ''}</div>`;

  if (!gpus.length) {
    status.className = 'gpu-scan-status warn';
    status.textContent = 'Nessuna GPU rilevata: verrà usato l\'encoder software.';
  } else if (available) {
    status.className = 'gpu-scan-status ok';
    status.textContent = `${working.size} encoder hardware pronti: ${(system.working || []).join(', ')}`;
  } else {
    status.className = 'gpu-scan-status warn';
    status.textContent = 'GPU trovata, ma nessun encoder hardware è inizializzabile. Aggiorna i driver o usa il software.';
  }

  force.disabled = !available;
  if (!available) force.checked = false;
  const encoder = currentCompressEncoder();
  if (encoder && encoder.hardware) {
    const gpu = gpus.find((item) => item.vendor === encoder.vendor);
    hint.textContent = `Render forzato: ${encoder.short} su ${gpu ? gpu.name : 'GPU'}.`;
  } else if (force.checked && system.recommended) {
    const recommended = compressCatalogEncoder(system.recommended);
    hint.textContent = `Consigliato: ${recommended ? recommended.label : system.recommended}.`;
  } else {
    hint.textContent = 'Render software: scegli un encoder GPU o attiva “Forza la GPU”.';
  }
}

function updateCompressSummary() {
  const box = $('compressSummary');
  if (!box || !state.compressCatalog) return;
  const encoder = currentCompressEncoder();
  if (!encoder) {
    box.innerHTML = '<div class="muted">Nessun encoder disponibile.</div>';
    return;
  }    const source = state.compressSource;
    const container = compressContainer();
    const mode = $('compressQualityMode').value;
  const quality = Math.round(Number($('compressQuality').value) || encoder.quality.default);
  const bitrate = Math.round(Number($('compressBitrate').value) || 0);
  const audioCodec = $('compressAudioCodec').value || 'copy';
  const merge = $('compressMerge').checked;
  const audioCount = state.compressAudioSelected.size;

  const rows = [];
  const row = (label, value, raw = false) =>
    `<div class="summary-row"><span class="summary-label">${esc(label)}</span><span class="summary-value">${raw ? value : esc(value)}</span></div>`;

  rows.push(
    row(
      'Encoder',
      `${esc(encoder.short)}${encoder.hardware ? ' <span class="summary-value gpu">GPU</span>' : ''}`,
      true,
    ),
  );
  if (encoder.hardware) {
    rows.push(
      row(
        'Decodifica',
        $('compressHwAccel') && $('compressHwAccel').checked
          ? encoder.family === 'nvenc'
            ? 'GPU (NVDEC/CUDA)'
            : 'GPU (NVDEC/D3D11VA)'
          : 'Software',
      ),
    );
  }
  rows.push(row('Contenitore', container.toUpperCase()));
  if (mode === 'quality') rows.push(row('Qualità', `${encoder.quality.label} ${quality}`));
  else if (mode === 'twopass') rows.push(row('Bitrate', `${bitrate} kbps · 2 passate`));
  else rows.push(row('Bitrate', `${bitrate} kbps · ${mode.toUpperCase()}`));
  if ($('compressPreset').value) rows.push(row('Preset', $('compressPreset').value));

  const resolution = $('compressResolution').value;
  const resolutionLabel =
    resolution === 'source'
      ? source && source.videoTracks[0]
        ? `Originale ${source.videoTracks[0].width}×${source.videoTracks[0].height}`
        : 'Originale'
      : resolution === 'custom'
        ? `${$('compressWidth').value || 'auto'}×${$('compressHeight').value || 'auto'}`
        : resolution;
  rows.push(row('Risoluzione', resolutionLabel));
  rows.push(row('FPS', $('compressFps').value === 'source' ? 'Originale' : $('compressFps').value));
  rows.push(
    row(
      'Audio',
      source && source.audioTracks.length
        ? merge
          ? `Mix di ${audioCount} tracce · ${audioCodec.toUpperCase()}`
          : `${audioCount} tracce · ${audioCodec === 'copy' ? 'copia' : audioCodec.toUpperCase()}`
        : 'Nessun audio',
    ),
  );
  rows.push(
    row(
      'Sottotitoli',
      source && source.subtitleTracks.length ? `${state.compressSubtitleSelected.size} tracce` : 'Nessuno',
    ),
  );
  const output = $('compressOutput').value.trim();
  rows.push(row('Output', output ? output.split(/[\\/]/).pop() : 'scelto al salvataggio'));

  const estimate = estimateCompressSize();
  if (estimate) rows.push(row('Stima', `~${fmtBytes(estimate)}`));
  if (state.compressBusy) rows.push(row('Stato', `${Math.round(state.compressPercent)}%`));
  box.innerHTML = rows.join('');
}

function estimateCompressSize() {
  const source = state.compressSource;
  const mode = $('compressQualityMode').value;
  if (!source || mode === 'quality') return null;
  const videoBitrate = Math.round(Number($('compressBitrate').value) || 0);
  if (!videoBitrate || !source.duration) return null;
  const merge = $('compressMerge').checked;
  const audioCodec = $('compressAudioCodec').value;
  const audioBitrate = Math.round(Number($('compressAudioBitrate').value) || 0);
  const audioTracks = merge ? 1 : state.compressAudioSelected.size;
  const audioKbps = audioCodec === 'copy' || audioCodec === 'flac' ? 0 : audioBitrate * audioTracks;
  return Math.round(((videoBitrate + audioKbps) * 1000 * source.duration) / 8 * 1.02);
}

function applyCompressOutputExtension() {
  const input = $('compressOutput');
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;
  const container = compressContainer();
  const slash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  const dot = value.lastIndexOf('.');
  input.value = dot > slash ? `${value.slice(0, dot)}.${container}` : `${value}.${container}`;
}

async function loadCompressSource(filePath) {
  if (!filePath) return;
  if (state.compressBusy) {
    toast('Attendi la fine della compressione', 'err');
    return;
  }
  try {
    const source = await api.probeCompress(filePath);
    if (!source || !source.hasVideo) throw new Error('Il file non contiene una traccia video');
    state.compressSource = source;
    state.compressAudioSelected = new Set(source.audioTracks.map((track) => track.index));
    state.compressSubtitleSelected = new Set(source.subtitleTracks.map((track) => track.index));
    state.compressGains = {};
    resetCompressForm();
    renderCompressSource();
    applyCompressPreset('balanced');
    updateCompressSummary();
    toast(`Video caricato: ${source.name}`);
  } catch (error) {
    toast(`Apertura video: ${errorMessage(error)}`, 'err');
  }
}

function resetCompressForm() {
  $('compressContainer').value = 'mp4';
  $('compressQualityMode').value = 'quality';
  $('compressBitrate').value = '4000';
  $('compressMaxrate').value = '0';
  $('compressBufsize').value = '0';
  $('compressTune').value = '';
  $('compressProfile').value = 'auto';
  $('compressLevel').value = 'auto';
  $('compressPixFmt').value = 'auto';
  $('compressKeyint').value = '0';
  $('compressBframes').value = '0';
  $('compressRefs').value = '0';
  $('compressCustom').value = '';
  $('compressNvencAq').checked = true;
  $('compressHwAccel').checked = true;
  $('compressFaststart').checked = true;
  $('compressKeepChapters').checked = true;
  $('compressKeepMetadata').checked = true;
  $('compressKeepAttachments').checked = true;
  $('compressResolution').value = 'source';
  $('compressWidth').value = '1920';
  $('compressHeight').value = '1080';
  $('compressNoUpscale').checked = true;
  $('compressFps').value = 'source';
  $('compressDeinterlace').value = 'off';
  $('compressDenoise').value = 'off';
  $('compressSharpen').value = 'off';
  $('compressCropTop').value = '0';
  $('compressCropBottom').value = '0';
  $('compressCropLeft').value = '0';
  $('compressCropRight').value = '0';
  $('compressMerge').checked = false;
  $('compressAudioBitrate').value = '128';
  $('compressAudioChannels').value = 'source';
  $('compressAudioSampleRate').value = 'source';
  $('compressOutput').value = '';
  toggleCompressCustomSize();
}

function toggleCompressCustomSize() {
  const custom = $('compressResolution').value === 'custom';
  $('compressCustomSize').hidden = !custom;
  $('compressCustomSize2').hidden = !custom;
}

function applyCompressPreset(name) {
  const config = COMPRESS_PRESETS[name];
  if (!config || !state.compressCatalog) return;
  state.compressPreset = name;
  $('compressContainer').value = config.container;

  const useGpu = $('forceGpu').checked && !$('forceGpu').disabled;
  let encoderId = useGpu ? bestCompressHardware(config.container, config.hardwareCodec) : null;
  if (!encoderId) encoderId = compressFallbackEncoder(config.container, config.software);
  populateCompressEncoderSelect(encoderId);
  $('compressEncoder').value = encoderId;
  if (config.forceGpu && state.compressSystem && state.compressSystem.hardwareAvailable) {
    $('forceGpu').checked = true;
  }
  syncCompressForceWithEncoder();
  updateCompressEncoderUi({ resetQuality: true });

  const encoder = currentCompressEncoder();
  $('compressQualityMode').value = 'quality';
  setCompressQuality(config.quality);
  $('compressPreset').value = compressPresetValue(encoder, config.speed);
  $('compressTune').value = '';
  $('compressProfile').value = 'auto';
  $('compressLevel').value = 'auto';
  $('compressPixFmt').value = 'auto';
  $('compressKeyint').value = '0';
  $('compressBframes').value = '0';
  $('compressRefs').value = '0';
  $('compressCustom').value = '';
  $('compressHwAccel').checked = true;
  $('compressResolution').value = config.resolution;
  toggleCompressCustomSize();
  $('compressNoUpscale').checked = true;
  $('compressFps').value = 'source';
  $('compressDeinterlace').value = 'off';
  $('compressDenoise').value = 'off';
  $('compressSharpen').value = 'off';
  $('compressCropTop').value = '0';
  $('compressCropBottom').value = '0';
  $('compressCropLeft').value = '0';
  $('compressCropRight').value = '0';
  $('compressMerge').checked = Boolean(config.merge);

  if (state.compressSource) {
    const audioTracks = state.compressSource.audioTracks;
    const subtitleTracks = state.compressSource.subtitleTracks;
    state.compressAudioSelected = new Set(
      config.audioTracks === 'none'
        ? []
        : config.audioTracks === 'first'
          ? audioTracks.slice(0, 1).map((track) => track.index)
          : audioTracks.map((track) => track.index),
    );
    state.compressSubtitleSelected = new Set(
      config.subtitleTracks === 'none'
        ? []
        : subtitleTracks.map((track) => track.index),
    );
    state.compressGains = {};
  }

  renderCompressTracks();
  setCompressAudioCodec(config.audioCodec || (config.merge ? 'aac' : 'copy'));
  $('compressAudioBitrate').value = String(config.audioBitrate || 128);
  syncCompressAudioCodecUi();
  updateCompressRateFields();
  applyCompressOutputExtension();
  updateCompressSummary();

  document.querySelectorAll('.preset-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.compressPreset === name);
  });
}

function markCompressCustom() {
  if (state.compressPreset === null) return;
  state.compressPreset = null;
  document.querySelectorAll('.preset-btn').forEach((button) => button.classList.remove('active'));
}

function collectCompressOptions() {
  const encoder = currentCompressEncoder();
  const source = state.compressSource;
  const container = compressContainer();
  const mergeAudio = $('compressMerge').checked;
  let audioCodec = $('compressAudioCodec').value || 'copy';
  if (mergeAudio && audioCodec === 'copy') audioCodec = container === 'webm' ? 'libopus' : 'aac';
  const audioTracks = source
    ? source.audioTracks.map((track) => track.index).filter((index) => state.compressAudioSelected.has(index))
    : [];
  const subtitleTracks = source
    ? source.subtitleTracks
        .filter((track) => state.compressSubtitleSelected.has(track.index))
        .filter((track) => container === 'mkv' || COMPRESS_TEXT_SUBS.has(track.codec))
        .map((track) => track.index)
    : [];

  const gains = {};
  for (const index of audioTracks) {
    const value = state.compressGains[index] == null ? 1 : state.compressGains[index];
    gains[index] = clamp(Number(value) || 0, 0, 2);
  }

  const qualityMode = $('compressQualityMode').value === 'twopass' && encoder && !encoder.twoPass
    ? 'bitrate'
    : $('compressQualityMode').value;

  return {
    container,
    videoEncoder: encoder ? encoder.id : 'libx264',
    hwaccel: Boolean($('compressHwAccel') && $('compressHwAccel').checked && encoder && encoder.hardware),
    videoTrack: Number($('compressVideoTrack').value),
    qualityMode,
    quality: Math.round(Number($('compressQuality').value) || 24),
    bitrate: Math.round(Number($('compressBitrate').value) || 0),
    maxrate: Math.round(Number($('compressMaxrate').value) || 0),
    bufsize: Math.round(Number($('compressBufsize').value) || 0),
    preset: $('compressPreset').value,
    tune: $('compressTune').value,
    profile: $('compressProfile').value,
    level: $('compressLevel').value,
    pixFmt: $('compressPixFmt').value,
    keyint: Math.round(Number($('compressKeyint').value) || 0),
    bframes: Math.round(Number($('compressBframes').value) || 0),
    refs: Math.round(Number($('compressRefs').value) || 0),
    custom: $('compressCustom').value.trim(),
    nvencAq: $('compressNvencAq').checked,
    resolution: $('compressResolution').value,
    width: Math.round(Number($('compressWidth').value) || 0),
    height: Math.round(Number($('compressHeight').value) || 0),
    noUpscale: $('compressNoUpscale').checked,
    fps: $('compressFps').value === 'source' ? 'source' : Number($('compressFps').value),
    deinterlace: $('compressDeinterlace').value,
    denoise: $('compressDenoise').value,
    sharpen: $('compressSharpen').value,
    crop: {
      top: Math.round(Number($('compressCropTop').value) || 0),
      bottom: Math.round(Number($('compressCropBottom').value) || 0),
      left: Math.round(Number($('compressCropLeft').value) || 0),
      right: Math.round(Number($('compressCropRight').value) || 0),
    },
    audioTracks,
    mergeAudio,
    audioCodec,
    audioBitrate: Math.round(Number($('compressAudioBitrate').value) || 128),
    audioChannels: $('compressAudioChannels').value,
    audioSampleRate: $('compressAudioSampleRate').value === 'source' ? 0 : Number($('compressAudioSampleRate').value),
    audioGains: gains,
    subtitleTracks,
    keepChapters: $('compressKeepChapters').checked,
    keepMetadata: $('compressKeepMetadata').checked,
    keepAttachments: $('compressKeepAttachments').checked,
    faststart: $('compressFaststart').checked,
  };
}

async function scanCompressGpu(force) {
  if (state.compressScanning) return;
  state.compressScanning = true;
  state.compressScanError = '';
  renderCompressGpuPanel();
  try {
    const system = await api.scanGpu(Boolean(force));
    state.compressSystem = system || null;
    if (system && system.hardwareAvailable && $('forceGpu').checked) {
      const best = bestCompressHardware(compressContainer(), null);
      if (best) {
        populateCompressEncoderSelect(best);
        $('compressEncoder').value = best;
      }
    }
    if (!system || !system.hardwareAvailable) {
      $('forceGpu').checked = false;
    }
  } catch (error) {
    state.compressScanError = errorMessage(error);
  } finally {
    state.compressScanning = false;
    populateCompressEncoderSelect();
    updateCompressEncoderUi({ resetQuality: false });
    renderCompressGpuPanel();
    updateCompressSummary();
    if (state.view === 'info') renderInfo();
  }
}

function setCompressBusy(busy) {
  state.compressBusy = busy;
  const start = $('btnStartCompress');
  start.disabled = busy || !state.compressSource;
  start.textContent = busy ? 'Compressione...' : 'Comprimi video';
  $('btnCancelCompress').hidden = !busy;
  $('compressOutput').disabled = busy;
}

async function startCompress() {
  if (state.compressBusy) return;
  if (!state.compressSource) {
    toast('Scegli prima un video da comprimere', 'err');
    return;
  }
  const encoder = currentCompressEncoder();
  if (!encoder) {
    toast('Nessun encoder disponibile', 'err');
    return;
  }
  if (encoder.hardware && !compressWorkingSet().has(encoder.id)) {
    toast('Encoder GPU non disponibile: esegui una nuova scansione', 'err');
    return;
  }
  if ($('compressQualityMode').value === 'twopass' && !encoder.twoPass) {
    toast('Questo encoder non supporta il 2-pass', 'err');
    return;
  }

  state.compressPercent = 0;
  state.lastCompress = null;
  $('compressBar').style.width = '0%';
  $('compressResult').hidden = true;
  $('compressResultText').hidden = true;
  $('compressStatus').textContent = 'Preparazione della compressione...';
  setCompressBusy(true);
  updateCompressSummary();

  try {
    const result = await api.startCompress({
      sourcePath: state.compressSource.path,
      options: collectCompressOptions(),
      outputPath: $('compressOutput').value.trim(),
    });
    if (result && result.canceled) {
      $('compressBar').style.width = '0%';
      $('compressStatus').textContent = 'Compressione annullata.';
    } else if (result && result.ok) {
      showCompressResult(result);
    }
  } catch (error) {
    const message = errorMessage(error);
    if (/annullata/i.test(message)) {
      $('compressBar').style.width = '0%';
      $('compressStatus').textContent = 'Compressione annullata.';
    } else {
      $('compressStatus').textContent = `Errore: ${message}`;
      toast(message, 'err');
    }
  } finally {
    setCompressBusy(false);
    updateCompressSummary();
  }
}

function showCompressResult(result) {
  state.lastCompress = result.path;
  state.compressPercent = 100;
  $('compressBar').style.width = '100%';
  $('compressOutput').value = result.path;
  const saved = result.saved != null ? ` · -${Math.round(result.saved * 100)}%` : '';
  const encoderLabel = result.encoderLabel || result.encoder || '';
  $('compressStatus').textContent = `Completato: ${result.name} (${fmtBytes(result.size)}${saved})`;
  const details = [
    `${result.hardware ? 'GPU' : 'CPU'} · ${encoderLabel}`,
    `decodifica ${result.hwaccel ? (result.hwaccelMode === 'cuda' ? 'GPU (CUDA)' : 'GPU') : 'software'}`,
    `durata ${fmtTime(result.duration)}`,
    `${result.audioTracks} audio${result.mergedAudio ? ' (mixati)' : ''} · ${result.subtitleTracks} sottotitoli`,
  ];
  if (result.sourceSize) details.push(`originale ${fmtBytes(result.sourceSize)}`);
  if (result.warnings && result.warnings.length) details.push(...result.warnings);
  const text = $('compressResultText');
  text.textContent = details.join('\n');
  text.hidden = false;
  $('compressResult').hidden = false;
  toast(`Video compresso · ${fmtBytes(result.size)}`);
}

async function cancelCompress() {
  if (!state.compressBusy) return;
  $('compressStatus').textContent = 'Annullamento in corso...';
  try {
    await api.cancelCompress();
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function onCompressProgress(progress) {
  if (!state.compressBusy) return;
  if (progress && progress.progress != null) {
    state.compressPercent = clamp(Number(progress.progress) * 100, 0, 100);
    $('compressBar').style.width = `${state.compressPercent.toFixed(1)}%`;
  }
  const parts = [`Compressione ${state.compressPercent.toFixed(0)}%`];
  if (progress && progress.pass === 2) parts.push('passata 2/2');
  if (progress && progress.seconds) parts.push(`${fmtTime(progress.seconds)} / ${fmtTime(progress.total)}`);
  if (progress && progress.speed && progress.speed !== 'N/A') parts.push(progress.speed);
  $('compressStatus').textContent = parts.join(' · ');
}

async function browseCompressOutput() {
  try {
    const chosen = await api.pickCompressOutput({
      container: compressContainer(),
      sourceName: state.compressSource ? state.compressSource.name : 'video',
    });
    if (chosen) $('compressOutput').value = chosen;
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function pickCompressSource() {
  try {
    const filePath = await api.pickCompressSource();
    if (filePath) await loadCompressSource(filePath);
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

/* ============================== INFO ============================== */

const DEP_INFO = {
  ytdlp: { label: 'yt-dlp', description: 'download da link' },
  ffmpeg: { label: 'FFmpeg', description: 'encoding e conversione' },
  ffprobe: { label: 'ffprobe', description: 'analisi dei media' },
};

function bindInfoEvents() {
  const on = (id, eventName, handler) => {
    const element = $(id);
    if (element) element.addEventListener(eventName, handler);
  };
  on('btnInfoScanGpu', 'click', () => scanInfoGpu(true));
  on('btnInfoCheckDeps', 'click', () => refreshInfo());
  on('btnApplyRecommended', 'click', applyInfoRecommended);
  on('btnCheckUpdate', 'click', () => checkUpdates());
  on('btnInstallUpdate', 'click', () => installUpdate());
  on('infoDeps', 'click', (event) => {
    const button = event.target.closest('[data-dep-action]');
    if (button && !state.depsDownloading) downloadDependency(button.dataset.depAction);
  });
}

async function openInfoView() {
  renderInfo();
  if (!state.info && !state.infoLoading) refreshInfo();
  if (!state.compressSystem && !state.compressScanning && !state.infoScanning) scanInfoGpu(false);
}

async function refreshInfo() {
  if (!api || state.infoLoading) return;
  state.infoLoading = true;
  renderInfoDeps();
  try {
    const info = await api.systemInfo();
    state.info = info;
    if (info && info.binaries) {
      state.defaults = { ...(state.defaults || {}), binaries: info.binaries };
      renderEngineInfo(state.defaults);
    }
    if (info && info.gpu && !state.compressSystem) state.compressSystem = info.gpu;
  } catch (error) {
    state.depsMessage = errorMessage(error);
  } finally {
    state.infoLoading = false;
    renderInfo();
  }
}

function renderInfo() {
  renderInfoSystem();
  renderInfoDeps();
  renderInfoGpu();
  renderInfoRecommended();
  renderUpdate();
}

function renderInfoSystem() {
  const box = $('infoSystem');
  if (!box) return;
  const info = state.info;
  if (!info) {
    box.innerHTML = `<div class="muted">${state.infoLoading ? 'Lettura delle informazioni di sistema...' : 'Informazioni non disponibili.'}</div>`;
    return;
  }
  const system = info.system || {};
  const versions = info.versions || {};
  const paths = info.paths || {};
  const badge = $('infoAppBadge');
  if (badge) badge.textContent = `v${versions.app || '?'}`;

  const memory = (bytes) => (Number(bytes) ? fmtBytes(bytes) : 'n/d');
  const rows = [
    ['Applicazione', `MoliDowloader ${versions.app || ''}`.trim()],
    ['Sistema', `${system.type || system.platform || ''} ${system.release || ''} · ${system.arch || ''}`.trim()],
    ['CPU', `${system.cpuModel || 'n/d'} · ${system.cpuCores || 0} thread`],
    ['RAM', `${memory(system.totalMemory)} totali · ${memory(system.freeMemory)} liberi`],
    ['Uptime', fmtUptime(system.uptime || 0)],
    ['Electron', versions.electron || 'n/d'],
    ['Chromium', versions.chrome || 'n/d'],
    ['Node', versions.node || 'n/d'],
    ['Cartella dati', paths.userData || 'n/d'],
  ];
  box.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="info-row"><span>${esc(label)}</span><span>${esc(value)}</span></div>`,
    )
    .join('');
}

function shortVersion(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/(?:ffmpeg|ffprobe) version (\S+)/i);
  if (match) return match[1];
  return text.length > 64 ? `${text.slice(0, 64)}…` : text;
}

function renderInfoDeps() {
  const box = $('infoDeps');
  if (!box) return;
  const binaries = (state.info && state.info.binaries) || (state.defaults && state.defaults.binaries) || {};
  const downloading = state.depsDownloading;

  box.innerHTML = Object.keys(DEP_INFO)
    .map((key) => {
      const entry = binaries[key] || {};
      const info = DEP_INFO[key];
      const busy = downloading === key;
      const badge = busy
        ? '<span class="dep-badge busy">download</span>'
        : entry.path
          ? '<span class="dep-badge ok">ok</span>'
          : '<span class="dep-badge missing">mancante</span>';
      const version = entry.path
        ? shortVersion(entry.version) || 'versione sconosciuta'
        : 'non installato';
      const source = entry.path ? (entry.source === 'system' ? 'sistema' : 'incluso') : '';
      const meta = [info.description, version, source, entry.path || ''].filter(Boolean).join(' · ');
      const action = `<button class="btn-sm" data-dep-action="${key}" ${downloading ? 'disabled' : ''}>${
        entry.path ? 'Aggiorna' : 'Scarica'
      }</button>`;
      return `<div class="dep-row">
        <div class="dep-main">
          <div class="dep-name">${esc(info.label)} ${badge}</div>
          <div class="dep-meta">${esc(meta)}</div>
        </div>
        ${action}
      </div>`;
    })
    .join('');

  const status = $('depsStatus');
  const bar = $('depsBar');
  if (status) {
    if (downloading) {
      status.textContent = `${state.depsMessage || `Scarico ${DEP_INFO[downloading].label}...`} ${state.depsPercent ? `· ${state.depsPercent}%` : ''}`;
    } else {
      status.textContent = state.depsMessage || 'yt-dlp, FFmpeg e ffprobe vengono verificati all’avvio.';
    }
  }
  if (bar) bar.style.width = `${downloading ? state.depsPercent : 0}%`;
}

function renderInfoGpu() {
  const status = $('infoGpuStatus');
  const list = $('infoGpuList');
  const chips = $('infoEncoders');
  if (!status || !list || !chips) return;

  if (state.infoScanning || state.compressScanning) {
    status.className = 'gpu-scan-status busy';
    status.textContent = 'Test degli encoder hardware in corso...';
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }
  if (state.compressScanError) {
    status.className = 'gpu-scan-status warn';
    status.textContent = `Scansione non riuscita: ${state.compressScanError}`;
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }
  const system = state.compressSystem;
  if (!system) {
    status.className = 'gpu-scan-status';
    status.textContent = 'Scansione non ancora eseguita.';
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }

  const gpus = system.gpus || [];
  const working = system.working || [];
  status.className = `gpu-scan-status ${gpus.length ? 'ok' : 'warn'}`;
  status.textContent = gpus.length
    ? `${gpus.length} GPU rilevata${gpus.length > 1 ? 'e' : ''} · ${
        working.length ? `${working.length} encoder hardware verificati` : 'nessun encoder hardware verificato'
      }`
    : 'Nessuna GPU rilevata.';

  list.innerHTML = gpus.length
    ? gpus
        .map(
          (gpu) => `<div class="gpu-item">
            <div class="gpu-name">${esc(gpu.name)}</div>
            <div class="gpu-meta">${esc(String(gpu.vendor || '').toUpperCase())}${gpu.vram ? ` · ${compressVramLabel(gpu.vram)}` : ''}${gpu.driver ? ` · driver ${esc(gpu.driver)}` : ''}</div>
          </div>`,
        )
        .join('')
    : '<div class="muted">Nessuna scheda video dedicata rilevata.</div>';

  const workingChips = working.map((id) => {
    const encoder = compressCatalogEncoder(id);
    return `<span class="gpu-chip working">${esc(encoder ? encoder.short : id)}</span>`;
  });
  const failedChips = (system.failed || []).map((item) => {
    const encoder = compressCatalogEncoder(item.id);
    return `<span class="gpu-chip failed" title="${esc(item.error || '')}">${esc(encoder ? encoder.short : item.id)}</span>`;
  });
  chips.innerHTML = workingChips.concat(failedChips).join('');
}

function infoRecommendedConfig() {
  const container = 'mp4';
  const hw = bestCompressHardware(container, ['hevc', 'h264', 'av1']);
  const encoderId = hw || compressFallbackEncoder(container, 'libx265');
  const encoder = compressCatalogEncoder(encoderId);
  const preset = encoder ? compressPresetValue(encoder, 'medium') : '';
  return {
    container,
    encoderId,
    encoder,
    preset,
    quality: encoder && encoder.quality ? encoder.quality.default : 24,
    hardware: Boolean(hw),
  };
}

function renderInfoRecommended() {
  const box = $('infoRecommended');
  const badge = $('infoRecommendedBadge');
  if (!box) return;
  if (!state.compressCatalog) {
    box.innerHTML = '<div class="muted">Catalogo encoder non disponibile.</div>';
    return;
  }
  if (!state.compressSystem) {
    box.innerHTML = '<div class="muted">Premi “Scansiona” per ricevere impostazioni adatte a questa macchina.</div>';
    if (badge) badge.textContent = 'auto';
    return;
  }
  const config = infoRecommendedConfig();
  const encoder = config.encoder;
  if (badge) badge.textContent = config.hardware ? 'gpu' : 'cpu';
  const qualityLabel = encoder && encoder.quality ? encoder.quality.label : 'Qualità';
  const rows = [
    ['Encoder', encoder ? encoder.short : config.encoderId],
    [qualityLabel, String(config.quality)],
    ['Preset', config.preset || 'auto'],
    ['Contenitore', 'MP4 (H.264/HEVC)'],
    ['Risoluzione', '1080p · niente upscale'],
    ['Decodifica', config.hardware ? 'GPU con fallback automatico' : 'Software'],
    ['Audio', 'AAC 128 kbps'],
  ];
  box.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="summary-row"><span class="summary-label">${esc(label)}</span><span class="summary-value">${esc(value)}</span></div>`,
    )
    .join('');
}

async function scanInfoGpu(force) {
  if (state.infoScanning || state.compressScanning) return;
  state.infoScanning = true;
  renderInfoGpu();
  try {
    await scanCompressGpu(force);
    while (state.compressScanning) await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    state.infoScanning = false;
    renderInfo();
  }
}

async function applyInfoRecommended() {
  if (!state.compressCatalog) await loadCompressCatalog();
  const config = infoRecommendedConfig();
  if (!config.encoder) {
    toast('Nessun encoder disponibile', 'err');
    return;
  }
  switchView('compress');
  await openCompressView();
  $('compressContainer').value = config.container;
  populateCompressEncoderSelect(config.encoderId);
  $('compressEncoder').value = config.encoderId;
  syncCompressForceWithEncoder();
  $('forceGpu').checked = config.hardware;
  $('compressHwAccel').checked = true;
  updateCompressEncoderUi({ resetQuality: true });
  $('compressQualityMode').value = 'quality';
  setCompressQuality(config.quality);
  if (config.preset) $('compressPreset').value = config.preset;
  $('compressResolution').value = '1080p';
  toggleCompressCustomSize();
  $('compressNoUpscale').checked = true;
  markCompressCustom();
  applyCompressOutputExtension();
  updateCompressSummary();
  toast('Impostazioni consigliate applicate');
}

function onDepsProgress(progress) {
  if (!progress || !state.depsDownloading) return;
  const tool = progress.tool || state.depsDownloading;
  if (!tool) return;
  state.depsDownloading = tool;
  state.depsPercent = progress.percent == null ? state.depsPercent : Math.round(clamp(progress.percent, 0, 1) * 100);
  const received = fmtBytes(progress.received);
  const total = fmtBytes(progress.total);
  state.depsMessage = `Scarico ${DEP_INFO[tool] ? DEP_INFO[tool].label : tool}`;
  if (received) state.depsMessage += ` · ${received}${total ? `/${total}` : ''}`;
  renderInfoDeps();
}

async function downloadDependency(tool) {
  const key = String(tool || '');
  if (!DEP_INFO[key] || state.depsDownloading) return;
  state.depsDownloading = key;
  state.depsPercent = 0;
  state.depsMessage = `Scarico ${DEP_INFO[key].label} da GitHub`;
  renderInfoDeps();
  try {
    const result = await api.downloadDep(key);
    if (result && result.binaries) {
      state.info = state.info
        ? { ...state.info, binaries: { ...(state.info.binaries || {}), ...result.binaries } }
        : state.info;
      state.defaults = { ...(state.defaults || {}), binaries: result.binaries };
      renderEngineInfo(state.defaults);
    }
    state.depsMessage = `${DEP_INFO[key].label} pronto.`;
    toast(`${DEP_INFO[key].label} installato`);
    await refreshInfo();
  } catch (error) {
    state.depsMessage = `Download non riuscito: ${errorMessage(error)}`;
    toast(`Download ${DEP_INFO[key].label}: ${errorMessage(error)}`, 'err');
  } finally {
    state.depsDownloading = null;
    state.depsPercent = 0;
    renderInfoDeps();
    renderInfoRecommended();
  }
}

function onUpdateStatus(info) {
  if (!info || typeof info !== 'object') return;
  const previous = state.update;
  state.update = info;
  renderUpdate();
  if (
    info.state === 'downloaded' &&
    info.version &&
    (!previous || previous.state !== 'downloaded' || previous.version !== info.version)
  ) {
    toast(`Aggiornamento ${info.version} pronto: riavvia per installarlo`);
  }
}

function fmtClock(timestamp) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function renderUpdate() {
  const status = $('updateStatusText');
  const badge = $('updateBadge');
  const bar = $('updateBar');
  const check = $('btnCheckUpdate');
  const install = $('btnInstallUpdate');
  if (!status) return;

  const info = state.update || { state: 'idle', currentVersion: '' };
  const current = info.currentVersion || (state.info && state.info.versions && state.info.versions.app) || '';
  const percent = clamp(Number(info.percent) || 0, 0, 100);
  const busy = ['checking', 'downloading', 'installing'].includes(info.state);
  let text = 'Controllo automatico ogni 6 ore.';
  let label = 'auto';
  let badgeClass = 'panel-badge';

  switch (info.state) {
    case 'checking':
      text = 'Controllo degli aggiornamenti...';
      label = 'check';
      break;
    case 'available':
      text = `v${info.version || '?'} disponibile · download in corso`;
      label = 'new';
      badgeClass = 'panel-badge new';
      break;
    case 'downloading':
      text = `Scarico v${info.version || '?'} · ${Math.round(percent)}%`;
      if (info.bytesPerSecond) text += ` · ${fmtBytes(info.bytesPerSecond)}/s`;
      label = `${Math.round(percent)}%`;
      break;
    case 'downloaded':
      text = `v${info.version || '?'} pronta. Si installa alla chiusura o subito.`;
      label = 'pronta';
      badgeClass = 'panel-badge new';
      break;
    case 'installing':
      text = 'Riavvio per installare l’aggiornamento...';
      label = 'installo';
      break;
    case 'current': {
      const checked = fmtClock(info.lastCheckedAt);
      text = `Sei aggiornato${current ? ` · v${current}` : ''}${checked ? ` · ultimo controllo ${checked}` : ''}.`;
      label = 'ok';
      break;
    }
    case 'error':
      text = `Controllo non riuscito: ${info.message || 'errore di rete'}`;
      label = 'errore';
      badgeClass = 'panel-badge err';
      break;
    case 'dev':
      text = info.message || 'Gli aggiornamenti si verificano nell’app installata.';
      label = 'dev';
      break;
    default:
      break;
  }

  status.textContent = text;
  badge.textContent = label;
  badge.className = badgeClass;
  if (bar) bar.style.width = `${info.state === 'downloaded' ? 100 : percent}%`;
  if (check) check.disabled = busy;
  if (install) install.hidden = info.state !== 'downloaded';
}

async function checkUpdates() {
  if (!api) return;
  try {
    const result = await api.checkUpdates();
    if (result && result.dev) renderUpdate();
    else if (result && result.ok === false && result.error) toast(result.error, 'err');
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function installUpdate() {
  if (!api) return;
  try {
    const result = await api.installUpdate();
    if (!result || !result.ok) toast('Nessun aggiornamento pronto da installare', 'err');
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function bindCompressEvents() {
  const on = (id, eventName, handler) => {
    const element = $(id);
    if (element) element.addEventListener(eventName, handler);
  };
  const changed = (handler) => (event) => {
    if (!event.target.closest('.preset-btn')) markCompressCustom();
    if (handler) handler(event);
    updateCompressSummary();
  };

  on('btnPickCompress', 'click', pickCompressSource);
  on('compressDrop', 'click', (event) => {
    if (event.target.closest('button')) return;
    pickCompressSource();
  });
  on('btnScanGpu', 'click', () => scanCompressGpu(true));
  on('compressHwAccel', 'change', () => updateCompressSummary());
  on('forceGpu', 'change', () => {
    const force = $('forceGpu').checked;
    if (force) {
      const best = bestCompressHardware(compressContainer(), null);
      if (best) {
        populateCompressEncoderSelect(best);
        $('compressEncoder').value = best;
        updateCompressEncoderUi({ resetQuality: false });
      } else {
        $('forceGpu').checked = false;
        toast('Nessun encoder GPU disponibile', 'err');
      }
    } else if (currentCompressEncoder() && currentCompressEncoder().hardware) {
      const fallback = compressFallbackEncoder(compressContainer(), 'libx265');
      populateCompressEncoderSelect(fallback);
      $('compressEncoder').value = fallback;
      updateCompressEncoderUi({ resetQuality: false });
    }
    renderCompressGpuPanel();
    updateCompressSummary();
  });

  on('compressContainer', 'change', () => {
    markCompressCustom();
    populateCompressEncoderSelect();
    syncCompressForceWithEncoder();
    updateCompressEncoderUi({ resetQuality: false });
    renderCompressTracks();
    applyCompressOutputExtension();
    renderCompressGpuPanel();
    updateCompressSummary();
  });
  on('compressEncoder', 'change', () => {
    markCompressCustom();
    const encoder = currentCompressEncoder();
    if (encoder && encoder.hardware) $('forceGpu').checked = true;
    else if (encoder) $('forceGpu').checked = false;
    updateCompressEncoderUi({ resetQuality: true });
    renderCompressGpuPanel();
    updateCompressSummary();
  });
  on('compressQualityMode', 'change', () => {
    markCompressCustom();
    updateCompressRateFields();
    updateCompressSummary();
  });
  on('compressQuality', 'input', (event) => {
    markCompressCustom();
    setCompressQuality(event.target.value);
    updateCompressSummary();
  });
  on('compressQualityNum', 'change', (event) => {
    markCompressCustom();
    setCompressQuality(event.target.value);
    updateCompressSummary();
  });
  on('compressResolution', 'change', () => {
    markCompressCustom();
    toggleCompressCustomSize();
    updateCompressSummary();
  });
  on('compressMerge', 'change', () => {
    markCompressCustom();
    renderCompressTracks();
    updateCompressSummary();
  });
  on('compressAudioCodec', 'change', () => {
    markCompressCustom();
    syncCompressAudioCodecUi();
    updateCompressSummary();
  });
  on('btnBrowseCompressOutput', 'click', browseCompressOutput);
  on('compressOutput', 'input', updateCompressSummary);
  on('btnStartCompress', 'click', startCompress);
  on('btnCancelCompress', 'click', cancelCompress);
  on('btnOpenCompress', 'click', () => {
    if (state.lastCompress) api.openPath(state.lastCompress);
  });
  on('btnRevealCompress', 'click', () => {
    if (state.lastCompress) api.reveal(state.lastCompress);
  });

  const settings = $('compressSettings');
  if (settings) {
    settings.addEventListener('change', changed());
    settings.addEventListener('input', (event) => {
      if (!event.target.matches('input[type="range"], input[type="number"], input[type="text"]')) return;
      markCompressCustom();
      updateCompressSummary();
    });
  }

  const presets = $('compressPresets');
  if (presets) {
    presets.addEventListener('click', (event) => {
      const button = event.target.closest('[data-compress-preset]');
      if (!button) return;
      applyCompressPreset(button.dataset.compressPreset);
    });
  }

  const audioList = $('compressAudioTracks');
  if (audioList) {
    audioList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-audio-index]');
      if (checkbox) {
        const index = Number(checkbox.dataset.audioIndex);
        if (checkbox.checked) state.compressAudioSelected.add(index);
        else state.compressAudioSelected.delete(index);
        const row = checkbox.closest('.track-row');
        if (row) row.classList.toggle('selected', checkbox.checked);
        markCompressCustom();
        syncCompressAudioCodecUi();
        updateCompressSummary();
      }
    });
    audioList.addEventListener('input', (event) => {
      const gain = event.target.closest('[data-audio-gain]');
      if (!gain) return;
      const index = Number(gain.dataset.audioGain);
      state.compressGains[index] = clamp((Number(gain.value) || 0) / 100, 0, 2);
      markCompressCustom();
      updateCompressSummary();
    });
  }

  const subtitleList = $('compressSubtitleTracks');
  if (subtitleList) {
    subtitleList.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-sub-index]');
      if (!checkbox) return;
      const index = Number(checkbox.dataset.subIndex);
      if (checkbox.checked) state.compressSubtitleSelected.add(index);
      else state.compressSubtitleSelected.delete(index);
      const row = checkbox.closest('.track-row');
      if (row) row.classList.toggle('selected', checkbox.checked);
      markCompressCustom();
      updateCompressSummary();
    });
  }

  document.querySelectorAll('[data-audio-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.audioSelect;
      const tracks = (state.compressSource && state.compressSource.audioTracks) || [];
      state.compressAudioSelected = new Set(
        mode === 'all' ? tracks.map((track) => track.index) : [],
      );
      markCompressCustom();
      renderCompressAudioTracks();
      syncCompressAudioCodecUi();
      updateCompressSummary();
    });
  });

  document.querySelectorAll('[data-sub-select]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.subSelect;
      const container = compressContainer();
      const tracks = (state.compressSource && state.compressSource.subtitleTracks) || [];
      state.compressSubtitleSelected = new Set(
        mode === 'all'
          ? tracks
              .filter((track) => container === 'mkv' || COMPRESS_TEXT_SUBS.has(track.codec))
              .map((track) => track.index)
          : [],
      );
      markCompressCustom();
      renderCompressSubtitleTracks();
      updateCompressSummary();
    });
  });
}

window.addEventListener('beforeunload', () => {
  if (state.logTimer) clearInterval(state.logTimer);
});
