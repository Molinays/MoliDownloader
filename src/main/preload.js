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
    try {
      return Array.from(files)
        .map((file) => {
          try {
            return webUtils.getPathForFile(file);
          } catch {
            return '';
          }
        })
        .filter(Boolean);
    } catch {
      return [];
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

  compressCatalog: () => ipcRenderer.invoke('compress:catalog'),
  scanGpu: (force) => ipcRenderer.invoke('compress:scan', force),
  probeCompress: (filePath) => ipcRenderer.invoke('compress:probe', filePath),
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
