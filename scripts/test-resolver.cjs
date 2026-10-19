/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Test offline del resolver: nessuna rete, pagine di esempio con la stessa
 * struttura dei player reali (embedUrl nello stato della pagina, iframe del
 * sito, window.streams e window.masterPlaylist con token ed expires).
 */

const assert = require('assert');
const resolver = require('../src/main/resolver');

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

    // Il titolo del sito ("Watch ...") viene ripulito per il nome del file.
    assert.strictEqual(
      resolver.titleFromHtml('<title>Watch The Vampire Diaries S1:E19</title>'),
      'The Vampire Diaries S1:E19',
      'prefisso Watch non rimosso dal titolo',
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
      /Nessun player trovato|Richiesta diretta rifiutata/,
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
      /Playlist non trovata|Richiesta diretta rifiutata/,
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

    console.log(`\n${passed} test superati`);
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch((error) => {
  console.error('TEST FALLITO:', error.message);
  process.exitCode = 1;
});
