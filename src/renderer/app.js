/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const api = window.moli;

const MODE_KEY = 'moli.mode';
// I link incollati restano gli stessi passando da Easy ad Advanced.
const LINKS_KEY = 'moli.links';

const state = {
  view: 'download',
  mode: (() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'easy';
    } catch {
      return 'easy';
    }
  })(),
  currentTab: 'video',
  links: '',
  linkTimer: null,
  errorInfo: null,
  errorJobId: '',
  errorShown: new Set(),
  jobs: new Map(),
  collapsedPlaylists: new Set(),
  clips: [],
  selectedId: null,
  music: null,
  exporting: false,
  editorBusy: 0,
  logJobId: null,
  logTimer: null,
  previewStopAt: null,
  previewMode: 'clip',
  previewIndex: -1,
  tool: 'trim',
  snapshotPath: null,
  snapshotDir: '',
  snapshotName: '',
  history: [],
  future: [],
  historyAt: 0,
  historyKey: '',
  lastExport: null,
  downloadsDir: '',
  folderDefaults: {},
  settings: {
    downloadsDir: '',
    compressDir: '',
    editorDir: '',
    maxParallel: 2,
    autoRetry: true,
    cookieFallback: true,
  },
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
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
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
  return String((error && error.message) || error || 'Error')
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

/* ============================ LINK E MESSAGGI ============================ */

/** Stesso riconoscimento dei link usato dal processo principale. */
function linkInfoOf(rawUrl) {
  if (!rawUrl) return null;
  try {
    if (api && typeof api.linkInfo === 'function') return api.linkInfo(rawUrl);
  } catch {
    /* senza preload restano i messaggi generici */
  }
  return null;
}

/** Un errore grezzo diventa il messaggio in tema dell'app. */
function explainError(raw, url = '') {
  try {
    if (api && typeof api.explainError === 'function') return api.explainError(String(raw || ''), url);
  } catch {
    /* preload non disponibile */
  }
  const value = String(raw || 'Download failed.');
  return {
    code: 'MD-900',
    kind: 'unknown',
    icon: 'cross',
    title: 'Download failed',
    message: value,
    hint: 'Open the log to see what the site answered.',
    action: 'none',
    serviceLabel: '',
    loginUrl: '',
    raw: value,
  };
}

function firstLink(value) {
  const list = String(value || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list[0] || '';
}

/** Ricorda il testo incollato e lo copia nell'altra modalita`. */
function applyLinkText(value, sourceId) {
  const shared = { ezUrl: 'urlInput', urlInput: 'ezUrl' }[sourceId];
  state.links = value;
  if (shared && $(shared) && $(shared).value !== value) $(shared).value = value;
  renderLinkInfo();
}

function setLinkValue(value) {
  applyLinkText(String(value || ''), '');
  for (const id of ['ezUrl', 'urlInput']) {
    if ($(id)) $(id).value = value;
  }
  try {
    localStorage.setItem(LINKS_KEY, value);
  } catch {
    /* storage bloccato */
  }
}

function onLinkInput(id) {
  const value = $(id).value;
  applyLinkText(value, id);
  clearTimeout(state.linkTimer);
  state.linkTimer = setTimeout(() => {
    try {
      localStorage.setItem(LINKS_KEY, value);
    } catch {
      /* storage bloccato */
    }
  }, 400);
}

function restoreLinks() {
  let value = '';
  try {
    value = localStorage.getItem(LINKS_KEY) || '';
  } catch {
    value = '';
  }
  state.links = value;
  for (const id of ['ezUrl', 'urlInput']) {
    if ($(id)) $(id).value = value;
  }
  renderLinkInfo();
}

/** Targhetta sotto il campo: "Playlist detected", brano singolo, live... */
function linkBadge(info) {
  if (!info || !info.host) return '';
  const service = info.serviceLabel || info.host;
  if (info.isPlaylist) {
    return `<span class="link-tag playlist">Playlist detected</span><span class="link-info-text">${esc(service)} · every track will be saved</span>`;
  }
  if (info.kind === 'track' && info.service === 'spotify') {
    return `<span class="link-tag track">Single track</span><span class="link-info-text">${esc(service)} · found on YouTube and saved as audio</span>`;
  }
  if (info.hasPlaylist) {
    return `<span class="link-tag">Playlist link</span><span class="link-info-text">${esc(service)} · one video: turn on "Whole playlist" to save the list</span>`;
  }
  if (info.kind === 'live') {
    return `<span class="link-tag live">Live</span><span class="link-info-text">${esc(service)} · the recording starts from the current moment</span>`;
  }
  return '';
}

function renderLinkInfo() {
  const html = linkBadge(linkInfoOf(firstLink(state.links)));
  for (const id of ['ezLinkInfo', 'linkInfo']) {
    const element = $(id);
    if (!element) continue;
    element.innerHTML = html;
    element.hidden = !html;
  }
}

/* ============================ POPUP DEGLI ERRORI ============================ */

function showError(info, options = {}) {
  if (!info || !$('errorModal')) return;
  state.errorInfo = info;
  state.errorJobId = options.jobId || '';
  const icon = $('errorIcon');
  if (icon) {
    icon.textContent = '!';
    icon.className = `error-icon ${info.kind || 'unknown'}`;
  }
  $('errorCode').textContent = info.code || 'MD-900';
  $('errorTitle').textContent = info.title || 'Download failed';
  $('errorMessage').textContent = info.message || '';
  $('errorHint').textContent = info.hint || '';
  const raw = $('errorRaw');
  if (raw) raw.textContent = info.raw || '';
  const canLogin = info.action === 'login' && Boolean(info.loginUrl);
  const loginButton = $('btnErrorLogin');
  loginButton.hidden = !canLogin;
  if (canLogin) loginButton.textContent = `Sign in to ${info.serviceLabel || 'the site'}`;
  const canRetry = Boolean(state.errorJobId) || info.action === 'retry';
  $('btnErrorRetry').hidden = !canRetry;
  $('btnErrorUpdate').hidden = info.action !== 'update';
  $('btnErrorLog').hidden = !state.errorJobId;
  $('errorModal').classList.add('open');
  $('errorModal').setAttribute('aria-hidden', 'false');
}

function closeError() {
  const modal = $('errorModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  state.errorInfo = null;
  state.errorJobId = '';
}

/* Conferma in tema: al posto del popup di Windows. */
let confirmResolve = null;

function openConfirm(options = {}) {
  const modal = $('confirmModal');
  if (!modal) {
    return Promise.resolve(window.confirm(`${options.title || 'Are you sure?'}\n\n${options.message || ''}`));
  }
  return new Promise((resolve) => {
    if (confirmResolve) confirmResolve(false);
    $('confirmTitle').textContent = options.title || 'Are you sure?';
    const message = $('confirmMessage');
    message.textContent = options.message || '';
    message.hidden = !options.message;
    $('btnConfirmCancel').textContent = options.confirmLabel || 'Confirm';
    $('btnConfirmKeep').textContent = options.keepLabel || 'Keep';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    confirmResolve = resolve;
    setTimeout(() => {
      if (confirmResolve === resolve) $('btnConfirmKeep').focus();
    }, 30);
  });
}

function closeConfirm(result) {
  const modal = $('confirmModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  const resolve = confirmResolve;
  confirmResolve = null;
  if (resolve) resolve(Boolean(result));
}

/* Avviso per le playlist musicali scaricate come video. */
let musicResolve = null;

function musicPlaylistInfo(urls, wholePlaylist) {
  const found = [];
  for (const raw of urls) {
    const info = linkInfoOf(raw);
    if (!info) continue;
    if (info.service === 'spotify' && info.isPlaylist) {
      found.push(info);
    } else if (
      (info.service === 'youtube-music' || info.service === 'soundcloud') &&
      (info.isPlaylist || (info.hasPlaylist && wholePlaylist))
    ) {
      found.push(info);
    }
  }
  return found;
}

function openMusicWarning(playlists) {
  const modal = $('musicModal');
  if (!modal) return Promise.resolve('video');
  const spotifyOnly = playlists.every((info) => info.service === 'spotify');
  const hasSpotify = playlists.some((info) => info.service === 'spotify');
  $('musicTitle').textContent = spotifyOnly ? 'Spotify playlists are audio' : 'Music playlist detected';
  $('musicMessage').textContent = spotifyOnly
    ? 'Spotify tracks are always saved as audio (MP3), even when Video is selected. Use the Audio settings to choose bitrate and format.'
    : `You selected Video (MP4). For music, audio (MP3) is recommended: smaller files and the same sound. Keep Video (MP4) if you want the picture.${
        hasSpotify ? ' Spotify tracks are saved as audio anyway.' : ''
      }`;
  $('musicHint').textContent = 'The playlist will be saved in a folder named after it.';
  $('btnMusicVideo').hidden = spotifyOnly;
  return new Promise((resolve) => {
    if (musicResolve) musicResolve('cancel');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    musicResolve = resolve;
    setTimeout(() => {
      if (musicResolve === resolve) $('btnMusicAudio').focus();
    }, 30);
  });
}

function closeMusicWarning(value) {
  const modal = $('musicModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  const resolve = musicResolve;
  musicResolve = null;
  if (resolve) resolve(value || 'cancel');
}

async function signInFromError() {
  const info = state.errorInfo;
  if (!info || !info.loginUrl) return;
  try {
    await api.openExternal(info.loginUrl);
    toast('Sign in in your browser, then press Retry');
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function retryJob(id) {
  if (!id) return;
  closeError();
  try {
    const jobs = await api.retryDownload(id);
    toast(`${jobs.length} ${jobs.length === 1 ? 'download' : 'downloads'} queued`);
    await refreshJobs();
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

function retryFromError() {
  if (state.errorJobId) retryJob(state.errorJobId);
  else startDownload(state.mode === 'easy' ? 'ez' : 'advanced');
}

/* ============================ BOOTSTRAP ============================ */

document.addEventListener('DOMContentLoaded', init);

const bootAt = Date.now();

function finishBoot() {
  const wait = Math.max(0, 150 - (Date.now() - bootAt));
  setTimeout(() => {
    document.body.classList.add('loaded');
    const screen = $('bootScreen');
    if (screen) setTimeout(() => screen.remove(), 240);
  }, wait);
}

async function init() {
  restoreLinks();
  bindEvents();
  applyMode(state.mode, { silent: true });

  if (!api) {
    toast('Electron API not available. Start the app with "npm start".', 'err');
    finishBoot();
    return;
  }

  try {
    const defaults = await api.defaults();
    state.defaults = defaults;
    state.folderDefaults = defaults.folders || {};
    state.settings = {
      downloadsDir: '',
      compressDir: '',
      editorDir: '',
      maxParallel: 2,
      autoRetry: true,
      cookieFallback: true,
      ...(defaults.settings || {}),
    };
    state.downloadsDir = state.settings.downloadsDir || defaults.outputDir || '';
    syncFolderInputs();
    syncDownloadPrefs();
    renderDirs();
    renderEngineInfo(defaults);
    renderEzPanel();
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
  api.on('binaries:ready', onBinariesReady);
  api.updateState().then(onUpdateStatus).catch(() => {});

  finishBoot();

  // Coda, editor e catalogo non servono per il primo paint: partono subito
  // dopo la schermata di avvio, cosi` la finestra e` utilizzabile prima.
  setTimeout(() => {
    refreshJobs();
    renderEditor();
    selectTool('trim');
  }, 0);
  setTimeout(() => {
    createParticles();
    loadCompressCatalog();
  }, 900);
}

function onBinariesReady(tools) {
  if (!tools) return;
  state.defaults = { ...(state.defaults || {}), binaries: tools };
  renderEngineInfo(state.defaults);
  if (state.info) state.info.binaries = tools;
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

  $('dlBtn').addEventListener('click', () => startDownload('advanced'));
  $('modeToggle').addEventListener('click', toggleMode);
  $('ezDownloadBtn').addEventListener('click', () => startDownload('ez'));

  // Un solo testo condiviso: incollare in Easy lo mostra anche in Advanced.
  for (const id of ['ezUrl', 'urlInput']) {
    if ($(id)) $(id).addEventListener('input', () => onLinkInput(id));
  }

  $('btnCloseError').addEventListener('click', closeError);
  $('btnErrorDismiss').addEventListener('click', closeError);
  $('btnErrorLogin').addEventListener('click', signInFromError);
  $('btnErrorRetry').addEventListener('click', retryFromError);
  $('btnErrorUpdate').addEventListener('click', () => {
    closeError();
    updateYtdlp();
  });
  $('btnErrorLog').addEventListener('click', () => {
    const id = state.errorJobId;
    closeError();
    if (id) openLog(id);
  });
  $('errorModal').addEventListener('click', (event) => {
    if (event.target === $('errorModal')) closeError();
  });
  $('ezChangeFolder').addEventListener('click', () => pickFolder('video'));
  $('ezQuality').addEventListener('change', () => {
    $('quality').value = $('ezQuality').value;
  });
  document.querySelectorAll('.ez-choice').forEach((button) => {
    button.addEventListener('click', () => setEzFormat(button.dataset.ezFormat));
  });
  $('ezUrl').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      startDownload('ez');
    }
  });
  $('quality').addEventListener('change', () => {
    if ($('ezQuality')) $('ezQuality').value = $('quality').value;
  });
  $('btnClearDone').addEventListener('click', clearDone);
  $('btnUpdateYtdlp').addEventListener('click', updateYtdlp);
  $('btnOpenDownloads').addEventListener('click', () => {
    if (state.downloadsDir) api.openPath(state.downloadsDir);
  });

  document.querySelectorAll('[data-pick-folder]').forEach((button) => {
    button.addEventListener('click', () => pickFolder(button.dataset.pickFolder));
  });

  const folderInputs = [
    ['outputDir', 'video'],
    ['outputDirAudio', 'audio'],
    ['editorDir', 'editor'],
    ['compressDirField', 'compress'],
  ];
  for (const [id, which] of folderInputs) {
    const input = $(id);
    if (input) input.addEventListener('change', () => persistFolderInput(which));
  }

  $('maxParallel').addEventListener('change', persistDownloadPrefs);
  $('autoRetry').addEventListener('change', persistDownloadPrefs);
  $('cookieFallback').addEventListener('change', persistDownloadPrefs);

  $('jobsList').addEventListener('click', onJobsClick);
  $('btnCloseLog').addEventListener('click', closeLog);
  $('logModal').addEventListener('click', (event) => {
    if (event.target === $('logModal')) closeLog();
  });
  $('btnCloseConfirm').addEventListener('click', () => closeConfirm(false));
  $('btnConfirmKeep').addEventListener('click', () => closeConfirm(false));
  $('btnConfirmCancel').addEventListener('click', () => closeConfirm(true));
  $('confirmModal').addEventListener('click', (event) => {
    if (event.target === $('confirmModal')) closeConfirm(false);
  });
  $('btnCloseMusic').addEventListener('click', () => closeMusicWarning('cancel'));
  $('btnMusicAudio').addEventListener('click', () => closeMusicWarning('audio'));
  $('btnMusicVideo').addEventListener('click', () => closeMusicWarning('video'));
  $('musicModal').addEventListener('click', (event) => {
    if (event.target === $('musicModal')) closeMusicWarning('cancel');
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
  $('btnPreviewPlay').addEventListener('click', playSequence);
  $('btnPreviewClip').addEventListener('click', playSelection);
  $('btnPreviewStop').addEventListener('click', () => stopPreview());
  $('btnUndo').addEventListener('click', undoEditor);
  $('btnRedo').addEventListener('click', redoEditor);
  $('btnOpenExport').addEventListener('click', () => {
    if (state.lastExport) api.openPath(state.lastExport);
  });
  $('btnRevealExport').addEventListener('click', () => {
    if (state.lastExport) api.reveal(state.lastExport);
  });

  $('toolPanel').addEventListener('input', onInspectorInput);
  $('toolPanel').addEventListener('change', onInspectorChange);
  $('toolPanel').addEventListener('click', onInspectorClick);
  document.querySelectorAll('#editorTools .tool-tab').forEach((button) => {
    button.addEventListener('click', () => selectTool(button.dataset.tool));
  });
  $('trimChip').addEventListener('click', () => selectTool('trim'));
  $('btnSnapshot').addEventListener('click', captureSnapshot);
  $('btnFrameBack').addEventListener('click', () => stepFrame(-1));
  $('btnFrameNext').addEventListener('click', () => stepFrame(1));
  $('previewMute').addEventListener('change', (event) => {
    $('edVideo').muted = event.target.checked;
  });
  $('edScrub').addEventListener('input', (event) => {
    const clip = selectedClip();
    const video = $('edVideo');
    if (!clip || video.dataset.clipId !== clip.id) return;
    if (state.previewMode === 'sequence') stopPreview(false);
    const ratio = clamp(Number(event.target.value) / 1000, 0, 1);
    video.currentTime = clip.in + (clip.out - clip.in) * ratio;
    updateVideoTime();
  });
  $('edVideo').addEventListener('click', () => togglePreviewPlayback());
  $('btnOpenSnapshot').addEventListener('click', () => {
    if (state.snapshotPath) api.openPath(state.snapshotPath);
  });
  $('btnRevealSnapshot').addEventListener('click', () => {
    if (state.snapshotDir || state.snapshotPath) api.reveal(state.snapshotDir || state.snapshotPath);
  });
  $('timeline').addEventListener('click', onTimelineClick);
  $('timeline').addEventListener('dragstart', onTimelineDragStart);
  $('timeline').addEventListener('dragend', onTimelineDragEnd);
  $('timeline').addEventListener('dragover', onTimelineDragOver);
  $('timeline').addEventListener('drop', onTimelineDrop);

  $('musicVolume').addEventListener('input', (event) => {
    if (!state.music) return;
    pushHistoryThrottled('musicVolume');
    state.music.volume = Number(event.target.value) / 100;
    $('musicVolumeLabel').textContent = `${event.target.value}%`;
    const audio = musicElement();
    if (audio) audio.volume = clamp(state.music.volume, 0, 1);
  });
  $('musicFadeIn').addEventListener('change', (event) => {
    if (!state.music) return;
    pushHistory();
    state.music.fadeIn = Math.max(0, Number(event.target.value) || 0);
    event.target.value = state.music.fadeIn;
  });
  $('musicFadeOut').addEventListener('change', (event) => {
    if (!state.music) return;
    pushHistory();
    state.music.fadeOut = Math.max(0, Number(event.target.value) || 0);
    event.target.value = state.music.fadeOut;
  });
  $('musicLoop').addEventListener('change', (event) => {
    if (!state.music) return;
    pushHistory();
    state.music.loop = event.target.checked;
    const audio = musicElement();
    if (audio) audio.loop = state.music.loop;
  });
  $('btnMusicRemove').addEventListener('click', () => {
    pushHistory();
    stopMusicPreview();
    state.music = null;
    renderMusic();
    toast('Music track removed');
  });

  $('exportFormat').addEventListener('change', syncExportMode);
  bindCompressEvents();
  bindInfoEvents();

  const video = $('edVideo');
  video.addEventListener('timeupdate', onVideoTime);
  video.addEventListener('error', () => {
    if (!selectedClip()) return;
    $('previewBadge').hidden = false;
    $('previewBadge').textContent = 'PREVIEW NOT AVAILABLE';
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeError();
      closeLog();
      closeConfirm(false);
      closeMusicWarning('cancel');
    }
    if (state.view !== 'editor') return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const passive = !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag);
    const mod = event.ctrlKey || event.metaKey;

    if (!typing && mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoEditor();
      else undoEditor();
      return;
    }
    if (!typing && mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redoEditor();
      return;
    }
    if (passive && event.code === 'Space') {
      event.preventDefault();
      if (event.shiftKey) playSequence();
      else togglePreviewPlayback();
      return;
    }
    if (passive && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      seekPreview((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 1));
      return;
    }
    if (passive && (event.key === ',' || event.key === '.')) {
      event.preventDefault();
      stepFrame(event.key === '.' ? 1 : -1);
      return;
    }
    if (passive && !mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      splitSelectedClip();
      return;
    }
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (!passive) return;
    event.preventDefault();
    removeSelectedClip();
  });

  // Solo i file trascinati dall'esterno contano: le clip riordinate
  // nell'editor o un testo selezionato non devono mostrare l'overlay.
  const isExternalFileDrag = (event) => {
    const types = event && event.dataTransfer ? event.dataTransfer.types : null;
    return Boolean(types && Array.from(types).includes('Files'));
  };
  const compressDrop = $('compressDrop');
  const setDropOverlay = (visible) => {
    document.body.classList.toggle('dragging', Boolean(visible) && state.view === 'editor');
  };
  let hideTimer = null;
  const keepOverlayAlive = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setDropOverlay(false), 500);
  };

  document.addEventListener('dragover', (event) => {
    if (!isExternalFileDrag(event)) return;
    // Impedisce a Electron di aprire il file al posto dell'app.
    event.preventDefault();
    const overCompress = compressDrop && event.target instanceof Element && event.target.closest('#compressDrop');
    if (compressDrop) compressDrop.classList.toggle('drop-target', Boolean(overCompress) && state.view === 'compress');
    if (state.view === 'editor') {
      event.dataTransfer.dropEffect = 'copy';
      setDropOverlay(true);
      keepOverlayAlive();
    } else if (state.view === 'compress' && overCompress) {
      event.dataTransfer.dropEffect = 'copy';
      setDropOverlay(false);
    } else {
      event.dataTransfer.dropEffect = 'none';
      setDropOverlay(false);
    }
  });
  document.addEventListener('dragleave', (event) => {
    if (!isExternalFileDrag(event)) return;
    if (!event.relatedTarget) setDropOverlay(false);
  });
  window.addEventListener('dragend', () => {
    setDropOverlay(false);
    if (compressDrop) compressDrop.classList.remove('drop-target');
  });
  document.addEventListener('drop', async (event) => {
    const external = isExternalFileDrag(event);
    if (external) event.preventDefault();
    setDropOverlay(false);
    if (hideTimer) clearTimeout(hideTimer);
    if (compressDrop) compressDrop.classList.remove('drop-target');

    const paths = external ? droppedPaths(event.dataTransfer) : [];
    if (paths.length) {
      if (state.view === 'editor') {
        await addPathsToEditor(paths);
      } else if (state.view === 'compress' && compressDrop && event.target instanceof Element && event.target.closest('#compressDrop')) {
        await loadCompressSource(paths[0]);
      }
      return;
    }
    const text = event.dataTransfer ? event.dataTransfer.getData('text') : '';
    if (text && /^https?:\/\//i.test(text.trim())) {
      setLinkValue(text.trim());
      switchView('download');
      return;
    }
    // Riordino di una clip o drag interno: nessun avviso.
    if (dragClipId || !external) return;
    toast('Unsupported dropped file: use "+ Clip" or choose the file manually', 'err');
  });
}

/* ============================== VIEWS ============================== */

function normalizeDroppedPath(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      text = text.replace(/^file:\/+/i, '');
    }
    text = text.replace(/^\/([A-Za-z]:)/, '$1');
  }
  if (/^\/[A-Za-z]:[\\/]/.test(text)) text = text.slice(1);
  if (!/[\\/]/.test(text)) return '';
  return text;
}

/** Percorsi dei file trascinati: API Electron, poi uri-list e infine text/plain. */
function droppedPaths(dataTransfer) {
  const paths = [];
  const push = (value) => {
    const clean = normalizeDroppedPath(value);
    if (clean && !paths.includes(clean)) paths.push(clean);
  };
  if (!dataTransfer) return paths;
  const files = (() => {
    try {
      return Array.from(dataTransfer.files || []);
    } catch {
      return [];
    }
  })();

  if (api && files.length) {
    try {
      for (const value of api.getDroppedPaths(files) || []) push(value);
    } catch {
      /* provo i fallback */
    }
    if (!paths.length && typeof api.pathForFile === 'function') {
      for (const file of files) {
        try {
          push(api.pathForFile(file));
        } catch {
          /* file senza percorso nativo */
        }
      }
    }
  }

  if (!paths.length) {
    for (const type of ['text/uri-list', 'text/plain']) {
      let raw = '';
      try {
        raw = dataTransfer.getData(type) || '';
      } catch {
        raw = '';
      }
      if (!raw) continue;
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (/^(https?:|mailto:|data:)/i.test(trimmed)) continue;
        push(trimmed);
      }
    }
  }
  return paths;
}

function switchView(view) {
  state.view = view;
  document.body.classList.remove('dragging');
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
  renderEzPanel();
}

/* ============================= EASY MODE ============================= */

function applyMode(mode, options = {}) {
  state.mode = mode === 'advanced' ? 'advanced' : 'easy';
  const easy = state.mode === 'easy';
  document.body.classList.toggle('ez-mode', easy);
  const toggle = $('modeToggle');
  if (toggle) {
    toggle.textContent = easy ? 'Advanced mode' : 'Easy mode';
    toggle.title = easy ? 'Show every setting' : 'Switch to the simple screen';
  }
  if (easy && state.view !== 'download') switchView('download');
  if (!options.silent) {
    try {
      localStorage.setItem(MODE_KEY, state.mode);
    } catch {
      /* il browser interno potrebbe bloccare lo storage */
    }
  }
  renderEzPanel();
  renderLinkInfo();
}

function toggleMode() {
  applyMode(state.mode === 'easy' ? 'advanced' : 'easy');
}

function setEzFormat(format) {
  setTab(format === 'audio' ? 'audio' : 'video');
  if (format === 'video' && $('ezQuality')) $('quality').value = $('ezQuality').value;
}

function renderEzPanel() {
  if (!state.mode) return;
  const easy = state.mode === 'easy';
  if (!easy) return;
  const format = state.currentTab === 'audio' ? 'audio' : 'video';
  document.querySelectorAll('.ez-choice').forEach((button) => {
    button.classList.toggle('active', button.dataset.ezFormat === format);
  });
  if ($('ezQuality')) {
    $('ezQuality').value = $('quality').value;
  }
  if ($('ezQualityRow')) $('ezQualityRow').style.display = format === 'audio' ? 'none' : '';
  if ($('ezFolderPath')) {
    $('ezFolderPath').textContent = state.settings.downloadsDir || state.downloadsDir || 'Downloads';
    $('ezFolderPath').title = $('ezFolderPath').textContent;
  }
}

function renderEngineInfo(defaults) {
  const binaries = (defaults && defaults.binaries) || {};
  const ytdlp = binaries.ytdlp || {};
  const ffmpeg = binaries.ffmpeg || {};

  const ytdlpLabel = $('ytdlpVersion');
  ytdlpLabel.textContent = ytdlp.version || (ytdlp.path ? 'ready' : 'not found');
  ytdlpLabel.classList.toggle('bad', !ytdlp.path);

  const fullFfmpegVersion = String(ffmpeg.version || '');
  const ffmpegVersion = (fullFfmpegVersion.match(/ffmpeg version (\d+(?:\.\d+)*)/i) || [])[1];
  const ffmpegLabel = $('ffmpegVersion');
  ffmpegLabel.textContent = ffmpegVersion || fullFfmpegVersion || (ffmpeg.path ? 'ready' : 'not found');
  ffmpegLabel.title = fullFfmpegVersion;
  ffmpegLabel.classList.toggle('bad', !ffmpeg.path);

  const dot = $('statusDot');
  const ready = Boolean(ytdlp.path && ffmpeg.path);
  dot.classList.toggle('error', !ready);
  dot.title = ready ? 'Local engines ready' : 'yt-dlp or FFmpeg not found';
}

/* ============================ DOWNLOADER ============================ */

const FOLDER_TARGETS = {
  video: 'downloadsDir',
  audio: 'downloadsDir',
  compress: 'compressDir',
  editor: 'editorDir',
};

const FOLDER_BY_KEY = {
  downloadsDir: 'video',
  compressDir: 'compress',
  editorDir: 'editor',
};

function syncFolderInputs() {
  $('outputDir').value = state.settings.downloadsDir || '';
  $('outputDirAudio').value = state.settings.downloadsDir || '';
  $('editorDir').value = state.settings.editorDir || '';
  $('compressDirField').value = state.settings.compressDir || '';
}

function renderDirs() {
  const rows = [
    ['dirPathDownloads', state.settings.downloadsDir, state.folderDefaults.downloadsDir],
    ['dirPathCompress', state.settings.compressDir, state.folderDefaults.compressDir],
    ['dirPathEditor', state.settings.editorDir, state.folderDefaults.editorDir],
  ];
  for (const [id, value, fallback] of rows) {
    const element = $(id);
    if (!element) continue;
    if (!value) element.textContent = 'Default';
    else element.textContent = value === fallback ? `${value} (default)` : value;
  }
  renderEzPanel();
}

async function persistFolderInput(which) {
  const input = folderInput(which);
  const key = FOLDER_TARGETS[which];
  if (!input || !key) return;
  const value = (input.value || '').trim();
  if (state.settings[key] === value) return;
  try {
    const saved = await api.settingsSet({ [key]: value });
    state.settings = { ...state.settings, ...(saved || {}) };
  } catch {
    /* l'impostazione resta in memoria per questa sessione */
  }
  syncFolderInputs();
  renderDirs();
}

function folderInput(which) {
  if (which === 'audio') return $('outputDirAudio');
  if (which === 'video') return $('outputDir');
  if (which === 'editor') return $('editorDir');
  if (which === 'compress') return $('compressDirField');
  return null;
}

async function pickFolder(which) {
  const input = folderInput(which);
  try {
    const folder = await api.pickFolder(input ? input.value : '');
    if (!folder) return;
    await applyFolder(which, folder);
  } catch (error) {
    toast(errorMessage(error), 'err');
  }
}

async function saveFolder(key, value) {
  try {
    const saved = await api.settingsSet({ [key]: value });
    state.settings = { ...state.settings, ...(saved || {}) };
  } catch (error) {
    toast(errorMessage(error), 'err');
    return false;
  }
  syncFolderInputs();
  if (key === 'downloadsDir') state.downloadsDir = state.settings.downloadsDir;
  if (key === 'compressDir') prefillCompressOutput();
  renderDirs();
  return true;
}

async function applyFolder(which, folder) {
  const key = FOLDER_TARGETS[which];
  if (!key) return;
  if (await saveFolder(key, folder)) toast('Folder updated');
}

async function resetFolder(which) {
  const key = FOLDER_TARGETS[which];
  if (!key) return;
  if (await saveFolder(key, '')) toast('Default folder restored');
}

function syncDownloadPrefs() {
  const parallel = clamp(Number(state.settings.maxParallel) || 2, 1, 8);
  const input = $('maxParallel');
  if (input) input.value = String(parallel);
  if ($('autoRetry')) $('autoRetry').checked = state.settings.autoRetry !== false;
  if ($('cookieFallback')) $('cookieFallback').checked = state.settings.cookieFallback !== false;
}

async function persistDownloadPrefs() {
  const patch = {
    maxParallel: clamp(parseInt($('maxParallel').value, 10) || 2, 1, 8),
    autoRetry: $('autoRetry').checked,
    cookieFallback: $('cookieFallback').checked,
  };
  try {
    const saved = await api.settingsSet(patch);
    state.settings = { ...state.settings, ...(saved || {}) };
    syncDownloadPrefs();
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
    concurrent_fragments: parseInt($('concurrentFragments').value, 10) || 8,
    cookies_from: $('cookiesFrom').value,
    proxy: $('proxy').value.trim(),
    auto_retry: $('autoRetry').checked,
    cookie_fallback: $('cookieFallback').checked,
  };
}

async function startDownload(source = 'advanced') {
  const easy = source === 'ez';
  const input = easy ? $('ezUrl') : $('urlInput');
  const raw = input.value.trim();
  if (!raw) {
    toast('Paste a link first', 'err');
    return;
  }

  const urls = raw.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  if (!urls.length) {
    toast('Enter at least one valid link', 'err');
    return;
  }

  if (easy) {
    $('quality').value = $('ezQuality').value;
    setTab(state.currentTab);
  }

  let settings = collectSettings();
  if (settings.format === 'video') {
    const music = musicPlaylistInfo(urls, settings.playlist);
    if (music.length) {
      const choice = await openMusicWarning(music);
      if (choice === 'cancel') return;
      if (choice === 'audio') {
        setTab('audio');
        settings = collectSettings();
      }
    }
  }

  const button = easy ? $('ezDownloadBtn') : $('dlBtn');
  const originalLabel = easy ? 'Download' : 'Download';
  button.disabled = true;
  button.textContent = 'Starting...';

  try {
    const jobs = await api.startDownloads({ urls, settings });
    setLinkValue('');
    toast(`${jobs.length} ${jobs.length === 1 ? 'download' : 'downloads'} queued`);
    await refreshJobs();
  } catch (error) {
    const message = errorMessage(error);
    if (/paste a link|at least one valid link|maximum 20 links/i.test(message)) {
      toast(message, 'err');
    } else {
      showError(explainError(message, urls[0]));
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function onJobUpdate(job) {
  if (!job || !job.id) return;
  const previous = state.jobs.get(job.id);
  state.jobs.set(job.id, { ...(previous || {}), ...job });

  if (previous && previous.status !== job.status) {
    if (job.status === 'done') {
      toast(`Completed: ${job.title || shortenUrl(job.url)}`);
    } else if (job.status === 'error') {
      const info = job.errorInfo || explainError(job.error || 'Download failed', job.url);
      // Una playlist puo` far fallire molti brani: il popup si apre una volta
      // sola e le altre schede restano con il messaggio in linea.
      if (!state.errorShown.has(job.id) && !$('errorModal').classList.contains('open')) {
        state.errorShown.add(job.id);
        showError(info, { jobId: job.id });
      } else {
        toast(info.title, 'err');
      }
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
    queued: 'queued',
    running: 'download',
    done: 'completed',
    error: 'error',
    cancelled: 'cancelled',
  }[status] || status;
}

function jobCardHtml(job, compact = false) {
  const status = job.status || 'queued';
  const active = status === 'queued' || status === 'running';
  const percent = clamp(Number(job.progress) || 0, 0, 100);
  const title = job.title || shortenUrl(job.url);
  const meta = [];
  if (job.playlist && job.linkKind === 'playlist') meta.push(`Playlist detected${job.playlistTotal ? ` · ${job.playlistTotal} items` : ''}`);
  if (job.size) meta.push(esc(job.size));
  if (job.speed) meta.push(esc(job.speed));
  if (job.eta) meta.push(`ETA ${esc(job.eta)}`);
  meta.push(`${percent.toFixed(percent < 10 ? 1 : 0)}%`);
  if (job.note) meta.push(esc(job.note));

  const files = (job.files || []).map((file) => `
      <div class="job-file">
        <span class="job-file-name" title="${esc(file.path)}">${esc(file.name)}</span>
        <span class="job-file-size">${fmtBytes(file.size)}</span>
        <button class="btn-sm" data-action="editor" data-path="${esc(file.path)}">Editor</button>
        <button class="btn-sm" data-action="reveal" data-path="${esc(file.path)}" title="Show in folder">Folder</button>
      </div>`).join('');

  const info = job.errorInfo;
  const errorBox = info
    ? `<div class="job-error">
        <span class="job-error-code">${esc(info.code)}</span>
        <strong>${esc(info.title)}</strong>
        <p>${esc(info.hint || info.message)}</p>
        <button class="btn-sm" data-action="explain" data-id="${esc(job.id)}">Details</button>
      </div>`
    : job.error
      ? `<div class="job-error">${esc(job.error)}</div>`
      : '';

    return `<div class="job-card ${status}${compact ? ' job-card-child' : ''}">
      <div class="job-header">
        <span class="job-url" title="${esc(job.url)}">${esc(title)}</span>
        ${job.playlist && job.linkKind === 'playlist' ? '<span class="job-group-tag">Playlist</span>' : ''}
        <span class="job-status ${status}">${jobStatusLabel(status)}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="job-meta">${meta.join(' · ')}</div>
      ${errorBox}
      ${files ? `<div class="job-files">${files}</div>` : ''}
      <div class="job-actions">
        ${active ? `<button class="btn-sm btn-cancel" data-action="cancel" data-id="${esc(job.id)}">× Cancel</button>` : ''}
        <button class="btn-sm" data-action="log" data-id="${esc(job.id)}">Log</button>
        <button class="btn-sm" data-action="reveal-job" data-id="${esc(job.id)}">Folder</button>
      </div>
    </div>`;
}

function renderJobs() {
  const container = $('jobsList');
  const jobs = Array.from(state.jobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!jobs.length) {
    container.innerHTML = '<div class="empty-state">No downloads yet</div>';
    return;
  }

  const singles = [];
  const groups = new Map();
  for (const job of jobs) {
    // Le playlist dei link vengono scaricate da yt-dlp in un solo job: la
    // scheda resta singola con l'etichetta e il conteggio degli elementi.
    if (!job.playlist || job.playlistKind === 'link') {
      singles.push(job);
      continue;
    }
    if (!groups.has(job.playlist)) groups.set(job.playlist, []);
    groups.get(job.playlist).push(job);
  }

  const blocks = singles.map((job) => ({ at: job.createdAt || 0, html: jobCardHtml(job) }));
  for (const [name, list] of groups) {
    const done = list.filter((job) => job.status === 'done').length;
    const failed = list.some((job) => job.status === 'error');
    const running = list.some((job) => job.status === 'running');
    const percent = list.reduce((sum, job) => sum + clamp(Number(job.progress) || 0, 0, 100), 0) / list.length;
    const collapsed = state.collapsedPlaylists.has(name);
    const status = done === list.length ? 'done' : failed && !running ? 'error' : running ? 'running' : 'queued';
    const at = Math.max(...list.map((job) => job.createdAt || 0));
    blocks.push({
      at,
      html: `<div class="job-group">
        <button class="job-group-head" type="button" data-action="toggle-group" data-group="${esc(name)}" aria-expanded="${collapsed ? 'false' : 'true'}">
          <span class="job-group-caret">${collapsed ? '▸' : '▾'}</span>
          <span class="job-group-title" title="${esc(name)}">${esc(name)}</span>
          <span class="job-group-tag">${list[0] && list[0].playlistKind === 'album' ? 'Album' : 'Playlist'}</span>
          <span class="job-group-count">${done}/${list.length}</span>
          <span class="job-status ${status}">${jobStatusLabel(status)}</span>
        </button>
        <div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="job-group-body" ${collapsed ? 'hidden' : ''}>${list.map((job) => jobCardHtml(job, true)).join('')}</div>
      </div>`,
    });
  }

  blocks.sort((a, b) => b.at - a.at);
  container.innerHTML = blocks.map((block) => block.html).join('');
}

function onJobsClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'cancel') {
    cancelJob(button.dataset.id);
  } else if (action === 'log') {
    openLog(button.dataset.id);
  } else if (action === 'explain') {
    const job = state.jobs.get(button.dataset.id);
    if (job) showError(job.errorInfo || explainError(job.error || 'Download failed', job.url), { jobId: job.id });
  } else if (action === 'editor') {
    switchView('editor');
    addPathsToEditor([button.dataset.path]);
  } else if (action === 'reveal') {
    api.reveal(button.dataset.path);
  } else if (action === 'toggle-group') {
    const name = button.dataset.group || '';
    if (state.collapsedPlaylists.has(name)) state.collapsedPlaylists.delete(name);
    else state.collapsedPlaylists.add(name);
    renderJobs();
  } else if (action === 'reveal-job') {
    const job = state.jobs.get(button.dataset.id);
    if (job && job.files && job.files.length) api.reveal(job.files[job.files.length - 1].path);
    else if (state.downloadsDir) api.openPath(state.downloadsDir);
  }
}

async function cancelJob(id) {
  if (!id) return;
  const job = state.jobs.get(id);
  const label = job ? job.title || shortenUrl(job.url) : '';
  const confirmed = await openConfirm({
    title: 'Cancel this download?',
    message: label
      ? `"${label}" will stop and the partial file will be deleted.`
      : 'The download will stop and the partial file will be deleted.',
    confirmLabel: 'Cancel download',
    keepLabel: 'Keep downloading',
  });
  if (!confirmed) return;
  try {
    await api.cancelDownload(id);
    toast('Download cancelled');
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
  $('modalTitle').textContent = 'Download log';
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
      $('logBox').textContent = 'Download not found';
      return;
    }
    $('modalTitle').textContent = `Log — ${job.title || shortenUrl(job.url)}`;
    const box = $('logBox');
    box.textContent = (job.log || []).join('\n') || '(no output yet)';
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
  $('updateStatus').textContent = 'Downloading the latest version...';
  try {
    const updated = await api.updateYtDlp();
    if (state.defaults) state.defaults.binaries.ytdlp = updated;
    renderEngineInfo(state.defaults);
    $('updateStatus').textContent = `Updated to ${updated.version || 'latest version'}`;
    toast('yt-dlp updated');
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
  $('updateStatus').textContent = `Updating yt-dlp... ${percent}`;
}

/* ============================== EDITOR ============================== */

function selectedClip() {
  return state.clips.find((clip) => clip.id === state.selectedId) || null;
}

/* --------------------------- storia (undo/redo) --------------------------- */

function editorSnapshot() {
  return JSON.stringify({
    clips: state.clips,
    music: state.music,
    selectedId: state.selectedId,
  });
}

function recordSnapshot(snapshot) {
  if (!snapshot) return;
  if (state.history[state.history.length - 1] === snapshot) return;
  state.history.push(snapshot);
  if (state.history.length > 80) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function pushHistory() {
  recordSnapshot(editorSnapshot());
}

function pushHistoryThrottled(key) {
  const now = Date.now();
  if (state.historyKey === key && now - state.historyAt < 900) {
    state.historyAt = now;
    return;
  }
  state.historyKey = key;
  state.historyAt = now;
  pushHistory();
}

function updateHistoryButtons() {
  const undo = $('btnUndo');
  const redo = $('btnRedo');
  if (undo) undo.disabled = !state.history.length;
  if (redo) redo.disabled = !state.future.length;
}

function restoreEditor(snapshot) {
  let data = null;
  try {
    data = JSON.parse(snapshot);
  } catch {
    return;
  }
  stopPreview(false);
  state.clips = Array.isArray(data.clips) ? data.clips : [];
  state.music = data.music || null;
  state.selectedId = data.selectedId || (state.clips[0] ? state.clips[0].id : null);
  renderEditor();
  loadPreview();
  updateHistoryButtons();
}

function undoEditor() {
  if (!state.history.length) return;
  state.future.push(editorSnapshot());
  const snapshot = state.history.pop();
  restoreEditor(snapshot);
  toast('Change undone');
}

function redoEditor() {
  if (!state.future.length) return;
  state.history.push(editorSnapshot());
  const snapshot = state.future.pop();
  restoreEditor(snapshot);
  toast('Change restored');
}

/* --------------------------- anteprima sequenza --------------------------- */

function mediaUrlForPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return `file:///${encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

function musicElement() {
  return $('edMusic');
}

function startMusicPreview() {
  const music = state.music;
  const audio = musicElement();
  if (!audio) return;
  if (!music) {
    stopMusicPreview();
    return;
  }
  audio.loop = Boolean(music.loop);
  audio.volume = clamp(music.volume, 0, 1);
  if (audio.dataset.path !== music.path) {
    audio.dataset.path = music.path;
    audio.src = mediaUrlForPath(music.path);
  }
  try {
    audio.currentTime = 0;
  } catch {
    /* sorgente non ancora pronta */
  }
  audio.play().catch(() => {
    /* la musica è un extra dell'anteprima */
  });
}

function stopMusicPreview() {
  const audio = musicElement();
  if (!audio) return;
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function updatePreviewInfo(clip) {
  if (!clip) {
    $('edSelection').textContent = 'No clip selected';
    return;
  }
  const duration = fmtTime((clip.out - clip.in) / (clip.speed || 1));
  if (state.previewMode === 'sequence' && state.previewIndex >= 0) {
    $('edSelection').textContent = `${state.previewIndex + 1}/${state.clips.length} · ${clip.name} · ${duration}`;
  } else {
    $('edSelection').textContent = `${clip.name} · ${duration}`;
  }
}

function stopPreview(reset = true) {
  state.previewMode = 'clip';
  state.previewIndex = -1;
  state.previewStopAt = null;
  const video = $('edVideo');
  if (video) {
    video.pause();
    video.playbackRate = 1;
  }
  stopMusicPreview();
  const play = $('btnPreviewPlay');
  if (play) play.classList.remove('playing');
  if (reset) updateVideoTime();
}

function startSequenceClip() {
  const clip = state.clips[state.previewIndex];
  if (!clip) {
    stopPreview();
    return;
  }
  state.selectedId = clip.id;
  renderTimeline();
  refreshInspectorValues();
  const video = $('edVideo');
  state.previewStopAt = clip.out;
  const play = () => {
    video.playbackRate = clamp(clip.speed || 1, 0.5, 2);
    video.volume = clip.mute ? 0 : Math.min(1, clip.volume);
    try {
      video.currentTime = Math.min(clip.in + 0.02, Math.max(0, clip.duration - 0.05));
    } catch {
      /* seek not available */
    }
    video.play().catch(() => {
      toast('Preview not available for this format', 'err');
      stopPreview();
    });
  };
  if (video.dataset.clipId !== clip.id) {
    video.dataset.clipId = clip.id;
    video.src = clip.mediaUrl;
    video.load();
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (state.previewMode === 'sequence' && state.previewIndex >= 0) play();
      },
      { once: true },
    );
  } else {
    play();
  }
  updatePreviewInfo(clip);
  updateVideoTime();
}

function playSequence() {
  if (!state.clips.length) {
    toast('Add at least one clip to the timeline', 'err');
    return;
  }
  const start = state.clips.findIndex((clip) => clip.id === state.selectedId);
  state.previewMode = 'sequence';
  state.previewIndex = start >= 0 ? start : 0;
  const play = $('btnPreviewPlay');
  if (play) play.classList.add('playing');
  startMusicPreview();
  startSequenceClip();
}

function seekPreview(delta) {
  const clip = selectedClip();
  const video = $('edVideo');
  if (!clip || video.dataset.clipId !== clip.id) return;
  video.currentTime = clamp(video.currentTime + delta, clip.in, clip.out);
  updateVideoTime();
}

function splitSelectedClip() {
  const clip = selectedClip();
  if (!clip) {
    toast('Select a clip to split', 'err');
    return;
  }
  if (clip.out - clip.in < 0.3) {
    toast('Clip is too short to split', 'err');
    return;
  }
  const video = $('edVideo');
  // Se il player non ha ancora finito di caricare/seekare la clip, il cursore
  // vale 0: in quel caso divido al centro invece che a inizio clip.
  const usable =
    video.dataset.clipId === clip.id &&
    video.readyState >= 1 &&
    Number.isFinite(video.currentTime) &&
    video.currentTime > clip.in + 0.05 &&
    video.currentTime < clip.out - 0.05;
  const raw = usable ? video.currentTime : (clip.in + clip.out) / 2;
  const at = clamp(raw, clip.in + 0.1, clip.out - 0.1);
  pushHistory();
  const index = state.clips.findIndex((item) => item.id === clip.id);
  const second = { ...clip, id: uid(), in: at, out: clip.out, fadeIn: 0 };
  second.fadeOut = Math.min(clip.fadeOut, (second.out - second.in) / 2);
  clip.out = at;
  clip.fadeOut = Math.min(clip.fadeOut, (clip.out - clip.in) / 2);
  state.clips.splice(index + 1, 0, second);
  state.selectedId = second.id;
  renderEditor();
  loadPreview();
  toast('Clip split at the playhead');
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
  const before = editorSnapshot();
  state.editorBusy += 1;
  updateEditorMeta();

  let added = 0;
  for (const filePath of paths) {
    try {
      const info = await api.probeFile(filePath);
      if (!info || !(info.duration > 0.05)) {
        throw new Error(`${info && info.name ? info.name : 'File'}: invalid duration`);
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
        size: info.size || 0,
        videoCodec: info.videoCodec || '',
        audioCodec: info.audioCodec || '',
        audioChannels: info.audioChannels || 0,
        audioSampleRate: info.audioSampleRate || 0,
        in: 0,
        out: info.duration,
        volume: 1,
        mute: false,
        fadeIn: 0,
        fadeOut: 0,
        speed: 1,
        zoom: 1,
        rotate: 0,
        flipH: false,
        flipV: false,
        color: { brightness: 0, contrast: 100, saturation: 100, gamma: 100, temperature: 6500 },
      };
      state.clips.push(clip);
      state.selectedId = clip.id;
      added += 1;
    } catch (error) {
      toast(`Import: ${errorMessage(error)}`, 'err');
    }
  }

  state.editorBusy = Math.max(0, state.editorBusy - 1);
  if (added) recordSnapshot(before);
  renderEditor();
  if (added && selectedClip()) loadPreview();
  if (added) toast(`${added} clip aggiunte all'editor`);
}

const COLOR_DEFAULTS = {
  brightness: 0,
  contrast: 100,
  saturation: 100,
  gamma: 100,
  temperature: 6500,
};

const COLOR_PRESETS = {
  neutral: { brightness: 0, contrast: 100, saturation: 100, gamma: 100, temperature: 6500 },
  warm: { brightness: 5, contrast: 105, saturation: 114, gamma: 100, temperature: 5300 },
  cool: { brightness: 0, contrast: 103, saturation: 94, gamma: 100, temperature: 7900 },
  vivid: { brightness: 2, contrast: 114, saturation: 140, gamma: 100, temperature: 6600 },
  cinema: { brightness: -4, contrast: 120, saturation: 88, gamma: 95, temperature: 5800 },
  mono: { brightness: 0, contrast: 110, saturation: 0, gamma: 100, temperature: 6500 },
};

const COLOR_LABELS = {
  neutral: 'Neutro',
  warm: 'Caldo',
  cool: 'Freddo',
  vivid: 'Vivace',
  cinema: 'Cinema',
  mono: 'B/N',
};

const TOOL_NAMES = ['trim', 'color', 'transform', 'audio', 'resize', 'speed', 'snapshot', 'inspect'];

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clipColor(clip) {
  const color = (clip && clip.color) || {};
  return {
    brightness: clamp(numberOr(color.brightness, 0), -50, 50),
    contrast: clamp(numberOr(color.contrast, 100), 50, 200),
    saturation: clamp(numberOr(color.saturation, 100), 0, 250),
    gamma: clamp(numberOr(color.gamma, 100), 50, 250),
    temperature: clamp(numberOr(color.temperature, 6500), 2500, 10000),
  };
}

function colorIsDefault(color) {
  return (
    Math.abs(color.brightness) < 0.01 &&
    Math.abs(color.contrast - 100) < 0.01 &&
    Math.abs(color.saturation - 100) < 0.01 &&
    Math.abs(color.gamma - 100) < 0.01 &&
    Math.abs(color.temperature - 6500) < 1
  );
}

function colorPresetOf(color) {
  if (colorIsDefault(color)) return 'neutral';
  const found = Object.keys(COLOR_PRESETS).find((name) => {
    const preset = COLOR_PRESETS[name];
    return (
      Math.abs(preset.brightness - color.brightness) < 0.6 &&
      Math.abs(preset.contrast - color.contrast) < 0.6 &&
      Math.abs(preset.saturation - color.saturation) < 0.6 &&
      Math.abs(preset.gamma - color.gamma) < 0.6 &&
      Math.abs(preset.temperature - color.temperature) < 60
    );
  });
  return found || '';
}

function colorFilterCss(color) {
  const parts = [];
  const brightness = 1 + color.brightness / 100;
  if (Math.abs(brightness - 1) > 0.004) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (Math.abs(color.contrast - 100) > 0.4) parts.push(`contrast(${(color.contrast / 100).toFixed(3)})`);
  if (Math.abs(color.saturation - 100) > 0.4) parts.push(`saturate(${(color.saturation / 100).toFixed(3)})`);
  if (color.temperature < 6400) {
    const warm = (6500 - color.temperature) / 4000;
    parts.push(`sepia(${(warm * 0.22).toFixed(3)}) saturate(${(1 + warm * 0.12).toFixed(3)})`);
  } else if (color.temperature > 6600) {
    const cold = (color.temperature - 6500) / 3500;
    parts.push(`hue-rotate(${(-cold * 8).toFixed(1)}deg) saturate(${(1 - cold * 0.08).toFixed(3)})`);
  }
  return parts.join(' ') || 'none';
}

function clipEffectsTags(clip) {
  if (!clip) return [];
  const tags = [];
  const rotate = ((Math.round(numberOr(clip.rotate, 0)) % 360) + 360) % 360;
  if (rotate) tags.push(`${rotate}°`);
  if (clip.flipH) tags.push('flip H');
  if (clip.flipV) tags.push('flip V');
  const zoom = clamp(numberOr(clip.zoom, 1) || 1, 0.2, 3);
  if (Math.abs(zoom - 1) > 0.01) tags.push(`${Math.round(zoom * 100)}%`);
  const color = clipColor(clip);
  const preset = colorPresetOf(color);
  if (preset && preset !== 'neutral') tags.push(COLOR_LABELS[preset]);
  else if (!colorIsDefault(color)) tags.push('Colore');
  const speed = clamp(numberOr(clip.speed, 1) || 1, 0.5, 2);
  if (Math.abs(speed - 1) > 0.01) tags.push(`${speed}x`);
  return tags;
}

function applyPreviewEffects() {
  const clip = selectedClip();
  const video = $('edVideo');
  if (!video) return;
  const wrap = $('previewEffects');
  const chip = $('trimChip');

  if (!clip) {
    video.style.filter = '';
    video.style.transform = '';
    if (wrap) {
      wrap.hidden = true;
      wrap.innerHTML = '';
    }
    if (chip) chip.hidden = true;
    return;
  }

  video.style.filter = colorFilterCss(clipColor(clip));

  const rotate = ((Math.round(numberOr(clip.rotate, 0)) % 360) + 360) % 360;
  const zoom = clamp(numberOr(clip.zoom, 1) || 1, 0.2, 3);
  const rotated = rotate === 90 || rotate === 270;
  const boxWidth = video.clientWidth || 16;
  const boxHeight = video.clientHeight || 9;
  const naturalWidth = video.videoWidth || 16;
  const naturalHeight = video.videoHeight || 9;
  const fitDisplay = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const displayedWidth = naturalWidth * fitDisplay;
  const displayedHeight = naturalHeight * fitDisplay;
  const contentWidth = rotated ? displayedHeight : displayedWidth;
  const contentHeight = rotated ? displayedWidth : displayedHeight;
  const fit =
    contentWidth > 0 && contentHeight > 0
      ? Math.min(1, boxWidth / contentWidth, boxHeight / contentHeight)
      : 1;
  const scaleX = (clip.flipH ? -1 : 1) * zoom * fit;
  const scaleY = (clip.flipV ? -1 : 1) * zoom * fit;
  video.style.transform = `rotate(${rotate}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;

  if (chip) {
    chip.hidden = false;
    chip.classList.toggle('edited', clip.in > 0.01 || clip.out < clip.duration - 0.01);
    $('trimChipValue').textContent = `${fmtTime(clip.in)} – ${fmtTime(clip.out)}`;
  }

  if (wrap) {
    const tags = clipEffectsTags(clip);
    wrap.innerHTML = tags.map((tag) => `<span>${esc(tag)}</span>`).join('');
    wrap.hidden = !tags.length;
  }
}

function renderEditor() {
  renderTimeline();
  renderInspector();
  renderMusic();
  updateEditorMeta();
  updateHistoryButtons();
  refreshInspectorValues();
}

function renderTimeline() {
  const timeline = $('timeline');
  if (!state.clips.length) {
    timeline.innerHTML = '<div class="timeline-empty">No clips: import a file or drop it here</div>';
    return;
  }

  timeline.innerHTML = state.clips.map((clip, index) => {
    const selected = clip.id === state.selectedId;
    const thumbnail = clip.thumbnailUrl
      ? `<img src="${esc(clip.thumbnailUrl)}" alt="">`
      : `<span class="tl-noimg">${clip.hasVideo ? 'Video' : 'Audio'}</span>`;
    const tags = clipEffectsTags(clip);
    return `<div class="tl-clip ${selected ? 'selected' : ''}" draggable="true" data-clip-id="${clip.id}">
      <div class="tl-thumb">
        ${thumbnail}
        <span class="tl-index">${index + 1}</span>
        <span class="tl-dur">${fmtTime((clip.out - clip.in) / (clip.speed || 1))}</span>
      </div>
      <div class="tl-body">
        <div class="tl-name" title="${esc(clip.name)}">${esc(clip.name)}</div>
        <div class="tl-meta">${fmtTime(clip.in)} – ${fmtTime(clip.out)} · ${Math.round((clip.mute ? 0 : clip.volume) * 100)}%</div>
        <div class="tl-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

function renderInspector() {
  const clip = selectedClip();
  const box = $('clipInspect');
  if (!box) return;

  if (!clip) {
    box.innerHTML = '<div class="muted">Select a clip to see technical details.</div>';
    return;
  }

  const rows = [
    ['File', clip.name],
    ['Duration', fmtTime(clip.duration)],
    [
      'Video',
      clip.hasVideo
        ? `${clip.width}×${clip.height} · ${(clip.fps || 0).toFixed(2)} fps · ${clip.videoCodec || '—'}`
        : 'No video track',
    ],
    [
      'Audio',
      clip.hasAudio
        ? `${clip.audioCodec || '—'} · ${clip.audioChannels || '?'} channels · ${Math.round((clip.audioSampleRate || 0) / 1000)} kHz`
        : 'No audio track',
    ],
    ['Size', fmtBytes(clip.size) || '—'],
    ['Selection', `${fmtTime(clip.in)} – ${fmtTime(clip.out)} (${fmtTime((clip.out - clip.in) / (clip.speed || 1))})`],
    ['Effects', clipEffectsTags(clip).join(' · ') || 'None'],
    ['Path', clip.path],
  ];

  box.innerHTML = rows
    .map(
      ([key, value]) =>
        `<div class="inspect-row${key === 'Path' ? ' wide' : ''}"><span class="inspect-key">${key}</span><span class="inspect-val" title="${esc(value)}">${esc(value)}</span></div>`,
    )
    .join('');
}

function setValueIfIdle(id, value) {
  const input = $(id);
  if (!input || document.activeElement === input) return;
  input.value = String(value);
}

function refreshInspectorValues() {
  const clip = selectedClip();
  const video = $('edVideo');

  if (!clip) {
    $('trimChip').hidden = true;
    $('previewEffects').hidden = true;
    if (video) {
      video.style.filter = '';
      video.style.transform = '';
    }
    $('edFrame').textContent = 'F: 0';
    if ($('edScrub')) $('edScrub').value = '0';
    $('clipDuration').textContent = '0:00.0';
    $('clipIndexLabel').textContent = 'no clip';
    return;
  }

  const color = clipColor(clip);
  const rotate = ((Math.round(numberOr(clip.rotate, 0)) % 360) + 360) % 360;
  const zoom = clamp(numberOr(clip.zoom, 1) || 1, 0.2, 3);
  const speed = clamp(numberOr(clip.speed, 1) || 1, 0.5, 2);
  const index = state.clips.findIndex((item) => item.id === clip.id);

  const inInput = $('clipIn');
  const outInput = $('clipOut');
  if (inInput) {
    inInput.max = String(clip.duration);
    setValueIfIdle('clipIn', clip.in);
  }
  if (outInput) {
    outInput.max = String(clip.duration);
    setValueIfIdle('clipOut', clip.out);
  }
  const inNum = $('clipInNum');
  const outNum = $('clipOutNum');
  if (inNum) {
    inNum.max = String(clip.duration);
    if (document.activeElement !== inNum) inNum.value = String(Number(clip.in.toFixed(2)));
  }
  if (outNum) {
    outNum.max = String(clip.duration);
    if (document.activeElement !== outNum) outNum.value = String(Number(clip.out.toFixed(2)));
  }

  $('clipInValue').textContent = fmtTime(clip.in);
  $('clipOutValue').textContent = fmtTime(clip.out);
  $('clipDuration').textContent = fmtTime((clip.out - clip.in) / speed);
  $('clipIndexLabel').textContent = `#${index + 1} di ${state.clips.length} · ${clip.name}`;

  setValueIfIdle('clipVolume', Math.round(clip.volume * 100));
  $('clipVolumeValue').textContent = `${Math.round(clip.volume * 100)}%`;
  const mute = $('clipMute');
  if (mute) mute.checked = Boolean(clip.mute);
  setValueIfIdle('clipFadeIn', Number(numberOr(clip.fadeIn, 0).toFixed(2)));
  setValueIfIdle('clipFadeOut', Number(numberOr(clip.fadeOut, 0).toFixed(2)));

  setValueIfIdle('clipSpeed', speed.toFixed(2));
  $('clipSpeedValue').textContent = `${speed.toFixed(2).replace(/\.?0+$/, '')}x`;
  document.querySelectorAll('#speedPresets [data-speed]').forEach((button) => {
    button.classList.toggle('active', Math.abs(Number(button.dataset.speed) - speed) < 0.01);
  });

  setValueIfIdle('clipZoom', Math.round(zoom * 100));
  $('clipZoomValue').textContent = `${Math.round(zoom * 100)}%`;
  document.querySelectorAll('#zoomPresets [data-zoom]').forEach((button) => {
    button.classList.toggle('active', Math.abs(Number(button.dataset.zoom) - zoom) < 0.01);
  });

  setValueIfIdle('colorBrightness', Math.round(color.brightness));
  setValueIfIdle('colorContrast', Math.round(color.contrast));
  setValueIfIdle('colorSaturation', Math.round(color.saturation));
  setValueIfIdle('colorGamma', Math.round(color.gamma));
  setValueIfIdle('colorTemperature', Math.round(color.temperature));
  $('colorBrightnessValue').textContent = `${Math.round(color.brightness) > 0 ? '+' : ''}${Math.round(color.brightness)}`;
  $('colorContrastValue').textContent = `${Math.round(color.contrast)}%`;
  $('colorSaturationValue').textContent = `${Math.round(color.saturation)}%`;
  $('colorGammaValue').textContent = `${Math.round(color.gamma)}%`;
  $('colorTemperatureValue').textContent = `${Math.round(color.temperature)} K`;

  const activePreset = colorPresetOf(color);
  document.querySelectorAll('#colorPresets [data-color-preset]').forEach((button) => {
    const name = button.dataset.colorPreset;
    button.classList.toggle('active', name === activePreset || (name === 'reset' && activePreset === 'neutral'));
  });

  const flipH = $('flipH');
  const flipV = $('flipV');
  if (flipH) flipH.checked = Boolean(clip.flipH);
  if (flipV) flipV.checked = Boolean(clip.flipV);

  const transform = [];
  if (rotate) transform.push(`ruotata di ${rotate}°`);
  if (clip.flipH) transform.push('specchiata in orizzontale');
  if (clip.flipV) transform.push('specchiata in verticale');
  $('transformHint').textContent = transform.length ? `${transform.join(' · ')}.` : 'No rotation or flip.';

  if ($('snapshotStatus')) {
    $('snapshotStatus').textContent = state.snapshotPath
      ? `Last snapshot: ${state.snapshotName || state.snapshotPath}`
      : 'The PNG is saved in Pictures\\MoliDowloader.';
  }

  applyPreviewEffects();
  syncTimelineClip(clip);
  updateEditorMeta();
}

function syncTimelineClip(clip) {
  const card = document.querySelector(`.tl-clip[data-clip-id="${clip.id}"]`);
  if (!card) return;
  const meta = card.querySelector('.tl-meta');
  if (meta) {
    meta.textContent = `${fmtTime(clip.in)} – ${fmtTime(clip.out)} · ${Math.round((clip.mute ? 0 : clip.volume) * 100)}%`;
  }
  const tags = card.querySelector('.tl-tags');
  if (tags) {
    tags.innerHTML = clipEffectsTags(clip)
      .map((tag) => `<span>${esc(tag)}</span>`)
      .join('');
  }
  const duration = card.querySelector('.tl-dur');
  if (duration) duration.textContent = fmtTime((clip.out - clip.in) / (clip.speed || 1));
}

function selectClip(id) {
  if (!state.clips.some((clip) => clip.id === id)) return;
  state.selectedId = id;
  renderTimeline();
  renderInspector();
  refreshInspectorValues();
  loadPreview();
}

function loadPreview() {
  const clip = selectedClip();
  const video = $('edVideo');
  if (state.previewMode === 'sequence') stopPreview(false);

  if (!clip) {
    video.pause();
    delete video.dataset.clipId;
    video.removeAttribute('src');
    video.load();
    $('previewEmpty').hidden = false;
    $('previewBadge').hidden = true;
    $('edSelection').textContent = 'No clip selected';
    $('edTime').textContent = '00:00.0 / 00:00.0';
    refreshInspectorValues();
    return;
  }

  $('previewEmpty').hidden = true;
  $('previewBadge').hidden = false;
  $('previewBadge').textContent = clip.hasVideo ? (clip.hasAudio ? 'VIDEO' : 'MUTO') : 'AUDIO';
  updatePreviewInfo(clip);
  state.previewStopAt = null;
  video.volume = clip.mute ? 0 : Math.min(1, clip.volume);
  video.playbackRate = clamp(clip.speed || 1, 0.5, 2);
  applyPreviewEffects();

  if (video.dataset.clipId !== clip.id) {
    video.dataset.clipId = clip.id;
    video.src = clip.mediaUrl;
    video.load();
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (!selectedClip() || selectedClip().id !== clip.id) return;
        video.currentTime = Math.min(clip.in + 0.01, Math.max(0, clip.duration - 0.05));
        applyPreviewEffects();
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
  const scrub = $('edScrub');
  if (scrub) {
    const span = Math.max(0.001, clip.out - clip.in);
    const ratio = clamp((video.currentTime - clip.in) / span, 0, 1);
    if (document.activeElement !== scrub) scrub.value = String(Math.round(ratio * 1000));
  }
  const fps = numberOr(clip.fps, 30) || 30;
  $('edFrame').textContent = `F: ${Math.max(0, Math.round(numberOr(video.currentTime, 0) * Math.max(1, fps)))}`;
}

function stepFrame(delta) {
  const clip = selectedClip();
  if (!clip) {
    toast('Select a clip', 'err');
    return;
  }
  if (state.previewMode === 'sequence') stopPreview(false);
  const video = $('edVideo');
  const fps = Math.max(1, numberOr(clip.fps, 30));
  if (video.dataset.clipId !== clip.id || video.readyState < 1) {
    loadPreview();
    return;
  }
  video.pause();
  const base = Number.isFinite(video.currentTime) ? video.currentTime : clip.in;
  const next = clamp(base + delta / fps, clip.in, Math.max(clip.in, clip.out - 0.001));
  try {
    video.currentTime = next;
  } catch {
    /* seek not available */
  }
  updateVideoTime();
}

function onVideoTime() {
  updateVideoTime();
  const video = $('edVideo');
  if (state.previewStopAt == null) return;
  if (video.currentTime < state.previewStopAt - 0.04) return;

  const loop = $('previewLoop');
  if (loop && loop.checked && state.previewMode !== 'sequence') {
    const clip = selectedClip();
    if (clip) {
      try {
        video.currentTime = clip.in;
      } catch {
        /* ignore */
      }
      video.play().catch(() => {});
      return;
    }
  }

  if (state.previewMode === 'sequence') {
    video.pause();
    state.previewIndex += 1;
    if (state.previewIndex >= state.clips.length) {
      stopPreview(false);
      $('edSelection').textContent = 'End of timeline';
      toast('Anteprima completata');
      return;
    }
    startSequenceClip();
    return;
  }

  state.previewStopAt = null;
  video.pause();
  video.playbackRate = 1;
}

function playSelection() {
  const clip = selectedClip();
  if (!clip) {
    toast('Select a clip', 'err');
    return;
  }
  stopMusicPreview();
  state.previewMode = 'clip';
  state.previewIndex = -1;
  const play = $('btnPreviewPlay');
  if (play) play.classList.remove('playing');
  const video = $('edVideo');
  video.playbackRate = clamp(clip.speed || 1, 0.5, 2);
  if (
    video.dataset.clipId === clip.id &&
    video.readyState >= 1 &&
    Number.isFinite(video.currentTime) &&
    video.currentTime >= clip.in + 0.01 &&
    video.currentTime < clip.out - 0.06
  ) {
    // Riprendi dal cursore: è il gesto più frequente mentre si monta.
  } else {
    video.currentTime = clip.in;
  }
  state.previewStopAt = clip.out;
  updatePreviewInfo(clip);
  video.play().catch(() => {
    toast('Preview not available for this format', 'err');
    state.previewStopAt = null;
  });
}

function togglePreviewPlayback() {
  const video = $('edVideo');
  const clip = selectedClip();
  if (!clip) {
    playSequence();
    return;
  }
  if (state.previewMode === 'sequence' && !video.paused) {
    stopPreview();
    return;
  }
  if (!video.paused) {
    stopPreview(false);
    return;
  }
  playSelection();
}

function selectTool(name) {
  if (!TOOL_NAMES.includes(name)) name = 'trim';
  state.tool = name;
  document.querySelectorAll('#editorTools .tool-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === name);
  });
  document.querySelectorAll('#toolPanel .tool-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.panel === name);
  });
  if (name === 'inspect') renderInspector();
  refreshInspectorValues();
}

function updateClipEffects() {
  const clip = selectedClip();
  refreshInspectorValues();
  if (clip) syncTimelineClip(clip);
}

function onInspectorInput(event) {
  const clip = selectedClip();
  if (!clip) return;
  const target = event.target;
  const id = target.id;

  if (id === 'clipIn') {
    pushHistoryThrottled(`in:${clip.id}`);
    clip.in = clamp(numberOr(target.value, 0), 0, Math.max(0, clip.out - 0.05));
    refreshInspectorValues();
    if ($('edVideo').dataset.clipId === clip.id) {
      $('edVideo').currentTime = clip.in;
    }
    return;
  }
  if (id === 'clipOut') {
    pushHistoryThrottled(`out:${clip.id}`);
    clip.out = clamp(numberOr(target.value, clip.out), clip.in + 0.05, clip.duration);
    refreshInspectorValues();
    return;
  }
  if (id === 'clipVolume') {
    pushHistoryThrottled(`volume:${clip.id}`);
    clip.volume = clamp(numberOr(target.value, 100) / 100, 0, 2);
    $('clipVolumeValue').textContent = `${target.value}%`;
    const video = $('edVideo');
    video.volume = clip.mute ? 0 : Math.min(1, clip.volume);
    syncTimelineClip(clip);
    return;
  }
  if (id === 'clipSpeed') {
    pushHistoryThrottled(`speed:${clip.id}`);
    clip.speed = clamp(numberOr(target.value, 1) || 1, 0.5, 2);
    refreshInspectorValues();
    const video = $('edVideo');
    video.playbackRate = clip.speed;
    updatePreviewInfo(clip);
    return;
  }
  if (id === 'clipZoom') {
    pushHistoryThrottled(`zoom:${clip.id}`);
    clip.zoom = clamp(numberOr(target.value, 100) / 100, 0.2, 3);
    updateClipEffects();
    return;
  }
  if (id === 'colorBrightness' || id === 'colorContrast' || id === 'colorSaturation' || id === 'colorGamma' || id === 'colorTemperature') {
    pushHistoryThrottled(`color:${clip.id}`);
    const color = clipColor(clip);
    const field = id.replace('color', '').toLowerCase();
    color[field] = numberOr(target.value, color[field]);
    clip.color = color;
    updateClipEffects();
  }
}

function onInspectorChange(event) {
  const clip = selectedClip();
  if (!clip) return;
  const target = event.target;
  const id = target.id;

  if (id === 'clipInNum') {
    pushHistory();
    clip.in = clamp(numberOr(target.value, 0), 0, Math.max(0, clip.out - 0.05));
    renderTimeline();
    refreshInspectorValues();
    return;
  }
  if (id === 'clipOutNum') {
    pushHistory();
    clip.out = clamp(numberOr(target.value, clip.duration), clip.in + 0.05, clip.duration);
    renderTimeline();
    refreshInspectorValues();
    return;
  }
  if (id === 'clipIn' || id === 'clipOut' || id === 'clipVolume' || id === 'clipSpeed' || id === 'clipZoom') {
    renderTimeline();
    refreshInspectorValues();
    return;
  }
  if (id === 'clipFadeIn') {
    pushHistory();
    clip.fadeIn = clamp(numberOr(target.value, 0), 0, (clip.out - clip.in) / 2);
    target.value = String(Number(clip.fadeIn.toFixed(2)));
    return;
  }
  if (id === 'clipFadeOut') {
    pushHistory();
    clip.fadeOut = clamp(numberOr(target.value, 0), 0, (clip.out - clip.in) / 2);
    target.value = String(Number(clip.fadeOut.toFixed(2)));
    return;
  }
  if (id === 'clipMute') {
    pushHistory();
    clip.mute = target.checked;
    $('edVideo').volume = clip.mute ? 0 : Math.min(1, clip.volume);
    const volume = $('clipVolume');
    if (volume) volume.disabled = clip.mute;
    syncTimelineClip(clip);
    return;
  }
  if (id === 'flipH' || id === 'flipV') {
    pushHistory();
    clip[id] = target.checked;
    updateClipEffects();
    return;
  }
  if (id === 'colorBrightness' || id === 'colorContrast' || id === 'colorSaturation' || id === 'colorGamma' || id === 'colorTemperature') {
    pushHistoryThrottled(`color:${clip.id}`);
    const color = clipColor(clip);
    const field = id.replace('color', '').toLowerCase();
    color[field] = numberOr(target.value, color[field]);
    clip.color = color;
    updateClipEffects();
  }
}

function seekToBoundary(which) {
  const clip = selectedClip();
  if (!clip) return;
  const video = $('edVideo');
  if (video.dataset.clipId !== clip.id) loadPreview();
  const time = which === 'in' ? clip.in : clip.out;
  try {
    video.currentTime = Math.max(0, time - (which === 'out' ? 0.04 : 0));
  } catch {
    /* ignore */
  }
  updateVideoTime();
}

function onInspectorClick(event) {
  const clip = selectedClip();
  if (!clip) return;

  const trimButton = event.target.closest('[data-trim]');
  if (trimButton) {
    const action = trimButton.dataset.trim;
    if (action === 'split') {
      splitSelectedClip();
      return;
    }
    if (action === 'goto-in' || action === 'goto-out') {
      seekToBoundary(action === 'goto-in' ? 'in' : 'out');
      return;
    }
    pushHistory();
    if (action === 'reset') {
      clip.in = 0;
      clip.out = clip.duration;
    } else {
      const video = $('edVideo');
      if (video.dataset.clipId !== clip.id || !Number.isFinite(video.currentTime)) {
        toast('Load the clip in the player to use the playhead', 'err');
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

  const rotateButton = event.target.closest('[data-rotate]');
  if (rotateButton) {
    pushHistory();
    const mode = rotateButton.dataset.rotate;
    const current = numberOr(clip.rotate, 0);
    if (mode === 'left') clip.rotate = (current + 270) % 360;
    else if (mode === 'right') clip.rotate = (current + 90) % 360;
    else if (mode === '180') clip.rotate = (current + 180) % 360;
    else {
      clip.rotate = 0;
      clip.flipH = false;
      clip.flipV = false;
    }
    updateClipEffects();
    return;
  }

  const colorButton = event.target.closest('[data-color-preset]');
  if (colorButton) {
    pushHistory();
    const name = colorButton.dataset.colorPreset;
    const preset = COLOR_PRESETS[name] || COLOR_DEFAULTS;
    clip.color = { ...preset };
    updateClipEffects();
    return;
  }

  const speedButton = event.target.closest('[data-speed]');
  if (speedButton) {
    pushHistory();
    clip.speed = clamp(numberOr(speedButton.dataset.speed, 1) || 1, 0.5, 2);
    $('edVideo').playbackRate = clip.speed;
    updatePreviewInfo(clip);
    updateClipEffects();
    return;
  }

  const zoomButton = event.target.closest('[data-zoom]');
  if (zoomButton) {
    pushHistory();
    clip.zoom = clamp(numberOr(zoomButton.dataset.zoom, 1) || 1, 0.2, 3);
    updateClipEffects();
  }
}

async function captureSnapshot() {
  const clip = selectedClip();
  if (!clip) {
    toast('Select a video clip', 'err');
    return;
  }
  if (!clip.hasVideo) {
    toast('This clip has no video', 'err');
    return;
  }
  const video = $('edVideo');
  if (video.dataset.clipId !== clip.id || !video.videoWidth) {
    toast('Wait for the frame to load', 'err');
    return;
  }
  if (video.readyState < 2) {
    await new Promise((resolve) => {
      let timer = null;
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', done);
        video.removeEventListener('loadeddata', done);
        resolve();
      };
      timer = setTimeout(done, 1500);
      video.addEventListener('seeked', done);
      video.addEventListener('loadeddata', done);
    });
  }
  if (video.readyState < 2) {
    toast('Wait for the frame to load', 'err');
    return;
  }

  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const rotate = ((Math.round(numberOr(clip.rotate, 0)) % 360) + 360) % 360;
    const swapped = rotate === 90 || rotate === 270;
    const canvas = document.createElement('canvas');
    canvas.width = swapped ? height : width;
    canvas.height = swapped ? width : height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas not available');

    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotate * Math.PI) / 180);
    const color = clipColor(clip);
    context.filter = colorFilterCss(color) === 'none' ? 'none' : colorFilterCss(color);
    const zoom = clamp(numberOr(clip.zoom, 1) || 1, 0.2, 3);
    context.scale((clip.flipH ? -1 : 1) * zoom, (clip.flipV ? -1 : 1) * zoom);
    context.drawImage(video, -width / 2, -height / 2, width, height);
    context.restore();

    const dataUrl = canvas.toDataURL('image/png');
    const base = clip.name.replace(/\.[^.]+$/, '') || 'frame';
    const stamp = fmtTime(video.currentTime).replace(/[:.]/g, '-');
    const result = await api.saveSnapshot({ dataUrl, name: `${base}-${stamp}` });
    if (!result || !result.ok) throw new Error('Save failed');
    state.snapshotPath = result.path;
    state.snapshotDir = result.dir || '';
    state.snapshotName = result.name;
    $('snapshotStatus').textContent = `Saved: ${result.path}`;
    $('snapshotResult').hidden = false;
    toast('Frame saved');
  } catch (error) {
    $('snapshotStatus').textContent = `Snapshot failed: ${errorMessage(error)}`;
    toast(errorMessage(error), 'err');
  }
}


function removeSelectedClip() {
  if (!state.clips.length) return;
  const index = state.clips.findIndex((clip) => clip.id === state.selectedId);
  if (index < 0) return;
  pushHistory();
  state.clips.splice(index, 1);
  const next = state.clips[Math.min(index, state.clips.length - 1)];
  state.selectedId = next ? next.id : null;
  renderEditor();
  loadPreview();
}

function clearProject() {
  if (!state.clips.length && !state.music) return;
  if (!window.confirm('Clear the timeline? Imported clips will not be deleted from disk.')) return;
  pushHistory();
  stopPreview();
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
  $('exportStatus').textContent = 'Ready to export.';
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
  event.stopPropagation();
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
  pushHistory();
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
    if (!info.hasAudio) throw new Error('The file has no audio');
    pushHistory();
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
    toast('Music track added');
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
    toast('Add at least one clip to the timeline', 'err');
    return;
  }

  const format = $('exportFormat').value;
  const project = {
    name: $('projectName').value.trim() || 'Timeline',
    clips: state.clips.map((clip) => ({
      path: clip.path,
      in: clip.in,
      out: clip.out,
      volume: clip.volume,
      mute: clip.mute,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      speed: clip.speed,
      rotate: Number(clip.rotate) || 0,
      flipH: Boolean(clip.flipH),
      flipV: Boolean(clip.flipV),
      zoom: Number(clip.zoom) || 1,
      color: {
        brightness: clipColor(clip).brightness / 100,
        contrast: clipColor(clip).contrast / 100,
        saturation: clipColor(clip).saturation / 100,
        gamma: clipColor(clip).gamma / 100,
        temperature: clipColor(clip).temperature,
      },
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
  $('exportStatus').textContent = 'Preparing the timeline...';
  setExportBusy(true);

  try {
    const result = await api.exportProject(project);
    if (result.canceled) {
      $('exportStatus').textContent = 'Export cancelled.';
      $('exportBar').style.width = '0%';
    } else if (result.ok) {
      state.lastExport = result.path;
      $('exportBar').style.width = '100%';
      $('exportStatus').textContent = `Exported: ${result.name} (${fmtBytes(result.size)})`;
      $('exportResult').hidden = false;
      toast('Timeline exported');
    }
  } catch (error) {
    const message = errorMessage(error);
    if (/annullata/i.test(message)) {
      $('exportStatus').textContent = 'Export cancelled.';
      $('exportBar').style.width = '0%';
    } else {
      $('exportStatus').textContent = `Error: ${message}`;
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
  $('btnExport').textContent = busy ? 'Exporting...' : 'Export timeline';
  $('btnCancelExport').hidden = !busy;
}

async function cancelExport() {
  if (!state.exporting) return;
  $('exportStatus').textContent = 'Cancelling...';
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
  $('exportStatus').textContent = `Exporting ${percent.toFixed(0)}% · ${fmtTime(progress.seconds || 0)} / ${fmtTime(progress.total || 0)}`;
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
        { value: '0', label: '0 · maximum quality' }, { value: '2', label: '2 · balanced' },
        { value: '4', label: '4' }, { value: '6', label: '6 · fast' }, { value: '8', label: '8 · maximum speed' },
      ],
      tunes: [], profiles: ['auto', '0', '1', '2', '3'],
      quality: { min: 0, max: 63, step: 1, default: 32, label: 'CRF' }, twoPass: false,
      customParam: null, pixelFormats: ['auto', 'yuv420p', 'yuv420p10le'],
    },
    {
      id: 'libaom-av1', label: 'AV1 · libaom (software, lento)', short: 'AV1 libaom', family: 'aom', codec: 'av1',
      hardware: false, containers: ['mp4', 'mkv', 'webm'], defaultPreset: '6',
      presets: [
        { value: '0', label: '0 · maximum quality' }, { value: '4', label: '4' },
        { value: '6', label: '6 · balanced' }, { value: '8', label: '8 · maximum speed' },
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
    name.textContent = 'No video selected';
    meta.textContent = 'Choose a file or drop it here to start';
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
    select.innerHTML = '<option value="0">Main</option>';
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
    select.innerHTML = '<option value="">No encoder</option>';
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
      const suffix = available ? '' : ' · not available';
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
    note.textContent = `Forced rendering on ${gpu ? gpu.name : 'GPU'} · ${encoder.short}. No automatic software fallback.`;
    note.className = 'encoder-note hw';
  } else {
    note.textContent = `Encoding on CPU (${encoder.short}). If you enable "Force GPU", the best available hardware encoder is used.`;
    note.className = 'encoder-note';
  }

  const hwToggle = $('compressHwAccel');
  if (hwToggle) {
    hwToggle.disabled = !encoder.hardware;
    hwToggle.title = encoder.hardware
      ? 'Hardware decoding (NVDEC/D3D11VA) with automatic software fallback if the format is unsupported.'
      : 'Only available with a GPU encoder.';
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
  $('compressQualityField').hidden = mode !== 'quality';
  $('compressRateFields').hidden = !['bitrate', 'cbr', 'twopass'].includes(mode);
  $('compressTargetFields').hidden = mode !== 'target';
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
  if (!hasAudio) hint.textContent = 'The video has no audio: the output will be silent.';
  else if (merge) {
    hint.textContent = `${state.compressAudioSelected.size} selected tracks will be merged into one track. Adjust the volume next to each track.`;
  } else if (passthrough) {
    hint.textContent = `${state.compressAudioSelected.size} tracks kept without re-encoding.`;
  } else {
    hint.textContent = `${state.compressAudioSelected.size} tracks re-encoded to ${codec.toUpperCase()}.`;
  }
  if ($('compressLoudnorm') && $('compressLoudnorm').checked) {
    hint.textContent += ' Volume normalized to −16 LUFS.';
  }
}

function renderCompressAudioTracks() {
  const container = $('compressAudioTracks');
  const source = state.compressSource;
  if (!source || !source.audioTracks.length) {
    container.innerHTML = '<div class="muted">No audio tracks.</div>';
    return;
  }
  const merge = $('compressMerge').checked;
  container.innerHTML = source.audioTracks
    .map((track) => {
      const selected = state.compressAudioSelected.has(track.index);
      const gain = state.compressGains[track.index] == null ? 100 : Math.round(state.compressGains[track.index] * 100);
      const title = track.title || `Track ${track.order + 1}`;
      const meta = [
        track.codec.toUpperCase(),
        `${track.channels} channels`,
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
    container.innerHTML = '<div class="muted">No subtitle tracks.</div>';
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
          <div class="track-title">${esc(track.title || `Subtitles ${track.order + 1}`)}</div>
          <div class="track-meta">${esc(meta)}</div>
        </div>
        ${compatible ? '' : `<span class="track-badge warn">no ${esc(targetContainer.toUpperCase())}</span>`}
      </label>`;
    })
    .join('');
}

function renderBurnSubtitleSelect() {
  const select = $('compressBurnTrack');
  if (!select) return;
  const source = state.compressSource;
  const tracks = source ? source.subtitleTracks.filter((track) => track.text) : [];
  const previous = select.value;
  if (!tracks.length) {
    select.innerHTML = '<option value="">No text subtitles</option>';
    select.disabled = true;
    if ($('compressBurnSubs').checked) {
      $('compressBurnSubs').checked = false;
      $('compressBurnTrackField').hidden = true;
    }
    return;
  }
  select.disabled = false;
  select.innerHTML = tracks
    .map(
      (track) =>
        `<option value="${track.index}">${esc(track.title || `Subtitles ${track.order + 1}`)}${track.language ? ` · ${esc(track.language)}` : ''}</option>`,
    )
    .join('');
  if (tracks.some((track) => String(track.index) === previous)) select.value = previous;
  else {
    const preferred = tracks.find((track) => state.compressSubtitleSelected.has(track.index)) || tracks[0];
    select.value = String(preferred.index);
  }
  $('compressBurnTrackField').hidden = !$('compressBurnSubs').checked;
}

function renderCompressTracks() {
  renderCompressAudioTracks();
  renderCompressSubtitleTracks();
  renderBurnSubtitleSelect();
  populateCompressAudioCodecs();
  const container = compressContainer();
  const hint = $('compressSubtitleHint');
  hint.textContent =
    container === 'mkv'
      ? 'In MKV, subtitles are copied in full, including bitmap subtitles (PGS/DVD).'
      : 'In ' +
        container.toUpperCase() +
        ' only text subtitles are converted; bitmap subtitles are available only in MKV.';
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
    status.textContent = 'Testing hardware encoders (NVENC, Quick Sync, AMF, VideoToolbox)...';
    list.innerHTML = '';
    hint.textContent = 'Checking which encoders actually initialize on this machine.';
    force.disabled = true;
    return;
  }

  if (state.compressScanError) {
    status.className = 'gpu-scan-status warn';
    status.textContent = `Scan failed: ${state.compressScanError}`;
    list.innerHTML = '';
    hint.textContent = 'You can still compress with software encoders.';
    force.disabled = true;
    force.checked = false;
    return;
  }

  if (!system) {
    status.className = 'gpu-scan-status';
    status.textContent = 'No scan yet.';
    list.innerHTML = '';
    hint.textContent = 'Press "Scan" to detect GPUs and hardware encoders.';
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
      : '<div class="gpu-item"><div class="gpu-name">No GPU detected</div></div>') +
    `<div class="gpu-chips">${workingChips.join('')}${failedChips.length && !workingChips.length ? failedChips.join('') : ''}</div>`;

  if (!gpus.length) {
    status.className = 'gpu-scan-status warn';
    status.textContent = 'No GPU detected: the software encoder will be used.';
  } else if (available) {
    status.className = 'gpu-scan-status ok';
    status.textContent = `${working.size} encoder hardware pronti: ${(system.working || []).join(', ')}`;
  } else {
    status.className = 'gpu-scan-status warn';
    status.textContent = 'GPU found, but no hardware encoder can initialize. Update the drivers or use software.';
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
    hint.textContent = 'Software rendering: choose a GPU encoder or enable "Force GPU".';
  }
}

function updateCompressSummary() {
  const box = $('compressSummary');
  if (!box || !state.compressCatalog) return;
  const encoder = currentCompressEncoder();
  if (!encoder) {
    box.innerHTML = '<div class="muted">No encoder available.</div>';
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
  rows.push(row('Container', container.toUpperCase()));
  if (mode === 'quality') rows.push(row('Quality', `${encoder.quality.label} ${quality}`));
  else if (mode === 'twopass') rows.push(row('Bitrate', `${bitrate} kbps · 2 passate`));
  else if (mode === 'target') {
    rows.push(row('Size', `${Math.round(Number($('compressTarget').value) || 0)} MB target`));
  } else rows.push(row('Bitrate', `${bitrate} kbps · ${mode.toUpperCase()}`));
  if ($('compressPreset').value) rows.push(row('Preset', $('compressPreset').value));

  const resolution = $('compressResolution').value;
  const resolutionLabel =
    resolution === 'source'
      ? source && source.videoTracks[0]
        ? `Original ${source.videoTracks[0].width}×${source.videoTracks[0].height}`
        : 'Original'
      : resolution === 'custom'
        ? `${$('compressWidth').value || 'auto'}×${$('compressHeight').value || 'auto'}`
        : resolution;
  rows.push(row('Resolution', resolutionLabel));
  rows.push(row('FPS', $('compressFps').value === 'source' ? 'Original' : $('compressFps').value));
  rows.push(
    row(
      'Audio',
      source && source.audioTracks.length
        ? merge
          ? `Mix of ${audioCount} tracks · ${audioCodec.toUpperCase()}`
          : `${audioCount} tracks · ${audioCodec === 'copy' ? 'copy' : audioCodec.toUpperCase()}`
        : 'No audio',
    ),
  );
  rows.push(
    row(
      'Subtitles',
      source && source.subtitleTracks.length ? `${state.compressSubtitleSelected.size} tracks` : 'None',
    ),
  );
  const output = $('compressOutput').value.trim();
  rows.push(row('Output', output ? output.split(/[\\/]/).pop() : 'chosen on save'));

  const planEstimate = estimateCompressPlan();
  if (planEstimate && planEstimate.range.trimmed) {
    rows.push(row('Trim', `${fmtTime(planEstimate.range.start)} → ${fmtTime(planEstimate.range.end)}`));
  }
  if (planEstimate) rows.push(row('Video', `${Math.round(planEstimate.videoKbps)} kbps`));
  if ($('compressLoudnorm') && $('compressLoudnorm').checked) rows.push(row('Volume', 'loudnorm −16 LUFS'));
  if (planEstimate && planEstimate.burned) rows.push(row('Subtitles', 'burned into the video'));
  if (planEstimate) rows.push(row('Estimate', `~${fmtBytes(planEstimate.bytes)}`));
  if (state.compressBusy) rows.push(row('Stato', `${Math.round(state.compressPercent)}%`));
  box.innerHTML = rows.join('');
  updateCompressEstimate();
}

/* ---------------------------- stima del risultato ---------------------------- */

/**
 * Bit per pixel per frame a qualità di riferimento (CRF/CQ 23) e 30 fps.
 * Valori medi su contenuti reali: servono a stimare il peso senza dover
 * codificare il video. Ogni 6 punti di CRF il bitrate raddoppia/dimezza.
 */
const COMPRESS_BPP_BASE = {
  x264: 0.07,
  x265: 0.045,
  aom: 0.038,
  vp9: 0.05,
  nvenc: { h264: 0.08, hevc: 0.05, av1: 0.042 },
  qsv: { h264: 0.078, hevc: 0.052, av1: 0.044 },
  amf: { h264: 0.082, hevc: 0.055, av1: 0.046 },
  videotoolbox: { h264: 0.085, hevc: 0.058 },
};

const COMPRESS_RESOLUTIONS = {
  '2160p': 2160,
  '1440p': 1440,
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
  '360p': 360,
};

function compressSourceVideo() {
  const source = state.compressSource;
  if (!source || !source.videoTracks.length) return null;
  const select = $('compressVideoTrack');
  const index = select ? Number(select.value) : source.videoTracks[0].index;
  return source.videoTracks.find((track) => track.index === index) || source.videoTracks[0];
}

function compressRange() {
  const source = state.compressSource;
  if (!source) return { start: 0, end: 0, duration: 0, total: 0, trimmed: false };
  const total = Math.max(0, Number(source.duration) || 0);
  const startInput = $('compressStart');
  const endInput = $('compressEnd');
  const start = clamp(Number(startInput && startInput.value) || 0, 0, Math.max(0, total - 0.1));
  const rawEnd = Number(endInput && endInput.value) || 0;
  const end = rawEnd > 0 ? clamp(rawEnd, start + 0.1, total) : total;
  return {
    start,
    end,
    duration: Math.max(0, end - start),
    total,
    trimmed: start > 0.05 || end < total - 0.05,
  };
}

function compressGeometry(video) {
  const srcW = Math.max(2, Math.round(Number(video.width) || 0));
  const srcH = Math.max(2, Math.round(Number(video.height) || 0));
  const srcFps = Number(video.fps) || 30;
  const crop = {
    top: Math.max(0, Math.round(Number($('compressCropTop').value) || 0)),
    bottom: Math.max(0, Math.round(Number($('compressCropBottom').value) || 0)),
    left: Math.max(0, Math.round(Number($('compressCropLeft').value) || 0)),
    right: Math.max(0, Math.round(Number($('compressCropRight').value) || 0)),
  };
  const croppedW = Math.max(2, srcW - crop.left - crop.right);
  const croppedH = Math.max(2, srcH - crop.top - crop.bottom);
  let width = croppedW;
  let height = croppedH;
  const resolution = $('compressResolution').value;
  const noUpscale = $('compressNoUpscale').checked;

  if (resolution === 'custom') {
    const wantedW = Math.round(Number($('compressWidth').value) || 0);
    const wantedH = Math.round(Number($('compressHeight').value) || 0);
    if (wantedW > 0 || wantedH > 0) {
      let scale = wantedW > 0 && wantedH > 0 ? Math.min(wantedW / croppedW, wantedH / croppedH) : wantedW > 0 ? wantedW / croppedW : wantedH / croppedH;
      if (noUpscale) scale = Math.min(1, scale);
      width = Math.max(2, Math.round((croppedW * scale) / 2) * 2);
      height = Math.max(2, Math.round((croppedH * scale) / 2) * 2);
    }
  } else if (COMPRESS_RESOLUTIONS[resolution]) {
    const target = COMPRESS_RESOLUTIONS[resolution];
    if (target < croppedH || !noUpscale) {
      const scale = target / croppedH;
      width = Math.max(2, Math.round((croppedW * scale) / 2) * 2);
      height = Math.max(2, Math.round((croppedH * scale) / 2) * 2);
    }
  }

  const fpsValue = $('compressFps').value;
  const fps = fpsValue === 'source' ? srcFps : Number(fpsValue) || srcFps;
  return {
    srcW,
    srcH,
    srcFps,
    width,
    height,
    fps,
    crop,
    cropped: crop.top + crop.bottom + crop.left + crop.right > 0,
    scaled: width !== srcW || height !== srcH,
  };
}

function encoderBitsPerPixel(encoder) {
  if (!encoder) return 0.06;
  const table = COMPRESS_BPP_BASE[encoder.family];
  if (typeof table === 'number') return table;
  if (table && table[encoder.codec]) return table[encoder.codec];
  return 0.06;
}

function normalizeEncoderQuality(encoder, quality) {
  if (!encoder) return quality;
  if (encoder.family === 'videotoolbox') return 26.5 + (65 - quality) * 0.32;
  if (encoder.family === 'vp9' || encoder.family === 'aom') return quality * (51 / 63);
  return quality;
}

function compressBurnTrack() {
  const source = state.compressSource;
  const select = $('compressBurnTrack');
  if (!source || !select || $('compressBurnSubs').hidden) return null;
  if (!$('compressBurnSubs').checked) return null;
  const index = Number(select.value);
  return source.subtitleTracks.find((track) => track.index === index) || null;
}

function estimateCompressPlan() {
  const source = state.compressSource;
  if (!source || !state.compressCatalog) return null;
  const encoder = currentCompressEncoder();
  const video = compressSourceVideo();
  if (!encoder || !video || !video.width || !video.height) return null;

  const range = compressRange();
  const duration = range.duration || Number(source.duration) || 0;
  if (!duration) return null;
  const geometry = compressGeometry(video);
  const mode = $('compressQualityMode').value;
  const merge = $('compressMerge').checked;
  const codec = $('compressAudioCodec').value || 'copy';
  const selectedTracks = source.audioTracks.filter((track) => state.compressAudioSelected.has(track.index));
  const trackCount = merge && selectedTracks.length ? 1 : selectedTracks.length;
  const trackKbps = (track) => (Number(track.bitrate) ? Number(track.bitrate) / 1000 : 160);

  let audioKbps = 0;
  if (selectedTracks.length) {
    if (codec === 'copy') {
      audioKbps = merge
        ? Math.max(...selectedTracks.map(trackKbps))
        : selectedTracks.reduce((sum, track) => sum + trackKbps(track), 0);
    } else if (codec === 'flac') {
      audioKbps = 700 * trackCount;
    } else {
      audioKbps = (Number($('compressAudioBitrate').value) || 128) * trackCount;
    }
  }

  let videoKbps = 0;
  let qualityFactor = 1;
  let sourceKbps = 0;
  let targetMB = null;

  if (mode === 'bitrate' || mode === 'cbr' || mode === 'twopass') {
    videoKbps = Math.max(50, Math.round(Number($('compressBitrate').value) || 0));
  } else if (mode === 'target') {
    targetMB = Math.max(1, Number($('compressTarget').value) || 1);
    videoKbps = Math.max(50, Math.round((targetMB * 8 * 1024) / duration - audioKbps));
  } else {
    const sourceAudioKbps = source.audioTracks.reduce((sum, track) => sum + trackKbps(track), 0);
    sourceKbps = Number(video.bitrate) ? Number(video.bitrate) / 1000 : 0;
    if (!sourceKbps) {
      const totalKbps = Number(source.bitrate)
        ? Number(source.bitrate) / 1000
        : (Number(source.size) * 8) / 1000 / Math.max(1, Number(source.duration) || duration);
      sourceKbps = Math.max(150, totalKbps - sourceAudioKbps);
    }
    const quality = Math.round(Number($('compressQuality').value) || encoder.quality.default);
    const normalized = normalizeEncoderQuality(encoder, quality);
    qualityFactor = Math.pow(2, (23 - normalized) / 6);
    const pixelRatio = clamp((geometry.width * geometry.height) / (geometry.srcW * geometry.srcH), 0.01, 4);
    const fpsRatio = clamp(geometry.fps / geometry.srcFps, 0.1, 4);
    let filterFactor = 1;
    if ($('compressDenoise').value === 'light') filterFactor *= 0.9;
    else if ($('compressDenoise').value === 'medium') filterFactor *= 0.8;
    else if ($('compressDenoise').value === 'strong') filterFactor *= 0.68;
    if ($('compressSharpen').value === 'light') filterFactor *= 1.05;
    else if ($('compressSharpen').value === 'strong') filterFactor *= 1.1;
    if ($('compressDeinterlace').value === 'force') filterFactor *= 1.08;

    // Modello assoluto: bpp attesi per quell'encoder a quella qualità.
    videoKbps = Math.round(
      encoderBitsPerPixel(encoder) *
        geometry.width *
        geometry.height *
        geometry.fps *
        qualityFactor *
        filterFactor /
        1000,
    );
    // Se non stiamo ingrandendo, ricodificare non può inventare dettaglio:
    // evito stime molto sopra il bitrate della sorgente.
    if (pixelRatio <= 1.02 && fpsRatio <= 1.02) {
      videoKbps = Math.min(videoKbps, Math.max(150, Math.round(sourceKbps * 1.5)));
    }
    videoKbps = clamp(videoKbps, 120, 120000);
  }

  const container = compressContainer();
  const overhead = container === 'mkv' ? 1.012 : container === 'webm' ? 1.006 : 1.01;
  let bytes = ((videoKbps + audioKbps) * 1000 * duration * overhead) / 8;

  const burn = compressBurnTrack();
  const subtitleCount = source.subtitleTracks.filter((track) => {
    if (!state.compressSubtitleSelected.has(track.index)) return false;
    if (burn && track.index === burn.index) return false;
    return container === 'mkv' || COMPRESS_TEXT_SUBS.has(track.codec);
  }).length;
  if (subtitleCount) bytes += subtitleCount * 40 * 1024;

  return {
    bytes: Math.max(1024, Math.round(bytes)),
    videoKbps,
    audioKbps,
    duration,
    geometry,
    mode,
    range,
    encoder,
    container,
    sourceKbps,
    qualityFactor,
    targetMB,
    subtitleCount,
    burned: Boolean(burn),
  };
}

function estimateCompressSize() {
  const estimate = estimateCompressPlan();
  return estimate ? estimate.bytes : null;
}

function estimateSizeHtml(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}<span class="estimate-unit">GB</span>`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}<span class="estimate-unit">MB</span>`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))}<span class="estimate-unit">KB</span>`;
}

function updateCompressEstimate() {
  const size = $('compressEstimateSize');
  if (!size) return;
  const estimate = estimateCompressPlan();
  const sub = $('compressEstimateSub');
  const details = $('compressEstimateDetails');
  const fill = $('compressEstimateFill');
  const badge = $('compressEstimateBadge');
  const note = $('compressEstimateNote');

  if (!estimate) {
    size.textContent = '—';
    sub.textContent = state.compressSource ? 'Complete the settings to see the estimate.' : 'Choose a video to see the estimate.';
    details.innerHTML = '';
    if (fill) fill.style.width = '0%';
    if (badge) badge.textContent = 'auto';
    if (note) note.textContent = 'The estimate updates with every change and is approximate (±15%).';
    return;
  }

  const source = state.compressSource;
  const original = Number(source.size) || 0;
  size.innerHTML = estimateSizeHtml(estimate.bytes);
  const percent = original ? (estimate.bytes / original) * 100 : 0;
  const delta = original ? 1 - estimate.bytes / original : null;
  const deltaLabel = delta == null ? '' : ` · ${delta >= 0 ? '−' : '+'}${Math.abs(Math.round(delta * 100))}% vs original`;
  const rangeLabel = `${fmtBytes(estimate.bytes * 0.85)} – ${fmtBytes(estimate.bytes * 1.15)}`;
  sub.textContent = `${original ? `Original ${fmtBytes(original)}` : 'Original size unknown'}${deltaLabel} · range ${rangeLabel}`;

  const modeLabels = {
    quality: `${estimate.encoder.quality.label} ${$('compressQuality').value}`,
    bitrate: 'VBR',
    cbr: 'CBR',
    twopass: '2 passate',
    target: `${estimate.targetMB} MB target`,
  };
  const rows = [
    ['Video', `${Math.round(estimate.videoKbps / 100) / 10} Mbps`],
    ['Audio', estimate.audioKbps ? `${Math.round(estimate.audioKbps)} kbps` : 'none'],
    ['Duration', fmtTime(estimate.duration)],
    ['Resolution', `${estimate.geometry.width}×${estimate.geometry.height}`],
    ['FPS', estimate.geometry.fps ? estimate.geometry.fps.toFixed(2).replace(/\.00$/, '') : 'originale'],
    ['Controllo', modeLabels[estimate.mode] || estimate.mode],
  ];
  details.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="estimate-row"><span class="estimate-label">${esc(label)}</span><span class="estimate-value">${esc(value)}</span></div>`,
    )
    .join('');
  if (fill) fill.style.width = `${clamp(percent, 1, 100).toFixed(1)}%`;
  if (badge) badge.textContent = percent ? `${Math.round(percent)}%` : 'estimate';
  if (note) {
    if (estimate.mode === 'target') {
      note.textContent = `Video bitrate (${Math.round(estimate.videoKbps)} kbps) is calculated to fit within ${estimate.targetMB} MB${estimate.range.trimmed ? ' with the selected trim' : ''}.`;
    } else if (estimate.mode === 'quality') {
      note.textContent = `Estimate based on resolution, fps, and quality (source ${Math.round(estimate.sourceKbps)} kbps): typical error is ±15-20%.`;
    } else {
      note.textContent = 'With a fixed bitrate the size depends mostly on duration: the estimate is accurate within a few percent.';
    }
  }
  const targetNote = $('compressTargetNote');
  if (targetNote) {
    targetNote.textContent =
      estimate.mode === 'target'
        ? `Calculated video bitrate: ${Math.round(estimate.videoKbps)} kbps for ${estimate.targetMB} MB in ${fmtTime(estimate.duration)}.`
        : 'The video bitrate is calculated from the duration to fit the chosen size.';
  }
  const rangeNote = $('compressRangeNote');
  if (rangeNote) {
    rangeNote.textContent = estimate.range.trimmed
      ? `Compresso da ${fmtTime(estimate.range.start)} a ${fmtTime(estimate.range.end)} · ${fmtTime(estimate.range.duration)} su ${fmtTime(estimate.range.total)}.`
      : `No trim: the whole video is compressed (${fmtTime(estimate.range.total)}).`;
  }
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

function prefillCompressOutput() {
  const input = $('compressOutput');
  const dir = state.settings.compressDir;
  if (!input || !dir || !state.compressSource || input.value.trim()) return;
  const base = state.compressSource.name.replace(/\.[^.]+$/, '');
  const container = compressContainer();
  input.value = `${dir}/${base}-compresso.${container}`;
}

async function loadCompressSource(filePath) {
  if (!filePath) return;
  if (state.compressBusy) {
    toast('Wait for compression to finish', 'err');
    return;
  }
  try {
    const source = await api.probeCompress(filePath);
    if (!source || !source.hasVideo) throw new Error('The file has no video track');
    state.compressSource = source;
    state.compressAudioSelected = new Set(source.audioTracks.map((track) => track.index));
    state.compressSubtitleSelected = new Set(source.subtitleTracks.map((track) => track.index));
    state.compressGains = {};
    resetCompressForm();
    const duration = Math.max(0, Number(source.duration) || 0);
    $('compressStart').max = String(Math.max(0, duration - 0.1));
    $('compressEnd').max = String(duration);
    $('compressEnd').placeholder = `end of video (${fmtTime(duration)})`;
    renderCompressSource();
    applyCompressPreset('balanced');
    prefillCompressOutput();
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
  $('compressLoudnorm').checked = false;
  $('compressBurnSubs').checked = false;
  $('compressBurnTrackField').hidden = true;
  $('compressStart').value = '0';
  $('compressEnd').value = '0';
  $('compressTarget').value = '700';
  $('compressTargetPreset').value = '';
  $('compressOutput').value = '';
  toggleCompressCustomSize();
  updateCompressRateFields();
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
  $('compressStart').value = '0';
  $('compressEnd').value = '0';
  $('compressLoudnorm').checked = false;
  $('compressBurnSubs').checked = false;
  $('compressBurnTrackField').hidden = true;
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
  const range = compressRange();
  const burnTrack = compressBurnTrack();
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
    startTime: range.trimmed ? Number(range.start.toFixed(3)) : 0,
    endTime: range.trimmed ? Number(range.end.toFixed(3)) : 0,
    targetSizeMB: Math.max(1, Math.round(Number($('compressTarget').value) || 0)),
    audioLoudnorm: Boolean($('compressLoudnorm') && $('compressLoudnorm').checked),
    burnSubtitles: Boolean(burnTrack),
    burnSubtitleTrack: burnTrack ? burnTrack.index : -1,
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
  start.textContent = busy ? 'Compressing...' : 'Compress video';
  $('btnCancelCompress').hidden = !busy;
  $('compressOutput').disabled = busy;
}

async function startCompress() {
  if (state.compressBusy) return;
  if (!state.compressSource) {
    toast('Choose a video to compress first', 'err');
    return;
  }
  const encoder = currentCompressEncoder();
  if (!encoder) {
    toast('No encoder available', 'err');
    return;
  }
  if (encoder.hardware && !compressWorkingSet().has(encoder.id)) {
    toast('GPU encoder unavailable: run a new scan', 'err');
    return;
  }
  if ($('compressQualityMode').value === 'twopass' && !encoder.twoPass) {
    toast('This encoder does not support two-pass', 'err');
    return;
  }

  state.compressPercent = 0;
  state.lastCompress = null;
  $('compressBar').style.width = '0%';
  $('compressResult').hidden = true;
  $('compressResultText').hidden = true;
  $('compressStatus').textContent = 'Preparing compression...';
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
      $('compressStatus').textContent = 'Compression cancelled.';
    } else if (result && result.ok) {
      showCompressResult(result);
    }
  } catch (error) {
    const message = errorMessage(error);
    if (/annullata/i.test(message)) {
      $('compressBar').style.width = '0%';
      $('compressStatus').textContent = 'Compression cancelled.';
    } else {
      $('compressStatus').textContent = `Error: ${message}`;
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
  $('compressStatus').textContent = `Completed: ${result.name} (${fmtBytes(result.size)}${saved})`;
  const details = [
    `${result.hardware ? 'GPU' : 'CPU'} · ${encoderLabel}`,
    `decodifica ${result.hwaccel ? (result.hwaccelMode === 'cuda' ? 'GPU (CUDA)' : 'GPU') : 'software'}`,
    `duration ${fmtTime(result.duration)}`,
    `${result.audioTracks} audio${result.mergedAudio ? ' (mixed)' : ''} · ${result.subtitleTracks} subtitles`,
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
  $('compressStatus').textContent = 'Cancelling...';
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
  const parts = [`Compression ${state.compressPercent.toFixed(0)}%`];
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

async function detectCompressCrop() {
  const source = state.compressSource;
  if (!source) {
    toast('Choose a video first', 'err');
    return;
  }
  const button = $('btnDetectCrop');
  if (button) button.disabled = true;
  toast('Analyzing black bars...');
  try {
    const video = compressSourceVideo();
    const result = await api.detectCrop(
      source.path,
      source.duration,
      video ? video.width : 0,
      video ? video.height : 0,
    );
    const values = ['top', 'bottom', 'left', 'right'].map((side) =>
      Math.max(0, Math.round(Number(result && result[side]) || 0)),
    );
    $('compressCropTop').value = String(values[0]);
    $('compressCropBottom').value = String(values[1]);
    $('compressCropLeft').value = String(values[2]);
    $('compressCropRight').value = String(values[3]);
    markCompressCustom();
    updateCompressSummary();
    if (!values.some(Boolean)) {
      toast('No black bars detected');
    } else {
      toast(`Bande nere: ${values[2]}/${values[3]} laterali, ${values[0]}/${values[1]} verticali`);
    }
  } catch (error) {
    toast(errorMessage(error), 'err');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ============================== INFO ============================== */

const DEP_INFO = {
  ytdlp: { label: 'yt-dlp', description: 'link downloads' },
  ffmpeg: { label: 'FFmpeg', description: 'encoding and conversion' },
  ffprobe: { label: 'ffprobe', description: 'media analysis' },
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
  on('viewInfo', 'click', (event) => {
    const reset = event.target.closest('[data-reset-folder]');
    if (reset) {
      resetFolder(FOLDER_BY_KEY[reset.dataset.resetFolder]);
      return;
    }
    const button = event.target.closest('[data-set-folder]');
    if (button) pickFolder(FOLDER_BY_KEY[button.dataset.setFolder]);
  });
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
  renderDirs();
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
    box.innerHTML = `<div class="muted">${state.infoLoading ? 'Reading system information...' : 'Information not available.'}</div>`;
    return;
  }
  const system = info.system || {};
  const versions = info.versions || {};
  const paths = info.paths || {};
  const badge = $('infoAppBadge');
  if (badge) badge.textContent = `v${versions.app || '?'}`;

  const memory = (bytes) => (Number(bytes) ? fmtBytes(bytes) : 'n/a');
  const rows = [
    ['Application', `MoliDowloader ${versions.app || ''}`.trim()],
    ['System', `${system.type || system.platform || ''} ${system.release || ''} · ${system.arch || ''}`.trim()],
    ['CPU', `${system.cpuModel || 'n/a'} · ${system.cpuCores || 0} thread`],
    ['RAM', `${memory(system.totalMemory)} total · ${memory(system.freeMemory)} free`],
    ['Uptime', fmtUptime(system.uptime || 0)],
    ['Electron', versions.electron || 'n/a'],
    ['Chromium', versions.chrome || 'n/a'],
    ['Node', versions.node || 'n/a'],
    ['Data folder', paths.userData || 'n/a'],
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
        ? shortVersion(entry.version) || 'unknown version'
        : 'not installed';
      const source = entry.path ? (entry.source === 'system' ? 'system' : 'bundled') : '';
      const meta = [info.description, version, source, entry.path || ''].filter(Boolean).join(' · ');
      const action = `<button class="btn-sm" data-dep-action="${key}" ${downloading ? 'disabled' : ''}>${
        entry.path ? 'Update' : 'Download'
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
      status.textContent = state.depsMessage || 'yt-dlp, FFmpeg, and ffprobe are checked at startup.';
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
    status.textContent = 'Testing hardware encoders...';
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }
  if (state.compressScanError) {
    status.className = 'gpu-scan-status warn';
    status.textContent = `Scan failed: ${state.compressScanError}`;
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }
  const system = state.compressSystem;
  if (!system) {
    status.className = 'gpu-scan-status';
    status.textContent = 'No scan yet.';
    list.innerHTML = '';
    chips.innerHTML = '';
    return;
  }

  const gpus = system.gpus || [];
  const working = system.working || [];
  status.className = `gpu-scan-status ${gpus.length ? 'ok' : 'warn'}`;
  status.textContent = gpus.length
    ? `${gpus.length} GPU rilevata${gpus.length > 1 ? 'e' : ''} · ${
        working.length ? `${working.length} hardware encoders verified` : 'no hardware encoder verified'
      }`
    : 'No GPU detected.';

  list.innerHTML = gpus.length
    ? gpus
        .map(
          (gpu) => `<div class="gpu-item">
            <div class="gpu-name">${esc(gpu.name)}</div>
            <div class="gpu-meta">${esc(String(gpu.vendor || '').toUpperCase())}${gpu.vram ? ` · ${compressVramLabel(gpu.vram)}` : ''}${gpu.driver ? ` · driver ${esc(gpu.driver)}` : ''}</div>
          </div>`,
        )
        .join('')
    : '<div class="muted">No dedicated GPU detected.</div>';

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
    box.innerHTML = '<div class="muted">Catalogo encoder not available.</div>';
    return;
  }
  if (!state.compressSystem) {
    box.innerHTML = '<div class="muted">Press "Scan" to get settings suitable for this machine.</div>';
    if (badge) badge.textContent = 'auto';
    return;
  }
  const config = infoRecommendedConfig();
  const encoder = config.encoder;
  if (badge) badge.textContent = config.hardware ? 'gpu' : 'cpu';
  const qualityLabel = encoder && encoder.quality ? encoder.quality.label : 'Quality';
  const rows = [
    ['Encoder', encoder ? encoder.short : config.encoderId],
    [qualityLabel, String(config.quality)],
    ['Preset', config.preset || 'auto'],
    ['Container', 'MP4 (H.264/HEVC)'],
    ['Resolution', '1080p · niente upscale'],
    ['Decodifica', config.hardware ? 'GPU with automatic fallback' : 'Software'],
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
    toast('No encoder available', 'err');
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
  toast('Recommended settings applied');
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
    state.depsMessage = `${DEP_INFO[key].label} ready.`;
    toast(`${DEP_INFO[key].label} installato`);
    await refreshInfo();
  } catch (error) {
    state.depsMessage = `Download failed: ${errorMessage(error)}`;
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
    toast(`Update ${info.version} ready: restart to install it`);
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
  let text = 'Automatic check every 6 hours.';
  let label = 'auto';
  let badgeClass = 'panel-badge';

  switch (info.state) {
    case 'checking':
      text = 'Checking for updates...';
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
      text = `v${info.version || '?'} ready. It installs on exit or immediately.`;
      label = 'ready';
      badgeClass = 'panel-badge new';
      break;
    case 'installing':
      text = 'Restarting to install the update...';
      label = 'installo';
      break;
    case 'current': {
      const checked = fmtClock(info.lastCheckedAt);
      text = `Sei aggiornato${current ? ` · v${current}` : ''}${checked ? ` · ultimo controllo ${checked}` : ''}.`;
      label = 'ok';
      break;
    }
    case 'error':
      text = `Check failed: ${info.message || 'network error'}`;
      label = 'error';
      badgeClass = 'panel-badge err';
      break;
    case 'dev':
      text = info.message || 'Updates are checked in the installed app.';
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
    if (!result || !result.ok) toast('No update ready to install', 'err');
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
        toast('No GPU encoder available', 'err');
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
    // Con loudnorm il flusso audio non può restare in copia.
    if ($('compressLoudnorm').checked && ($('compressAudioCodec').value || 'copy') === 'copy') {
      setCompressAudioCodec(compressContainer() === 'webm' ? 'libopus' : 'aac');
    }
    syncCompressAudioCodecUi();
    updateCompressSummary();
  });
  on('btnCompressFullRange', 'click', () => {
    $('compressStart').value = '0';
    $('compressEnd').value = '0';
    markCompressCustom();
    updateCompressSummary();
  });
  on('compressTargetPreset', 'change', () => {
    const value = Number($('compressTargetPreset').value);
    if (!value) return;
    $('compressTarget').value = String(value);
    markCompressCustom();
    updateCompressSummary();
  });
  on('btnDetectCrop', 'click', detectCompressCrop);
  on('compressLoudnorm', 'change', () => {
    markCompressCustom();
    if ($('compressLoudnorm').checked) {
      if (($('compressAudioCodec').value || 'copy') === 'copy') {
        setCompressAudioCodec(compressContainer() === 'webm' ? 'libopus' : 'aac');
      }
      if (state.compressAudioSelected.size > 1 && !$('compressMerge').checked) {
        $('compressMerge').checked = true;
        renderCompressAudioTracks();
      }
    }
    syncCompressAudioCodecUi();
    updateCompressSummary();
  });
  on('compressBurnSubs', 'change', () => {
    markCompressCustom();
    renderBurnSubtitleSelect();
    updateCompressSummary();
  });
  on('compressBurnTrack', 'change', () => {
    markCompressCustom();
    updateCompressSummary();
  });
  on('compressVideoTrack', 'change', () => {
    markCompressCustom();
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
