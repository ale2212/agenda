// =============================================================================
// TIMER - il "motore" condiviso da tutti i moduli (recupero in palestra, pomodori).
//
// Come funziona:
//   - Un timer non conta i secondi: ricorda l'ISTANTE in cui finisce (fine).
//     Così il tempo resta giusto anche se chiudi l'app, cambi sezione o la ricarichi:
//     quando torni, il motore vede che il momento è passato e lo chiude.
//   - I timer attivi sono salvati nel browser (localStorage), quindi sopravvivono a una ricarica.
//   - Ogni modulo può registrare un "gestore": la funzione da chiamare quando il suo timer finisce
//     (es. il Pomodoro salva la sessione e avvia la pausa).
//   - Limite di iPhone: quando l'app è chiusa o lo schermo è bloccato il codice è fermo,
//     quindi il suono arriva solo con l'app aperta. Per questo, mentre un timer gira,
//     chiediamo a iPhone di tenere lo schermo acceso (Wake Lock).
// =============================================================================

import { h, avviso } from "./ui.js";

const CHIAVE = "agenda.timer";
const attivi = {};               // id → timer
const gestori = {};              // id → funzione(timer, { inRitardo }) che può restituire un messaggio
let ridisegna = () => {};        // l'app la imposta: ridisegna la pagina se serve

// ------------------------------------------------------------- salvataggio
function salva() {
  try { localStorage.setItem(CHIAVE, JSON.stringify(attivi)); } catch {}
}
function carica() {
  try {
    const dati = JSON.parse(localStorage.getItem(CHIAVE) || "{}");
    for (const [id, t] of Object.entries(dati)) attivi[id] = t;
  } catch {}
}

// ------------------------------------------------------------- formato
/** 90000 → "1:30"; 3725000 → "1:02:05" */
export function formato(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const ore = Math.floor(s / 3600), min = Math.floor((s % 3600) / 60), sec = s % 60;
  return ore ? `${ore}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${min}:${String(sec).padStart(2, "0")}`;
}

/**
 * Legge un tempo di recupero scritto a mano e lo trasforma in secondi (null se non lo capisce):
 *   "90"" → 90 · "90 s" → 90 · "2'" → 120 · "2 minuti" → 120 · "1'30" → 90 · "2’30”" → 150
 *   "1:30" → 90 · "1.30" → 90 · "1 min 30" → 90 · "1m30s" → 90 · "90" → 90 · "2" → 120
 */
export function leggiDurata(testo) {
  if (!testo) return null;
  const t = String(testo).toLowerCase()
    // iPhone trasforma da solo ' e " in apostrofi e virgolette "curvi": li riportiamo a quelli dritti
    .replace(/[’‘′`´]/g, "'")
    .replace(/[”“″«»]/g, '"')
    .replace(/''/g, '"')
    .replace(/\s+/g, "");
  let m;
  if ((m = t.match(/^(\d+)[':.,](\d{2})"?$/))) return Number(m[1]) * 60 + Number(m[2]);              // 1'30 · 1:30 · 1.30
  if ((m = t.match(/^(\d+)(?:minuti|minuto|min|m)(\d{1,2})(?:secondi|sec|s|")?$/))) return Number(m[1]) * 60 + Number(m[2]); // 1min30 · 1m30s
  if ((m = t.match(/^(\d+)(?:minuti|minuto|min|m|')$/))) return Number(m[1]) * 60;                   // 2' · 2min · 2minuti
  if ((m = t.match(/^(\d+)(?:secondi|secondo|sec|s|")$/))) return Number(m[1]);                       // 90" · 90s · 90secondi
  if ((m = t.match(/^(\d+)$/))) return Number(m[1]) <= 10 ? Number(m[1]) * 60 : Number(m[1]);      // 2 = minuti, 90 = secondi
  return null;
}

// ------------------------------------------------------------- suono e avvisi
let audio = null;

/** Va chiamata dentro un tocco dell'utente (es. "Avvia"): iPhone permette il suono solo dopo un gesto. */
export function sbloccaAudio() {
  try {
    // "playback" = suona anche con l'interruttore silenzioso (dove iPhone lo consente)
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {}
}

/** Tre bip brevi. */
export function suona() {
  try {
    if (!audio) return;
    if (audio.state === "suspended") audio.resume();
    const t0 = audio.currentTime + 0.05;
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator(), vol = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1175 : 880;
      const t = t0 + i * 0.28;
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(vol).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    }
  } catch {}
}

function lampeggia(messaggio) {
  document.body.classList.remove("lampeggio");
  void document.body.offsetWidth; // fa ripartire l'animazione
  document.body.classList.add("lampeggio");
  avviso(messaggio);
}

// ------------------------------------------------------------- schermo acceso
let blocco = null;
async function aggiornaSchermoAcceso() {
  const servono = Object.values(attivi).some((t) => !t.pausa);
  try {
    if (servono && !blocco && document.visibilityState === "visible" && navigator.wakeLock) {
      blocco = await navigator.wakeLock.request("screen");
      blocco.addEventListener("release", () => (blocco = null));
    } else if (!servono && blocco) {
      await blocco.release();
      blocco = null;
    }
  } catch { blocco = null; }
}

// ------------------------------------------------------------- comandi
/**
 * Avvia (o riavvia) un timer.
 *   id: "recupero", "pomodoro", ...   durata: millisecondi
 *   opzioni: etichetta, link (dove porta la barra), nascondiSu (pagina in cui la barra non serve),
 *            controlli: "regola" (−15 / +15 / stop) oppure "apri", dati (liberi, per il gestore),
 *            fine (istante di fine già deciso, utile per recuperare il tempo perso)
 */
export function avvia(id, durata, opzioni = {}) {
  attivi[id] = {
    id, durata, fine: opzioni.fine ?? Date.now() + durata, pausa: null,
    etichetta: opzioni.etichetta || "Timer", link: opzioni.link || null,
    nascondiSu: opzioni.nascondiSu || null, controlli: opzioni.controlli || "regola",
    dati: opzioni.dati || {},
  };
  cambiato(id);
}

export function ferma(id) {
  delete attivi[id];
  cambiato(id);
}

export function pausa(id) {
  const t = attivi[id];
  if (!t || t.pausa) return;
  t.pausa = Math.max(0, t.fine - Date.now());
  cambiato(id);
}

export function riprendi(id) {
  const t = attivi[id];
  if (!t || t.pausa === null) return;
  t.fine = Date.now() + t.pausa;
  t.pausa = null;
  cambiato(id);
}

/** Aggiunge (o toglie, con un numero negativo) tempo a un timer. */
export function aggiungiTempo(id, ms) {
  const t = attivi[id];
  if (!t) return;
  if (t.pausa !== null) t.pausa = Math.max(1000, t.pausa + ms);
  else t.fine = Math.max(Date.now() + 1000, t.fine + ms);
  t.durata = Math.max(1000, t.durata + ms);
  cambiato(id);
}

export const attivo = (id) => attivi[id] || null;
export const rimanente = (t) => (t.pausa !== null ? t.pausa : Math.max(0, t.fine - Date.now()));
export const registraGestore = (id, funzione) => (gestori[id] = funzione);

function cambiato(id) {
  salva();
  disegnaBarra();
  aggiornaElementi();
  aggiornaSchermoAcceso();
  ridisegna(attivi[id] || { id });
}

// ------------------------------------------------------------- il motore
function controlla() {
  const ora = Date.now();
  // In ordine di fine: se l'app è rimasta chiusa a lungo, i timer si chiudono nell'ordine giusto
  const scaduti = Object.values(attivi).filter((t) => t.pausa === null && t.fine <= ora).sort((a, b) => a.fine - b.fine);
  for (const t of scaduti) {
    if (attivi[t.id] !== t) continue; // già cambiato da un gestore
    delete attivi[t.id];
    const inRitardo = ora - t.fine > 30000; // finito mentre l'app era chiusa
    let messaggio = null;
    try { messaggio = gestori[t.id]?.(t, { inRitardo }); } catch (e) { console.error(e); }
    salva();
    if (!inRitardo) { suona(); lampeggia(messaggio || `${t.etichetta}: tempo scaduto`); }
    else if (messaggio) avviso(messaggio);
    disegnaBarra();
    aggiornaSchermoAcceso();
    ridisegna(attivi[t.id] || t);
  }
  if (scaduti.length && Object.values(attivi).some((t) => t.pausa === null && t.fine <= ora)) controlla();
  aggiornaElementi();
}

/** Aggiorna i numeri e gli anelli di avanzamento nella pagina (elementi con data-timer / data-anello). */
function aggiornaElementi() {
  for (const el of document.querySelectorAll("[data-timer]")) {
    const t = attivi[el.dataset.timer];
    el.textContent = t ? formato(rimanente(t)) : el.dataset.vuoto || "0:00";
  }
  for (const el of document.querySelectorAll("[data-anello]")) {
    const t = attivi[el.dataset.anello];
    const avanzamento = t ? 1 - rimanente(t) / t.durata : 0;
    el.style.strokeDashoffset = String(Number(el.dataset.circonferenza) * (1 - avanzamento));
  }
}

// ------------------------------------------------------------- barra in basso
function disegnaBarra() {
  let barra = document.getElementById("barra-timer");
  if (!barra) {
    barra = h("div", { id: "barra-timer", "aria-live": "polite" });
    document.body.append(barra);
  }
  const visibili = Object.values(attivi).filter((t) => !(t.nascondiSu && location.hash.startsWith(t.nascondiSu)));
  barra.replaceChildren(...visibili.map((t) =>
    h("div", { class: `timer-flottante${t.pausa !== null ? " in-pausa" : ""}` },
      h(t.link ? "a" : "span", { class: "timer-testo", href: t.link || null },
        h("span", { class: "timer-etichetta" }, t.etichetta),
        h("span", { class: "timer-tempo", "data-timer": t.id }, formato(rimanente(t)))),
      t.controlli === "regola"
        ? [h("button", { type: "button", "aria-label": "15 secondi in meno", onclick: () => aggiungiTempo(t.id, -15000) }, "−15"),
           h("button", { type: "button", "aria-label": "15 secondi in più", onclick: () => aggiungiTempo(t.id, 15000) }, "+15"),
           h("button", { type: "button", class: "chiudi", "aria-label": "Ferma il timer", onclick: () => ferma(t.id) }, "✕")]
        : null)));
  barra.classList.toggle("visibile", visibili.length > 0);
  document.body.classList.toggle("con-timer", visibili.length > 0); // per alzare i pulsanti fissi sopra la barra
}

/** Avvia il motore: lo chiama l'app una volta sola, all'apertura. */
export function avviaMotore({ alCambio } = {}) {
  if (alCambio) ridisegna = alCambio;
  carica();
  controlla();          // chiude subito i timer finiti mentre l'app era chiusa
  disegnaBarra();
  aggiornaSchermoAcceso();
  setInterval(controlla, 250);
  window.addEventListener("hashchange", disegnaBarra);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { controlla(); aggiornaSchermoAcceso(); }
  });
}
