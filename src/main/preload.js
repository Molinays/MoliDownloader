/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const channels = new Set([
  'download:update',
  'export:progress',
  'ytdlp:progress',
  'compress:progress',
  'deps:progress',
  'update:status',
]);

function on(channel, listener) {
  if (!channels.has(channel) || typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('moli', {
  platform: process.platform,

  defaults: () => ipcRenderer.invoke('app:defaults'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickFolder: (current) => ipcRenderer.invoke('dialog:pickFolder', current),
  pickMedia: () => ipcRenderer.invoke('dialog:pickMedia'),
  pickAudio: () => ipcRenderer.invoke('dialog:pickAudio'),
  pickCompressSource: () => ipcRenderer.invoke('dialog:pickCompressSource'),
  pickCompressOutput: (payload) => ipcRenderer.invoke('dialog:pickCompressOutput', payload),
  getDroppedPaths: (files) => {
    let list = [];
    try {
      list = Array.from(files || []);
    } catch {
      list = [];
    }
    const paths = [];
    for (const file of list) {
      let resolved = '';
      try {
        resolved = webUtils.getPathForFile(file) || '';
      } catch {
        resolved = '';
      }
      // Fallback per le build che espongono ancora il vecchio attributo path.
      if (!resolved && file && typeof file.path === 'string') resolved = file.path;
      if (resolved && !paths.includes(resolved)) paths.push(resolved);
    }
    return paths;
  },
  pathForFile: (file) => {
    try {
      const resolved = webUtils.getPathForFile(file) || '';
      if (resolved) return resolved;
      return file && typeof file.path === 'string' ? file.path : '';
    } catch {
      return '';
    }
  },

  startDownloads: (payload) => ipcRenderer.invoke('download:start', payload),
  cancelDownload: (id) => ipcRenderer.invoke('download:cancel', id),
  getJob: (id) => ipcRenderer.invoke('download:get', id),
  listJobs: () => ipcRenderer.invoke('download:list'),
  clearFinished: () => ipcRenderer.invoke('download:clear'),
  updateYtDlp: () => ipcRenderer.invoke('ytdlp:update'),

  probeFile: (filePath) => ipcRenderer.invoke('editor:probe', filePath),
  exportProject: (project) => ipcRenderer.invoke('editor:export', project),
  cancelExport: () => ipcRenderer.invoke('editor:cancel'),
  saveSnapshot: (payload) => ipcRenderer.invoke('editor:snapshot', payload),

  compressCatalog: () => ipcRenderer.invoke('compress:catalog'),
  scanGpu: (force) => ipcRenderer.invoke('compress:scan', force),
  probeCompress: (filePath) => ipcRenderer.invoke('compress:probe', filePath),
  detectCrop: (filePath, duration, width, height) =>
    ipcRenderer.invoke('compress:detectCrop', { filePath, duration, width, height }),
  startCompress: (payload) => ipcRenderer.invoke('compress:start', payload),
  cancelCompress: () => ipcRenderer.invoke('compress:cancel'),

  systemInfo: () => ipcRenderer.invoke('system:info'),
  downloadDep: (tool) => ipcRenderer.invoke('deps:download', tool),

  checkUpdates: () => ipcRenderer.invoke('update:check'),
  updateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:open', filePath),

  on,
});
