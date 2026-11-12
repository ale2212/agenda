# Agenda

App personale per iPhone (PWA): Finanze, Palestra (con dieta) e Abitudini. Funziona offline e i dati restano sul telefono.

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

1. Nel repository: **Add file** → **Upload files** e trascina di nuovo tutto il contenuto della cartella
   (i file con lo stesso nome vengono sostituiti) → **Commit changes**.
2. Il numero di `VERSIONE` in `sw.js` deve cambiare a ogni aggiornamento (es. `agenda-v2` → `agenda-v3`):
   è così che il telefono capisce che c'è una versione nuova. Se le modifiche le prepara Claude, lo fa già lui.
3. Dopo 1-2 minuti apri l'app sul telefono: dopo qualche secondo compare in alto
   "Nuova versione disponibile. Tocca per aggiornare".

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
js/moduli/palestra.js   modulo Palestra (allenamento, progressi, misure, schede, dieta)
js/moduli/abitudini.js  modulo Abitudini
js/moduli/dati.js       backup
```

Per aggiungere un modulo: nuovo file in `js/moduli/`, una riga in `MODULI` dentro `app.js`, il file aggiunto all'elenco `FILE` in `sw.js`.
