/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Riconosce il tipo di link incollato nell'app (video, playlist, album, ecc.).
 * Il modulo e` puro JavaScript: lo usano sia il processo principale sia il
 * renderer (via preload), cosi` la coda e i suggerimenti visivi non possono
 * divergere.
 */

const SERVICE_LABELS = {
  youtube: 'YouTube',
  'youtube-music': 'YouTube Music',
  spotify: 'Spotify',
  twitch: 'Twitch',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  reddit: 'Reddit',
  bandcamp: 'Bandcamp',
  generic: '',
};

/** Pagina di accesso ufficiale di ogni servizio (pulsante "Sign in"). */
const LOGIN_URLS = {
  youtube: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F',
  'youtube-music': 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com%2F',
  spotify: 'https://accounts.spotify.com/login',
  twitch: 'https://www.twitch.tv/login',
  soundcloud: 'https://soundcloud.com/signin',
  tiktok: 'https://www.tiktok.com/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  facebook: 'https://www.facebook.com/login/',
  x: 'https://x.com/i/flow/login',
  vimeo: 'https://vimeo.com/log_in',
  dailymotion: 'https://www.dailymotion.com/signin',
  reddit: 'https://www.reddit.com/login/',
};

function normalize(rawUrl) {
  let value = String(rawUrl || '').trim();
  if (!value) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  return value;
}

function hostOf(rawUrl) {
  try {
    return new URL(normalize(rawUrl)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Servizio a partire dall'host (music.youtube.com prima di youtube.com). */
function serviceOf(host) {
  if (!host) return 'generic';
  if (host === 'music.youtube.com') return 'youtube-music';
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
  if (host === 'open.spotify.com' || host === 'spotify.com' || host.endsWith('.spotify.com')) return 'spotify';
  if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
  if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return 'facebook';
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'x';
  if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) return 'vimeo';
  if (host === 'dailymotion.com' || host === 'dai.ly' || host.endsWith('.dailymotion.com')) return 'dailymotion';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
  if (host.endsWith('.bandcamp.com') || host === 'bandcamp.com') return 'bandcamp';
  return 'generic';
}

/** URL della pagina di accesso, anche per i siti non in elenco. */
function loginUrlFor(rawUrl) {
  const service = serviceOf(hostOf(rawUrl));
  if (LOGIN_URLS[service]) return LOGIN_URLS[service];
  try {
    return `${new URL(normalize(rawUrl)).origin}/`;
  } catch {
    return '';
  }
}

/** Link Spotify con prefisso di lingua: /it/, /pt-BR/ e anche /intl-it/. */
function spotifyParts(pathname) {
  const match = String(pathname || '').match(
    /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?|[a-z]{2}(?:-[a-z]{2})?)?\/?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/i,
  );
  if (!match) return null;
  return { type: match[1].toLowerCase(), id: match[2] };
}

/**
 * Informazioni sul link:
 * { url, host, service, serviceLabel, kind, isPlaylist, hasPlaylist,
 *   playlistId, playlistLabel, loginUrl }
 */
function info(rawUrl) {
  const url = normalize(rawUrl);
  const empty = {
    url,
    host: '',
    service: 'generic',
    serviceLabel: '',
    kind: 'unknown',
    isPlaylist: false,
    hasPlaylist: false,
    playlistId: '',
    playlistLabel: '',
    loginUrl: '',
  };
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const service = serviceOf(host);
  const serviceLabel = SERVICE_LABELS[service] || '';
  const result = {
    ...empty,
    host,
    service,
    serviceLabel,
    loginUrl: loginUrlFor(url),
  };

  if (service === 'spotify') {
    const parts = spotifyParts(parsed.pathname);
    if (!parts) return result;
    result.kind = parts.type === 'track' ? 'track' : parts.type;
    result.isPlaylist = parts.type === 'playlist' || parts.type === 'album';
    result.playlistId = parts.isPlaylist ? parts.id : '';
    result.playlistLabel = parts.type === 'album' ? 'Spotify album' : parts.type === 'playlist' ? 'Spotify playlist' : '';
    return result;
  }

  if (service === 'youtube' || service === 'youtube-music') {
    const list = parsed.searchParams.get('list') || '';
    const videoId = parsed.searchParams.get('v') || '';
    const path = parsed.pathname;
    const isPlaylistPath = /^\/(?:playlist|browse)\/?$/i.test(path) || (service === 'youtube-music' && /^\/playlist\/?$/i.test(path));
    if (isPlaylistPath && list) {
      result.kind = 'playlist';
      result.isPlaylist = true;
      result.hasPlaylist = true;
      result.playlistId = list;
      result.playlistLabel = `${serviceLabel} playlist`;
      return result;
    }
    if (list && !videoId) {
      result.kind = 'playlist';
      result.isPlaylist = true;
      result.hasPlaylist = true;
      result.playlistId = list;
      result.playlistLabel = `${serviceLabel} playlist`;
      return result;
    }
    result.hasPlaylist = Boolean(list);
    result.playlistId = list;
    if (/^\/shorts\//i.test(path)) result.kind = 'video';
    else if (/^\/(?:channel|c|user|@|results)\b/i.test(path)) result.kind = 'channel';
    else result.kind = 'video';
    return result;
  }

  if (service === 'twitch') {
    if (/^\/videos\/\d+/i.test(parsed.pathname)) {
      result.kind = 'video';
      return result;
    }
    if (/^\/clip\//i.test(parsed.pathname) || /^clips\.twitch\.tv$/i.test(host)) {
      result.kind = 'clip';
      return result;
    }
    return { ...result, kind: 'live' };
  }

  if (service === 'soundcloud') {
    const isSet = /\/sets\/[^/]+/i.test(parsed.pathname);
    return {
      ...result,
      kind: isSet ? 'playlist' : 'track',
      isPlaylist: isSet,
      playlistLabel: isSet ? 'SoundCloud playlist' : '',
    };
  }

  if (service === 'tiktok') return { ...result, kind: 'video' };
  if (service === 'instagram') return { ...result, kind: 'video' };
  if (service === 'facebook') return { ...result, kind: 'video' };
  if (service === 'x') return { ...result, kind: 'video' };
  if (service === 'vimeo') return { ...result, kind: 'video' };
  if (service === 'dailymotion') return { ...result, kind: 'video' };
  if (service === 'reddit') return { ...result, kind: 'video' };

  // Siti non in elenco: una playlist si riconosce dal percorso o dal parametro list.
  const looksPlaylist =
    /\/playlist(?:\/|$)/i.test(parsed.pathname) || Boolean(parsed.searchParams.get('list'));
  return {
    ...result,
    kind: looksPlaylist ? 'playlist' : 'video',
    isPlaylist: looksPlaylist,
    playlistLabel: looksPlaylist ? `${host} playlist` : '',
  };
}

function isPlaylistLink(rawUrl) {
  return info(rawUrl).isPlaylist;
}

module.exports = {
  SERVICE_LABELS,
  LOGIN_URLS,
  info,
  hostOf,
  serviceOf,
  loginUrlFor,
  spotifyParts,
  isPlaylistLink,
};
