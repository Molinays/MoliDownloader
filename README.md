# MoliDowloader 2.3

App desktop **Electron** che unisce un downloader universale, un piccolo editor video/audio e un compressore in stile HandBrake, tutti basati su **FFmpeg**.

> Copyright © 2026 **Molinays** — rilasciato con licenza MIT (vedi [LICENSE](LICENSE)).

## Funzioni

### Download
- Supporto a tutti i siti gestiti da **yt-dlp**: YouTube, TikTok, Instagram, Facebook, X/Twitter, Vimeo, Twitch, SoundCloud e oltre 1000 altri.
- YouTube funziona senza installare Deno o Node: le sfide JavaScript vengono risolte con il runtime Node incorporato in Electron.
- Più link contemporaneamente (uno per riga), con coda e massimo 2 download in parallelo.
- Video: Best, 4K, 1440p, 1080p, 720p, 480p, 360p con merge automatico in MP4.
- Audio: MP3, M4A, Opus, FLAC, WAV con bitrate selezionabile.
- Playlist, sottotitoli, embed cover/metadata, SponsorBlock, geo-bypass, proxy, rate limit, retry, frammenti paralleli.
- Cookie da Chrome/Firefox/Edge/Brave/Opera per contenuti che richiedono login (Instagram, TikTok privati, ecc.).
- Log in tempo reale, annullamento, apertura cartella e passaggio diretto all'editor.
- Aggiornamento di yt-dlp integrato nell'app.

### Editor
- Import di clip video/audio o drag & drop nella finestra.
- Timeline con riordino drag & drop, duplicazione e rimozione.
- Trim di ogni clip con cursori In/Out, waveform e pulsanti "IN/OUT = cursore".
- Audio per clip: volume 0–200%, muto, fade in/out.
- Velocità 0.5x–2x con audio sincronizzato.
- Traccia musicale sotto il montaggio: volume, fade e loop.
- Anteprima della clip selezionata e della sola selezione.
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

In alternativa si può caricare a mano una release con tag `v<versione>` e gli stessi file. L'app installata confronta la propria versione con `latest.yml`, scarica il nuovo installer e lo applica alla chiusura. Il workflow `.github/workflows/release.yml` automatizza build e pubblicazione quando viene pushato un tag `v*`.

## Struttura

```
src/
  main/        processo principale Electron (finestra, IPC, download, editor, compressione)
  renderer/    interfaccia (index.html, app.js, style.css)
resources/     binari inclusi nel pacchetto (ytd.exe)
build/         icona dell'applicazione
release/       artefatti di build (ignorata da git)
```

| File | Ruolo |
| --- | --- |
| `src/renderer/index.html`, `app.js`, `style.css` | Interfaccia renderer (download + editor + comprimi + info) |
| `src/main/main.js` | Finestra, sicurezza e handler IPC |
| `src/main/preload.js` | Bridge `contextBridge` usato dal renderer |
| `src/main/downloader.js` | Coda yt-dlp, parsing progresso, file finali e annullamento |
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
- Il burn-in dei sottotitoli nel video non è previsto: le tracce vengono mantenute o convertite nel contenitore scelto.
- La decodifica GPU è pensata per NVENC (percorso CUDA). Con Quick Sync, AMF o VideoToolbox viene usato `-hwaccel auto` e resta il fallback software automatico.
- I link gestiti sono quelli supportati da yt-dlp: l'app non aggira protezioni o paywall di siti non supportati.
- L'auto-update è supportato dalla versione installata con NSIS. Il portable non può sostituirsi da solo: va scaricato manualmente dalla release.
- Gli aggiornamenti Windows non sono firmati con un certificato commerciale: SmartScreen può mostrare un avviso al primo avvio.

---

Copyright © 2026 **Molinays**. Tutti i diritti riservati nei limiti della licenza MIT.
