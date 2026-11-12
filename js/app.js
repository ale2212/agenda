// =============================================================================
// AGENDA - avvio dell'app, navigazione ed elenco dei moduli.
//
// PER AGGIUNGERE UN MODULO:
//   1. crea js/moduli/nome.js (copia la struttura di finanze.js)
//   2. importalo qui sotto e aggiungilo all'elenco MODULI
//   3. aggiungi il file all'elenco FILE in sw.js (per il funzionamento offline)
// =============================================================================

import * as db from "./db.js";
import * as ui from "./ui.js";
import finanze from "./moduli/finanze.js";
import palestra from "./moduli/palestra.js";
import abitudini from "./moduli/abitudini.js";
import dati from "./moduli/dati.js";

const MODULI = [finanze, palestra, abitudini];   // ← i moduli dell'app, in quest'ordine
const SISTEMA = [dati];               // ← pagine di servizio (backup)

const ICONA_HOME =
  '<svg viewBox="0 0 24 24"><path d="M3.5 11 12 4l8.5 7v8.5a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/></svg>';

const { h } = ui;
const radice = document.getElementById("app");

// ---------------------------------------------------------------- navigazione
// L'indirizzo dice dove sei: #/palestra/allenamento → modulo palestra, sezione allenamento
function percorso() {
  const [, modulo = "", sezione = ""] = location.hash.replace(/^#/, "").split("/");
  return { modulo, sezione };
}

function vai(indirizzo) {
  if (location.hash === indirizzo) mostra();
  else location.hash = indirizzo;
}

const ctx = { db, ui, vai, ricarica: () => mostra({ mantieniScroll: true }) };

// ---------------------------------------------------------------- disegno
async function mostra({ mantieniScroll = false } = {}) {
  const { modulo: idModulo, sezione: idSezione } = percorso();
  const modulo = [...MODULI, ...SISTEMA].find((m) => m.id === idModulo);
  const scroll = window.scrollY;

  document.documentElement.style.setProperty("--accento", modulo ? modulo.colore : "var(--inchiostro)");
  aggiornaBarra(modulo?.id || "home");

  const contenuto = h("main", { class: "contenuto" });

  if (!modulo) {
    document.title = "Agenda";
    radice.replaceChildren(intestazione("Agenda", ui.dataLunga(ui.oggi())), contenuto);
    await home(contenuto);
  } else {
    const sezione = modulo.sezioni.find((s) => s.id === idSezione) || modulo.sezioni[0];
    document.title = `${modulo.nome} · Agenda`;
    const seg = modulo.sezioni.length > 1
      ? ui.segmenti(
          modulo.sezioni.map((s) => ({ valore: s.id, etichetta: s.nome })),
          sezione.id,
          (id) => vai(`#/${modulo.id}/${id}`),
          { nome: "sezioni" })
      : null;
    radice.replaceChildren(intestazione(modulo.nome, null, seg), contenuto);
    await sezione.render(contenuto, ctx);
  }
  window.scrollTo(0, mantieniScroll ? scroll : 0);
}

function intestazione(titolo, sottotitolo, extra) {
  return h("header", { class: "intestazione" },
    sottotitolo ? h("p", { class: "sottotitolo" }, sottotitolo) : null,
    h("h1", {}, titolo),
    extra);
}

async function home(el) {
  for (const m of MODULI) {
    const riepilogo = m.riepilogo ? await m.riepilogo(ctx) : null;
    el.append(
      h("section", { class: "riquadro-home", style: { "--accento": m.colore } },
        h("a", { class: "titolo-home", href: `#/${m.id}` },
          h("span", { class: "icona", html: m.icona }), m.nome),
        riepilogo)
    );
  }
  const avvisoBackup = await dati.promemoria(ctx);
  if (avvisoBackup) el.append(avvisoBackup);
}

// ---------------------------------------------------------------- barra in basso
const barra = document.getElementById("barra");
function costruisciBarra() {
  const voci = [{ id: "home", nome: "Home", icona: ICONA_HOME }, ...MODULI, ...SISTEMA];
  barra.replaceChildren(
    ...voci.map((v) =>
      h("a", { href: v.id === "home" ? "#/" : `#/${v.id}`, "data-id": v.id,
               style: v.colore ? { "--accento": v.colore } : null },
        h("span", { class: "icona", html: v.icona }),
        h("span", {}, v.nome)))
  );
}
function aggiornaBarra(attivo) {
  for (const a of barra.querySelectorAll("a")) {
    const on = a.dataset.id === attivo;
    a.classList.toggle("attivo", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

// ---------------------------------------------------------------- avvio
costruisciBarra();
window.addEventListener("hashchange", () => {
  document.getElementById("avviso")?.classList.remove("visibile"); // niente messaggi della pagina precedente
  mostra();
});
mostra();
db.chiediPersistenza();

// Il "service worker" salva i file dell'app sul telefono: così si apre anche offline.
// Quando pubblichi una versione nuova, la scarica in background e mostra un avviso.
if ("serviceWorker" in navigator) {
  const giaInstallata = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!giaInstallata || document.getElementById("aggiornamento")) return; // prima installazione: niente avviso
    document.body.append(h("button", { id: "aggiornamento", type: "button", onclick: () => location.reload() },
      "Nuova versione disponibile. Tocca per aggiornare"));
  });
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
