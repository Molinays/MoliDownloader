/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Traduce gli errori grezzi di yt-dlp, FFmpeg e del resolver in messaggi
 * dell'app: un codice, un titolo, una spiegazione e l'azione da proporre.
 * Il modulo e` puro JavaScript e viene usato sia dal processo principale sia
 * dal renderer, cosi` la scheda in coda e il popup dicono la stessa cosa.
 */

const links = require('./links');

/**
 * Ogni tipo ha: codice, icona (glifo mostrato nel popup), titolo, messaggio,
 * suggerimento e azione. {service} diventa il nome del sito quando lo si
 * conosce ("YouTube", "Twitch"...), altrimenti "this site".
 */
const KINDS = {
  login: {
    code: 'MD-101',
    icon: 'lock',
    title: 'This link needs an account',
    message:
      '{service} asks for a signed-in session before it plays this link. Without that session the download cannot start.',
    hint: 'Sign in in your browser, come back here and press Retry: the download can use those cookies automatically.',
    action: 'login',
  },
  private: {
    code: 'MD-102',
    icon: 'lock',
    title: 'This content is private',
    message:
      'The owner of this link did not make it public, so it cannot be read without being signed in as that account.',
    hint: 'Open the link in your browser: if you can watch it there, sign in with that account and retry with browser cookies enabled.',
    action: 'login',
  },
  members: {
    code: 'MD-103',
    icon: 'lock',
    title: 'Only for members or subscribers',
    message:
      'This video is reserved for a paid membership channel. yt-dlp can read it only from an account that is subscribed.',
    hint: 'Sign in with the subscribed account in your browser, then retry: the app can borrow those cookies.',
    action: 'login',
  },
  geo: {
    code: 'MD-201',
    icon: 'globe',
    title: 'Locked to another country',
    message:
      'The site serves this content only in some countries and your network is outside that list.',
    hint: 'Try a proxy or VPN from the right country in Advanced mode. The app cannot bypass a regional block on its own.',
    action: 'none',
  },
  removed: {
    code: 'MD-202',
    icon: 'cross',
    title: 'This link no longer exists',
    message:
      'The page answers as missing: the video may have been deleted, set to private after it was shared, or the address may be mistyped.',
    hint: 'Open the link in a browser to check it, then paste the working address again.',
    action: 'none',
  },
  live: {
    code: 'MD-203',
    icon: 'clock',
    title: 'Not started yet',
    message:
      'This page is a scheduled premiere or a live event that has not begun, so there is no recording to save yet.',
    hint: 'Wait for it to start and download it while it is live, or come back when the recording is ready.',
    action: 'none',
  },
  unsupported: {
    code: 'MD-301',
    icon: 'plug',
    title: 'This site is not supported',
    message:
      'yt-dlp has no extractor for this address, and the built-in player did not find a video stream on the page.',
    hint: 'Update yt-dlp from Info: new sites are added all the time. If it already is the latest version, the site probably hides the video behind a script.',
    action: 'update',
  },
  format: {
    code: 'MD-302',
    icon: 'wave',
    title: 'No usable stream found',
    message:
      'The page answered, but none of its streams can be saved as a normal file: the player may only deliver fragments or encrypt them.',
    hint: 'Try the link again from the site, or pick a different quality. If the site changed its player, update yt-dlp.',
    action: 'retry',
  },
  audioOnly: {
    code: 'MD-303',
    icon: 'wave',
    title: 'The site sent only the audio track',
    message:
      'The download worked, but the file has no video track: the site served the audio version of this link.',
    hint: 'Try again in a few minutes: several platforms publish video and audio separately, and the video side was not ready.',
    action: 'retry',
  },
  twitchProcessing: {
    code: 'MD-304',
    icon: 'wave',
    title: 'Twitch is still preparing this video',
    message:
      'The VOD exists, but Twitch served only the audio track. Its video rendition is not available yet for this recording.',
    hint: 'Wait a few minutes and retry: once Twitch finishes the video rendition the app downloads the full stream with sound.',
    action: 'retry',
  },
  token: {
    code: 'MD-401',
    icon: 'key',
    title: 'The stream link expired',
    message:
      'The player gave a temporary link that is no longer valid. These tokens usually last a few minutes.',
    hint: 'Press Retry: the app asks the site for a fresh token and starts the download again.',
    action: 'retry',
  },
  rate: {
    code: 'MD-402',
    icon: 'clock',
    title: 'The site is limiting requests',
    message:
      'The server answered "too many requests": it is asking the app to slow down before serving more data.',
    hint: 'Wait a minute and retry. Lowering parallel downloads in Advanced mode also helps.',
    action: 'retry',
  },
  network: {
    code: 'MD-403',
    icon: 'plug',
    title: 'Connection interrupted',
    message:
      'The download stopped while talking to the server: the connection dropped, the proxy refused it or the site stopped responding.',
    hint: 'Check the network and press Retry. If you use a proxy, make sure it is running.',
    action: 'retry',
  },
  disk: {
    code: 'MD-501',
    icon: 'disk',
    title: 'The file could not be written',
    message:
      'The system refused to write the output file: the disk is full, the folder is read-only or the path is too long.',
    hint: 'Free some space or choose another folder in Advanced mode, then retry.',
    action: 'none',
  },
  ffmpeg: {
    code: 'MD-502',
    icon: 'wave',
    title: 'FFmpeg could not finish the file',
    message:
      'The video and audio tracks were downloaded, but joining or converting them failed. The source format is unusual or partly broken.',
    hint: 'Try a different format or quality. Updating yt-dlp and FFmpeg from Info fixes most of these cases.',
    action: 'update',
  },
  playlist: {
    code: 'MD-601',
    icon: 'list',
    title: 'Nothing to download in this playlist',
    message:
      'The playlist was read, but it has no playable entries: it may be empty, private, or filled with unavailable items.',
    hint: 'Open the playlist in your browser to check it, then paste the link again.',
    action: 'none',
  },
  spotify: {
    code: 'MD-602',
    icon: 'note',
    title: 'Spotify could not be read',
    message:
      'The public page of this Spotify link did not list its tracks. Spotify serves the track list only for links that are public.',
    hint: 'Check that the playlist or album is public, then paste the link again. Single tracks work from the normal share link.',
    action: 'retry',
  },
  engine: {
    code: 'MD-701',
    icon: 'plug',
    title: 'The download engines are missing',
    message:
      'yt-dlp or FFmpeg is not installed in the app folder, so nothing can be downloaded or converted.',
    hint: 'Open Info and press the install button for the missing engine, then try again.',
    action: 'update',
  },
  unknown: {
    code: 'MD-900',
    icon: 'cross',
    title: 'Download failed',
    message: 'The download stopped before the file was complete.',
    hint: 'Open the log to see what the site answered. Retrying usually works when the cause was temporary.',
    action: 'retry',
  },
};

function text(value) {
  return String(value == null ? '' : value)
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ordine di controllo: i casi specifici vengono prima di quelli generici. */
const RULES = [
  {
    kind: 'engine',
    test: /yt-dlp not found|ffmpeg (?:not found|is missing)|engines? (?:are )?missing|spawn .*enoent/i,
  },
  {
    kind: 'playlist',
    test: /playlist is empty|did not list any playable|does not contain any playable|no entries (?:were )?found|empty playlist/i,
  },
  {
    kind: 'spotify',
    test: /could not read this spotify|spotify did not list|this is not a valid spotify link|spotify returned http/i,
  },
  {
    kind: 'members',
    test: /members[- ]only|only available to (?:members|subscribers|sponsors)|subscriber[- ]only|is only available to subscribers|paid membership/i,
  },
  {
    kind: 'private',
    test: /private video|this video is private|is private|has been made private|access denied.*private/i,
  },
  {
    kind: 'login',
    test: /sign in|log ?in required|login required|requires? (?:a )?(?:login|sign[- ]?in|account|authentication)|not a bot|confirm you(?:'|’)re not a bot|authentication required|account (?:is )?required|cookies? (?:are )?(?:needed|required)|requested content is not available, rate-limit reached or login required|may require a login|http error 401|unauthorized/i,
  },
  {
    kind: 'geo',
    test: /not available in your country|geo[- ]?(?:blocked|restricted)|blocked in your country|unavailable in your region|region[- ]locked/i,
  },
  {
    kind: 'live',
    test: /will begin in|premiere will|live event will|not started yet|is not live yet/i,
  },
  {
    kind: 'removed',
    test: /video unavailable|this video is unavailable|has been removed|no longer available|does not exist|has been deleted|content is not available|http error (?:404|410)|gone\b/i,
  },
  {
    kind: 'twitchProcessing',
    test: /twitch is still processing|only audio is available right now/i,
  },
  {
    kind: 'audioOnly',
    test: /only returned an audio stream|no video to save|audio stream.*no video|file has no video/i,
  },
  {
    kind: 'token',
    test: /token|expired|link may have expired|the player rejected the stream|http error 403|forbidden/i,
  },
  {
    kind: 'rate',
    test: /http error 429|too many requests|rate[- ]?limit|slow down/i,
  },
  {
    kind: 'ffmpeg',
    test: /ffmpeg|ffprobe|postprocess|conversion failed|merging of multiple formats|unable to merge/i,
  },
  {
    kind: 'disk',
    test: /no space left|enospc|permission denied|eacces|eperm|read-only file system|disk (?:is )?full|filename too long|path too long|unable to (?:write|open) (?:file|data)/i,
  },
  {
    kind: 'unsupported',
    test: /unsupported url|no suitable extractor|is not a valid url|no video found on the page|this site is not supported|no video formats found/i,
  },
  {
    kind: 'format',
    test: /no downloadable|no usable stream|did not point to a playlist|no stream found|player did not (?:load|request)|cannot download|stream not found/i,
  },
  {
    kind: 'network',
    test: /getaddrinfo|enotfound|econnreset|econnrefused|etimedout|network|connection|timed out|timeout|ssl|certificate|remote end closed|temporary failure|unable to download (?:video|web) data/i,
  },
  {
    kind: 'format',
    test: /unable to extract|extractor error|unexpected response|player response|signature/i,
  },
];

function serviceName(context) {
  if (context && context.serviceLabel) return context.serviceLabel;
  const url = context && context.url ? context.url : '';
  const label = url ? links.info(url).serviceLabel : '';
  return label || 'This site';
}

/**
 * Restituisce { code, kind, icon, title, message, hint, action, loginUrl, raw }.
 * `raw` e` il messaggio originale, utile nel log e nel popup.
 */
function explain(input, context) {
  const raw = text(input);
  const ctx = context || {};
  let kind = 'unknown';
  for (const rule of RULES) {
    if (rule.test.test(raw)) {
      kind = rule.kind;
      break;
    }
  }
  const source = KINDS[kind] || KINDS.unknown;
  const service = serviceName(ctx);
  const url = ctx.url || '';
  return {
    code: source.code,
    kind,
    icon: source.icon,
    title: source.title,
    message: source.message.replace(/\{service\}/g, service),
    hint: source.hint,
    action: source.action,
    serviceLabel: service === 'This site' ? '' : service,
    loginUrl: url ? links.loginUrlFor(url) : '',
    raw,
  };
}

module.exports = {
  KINDS,
  explain,
  text,
};
