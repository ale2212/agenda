// =============================================================================
// DATABASE SUL TELEFONO (IndexedDB)
//
// Tutti i dati stanno in un unico "contenitore" chiamato voci. Ogni voce ha un
// campo `collezione` che dice a chi appartiene, ad esempio:
//   { id: 12, collezione: "finanze.movimenti", importo: 42.5, ... }
//   { id: 13, collezione: "palestra.registro", esercizio: "Panca piana", ... }
//
// Perché così: un modulo nuovo usa semplicemente un nome di collezione nuovo,
// senza modificare la struttura del database né toccare i dati esistenti.
// =============================================================================

const NOME_DB = "agenda";
const VERSIONE_DB = 1;
const STORE = "voci";

let promessaDb = null;

function apri() {
  if (!promessaDb) {
    promessaDb = new Promise((risolvi, rifiuta) => {
      const richiesta = indexedDB.open(NOME_DB, VERSIONE_DB);
      richiesta.onupgradeneeded = () => {
        const db = richiesta.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          store.createIndex("collezione", "collezione");
        }
      };
      richiesta.onsuccess = () => risolvi(richiesta.result);
      richiesta.onerror = () => rifiuta(richiesta.error);
    });
  }
  return promessaDb;
}

// Trasforma una richiesta IndexedDB (basata su eventi) in una Promise
function attendi(richiesta) {
  return new Promise((risolvi, rifiuta) => {
    richiesta.onsuccess = () => risolvi(richiesta.result);
    richiesta.onerror = () => rifiuta(richiesta.error);
  });
}

async function store(modalita = "readonly") {
  const db = await apri();
  return db.transaction(STORE, modalita).objectStore(STORE);
}

/** Tutte le voci di una collezione. */
export async function tutti(collezione) {
  const s = await store();
  return attendi(s.index("collezione").getAll(collezione));
}

/** Aggiunge una voce e restituisce il suo id. */
export async function aggiungi(collezione, dati) {
  const s = await store("readwrite");
  return attendi(s.add({ ...dati, collezione }));
}

/** Sostituisce una voce esistente (deve contenere id e collezione). */
export async function aggiorna(voce) {
  const s = await store("readwrite");
  return attendi(s.put(voce));
}

export async function elimina(id) {
  const s = await store("readwrite");
  return attendi(s.delete(id));
}

/** Tutte le voci di tutte le collezioni: serve per il backup. */
export async function esportaTutto() {
  const s = await store();
  return attendi(s.getAll());
}

/** Ripristina un backup: cancella tutto e reinserisce le voci. */
export async function importaTutto(voci) {
  const db = await apri();
  return new Promise((risolvi, rifiuta) => {
    const tx = db.transaction(STORE, "readwrite");
    const s = tx.objectStore(STORE);
    s.clear();
    for (const voce of voci) s.put(voce);
    tx.oncomplete = () => risolvi(voci.length);
    tx.onerror = () => rifiuta(tx.error);
  });
}

/** Chiede al sistema di non cancellare i dati per liberare spazio. */
export async function chiediPersistenza() {
  if (navigator.storage?.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}
