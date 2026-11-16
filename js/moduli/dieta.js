// =============================================================================
// MODULO DIETA
// Collezioni:
//   "palestra.dieta" → il piano del nutrizionista (il nome della collezione è rimasto
//                      quello di quando la dieta stava nel modulo Palestra, così i dati
//                      già inseriti valgono ancora):
//                      { nome, dataInizio, note, ordinePasti, voci: [{ id, pasto, alimento, quantita, note }] }
//   "dieta.giorni"   → come è andata ogni giorno:
//                      { data, pasti: ["Colazione", ...], stati: { "Pranzo": "perfetto" | "parziale" | "libero" } }
//                      `pasti` è la lista dei pasti previsti QUEL giorno: se poi la dieta cambia,
//                      lo storico e le statistiche dei giorni passati restano giusti.
//
// Punteggio: perfetto = 1, parziale = 0,5, non segnato = 0. Il pasto libero non conta.
// =============================================================================

import { h, oggi, dataBreve, dataLunga, spostaGiorno, giornoSettimana, avviso, campo, vuoto,
         conferma, formModifica, nuovoId, spostaNelGruppo, intestazioneModificabile,
         bottoniSposta, chiudiIntestazione } from "../ui.js";

// ------------------------------------------------------------- impostazioni del modulo
const PASTI_LIBERI_A_SETTIMANA = 1;
const GIORNI_DB = "dieta.giorni";
const PUNTI = { perfetto: 1, parziale: 0.5 };
const NOMI_GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const INIZIALI = ["L", "M", "M", "G", "V", "S", "D"];

let giornoVisto = oggi();

// ------------------------------------------------------------- dati della checklist
async function leggiGiorni(db) {
  const mappa = new Map(); // data → voce del giorno
  for (const g of await db.tutti(GIORNI_DB)) mappa.set(g.data, g);
  return mappa;
}

/** La dieta valida in una data: l'ultima iniziata entro quel giorno (o la più vecchia, se iniziano tutte dopo). */
const dietaDel = (diete, data) => diete.find((d) => d.dataInizio <= data) || diete.at(-1) || null;

/**
 * I pasti previsti in un giorno.
 * Giorni passati: quelli salvati quel giorno. Se quel giorno non hai segnato nulla, quelli del giorno
 *   segnato più vicino (prima quello precedente): così se cambi la dieta, il passato non cambia.
 * Oggi: quelli della dieta attuale (più eventuali pasti già segnati che nel frattempo hai tolto dalla dieta).
 */
function pastiDelGiorno(data, giorni, diete) {
  const salvato = giorni.get(data);
  if (salvato && data !== oggi()) return salvato.pasti;
  if (!salvato && data < oggi()) {
    const date = [...giorni.keys()].sort();
    const prima = date.filter((g) => g < data).at(-1);
    const dopo = date.find((g) => g > data && g !== oggi());
    const vicino = prima || dopo;
    if (vicino) return giorni.get(vicino).pasti;
  }
  const d = dietaDel(diete, data);
  const dalPiano = d ? pastiDi(d) : [];
  if (!salvato) return dalPiano;
  return [...dalPiano, ...salvato.pasti.filter((p) => !dalPiano.includes(p) && salvato.stati[p])];
}

/** Primo giorno da contare: il primo in cui hai segnato qualcosa. Prima di allora non si conta nulla. */
const inizioDi = (giorni) => [...giorni.keys()].sort()[0] || null;

/**
 * Punteggio di un giorno: { punti, pasti, valore (da 0 a 1) } oppure null se non c'è niente da contare.
 * Oggi contano solo i pasti già segnati: la giornata non è ancora finita.
 */
function punteggio(data, giorni, diete) {
  const inizio = inizioDi(giorni);
  if (!inizio || data < inizio || data > oggi()) return null;
  const stati = giorni.get(data)?.stati || {};
  let contati = pastiDelGiorno(data, giorni, diete).filter((p) => stati[p] !== "libero");
  if (data === oggi()) contati = contati.filter((p) => stati[p]);
  if (!contati.length) return null;
  const punti = contati.reduce((s, p) => s + (PUNTI[stati[p]] || 0), 0);
  return { punti, pasti: contati.length, valore: punti / contati.length };
}

/** Percentuale su un periodo (pesata sui pasti): da `da` a `a` compresi. */
function percentuale(da, a, giorni, diete) {
  let punti = 0, pasti = 0;
  for (let g = da; g <= a; g = spostaGiorno(g, 1)) {
    const p = punteggio(g, giorni, diete);
    if (p) { punti += p.punti; pasti += p.pasti; }
  }
  return pasti ? Math.round((punti / pasti) * 100) : null;
}

/** Oggi è perfetto solo se TUTTI i pasti (tranne il libero) sono segnati come perfetti. */
function oggiPerfetto(giorni, diete) {
  const stati = giorni.get(oggi())?.stati || {};
  const pasti = pastiDelGiorno(oggi(), giorni, diete).filter((p) => stati[p] !== "libero");
  return pasti.length > 0 && pasti.every((p) => stati[p] === "perfetto");
}

/** Giorni perfetti di fila (oggi conta solo se è già perfetto) e record. */
function serie(giorni, diete) {
  const inizio = inizioDi(giorni);
  if (!inizio) return { attuale: 0, record: 0 };
  const perfetto = (g) => (g === oggi() ? oggiPerfetto(giorni, diete) : punteggio(g, giorni, diete)?.valore === 1);
  let attuale = 0;
  for (let g = perfetto(oggi()) ? oggi() : spostaGiorno(oggi(), -1); g >= inizio && perfetto(g); g = spostaGiorno(g, -1)) attuale++;
  let record = 0, fila = 0;
  for (let g = inizio; g <= oggi(); g = spostaGiorno(g, 1)) {
    if (perfetto(g)) record = Math.max(record, ++fila);
    else if (g !== oggi()) fila = 0;
  }
  return { attuale, record };
}

const lunediDi = (iso) => spostaGiorno(iso, -((giornoSettimana(iso) + 6) % 7));

/** I pasti liberi usati nella settimana della data: [{ data, pasto }] */
function liberiDellaSettimana(data, giorni) {
  const lun = lunediDi(data), usati = [];
  for (let i = 0; i < 7; i++) {
    const g = spostaGiorno(lun, i);
    for (const [pasto, stato] of Object.entries(giorni.get(g)?.stati || {})) {
      if (stato === "libero") usati.push({ data: g, pasto });
    }
  }
  return usati;
}

/** Salva lo stato di un pasto in un giorno (stato null = lo toglie). */
async function salvaStato(db, data, pasto, stato, pastiPrevisti, giorni) {
  const esistente = giorni.get(data);
  const stati = { ...(esistente?.stati || {}) };
  if (stato) stati[pasto] = stato;
  else delete stati[pasto];
  if (!Object.keys(stati).length) {
    if (esistente) await db.elimina(esistente.id);
    return;
  }
  const voce = { data, pasti: pastiPrevisti, stati };
  if (esistente) await db.aggiorna({ ...esistente, ...voce });
  else await db.aggiungi(GIORNI_DB, voce);
}

const percentualeTesto = (n) => (n === null ? "—" : `${n}%`);
const ICONA_SPUNTA = '<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg>';

// ================================================================ OGGI
async function oggiSezione(el, ctx) {
  const diete = await leggiDiete(ctx.db);
  if (!diete.length) {
    el.append(vuoto("Prima inserisci la dieta del nutrizionista: da lì nasce la lista dei pasti da segnare.",
      h("a", { class: "bottone", href: "#/dieta/piano" }, "Inserisci la dieta")));
    return;
  }
  const giorni = await leggiGiorni(ctx.db);
  const oggiISO = oggi();
  const pasti = pastiDelGiorno(giornoVisto, giorni, diete);
  const dieta = dietaDel(diete, giornoVisto);
  const stati = giorni.get(giornoVisto)?.stati || {};
  const etichetta = giornoVisto === oggiISO ? "Oggi"
    : giornoVisto === spostaGiorno(oggiISO, -1) ? "Ieri" : dataLunga(giornoVisto);

  el.append(h("div", { class: "naviga-mese" },
    h("button", { type: "button", "aria-label": "Giorno precedente",
      onclick: () => { giornoVisto = spostaGiorno(giornoVisto, -1); ctx.ricarica(); } }, "‹"),
    h("span", {}, etichetta),
    h("button", { type: "button", "aria-label": "Giorno successivo", disabled: giornoVisto >= oggiISO,
      onclick: () => { giornoVisto = spostaGiorno(giornoVisto, 1); ctx.ricarica(); } }, "›")));
  if (giornoVisto !== oggiISO) {
    el.append(h("button", { type: "button", class: "link torna-oggi",
      onclick: () => { giornoVisto = oggiISO; ctx.ricarica(); } }, "Torna a oggi"));
  }

  if (!pasti.length) {
    el.append(vuoto("La dieta non ha ancora pasti.", h("a", { class: "bottone", href: "#/dieta/piano" }, "Completa la dieta")));
    return;
  }

  // Riepilogo del giorno
  const conta = (s) => pasti.filter((p) => stati[p] === s).length;
  const daSegnare = pasti.filter((p) => !stati[p]).length;
  // Stesso calcolo delle statistiche: oggi contano solo i pasti già segnati (la giornata non è finita)
  const p = punteggio(giornoVisto, giorni, diete);
  const valore = p ? Math.round(p.valore * 100) : null;
  const dettagli = [
    conta("perfetto") && `${conta("perfetto")} ${conta("perfetto") === 1 ? "perfetto" : "perfetti"}`,
    conta("parziale") && `${conta("parziale")} ${conta("parziale") === 1 ? "parziale" : "parziali"}`,
    conta("libero") && "1 libero",
    daSegnare && `${daSegnare} da segnare`,
  ].filter(Boolean).join(", ");

  el.append(h("section", { class: "gruppo" },
    h("div", { class: "cifra-grande" },
      h("span", { class: "etichetta" }, giornoVisto === oggiISO ? "Come sta andando oggi" : "Com'è andata"),
      h("span", { class: "valore" }, valore === null ? "—" : `${valore}%`),
      h("span", { class: "nota" }, dettagli)),
    h("div", { class: "barra-traccia" },
      h("div", { class: "barra-piena dieta", style: { width: `${valore || 0}%` } }))));

  // Pasto libero della settimana
  const liberi = liberiDellaSettimana(giornoVisto, giorni);
  const liberoTesto = liberi.length >= PASTI_LIBERI_A_SETTIMANA
    ? `Pasto libero della settimana usato: ${liberi.map((l) => `${l.pasto} di ${NOMI_GIORNI[giornoSettimana(l.data)]}`).join(", ")}.`
    : "Pasto libero della settimana: ancora disponibile.";

  const salva = async (pasto, stato) => {
    await salvaStato(ctx.db, giornoVisto, pasto, stato, pasti, giorni);
    ctx.ricarica();
  };

  el.append(h("ul", { class: "elenco pasti-giorno" }, pasti.map((p) => {
    const stato = stati[p] || null;
    const alimenti = (dieta?.voci || []).filter((v) => v.pasto === p)
      .map((v) => (v.quantita ? `${v.alimento} ${v.quantita}` : v.alimento)).join(", ");
    const prossimo = { null: "perfetto", perfetto: "parziale", parziale: null, libero: null }[stato];
    const descrizione = { perfetto: "Perfetto", parziale: "Parziale", libero: "Pasto libero" }[stato] || "Da segnare";
    return h("li", { class: "riga-con-azione" },
      h("button", { type: "button", class: `pasto-check ${stato || "vuoto"}`,
        "aria-label": `${p}: ${descrizione}. Tocca per cambiare`,
        onclick: () => salva(p, prossimo) },
        h("span", { class: "spunta-pasto", "aria-hidden": "true", html: stato === "libero" ? "L" : ICONA_SPUNTA }),
        h("span", { class: "riga-testo" },
          h("span", { class: "riga-titolo" }, p),
          h("span", { class: "riga-sotto" }, stato ? descrizione : (alimenti || "Da segnare")))),
      h("button", { type: "button", class: stato === "libero" ? "libero attivo" : "libero",
        "aria-pressed": stato === "libero" ? "true" : "false",
        onclick: () => {
          if (stato === "libero") return salva(p, null);
          const altri = liberi.filter((l) => !(l.data === giornoVisto && l.pasto === p));
          if (altri.length >= PASTI_LIBERI_A_SETTIMANA) {
            avviso(`Hai già usato il pasto libero di questa settimana (${altri[0].pasto} di ${NOMI_GIORNI[giornoSettimana(altri[0].data)]})`);
            return;
          }
          return salva(p, "libero");
        } }, "Libero"));
  })),
  h("p", { class: "nota" }, liberoTesto),
  h("p", { class: "nota" }, "Un tocco: perfetto. Due tocchi: parziale. Tre tocchi: lo togli. Un pasto non segnato conta come non rispettato."));
}

// ================================================================ ANDAMENTO
async function andamento(el, ctx) {
  const diete = await leggiDiete(ctx.db);
  const giorni = await leggiGiorni(ctx.db);
  if (!giorni.size) {
    el.append(vuoto("Qui vedrai quanto rispetti la dieta, dopo aver segnato i primi pasti.",
      h("a", { class: "bottone", href: "#/dieta/oggi" }, "Segna i pasti di oggi")));
    return;
  }
  const oggiISO = oggi();
  const lunCorrente = lunediDi(oggiISO);
  const primoDelMese = oggiISO.slice(0, 8) + "01";
  const sett = percentuale(lunCorrente, oggiISO, giorni, diete);
  const mese = percentuale(primoDelMese, oggiISO, giorni, diete);
  const { attuale, record } = serie(giorni, diete);

  el.append(h("section", { class: "gruppo" },
    h("div", { class: "tre-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Questa settimana"), h("span", { class: "cifra" }, percentualeTesto(sett))),
      h("div", {}, h("span", { class: "etichetta" }, "Questo mese"), h("span", { class: "cifra" }, percentualeTesto(mese))),
      h("div", {}, h("span", { class: "etichetta" }, "Giorni perfetti di fila"), h("span", { class: "cifra" }, attuale))),
    h("p", { class: "nota" }, `Record: ${record} ${record === 1 ? "giorno perfetto" : "giorni perfetti"} di fila. ` +
      "Un pasto parziale vale metà; il pasto libero non conta.")));

  // Calendario delle ultime 5 settimane, con la percentuale di ogni settimana
  const primo = spostaGiorno(lunCorrente, -28);
  const celle = [];
  for (let i = 0; i < 35; i++) {
    const g = spostaGiorno(primo, i);
    const p = punteggio(g, giorni, diete);
    const libero = Object.values(giorni.get(g)?.stati || {}).includes("libero");
    let stato;
    if (g > oggiISO) stato = "futuro";
    else if (!p) stato = g === oggiISO ? "oggi" : "prima";
    else if (p.valore === 1) stato = "fatto";
    else if (p.valore >= 0.75) stato = "buono";
    else if (p.valore >= 0.4) stato = "medio";
    else stato = "mancato";
    celle.push(h("span", { class: `cella ${stato}${libero ? " con-libero" : ""}`,
      title: `${dataLunga(g)}${p ? `: ${Math.round(p.valore * 100)}%` : ""}${libero ? ", con pasto libero" : ""}` }));
    if (i % 7 === 6) {
      const lun = spostaGiorno(primo, i - 6);
      const perc = percentuale(lun, spostaGiorno(lun, 6), giorni, diete);
      const classe = perc === null ? "vuota" : lun === lunCorrente ? "in-corso" : perc >= 80 ? "riuscita" : perc < 50 ? "mancata" : "media";
      celle.push(h("span", { class: `totale-sett ${classe}` }, perc === null ? "" : `${perc}%`));
    }
  }
  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Ultime 5 settimane"),
    h("div", { class: "calendario settimanale", role: "img", "aria-label": "Rispetto della dieta nelle ultime 5 settimane" },
      INIZIALI.map((l) => h("span", { class: "intestazione-cal", "aria-hidden": "true" }, l)),
      h("span", { class: "intestazione-cal", "aria-hidden": "true" }, "Sett."),
      celle),
    h("div", { class: "legenda-cal" },
      h("span", {}, h("span", { class: "cella fatto" }), "Perfetto"),
      h("span", {}, h("span", { class: "cella buono" }), "Quasi"),
      h("span", {}, h("span", { class: "cella medio" }), "A metà"),
      h("span", {}, h("span", { class: "cella mancato" }), "Non rispettata"),
      h("span", {}, h("span", { class: "cella con-libero legenda-libero" }), "Pasto libero"))));

  // Quali pasti rispetti di più e di meno (ultimi 30 giorni)
  const da = spostaGiorno(oggiISO, -29);
  const perPasto = new Map();
  for (let g = da; g <= oggiISO; g = spostaGiorno(g, 1)) {
    if (!punteggio(g, giorni, diete)) continue;
    const stati = giorni.get(g)?.stati || {};
    for (const p of pastiDelGiorno(g, giorni, diete)) {
      if (stati[p] === "libero" || (g === oggiISO && !stati[p])) continue;
      const v = perPasto.get(p) || { punti: 0, volte: 0 };
      v.punti += PUNTI[stati[p]] || 0; v.volte++;
      perPasto.set(p, v);
    }
  }
  const ordine = dietaDel(diete, oggiISO) ? pastiDi(dietaDel(diete, oggiISO)) : [];
  const righe = [...perPasto.entries()]
    .sort(([a], [b]) => (ordine.indexOf(a) + 1 || 99) - (ordine.indexOf(b) + 1 || 99));
  if (righe.length) {
    el.append(h("h2", {}, "Pasto per pasto"),
      h("p", { class: "nota" }, "Ultimi 30 giorni: dove sei più costante e dove puoi migliorare."),
      h("ul", { class: "elenco barre-categorie" }, righe.map(([p, v]) => {
        const perc = Math.round((v.punti / v.volte) * 100);
        return h("li", {},
          h("div", { class: "barra-testo" }, h("span", {}, p), h("span", { class: "cifra" }, `${perc}%`)),
          h("div", { class: "barra-traccia" }, h("div", { class: "barra-piena dieta", style: { width: `${perc}%` } })));
      })));
  }
}

// ================================================================ PIANO
// (il piano del nutrizionista: prima stava nel modulo Palestra)
const DIETA = "palestra.dieta";
// I pasti con questi nomi vengono messi in quest'ordine; gli altri seguono.
const ORDINE_PASTI = ["colazione", "spuntino", "spuntino mattina", "pranzo", "merenda",
  "spuntino pomeriggio", "pre allenamento", "post allenamento", "cena", "dopo cena"];

let dietaScelta = null;
let dietaInModifica = false;      // modalità modifica attiva
let voceInModifica = null;
let bozzaVoce = { pasto: "Colazione", alimento: "", quantita: "", note: "" };

async function leggiDiete(db) {
  const d = await db.tutti(DIETA);
  return d.sort((a, b) => b.dataInizio.localeCompare(a.dataInizio) || b.id - a.id);
}

/**
 * L'ordine dei pasti. Se l'hai deciso tu (dieta.ordinePasti, con i pulsanti su/giù) vale quello;
 * i pasti che non ci sono ancora (appena creati o rinominati) vanno in fondo.
 * Se non l'hai mai toccato, si usa l'ordine automatico per nome (ORDINE_PASTI).
 */
function pastiDi(dieta) {
  const pasti = [...new Set(dieta.voci.map((v) => v.pasto))];
  const automatico = (p) => {
    const i = ORDINE_PASTI.indexOf(p.toLowerCase());
    return i === -1 ? 100 + pasti.indexOf(p) : i;
  };
  const scelto = dieta.ordinePasti || [];
  const posizione = (p) => (scelto.includes(p) ? scelto.indexOf(p) : 1000 + automatico(p));
  return pasti.sort((a, b) => posizione(a) - posizione(b));
}

async function piano(el, ctx) {
  const diete = await leggiDiete(ctx.db);

  const formNuova = () => {
    const nome = h("input", { type: "text", value: diete.length ? "" : "La mia dieta", placeholder: "es. Dieta novembre" });
    const inizio = h("input", { type: "date", value: oggi() });
    return h("details", { class: "gruppo apribile", open: !diete.length },
      h("summary", {}, "Nuova dieta"),
      campo("Nome", nome),
      campo("Inizio", inizio),
      h("button", { class: "primario", type: "button", onclick: async () => {
        if (!nome.value.trim()) { avviso("Dai un nome alla dieta"); nome.focus(); return; }
        dietaScelta = await ctx.db.aggiungi(DIETA, {
          nome: nome.value.trim(), dataInizio: inizio.value || oggi(), note: "", voci: [] });
        dietaInModifica = true;
        avviso("Dieta creata: aggiungi gli alimenti");
        ctx.ricarica();
      } }, "Crea dieta"));
  };

  if (!diete.length) {
    el.append(vuoto("Inserisci la dieta del nutrizionista per averla sempre a portata di mano."), formNuova());
    return;
  }

  const d = diete.find((x) => x.id === dietaScelta) || diete[0];
  const salvaDieta = async () => { await ctx.db.aggiorna(d); ctx.ricarica(); };
  const pasti = pastiDi(d);

  if (diete.length > 1) {
    el.append(campo("Dieta", h("select", {
      onchange: (e) => { dietaScelta = Number(e.target.value); voceInModifica = null; ctx.ricarica(); },
    }, diete.map((x) => h("option", { value: x.id, selected: x.id === d.id }, `${x.nome} (dal ${dataBreve(x.dataInizio)})`)))));
  }

  const alterna = () => { dietaInModifica = !dietaInModifica; voceInModifica = null; chiudiIntestazione(); ctx.ricarica(); };
  // append() di un elemento HTML non accetta liste: con "..." le "spacchettiamo"
  el.append(...(dietaInModifica
    ? [intestazioneModificabile(d, ctx, "dieta"),
       h("button", { type: "button", class: "primario", onclick: alterna }, "Fine modifiche"),
       h("p", { class: "nota" }, "Tocca un alimento per modificarlo. Con le frecce accanto ai pasti cambi il loro ordine.")]
    : [h("div", { class: "titolo-scheda" },
        h("div", {},
          h("h2", {}, d.nome),
          h("p", { class: "nota" }, `Dal ${dataBreve(d.dataInizio)}`),
          d.note ? h("p", { class: "nota-trainer" }, d.note) : null),
        h("button", { type: "button", class: "link", onclick: alterna }, "Modifica"))]));

  if (!pasti.length) el.append(h("p", { class: "nota" }, "Nessun alimento: aggiungi il primo qui sotto."));

  const modificaVoce = (v) => formModifica({
    valori: v,
    campi: [
      { chiave: "alimento", etichetta: "Alimento" },
      { chiave: "quantita", etichetta: "Quantità" },
      { chiave: "pasto", etichetta: "Pasto", attributi: { list: "lista-pasti" } },
      { chiave: "note", etichetta: "Note o alternative" },
    ],
    extra: bottoniSposta(async (delta) => { if (spostaNelGruppo(d.voci, v, "pasto", delta)) await salvaDieta(); }),
    annulla: () => { voceInModifica = null; ctx.ricarica(); },
    salva: async (m) => {
      if (!m.alimento.trim() || !m.pasto.trim()) { avviso("Indica pasto e alimento"); return; }
      Object.assign(v, { alimento: m.alimento.trim(), quantita: m.quantita.trim(), pasto: m.pasto.trim(), note: m.note.trim() });
      voceInModifica = null;
      avviso("Alimento aggiornato");
      await salvaDieta();
    },
  });

  // Sposta un pasto intero di un posto (delta = -1 su, +1 giù) e ricorda l'ordine nella dieta
  const spostaPasto = async (p, delta) => {
    const ordine = [...pasti];
    const i = ordine.indexOf(p), j = i + delta;
    if (j < 0 || j >= ordine.length) return;
    [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
    d.ordinePasti = ordine;
    await salvaDieta();
  };

  for (const [n, p] of pasti.entries()) {
    const titolo = !dietaInModifica ? h("h3", { class: "titolo-giorno" }, p)
      : h("div", { class: "titolo-pasto" },
          h("h3", { class: "titolo-giorno" }, p),
          h("button", { type: "button", class: "sposta-pasto", "aria-label": `Sposta ${p} su`, disabled: n === 0,
            onclick: () => spostaPasto(p, -1) }, "↑"),
          h("button", { type: "button", class: "sposta-pasto", "aria-label": `Sposta ${p} giù`, disabled: n === pasti.length - 1,
            onclick: () => spostaPasto(p, 1) }, "↓"));
    el.append(titolo,
      h("ul", { class: "elenco" }, d.voci.filter((v) => v.pasto === p).map((v) => {
        const contenuto = [
          h("div", { class: "riga-testo" },
            h("span", { class: "riga-titolo" }, v.alimento),
            v.note ? h("span", { class: "riga-sotto" }, v.note) : null),
          v.quantita ? h("span", { class: "quantita" }, v.quantita) : null,
        ];
        if (!dietaInModifica) return h("li", { class: "riga" }, contenuto);
        if (v.id === voceInModifica) return h("li", {}, modificaVoce(v));
        return h("li", { class: "riga-con-azione" },
          h("button", { type: "button", class: "riga riga-tocca", "aria-label": `Modifica ${v.alimento}`,
            onclick: () => { voceInModifica = v.id; ctx.ricarica(); } }, contenuto),
          h("button", { class: "elimina", type: "button", "aria-label": `Elimina ${v.alimento}`,
            onclick: async () => {
              if (await conferma(`Togliere ${v.alimento} da ${p}?`)) {
                d.voci = d.voci.filter((x) => x.id !== v.id);
                await salvaDieta();
              }
            } }, "×"));
      })));
  }

  if (!dietaInModifica) return;

  const b = bozzaVoce;
  const legato = (k, attr = {}) => h("input", { type: "text", value: b[k], ...attr, oninput: (e) => (b[k] = e.target.value) });
  const suggeriti = [...new Set([...pasti, "Colazione", "Spuntino", "Pranzo", "Merenda", "Cena"])];
  el.append(
    h("datalist", { id: "lista-pasti" }, suggeriti.map((p) => h("option", { value: p }))),
    h("section", { class: "gruppo" },
      h("h2", { class: "nel-gruppo" }, "Aggiungi alimento"),
      campo("Pasto", legato("pasto", { list: "lista-pasti" })),
      h("div", { class: "due-colonne" },
        campo("Alimento", legato("alimento", { placeholder: "es. Fiocchi d'avena", autocapitalize: "sentences" })),
        campo("Quantità", legato("quantita", { placeholder: "es. 50 g" }))),
      campo("Note o alternative", legato("note", { placeholder: "es. oppure 60 g di pane integrale" })),
      h("button", { class: "primario", type: "button", onclick: async () => {
        if (!b.pasto.trim() || !b.alimento.trim()) { avviso("Indica pasto e alimento"); return; }
        d.voci.push({ id: nuovoId(), pasto: b.pasto.trim(), alimento: b.alimento.trim(),
          quantita: b.quantita.trim(), note: b.note.trim() });
        avviso(`${b.alimento.trim()} aggiunto`);
        bozzaVoce = { pasto: b.pasto, alimento: "", quantita: "", note: "" }; // il pasto resta: comodo per inserirne tanti
        await salvaDieta();
      } }, "Aggiungi alla dieta")),
    formNuova(),
    h("div", { class: "azioni-secondarie" },
      h("button", { type: "button", class: "secondario", onclick: async () => {
        dietaScelta = await ctx.db.aggiungi(DIETA, {
          nome: `${d.nome} (copia)`, dataInizio: oggi(), note: d.note, ordinePasti: d.ordinePasti,
          voci: d.voci.map((v) => ({ ...v, id: nuovoId() })) });
        avviso("Dieta duplicata: modifica solo ciò che cambia");
        ctx.ricarica();
      } }, "Duplica dieta"),
      h("button", { type: "button", class: "secondario pericolo", onclick: async () => {
        if (await conferma(`Eliminare "${d.nome}"?`)) {
          await ctx.db.elimina(d.id); dietaScelta = null; ctx.ricarica();
        }
      } }, "Elimina dieta")));
}


// ================================================================ HOME
async function riepilogo(ctx) {
  const diete = await leggiDiete(ctx.db);
  if (!diete.length) {
    return h("div", { class: "corpo-home" },
      h("p", { class: "nota" }, "Inserisci la dieta del nutrizionista per iniziare."),
      h("a", { class: "bottone", href: "#/dieta/piano" }, "Inserisci la dieta"));
  }
  const giorni = await leggiGiorni(ctx.db);
  const pasti = pastiDelGiorno(oggi(), giorni, diete);
  const stati = giorni.get(oggi())?.stati || {};
  const segnati = pasti.filter((p) => stati[p]).length;
  const sett = percentuale(lunediDi(oggi()), oggi(), giorni, diete);
  return h("div", { class: "corpo-home" },
    h("div", { class: "due-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Pasti segnati oggi"), h("span", { class: "cifra" }, `${segnati} di ${pasti.length}`)),
      h("div", {}, h("span", { class: "etichetta" }, "Questa settimana"), h("span", { class: "cifra" }, percentualeTesto(sett)))),
    h("a", { class: "bottone", href: "#/dieta/oggi" }, "Segna i pasti"));
}

export default {
  id: "dieta",
  nome: "Dieta",
  colore: "var(--dieta)",
  icona: '<svg viewBox="0 0 24 24"><path d="M12 20.5c-4.2 0-7-3-7-7.2C5 9.6 7.4 7 10.2 7c.8 0 1.3.3 1.8.3s1-.3 1.8-.3C16.6 7 19 9.6 19 13.3c0 4.2-2.8 7.2-7 7.2z"/><path d="M12 7.3c0-2 .9-3.5 2.6-4.3"/></svg>',
  sezioni: [
    { id: "oggi", nome: "Oggi", render: oggiSezione },
    { id: "andamento", nome: "Andamento", render: andamento },
    { id: "piano", nome: "Piano", render: piano },
  ],
  riepilogo,
};
