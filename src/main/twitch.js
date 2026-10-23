/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Twitch: alcune VOD arrivano da yt-dlp con la sola traccia audio.
 * Il manifest usher del VOD dichiara in quel caso un solo flusso
 * "audio_only", ma la rendition "chunked" esiste sullo stesso CDN e contiene
 * video e audio insieme. Qui chiediamo il token pubblico alla API web di
 * Twitch, leggiamo il manifest e ricaviamo l'URL chunked da passare a yt-dlp.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const GQL_URL = 'https://gql.twitch.tv/gql';
const USHER = 'https://usher.ttvnw.net/vod';
const TOKEN_QUERY =
  'query PlaybackAccessToken($id: ID!){video(id:$id){title owner{displayName} playbackAccessToken(params:{platform:"web",playerBackend:"mediaplayer",playerType:"site"}){value signature}}}';

function hostOf(rawUrl) {
  try {
    return new URL(String(rawUrl || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** True per un link a una VOD Twitch (twitch.tv/videos/<id>). */
function isTwitchHost(rawUrl) {
  const host = hostOf(rawUrl);
  return host === 'twitch.tv' || host.endsWith('.twitch.tv');
}

/** ID numerico della VOD, stringa vuota per live e clip. */
function videoId(rawUrl) {
  if (!isTwitchHost(rawUrl)) return '';
  try {
    const match = new URL(String(rawUrl)).pathname.match(/^\/videos\/(\d{5,})/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

async function fetchToken(id) {
  const response = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Content-Type': 'text/plain',
      'User-Agent': UA,
    },
    body: JSON.stringify([{ query: TOKEN_QUERY, variables: { id } }]),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Twitch answered HTTP ${response.status} while asking for the stream.`);
  const payload = await response.json();
  const entry = Array.isArray(payload) ? payload[0] : payload;
  if (entry && Array.isArray(entry.errors) && entry.errors.length) {
    throw new Error(entry.errors[0].message || 'Twitch refused the stream request.');
  }
  const video = entry && entry.data ? entry.data.video : null;
  const token = video && video.playbackAccessToken;
  if (!token || !token.value || !token.signature) {
    throw new Error('Twitch did not return a playback token: the video may be deleted, private or subscriber-only.');
  }
  const title = [video.owner && video.owner.displayName, video.title].filter(Boolean).join(' - ');
  return { token: token.value, signature: token.signature, title: String(title || '').trim() };
}

/** Voci del manifest usher: tipo (chunked/audio_only), risoluzione e URL. */
function parseVariants(body, baseUrl) {
  const lines = String(body || '').split(/\r?\n/);
  const variants = [];
  let pending = null;
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const video = (line.match(/VIDEO="([^"]+)"/i) || [])[1] || '';
      const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const bandwidth = Number((line.match(/BANDWIDTH=(\d+)/i) || [])[1]) || 0;
      pending = {
        group: video.toLowerCase(),
        height: resolution ? Number(resolution[2]) : 0,
        bandwidth,
      };
      continue;
    }
    if (!pending || !line || line.startsWith('#')) continue;
    let url = '';
    try {
      url = new URL(line, baseUrl || undefined).toString();
    } catch {
      url = '';
    }
    if (url) variants.push({ ...pending, url });
    pending = null;
  }
  return variants;
}

/** Ricava la rendition chunked dall'URL audio_only dello stesso CDN. */
function chunkedFromAudioOnly(rawUrl) {
  const value = String(rawUrl || '');
  if (!/\/audio_only\//i.test(value)) return '';
  return value.replace(/\/audio_only\//i, '/chunked/');
}

async function usablePlaylist(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://www.twitch.tv/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return false;
    const body = (await response.text()).slice(0, 400);
    return /#EXTM3U/i.test(body);
  } catch {
    return false;
  }
}

/**
 * Risolve la VOD nel flusso completo (video + audio).
 * Restituisce { url, title, referer, headers }.
 */
async function resolveVod(rawUrl, log = () => {}, options = {}) {
  const id = videoId(rawUrl);
  if (!id) throw new Error('This is not a Twitch video link.');
  // Rispetta la qualita` scelta: 0 o 'best' significa la resa migliore.
  const maxHeight = Number(options.maxHeight) || 0;

  const access = await fetchToken(id);
  if (access.title) log(`VOD: ${access.title}`);
  const usherUrl =
    `${USHER}/${id}.m3u8?allow_source=true&allow_audio_only=true&include_unavailable=true&` +
    `nauth=${encodeURIComponent(access.token)}&nauthsig=${access.signature}` +
    '&player=twitchweb&supported_codecs=av1,h265,h264&p=1234567&type=any';

  const response = await fetch(usherUrl, {
    headers: { 'User-Agent': UA, Referer: 'https://www.twitch.tv/' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Twitch answered HTTP ${response.status} for this video.`);
  const variants = parseVariants(await response.text(), usherUrl);

  // 1. La rendition chunked dichiarata dal manifest (VOD già elaborata).
  const chunked = variants
    .filter((variant) => variant.group === 'chunked' && variant.url)
    .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  const withinQuality = maxHeight
    ? chunked.filter((variant) => !variant.height || variant.height <= maxHeight)
    : chunked;
  for (const variant of withinQuality.length ? withinQuality : chunked) {
    if (await usablePlaylist(variant.url)) {
      log('Full video rendition found in the Twitch manifest.');
      return answer(variant.url, access.title);
    }
  }

  // 2. Il manifest elenca solo audio_only: la rendition chunked vive sullo
  //    stesso percorso del CDN (stessa cartella, segmento diverso).
  const audio = variants.find((variant) => variant.group === 'audio_only' && variant.url);
  if (audio) {
    const derived = chunkedFromAudioOnly(audio.url);
    if (derived && (await usablePlaylist(derived))) {
      log('Audio-only manifest: using the chunked rendition of the same CDN.');
      return answer(derived, access.title);
    }
  }

  // 3. Nessuna rendition chunked: resta il manifest originale per yt-dlp.
  if (variants.length) {
    log('No chunked rendition available: falling back to the declared streams.');
    return answer(usherUrl, access.title);
  }
  throw new Error('Twitch did not declare any downloadable stream for this video.');
}

function answer(url, title) {
  const headers = {
    referer: 'https://www.twitch.tv/',
    origin: 'https://www.twitch.tv',
    'user-agent': UA,
  };
  return { url, title: title || '', referer: headers.referer, headers };
}

module.exports = {
  UA,
  isTwitchHost,
  videoId,
  parseVariants,
  chunkedFromAudioOnly,
  resolveVod,
};
