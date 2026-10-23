# MoliDowloader 3.4.0

App desktop **Electron** che unisce un downloader universale, un piccolo editor video/audio e un compressore in stile HandBrake, tutti basati su **FFmpeg**.

> Copyright © 2026 **Molinays** — distribuito con [licenza MIT](LICENSE). Il repository pubblico distribuisce **solo gli eseguibili**.

## Funzioni

### Download
- **Easy mode**: un link, Video o Audio, cartella e un solo pulsante; la modalità Advanced resta a un clic. Il link incollato resta lo stesso passando da una modalità all'altra, con sfondo animato e alone nella schermata semplice.
- Supporto a tutti i siti gestiti da **yt-dlp**: YouTube, TikTok, Instagram, Facebook, X/Twitter, Vimeo, Twitch, SoundCloud e oltre 1000 altri.
- **Riconoscimento delle playlist**: YouTube Music, Spotify, SoundCloud e i link `playlist` vengono riconosciuti sotto il campo e in coda, con l'etichetta *Playlist detected*, il nome del gruppo e il conteggio degli elementi. Un link che è una playlist viene scaricato per intero anche con il toggle disattivato; un link a una singola traccia resta una scheda singola.
- **Errori in tema**: ogni errore di yt-dlp, FFmpeg o del resolver diventa un popup con codice (MD-101 accesso, MD-202 contenuto rimosso, MD-303 solo audio, MD-401 token scaduto...), spiegazione, suggerimento e pulsanti per rimediare (accedi, riprova, aggiorna yt-dlp, apri il log).
- **Accesso richiesto**: se un contenuto ha bisogno di un account, il popup ricorda di collegarsi e offre il pulsante *Sign in* che apre la pagina di accesso del sito; con i cookie del browser il download riparte senza copiare nulla a mano.
- YouTube funziona senza installare Deno o Node: le sfide JavaScript vengono risolte con il runtime Node incorporato in Electron.
- Più link contemporaneamente (uno per riga), con coda e massimo 2 download in parallelo.
- Video: Best, 4K, 1440p, 1080p, 720p, 480p, 360p con merge automatico in MP4.
- Audio: MP3, M4A, Opus, FLAC, WAV con bitrate selezionabile.
- Playlist, sottotitoli, embed cover/metadata, SponsorBlock, geo-bypass, proxy, rate limit, retry, frammenti paralleli.
- Cookie da Chrome/Firefox/Edge/Brave/Opera per contenuti che richiedono login (Instagram, TikTok privati, ecc.).
- Link dei siti con player protetto (StreamingCommunity e mirror): il resolver legge la pagina del sito, segue l'iframe fino al player VixCloud e recupera la playlist HLS con token ed expires, poi la passa a yt-dlp. Accetta anche il link del player o della playlist incollato direttamente. Se il sito rifiuta le richieste dirette, il player viene caricato in una finestra Electron nascosta (JavaScript e cookie veri) e il flusso viene letto da lì.
- Log in tempo reale, annullamento, apertura cartella e passaggio diretto all'editor.
- **Spotify**: link `open.spotify.com` anche con prefisso di lingua (`/it/`, `/intl-it/`) o parametro `?si=`. Playlist e album vengono espansi nell'embed pubblico e ogni brano viene cercato su YouTube con artista e titolo; una traccia singola non viene più mostrata come playlist da 1 elemento.
- **Twitch**: per le VOD servite con la sola traccia audio, l'app chiede il token pubblico alla API web, legge il manifest usher e usa la rendition *chunked* dello stesso CDN (video e audio insieme) al posto del solo audio.
- Aggiornamento di yt-dlp integrato nell'app.

### Editor
- Import di clip video/audio o drag & drop nella finestra.
- Timeline con riordino drag & drop, duplicazione e rimozione.
- Trim di ogni clip con cursori In/Out, waveform, campi numerici al centesimo e pulsanti "IN/OUT = cursore".
- **Dividi** la clip al cursore (tasto S) e **annulla/ripeti** le modifiche (Ctrl+Z / Ctrl+Shift+Z), con pulsanti nella barra alta.
- Audio per clip: volume 0–200%, muto, fade in/out.
- Velocità 0.5x–2x con audio sincronizzato.
- Traccia musicale sotto il montaggio: volume, fade e loop.
- **Anteprima del montaggio intero** in sequenza (Spazio), con avanzamento automatico da una clip all'altra e musica sincronizzata; resta anche l'anteprima della sola selezione.
- Scorciatoie: Spazio play/pausa, frecce per spostarsi, Shift+frecce ±5 s, S dividi, Canc rimuovi, Ctrl+Z/Ctrl+Shift+Z annulla/ripeti.
- Export: MP4 (H.264/AAC), MKV oppure M4A solo audio.
- Risoluzione: originale, 1080p, 720p, 9:16 (Reels/TikTok), 1:1. Per 9:16 e 1:1 il frame viene riempito con crop centrale, senza bande nere.
- FPS originali/24/30/60 e qualità CRF.
- Progresso export e annullamento.

### Comprimi
- **Scansione GPU reale**: legge le GPU di sistema (nome, VRAM, driver) e verifica con un test di inizializzazione quali encoder hardware funzionano davvero su quella macchina: NVENC, Intel Quick Sync, AMD AMF e Apple VideoToolbox.
- **Forza GPU**: quando viene trovato un encoder hardware, l'app lo seleziona e lo usa per il render, mostrando quale GPU ed encoder sono attivi. Se la GPU non è disponibile resta il software, senza falsi positivi.
- **Decodifica GPU**: con NVENC le frame restano sulla GPU (`-hwaccel cuda -hwaccel_output_format cuda`) e su sorgenti 4K/10-bit il render è circa l'11% più veloce; se il percorso hardware non è compatibile l'app riprova automaticamente in software, senza interrompere la compressione.
- Encoder video: H.264/H.265 x264 e x265, VP9, AV1 libaom, più H.264/HEVC/AV1 hardware (NVENC, QSV, AMF, VideoToolbox).
- Contenitori: MP4, MKV, WebM con filtro automatico degli encoder e dei codec compatibili.
- Controllo qualità: CRF/CQ/QP costante, bitrate variabile, bitrate costante e 2 passate per gli encoder software, con max bitrate e buffer.
- Opzioni encoder: preset di velocità, tune, profilo, livello, pixel format (con gestione automatica delle sorgenti 10-bit), keyframe interval, B-frame, reference frame e parametri extra (`-x264-params`, `-x265-params`). Per NVENC è attivabile spatial/temporal AQ.
- Video: risoluzione originale/4K/2K/1080p/720p/480p/360p o personalizzata, blocco dell'upscale, FPS, deinterlaccia (yadif), riduzione rumore (hqdn3d), nitidezza (unsharp) e crop manuale su quattro lati.
- Audio avanzato: elenco delle tracce con selezione, **mix/fusione delle tracce selezionate** con volume regolabile per traccia, oppure mantenimento separato. Codec AAC, Opus, AC-3, E-AC-3, MP3, FLAC, Vorbis o passaggio diretto, con bitrate, canali e sample rate.
- Sottotitoli: selezione delle tracce; in MKV vengono copiati (anche bitmap/PGS), in MP4/WebM i testuali vengono convertiti in `mov_text`/WebVTT.
- Capitoli, metadata, allegati/font per MKV e faststart MP4 opzionali.
- Preset pronti: massima compressione, bilanciato, alta qualità, social 1080p, archivio, GPU veloce e WebM leggero, tutti poi personalizzabili.
- **Stima del peso finale in tempo reale**: ogni parametro (encoder, qualità, bitrate, risoluzione, fps, crop, filtri, audio, durata) aggiorna i MB attesi, con intervallo, percentuale rispetto all'originale e bitrate calcolato.
- **Dimensione target**: scegli i MB finali e l'app ricava il bitrate video; con x264/x265 usa due passate per centrare il risultato.
- **Taglio**: comprimi solo da un secondo all'altro, con durata e stima ricalcolate.
- **Crop automatico**: rileva le bande nere con `cropdetect` e compila i quattro lati.
- **Normalizzazione volume** (loudnorm −16 LUFS) e **burn-in dei sottotitoli** testuali nel video.
- Progresso con percentuale, tempo, velocità e passata, annullamento sicuro e file temporanei rimossi in caso di errore.

### Aggiornamenti
- Controllo automatico all'avvio (dopo pochi secondi) e ogni 6 ore tramite **electron-updater** e le release GitHub di `Molinays/MoliDownloader`.
- Download automatico in background con percentuale e velocità; l'aggiornamento si installa alla chiusura oppure subito con **Riavvia e aggiorna**.
- Lo stato è visibile nella scheda **Info**; l'auto-update funziona nella versione installata con l'installer, non nel portable.

### Info
- Riepilogo del sistema: versione app, OS, CPU e thread, RAM totale/libera, uptime, Electron/Chromium/Node e cartella dati.
- GPU rilevate con VRAM e driver, più l'esito reale dei test NVENC, Quick Sync, AMF e VideoToolbox.
- Settings consigliati per questa macchina (encoder, qualità, preset, risoluzione) applicabili in un clic nella scheda Comprimi.
- Controllo dipendenze: yt-dlp, FFmpeg e ffprobe con versione, percorso e origine. Se mancano (o per aggiornarle) si scaricano direttamente da GitHub e vengono salvate in `%APPDATA%/molidowloader/bin` con i nomi usati dall'app (`ytd.exe`, `ffmpeg.exe`, `ffprobe.exe`).
- Cartelle di output separate e modificabili: download e compressioni in `Download/MoliDowloader`, montaggi esportati in `Documenti/MoliDowloader`, con ripristino della predefinita in un clic.

## Requisiti

- Windows 10/11 (sono presenti i percorsi per macOS/Linux, ma il pacchetto è configurato per Windows).
- Node.js 20+ e npm per avviare in sviluppo.
- Non serve installare FFmpeg: `ffmpeg-static` e `@ffprobe-installer/ffprobe` vengono inclusi nelle dipendenze.
- `resources/ytd.exe` (yt-dlp) è già incluso nel progetto.
- Non servono Deno, Node.js o Python per il download: il runtime JavaScript per YouTube è quello interno di Electron.

## Avvio

```bash
npm install
npm start
```

I test offline del resolver (nessuna rete) si eseguono con:

```bash
npm test
```

Su Windows è sufficiente anche il doppio clic su **start.bat**: installa le dipendenze al primo avvio e apre l'app.

## Build dell'eseguibile

```bash
npm run dist
```

L'installer NSIS, il portable, `latest.yml` e i blockmap per l'auto-update vengono creati nella cartella `release/`.
Per una build non compressa utile ai test:

```bash
npm run pack
```

## Pubblicazione e auto-update

La release GitHub deve contenere `MoliDowloader-Setup-<versione>.exe`, il relativo `.blockmap` e `latest.yml`.
Il modo più semplice è pubblicare con electron-builder:

```bash
set GH_TOKEN=...
npm run publish
```

L'app installata confronta la propria versione con `latest.yml`, scarica il nuovo installer e lo applica alla chiusura.

Il repository GitHub pubblico è **release-only**: sul branch `main` c'è solo il README di download, quindi build e pubblicazione si fanno da questa copia privata con `npm run publish` (oppure caricando a mano installer, `.blockmap`, `latest.yml` e portable nella release). Il workflow in `.github/workflows/release.yml` resta solo come riferimento e non viene eseguito dal repository pubblico.

## Struttura

```
src/
  main/        processo principale Electron (finestra, IPC, download, editor, compressione)
  renderer/    interfaccia (index.html, app.js, style.css)
  shared/      riconoscimento link ed errori, usati da main e renderer
scripts/       utility e test offline (npm test)
resources/     binari inclusi nel pacchetto (ytd.exe)
build/         icona dell'applicazione
release/       artefatti di build (ignorata da git)
```

| File | Ruolo |
| --- | --- |
| `src/renderer/index.html`, `app.js`, `style.css` | Interfaccia renderer (download + editor + comprimi + info) |
| `src/main/main.js` | Finestra, sicurezza e handler IPC |
| `src/main/preload.js` | Bridge `contextBridge` usato dal renderer |
| `src/main/downloader.js` | Coda yt-dlp, parsing progresso, playlist, file finali e annullamento |
| `src/main/resolver.js` | Risoluzione dei link con player protetto (StreamingCommunity, VixCloud) verso la playlist scaricabile |
| `src/main/twitch.js` | Token pubblico, manifest usher e rendition chunked delle VOD Twitch |
| `src/main/spotify.js` | Espansione di tracce, album e playlist Spotify tramite embed pubblico |
| `src/shared/links.js` | Riconoscimento di servizio, playlist, brano e pagina di accesso |
| `src/shared/errors.js` | Codici e messaggi in tema per gli errori di download |
| `src/main/settings.js` | Cartelle di output predefinite, personalizzate dall'utente e ripristinabili |
| `src/main/media-core.js` | Probe, thumbnail, waveform, costruzione filtri ed export FFmpeg |
| `src/main/editor.js` | Cache media e servizio export per Electron |
| `src/main/compress-core.js` | Probe tracce, piano di compressione, merge audio, 2-pass, progresso e annullamento |
| `src/main/hardware.js` | Rilevamento GPU, catalogo encoder e test reali degli encoder hardware |
| `src/main/binaries.js` | Ricerca di yt-dlp/FFmpeg/ffprobe, link dei tool e self-update |
| `src/main/updater.js` | Controllo release GitHub, download e installazione aggiornamenti |
| `resources/ytd.exe` | yt-dlp incluso nel pacchetto |
| `LICENSE` | Licenza MIT — Copyright © 2026 Molinays |

## Note

- Usa l'app solo per contenuti di cui hai i diritti o che la piattaforma consente di scaricare.
- Se un sito smette di funzionare, premi **Aggiorna yt-dlp** nella sezione Download: il binario viene scaricato in `%APPDATA%/molidowloader/bin`.
- I file temporanei di anteprima (thumbnail, waveform) sono in `%APPDATA%/molidowloader/cache`.
- Il montaggio esportato non applica ancora transizioni, testi o overlay: il focus è su taglio, audio e concatenazione.
- Nella sezione Comprimi il 2-pass è disponibile solo per x264/x265; gli encoder hardware privilegiano velocità e non lo supportano.
- Il burn-in riguarda i sottotitoli testuali (SRT/ASS/WebVTT); quelli bitmap (PGS/DVD) restano disponibili solo come tracce in MKV.
- La decodifica GPU è pensata per NVENC (percorso CUDA). Con Quick Sync, AMF o VideoToolbox viene usato `-hwaccel auto` e resta il fallback software automatico.
- I link gestiti sono quelli supportati da yt-dlp. Per i siti con player dedicato il resolver legge la pagina pubblica del player e ne estrae il flusso HLS con i parametri che il player stesso espone: non decifra DRM né aggira abbonamenti.
- L'auto-update è supportato dalla versione installata con NSIS. Il portable non può sostituirsi da solo: va scaricato manualmente dalla release.
- Gli aggiornamenti Windows non sono firmati con un certificato commerciale: SmartScreen può mostrare un avviso al primo avvio.

---

Copyright © 2026 **Molinays**, distribuito con [licenza MIT](LICENSE). Le dipendenze di terze parti (yt-dlp, FFmpeg, Electron e altre) mantengono le rispettive licenze: le build FFmpeg distribuite sono GPL/LGPL, quindi la ridistribuzione dell'eseguibile deve rispettarne i termini.
