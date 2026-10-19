/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Risolve i link dei siti che non espongono direttamente un flusso scaricabile.
 * StreamingCommunity (e i suoi mirror) caricano il player VixCloud dentro un
 * iframe: la pagina di embed contiene la configurazione del player
 * (window.streams / window.masterPlaylist) da cui si ricava la playlist HLS,
 * che yt-dlp sa scaricare direttamente.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REQUEST_TIMEOUT = 20000;
const MAX_IFRAME_DEPTH = 3;
const STREAMING_HOSTS = ['streamingcommunity'];
const EMBED_HOSTS = ['vixcloud.co', 'vixcloud.net', 'vixsrc.to', 'vixsrc.net'];
const EMBED_QUERY_KEYS = ['h', 'scz', 'lang', 'ub', 'ab'];

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

function titleFromHtml(html) {
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (heading) {
    const value = clean(heading[1]);
    if (value) return value.slice(0, 160);
  }
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return clean(og[1]).slice(0, 160);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const value = clean(title[1]).replace(/\s*[-|–]\s*StreamingCommunity.*$/i, '');
    if (value) return value.slice(0, 160);
  }
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

/** Rende confrontabili i caratteri escapati dentro gli script delle pagine. */
function normalizeScripts(html) {
  return String(html || '')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&');
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
  return found.filter((url) => url !== baseUrl);
}

/** Preferisce un iframe del player VixCloud; altrimenti il primo player della pagina. */
function pickEmbed(html, baseUrl) {
  const candidates = iframesIn(html, baseUrl);
  return candidates.find(isEmbedHost) || candidates[0] || '';
}

function quotedValue(html, keys) {
  for (const key of keys) {
    const pattern = new RegExp(`["']?${key}["']?\\s*[:=]\\s*["']([^"']{4,})["']`, 'i');
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return '';
}

/**
 * Ricostruisce l'URL della playlist VixCloud partendo dalla pagina di embed.
 * Il player può indicarla come URL completo (window.movie), dentro
 * window.streams (elenco server con quello attivo) oppure solo come
 * percorso "/playlist/<id>" con token ed expires in window.masterPlaylist.
 */
function extractPlaylist(html, baseUrl) {
  const normalized = normalizeScripts(html);
  const page = absolute(baseUrl, '') || 'https://vixcloud.co/';
  const pageUrl = new URL(page);

  let base = '';
  const direct = normalized.match(
    /https?:\/\/(?:[\w.-]*\.)?(?:vixcloud|vixsrc)\.[a-z]+\/playlist\/[\w-]+[^"'\s<>\\]*/i,
  );
  if (direct) base = direct[0];

  const streams = base ? null : normalized.match(/window\.streams\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (streams) {
    try {
      const list = JSON.parse(streams[1].replace(/\\u0026/g, '&'));
      const entries = Array.isArray(list) ? list : [];
      const active = entries.find((entry) => entry && entry.active) || entries[0];
      if (active && active.url) base = absolute(active.url, pageUrl.origin);
    } catch {
      base = '';
    }
  }

  if (!base) {
    const relative = normalized.match(/\/playlist\/[\w-]+(?:\?[^"'\s<>\\]*)?/i);
    if (relative) base = absolute(relative[0], pageUrl.origin);
  }

  if (!base) {
    const id = normalized.match(/\/embed\/(\d+)/i) || normalized.match(/["']?id["']?\s*[:=]\s*["']?(\d{3,})/i);
    if (id) base = absolute(`/playlist/${id[1]}`, pageUrl.origin);
  }

  if (!base || !/\/playlist\//i.test(base)) return '';

  const url = new URL(base);
  for (const key of EMBED_QUERY_KEYS) {
    if (!url.searchParams.has(key) && pageUrl.searchParams.has(key)) {
      url.searchParams.set(key, pageUrl.searchParams.get(key));
    }
  }
  const token = quotedValue(normalized, ['token']);
  const expires = quotedValue(normalized, ['expires']);
  if (token && !url.searchParams.has('token')) url.searchParams.set('token', token);
  if (expires && !url.searchParams.has('expires')) url.searchParams.set('expires', expires);
  return url.toString();
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
    throw new Error(`Il sito ha risposto ${response.status} (${response.statusText || 'errore'})`);
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
    if (!isStreamingHost(candidate) && depth > 0) return candidate;
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

module.exports = {
  UA,
  isSupported,
  isStreamingHost,
  isEmbedHost,
  isPlaylistUrl,
  resolve,
  // esportati per i test
  titleFromHtml,
  iframesIn,
  pickEmbed,
  extractPlaylist,
  extractStream,
  headersFor,
};
