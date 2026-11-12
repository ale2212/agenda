// =============================================================================
// SERVICE WORKER: salva i file dell'app sul telefono, così si apre anche
// senza connessione.
//
// Quando pubblichi una modifica, aumenta il numero di VERSIONE: il telefono
// scarica i file nuovi in background e li usa dall'apertura successiva.
// =============================================================================

const VERSIONE = "agenda-v2";

const FILE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/ui.js",
  "./js/moduli/finanze.js",
  "./js/moduli/palestra.js",
  "./js/moduli/abitudini.js",
  "./js/moduli/dati.js",
  "./icone/icona-180.png",
  "./icone/icona-192.png",
  "./icone/icona-512.png",
];

self.addEventListener("install", (evento) => {
  // cache: "reload" = scarica sempre dal sito, mai da copie temporanee del browser
  evento.waitUntil(caches.open(VERSIONE).then((cache) =>
    cache.addAll(FILE.map((f) => new Request(f, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  // Cancella le copie delle versioni precedenti
  evento.waitUntil(
    caches.keys()
      .then((nomi) => Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Risponde subito con la copia salvata e intanto la aggiorna dalla rete
self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(
    caches.open(VERSIONE).then(async (cache) => {
      const salvata = await cache.match(evento.request, { ignoreSearch: true });
      const daRete = fetch(evento.request)
        .then((risposta) => {
          if (risposta.ok) cache.put(evento.request, risposta.clone());
          return risposta;
        })
        .catch(() => salvata);
      return salvata || daRete;
    })
  );
});
