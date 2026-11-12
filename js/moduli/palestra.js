// =============================================================================
// MODULO PALESTRA
// Collezioni:
//   "palestra.schede"   → { nome, dataInizio, note, esercizi: [{ id, giorno, nome, serie, ripetizioni, recupero, note }] }
//   "palestra.registro" → { data, esercizio, carico, ripetizioni, note }
//   "palestra.misure"   → { data, valori: { peso: 72.4, massa_grassa: 16.1, ... } }
//   "palestra.dieta"    → { nome, dataInizio, note, voci: [{ id, pasto, alimento, quantita, note }] }
//
// Il registro salva il NOME dell'esercizio: i progressi su "Panca piana"
// continuano anche quando passi a una scheda nuova.
// =============================================================================

import { h, numero, oggi, dataBreve, giorniFa, leggiNumero, avviso, segmenti, campo,
         inputNumero, vuoto, conferma, graficoLinea, formModifica } from "../ui.js";

const SCHEDE = "palestra.schede";
const REGISTRO = "palestra.registro";
const MISURE_DB = "palestra.misure";

// Per aggiungere una misura (es. braccio) basta una riga qui.
// meglio: "su" = aumento in verde, "giu" = diminuzione in verde, null = neutro
const MISURE = [
  { chiave: "peso", nome: "Peso", unita: "kg", meglio: null },
  { chiave: "massa_muscolare", nome: "Massa muscolare", unita: "kg", meglio: "su" },
  { chiave: "massa_grassa", nome: "Massa grassa", unita: "%", meglio: "giu" },
  { chiave: "vita", nome: "Vita", unita: "cm", meglio: "giu" },
];

// ---------------------------------------------------------------- stato pagina
let schedaScelta = null;
let giornoScelto = null;
let esercizioScelto = null;
let bozzaAllenamento = { data: oggi(), valori: {} };
let bozzaMisure = { data: oggi(), valori: {} };
let bozzaEsercizio = { giorno: "", nome: "", serie: "3", ripetizioni: "8-10", recupero: "", note: "" };

const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
const chiave = (nome) => nome.trim().toLowerCase();

// ---------------------------------------------------------------- lettura dati
async function leggiSchede(db) {
  const s = await db.tutti(SCHEDE);
  return s.sort((a, b) => b.dataInizio.localeCompare(a.dataInizio) || b.id - a.id);
}
async function leggiRegistro(db) {
  const r = await db.tutti(REGISTRO);
  return r.sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
}
async function leggiMisure(db) {
  const m = await db.tutti(MISURE_DB);
  return m.sort((a, b) => a.data.localeCompare(b.data));
}

function giorniDi(scheda) {
  return [...new Set(scheda.esercizi.map((e) => e.giorno))];
}

/** Ultima registrazione per ogni esercizio: { "panca piana": {...} } */
function ultimePerEsercizio(registro, primaDi = null) {
  const mappa = {};
  for (const r of registro) {
    if (primaDi && r.data >= primaDi) continue;
    if (!mappa[chiave(r.esercizio)]) mappa[chiave(r.esercizio)] = r;
  }
  return mappa;
}

/** Carico massimo per ogni data, in ordine cronologico. */
function andamentoEsercizio(registro, nome) {
  const perData = {};
  for (const r of registro.filter((r) => chiave(r.esercizio) === chiave(nome))) {
    perData[r.data] = Math.max(perData[r.data] ?? -Infinity, r.carico);
  }
  return Object.entries(perData).sort(([a], [b]) => a.localeCompare(b)).map(([x, y]) => ({ x, y }));
}

const kg = (n) => `${numero(n)} kg`;
const obiettivo = (e) =>
  [`${e.serie} × ${e.ripetizioni}`, e.recupero ? `recupero ${e.recupero}` : null].filter(Boolean).join(", ");

function variazione(delta, unita, meglio) {
  if (!delta) return h("span", { class: "variazione" }, `invariato`);
  const buona = meglio === "su" ? delta > 0 : meglio === "giu" ? delta < 0 : null;
  const classe = buona === null ? "variazione" : buona ? "variazione buona" : "variazione cattiva";
  return h("span", { class: classe }, `${delta > 0 ? "+" : "−"}${numero(Math.abs(delta))} ${unita}`);
}

// ================================================================ ALLENAMENTO
async function allenamento(el, ctx) {
  const schede = await leggiSchede(ctx.db);
  if (!schede.length) {
    el.append(vuoto("Prima inserisci la scheda del tuo trainer.",
      h("a", { class: "bottone", href: "#/palestra/schede" }, "Crea la scheda")));
    return;
  }
  const scheda = schede.find((s) => s.id === schedaScelta) || schede[0];
  const giorni = giorniDi(scheda);
  if (!giorni.length) {
    el.append(vuoto(`"${scheda.nome}" non ha ancora esercizi.`,
      h("a", { class: "bottone", href: "#/palestra/schede" }, "Aggiungi esercizi")));
    return;
  }
  const giorno = giorni.includes(giornoScelto) ? giornoScelto : giorni[0];
  const registro = await leggiRegistro(ctx.db);
  const precedenti = ultimePerEsercizio(registro, bozzaAllenamento.data);
  const diOggi = registro.filter((r) => r.data === bozzaAllenamento.data);

  if (schede.length > 1) {
    el.append(campo("Scheda", h("select", {
      onchange: (e) => { schedaScelta = Number(e.target.value); giornoScelto = null; ctx.ricarica(); },
    }, schede.map((s) => h("option", { value: s.id, selected: s.id === scheda.id }, s.nome)))));
  }

  el.append(
    segmenti(giorni.map((g) => ({ valore: g, etichetta: g })), giorno,
      (g) => { giornoScelto = g; ctx.ricarica(); }, { nome: "giorno" }),
    h("div", { class: "riga-data" },
      campo("Data", h("input", { type: "date", value: bozzaAllenamento.data,
        onchange: (e) => { bozzaAllenamento.data = e.target.value || oggi(); ctx.ricarica(); } }))));

  const esercizi = scheda.esercizi.filter((e) => e.giorno === giorno);
  const lista = h("div", { class: "esercizi" });

  for (const es of esercizi) {
    const valori = (bozzaAllenamento.valori[es.id] ||= { carico: "", ripetizioni: "", note: "" });
    const prima = precedenti[chiave(es.nome)];
    const giaFatto = diOggi.filter((r) => chiave(r.esercizio) === chiave(es.nome));

    const inputCarico = inputNumero({
      class: "carico", placeholder: "—",
      value: valori.carico, "aria-label": `Carico per ${es.nome} in kg`,
      oninput: (e) => (valori.carico = e.target.value),
    });

    lista.append(h("article", { class: "esercizio" },
      h("header", {},
        h("h3", {}, es.nome),
        h("p", { class: "obiettivo" }, obiettivo(es)),
        es.note ? h("p", { class: "nota-trainer" }, es.note) : null),
      h("div", { class: "precedente" },
        prima
          ? [h("span", {}, `Ultima volta ${kg(prima.carico)}${prima.ripetizioni ? ` × ${prima.ripetizioni}` : ""}, ${dataBreve(prima.data)}`),
             h("button", { type: "button", class: "link",
               onclick: () => { valori.carico = String(prima.carico).replace(".", ","); inputCarico.value = valori.carico; } },
               "Usa lo stesso")]
          : h("span", {}, "Prima volta: nessun carico precedente"),
        giaFatto.length ? h("span", { class: "gia-fatto" },
          `Già registrato in questa data: ${giaFatto.map((r) => kg(r.carico)).join(", ")}`) : null),
      h("div", { class: "input-esercizio" },
        h("label", { class: "campo campo-carico" },
          h("span", { class: "etichetta" }, "Carico"),
          h("div", { class: "con-unita" }, inputCarico, h("span", { class: "unita" }, "kg"))),
        campo("Ripetizioni", h("input", { type: "text", inputmode: "numeric", placeholder: "—",
          value: valori.ripetizioni, oninput: (e) => (valori.ripetizioni = e.target.value) })),
        campo("Note", h("input", { type: "text", placeholder: "Facoltative",
          value: valori.note, oninput: (e) => (valori.note = e.target.value) })))));
  }

  const salva = async () => {
    const righe = esercizi
      .map((es) => ({ es, v: bozzaAllenamento.valori[es.id] || {} }))
      .map(({ es, v }) => ({ es, carico: leggiNumero(v.carico), rip: leggiNumero(v.ripetizioni), note: (v.note || "").trim() }))
      .filter((r) => r.carico !== null);
    if (!righe.length) {
      avviso("Scrivi il carico di almeno un esercizio");
      return;
    }
    for (const r of righe) {
      await ctx.db.aggiungi(REGISTRO, {
        data: bozzaAllenamento.data, esercizio: r.es.nome, carico: r.carico,
        ripetizioni: r.rip !== null ? Math.round(r.rip) : null, note: r.note,
      });
      delete bozzaAllenamento.valori[r.es.id];
    }
    avviso(righe.length === 1 ? "Salvato 1 esercizio" : `Salvati ${righe.length} esercizi`);
    ctx.ricarica();
  };

  el.append(lista,
    h("p", { class: "nota" }, "Scrivi il carico della serie più pesante. Gli esercizi lasciati vuoti non vengono salvati."),
    h("div", { class: "azione-fissa" },
      h("button", { class: "primario", type: "button", onclick: salva }, "Salva allenamento")));
}

// ================================================================ PROGRESSI
async function progressi(el, ctx) {
  const registro = await leggiRegistro(ctx.db);
  if (!registro.length) {
    el.append(vuoto("Qui vedrai i progressi dopo il primo allenamento registrato.",
      h("a", { class: "bottone", href: "#/palestra/allenamento" }, "Vai all'allenamento")));
    return;
  }
  // Un nome per esercizio (la grafia più recente), in ordine alfabetico
  const nomi = Object.values(ultimePerEsercizio(registro)).map((r) => r.esercizio)
    .sort((a, b) => a.localeCompare(b, "it"));
  // Se non hai scelto nulla, mostra l'ultimo esercizio che hai fatto
  const scelto = nomi.find((n) => chiave(n) === chiave(esercizioScelto || registro[0].esercizio));
  const punti = andamentoEsercizio(registro, scelto);
  const primo = punti[0].y, ultimo = punti.at(-1).y;
  const massimo = Math.max(...punti.map((p) => p.y));

  el.append(
    campo("Esercizio", h("select", { onchange: (e) => { esercizioScelto = e.target.value; ctx.ricarica(); } },
      nomi.map((n) => h("option", { value: n, selected: n === scelto }, n)))),
    h("section", { class: "gruppo" },
      h("div", { class: "cifra-grande" },
        h("span", { class: "etichetta" }, "Ultimo carico"),
        h("span", { class: "valore" }, kg(ultimo)),
        punti.length > 1 ? variazione(ultimo - primo, "kg", "su") : null,
        punti.length > 1 ? h("span", { class: "nota" }, `rispetto al ${dataBreve(punti[0].x)}`) : null),
      graficoLinea(punti, { unita: "kg" }),
      h("div", { class: "tre-colonne" },
        h("div", {}, h("span", { class: "etichetta" }, "Primo"), h("span", { class: "cifra" }, kg(primo))),
        h("div", {}, h("span", { class: "etichetta" }, "Massimo"), h("span", { class: "cifra" }, kg(massimo))),
        h("div", {}, h("span", { class: "etichetta" }, "Sessioni"), h("span", { class: "cifra" }, punti.length)))));

  const storico = registro.filter((r) => chiave(r.esercizio) === chiave(scelto));
  el.append(h("h2", {}, "Storico"),
    h("ul", { class: "elenco" }, storico.map((r) =>
      h("li", { class: "riga" },
        h("div", { class: "riga-testo" },
          h("span", { class: "riga-titolo" }, dataBreve(r.data)),
          r.note ? h("span", { class: "riga-sotto" }, r.note) : null),
        h("span", { class: "cifra" }, kg(r.carico) + (r.ripetizioni ? ` × ${r.ripetizioni}` : "")),
        h("button", { class: "elimina", type: "button", "aria-label": `Elimina registrazione del ${dataBreve(r.data)}`,
          onclick: async () => {
            if (await conferma(`Eliminare ${kg(r.carico)} del ${dataBreve(r.data)}?`)) {
              await ctx.db.elimina(r.id); ctx.ricarica();
            }
          } }, "×")))));

  // Panoramica di tutti gli esercizi
  el.append(h("h2", {}, "Tutti gli esercizi"),
    h("ul", { class: "elenco" }, nomi.map((n) => {
      const p = andamentoEsercizio(registro, n);
      return h("li", {},
        h("button", { type: "button", class: "riga riga-tocca",
          onclick: () => { esercizioScelto = n; ctx.ricarica(); window.scrollTo(0, 0); } },
          h("div", { class: "riga-testo" }, h("span", { class: "riga-titolo" }, n),
            h("span", { class: "riga-sotto" }, `${p.length} ${p.length === 1 ? "sessione" : "sessioni"}`)),
          h("span", { class: "cifra" }, kg(p.at(-1).y)),
          p.length > 1 ? variazione(p.at(-1).y - p[0].y, "kg", "su") : null));
    })));
}

// ================================================================ MISURE
async function misure(el, ctx) {
  const storico = await leggiMisure(ctx.db);

  const salva = async () => {
    const valori = {};
    for (const m of MISURE) {
      const v = leggiNumero(bozzaMisure.valori[m.chiave]);
      if (v !== null) valori[m.chiave] = v;
    }
    if (!Object.keys(valori).length) {
      avviso("Compila almeno una misura");
      return;
    }
    // Una sola misurazione per data: se esiste già, la completa
    const esistente = storico.find((s) => s.data === bozzaMisure.data);
    if (esistente) await ctx.db.aggiorna({ ...esistente, valori: { ...esistente.valori, ...valori } });
    else await ctx.db.aggiungi(MISURE_DB, { data: bozzaMisure.data, valori });
    bozzaMisure = { data: oggi(), valori: {} };
    avviso("Misure salvate");
    ctx.ricarica();
  };

  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Nuova misurazione"),
    campo("Data", h("input", { type: "date", value: bozzaMisure.data,
      onchange: (e) => (bozzaMisure.data = e.target.value || oggi()) })),
    h("div", { class: "due-colonne" }, MISURE.map((m) =>
      campo(`${m.nome} (${m.unita})`, inputNumero({ placeholder: "—", value: bozzaMisure.valori[m.chiave] || "",
        oninput: (e) => (bozzaMisure.valori[m.chiave] = e.target.value) })))),
    h("p", { class: "nota" }, "Compila solo quelle che hai."),
    h("button", { class: "primario", type: "button", onclick: salva }, "Salva misure")));

  if (!storico.length) return;

  for (const m of MISURE) {
    const punti = storico.filter((s) => s.valori[m.chiave] !== undefined)
      .map((s) => ({ x: s.data, y: s.valori[m.chiave] }));
    if (!punti.length) continue;
    const ultimo = punti.at(-1).y;
    el.append(h("section", { class: "gruppo misura" },
      h("div", { class: "cifra-grande" },
        h("span", { class: "etichetta" }, m.nome),
        h("span", { class: "valore" }, `${numero(ultimo)} ${m.unita}`),
        punti.length > 1 ? variazione(ultimo - punti[0].y, m.unita, m.meglio) : null,
        punti.length > 1 ? h("span", { class: "nota" }, `dal ${dataBreve(punti[0].x)}`) : null),
      graficoLinea(punti, { unita: m.unita })));
  }

  el.append(h("h2", {}, "Storico"),
    h("ul", { class: "elenco" }, [...storico].reverse().map((s) =>
      h("li", { class: "riga" },
        h("div", { class: "riga-testo" },
          h("span", { class: "riga-titolo" }, dataBreve(s.data)),
          h("span", { class: "riga-sotto" }, MISURE.filter((m) => s.valori[m.chiave] !== undefined)
            .map((m) => `${m.nome} ${numero(s.valori[m.chiave])} ${m.unita}`).join(", "))),
        h("button", { class: "elimina", type: "button", "aria-label": `Elimina misure del ${dataBreve(s.data)}`,
          onclick: async () => {
            if (await conferma(`Eliminare le misure del ${dataBreve(s.data)}?`)) {
              await ctx.db.elimina(s.id); ctx.ricarica();
            }
          } }, "×")))));
}

// ================================================================ SCHEDE
let esercizioInModifica = null;   // id dell'esercizio aperto in modifica
let intestazioneAperta = null;    // "collezione:id" del documento di cui stai modificando nome e data

/** Sposta un elemento di un posto (delta = -1 su, +1 giù) tra quelli dello stesso gruppo. */
function spostaNelGruppo(lista, elemento, gruppo, delta) {
  const stessi = lista.filter((x) => x[gruppo] === elemento[gruppo]);
  const altro = stessi[stessi.indexOf(elemento) + delta];
  if (!altro) return false;
  const i = lista.indexOf(elemento), j = lista.indexOf(altro);
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return true;
}

/** Intestazione con nome e data, modificabile (usata da schede e dieta). */
function intestazioneModificabile(doc, ctx, nomeTipo) {
  const chiaveDoc = `${doc.collezione}:${doc.id}`;
  if (intestazioneAperta !== chiaveDoc) {
    return h("div", { class: "titolo-scheda" },
      h("div", {},
        h("h2", {}, doc.nome),
        h("p", { class: "nota" }, `Dal ${dataBreve(doc.dataInizio)}`),
        doc.note ? h("p", { class: "nota-trainer" }, doc.note) : null),
      h("button", { type: "button", class: "link", onclick: () => { intestazioneAperta = chiaveDoc; ctx.ricarica(); } },
        "Rinomina"));
  }
  return formModifica({
    valori: doc,
    campi: [
      { chiave: "nome", etichetta: `Nome della ${nomeTipo}` },
      { chiave: "dataInizio", etichetta: "Inizio", attributi: { type: "date" } },
      { chiave: "note", etichetta: "Note generali", intera: true, attributi: { placeholder: "Facoltative" } },
    ],
    annulla: () => { intestazioneAperta = null; ctx.ricarica(); },
    salva: async (m) => {
      if (!m.nome.trim()) { avviso("Il nome non può essere vuoto"); return; }
      await ctx.db.aggiorna({ ...doc, nome: m.nome.trim(), dataInizio: m.dataInizio || doc.dataInizio, note: (m.note || "").trim() });
      intestazioneAperta = null;
      avviso("Modifiche salvate");
      ctx.ricarica();
    },
  });
}

/** Bottoni per spostare su e giù l'elemento in modifica. */
function bottoniSposta(sposta) {
  return h("div", { class: "sposta" },
    h("span", { class: "etichetta" }, "Posizione"),
    h("button", { type: "button", class: "secondario", "aria-label": "Sposta su", onclick: () => sposta(-1) }, "↑ Su"),
    h("button", { type: "button", class: "secondario", "aria-label": "Sposta giù", onclick: () => sposta(1) }, "↓ Giù"));
}

async function schede(el, ctx) {
  const tutte = await leggiSchede(ctx.db);
  const registro = await leggiRegistro(ctx.db);

  const formNuova = () => {
    const nome = h("input", { type: "text", placeholder: "es. Scheda novembre", required: true });
    const inizio = h("input", { type: "date", value: oggi() });
    return h("details", { class: "gruppo apribile", open: !tutte.length },
      h("summary", {}, "Nuova scheda"),
      campo("Nome", nome),
      campo("Inizio", inizio),
      h("button", { class: "primario", type: "button", onclick: async () => {
        if (!nome.value.trim()) { avviso("Dai un nome alla scheda"); nome.focus(); return; }
        schedaScelta = await ctx.db.aggiungi(SCHEDE, {
          nome: nome.value.trim(), dataInizio: inizio.value || oggi(), note: "", esercizi: [] });
        avviso("Scheda creata");
        ctx.ricarica();
      } }, "Crea scheda"));
  };

  if (!tutte.length) {
    el.append(formNuova());
    return;
  }

  const scheda = tutte.find((s) => s.id === schedaScelta) || tutte[0];
  if (tutte.length > 1) {
    el.append(campo("Scheda", h("select", {
      onchange: (e) => { schedaScelta = Number(e.target.value); esercizioInModifica = null; ctx.ricarica(); },
    }, tutte.map((s) => h("option", { value: s.id, selected: s.id === scheda.id }, `${s.nome} (dal ${dataBreve(s.dataInizio)})`)))));
  }

  const salvaScheda = async () => { await ctx.db.aggiorna(scheda); ctx.ricarica(); };

  // Nomi già usati: suggeriti mentre scrivi, così restano sempre uguali
  const nomiNoti = [...new Set([...tutte.flatMap((s) => s.esercizi.map((e) => e.nome)), ...registro.map((r) => r.esercizio)])]
    .sort((a, b) => a.localeCompare(b, "it"));
  const giorni = giorniDi(scheda);

  el.append(intestazioneModificabile(scheda, ctx, "scheda"),
    h("datalist", { id: "lista-giorni" }, giorni.map((g) => h("option", { value: g }))),
    h("datalist", { id: "lista-esercizi" }, nomiNoti.map((n) => h("option", { value: n }))));

  const modificaEsercizio = (e) => formModifica({
    valori: { ...e, serie: e.serie === "" || e.serie === null ? "" : String(e.serie) },
    campi: [
      { chiave: "nome", etichetta: "Esercizio", attributi: { list: "lista-esercizi" } },
      { chiave: "giorno", etichetta: "Giorno", attributi: { list: "lista-giorni" } },
      { chiave: "serie", etichetta: "Serie", attributi: { inputmode: "numeric" } },
      { chiave: "ripetizioni", etichetta: "Ripetizioni" },
      { chiave: "recupero", etichetta: "Recupero" },
      { chiave: "note", etichetta: "Note del trainer", intera: true },
    ],
    extra: bottoniSposta(async (delta) => {
      if (spostaNelGruppo(scheda.esercizi, e, "giorno", delta)) await salvaScheda();
    }),
    annulla: () => { esercizioInModifica = null; ctx.ricarica(); },
    salva: async (m) => {
      if (!m.nome.trim() || !m.giorno.trim()) { avviso("Indica giorno ed esercizio"); return; }
      // Se il nuovo nome coincide con un altro esercizio già usato, prende la sua grafia
      const nome = nomiNoti.find((n) => chiave(n) === chiave(m.nome) && chiave(n) !== chiave(e.nome)) || m.nome.trim();
      if (nome !== e.nome) {
        const vecchi = registro.filter((r) => chiave(r.esercizio) === chiave(e.nome));
        if (vecchi.length && await conferma(
          `Hai ${vecchi.length} ${vecchi.length === 1 ? "carico registrato" : "carichi registrati"} come "${e.nome}". ` +
          `Vuoi correggere anche ${vecchi.length === 1 ? "quello" : "quelli"} in "${nome}"? Così i progressi restano uniti.`)) {
          for (const r of vecchi) await ctx.db.aggiorna({ ...r, esercizio: nome });
        }
      }
      Object.assign(e, { nome, giorno: m.giorno.trim(), serie: leggiNumero(m.serie) ?? "",
        ripetizioni: m.ripetizioni.trim(), recupero: m.recupero.trim(), note: m.note.trim() });
      esercizioInModifica = null;
      avviso("Esercizio aggiornato");
      await salvaScheda();
    },
  });

  if (!giorni.length) el.append(h("p", { class: "nota" }, "Nessun esercizio: aggiungi il primo qui sotto."));
  else el.append(h("p", { class: "nota" }, "Tocca un esercizio per modificarlo o spostarlo."));
  for (const g of giorni) {
    el.append(h("h3", { class: "titolo-giorno" }, g),
      h("ul", { class: "elenco" }, scheda.esercizi.filter((e) => e.giorno === g).map((e) =>
        e.id === esercizioInModifica
          ? h("li", {}, modificaEsercizio(e))
          : h("li", { class: "riga-con-azione" },
              h("button", { type: "button", class: "riga riga-tocca", "aria-label": `Modifica ${e.nome}`,
                onclick: () => { esercizioInModifica = e.id; ctx.ricarica(); } },
                h("div", { class: "riga-testo" },
                  h("span", { class: "riga-titolo" }, e.nome),
                  h("span", { class: "riga-sotto" }, [obiettivo(e), e.note].filter(Boolean).join(". ")))),
              h("button", { class: "elimina", type: "button", "aria-label": `Elimina ${e.nome}`,
                onclick: async () => {
                  if (await conferma(`Togliere ${e.nome} dalla scheda?`)) {
                    scheda.esercizi = scheda.esercizi.filter((x) => x.id !== e.id);
                    await salvaScheda();
                  }
                } }, "×")))));
  }

  if (!bozzaEsercizio.giorno) bozzaEsercizio.giorno = giorni.at(-1) || "Giorno A";
  const b = bozzaEsercizio;
  const legato = (k, attr = {}) => h("input", { type: "text", value: b[k], ...attr, oninput: (e) => (b[k] = e.target.value) });

  el.append(h("section", { class: "gruppo" },
    h("h2", { class: "nel-gruppo" }, "Aggiungi esercizio"),
    h("div", { class: "due-colonne" },
      campo("Giorno", legato("giorno", { list: "lista-giorni", placeholder: "es. Giorno A" })),
      campo("Esercizio", legato("nome", { list: "lista-esercizi", placeholder: "es. Panca piana", autocapitalize: "sentences" }))),
    h("div", { class: "tre-colonne" },
      campo("Serie", legato("serie", { inputmode: "numeric" })),
      campo("Ripetizioni", legato("ripetizioni")),
      campo("Recupero", legato("recupero", { placeholder: "90\"" }))),
    campo("Note del trainer", legato("note", { placeholder: "Facoltative" })),
    h("button", { class: "primario", type: "button", onclick: async () => {
      if (!b.giorno.trim() || !b.nome.trim()) { avviso("Indica giorno ed esercizio"); return; }
      // Se il nome coincide con uno già usato (maiuscole a parte), usa quella grafia
      const nome = nomiNoti.find((n) => chiave(n) === chiave(b.nome)) || b.nome.trim();
      scheda.esercizi.push({ id: nuovoId(), giorno: b.giorno.trim(), nome,
        serie: leggiNumero(b.serie) ?? "", ripetizioni: b.ripetizioni.trim(),
        recupero: b.recupero.trim(), note: b.note.trim() });
      bozzaEsercizio = { ...b, nome: "", note: "" }; // giorno, serie e ripetizioni restano: comodo per inserirne tanti
      avviso(`${nome} aggiunto`);
      await salvaScheda();
    } }, "Aggiungi alla scheda")));

  el.append(formNuova(),
    h("div", { class: "azioni-secondarie" },
      h("button", { type: "button", class: "secondario", onclick: async () => {
        const id = await ctx.db.aggiungi(SCHEDE, {
          nome: `${scheda.nome} (copia)`, dataInizio: oggi(), note: scheda.note,
          esercizi: scheda.esercizi.map((e) => ({ ...e, id: nuovoId() })) });
        schedaScelta = id;
        avviso("Scheda duplicata: modifica solo ciò che cambia");
        ctx.ricarica();
      } }, "Duplica scheda"),
      h("button", { type: "button", class: "secondario pericolo", onclick: async () => {
        if (await conferma(`Eliminare "${scheda.nome}"? I carichi già registrati restano.`)) {
          await ctx.db.elimina(scheda.id); schedaScelta = null; ctx.ricarica();
        }
      } }, "Elimina scheda")));
}

// ================================================================ DIETA
// Una dieta: { nome, dataInizio, note, voci: [{ id, pasto, alimento, quantita, note }] }
// La quantità è testo libero ("80 g", "1 vasetto", "q.b."), come la scrive il nutrizionista.
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

function pastiDi(dieta) {
  const pasti = [...new Set(dieta.voci.map((v) => v.pasto))];
  const posizione = (p) => {
    const i = ORDINE_PASTI.indexOf(p.toLowerCase());
    return i === -1 ? 100 + pasti.indexOf(p) : i;
  };
  return pasti.sort((a, b) => posizione(a) - posizione(b));
}

async function dieta(el, ctx) {
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

  const alterna = () => { dietaInModifica = !dietaInModifica; voceInModifica = null; intestazioneAperta = null; ctx.ricarica(); };
  // append() di un elemento HTML non accetta liste: con "..." le "spacchettiamo"
  el.append(...(dietaInModifica
    ? [intestazioneModificabile(d, ctx, "dieta"),
       h("button", { type: "button", class: "primario", onclick: alterna }, "Fine modifiche"),
       h("p", { class: "nota" }, "Tocca un alimento per modificarlo o spostarlo.")]
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

  for (const p of pasti) {
    el.append(h("h3", { class: "titolo-giorno" }, p),
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
          nome: `${d.nome} (copia)`, dataInizio: oggi(), note: d.note,
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
  const storico = await leggiMisure(ctx.db);
  const registro = await leggiRegistro(ctx.db);
  const pesi = storico.filter((s) => s.valori.peso !== undefined);
  const ultimoAll = registro[0]?.data;
  const quando = ultimoAll === undefined ? "Mai" : giorniFa(ultimoAll) === 0 ? "Oggi"
    : giorniFa(ultimoAll) === 1 ? "Ieri" : `${giorniFa(ultimoAll)} giorni fa`;
  return h("div", { class: "corpo-home" },
    h("div", { class: "due-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Peso"),
        h("span", { class: "cifra" }, pesi.length ? kg(pesi.at(-1).valori.peso) : "—")),
      h("div", {}, h("span", { class: "etichetta" }, "Ultimo allenamento"), h("span", { class: "cifra" }, quando))),
    h("a", { class: "bottone", href: "#/palestra/allenamento" }, "Inizia allenamento"));
}

export default {
  id: "palestra",
  nome: "Palestra",
  colore: "var(--palestra)",
  icona: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M3.5 9.5v5M17.5 6.5v11M20.5 9.5v5M6.5 12h11"/></svg>',
  sezioni: [
    { id: "allenamento", nome: "Allenamento", render: allenamento },
    { id: "progressi", nome: "Progressi", render: progressi },
    { id: "misure", nome: "Misure", render: misure },
    { id: "schede", nome: "Schede", render: schede },
    { id: "dieta", nome: "Dieta", render: dieta },
  ],
  riepilogo,
};
