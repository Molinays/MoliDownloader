/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Impostazioni dell'app: le cartelle di output (una per funzione, dentro
 * <Documenti>/MoliDowloader) e le preferenze dei download.
 * Una cartella vuota significa "usa la predefinita".
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
// Tutto in Documenti per impostazione predefinita: l'utente può cambiare
// ogni cartella singolarmente dalle impostazioni.
const SUBFOLDER_BASE = {
  downloadsDir: 'documents',
  compressDir: 'documents',
  editorDir: 'documents',
};
const KEYS = Object.keys(SUBFOLDERS);

/** Preferenze numeriche o booleane, con limiti applicati in lettura. */
const PREF_DEFAULTS = {
  // Quanti download restano attivi insieme: il resto va in coda.
  maxParallel: 2,
  // Se un download fallisce, riprova da solo con altre impostazioni.
  autoRetry: true,
  // Nei tentativi automatici usa i cookie del browser installato.
  cookieFallback: true,
  // Tiene il titolo della pagina come nome del file (niente id del CDN).
  keepTitle: true,
};
const PREF_LIMITS = {
  maxParallel: { min: 1, max: 8 },
};

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

function cleanPref(key, value) {
  const fallback = PREF_DEFAULTS[key];
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
  const limit = PREF_LIMITS[key] || { min: 1, max: 8 };
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(limit.max, Math.max(limit.min, number));
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
  for (const key of Object.keys(PREF_DEFAULTS)) stored[key] = cleanPref(key, file[key]);
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
  for (const key of Object.keys(PREF_DEFAULTS)) result[key] = cleanPref(key, current[key]);
  return result;
}

function set(patch) {
  const current = read();
  if (patch && typeof patch === 'object') {
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) current[key] = cleanDir(patch[key]);
    }
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) current[key] = cleanPref(key, patch[key]);
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

module.exports = {
  KEYS,
  APP_FOLDER,
  PREF_DEFAULTS,
  setBase,
  defaults,
  get,
  set,
  ensure,
  ensureAll,
  settingsFile,
};
