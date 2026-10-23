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
const EMBED_HOSTS = ['vixcloud.co', 'vixcloud.net', 'vixcloud.cc', 'vixsrc.to', 'vixsrc.net'];
/** Siti con una pagina che monta il player: il flusso va estratto dalla pagina. */
const PAGE_HOSTS = ['animeunity', 'animesaturn'];
const EMBED_QUERY_KEYS = ['h', 'scz', 'lang'];
const STREAM_FLAGS = ['ub', 'ab'];
/** Percorsi che identificano un player: gli altri URL del dominio sono script o analytics. */
const PLAYER_PATH = /(?:^|\/)(?:embed|playlist|iframe)(?:[/?.]|$)/i;
const BROWSER_ATTEMPT_TIMEOUT = 32000;
const BROWSER_ATTEMPTS = 2;
const BROWSER_POLL = 400;
const BROWSER_RELOAD_PAUSE = 1500;
const BROWSER_PARTITION = 'persist:moli-player';
const BROWSER_PAGE_TIMEOUT = 45000;
let pageSessionCounter = 0;
let genericResolvers = 0;

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

function isPageHost(rawUrl) {
  const host = hostOf(rawUrl);
  return Boolean(host) && PAGE_HOSTS.some((needle) => host.includes(needle));
}

function isSupported(rawUrl) {
  return isStreamingHost(rawUrl) || isEmbedHost(rawUrl) || isPageHost(rawUrl);
}

/** ID del video da un link TikTok (anche embed o link breve già risolto). */
function tiktokVideoId(rawUrl) {
  const match = String(rawUrl || '').match(
    /tiktok\.com\/(?:@[^/?#]+\/video|embed(?:\/v2)?|v)\/(\d{6,})/i,
  );
  return match ? match[1] : '';
}

/** Nome leggibile da un link diretto a un file video. */
function titleFromMediaUrl(rawUrl) {
  try {
    const segments = new URL(rawUrl).pathname.split('/').filter(Boolean);
    const name = decodeURIComponent(segments.pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    return normalizeTitle(name.replace(/[_+]+/g, ' '));
  } catch {
    return '';
  }
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
    .replace(/^\s*AnimeUnity\s*[~|·-]\s*/i, '')
    .replace(/\s*[-|–]\s*(?:StreamingCommunity|VixCloud|AnimeUnity|AnimeSaturn|AnimeWorld|MegaPlay).*$/i, '')
    .replace(/\s+(?:streaming|guarda|watch)\s+(?:SUB\s*ITA|ITA|in\s+streaming|gratis|gratuito)\b.*$/i, '')
    .replace(/\s*&\s*download\s*$/i, '')
    .trim()
    .slice(0, 160);
}

function titleFromHtml(html) {
  // og:title e` il nome del film; l'h1 di molti siti contiene la sinossi
  // (che finiva nel nome del file, creando percorsi troppo lunghi).
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) {
    const value = normalizeTitle(og[1]);
    if (value) return value;
  }
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (heading) {
    const value = normalizeTitle(heading[1]);
    if (value) return value;
  }
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
    .replace(/\\u002f/gi, '/')
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
  // L'embed che abilita l'alta definizione (canPlayFHD=1) va richiesto con h=1:
  // senza quel flag VixCloud risponde 403 alla playlist.
  if (!url.searchParams.has('h') && /(?:^|[?&])canPlayFHD=(?:1|true)(?:&|$)/i.test(pageUrl.search)) {
    url.searchParams.set('h', '1');
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

/**
 * Varianti accettate dal player per la stessa playlist: quella composta e, se
 * manca, la stessa con h=1. Le prove sul player reale mostrano che la richiesta
 * senza h viene rifiutata (403) anche quando l'embed non dichiara canPlayFHD.
 */
function playlistVariants(url) {
  const list = [];
  const value = String(url || '');
  if (!value) return list;
  list.push(value);
  try {
    const parsed = new URL(value);
    if (!parsed.searchParams.has('h')) {
      parsed.searchParams.set('h', '1');
      const withH = parsed.toString();
      if (!list.includes(withH)) list.push(withH);
    }
  } catch {
    /* URL non valido: resta la variante originale */
  }
  return list;
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

/** Tutti i possibili flussi (m3u8, playlist dei player) dichiarati in una pagina. */
function mediaCandidates(html, baseUrl) {
  const normalized = normalizeScripts(html);
  const found = [];
  const push = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const url = absolute(value, baseUrl);
    if (!url || !/^https?:/i.test(url) || found.includes(url)) return;
    found.push(url);
  };
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>\\]*)?/gi,
    /["']([^"'\s]+?\.(?:m3u8|mp4|webm)(?:\?[^"'\s]*)?)["']/gi,
    /["'](https?:\/\/[^"'\s]+\/playlist\/[^"'\s]+)["']/gi,
    /["'](https?:\/\/[^"'\s]+\/hls\/[^"'\s]+)["']/gi,
    // Player che dichiarano il video in JSON (TikTok, Vimeo, embed vari).
    /(?:playAddr|play_addr|downloadAddr|download_addr|contentUrl|video_url|videoUrl|play_url|hd_src|sd_src)["']?\s*[:=]\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(normalized);
    while (match) {
      push(match[1] || match[0]);
      match = pattern.exec(normalized);
    }
  }
  return found.slice(0, 20);
}

/** Iframe e player annidati della pagina, senza script e immagini. */
function pageCandidates(html, baseUrl) {
  const list = [];
  const push = (raw) => {
    const url = absolute(raw, baseUrl);
    if (!url || url === baseUrl || list.includes(url)) return;
    if (!/^https?:/i.test(url)) return;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(?:\?|$)/i.test(url)) return;
    list.push(url);
  };
  for (const url of iframesIn(html, baseUrl)) push(url);
  push(extractEmbedUrl(html, baseUrl));
  return list.slice(0, 8);
}

/** Risposta normalizzata con gli header da usare per il download. */
function withHeaders(streamUrl, referer) {
  const headers = headersFor(streamUrl, referer);
  return { url: streamUrl, referer: headers.referer, headers };
}

/** URL che sembrano un file video diretto (mp4/webm) o un flusso CDN. */
function isMediaCandidate(url) {
  const value = String(url || '');
  if (/\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value)) return true;
  if (/\/video\/tos\//i.test(value)) return true;
  return /mime_type=(?:video|audio)_/i.test(value);
}

/** Verifica che un candidato sia davvero una playlist HLS leggibile. */
async function verifyStream(candidate, referer) {
  const page = await request(candidate, referer);
  const body = page.body || '';
  if (!/#EXTM3U/i.test(body)) return '';
  return extractStream(body, page.finalUrl || candidate) || candidate;
}

/**
 * Verifica un file video senza scaricarlo: legge solo i primi byte e guarda
 * il content-type della risposta.
 */
async function verifyMedia(candidate, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(candidate, {
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: referer } : {}),
        Range: 'bytes=0-2047',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) return '';
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (/^video\//.test(type) || /^audio\//.test(type) || /octet-stream/.test(type)) {
      try {
        await response.body.cancel();
      } catch {
        /* corpo già chiuso */
      }
      return candidate;
    }
    return '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Sceglie la verifica giusta in base al tipo di candidato. */
async function verifyCandidate(candidate, referer) {
  if (/\.m3u8(?:[?#]|$)/i.test(candidate) || isPlaylistUrl(candidate)) {
    return verifyStream(candidate, referer);
  }
  if (isMediaCandidate(candidate)) return verifyMedia(candidate, referer);
  return '';
}

/**
 * Cerca il flusso in una pagina qualunque: playlist scritte nell'HTML, player
 * VixCloud/MegaPlay e iframe annidati. Restituisce null se non trova nulla.
 */
async function resolveGenericHttp(target, log) {
  const queue = [{ url: target, depth: 0 }];
  const seen = new Set();
  let title = '';
  let lastError = null;

  while (queue.length && seen.size < 12) {
    const item = queue.shift();
    if (seen.has(item.url) || item.depth > MAX_IFRAME_DEPTH) continue;
    seen.add(item.url);
    log(`Opening ${hostOf(item.url) || item.url}...`);

    let page = null;
    try {
      page = await request(item.url, `${new URL(item.url).origin}/`);
    } catch (error) {
      lastError = error;
      continue;
    }
    const pageUrl = page.finalUrl || item.url;
    if (!title) title = titleFromHtml(page.body);

    // 1. Flussi già presenti nella pagina (master HLS, playlist, JSON dei player).
    for (const candidate of mediaCandidates(page.body, pageUrl)) {
      if (isEmbedHost(candidate) && !isPlaylistUrl(candidate)) continue;
      const stream = await verifyCandidate(candidate, pageUrl).catch(() => '');
      if (stream) {
        log(`Stream found in ${hostOf(candidate) || 'page'}.`);
        return { ...withHeaders(stream, pageUrl), title };
      }
    }

    // 2. Player VixCloud: token, expires e server attivo sono nello script.
    if (/masterPlaylist|window\.streams|vixcloud|vixsrc/i.test(page.body)) {
      const playlistUrl = extractPlaylist(page.body, pageUrl);
      for (const candidate of playlistVariants(playlistUrl)) {
        try {
          const playlist = await request(candidate, `${new URL(pageUrl).origin}/`);
          const stream = extractStream(playlist.body, candidate);
          if (stream) {
            log('Player playlist found.');
            return { ...withHeaders(stream, `${new URL(candidate).origin}/`), title };
          }
        } catch {
          /* provo la variante successiva */
        }
      }
    }

    // 3. Iframe e player intermedi.
    for (const candidate of pageCandidates(page.body, pageUrl)) {
      if (!seen.has(candidate)) queue.push({ url: candidate, depth: item.depth + 1 });
    }
  }

  if (lastError) throw lastError;
  return null;
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
    throw new Error(`The site returned ${response.status} (${response.statusText || 'error'}) on ${hostOf(url) || url}`);
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
    log(`Opening the intermediate player (${hostOf(candidate)})...`);
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
    log('Opening the site page...');
    const page = await request(target);
    referer = page.finalUrl || target;
    title = titleFromHtml(page.body);
    embedUrl = await followToEmbed(page.body, page.finalUrl || target, referer, log);
    if (!embedUrl) {
      throw new Error('No player found on the page: the site may require a login or has changed its layout.');
    }
    log(`Player found: ${hostOf(embedUrl)}`);
  } else if (isEmbedHost(target) && !isPlaylistUrl(target)) {
    embedUrl = target;
  }

  let streamUrl = '';
  let streamReferer = referer;
  if (embedUrl) {
    log('Reading the player...');
    const embed = await request(embedUrl, referer);
    if (!title) title = titleFromHtml(embed.body);
    const playlistUrl = extractPlaylist(embed.body, embed.finalUrl || embedUrl);
    if (!playlistUrl) {
      throw new Error('Playlist not found in the player: the link may have expired, try again from the site.');
    }
    log('HLS playlist found, fetching the stream...');
    streamReferer = `${new URL(embedUrl).origin}/`;
    let playlist = null;
    let playlistRequestUrl = playlistUrl;
    let lastError = null;
    for (const candidate of playlistVariants(playlistUrl)) {
      try {
        playlist = await request(candidate, streamReferer);
        playlistRequestUrl = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!playlist) throw lastError || new Error('Playlist unreachable.');
    streamUrl = extractStream(playlist.body, playlistRequestUrl) || playlistRequestUrl;
  } else {
    log('Reading the playlist...');
    streamUrl = target;
    const playlist = await request(streamUrl, referer);
    const extracted = extractStream(playlist.body, streamUrl);
    if (!extracted) throw new Error('The link does not point to a playlist or video stream.');
    streamUrl = extracted;
  }

  const headers = headersFor(streamUrl, streamReferer);
  log('Stream ready for download.');
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

/** Tutti i frame della finestra (pagina e iframe), anche non VixCloud. */
function allFrames(win) {
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
    return list;
  } catch {
    return [];
  }
}

/**
 * Cerca il video nativo nella pagina: i siti che non chiedono il file finché
 * il player non parte lo dichiarano comunque nel tag <video>/<source>.
 */
async function findMediaInFrames(win) {
  for (const frame of allFrames(win)) {
    const sources = await frame
      .executeJavaScript(
        `(function(){try{return Array.from(document.querySelectorAll('video,audio,source')).map(function(el){return el.currentSrc||el.src||el.getAttribute('src')||'';}).filter(function(u){return /^https?:/i.test(u);});}catch(e){return [];}})()`,
        false,
      )
      .catch(() => []);
    if (!Array.isArray(sources) || !sources.length) continue;
    const url =
      sources.find((value) => /\.m3u8(?:[?#]|$)/i.test(value)) ||
      sources.find((value) => isMediaCandidate(value)) ||
      sources.find(
        (value) => /^https?:/i.test(value) && !/\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?)(?:[?#]|$)/i.test(value),
      );
    if (!url) continue;
    let referrer = win.webContents.getURL();
    try {
      referrer = frame.url || referrer;
    } catch {
      /* frame non più disponibile */
    }
    return { url, referrer };
  }
  return null;
}

/** Titolo leggibile della pagina, anche quando il <title> è generico. */
async function readPageTitle(win) {
  const value = await win.webContents
    .executeJavaScript(
      `(function(){try{
        var meta=document.querySelector('meta[property="og:title"],meta[name="twitter:title"]');
        if(meta&&meta.content&&meta.content.trim())return meta.content.trim();
        var heading=document.querySelector('h1');
        if(heading&&heading.textContent&&heading.textContent.trim())return heading.textContent.trim();
        return document.title||'';
      }catch(e){return '';}})()`,
      false,
    )
    .catch(() => '');
  return normalizeTitle(value) || normalizeTitle(win.webContents.getTitle());
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
  const state = { playlist: '', stream: '', denied: 0 };
  ses.webRequest.onCompleted((details) => {
    const url = details && details.url ? details.url : '';
    if (!url) return;
    const status = Number(details.statusCode) || 0;
    const isStreamRequest = /\/playlist\/[^/?#]+/i.test(url) || /\.m3u8(?:[?#]|$)/i.test(url);
    if (isStreamRequest && status >= 400) {
      // Token vecchio o richiesta rifiutata: il player resta a ritentare all'infinito.
      state.denied += 1;
      return;
    }
    if (!isStreamRequest || status >= 400) return;
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
  if (!response.ok) throw new Error(`The player returned ${response.status}`);
  return response.text();
}

/** Attende che il player produca la playlist o direttamente il flusso HLS. */
async function waitForStream(win, ses, capture, log, deadline) {
  let ticks = 0;
  while (Date.now() < deadline) {
    if (capture.stream) return { url: capture.stream, source: 'player HLS stream' };
    if (capture.denied >= 2) return { stale: true };

    if (capture.playlist) {
      for (const candidate of playlistVariants(capture.playlist)) {
        const body = await sessionFetch(ses, candidate, 'https://vixcloud.co/').catch(() => '');
        const stream = body ? extractStream(body, candidate) : '';
        if (stream) return { url: stream, source: 'playlist del player' };
      }
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
      for (const candidate of playlistVariants(playlistUrl)) {
        const body = await sessionFetch(ses, candidate, 'https://vixcloud.co/').catch(() => '');
        const stream = body ? extractStream(body, candidate) : '';
        if (stream) return { url: stream, source: 'config del player' };
      }
    }

    ticks += 1;
    if (ticks % 10 === 0) log('Waiting for the player stream...');
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
  const resetCapture = () => {
    capture.playlist = '';
    capture.stream = '';
    capture.denied = 0;
  };
  resetCapture();

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

  // La pagina può annullare o sostituire una navigazione (ERR_ABORTED -3) e il
  // sito può servire un token già consumato: la riuscita si misura sul flusso
  // che il player chiede, e al secondo tentativo si ricarica la pagina.
  const loadWindow = (reload) =>
    new Promise((resolve) => {
      let loadError = '';
      const timer = setTimeout(() => resolve(loadError), REQUEST_TIMEOUT);
      const done = () => {
        clearTimeout(timer);
        resolve(loadError);
      };
      win.webContents.once('did-finish-load', done);
      win.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame === false || code === -3) return;
        loadError = `${description || 'network error'} (${code})`;
        done();
      });
      if (reload) {
        // Senza cache: la pagina del sito serve un token nuovo solo se rigenerata.
        win.webContents.reloadIgnoringCache();
        return;
      }
      // Niente cache HTTP: un token riusato viene rifiutato dal player (403).
      win
        .loadURL(target, { userAgent: UA, extraHeaders: 'pragma: no-cache\ncache-control: no-cache' })
        .catch(() => {
          /* l'esito reale lo dà waitForStream */
        });
    });

  try {
    log('Opening the player in the internal browser...');
    let loadError = await loadWindow(false);
    let found = await waitForStream(win, ses, capture, log, Date.now() + BROWSER_ATTEMPT_TIMEOUT);
    let sawDenied = Boolean(found && found.stale);
    for (let attempt = 1; !found && attempt < BROWSER_ATTEMPTS; attempt += 1) {
      // Il sito a volte serve un token già consumato (403/410) e il player può
      // mostrare un controllo di sicurezza: ricaricare ottiene un link fresco.
      const stale = Boolean(found && found.stale);
      log(
        stale
          ? 'Token rejected by the player: reloading the page for a fresh one...'
          : attempt === 1
            ? 'Reloading the player for a fresh link...'
            : 'Retrying with the player...',
      );
      if (!stale) await new Promise((resolve) => setTimeout(resolve, BROWSER_RELOAD_PAUSE));
      resetCapture();
      loadError = (await loadWindow(true)) || loadError;
      found = await waitForStream(win, ses, capture, log, Date.now() + BROWSER_ATTEMPT_TIMEOUT);
      sawDenied = sawDenied || Boolean(found && found.stale);
    }
    if (!found || found.stale) {
      if (sawDenied && !loadError) {
        const denied = new Error(
          'The player rejected the stream (403): try again in a moment, the site limits rapid requests.',
        );
        denied.noStreamDenied = true;
        throw denied;
      }
      throw new Error(
        loadError
          ? `Player failed to load: ${loadError}.`
          : 'The player did not load a stream: the link may have expired or require a login.',
      );
    }

    const headers = headersFor(found.url, 'https://vixcloud.co/');
    const title = await readPageTitle(win);
    log(`Stream ready for download (${found.source}).`);
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
 * Molti player partono solo dopo un clic o non avviano il <video> finche` la
 * pagina non riceve un gesto utente. Nella finestra nascosta premiamo il primo
 * pulsante di play disponibile, senza toccare la finestra dell'utente.
 */
async function nudgePlayer(win) {
  for (const frame of allFrames(win)) {
    await frame
      .executeJavaScript(
        `(function(){try{
          var buttons=document.querySelectorAll('.vjs-big-play-button,[class*="play-button"],[class*="playButton"],button[aria-label*="Play"],button[aria-label*="play"],button[title*="Play"]');
          for(var i=0;i<buttons.length;i++){try{if(!buttons[i].dataset.moliClicked){buttons[i].dataset.moliClicked='1';buttons[i].click();}}catch(e){}}
          var videos=document.querySelectorAll('video');
          for(var j=0;j<videos.length;j++){try{videos[j].muted=true;if(videos[j].paused)videos[j].play().catch(function(){});}catch(e){}}
        }catch(e){}})()`,
        false,
      )
      .catch(() => {});
  }
}

/**
 * Ultimo tentativo per un sito qualunque: apre la pagina in una finestra vera
 * e cattura dall'esterno il primo flusso HLS/Mp4 che il player chiede. È lo
 * stesso principio delle estensioni che "trovano" il link del video.
 */
async function resolveGenericBrowser(target, log) {
  const { BrowserWindow, session } = require('electron');
  // La prima richiesta usa una sessione persistente: i cookie di sicurezza
  // (Cloudflare e simili) restano validi per i tentativi successivi. In
  // parallelo ogni download usa una sessione isolata per non sovrascrivere
  // il listener di rete dell'altro.
  pageSessionCounter += 1;
  const partition = genericResolvers > 0
    ? `moli-page-${Date.now()}-${pageSessionCounter}`
    : 'persist:moli-resolver';
  genericResolvers += 1;
  const ses = session.fromPartition(partition);
  try {
    ses.setUserAgent(UA);
  } catch {
    /* opzionale */
  }

  const found = { url: '', type: '', referrer: '' };
  const capture = (details) => {
    if (found.url || !details || !details.url) return;
    const url = details.url;
    if ((Number(details.statusCode) || 0) >= 400) return;
    if (/\.m3u8(?:[?#]|$)/i.test(url)) {
      found.url = url;
      found.type = 'm3u8';
    } else if (isMediaCandidate(url) && !/\/(?:ads?|banner|splash)[/_]/i.test(url)) {
      found.url = url;
      found.type = 'mp4';
    } else {
      return;
    }
    found.referrer = details.referrer || target;
  };
  try {
    ses.webRequest.onCompleted(capture);
  } catch {
    /* senza listener resta il polling della pagina */
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    backgroundColor: '#000000',
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(UA);
  try {
    win.webContents.setAudioMuted(true);
  } catch {
    /* opzionale */
  }

  try {
    log('Opening the page in the internal browser to capture the stream...');
    win.loadURL(target, { userAgent: UA }).catch(() => {
      /* l'esito lo dà la cattura */
    });

    const deadline = Date.now() + BROWSER_PAGE_TIMEOUT;
    let ticks = 0;
    while (!found.url && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      ticks += 1;
      // Il player può dichiarare il video nel DOM senza far partire la rete.
      if (ticks % 2 === 0) {
        const dom = await findMediaInFrames(win);
        if (dom) {
          found.url = dom.url;
          found.type = /\.m3u8(?:[?#]|$)/i.test(dom.url) ? 'm3u8' : 'mp4';
          found.referrer = dom.referrer;
          found.source = 'video nella pagina';
        }
      }
      // I player con pulsante "play" non partono da soli: proviamo ad avviarli.
      if (!found.url && ticks % 4 === 0) await nudgePlayer(win);
      if (ticks % 12 === 0) log('Waiting for the player to request the video...');
      if (ticks % 36 === 0) log('If the site shows a security check, waiting for it to finish...');
    }

    if (!found.url) {
      throw new Error('The player did not request any stream: the site may require a login or the link has no video.');
    }

    try {
      win.webContents.stop();
    } catch {
      /* finestra già chiusa */
    }

    let streamUrl = found.url;
    if (found.type === 'm3u8') {
      const body = await ses
        .fetch(streamUrl, { headers: { Accept: 'application/vnd.apple.mpegurl,*/*' } })
        .then((response) => (response.ok ? response.text() : ''))
        .catch(() => '');
      if (body && /#EXTM3U/i.test(body)) streamUrl = extractStream(body, streamUrl) || streamUrl;
    }

    const title = await readPageTitle(win);
    log(`Stream captured (${found.source || 'player network'}).`);
    return { ...withHeaders(streamUrl, found.referrer || target), title };
  } finally {
    genericResolvers = Math.max(0, genericResolvers - 1);
    try {
      ses.webRequest.onCompleted(null);
    } catch {
      /* ignore */
    }
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
    throw new Error('Unsupported protocol');
  }

  // Pagine con player non VixCloud (animeunity, animesaturn): il flusso va
  // cercato nell'HTML e, se il sito lo nasconde, intercettato dal browser.
  if (isPageHost(target) && !isEmbedHost(target)) {
    let httpError = null;
    try {
      const found = await resolveGenericHttp(target, log);
      if (found) return found;
    } catch (error) {
      httpError = error;
    }
    if (browserAvailable()) {
      try {
        return await resolveGenericBrowser(target, log);
      } catch (error) {
        throw new Error(
          `${error.message}${httpError ? ` — direct path: ${httpError.message}` : ''}`,
        );
      }
    }
    throw httpError || new Error('No video found on the page: the site may require a login.');
  }

  // I siti di streaming servono il player solo nel browser: le richieste HTTP
  // dirette a VixCloud vengono rifiutate (403) e il rifiuto si trascina anche
  // nel percorso browser. Per questi link si parte quindi dalla finestra vera.
  if (isStreamingHost(target) && browserAvailable()) {
    let browserError = null;
    try {
      return await resolveWithBrowser(target, log);
    } catch (error) {
      if (error && error.noStreamDenied) throw error;
      browserError = error;
    }
    try {
      return await resolveWithHttp(target, log);
    } catch (httpError) {
      throw new Error(`${browserError.message} — direct path: ${httpError.message}`);
    }
  }

  let httpError = null;
  try {
    return await resolveWithHttp(target, log);
  } catch (error) {
    httpError = error;
  }

  if (!browserAvailable()) throw httpError;

  log(`Direct request rejected (${httpError.message}).`);
  try {
    return await resolveWithBrowser(target, log);
  } catch (error) {
    throw new Error(`${error.message} — direct path: ${httpError.message}`);
  }
}

/**
 * Risoluzione per un link qualunque, usata quando yt-dlp non lo gestisce:
 * prova la pagina e poi il browser interno. Restituisce null se non c'è nulla.
 */
async function resolveAuto(rawUrl, onLog) {
  const log = typeof onLog === 'function' ? onLog : () => {};
  let target = String(rawUrl || '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) target = `https://${target}`;
  if (!/^https?:/i.test(target)) return null;

  if (isSupported(target)) return resolve(target, log);

  // Link già puntato a un file video: nessuna pagina da aprire, si verifica
  // che risponda davvero e si scarica quello.
  const directMedia =
    /\.(?:mp4|m4v|webm|mov)(?:[?#]|$)/i.test(target) || /mime_type=video_/i.test(target);
  if (directMedia) {
    const origin = hostOf(target) ? `https://${hostOf(target)}/` : '';
    const stream = await verifyMedia(target, origin).catch(() => '');
    if (stream) {
      log('Direct link to a video file.');
      return { ...withHeaders(stream, origin), title: titleFromMediaUrl(target) };
    }
  }

  // TikTok senza login: la pagina pubblica manda al login, ma il player
  // incorporato dichiara comunque il video mp4 nel tag <video>.
  if (/(?:^|\/\/)(?:vm|vt)\.tiktok\.com\//i.test(target)) {
    try {
      const page = await request(target, 'https://www.tiktok.com/');
      target = page.finalUrl || target;
    } catch {
      /* provo comunque l'ID presente nel link */
    }
  }
  const tiktokId = tiktokVideoId(target);
  if (tiktokId && browserAvailable()) {
    log('Opening the TikTok player...');
    try {
      return await resolveGenericBrowser(`https://www.tiktok.com/embed/v2/${tiktokId}`, log);
    } catch (error) {
      log(`TikTok player unavailable: ${error.message}`);
    }
  }

  let httpError = null;
  try {
    const found = await resolveGenericHttp(target, log);
    if (found) return found;
  } catch (error) {
    httpError = error;
  }

  if (!browserAvailable()) {
    if (httpError) throw httpError;
    return null;
  }

  try {
    return await resolveGenericBrowser(target, log);
  } catch (error) {
    if (httpError) {
      throw new Error(`${error.message} — direct path: ${httpError.message}`);
    }
    throw error;
  }
}

module.exports = {
  UA,
  isSupported,
  isStreamingHost,
  isEmbedHost,
  isPageHost,
  isPlaylistUrl,
  resolve,
  resolveAuto,
  // esportati per i test
  titleFromHtml,
  extractEmbedUrl,
  iframesIn,
  playerCandidates,
  pickEmbed,
  playerPartsFromHtml,
  buildPlaylistUrl,
  playlistVariants,
  extractPlaylist,
  extractStream,
  headersFor,
  mediaCandidates,
  pageCandidates,
  verifyMedia,
  tiktokVideoId,
  titleFromMediaUrl,
};
