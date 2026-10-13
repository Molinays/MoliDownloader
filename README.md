# MoliDownloader

Interfaccia web locale per scaricare video e audio da YouTube e da oltre 1000 altri siti, basata su yt-dlp. Il programma avvia un piccolo server Python sulla macchina locale e apre automaticamente una pagina web nel browser, dalla quale è possibile configurare e avviare i download, monitorarne il progresso in tempo reale e consultare i log.

---

## Caratteristiche

- Download video in varie risoluzioni (da 360p fino a 4K)
- Estrazione audio e conversione in MP3, M4A, Opus, FLAC o WAV con bitrate selezionabile
- Download di playlist complete
- Supporto per sottotitoli (inclusi quelli automatici) con possibilità di incorporarli nel file
- Incorporamento di copertina e metadati nel file finale
- Rimozione automatica di sponsor, intro, outro e altre sezioni tramite SponsorBlock
- Bypass di restrizioni geografiche
- Supporto per cookie da browser (Chrome, Firefox, Edge, Brave, Opera)
- Supporto per proxy (HTTP, SOCKS)
- Rate limiting, retry e download parallelo dei frammenti
- Coda dei download con stato, velocità, tempo rimanente e barra di avanzamento in tempo reale
- Log dettagliato per ogni download, consultabile in una finestra dedicata
- Interfaccia completamente in tema scuro, con layout responsive

---

## Requisiti

- Windows (il file `start.bat` e la gestione dei processi sono pensati per questo sistema operativo)
- Python 3.8 o superiore
- Il binario `ytd.exe` (build di yt-dlp per Windows) nella stessa cartella del progetto

Nessuna libreria Python esterna è necessaria: il server utilizza solo la libreria standard.

---

## Installazione

1. Clona il repository o scarica i file in una cartella:

   ```
   git clone https://github.com/tuo-utente/MoliDownloader.git
   cd MoliDownloader
   ```

2. Scarica l'ultima versione di `yt-dlp.exe` dalla pagina delle release ufficiali:

   ```
   https://github.com/yt-dlp/yt-dlp/releases
   ```

3. Rinomina il file scaricato in `ytd.exe` e posizionalo nella cartella principale del progetto, accanto a `server.py`.

4. Assicurati che Python sia installato e disponibile nel PATH di sistema.

---

## Avvio

Fai doppio clic su `start.bat`, oppure esegui da terminale:

```
python server.py
```

Il server si avvierà su `http://127.0.0.1:7979` e il browser si aprirà automaticamente sulla pagina dell'interfaccia. Per arrestare il programma, chiudi la finestra del terminale o premi `Ctrl+C`.

---

## Utilizzo

1. Incolla l'URL del video o della playlist nel campo in alto.
2. Seleziona la scheda **Video** o **Audio** a seconda del tipo di download desiderato.
3. Configura le opzioni disponibili:
   - qualità video o formato e bitrate audio
   - cartella di destinazione e template del nome file
   - sottotitoli, metadati, copertina, SponsorBlock, geo bypass
   - parametri avanzati come rate limit, retry, frammenti paralleli, cookie e proxy
4. Premi **Download**. Il job apparirà nella colonna di destra con stato e progresso aggiornati in tempo reale.
5. Per visualizzare il log completo di un download, premi il pulsante **Log** sulla scheda corrispondente.
6. Per annullare un download in corso, premi **Annulla**.

---

## Struttura del progetto

```
MoliDownloader/
├── start.bat        Avvio su Windows
├── server.py        Server HTTP locale e gestione dei job
├── index.html       Interfaccia web
├── style.css        Foglio di stile
├── app.js           Logica frontend
└── ytd.exe          Binario yt-dlp (da scaricare separatamente)
```

---

## API del server

Il server espone alcune API locali utilizzate dall'interfaccia. Possono essere utili per integrazioni o automazioni.

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| GET | `/api/defaults` | Restituisce la cartella di download predefinita e lo stato di `ytd.exe` |
| GET | `/api/jobs` | Elenco di tutti i job (senza log) |
| GET | `/api/jobs/{id}` | Dettaglio di un job, log incluso |
| POST | `/api/download` | Avvia un nuovo download |
| POST | `/api/jobs/{id}/cancel` | Annulla un download in corso |

---

## Note

- Il server ascolta esclusivamente su `127.0.0.1`, quindi non è raggiungibile dall'esterno.
- Il programma non effettua chiamate a servizi terzi: tutta la comunicazione avviene in locale.
- L'uso di yt-dlp è soggetto ai termini di servizio dei siti dai quali si scarica. Assicurati di rispettare le condizioni d'uso e il copyright dei contenuti.

---

## Licenza

Distribuito sotto licenza MIT. Vedi il file `LICENSE` per i dettagli.

---

## Crediti

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) per il motore di download
- [Inter](https://fonts.google.com/specimen/Inter) e [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) per i font dell'interfaccia
