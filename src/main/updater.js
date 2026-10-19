/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const STARTUP_DELAY = 8 * 1000;

let send = () => {};
let started = false;
let checking = false;
let startupTimer = null;
let intervalTimer = null;
let lastState = {
  state: 'idle',
  currentVersion: app.getVersion(),
  percent: 0,
  message: '',
  lastCheckedAt: null,
};

function logger(level, ...args) {
  try {
    console.log(`[updater:${level}]`, ...args);
  } catch {
    /* ignore */
  }
}

function publish(patch) {
  lastState = {
    ...lastState,
    ...patch,
    currentVersion: app.getVersion(),
  };
  send('update:status', lastState);
}

function resetTransient() {
  publish({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
}

function setupEvents() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.logger = {
    info: (...args) => logger('info', ...args),
    warn: (...args) => logger('warn', ...args),
    error: (...args) => logger('error', ...args),
    debug: (...args) => logger('debug', ...args),
  };

  autoUpdater.on('checking-for-update', () => {
    publish({ state: 'checking', message: 'Controllo degli aggiornamenti...', version: null });
  });

  autoUpdater.on('update-available', (info) => {
    resetTransient();
    publish({
      state: 'available',
      version: info && info.version,
      releaseName: info && info.releaseName,
      lastCheckedAt: Date.now(),
      message: 'Nuova versione trovata: download in corso...',
    });
  });

  autoUpdater.on('update-not-available', () => {
    resetTransient();
    publish({ state: 'current', version: app.getVersion(), lastCheckedAt: Date.now(), message: '' });
  });

  autoUpdater.on('download-progress', (progress) => {
    publish({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)),
      bytesPerSecond: Number(progress && progress.bytesPerSecond) || 0,
      transferred: Number(progress && progress.transferred) || 0,
      total: Number(progress && progress.total) || 0,
      message: '',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    publish({
      state: 'downloaded',
      version: info && info.version,
      percent: 100,
      message: 'Aggiornamento pronto: si installa alla chiusura oppure subito.',
    });
  });

  autoUpdater.on('error', (error) => {
    const message = String((error && error.message) || error || 'Errore aggiornamento')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    publish({ state: 'error', message, lastCheckedAt: Date.now() });
  });
}

async function check(manual) {
  if (!app.isPackaged) {
    publish({
      state: 'dev',
      message: 'Gli aggiornamenti automatici sono attivi solo nell’app installata.',
    });
    return { ok: false, dev: true };
  }
  if (checking) return { ok: true, alreadyChecking: true };
  checking = true;
  try {
    publish({ state: 'checking', message: 'Controllo degli aggiornamenti...' });
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result && result.updateInfo ? result.updateInfo.version : null };
  } catch (error) {
    const message = String((error && error.message) || error || 'Errore aggiornamento')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    publish({ state: 'error', message, lastCheckedAt: Date.now() });
    return { ok: false, error: message, manual: Boolean(manual) };
  } finally {
    checking = false;
  }
}

function install() {
  if (lastState.state !== 'downloaded') return { ok: false };
  publish({ state: 'installing', message: 'Riavvio per installare l’aggiornamento...' });
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      publish({
        state: 'error',
        message: String((error && error.message) || error || 'Installazione non riuscita'),
      });
    }
  });
  return { ok: true };
}

function state() {
  return lastState;
}

function start(broadcast) {
  send = typeof broadcast === 'function' ? broadcast : () => {};
  if (started) return;
  started = true;
  setupEvents();

  if (!app.isPackaged) {
    publish({
      state: 'dev',
      message: 'Gli aggiornamenti automatici sono attivi solo nell’app installata.',
    });
    return;
  }

  startupTimer = setTimeout(() => check(false), STARTUP_DELAY);
  intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
  if (startupTimer.unref) startupTimer.unref();
  if (intervalTimer.unref) intervalTimer.unref();
}

function stop() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}

module.exports = { start, stop, check, install, state };
