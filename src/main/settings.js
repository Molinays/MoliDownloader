/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Cartelle di output dell'app. Ogni funzione ha la sua cartella, creata al
 * primo avvio dentro <Download di sistema>/MoliDowloader e modificabile
 * dall'utente: una stringa vuota significa "usa la predefinita".
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const APP_FOLDER = 'MoliDowloader';
const SUBFOLDERS = {
  downloadsDir: 'Download',
  compressDir: 'Compressioni',
  editorDir: 'Montaggi',
};
// Download e compressioni in Download, i montaggi esportati in Documenti.
const SUBFOLDER_BASE = {
  downloadsDir: 'downloads',
  compressDir: 'downloads',
  editorDir: 'documents',
};
const KEYS = Object.keys(SUBFOLDERS);

const bases = { downloads: '', documents: '' };
let stored = null;

function setBase(downloadsDir, documentsDir) {
  for (const [key, value] of [['downloads', downloadsDir], ['documents', documentsDir]]) {
    try {
      bases[key] = value ? path.resolve(value) : '';
    } catch {
      bases[key] = '';
    }
  }
}

function defaults() {
  const result = {};
  for (const key of KEYS) {
    const base = bases[SUBFOLDER_BASE[key]];
    result[key] = base ? path.join(base, APP_FOLDER, SUBFOLDERS[key]) : '';
  }
  return result;
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function cleanDir(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return path.resolve(trimmed);
  } catch {
    return '';
  }
}

function read() {
  if (stored) return stored;
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    file = {};
  }
  stored = {};
  for (const key of KEYS) stored[key] = cleanDir(file[key]);
  return stored;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  } catch {
    /* la scrittura non è critica: le impostazioni restano in memoria */
  }
}

/** Impostazioni effettive: quelle scelte dall'utente, altrimenti le predefinite. */
function get() {
  const current = read();
  const fallback = defaults();
  const result = {};
  for (const key of KEYS) result[key] = current[key] || fallback[key];
  return result;
}

function set(patch) {
  const current = read();
  if (patch && typeof patch === 'object') {
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) current[key] = cleanDir(patch[key]);
    }
  }
  persist();
  return get();
}

/** Crea (se serve) la cartella di una funzione e ne restituisce il percorso. */
function ensure(key) {
  const dir = get()[key];
  if (!dir) return '';
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return '';
  }
}

function ensureAll() {
  return KEYS.map((key) => ensure(key));
}

module.exports = { KEYS, APP_FOLDER, setBase, defaults, get, set, ensure, ensureAll, settingsFile };
