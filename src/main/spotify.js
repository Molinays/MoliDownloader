/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Spotify non espone un flusso scaricabile (le tracce sono protette da DRM).
 * Per i link pubblici leggiamo la tracklist dalla pagina di embed ufficiale e
 * cerchiamo ogni brano su YouTube: il download resta un normale audio yt-dlp.
 */

const links = require('../shared/links');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const SPOTIFY_TYPES = new Set(['playlist', 'album', 'track']);

function spotifyLink(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (!/(?:^|\.)spotify\.com$/i.test(parsed.hostname)) return null;
    // Il percorso puo` avere un prefisso di lingua: /it/, /pt-BR/ e /intl-it/.
    const parts = links.spotifyParts(parsed.pathname);
    if (!parts || !SPOTIFY_TYPES.has(parts.type)) return null;
    return parts;
  } catch {
    return null;
  }
}

function isSpotify(rawUrl) {
  return Boolean(spotifyLink(rawUrl));
}

function nextData(html) {
  const match = String(html || '').match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i,
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function entityFrom(html) {
  const data = nextData(html);
  const state = data && data.props && data.props.pageProps && data.props.pageProps.state;
  const entity = state && state.data && state.data.entity;
  if (entity && typeof entity === 'object') return entity;
  return null;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Artisti da un'entita` Spotify: stringa piatta o elenco { name }. */
function artistsOf(value) {
  if (Array.isArray(value)) {
    return cleanText(value.map((entry) => (entry && (entry.name || entry.title)) || '').filter(Boolean).join(', '));
  }
  return cleanText(value);
}

function tracksFrom(entity, fallbackId = '') {
  const list = Array.isArray(entity.trackList) ? entity.trackList : [];
  const tracks = [];
  for (const item of list) {
    if (!item || item.entityType === 'episode') continue;
    const title = cleanText(item.title || item.name);
    if (!title) continue;
    const artists = artistsOf(item.subtitle || item.artists);
    const url = item.uri && /^spotify:track:/.test(item.uri)
      ? `https://open.spotify.com/track/${item.uri.split(':').pop()}`
      : '';
    tracks.push({ title, artists, url });
  }
  // Un link diretto a una traccia non ha trackList: il brano e` l'entita`.
  if (!tracks.length && (entity.type === 'track' || entity.type === 'episode')) {
    const title = cleanText(entity.title || entity.name);
    if (title) {
      const id = entity.id || fallbackId;
      tracks.push({
        title,
        artists: artistsOf(entity.artists) || cleanText(entity.subtitle),
        url: id ? `https://open.spotify.com/track/${id}` : '',
      });
    }
  }
  return tracks;
}

async function fetchEntity(type, id) {
  const url = `https://open.spotify.com/embed/${type}/${id}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Spotify returned HTTP ${response.status}. Check that the link is public.`);
  }
  const html = await response.text();
  const entity = entityFrom(html);
  if (!entity) {
    throw new Error('Could not read this Spotify page. Use a public playlist, album, or track link.');
  }
  return entity;
}

/**
 * Restituisce { title, type, tracks: [{ title, artists, url }] }.
 * Non scarica nulla: prepara solo la coda dei brani.
 */
async function expand(rawUrl) {
  const link = spotifyLink(rawUrl);
  if (!link) throw new Error('This is not a valid Spotify link.');
  const entity = await fetchEntity(link.type, link.id);
  const tracks = tracksFrom(entity, link.id);
  if (!tracks.length) {
    throw new Error('Spotify did not list any playable tracks. The playlist may be private or empty.');
  }
  return {
    title: cleanText(entity.title || entity.name) || 'Spotify',
    type: link.type,
    tracks: tracks.slice(0, 200),
  };
}

function searchQuery(track) {
  const artists = track.artists ? ` ${track.artists}` : '';
  return `ytsearch1:${track.title}${artists} audio`;
}

module.exports = {
  isSpotify,
  spotifyLink,
  expand,
  searchQuery,
};
