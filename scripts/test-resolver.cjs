/* MoliDowloader — Copyright © 2026 Molinays · SPDX-License-Identifier: MIT */
'use strict';

/**
 * Test offline del resolver: nessuna rete, pagine di esempio con la stessa
 * struttura dei player reali (iframe annidati, window.streams, token/expires).
 */

const assert = require('assert');
const resolver = require('../src/main/resolver');

const TOKEN = 'cb708d6f416b0e673718daab4c41bcfe';
const EXPIRES = '1797552804';
const STREAM = `https://cdn.vixcloud.co/hls/305264/master.m3u8?token=${TOKEN}&expires=${EXPIRES}`;
const PLAYLIST = `https://vixcloud.co/playlist/305264?h=1&scz=1&lang=it&token=${TOKEN}&expires=${EXPIRES}`;

const WATCH_HTML = `<!doctype html><html><head>
<title>Episodio 1 - La serie - StreamingCommunity</title></head>
<body><h1>Episodio 1 - La serie</h1>
<div id="player"><iframe src="/it/iframe/104?episode_id=3197&amp;next_episode=1"></iframe></div>
</body></html>`;

const IFRAME_HTML = `<!doctype html><html><body>
<iframe src="https://vixcloud.co/embed/305264?h=1&amp;scz=1&amp;lang=it"></iframe>
</body></html>`;

const DIRECT_WATCH_HTML = `<!doctype html><html><head>
<title>Episodio 1 - La serie - StreamingCommunity</title></head>
<body><h1>Episodio 1 - La serie</h1>
<iframe src="https://vixcloud.co/embed/305264?h=1&amp;scz=1&amp;lang=it"></iframe>
</body></html>`;

// Il player reale dichiara i server in window.streams e token/expires in window.masterPlaylist.
const EMBED_HTML = `<html><head><title>VixCloud</title></head><body>
<script>
window.masterPlaylist = {"params":{'token':'${TOKEN}','expires':'${EXPIRES}'}};
window.streams = [{"name":"VixCloud","url":"https:\\/\\/vixcloud.co\\/playlist\\/305264?h=1&scz=1&lang=it","active":true}];
</script>
</body></html>`;

const PLAYLIST_JSON = JSON.stringify({ id: 305264, src: STREAM });

const M3U8 = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\n1080/index.m3u8\n';

function bodyFor(url) {
  const called = String(url);
  if (called.includes('streamingcommunity.best')) return DIRECT_WATCH_HTML;
  if (called.includes('/it/watch/')) return WATCH_HTML;
  if (called.includes('/it/iframe/')) return IFRAME_HTML;
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
    name: 'link del sito con iframe annidati fino al player',
    url: 'https://streamingcommunityz.shiksha/it/watch/104?e=3197',
    expect: STREAM,
    calls: ['watch', 'iframe', 'embed', 'playlist'],
    title: 'Episodio 1 - La serie',
  },
  {
    name: 'pagina del sito con player VixCloud diretto',
    url: 'https://streamingcommunity.best/it/watch/104?e=3197',
    expect: STREAM,
    calls: ['watch', 'embed', 'playlist'],
    title: 'Episodio 1 - La serie',
  },
  {
    name: 'link di embed incollato direttamente',
    url: 'https://vixcloud.co/embed/305264?h=1&scz=1&lang=it',
    expect: STREAM,
    calls: ['embed', 'playlist'],
    title: 'VixCloud',
  },
  {
    name: 'link della playlist con token ed expires',
    url: `https://vixcloud.co/playlist/305264?token=${TOKEN}&expires=${EXPIRES}&h=1&scz=1&lang=it`,
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

    // Il player espone solo il percorso della playlist: token ed expires vanno aggiunti.
    assert.strictEqual(
      resolver.extractPlaylist(EMBED_HTML, 'https://vixcloud.co/embed/305264?h=1&scz=1&lang=it'),
      PLAYLIST,
      'composizione della playlist errata',
    );
    console.log('ok - token ed expires uniti al percorso della playlist');
    passed += 1;

    // Riconoscimento dei link gestiti dal resolver.
    assert.ok(resolver.isSupported('https://streamingcommunityz.shiksha/it/watch/104?e=3197'));
    assert.ok(resolver.isSupported('https://vixcloud.co/embed/305264'));
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
      /Nessun player trovato/,
      'pagina senza player non segnalata',
    );
    console.log('ok - pagina senza player gestita');
    passed += 1;

    // Player senza configurazione: link scaduto o pagina cambiata.
    global.fetch = async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://vixcloud.co/embed/1',
      text: async () => '<html><body><script>window.streams = [];</script></body></html>',
    });
    await assert.rejects(
      () => resolver.resolve('https://vixcloud.co/embed/1'),
      /Playlist non trovata/,
      'player senza playlist non segnalato',
    );
    console.log('ok - player senza playlist gestito');
    passed += 1;

    // Errori HTTP esposti all'utente.
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
