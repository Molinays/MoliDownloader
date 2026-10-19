/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Risolve i link dei siti che non espongono direttamente un flusso scaricabile.
 * StreamingCommunity (e i mirror) caricano il player VixCloud dentro un iframe:
 * la pagina di embed dichiara in JavaScript i server disponibili
 * (window.streams) e token/expires della playlist (window.masterPlaylist).
 *
 * Il percorso normale usa richieste HTTP; se il sito risponde 403/410 alle
 * richieste da script, il resolver ricarica il player nella finestra Electron
 * nascosta, dove girano JavaScript e cookie veri, e legge la configurazione
 * dalla pagina del player.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT = 20000;
const MAX_IFRAME_DEPTH = 3;
const STREAMING_HOSTS = ['streamingcommunity'];
const EMBED_HOSTS = ['vixcloud.co', 'vixcloud.net', 'vixsrc.to', 'vixsrc.net'];
const EMBED_QUERY_KEYS = ['h', 'scz', 'lang'];
const STREAM_FLAGS = ['ub', 'ab'];
/** Percorsi che identificano un player: gli altri URL del dominio sono script o analytics. */
const PLAYER_PATH = /(?:^|\/)(?:embed|playlist|iframe)(?:[/?.]|$)/i;
const BROWSER_TIMEOUT = 30000;
const BROWSER_POLL = 400;
const BROWSER_PARTITION = 'persist:moli-player';

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isStreamingHost(rawUrl) {
  const host = hostOf(rawUrl);
  return Boolean(host) && STREAMING_HOSTS.some((needle) => host.includes(needle));
}

function isEmbedHost(rawUrl) {
  const host = hostOf(rawUrl);
  return Boolean(host) && EMBED_HOSTS.some((needle) => host === needle || host.endsWith(`.${needle}`));
}

function isPlaylistUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return /\/playlist(?:\.m3u8)?(?:[/?]|$)/i.test(parsed.pathname) || /\.m3u8$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSupported(rawUrl) {
  return isStreamingHost(rawUrl) || isEmbedHost(rawUrl);
}

function clean(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return clean(value)
    .replace(/^\s*(?:watch|guarda)\s+/i, '')
    .replace(/\s*[-|–]\s*StreamingCommunity.*$/i, '')
    .replace(/\s*[-|–]\s*VixCloud.*$/i, '')
    .trim()
    .slice(0, 160);
}

function titleFromHtml(html) {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (heading) {
    const value = normalizeTitle(heading[1]);
    if (value) return value;
  }
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return normalizeTitle(og[1]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return normalizeTitle(title[1]);
  return '';
}

function absolute(raw, base) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    return new URL(value, base || undefined).toString();
  } catch {
    return '';
  }
}

/** Rende confrontabili i caratteri escapati dentro gli script e i dati delle pagine. */
function normalizeScripts(html) {
  return String(html || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&');
}

/** URL del player dichiarato dallo stato della pagina (es. "embedUrl":"..."). */
function extractEmbedUrl(html, baseUrl) {
  const normalized = normalizeScripts(html);
  const match = normalized.match(
    /["']?(?:embedUrl|embed_url|iframeUrl|playerUrl|streamUrl)["']?\s*:\s*["']([^"']+)["']/i,
  );
  return match ? absolute(match[1], baseUrl) : '';
}

/** Tutti gli iframe e i link a player presenti nella pagina, in ordine di comparsa. */
function iframesIn(html, baseUrl) {
  const found = [];
  const push = (value) => {
    const url = absolute(value, baseUrl);
    if (url && !found.includes(url)) found.push(url);
  };
  const iframePattern = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let match = iframePattern.exec(html);
  while (match) {
    push(match[1]);
    match = iframePattern.exec(html);
  }
  const scriptText = normalizeScripts(html);
  const embedPattern = /["'](https?:\/\/(?:[\w.-]*\.)?(?:vixcloud|vixsrc)\.[a-z]+\/[^"'\s]+)["']/gi;
  match = embedPattern.exec(scriptText);
  while (match) {
    push(match[1]);
    match = embedPattern.exec(scriptText);
  }
  const relativePattern = /["'](\/(?:[a-z]{2}\/)?(?:iframe|embed)\/[^"'\s]+)["']/gi;
  match = relativePattern.exec(scriptText);
  while (match) {
    push(match[1]);
    match = relativePattern.exec(scriptText);
  }
  return found.filter((url) => url !== baseUrl);
}

/** Candidati player della pagina, in ordine di affidabilità. */
function playerCandidates(html, baseUrl) {
  const list = [];
  const push = (value) => {
    const url = absolute(value, baseUrl);
    if (!url || url === baseUrl || list.includes(url)) return;
    list.push(url);
  };
  push(extractEmbedUrl(html, baseUrl));
  for (const url of iframesIn(html, baseUrl)) {
    if (isEmbedHost(url)) {
      // Scarta risorse del dominio (script, immagini, analytics) che non sono player.
      try {
        if (!PLAYER_PATH.test(new URL(url).pathname)) continue;
      } catch {
        continue;
      }
    }
    push(url);
  }
  return list;
}

/** Preferisce un iframe del player VixCloud; altrimenti il primo player della pagina. */
function pickEmbed(html, baseUrl) {
  const candidates = playerCandidates(html, baseUrl);
  return candidates.find(isEmbedHost) || candidates[0] || '';
}

function quotedValue(text, keys) {
  for (const key of keys) {
    const pattern = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']{4,})["']`, 'i');
    const match = String(text || '').match(pattern);
    if (match) return match[1];
  }
  return '';
}

/** Configurazione del player letta dalla pagina (window.masterPlaylist / window.streams). */
function playerPartsFromHtml(html) {
  const normalized = normalizeScripts(html);
  return {
    normalized,
    masterUrl: (normalized.match(/window\.masterPlaylist[\s\S]{0,3000}?url\s*:\s*["']([^"']+)["']/i) || [])[1] || '',
    masterParams: {
      token: quotedValue(normalized, ['token']),
      expires: quotedValue(normalized, ['expires']),
    },
    streams: parseStreams(normalized),
    videoId: (normalized.match(/window\.video[\s\S]{0,200}?id\s*:\s*['"](\d+)['"]/i) || [])[1] || '',
  };
}

function parseStreams(text) {
  const match = String(text || '').match(/window\.streams\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Compone l'URL della playlist HLS dai dati del player: base da masterPlaylist,
 * parametri token/expires, flag del server attivo (ub/ab) e i parametri
 * dell'embed (h/scz/lang).
 */
function buildPlaylistUrl(parts, baseUrl) {
  const pageUrl = new URL(absolute(baseUrl, '') || 'https://vixcloud.co/');
  const source = parts && typeof parts === 'object' ? parts : {};

  let base = absolute(source.masterUrl, pageUrl.origin);
  let flag = '';
  const streams = Array.isArray(source.streams) ? source.streams : [];
  const active = streams.find((entry) => entry && entry.active) || streams[0];
  if (active && active.url) {
    const parsed = new URL(absolute(active.url, pageUrl.origin));
    if (!base) base = `${parsed.origin}${parsed.pathname}`;
    for (const key of STREAM_FLAGS) {
      if (parsed.searchParams.has(key)) flag = `${key}=${parsed.searchParams.get(key)}`;
    }
  }
  if (!base && source.videoId) base = absolute(`/playlist/${source.videoId}`, pageUrl.origin);
  if (!base || !/\/playlist\//i.test(base)) return '';

  const url = new URL(base);
  for (const key of EMBED_QUERY_KEYS) {
    if (!url.searchParams.has(key) && pageUrl.searchParams.has(key)) {
      url.searchParams.set(key, pageUrl.searchParams.get(key));
    }
  }
  if (flag) {
    const [key, value] = flag.split('=');
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  const params = source.masterParams || {};
  for (const key of ['token', 'expires']) {
    const value = params[key];
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Ricostruisce l'URL della playlist dalla pagina HTML del player. */
function extractPlaylist(html, baseUrl) {
  const parts = playerPartsFromHtml(html);
  const built = buildPlaylistUrl(parts, baseUrl);
  if (built) return built;

  const direct = parts.normalized.match(
    /https?:\/\/(?:[\w.-]*\.)?(?:vixcloud|vixsrc)\.[a-z]+\/playlist\/[\w-]+[^"'\s<>\\]*/i,
  );
  if (direct) return direct[0];

  const pageUrl = new URL(absolute(baseUrl, '') || 'https://vixcloud.co/');
  const relative = parts.normalized.match(/\/playlist\/[\w-]+(?:\?[^"'\s<>\\]*)?/i);
  if (relative) return absolute(relative[0], pageUrl.origin);

  const embedId = parts.normalized.match(/\/embed\/(\d+)/i);
  return embedId ? absolute(`/playlist/${embedId[1]}`, pageUrl.origin) : '';
}

/** Da una risposta JSON o m3u8 ricava l'URL del flusso video. */
function extractStream(body, baseUrl) {
  const text = String(body || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
  if (text.trim().startsWith('#EXTM3U')) return baseUrl;
  const m3u8 = text.match(/https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/i);
  if (m3u8) return m3u8[0];
  const relative = text.match(/["']([^"'\s\\]+\.m3u8[^"'\s\\]*)["']/i);
  if (relative) return absolute(relative[1], baseUrl);
  return '';
}

async function request(url, referer) {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  };
  if (referer) headers.Referer = referer;
  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`Il sito ha risposto ${response.status} (${response.statusText || 'errore'}) su ${hostOf(url) || url}`);
  }
  return { body: await response.text(), finalUrl: response.url || url };
}

function headersFor(streamUrl, referer) {
  let origin = '';
  try {
    origin = new URL(streamUrl).origin;
  } catch {
    origin = '';
  }
  return {
    referer: referer || `${origin}/`,
    origin: origin || '',
    'user-agent': UA,
  };
}

/** Segue gli iframe (anche annidati) fino alla pagina del player VixCloud. */
async function followToEmbed(html, pageUrl, referer, log) {
  let currentHtml = html;
  let currentUrl = pageUrl;
  let fallback = '';

  for (let depth = 0; depth < MAX_IFRAME_DEPTH; depth += 1) {
    const candidate = pickEmbed(currentHtml, currentUrl);
    if (!candidate) return fallback;
    if (isEmbedHost(candidate)) return candidate;
    fallback = fallback || candidate;
    log(`Apro il player intermedio (${hostOf(candidate)})...`);
    try {
      const page = await request(candidate, referer);
      currentHtml = page.body;
      currentUrl = page.finalUrl;
      if (!page.body.includes('iframe') && !/vixcloud|vixsrc/i.test(page.body)) return candidate;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function resolveWithHttp(target, log) {
  const parsed = new URL(target);
  let referer = `${parsed.origin}/`;
  let title = '';
  let embedUrl = '';

  if (isStreamingHost(target)) {
    log('Apertura della pagina del sito...');
    const page = await request(target);
    referer = page.finalUrl || target;
    title = titleFromHtml(page.body);
    embedUrl = await followToEmbed(page.body, page.finalUrl || target, referer, log);
    if (!embedUrl) {
      throw new Error('Nessun player trovato nella pagina: il sito potrebbe richiedere un accesso o aver cambiato struttura.');
    }
    log(`Player individuato: ${hostOf(embedUrl)}`);
  } else if (isEmbedHost(target) && !isPlaylistUrl(target)) {
    embedUrl = target;
  }

  let streamUrl = '';
  let streamReferer = referer;
  if (embedUrl) {
    log('Lettura del player...');
    const embed = await request(embedUrl, referer);
    if (!title) title = titleFromHtml(embed.body);
    const playlistUrl = extractPlaylist(embed.body, embed.finalUrl || embedUrl);
    if (!playlistUrl) {
      throw new Error('Playlist non trovata nel player: il link potrebbe essere scaduto, riprova dal sito.');
    }
    log('Playlist HLS trovata, recupero il flusso...');
    streamReferer = `${new URL(embedUrl).origin}/`;
    const playlist = await request(playlistUrl, streamReferer);
    streamUrl = extractStream(playlist.body, playlistUrl) || playlistUrl;
  } else {
    log('Lettura della playlist...');
    streamUrl = target;
    const playlist = await request(streamUrl, referer);
    streamUrl = extractStream(playlist.body, streamUrl) || streamUrl;
  }

  const headers = headersFor(streamUrl, streamReferer);
  log('Flusso pronto per il download.');
  return { url: streamUrl, title, referer: headers.referer, headers };
}

/** Electron disponibile (siamo nel processo principale dell'app). */
function browserAvailable() {
  try {
    const electron = require('electron');
    return Boolean(electron && electron.BrowserWindow);
  } catch {
    return false;
  }
}

function playerFrames(win) {
  try {
    const contents = win.webContents;
    if (!contents || contents.isDestroyed()) return [];
    const main = contents.mainFrame;
    if (!main) return [];
    const list = [];
    const walk = (frame) => {
      if (!frame || list.includes(frame)) return;
      list.push(frame);
      let children = [];
      try {
        children = typeof frame.framesInSubtree === 'function' ? frame.framesInSubtree : frame.frames;
      } catch {
        children = [];
      }
      for (const child of children || []) walk(child);
    };
    walk(main);
    return list.filter((frame) => {
      try {
        return isEmbedHost(frame.url);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** Legge window.streams / window.masterPlaylist da un frame del player. */
async function readPlayerConfig(frame) {
  const raw = await frame
    .executeJavaScript(
      `(function(){try{return JSON.stringify({href:location.href,streams:window.streams||null,master:window.masterPlaylist||null,video:window.video||null});}catch(e){return '';}})()`,
      false,
    )
    .catch(() => '');
  if (!raw) return null;
  try {
    const config = JSON.parse(raw);
    const hasStreams = Array.isArray(config.streams) && config.streams.length > 0;
    return config.master || hasStreams ? config : null;
  } catch {
    return null;
  }
}

/** Cattura le richieste della sessione: il player chiede da sé playlist e flusso HLS. */
function captureSession(ses) {
  if (ses.__moliCapture) return ses.__moliCapture;
  const state = { playlist: '', stream: '' };
  ses.webRequest.onCompleted((details) => {
    const url = details && details.url ? details.url : '';
    if (!url) return;
    if (!state.stream && /\.m3u8(?:[?#]|$)/i.test(url)) state.stream = url;
    else if (!state.playlist && /\/playlist\/[^/?#]+/i.test(url)) state.playlist = url;
  });
  ses.__moliCapture = state;
  return state;
}

/** Richiesta HTTP con i cookie e il motore di rete del browser interno. */
async function sessionFetch(ses, url, referer) {
  const headers = { Accept: 'application/json,text/plain,*/*' };
  if (referer) headers.Referer = referer;
  const response = await ses.fetch(url, { headers });
  if (!response.ok) throw new Error(`Il player ha risposto ${response.status}`);
  return response.text();
}

/** Attende che il player produca la playlist o direttamente il flusso HLS. */
async function waitForStream(win, ses, capture, log, deadline) {
  let ticks = 0;
  while (Date.now() < deadline) {
    if (capture.stream) return { url: capture.stream, source: 'flusso HLS del player' };

    if (capture.playlist) {
      const body = await sessionFetch(ses, capture.playlist, 'https://vixcloud.co/').catch(() => '');
      const stream = body ? extractStream(body, capture.playlist) : '';
      if (stream) return { url: stream, source: 'playlist del player' };
    }

    for (const frame of playerFrames(win)) {
      const config = await readPlayerConfig(frame);
      if (!config) continue;
      const playlistUrl = buildPlaylistUrl(
        {
          masterUrl: config.master && config.master.url,
          masterParams: config.master && config.master.params,
          streams: config.streams,
          videoId: config.video && config.video.id,
        },
        config.href || frame.url,
      );
      if (!playlistUrl) continue;
      capture.playlist = capture.playlist || playlistUrl;
      const body = await sessionFetch(ses, playlistUrl, 'https://vixcloud.co/').catch(() => '');
      const stream = body ? extractStream(body, playlistUrl) : '';
      if (stream) return { url: stream, source: 'config del player' };
    }

    ticks += 1;
    if (ticks % 10 === 0) log('Attendo il flusso dal player...');
    await new Promise((resolve) => setTimeout(resolve, BROWSER_POLL));
  }
  return null;
}

async function resolveWithBrowser(target, log) {
  const { BrowserWindow, session } = require('electron');
  const ses = session.fromPartition(BROWSER_PARTITION);
  try {
    ses.setUserAgent(UA);
  } catch {
    /* opzionale */
  }
  const capture = captureSession(ses);
  capture.playlist = '';
  capture.stream = '';

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(UA);

  try {
    log('Apro il player nel browser interno...');
    // La pagina può annullare o sostituire una navigazione (ERR_ABORTED -3):
    // la riuscita vera si misura sul flusso che il player chiede.
    let loadError = '';
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, REQUEST_TIMEOUT);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      win.webContents.once('did-finish-load', done);
      win.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame === false || code === -3) return;
        loadError = `${description || 'errore di rete'} (${code})`;
        done();
      });
      win.loadURL(target, { userAgent: UA }).catch(() => {
        /* l'esito reale lo dà waitForStream */
      });
    });

    const found = await waitForStream(win, ses, capture, log, Date.now() + BROWSER_TIMEOUT);
    if (!found) {
      throw new Error(
        loadError
          ? `Caricamento del player non riuscito: ${loadError}.`
          : 'Il player non ha caricato il flusso: il link potrebbe essere scaduto o richiedere un accesso.',
      );
    }

    const headers = headersFor(found.url, 'https://vixcloud.co/');
    const title = normalizeTitle(win.webContents.getTitle());
    log(`Flusso pronto per il download (${found.source}).`);
    return { url: found.url, title, referer: headers.referer, headers };
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* finestra già chiusa */
    }
  }
}
/**
 * Restituisce { url, title, referer, headers } dove url è il flusso scaricabile.
 */
async function resolve(rawUrl, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  let target = String(rawUrl || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = `https://${target}`;

  const parsed = new URL(target);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Protocollo non supportato');
  }

  let httpError = null;
  try {
    return await resolveWithHttp(target, log);
  } catch (error) {
    httpError = error;
  }

  if (!browserAvailable()) throw httpError;

  log(`Richiesta diretta rifiutata (${httpError.message}).`);
  try {
    return await resolveWithBrowser(target, log);
  } catch (error) {
    throw new Error(`${error.message} — percorso diretto: ${httpError.message}`);
  }
}

module.exports = {
  UA,
  isSupported,
  isStreamingHost,
  isEmbedHost,
  isPlaylistUrl,
  resolve,
  // esportati per i test
  titleFromHtml,
  extractEmbedUrl,
  iframesIn,
  playerCandidates,
  pickEmbed,
  playerPartsFromHtml,
  buildPlaylistUrl,
  extractPlaylist,
  extractStream,
  headersFor,
};
