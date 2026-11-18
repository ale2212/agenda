// =============================================================================
// MODULO PRODUTTIVITÀ - timer Pomodoro
// Collezioni:
//   "produttivita.sessioni"     → { data, inizio: "10:05", fine: "10:55", minuti, attivita }  (solo pomodori COMPLETATI)
//   "produttivita.attivita"     → { nome, ordine }
//   "produttivita.impostazioni" → { preset: "classico" | "lungo" | "personalizzato", personalizzato: { lavoro, breve, lunga, ogni } }
// Il ciclo in corso (quanti pomodori mancano alla pausa lunga, l'attività scelta) è salvato nel browser.
//
// Il conto alla rovescia lo fa il motore condiviso (js/timer.js): qui c'è solo cosa succede
// quando un pomodoro o una pausa finiscono.
// =============================================================================

import { h, oggi, spostaGiorno, giornoSettimana, avviso, campo, vuoto, conferma, segmenti,
         dataBreve, formModifica } from "../ui.js";
import * as db from "../db.js";
import * as timer from "../timer.js";

const SESSIONI = "produttivita.sessioni";
const ATTIVITA = "produttivita.attivita";
const IMPOSTAZIONI = "produttivita.impostazioni";
const CHIAVE_CICLO = "agenda.pomodoro.ciclo";
const PAGINA = "#/produttivita/timer";

// Durate in minuti; "ogni" = dopo quanti pomodori arriva la pausa lunga
const PRESET = {
  classico: { nome: "25 / 5", lavoro: 25, breve: 5, lunga: 15, ogni: 4 },
  lungo: { nome: "50 / 10", lavoro: 50, breve: 10, lunga: 15, ogni: 2 },
};
const SUGGERITE = ["Tesi", "Studio"];
const GIORNI_BREVI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

let periodoAttivita = "settimana";
let attivitaInModifica = null;

// ------------------------------------------------------------- piccoli strumenti
const dueCifre = (n) => String(n).padStart(2, "0");
const isoDi = (d) => `${d.getFullYear()}-${dueCifre(d.getMonth() + 1)}-${dueCifre(d.getDate())}`;
const orarioDi = (d) => `${dueCifre(d.getHours())}:${dueCifre(d.getMinutes())}`;
const lunediDi = (iso) => spostaGiorno(iso, -((giornoSettimana(iso) + 6) % 7));
function tempoTesto(minuti) {
  const o = Math.floor(minuti / 60), m = Math.round(minuti % 60);
  return o ? (m ? `${o} h ${m} min` : `${o} h`) : `${m} min`;
}
const pomodoriTesto = (n) => `${n} ${n === 1 ? "pomodoro" : "pomodori"}`;

// Il ciclo in corso è salvato nel browser: se si perde, si riparte semplicemente da capo
function leggiCiclo() {
  try { return { completati: 0, attivita: null, dopoPausa: false, ...JSON.parse(localStorage.getItem(CHIAVE_CICLO) || "{}") }; }
  catch { return { completati: 0, attivita: null, dopoPausa: false }; }
}
function salvaCiclo(ciclo) {
  try { localStorage.setItem(CHIAVE_CICLO, JSON.stringify(ciclo)); } catch {}
}

// ------------------------------------------------------------- dati
async function leggiImpostazioni(dbx) {
  const [imp] = await dbx.tutti(IMPOSTAZIONI);
  return imp || { preset: "classico", personalizzato: { ...PRESET.classico } };
}
async function salvaImpostazioni(dbx, imp) {
  if (imp.id) await dbx.aggiorna(imp);
  else imp.id = await dbx.aggiungi(IMPOSTAZIONI, imp);
}
const durate = (imp) => (imp.preset === "personalizzato" ? imp.personalizzato : PRESET[imp.preset] || PRESET.classico);

async function leggiAttivita(dbx) {
  return (await dbx.tutti(ATTIVITA)).sort((a, b) => a.ordine - b.ordine || a.id - b.id);
}
async function leggiSessioni(dbx) {
  return (await dbx.tutti(SESSIONI)).sort((a, b) => b.data.localeCompare(a.data) || b.inizio.localeCompare(a.inizio));
}

// ------------------------------------------------------------- avvio di pomodori e pause
function avviaFase(fase, d, fine = null) {
  const minuti = { lavoro: d.lavoro, breve: d.breve, lunga: d.lunga }[fase];
  const etichette = { lavoro: d.attivita ? `Pomodoro: ${d.attivita}` : "Pomodoro", breve: "Pausa", lunga: "Pausa lunga" };
  const ms = minuti * 60000;
  timer.avvia("pomodoro", ms, {
    etichetta: etichette[fase], link: PAGINA, nascondiSu: PAGINA, controlli: "apri",
    fine: fine ? fine + ms : undefined,
    dati: { ...d, fase },
  });
}

function concludiPausa(fase) {
  const ciclo = leggiCiclo();
  if (fase === "lunga") ciclo.completati = 0; // dopo la pausa lunga il ciclo ricomincia
  ciclo.dopoPausa = true;
  salvaCiclo(ciclo);
}

// Cosa succede quando il timer del pomodoro arriva a zero (anche se l'app era chiusa)
timer.registraGestore("pomodoro", (t) => {
  const d = t.dati;
  if (d.fase === "lavoro") {
    const inizio = new Date(t.fine - t.durata), fine = new Date(t.fine);
    db.aggiungi(SESSIONI, {
      data: isoDi(fine), inizio: orarioDi(inizio), fine: orarioDi(fine),
      minuti: Math.round(t.durata / 60000), attivita: d.attivita || null,
    });
    const ciclo = leggiCiclo();
    ciclo.completati = (ciclo.completati || 0) + 1;
    ciclo.dopoPausa = false;
    salvaCiclo(ciclo);
    const lunga = ciclo.completati % d.ogni === 0;
    avviaFase(lunga ? "lunga" : "breve", d, t.fine); // la pausa parte da quando è finito il pomodoro
    return `Pomodoro completato! Ora ${lunga ? "la pausa lunga" : "una pausa"} di ${lunga ? d.lunga : d.breve} minuti`;
  }
  concludiPausa(d.fase);
  return "Pausa finita: pronto per il prossimo pomodoro?";
});

// ================================================================ TIMER
async function timerSezione(el, ctx) {
  const imp = await leggiImpostazioni(ctx.db);
  const attivita = await leggiAttivita(ctx.db);
  const ciclo = leggiCiclo();
  const t = timer.attivo("pomodoro");
  const d = t ? t.dati : durate(imp);

  // Quadrante con anello di avanzamento: il motore aggiorna numero e anello da solo
  const R = 108, CIRC = 2 * Math.PI * R;
  const fase = t ? t.dati.fase : null;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.setAttribute("class", "anello-svg");
  svg.setAttribute("aria-hidden", "true");
  for (const [classe, extra] of [["anello-fondo", {}], ["anello-avanzamento", { "data-anello": "pomodoro", "data-circonferenza": CIRC }]]) {
    const c = document.createElementNS(ns, "circle");
    for (const [k, v] of Object.entries({ cx: 120, cy: 120, r: R, class: classe, "stroke-dasharray": CIRC, "stroke-dashoffset": CIRC, ...extra })) c.setAttribute(k, v);
    svg.append(c);
  }
  const quadrante = h("div", { class: `quadrante ${fase && fase !== "lavoro" ? "in-pausa-fase" : ""}` },
    svg,
    h("div", { class: "quadrante-testo" },
      h("span", { class: "quadrante-fase" },
        !t ? (ciclo.dopoPausa ? "Pausa finita" : "Pronto") : { lavoro: "Concentrazione", breve: "Pausa", lunga: "Pausa lunga" }[fase]),
      h("span", { class: "quadrante-tempo", "data-timer": "pomodoro", "data-vuoto": timer.formato(d.lavoro * 60000) },
        t ? timer.formato(timer.rimanente(t)) : timer.formato(d.lavoro * 60000)),
      t?.pausa !== null && t ? h("span", { class: "quadrante-fase" }, "In pausa") : null));

  // Pallini del ciclo: quanti pomodori mancano alla pausa lunga
  const fatti = (ciclo.completati || 0) % d.ogni;
  const pallini = h("div", { class: "pallini", "aria-label": `${fatti} di ${d.ogni} pomodori prima della pausa lunga` },
    Array.from({ length: d.ogni }, (_, i) => h("span", { class: i < fatti ? "pallino pieno" : "pallino" })),
    h("span", { class: "nota" }, `${fatti} di ${d.ogni} prima della pausa lunga`));

  if (!t) {
    // ---- nessun timer: scegli durata e attività, poi avvia
    el.append(segmenti(
      [{ valore: "classico", etichetta: PRESET.classico.nome }, { valore: "lungo", etichetta: PRESET.lungo.nome },
       { valore: "personalizzato", etichetta: "Su misura" }],
      imp.preset, async (v) => { imp.preset = v; await salvaImpostazioni(ctx.db, imp); ctx.ricarica(); }, { nome: "preset" }));

    const p = durate(imp);
    el.append(h("p", { class: "nota descrizione-preset" },
      `${p.lavoro} minuti di lavoro, ${p.breve} di pausa, ${p.lunga} di pausa lunga ogni ${p.ogni} pomodori.`));

    if (imp.preset === "personalizzato") {
      const numero = (chiave, etichetta) => campo(etichetta, h("input", {
        type: "text", inputmode: "numeric", value: imp.personalizzato[chiave],
        onchange: async (e) => {
          const n = Math.round(Number(e.target.value));
          if (!(n >= 1 && n <= (chiave === "ogni" ? 12 : 180))) { avviso("Scrivi un numero valido"); e.target.value = imp.personalizzato[chiave]; return; }
          imp.personalizzato[chiave] = n;
          await salvaImpostazioni(ctx.db, imp);
          ctx.ricarica();
        } }));
      el.append(h("section", { class: "gruppo" },
        h("div", { class: "due-colonne" },
          numero("lavoro", "Lavoro (min)"), numero("breve", "Pausa (min)"),
          numero("lunga", "Pausa lunga (min)"), numero("ogni", "Pausa lunga ogni"))));
    }

    // Attività
    const scelta = attivita.some((a) => a.nome === ciclo.attivita) ? ciclo.attivita : null;
    el.append(h("div", { class: "campo" },
      h("span", { class: "etichetta" }, "Su cosa lavori"),
      h("div", { class: "chips", role: "radiogroup", "aria-label": "Attività" },
        [{ nome: null, etichetta: "Nessuna" }, ...attivita.map((a) => ({ nome: a.nome, etichetta: a.nome }))].map((a) =>
          h("button", { type: "button", role: "radio", class: a.nome === scelta ? "chip attivo" : "chip",
            "aria-checked": a.nome === scelta ? "true" : "false",
            onclick: () => { const c = leggiCiclo(); c.attivita = a.nome; salvaCiclo(c); ctx.ricarica(); } }, a.etichetta)),
        h("a", { class: "chip chip-aggiungi", href: "#/produttivita/attivita" }, "+ Attività"))));

    el.append(quadrante, pallini,
      h("button", { class: "primario", type: "button", onclick: () => {
        timer.sbloccaAudio();
        const c = leggiCiclo(); c.dopoPausa = false; salvaCiclo(c);
        avviaFase("lavoro", { ...p, attivita: scelta });
      } }, ciclo.dopoPausa ? "Avvia il prossimo pomodoro" : "Avvia pomodoro"));
  } else {
    // ---- timer in corso
    el.append(
      h("p", { class: "attivita-in-corso" }, t.dati.attivita || "Nessuna attività"),
      quadrante, pallini,
      h("div", { class: "azioni-secondarie" },
        t.pausa !== null
          ? h("button", { type: "button", class: "primario", onclick: () => { timer.sbloccaAudio(); timer.riprendi("pomodoro"); } }, "Riprendi")
          : h("button", { type: "button", class: "secondario", onclick: () => timer.pausa("pomodoro") }, "Pausa"),
        fase === "lavoro"
          ? h("button", { type: "button", class: "secondario pericolo", onclick: async () => {
              if (await conferma("Interrompere il pomodoro? Non verrà contato.")) timer.ferma("pomodoro");
            } }, "Interrompi")
          : h("button", { type: "button", class: "secondario", onclick: () => {
              concludiPausa(fase);
              timer.ferma("pomodoro");
            } }, "Salta la pausa")),
      h("p", { class: "nota" }, "Lo schermo resta acceso finché il timer è attivo. Se blocchi il telefono, " +
        "alla riapertura il tempo sarà comunque giusto, ma il suono arriva solo con l'app aperta."));
  }

  // Oggi in breve
  const sessioni = (await leggiSessioni(ctx.db)).filter((s) => s.data === oggi());
  const minuti = sessioni.reduce((s, x) => s + x.minuti, 0);
  el.append(h("section", { class: "gruppo" },
    h("div", { class: "due-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Oggi"), h("span", { class: "cifra" }, pomodoriTesto(sessioni.length))),
      h("div", {}, h("span", { class: "etichetta" }, "Tempo concentrato"), h("span", { class: "cifra" }, tempoTesto(minuti))))));
}

// ================================================================ STATISTICHE
async function statistiche(el, ctx) {
  const sessioni = await leggiSessioni(ctx.db);
  if (!sessioni.length) {
    el.append(vuoto("Qui vedrai quanti pomodori fai, giorno per giorno e per attività.",
      h("a", { class: "bottone", href: PAGINA }, "Avvia il primo pomodoro")));
    return;
  }
  const oggiISO = oggi();
  const somma = (lista) => lista.reduce((s, x) => s + x.minuti, 0);
  const diOggi = sessioni.filter((s) => s.data === oggiISO);
  const lun = lunediDi(oggiISO);
  const giorniSett = Array.from({ length: 7 }, (_, i) => spostaGiorno(lun, i));
  const sett = sessioni.filter((s) => s.data >= lun);
  const da30 = spostaGiorno(oggiISO, -29);
  const ultimi30 = sessioni.filter((s) => s.data >= da30);
  const primoGiorno = sessioni.at(-1).data;
  const giorni30 = Math.min(30, Math.round((new Date(oggiISO) - new Date(primoGiorno > da30 ? primoGiorno : da30)) / 86400000) + 1);

  el.append(h("section", { class: "gruppo" },
    h("div", { class: "tre-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Oggi"), h("span", { class: "cifra" }, diOggi.length),
        h("span", { class: "nota" }, tempoTesto(somma(diOggi)))),
      h("div", {}, h("span", { class: "etichetta" }, "Questa settimana"), h("span", { class: "cifra" }, sett.length),
        h("span", { class: "nota" }, tempoTesto(somma(sett)))),
      h("div", {}, h("span", { class: "etichetta" }, "Media al giorno"), h("span", { class: "cifra" }, (ultimi30.length / giorni30).toFixed(1).replace(".", ",")),
        h("span", { class: "nota" }, "ultimi 30 giorni")))));

  // Settimana: una colonna per giorno, alta quanto il tempo concentrato
  const perGiorno = giorniSett.map((g) => somma(sessioni.filter((s) => s.data === g)));
  const max = Math.max(60, ...perGiorno);
  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Questa settimana"),
    h("div", { class: "colonne-settimana", role: "img",
        "aria-label": giorniSett.map((g, i) => `${GIORNI_BREVI[i]} ${tempoTesto(perGiorno[i])}`).join(", ") },
      giorniSett.map((g, i) => h("div", { class: `colonna-giorno${g === oggiISO ? " oggi" : ""}${g > oggiISO ? " futuro" : ""}` },
        h("span", { class: "colonna-valore" }, perGiorno[i] ? tempoTesto(perGiorno[i]).replace(" min", "′") : ""),
        h("div", { class: "colonna-traccia" },
          h("div", { class: "colonna-piena", style: { height: `${(perGiorno[i] / max) * 100}%` } })),
        h("span", { class: "colonna-etichetta" }, GIORNI_BREVI[i]))))));

  // Per attività
  const filtro = { settimana: (s) => s.data >= lun, mese: (s) => s.data >= oggiISO.slice(0, 8) + "01", tutto: () => true }[periodoAttivita];
  const scelte = sessioni.filter(filtro);
  const perAttivita = new Map();
  for (const s of scelte) {
    const k = s.attivita || "Senza attività";
    const v = perAttivita.get(k) || { minuti: 0, n: 0 };
    v.minuti += s.minuti; v.n++;
    perAttivita.set(k, v);
  }
  const righe = [...perAttivita.entries()].sort((a, b) => b[1].minuti - a[1].minuti);
  const maxA = Math.max(1, ...righe.map(([, v]) => v.minuti));
  el.append(h("h2", {}, "Per attività"),
    segmenti([{ valore: "settimana", etichetta: "Settimana" }, { valore: "mese", etichetta: "Mese" }, { valore: "tutto", etichetta: "Sempre" }],
      periodoAttivita, (v) => { periodoAttivita = v; ctx.ricarica(); }, { nome: "periodo" }),
    righe.length
      ? h("ul", { class: "elenco barre-categorie" }, righe.map(([nome, v]) =>
          h("li", {},
            h("div", { class: "barra-testo" }, h("span", {}, nome),
              h("span", { class: "cifra" }, `${tempoTesto(v.minuti)}, ${pomodoriTesto(v.n)}`)),
            h("div", { class: "barra-traccia" }, h("div", { class: "barra-piena attivita", style: { width: `${(v.minuti / maxA) * 100}%` } })))))
      : h("p", { class: "nota" }, "Nessun pomodoro in questo periodo."));

  // Sessioni di oggi
  if (diOggi.length) {
    el.append(h("h2", {}, "Pomodori di oggi"),
      h("ul", { class: "elenco" }, diOggi.map((s) =>
        h("li", { class: "riga" },
          h("div", { class: "riga-testo" },
            h("span", { class: "riga-titolo" }, s.attivita || "Senza attività"),
            h("span", { class: "riga-sotto" }, `${s.inizio}–${s.fine}`)),
          h("span", { class: "cifra" }, `${s.minuti} min`),
          h("button", { class: "elimina", type: "button", "aria-label": `Elimina il pomodoro delle ${s.inizio}`,
            onclick: async () => {
              if (await conferma(`Eliminare il pomodoro delle ${s.inizio}?`)) { await ctx.db.elimina(s.id); ctx.ricarica(); }
            } }, "×")))));
  }
}

// ================================================================ ATTIVITÀ
async function attivitaSezione(el, ctx) {
  const lista = await leggiAttivita(ctx.db);
  const nome = h("input", { type: "text", placeholder: "es. Tesi", autocapitalize: "sentences" });
  const aggiungi = async (valore) => {
    const n = (valore ?? nome.value).trim();
    if (!n) { avviso("Scrivi il nome dell'attività"); nome.focus(); return; }
    if (lista.some((a) => a.nome.toLowerCase() === n.toLowerCase())) { avviso(`${n} c'è già`); return; }
    await ctx.db.aggiungi(ATTIVITA, { nome: n, ordine: Math.max(0, ...lista.map((a) => a.ordine)) + 1 });
    avviso(`${n} aggiunta`);
    ctx.ricarica();
  };
  const suggerite = SUGGERITE.filter((s) => !lista.some((a) => a.nome.toLowerCase() === s.toLowerCase()));

  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Nuova attività"),
    campo("Nome", nome),
    suggerite.length ? h("div", { class: "chips" },
      h("span", { class: "nota" }, "Oppure aggiungi:"),
      suggerite.map((s) => h("button", { type: "button", class: "chip", onclick: () => aggiungi(s) }, `+ ${s}`))) : null,
    h("button", { class: "primario", type: "button", onclick: () => aggiungi() }, "Aggiungi attività")));

  if (!lista.length) return;
  el.append(h("h2", {}, "Le tue attività"),
    h("p", { class: "nota" }, "Tocca un'attività per rinominarla. I pomodori già fatti restano conteggiati."),
    h("ul", { class: "elenco" }, lista.map((a) => a.id === attivitaInModifica
      ? h("li", {}, formModifica({
          valori: a,
          campi: [{ chiave: "nome", etichetta: "Nome", intera: true }],
          annulla: () => { attivitaInModifica = null; ctx.ricarica(); },
          salva: async (m) => {
            const n = m.nome.trim();
            if (!n) { avviso("Il nome non può essere vuoto"); return; }
            // Rinomina anche i pomodori già fatti, così le statistiche restano unite
            for (const s of (await ctx.db.tutti(SESSIONI)).filter((s) => s.attivita === a.nome)) {
              await ctx.db.aggiorna({ ...s, attivita: n });
            }
            const c = leggiCiclo(); if (c.attivita === a.nome) { c.attivita = n; salvaCiclo(c); }
            await ctx.db.aggiorna({ ...a, nome: n });
            attivitaInModifica = null;
            avviso("Attività rinominata");
            ctx.ricarica();
          },
        }))
      : h("li", { class: "riga-con-azione" },
          h("button", { type: "button", class: "riga riga-tocca", "aria-label": `Rinomina ${a.nome}`,
            onclick: () => { attivitaInModifica = a.id; ctx.ricarica(); } },
            h("div", { class: "riga-testo" }, h("span", { class: "riga-titolo" }, a.nome))),
          h("button", { class: "elimina", type: "button", "aria-label": `Elimina ${a.nome}`,
            onclick: async () => {
              if (await conferma(`Eliminare "${a.nome}"? I pomodori già fatti restano nelle statistiche.`)) {
                await ctx.db.elimina(a.id); ctx.ricarica();
              }
            } }, "×")))));
}

// ================================================================ HOME
async function riepilogo(ctx) {
  const sessioni = (await leggiSessioni(ctx.db)).filter((s) => s.data === oggi());
  const t = timer.attivo("pomodoro");
  return h("div", { class: "corpo-home" },
    h("div", { class: "due-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Pomodori oggi"), h("span", { class: "cifra" }, sessioni.length)),
      t ? h("div", {}, h("span", { class: "etichetta" }, t.etichetta), h("span", { class: "cifra", "data-timer": "pomodoro" }, timer.formato(timer.rimanente(t))))
        : h("div", {}, h("span", { class: "etichetta" }, "Tempo concentrato"), h("span", { class: "cifra" }, tempoTesto(sessioni.reduce((s, x) => s + x.minuti, 0))))),
    h("a", { class: "bottone", href: PAGINA }, t ? "Vai al timer" : "Avvia un pomodoro"));
}

export default {
  id: "produttivita",
  nome: "Produttività",
  colore: "var(--produttivita)",
  icona: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 3h5M12 3v3"/></svg>',
  sezioni: [
    { id: "timer", nome: "Timer", render: timerSezione },
    { id: "statistiche", nome: "Statistiche", render: statistiche },
    { id: "attivita", nome: "Attività", render: attivitaSezione },
  ],
  riepilogo,
};
