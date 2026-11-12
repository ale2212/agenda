# Agenda

App personale per iPhone (PWA): Finanze e Palestra. Funziona offline e i dati restano sul telefono.

## Pubblicarla su GitHub Pages (una volta sola)

1. Su github.com: **+** in alto a destra → **New repository**.
   Nome: `agenda`, visibilità **Public** (necessaria per GitHub Pages gratuito: è pubblico il codice, non i tuoi dati). → **Create repository**.
2. Nella pagina del repository: **uploading an existing file**. Trascina **il contenuto** di questa cartella
   (`index.html`, `sw.js`, `manifest.webmanifest` e le cartelle `css`, `js`, `icone`), non la cartella stessa. → **Commit changes**.
3. **Settings** → **Pages** → in *Branch* scegli `main` e `/ (root)` → **Save**.
   Dopo 1-2 minuti l'app è online su `https://TUO-NOME-UTENTE.github.io/agenda/`.

## Installarla sull'iPhone

1. Apri l'indirizzo in **Safari** (non Chrome).
2. Tocca **Condividi** → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Da quel momento aprila sempre dall'icona: funziona anche senza connessione.

## Aggiornarla

1. Sostituisci i file modificati nel repository (stessa procedura di upload).
2. In `sw.js` aumenta il numero di `VERSIONE` (es. `agenda-v2`): altrimenti il telefono continua a usare la copia salvata.
3. Sul telefono apri l'app due volte: la prima scarica la versione nuova, la seconda la usa.

I dati non vengono toccati dagli aggiornamenti.

## Backup

Sezione **Dati** → **Crea backup** → **Salva su File** → iCloud Drive.
Se elimini l'icona dalla schermata Home, i dati si cancellano: fai un backup ogni tanto (l'app te lo ricorda dopo 14 giorni).

Il file di backup è un JSON leggibile anche da Python:

```python
import json, pandas as pd
voci = json.load(open("agenda-backup-2026-11-12.json"))["voci"]
df = pd.DataFrame(voci)
movimenti = df[df.collezione == "finanze.movimenti"].dropna(axis=1, how="all")
```

## Struttura

```
index.html              pagina principale
sw.js                   funzionamento offline
css/style.css           aspetto (colori in cima al file)
js/app.js               navigazione ed elenco dei moduli
js/db.js                database sul telefono
js/ui.js                strumenti comuni (grafici, formati, ...)
js/moduli/finanze.js    modulo Finanze
js/moduli/palestra.js   modulo Palestra
js/moduli/dati.js       backup
```

Per aggiungere un modulo: nuovo file in `js/moduli/`, una riga in `MODULI` dentro `app.js`, il file aggiunto all'elenco `FILE` in `sw.js`.
