/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Test offline del resolver: nessuna rete, pagine di esempio con la stessa
 * struttura dei player reali (embedUrl nello stato della pagina, iframe del
 * sito, window.streams e window.masterPlaylist con token ed expires).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const resolver = require('../src/main/resolver');
const downloader = require('../src/main/downloader');

const TOKEN = 'e8994211477b27eaddaffc998e7471f6';
const EXPIRES = '1797558507';
const STREAM = `https://cdn.vixcloud.co/hls/305266/master.m3u8?token=${TOKEN}&expires=${EXPIRES}`;
// base + parametri dell'embed + flag del server attivo + token/expires del player
const PLAYLIST =
  `https://vixcloud.co/playlist/305266?h=1&scz=1&lang=it&ub=1&token=${TOKEN}&expires=${EXPIRES}`;

const WATCH_HTML = `<!doctype html><html><head>
<title>Episodio 19 - La serie - StreamingCommunity</title></head>
<body><h1>Episodio 19 - La serie</h1>
<script>window.__data = {"props":{"embedUrl":"https:\\/\\/streamingcommunityz.shiksha\\/it\\/iframe\\/104?episode_id=3199&amp;next_episode=1"},"scws_url":"https:\\/\\/vixcloud.co"};</script>
<script src="https://analytics.vixcloud.co/js/script.js" data-domain="streamingcommunity.to"></script>
</body></html>`;

const SITE_IFRAME_HTML = `<!doctype html><html><body>
<iframe ref="iframe" src="https://vixcloud.co/embed/305266?token=c63f4d4225f9687625e902daf0677747&amp;referer=1&amp;expires=1792374737&amp;lang=it&amp;h=1&amp;scz=1" frameborder="0"></iframe>
</body></html>`;

const EMBED_HTML = `<html><head><title>VixCloud</title></head><body>
<script>
window.video = { id: '305266', filename: '', timestamps: [], };
window.streams = [{"name":"Server1","active":true,"url":"https:\\/\\/vixcloud.co\\/playlist\\/305266?ub=1"},{"name":"Server2","active":false,"url":"https:\\/\\/vixcloud.co\\/playlist\\/305266?ab=1"}];
window.masterPlaylist = { params: { 'token': '${TOKEN}', 'expires': '${EXPIRES}', 'asn': '', }, url: 'https://vixcloud.co/playlist/305266', }
window.canPlayFHD = true
</script>
</body></html>`;

const PLAYLIST_JSON = JSON.stringify({ id: 305266, src: STREAM });
const M3U8 = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080/index.m3u8\n';

function bodyFor(url) {
  const called = String(url);
  if (called.includes('/it/watch/')) return WATCH_HTML;
  if (called.includes('/it/iframe/')) return SITE_IFRAME_HTML;
  if (called.includes('/embed/')) return EMBED_HTML;
  if (called.includes('/playlist/')) return PLAYLIST_JSON;
  if (called.includes('.m3u8')) return M3U8;
  throw new Error(`Risorsa sconosciuta: ${called}`);
}

function labelFor(url) {
  const called = String(url);
  if (called.includes('/it/watch/')) return 'watch';
  if (called.includes('/it/iframe/')) return 'iframe';
  if (called.includes('/embed/')) return 'embed';
  if (called.includes('/playlist/')) return 'playlist';
  if (called.includes('.m3u8')) return 'stream';
  return 'altro';
}

function fakeFetch(calls) {
  return async (url) => {
    calls.push(labelFor(url));
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: String(url),
      text: async () => bodyFor(url),
    };
  };
}

const scenarios = [
  {
    name: 'link del sito: embedUrl nello stato, iframe del sito e player',
    url: 'https://streamingcommunityz.shiksha/it/watch/104?e=3199',
    expect: STREAM,
    calls: ['watch', 'iframe', 'embed', 'playlist'],
    title: 'Episodio 19 - La serie',
  },
  {
    name: 'link del player incollato direttamente',
    url: 'https://vixcloud.co/embed/305266?h=1&scz=1&lang=it',
    expect: STREAM,
    calls: ['embed', 'playlist'],
    title: 'VixCloud',
  },
  {
    name: 'link della playlist con token ed expires',
    url: `https://vixcloud.co/playlist/305266?token=${TOKEN}&expires=${EXPIRES}&h=1&scz=1&lang=it`,
    expect: STREAM,
    calls: ['playlist'],
    title: '',
  },
];

async function run() {
  const originalFetch = global.fetch;
  let passed = 0;
  try {
    for (const scenario of scenarios) {
      const calls = [];
      global.fetch = fakeFetch(calls);
      const logs = [];
      const result = await resolver.resolve(scenario.url, (line) => logs.push(line));
      assert.strictEqual(result.url, scenario.expect, `${scenario.name}: flusso errato`);
      assert.deepStrictEqual(calls, scenario.calls, `${scenario.name}: sequenza richieste errata`);
      assert.strictEqual(result.headers.referer, 'https://vixcloud.co/', `${scenario.name}: referer errato`);
      assert.strictEqual(result.headers.origin, 'https://cdn.vixcloud.co', `${scenario.name}: origin errato`);
      assert.strictEqual(result.title, scenario.title, `${scenario.name}: titolo errato`);
      assert.ok(logs.length >= 2, `${scenario.name}: log mancanti`);
      passed += 1;
      console.log(`ok - ${scenario.name}`);
    }

    // Lo stato della pagina viene letto anche con virgolette e slash escapati.
    assert.strictEqual(
      resolver.extractEmbedUrl(WATCH_HTML, 'https://streamingcommunityz.shiksha/it/watch/104?e=3199'),
      'https://streamingcommunityz.shiksha/it/iframe/104?episode_id=3199&next_episode=1',
      'embedUrl non estratto',
    );
    console.log('ok - embedUrl letto dallo stato escapato');
    passed += 1;

    // Le risorse del dominio del player (analytics, script) non sono candidati.
    const candidates = resolver.playerCandidates(WATCH_HTML, 'https://streamingcommunityz.shiksha/it/watch/104');
    assert.ok(
      candidates.every((url) => !/analytics\.vixcloud\.co/i.test(url)),
      'risorsa analytics considerata un player',
    );
    assert.ok(candidates[0].includes('/it/iframe/'), 'il player indicato dalla pagina non è il primo candidato');
    console.log('ok - script e analytics scartati dai candidati');
    passed += 1;

    // Playlist composta da window.masterPlaylist + window.streams.
    assert.strictEqual(
      resolver.extractPlaylist(EMBED_HTML, 'https://vixcloud.co/embed/305266?h=1&scz=1&lang=it'),
      PLAYLIST,
      'composizione della playlist errata',
    );
    console.log('ok - playlist composta da masterPlaylist, streams e parametri dell\'embed');
    passed += 1;

    // Embed in alta definizione senza h esplicito: la playlist deve chiedere h=1.
    assert.strictEqual(
      resolver.extractPlaylist(
        EMBED_HTML,
        'https://vixcloud.co/embed/305266?token=c63f4d&referer=1&lang=it&nextEpisode=1&canPlayFHD=1&scz=1',
      ),
      `https://vixcloud.co/playlist/305266?scz=1&lang=it&h=1&ub=1&token=${TOKEN}&expires=${EXPIRES}`,
      'flag h=1 mancante per un embed in alta definizione',
    );
    console.log('ok - playlist in alta definizione richiesta con h=1');
    passed += 1;

    // Varianti provate quando la playlist non dichiara h: h=1 per ultima.
    assert.deepStrictEqual(
      resolver.playlistVariants(`https://vixcloud.co/playlist/305266?token=${TOKEN}&expires=${EXPIRES}&scz=1`),
      [
        `https://vixcloud.co/playlist/305266?token=${TOKEN}&expires=${EXPIRES}&scz=1`,
        `https://vixcloud.co/playlist/305266?token=${TOKEN}&expires=${EXPIRES}&scz=1&h=1`,
      ],
      'varianti della playlist non calcolate',
    );
    assert.deepStrictEqual(
      resolver.playlistVariants(`https://vixcloud.co/playlist/305266?h=1&token=${TOKEN}`),
      [`https://vixcloud.co/playlist/305266?h=1&token=${TOKEN}`],
      'variante duplicata per una playlist che ha già h',
    );
    console.log('ok - varianti della playlist calcolate');
    passed += 1;

    // Il titolo del sito ("Watch ...") viene ripulito per il nome del file.
    assert.strictEqual(
      resolver.titleFromHtml('<title>Watch The Vampire Diaries S1:E19</title>'),
      'The Vampire Diaries S1:E19',
      'prefisso Watch non rimosso dal titolo',
    );
    assert.strictEqual(
      resolver.titleFromHtml(
        '<title>AnimeUnity ~ Attack on Titan OVA Streaming SUB ITA/ITA &amp; Download</title>',
      ),
      'Attack on Titan OVA',
      'titolo AnimeUnity non ripulito',
    );
    console.log('ok - titolo ripulito per il nome del file');
    passed += 1;

    // Riconoscimento dei link gestiti dal resolver.
    assert.ok(resolver.isSupported('https://streamingcommunityz.shiksha/it/watch/104?e=3199'));
    assert.ok(resolver.isSupported('https://vixcloud.co/embed/305266'));
    assert.ok(!resolver.isSupported('https://www.youtube.com/watch?v=abc'));
    console.log('ok - riconoscimento dei link gestiti');
    passed += 1;

    // Pagina del sito senza player.
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: String(url),
      text: async () => '<html><body><p>Nessun player</p></body></html>',
    });
    await assert.rejects(
      () => resolver.resolve('https://streamingcommunityz.shiksha/it/watch/1'),
      /Nessun player trovato|Richiesta diretta rifiutata|No player found|Direct request rejected/i,
      'pagina senza player non segnalata',
    );
    console.log('ok - pagina senza player gestita');
    passed += 1;

    // Player senza configurazione: link scaduto o pagina cambiata.
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: String(url),
      text: async () => '<html><body><script>window.streams = [];</script></body></html>',
    });
    await assert.rejects(
      () => resolver.resolve('https://vixcloud.co/embed/1'),
      /Playlist non trovata|Richiesta diretta rifiutata|Playlist not found|Direct request rejected/i,
      'player senza playlist non segnalato',
    );
    console.log('ok - player senza playlist gestito');
    passed += 1;

    // Errori HTTP esposti all'utente (senza Electron si ferma al percorso diretto).
    global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found', url: 'x', text: async () => '' });
    await assert.rejects(
      () => resolver.resolve('https://vixcloud.co/embed/1'),
      /404/,
      'errore HTTP non propagato',
    );
    console.log('ok - errore HTTP propagato');
    passed += 1;

    // --- Siti con player nascosto: animeunity e animesaturn ---
    const MEGA_STREAM =
      'https://cdn2.megaplay.su/hls/2e5aeb81-ccf0-49db-8946-46326bf0dbcc/playlist.m3u8';
    const ANIME_EMBED = `<html><body><script>
      window.video = { id: '93712' };
      window.streams = [{"name":"Server1","active":true,"url":"https:\\/\\/vixcloud.cc\\/playlist\\/93712?token=abc123&expires=1797622838"}];
      window.masterPlaylist = { params: { 'token': 'abc123', 'expires': '1797622838', }, url: 'https://vixcloud.cc/playlist/93712', }
    </script></body></html>`;
    const ANIME_PAGE = `<html><head><title>Attack on Titan OVA - AnimeUnity</title></head>
      <body><h1>Attack on Titan OVA</h1>
      <iframe src="https://animeunity.so/embed/673?ep=1"></iframe></body></html>`;

    global.fetch = async (url) => {
      const called = String(url);
      const body = called.includes('/embed/')
        ? ANIME_EMBED
        : called.includes('/playlist/')
          ? JSON.stringify({ src: MEGA_STREAM })
          : ANIME_PAGE;
      return { ok: true, status: 200, statusText: 'OK', url: called, text: async () => body };
    };
    assert.ok(resolver.isSupported('https://www.animeunity.to/anime/673-attack-on-titan-ova'));
    const anime = await resolver.resolve('https://www.animeunity.to/anime/673-attack-on-titan-ova');
    assert.strictEqual(anime.url, MEGA_STREAM, 'animeunity: flusso non trovato');
    assert.strictEqual(anime.title, 'Attack on Titan OVA', 'animeunity: titolo non pulito');
    assert.ok(anime.headers.referer.includes('vixcloud.cc'), 'animeunity: referer errato');
    console.log('ok - animeunity: iframe, token e titolo risolti');
    passed += 1;

    // Playlist scritta direttamente nella pagina (Playerjs di animesaturn).
    const SATURN_PAGE = `<html><head><title>One Piece ITA Episodio 940 - AnimeSaturn</title></head>
      <body><h1>One Piece ITA Episodio 940</h1>
      <script>var player = new Playerjs({file:"https:\\/\\/cdn2.megaplay.su\\/hls\\/abc\\/playlist.m3u8"});</script>
      </body></html>`;
    global.fetch = async (url) => {
      const called = String(url);
      const body = /\.m3u8/i.test(called) ? M3U8 : SATURN_PAGE;
      return { ok: true, status: 200, statusText: 'OK', url: called, text: async () => body };
    };
    const saturn = await resolver.resolve('https://animesaturn.ro/one-piece-ita-episode-940/');
    assert.strictEqual(saturn.url, 'https://cdn2.megaplay.su/hls/abc/playlist.m3u8', 'animesaturn: flusso non trovato');
    assert.strictEqual(saturn.title, 'One Piece ITA Episodio 940', 'animesaturn: titolo errato');
    console.log('ok - animesaturn: playlist letta dallo script della pagina');
    passed += 1;

    // Link di un sito qualunque: resolveAuto usa la stessa ricerca.
    global.fetch = async (url) => {
      const called = String(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        url: called,
        text: async () => (/\.m3u8/i.test(called) ? M3U8 : SATURN_PAGE),
      };
    };
    const auto = await resolver.resolveAuto('https://sito-sconosciuto.example/episodio-1');
    assert.strictEqual(auto.url, 'https://cdn2.megaplay.su/hls/abc/playlist.m3u8', 'resolveAuto: flusso non trovato');
    console.log('ok - resolveAuto trova il flusso anche per un sito sconosciuto');
    passed += 1;

    // --- Video nativo: link TikTok e mp4 dichiarati nella pagina ---
    assert.strictEqual(
      resolver.tiktokVideoId('https://www.tiktok.com/@moli/video/7412345678901234567?is_from_webapp=1'),
      '7412345678901234567',
      'id TikTok non riconosciuto',
    );
    assert.strictEqual(
      resolver.tiktokVideoId('https://www.tiktok.com/embed/v2/7412345678901234567'),
      '7412345678901234567',
      'id TikTok non riconosciuto nel player incorporato',
    );
    assert.strictEqual(resolver.tiktokVideoId('https://vm.tiktok.com/ZMabc123/'), '', 'link breve scambiato per un id');
    console.log('ok - id del video TikTok riconosciuto');
    passed += 1;

    // TikTok dichiara il video in JSON con gli slash escapati; il player
    // incorporato lo mette in un tag <video src>.
    const TIKTOK_JSON = `<script>{"video":{"playAddr":"https:\\/\\/v16-webapp.tiktok.com\\/video\\/tos\\/useast5\\/abc\\/?a=1988&mime_type=video_mp4"}}</script>`;
    assert.ok(
      resolver.mediaCandidates(TIKTOK_JSON, 'https://www.tiktok.com/embed/v2/1').includes(
        'https://v16-webapp.tiktok.com/video/tos/useast5/abc/?a=1988&mime_type=video_mp4',
      ),
      'playAddr TikTok non estratto',
    );
    const NATIVE_PAGE = `<html><body><video id="player" src="/media/clip%20finale.mp4" poster="x.jpg"></video>
      <source src="https://cdn.example.com/film.webm"></body></html>`;
    const nativeList = resolver.mediaCandidates(NATIVE_PAGE, 'https://www.example.com/articolo/1');
    assert.ok(nativeList.includes('https://www.example.com/media/clip%20finale.mp4'), 'mp4 relativo non risolto');
    assert.ok(nativeList.includes('https://cdn.example.com/film.webm'), 'webm della pagina non trovato');
    console.log('ok - mp4/webm nativi trovati nella pagina');
    passed += 1;

    assert.strictEqual(
      resolver.titleFromMediaUrl('https://cdn.example.com/video/My%20Clip_finale.mp4?token=1'),
      'My Clip finale',
      'titolo dal link diretto errato',
    );
    console.log('ok - titolo ricavato da un link video diretto');
    passed += 1;

    // --- Nome del file: il titolo della pagina, non l'id del CDN ---
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moli-args-'));
    const args = downloader.buildArgs(
      'https://cdn.vixcloud.co/hls/74657/master.m3u8?token=x',
      { output_dir: outDir, quality: 'best' },
      'yt-dlp',
      '',
      process.execPath,
      { title: 'Attack on Titan OVA', headers: {} },
    );
    const output = args[args.indexOf('-o') + 1];
    // Il template resta relativo: la cartella finale arriva da --paths home.
    assert.strictEqual(output, 'Attack on Titan OVA.%(ext)s', 'nome file dal titolo errato');
    assert.ok(args.includes(`home:${outDir}`), 'cartella di output mancante dai --paths');
    const withoutTitle = downloader.buildArgs(
      'https://cdn.vixcloud.co/hls/74657/master.m3u8?token=x',
      { output_dir: outDir, output_template: '%(title)s.%(ext)s' },
      'yt-dlp',
      '',
      process.execPath,
      { headers: {} },
    );
    assert.strictEqual(
      withoutTitle[withoutTitle.indexOf('-o') + 1],
      '%(title)s.%(ext)s',
      'template di fallback non rispettato',
    );
    assert.ok(withoutTitle.includes(`home:${outDir}`), 'cartella di output mancante dal fallback');
    assert.strictEqual(
      downloader.titleFromUrl('https://animesaturn.ro/one-piece-ita-episode-940/'),
      'One Piece ITA Episode 940',
      'titolo ricavato dal link errato',
    );
    console.log('ok - nome del file dal titolo della pagina');
    passed += 1;

    console.log(`\n${passed} test superati`);
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error('TEST FALLITO:', error.message);
  process.exitCode = 1;
});
