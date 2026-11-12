// =============================================================================
// MODULO ABITUDINI
// Collezioni:
//   "abitudini.lista" → { nome, giorni: [1, 3, 5], volte, ordine, creata }
//   "abitudini.fatte" → { data, abitudine }   (una voce = quel giorno l'hai fatta)
//
// Due tipi di abitudine:
//   - a GIORNI FISSI (volte assente): giorni dice quando va fatta
//     (0 = domenica, 1 = lunedì ... 6 = sabato). I giorni non previsti non
//     interrompono la serie, che si conta in giorni.
//   - SETTIMANALE (volte = 3): basta farla N volte da lunedì a domenica, in
//     qualunque giorno. La serie si conta in settimane riuscite.
// =============================================================================

import { h, oggi, dataLunga, spostaGiorno, giornoSettimana, avviso, campo,
         vuoto, conferma, formModifica, segmenti } from "../ui.js";

const LISTA = "abitudini.lista";
const FATTE = "abitudini.fatte";

// In ordine italiano: si parte dal lunedì
const SETTIMANA = [
  { n: 1, breve: "L", nome: "lunedì", abbr: "Lun" },
  { n: 2, breve: "M", nome: "martedì", abbr: "Mar" },
  { n: 3, breve: "M", nome: "mercoledì", abbr: "Mer" },
  { n: 4, breve: "G", nome: "giovedì", abbr: "Gio" },
  { n: 5, breve: "V", nome: "venerdì", abbr: "Ven" },
  { n: 6, breve: "S", nome: "sabato", abbr: "Sab" },
  { n: 0, breve: "D", nome: "domenica", abbr: "Dom" },
];
const TUTTI = [0, 1, 2, 3, 4, 5, 6];

const nuovaBozza = () => ({ nome: "", tipo: "fissi", giorni: [...TUTTI], volte: 3 });

let giornoVisto = oggi();
let bozza = nuovaBozza();
let inModifica = null;

// ---------------------------------------------------------------- dati
async function leggi(db) {
  const lista = (await db.tutti(LISTA)).sort((a, b) => a.ordine - b.ordine || a.id - b.id);
  const fatte = new Map(); // "idAbitudine|data" → id della voce (serve per toglierla)
  for (const f of await db.tutti(FATTE)) fatte.set(`${f.abitudine}|${f.data}`, f.id);
  return { lista, fatte };
}

const settimanale = (a) => Boolean(a.volte);
const fatta = (fatte, a, data) => fatte.has(`${a.id}|${data}`);
const prevista = (a, data) => settimanale(a) || a.giorni.includes(giornoSettimana(data));
/** Il lunedì della settimana che contiene la data. */
const lunediDi = (iso) => spostaGiorno(iso, -((giornoSettimana(iso) + 6) % 7));
/** Quante volte l'hai fatta nella settimana che inizia con quel lunedì. */
const fatteNellaSettimana = (fatte, a, lunedi) =>
  Array.from({ length: 7 }, (_, i) => spostaGiorno(lunedi, i)).filter((g) => fatta(fatte, a, g)).length;
const volteTesto = (n) => `${n} ${n === 1 ? "volta" : "volte"}`;

function descrivi(a) {
  if (settimanale(a)) return `${volteTesto(a.volte)} a settimana`;
  const giorni = a.giorni;
  if (giorni.length === 7) return "Tutti i giorni";
  if (giorni.length === 5 && [1, 2, 3, 4, 5].every((g) => giorni.includes(g))) return "Dal lunedì al venerdì";
  if (giorni.length === 2 && giorni.includes(0) && giorni.includes(6)) return "Nel weekend";
  return SETTIMANA.filter((s) => giorni.includes(s.n)).map((s) => s.abbr).join(", ");
}

/** Primo giorno da considerare: la creazione, o una spunta precedente se l'hai segnata a posteriori. */
function inizioDi(a, fatte) {
  let inizio = a.creata;
  for (const k of fatte.keys()) {
    const [id, data] = k.split("|");
    if (Number(id) === a.id && data < inizio) inizio = data;
  }
  return inizio;
}

/** Statistiche di un'abitudine a giorni fissi: serie e record in giorni, percentuale ultimi 30 giorni. */
function statisticheGiorni(a, fatte) {
  const oggiISO = oggi();
  const inizio = inizioDi(a, fatte);

  // Serie attuale: all'indietro da oggi (se oggi non l'hai ancora fatta, si parte da ieri)
  let serie = 0;
  let d = fatta(fatte, a, oggiISO) ? oggiISO : spostaGiorno(oggiISO, -1);
  while (d >= inizio) {
    if (prevista(a, d)) {
      if (fatta(fatte, a, d)) serie++;
      else break;
    }
    d = spostaGiorno(d, -1);
  }

  // Record: la serie più lunga dall'inizio
  let record = 0, corrente = 0;
  for (let g = inizio; g <= oggiISO; g = spostaGiorno(g, 1)) {
    if (!prevista(a, g)) continue;
    if (fatta(fatte, a, g)) record = Math.max(record, ++corrente);
    else if (g !== oggiISO) corrente = 0;
  }

  // Ultimi 30 giorni (oggi conta solo se l'hai già fatta)
  let previsti = 0, fatti = 0;
  const da = [spostaGiorno(oggiISO, -29), inizio].sort().at(-1);
  for (let g = da; g <= oggiISO; g = spostaGiorno(g, 1)) {
    if (!prevista(a, g)) continue;
    const ok = fatta(fatte, a, g);
    if (g === oggiISO && !ok) continue;
    previsti++;
    if (ok) fatti++;
  }
  return { serie, record, percentuale: previsti ? Math.round((fatti / previsti) * 100) : null };
}

/**
 * Statistiche di un'abitudine settimanale: serie e record in settimane riuscite.
 * La settimana in corso non interrompe la serie (c'è ancora tempo), e nemmeno la
 * prima settimana se non è stata completata (magari l'hai creata di giovedì).
 */
function statisticheSettimane(a, fatte) {
  const corrente = lunediDi(oggi());
  const prima = lunediDi(inizioDi(a, fatte));
  const riuscita = (lun) => fatteNellaSettimana(fatte, a, lun) >= a.volte;

  let serie = riuscita(corrente) ? 1 : 0;
  for (let lun = spostaGiorno(corrente, -7); lun >= prima; lun = spostaGiorno(lun, -7)) {
    if (riuscita(lun)) serie++;
    else break;
  }

  let record = 0, fila = 0;
  for (let lun = prima; lun <= corrente; lun = spostaGiorno(lun, 7)) {
    if (riuscita(lun)) record = Math.max(record, ++fila);
    else if (lun !== corrente && lun !== prima) fila = 0;
  }
  return { serie, record, questaSettimana: fatteNellaSettimana(fatte, a, corrente) };
}

// ---------------------------------------------------------------- componenti
/** Bottoni per scegliere i giorni della settimana. */
function sceltaGiorni(giorni) {
  return h("div", { class: "giorni-scelta", role: "group", "aria-label": "Giorni della settimana" },
    SETTIMANA.map((s) => {
      const attivo = giorni.includes(s.n);
      return h("button", {
        type: "button", class: attivo ? "attivo" : "", "aria-pressed": attivo ? "true" : "false",
        "aria-label": s.nome,
        onclick: (e) => {
          // Lo stato si legge ADESSO, non quando il bottone è stato creato:
          // altrimenti dopo il primo tocco il bottone "crede" di essere ancora attivo.
          const eraAttivo = giorni.includes(s.n);
          const nuovi = eraAttivo ? giorni.filter((g) => g !== s.n) : [...giorni, s.n];
          if (!nuovi.length) { avviso("Scegli almeno un giorno"); return; }
          giorni.splice(0, giorni.length, ...nuovi);
          e.currentTarget.classList.toggle("attivo", !eraAttivo);
          e.currentTarget.setAttribute("aria-pressed", String(!eraAttivo));
        },
      }, s.breve);
    }));
}

/** Contatore − 3 + per le volte a settimana. */
function contatore(stato) {
  const numero = h("span", { class: "contatore-numero", "aria-live": "polite" }, stato.volte);
  const testo = h("span", { class: "nota" }, `${stato.volte === 1 ? "volta" : "volte"} a settimana`);
  const cambia = (delta) => {
    stato.volte = Math.min(7, Math.max(1, stato.volte + delta)); // sempre letto da `stato`, mai copiato
    numero.textContent = stato.volte;
    testo.textContent = `${stato.volte === 1 ? "volta" : "volte"} a settimana`;
  };
  return h("div", { class: "contatore" },
    h("button", { type: "button", "aria-label": "Una volta in meno", onclick: () => cambia(-1) }, "−"),
    h("span", {}, numero, " ", testo),
    h("button", { type: "button", "aria-label": "Una volta in più", onclick: () => cambia(1) }, "+"));
}

/**
 * Scelta di quando fare l'abitudine: giorni fissi oppure N volte a settimana.
 * Si ridisegna da sola quando cambi tipo, senza perdere il resto del modulo.
 */
function sceltaFrequenza(stato) {
  const box = h("div", { class: "campo frequenza" });
  const disegna = () => box.replaceChildren(
    h("span", { class: "etichetta" }, "Quando"),
    segmenti(
      [{ valore: "fissi", etichetta: "Giorni fissi" }, { valore: "settimana", etichetta: "Volte a settimana" }],
      stato.tipo, (t) => { stato.tipo = t; disegna(); }, { nome: "frequenza" }),
    stato.tipo === "fissi" ? sceltaGiorni(stato.giorni) : contatore(stato),
    h("p", { class: "nota" }, stato.tipo === "fissi"
      ? "I giorni non scelti non interrompono la serie."
      : "Va bene qualunque giorno: conta arrivare al numero entro domenica."));
  disegna();
  return box;
}

/** Da stato del modulo a campi da salvare. */
const frequenzaDaSalvare = (stato) => stato.tipo === "settimana"
  ? { volte: stato.volte, giorni: [...TUTTI] }
  : { volte: null, giorni: [...stato.giorni].sort() };

// ---------------------------------------------------------------- Oggi
async function oggiSezione(el, ctx) {
  const { lista, fatte } = await leggi(ctx.db);
  if (!lista.length) {
    el.append(vuoto("Crea la lista delle abitudini che vuoi seguire.",
      h("a", { class: "bottone", href: "#/abitudini/gestisci" }, "Crea la prima abitudine")));
    return;
  }
  const oggiISO = oggi();
  const giornaliere = lista.filter((a) => !settimanale(a) && prevista(a, giornoVisto));
  const settimanali = lista.filter(settimanale);
  const altre = lista.filter((a) => !settimanale(a) && !prevista(a, giornoVisto));
  const completate = giornaliere.filter((a) => fatta(fatte, a, giornoVisto)).length;
  const etichettaGiorno = giornoVisto === oggiISO ? "Oggi"
    : giornoVisto === spostaGiorno(oggiISO, -1) ? "Ieri" : dataLunga(giornoVisto);
  const lunediVisto = lunediDi(giornoVisto);

  el.append(
    h("div", { class: "naviga-mese" },
      h("button", { type: "button", "aria-label": "Giorno precedente",
        onclick: () => { giornoVisto = spostaGiorno(giornoVisto, -1); ctx.ricarica(); } }, "‹"),
      h("span", {}, etichettaGiorno),
      h("button", { type: "button", "aria-label": "Giorno successivo", disabled: giornoVisto >= oggiISO,
        onclick: () => { giornoVisto = spostaGiorno(giornoVisto, 1); ctx.ricarica(); } }, "›")));

  // Una riga con la spunta: tocchi e segni (o togli) l'abitudine in quel giorno
  const riga = (a, sottotitolo) => {
    const ok = fatta(fatte, a, giornoVisto);
    return h("li", {},
      h("button", { type: "button", role: "checkbox", "aria-checked": ok ? "true" : "false",
        class: ok ? "abitudine fatta" : "abitudine",
        onclick: async () => {
          const k = `${a.id}|${giornoVisto}`;
          if (fatte.has(k)) await ctx.db.elimina(fatte.get(k));
          else await ctx.db.aggiungi(FATTE, { data: giornoVisto, abitudine: a.id });
          ctx.ricarica();
        } },
        h("span", { class: "spunta", "aria-hidden": "true",
          html: '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>' }),
        h("span", { class: "riga-testo" },
          h("span", { class: "riga-titolo" }, a.nome),
          h("span", { class: "riga-sotto" }, sottotitolo))));
  };

  if (giornaliere.length) {
    el.append(h("div", { class: "progresso", role: "progressbar", "aria-valuemin": 0,
        "aria-valuemax": giornaliere.length, "aria-valuenow": completate,
        "aria-label": `${completate} di ${giornaliere.length} fatte` },
      h("div", { class: "progresso-testo" },
        h("span", { class: "cifra" }, `${completate} di ${giornaliere.length}`),
        h("span", { class: "nota" }, completate === giornaliere.length ? "Tutto fatto" : "fatte")),
      h("div", { class: "barra-traccia" },
        h("div", { class: "barra-piena", style: { width: `${(completate / giornaliere.length) * 100}%` } }))),
      h("ul", { class: "elenco abitudini" }, giornaliere.map((a) => {
        const { serie } = statisticheGiorni(a, fatte);
        return riga(a, serie >= 2 ? `${serie} ${a.giorni.length === 7 ? "giorni" : "volte"} di fila` : descrivi(a));
      })));
  } else if (!settimanali.length) {
    el.append(vuoto("Nessuna abitudine prevista in questo giorno."));
  }

  if (settimanali.length) {
    el.append(h("h2", {}, giornoVisto >= lunediDi(oggiISO) ? "Questa settimana" : "In quella settimana"),
      h("ul", { class: "elenco abitudini" }, settimanali.map((a) => {
        const n = fatteNellaSettimana(fatte, a, lunediVisto);
        const { serie } = statisticheSettimane(a, fatte);
        const stato = n >= a.volte ? `Obiettivo raggiunto: ${n} di ${a.volte}` : `${n} di ${a.volte}`;
        const settimanaCorrente = lunediVisto === lunediDi(oggiISO);
        return riga(a, settimanaCorrente && serie >= 2 ? `${stato}, ${serie} settimane di fila` : stato);
      })));
  }

  if (altre.length) {
    el.append(h("p", { class: "nota" }, `Non previste in questo giorno: ${altre.map((a) => a.nome).join(", ")}.`));
  }
}

// ---------------------------------------------------------------- Andamento
async function andamento(el, ctx) {
  const { lista, fatte } = await leggi(ctx.db);
  if (!lista.length) {
    el.append(vuoto("Qui vedrai le tue serie dopo aver creato le abitudini.",
      h("a", { class: "bottone", href: "#/abitudini/gestisci" }, "Crea la prima abitudine")));
    return;
  }
  const oggiISO = oggi();
  // Calendario: 5 settimane, da lunedì a domenica, l'ultima è quella corrente
  const lunediCorrente = lunediDi(oggiISO);
  const primo = spostaGiorno(lunediCorrente, -28);
  const DESCRIZIONI = { fatto: "fatto", mancato: "non fatto", libero: "non fatto", oggi: "da fare", futuro: "", prima: "" };

  for (const a of lista) {
    const inizio = inizioDi(a, fatte);
    const sett = settimanale(a);
    const celle = [];
    for (let i = 0; i < 35; i++) {
      const g = spostaGiorno(primo, i);
      let stato = g > oggiISO ? "futuro" : "prima";   // "prima" = l'abitudine non esisteva ancora
      if (fatta(fatte, a, g)) stato = "fatto";
      else if (g <= oggiISO && g >= inizio) {
        // per le settimanali un giorno vuoto non è un errore: è solo un giorno libero
        stato = sett || !prevista(a, g) ? "libero" : g === oggiISO ? "oggi" : "mancato";
      }
      celle.push(h("span", { class: `cella ${stato}`, title: `${dataLunga(g)}: ${DESCRIZIONI[stato]}` }));

      // In fondo a ogni riga delle settimanali: quante volte su quante
      if (sett && i % 7 === 6) {
        const lun = spostaGiorno(primo, i - 6);
        const n = fatteNellaSettimana(fatte, a, lun);
        const classe = n >= a.volte ? "riuscita" : lun === lunediCorrente ? "in-corso"
          : lun < lunediDi(inizio) ? "vuota" : "mancata";
        celle.push(h("span", { class: `totale-sett ${classe}` }, classe === "vuota" ? "" : `${n}/${a.volte}`));
      }
    }

    let numeri;
    if (sett) {
      const st = statisticheSettimane(a, fatte);
      numeri = [["Serie attuale", `${st.serie} sett.`], ["Record", `${st.record} sett.`],
                ["Questa settimana", `${st.questaSettimana} di ${a.volte}`]];
    } else {
      const st = statisticheGiorni(a, fatte);
      numeri = [["Serie attuale", st.serie], ["Record", st.record],
                ["Ultimi 30 giorni", st.percentuale === null ? "—" : `${st.percentuale}%`]];
    }

    el.append(h("section", { class: "gruppo" },
      h("div", {},
        h("h2", { class: "nel-gruppo" }, a.nome),
        h("p", { class: "nota" }, descrivi(a))),
      h("div", { class: "tre-colonne" }, numeri.map(([etichetta, valore]) =>
        h("div", {}, h("span", { class: "etichetta" }, etichetta), h("span", { class: "cifra" }, valore)))),
      h("div", { class: sett ? "calendario settimanale" : "calendario", role: "img",
          "aria-label": `Ultime 5 settimane di ${a.nome}` },
        SETTIMANA.map((s) => h("span", { class: "intestazione-cal", "aria-hidden": "true" }, s.breve)),
        sett ? h("span", { class: "intestazione-cal", "aria-hidden": "true" }, "Tot.") : null,
        celle)));
  }
  el.append(h("div", { class: "legenda-cal" },
    h("span", {}, h("span", { class: "cella fatto" }), "Fatto"),
    h("span", {}, h("span", { class: "cella mancato" }), "Non fatto"),
    h("span", {}, h("span", { class: "cella libero" }), "Giorno libero")));
}

// ---------------------------------------------------------------- Gestisci
async function gestisci(el, ctx) {
  const { lista } = await leggi(ctx.db);

  const nome = h("input", { type: "text", value: bozza.nome, placeholder: "es. Bere 2 litri d'acqua",
    autocapitalize: "sentences", oninput: (e) => (bozza.nome = e.target.value) });
  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Nuova abitudine"),
    campo("Nome", nome),
    sceltaFrequenza(bozza),
    h("button", { class: "primario", type: "button", onclick: async () => {
      if (!bozza.nome.trim()) { avviso("Dai un nome all'abitudine"); nome.focus(); return; }
      await ctx.db.aggiungi(LISTA, {
        nome: bozza.nome.trim(), ...frequenzaDaSalvare(bozza),
        ordine: Math.max(0, ...lista.map((a) => a.ordine)) + 1, creata: oggi() });
      avviso(`${bozza.nome.trim()} aggiunta`);
      bozza = nuovaBozza();
      ctx.ricarica();
    } }, "Aggiungi abitudine")));

  if (!lista.length) return;

  const sposta = async (a, delta) => {
    const i = lista.indexOf(a), altro = lista[i + delta];
    if (!altro) return;
    await ctx.db.aggiorna({ ...a, ordine: altro.ordine });
    await ctx.db.aggiorna({ ...altro, ordine: a.ordine });
    ctx.ricarica();
  };

  el.append(h("h2", {}, "Le tue abitudini"),
    h("p", { class: "nota" }, "Tocca un'abitudine per modificarla o spostarla."),
    h("ul", { class: "elenco" }, lista.map((a) => {
      if (a.id === inModifica) {
        const stato = { tipo: settimanale(a) ? "settimana" : "fissi",
          giorni: settimanale(a) ? [...TUTTI] : [...a.giorni], volte: a.volte || 3 };
        return h("li", {}, formModifica({
          valori: a,
          campi: [{ chiave: "nome", etichetta: "Nome", intera: true }],
          extra: [
            sceltaFrequenza(stato),
            h("div", { class: "sposta" },
              h("span", { class: "etichetta" }, "Posizione"),
              h("button", { type: "button", class: "secondario", onclick: () => sposta(a, -1) }, "↑ Su"),
              h("button", { type: "button", class: "secondario", onclick: () => sposta(a, 1) }, "↓ Giù")),
          ],
          annulla: () => { inModifica = null; ctx.ricarica(); },
          salva: async (m) => {
            if (!m.nome.trim()) { avviso("Il nome non può essere vuoto"); return; }
            await ctx.db.aggiorna({ ...a, nome: m.nome.trim(), ...frequenzaDaSalvare(stato) });
            inModifica = null;
            avviso("Abitudine aggiornata");
            ctx.ricarica();
          },
        }));
      }
      return h("li", { class: "riga-con-azione" },
        h("button", { type: "button", class: "riga riga-tocca", "aria-label": `Modifica ${a.nome}`,
          onclick: () => { inModifica = a.id; ctx.ricarica(); } },
          h("div", { class: "riga-testo" },
            h("span", { class: "riga-titolo" }, a.nome),
            h("span", { class: "riga-sotto" }, descrivi(a)))),
        h("button", { class: "elimina", type: "button", "aria-label": `Elimina ${a.nome}`,
          onclick: async () => {
            if (!(await conferma(`Eliminare "${a.nome}" e tutto il suo storico?`))) return;
            const fatte = (await ctx.db.tutti(FATTE)).filter((f) => f.abitudine === a.id);
            for (const f of fatte) await ctx.db.elimina(f.id);
            await ctx.db.elimina(a.id);
            ctx.ricarica();
          } }, "×"));
    })));
}

// ---------------------------------------------------------------- Home
async function riepilogo(ctx) {
  const { lista, fatte } = await leggi(ctx.db);
  if (!lista.length) {
    return h("div", { class: "corpo-home" },
      h("p", { class: "nota" }, "Nessuna abitudine ancora."),
      h("a", { class: "bottone", href: "#/abitudini/gestisci" }, "Crea la prima abitudine"));
  }
  const g = oggi();
  const previste = lista.filter((a) => !settimanale(a) && prevista(a, g));
  const fatteOggi = previste.filter((a) => fatta(fatte, a, g)).length;
  const settimanali = lista.filter(settimanale);
  const raggiunti = settimanali.filter((a) => fatteNellaSettimana(fatte, a, lunediDi(g)) >= a.volte).length;
  return h("div", { class: "corpo-home" },
    h("div", { class: "due-colonne" },
      h("div", {},
        h("span", { class: "etichetta" }, "Oggi"),
        h("span", { class: "cifra" }, previste.length ? `${fatteOggi} di ${previste.length}` : "Libero")),
      settimanali.length ? h("div", {},
        h("span", { class: "etichetta" }, "Obiettivi settimana"),
        h("span", { class: "cifra" }, `${raggiunti} di ${settimanali.length}`)) : null),
    h("a", { class: "bottone", href: "#/abitudini/oggi" }, "Segna le abitudini"));
}

export default {
  id: "abitudini",
  nome: "Abitudini",
  colore: "var(--abitudini)",
  icona: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5M9 14.8l2.1 2.1 4-4.2"/></svg>',
  sezioni: [
    { id: "oggi", nome: "Oggi", render: oggiSezione },
    { id: "andamento", nome: "Andamento", render: andamento },
    { id: "gestisci", nome: "Gestisci", render: gestisci },
  ],
  riepilogo,
};
