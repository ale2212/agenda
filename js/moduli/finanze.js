// =============================================================================
// MODULO FINANZE
// Collezione: "finanze.movimenti" → { data, tipo: "entrata"|"uscita", importo, categoria, descrizione }
// L'importo è sempre positivo: il segno lo dà il tipo.
// =============================================================================

import { h, euro, oggi, dataBreve, nomeMese, meseBreve, chiaveMese, spostaMese,
         leggiNumero, avviso, segmenti, campo, inputNumero, vuoto, conferma,
         graficoBarre } from "../ui.js";

const MOVIMENTI = "finanze.movimenti";

const CATEGORIE = {
  uscita: ["Alimentari", "Casa", "Trasporti", "Svago", "Ristoranti", "Università", "Salute", "Abbigliamento", "Altro"],
  entrata: ["Stipendio", "Borsa di studio", "Regali", "Rimborsi", "Altro"],
};

// Stato della pagina (rimane mentre l'app è aperta)
let bozza = nuovaBozza("uscita");
let meseVisto = chiaveMese(oggi());

function nuovaBozza(tipo) {
  return { tipo, importo: "", categoria: CATEGORIE[tipo][0], data: oggi(), descrizione: "" };
}

async function movimenti(db) {
  const tutti = await db.tutti(MOVIMENTI);
  return tutti.sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
}

const totali = (lista) => {
  const entrate = lista.filter((m) => m.tipo === "entrata").reduce((s, m) => s + m.importo, 0);
  const uscite = lista.filter((m) => m.tipo === "uscita").reduce((s, m) => s + m.importo, 0);
  return { entrate, uscite, saldo: entrate - uscite };
};

function rigaMovimento(m, { ctx, eliminabile = false } = {}) {
  return h("li", { class: "riga" },
    h("div", { class: "riga-testo" },
      h("span", { class: "riga-titolo" }, m.descrizione || m.categoria),
      h("span", { class: "riga-sotto" }, m.descrizione ? `${m.categoria}, ${dataBreve(m.data)}` : dataBreve(m.data))),
    h("span", { class: `cifra ${m.tipo}` }, (m.tipo === "uscita" ? "−" : "+") + euro(m.importo)),
    eliminabile ? h("button", {
      class: "elimina", type: "button", "aria-label": `Elimina ${m.descrizione || m.categoria}`,
      onclick: async () => {
        if (await conferma(`Eliminare "${m.descrizione || m.categoria}" di ${euro(m.importo)}?`)) {
          await ctx.db.elimina(m.id);
          ctx.ricarica();
        }
      },
    }, "×") : null);
}

// ---------------------------------------------------------------- Registra
async function registra(el, ctx) {
  const importo = inputNumero({
    class: "importo", placeholder: "0,00", value: bozza.importo, "aria-label": "Importo in euro",
    oninput: (e) => (bozza.importo = e.target.value),
  });

  const chips = h("div", { class: "chips", role: "radiogroup", "aria-label": "Categoria" },
    CATEGORIE[bozza.tipo].map((c) =>
      h("button", {
        type: "button", role: "radio", class: c === bozza.categoria ? "chip attivo" : "chip",
        "aria-checked": c === bozza.categoria ? "true" : "false",
        onclick: () => { bozza.categoria = c; ctx.ricarica(); },
      }, c)));

  const salva = async () => {
    const valore = leggiNumero(bozza.importo);
    if (!valore || valore <= 0) {
      avviso("Scrivi un importo maggiore di zero");
      importo.focus();
      return;
    }
    await ctx.db.aggiungi(MOVIMENTI, {
      data: bozza.data, tipo: bozza.tipo, importo: Math.round(valore * 100) / 100,
      categoria: bozza.categoria, descrizione: bozza.descrizione.trim(),
    });
    avviso(bozza.tipo === "uscita" ? "Spesa registrata" : "Entrata registrata");
    bozza = nuovaBozza(bozza.tipo);
    ctx.ricarica();
  };

  el.append(
    h("section", { class: "gruppo" },
      segmenti([{ valore: "uscita", etichetta: "Spesa" }, { valore: "entrata", etichetta: "Entrata" }],
        bozza.tipo, (t) => { bozza = { ...nuovaBozza(t), importo: bozza.importo }; ctx.ricarica(); },
        { nome: "tipo" }),
      h("div", { class: `riga-importo ${bozza.tipo}` }, h("span", { class: "valuta" }, "€"), importo),
      chips,
      h("div", { class: "due-colonne" },
        campo("Data", h("input", { type: "date", value: bozza.data, required: true,
          onchange: (e) => (bozza.data = e.target.value || oggi()) })),
        campo("Descrizione", h("input", { type: "text", placeholder: "Facoltativa", value: bozza.descrizione,
          oninput: (e) => (bozza.descrizione = e.target.value) }))),
      h("button", { class: "primario", type: "button", onclick: salva },
        bozza.tipo === "uscita" ? "Registra spesa" : "Registra entrata")));

  const ultimi = (await movimenti(ctx.db)).slice(0, 5);
  if (ultimi.length) {
    el.append(h("h2", {}, "Ultimi movimenti"),
      h("ul", { class: "elenco" }, ultimi.map((m) => rigaMovimento(m, { ctx, eliminabile: true }))));
  }
}

// ---------------------------------------------------------------- Mese
async function mese(el, ctx) {
  const tutti = await movimenti(ctx.db);
  const delMese = tutti.filter((m) => chiaveMese(m.data) === meseVisto);
  const t = totali(delMese);
  const corrente = chiaveMese(oggi());

  el.append(
    h("div", { class: "naviga-mese" },
      h("button", { type: "button", "aria-label": "Mese precedente",
        onclick: () => { meseVisto = spostaMese(meseVisto, -1); ctx.ricarica(); } }, "‹"),
      h("span", {}, nomeMese(meseVisto)),
      h("button", { type: "button", "aria-label": "Mese successivo", disabled: meseVisto >= corrente,
        onclick: () => { meseVisto = spostaMese(meseVisto, 1); ctx.ricarica(); } }, "›")),
    h("section", { class: "gruppo cifre-mese" },
      h("div", { class: "cifra-grande" },
        h("span", { class: "etichetta" }, "Saldo"),
        h("span", { class: `valore ${t.saldo < 0 ? "uscita" : ""}` }, euro(t.saldo))),
      h("div", { class: "due-colonne" },
        h("div", {}, h("span", { class: "etichetta" }, "Entrate"), h("span", { class: "cifra entrata" }, euro(t.entrate))),
        h("div", {}, h("span", { class: "etichetta" }, "Spese"), h("span", { class: "cifra uscita" }, euro(t.uscite))))));

  if (!delMese.length) {
    el.append(vuoto("Nessun movimento in questo mese."));
    return;
  }

  // Spese per categoria, dalla più alta
  const perCategoria = {};
  for (const m of delMese.filter((m) => m.tipo === "uscita")) {
    perCategoria[m.categoria] = (perCategoria[m.categoria] || 0) + m.importo;
  }
  const ordinate = Object.entries(perCategoria).sort((a, b) => b[1] - a[1]);
  if (ordinate.length) {
    const max = ordinate[0][1];
    el.append(h("h2", {}, "Dove sono andati i soldi"),
      h("ul", { class: "elenco barre-categorie" }, ordinate.map(([cat, tot]) =>
        h("li", {},
          h("div", { class: "barra-testo" }, h("span", {}, cat), h("span", { class: "cifra" }, euro(tot))),
          h("div", { class: "barra-traccia" },
            h("div", { class: "barra-piena", style: { width: `${(tot / max) * 100}%` } }))))));
  }

  el.append(h("h2", {}, "Movimenti"),
    h("ul", { class: "elenco" }, delMese.map((m) => rigaMovimento(m, { ctx, eliminabile: true }))));
}

// ---------------------------------------------------------------- Andamento
async function andamento(el, ctx) {
  const tutti = await movimenti(ctx.db);
  if (!tutti.length) {
    el.append(vuoto("Registra qualche movimento per vedere l'andamento.",
      h("a", { class: "bottone", href: "#/finanze/registra" }, "Registra una spesa")));
    return;
  }
  const corrente = chiaveMese(oggi());
  const mesi = Array.from({ length: 6 }, (_, i) => spostaMese(corrente, i - 5));
  const righe = mesi.map((k) => ({ k, ...totali(tutti.filter((m) => chiaveMese(m.data) === k)) }));

  const conDati = righe.filter((r) => r.entrate || r.uscite);
  const mediaSpese = conDati.length ? conDati.reduce((s, r) => s + r.uscite, 0) / conDati.length : 0;

  el.append(
    h("section", { class: "gruppo" },
      h("div", { class: "legenda" },
        h("span", { class: "voce-a" }, "Entrate"), h("span", { class: "voce-b" }, "Spese")),
      graficoBarre(righe.map((r) => ({ etichetta: meseBreve(r.k), a: r.entrate, b: r.uscite }))),
      h("p", { class: "nota-grafico" }, `Spesa media mensile: ${euro(mediaSpese)} (sui mesi con movimenti)`)),
    h("h2", {}, "Saldo per mese"),
    h("ul", { class: "elenco" }, [...righe].reverse().map((r) =>
      h("li", { class: "riga" },
        h("div", { class: "riga-testo" },
          h("span", { class: "riga-titolo" }, nomeMese(r.k)),
          h("span", { class: "riga-sotto" }, `Entrate ${euro(r.entrate)}, spese ${euro(r.uscite)}`)),
        h("span", { class: `cifra ${r.saldo < 0 ? "uscita" : "entrata"}` }, euro(r.saldo))))));
}

// ---------------------------------------------------------------- Home
async function riepilogo(ctx) {
  const delMese = (await movimenti(ctx.db)).filter((m) => chiaveMese(m.data) === chiaveMese(oggi()));
  const t = totali(delMese);
  return h("div", { class: "corpo-home" },
    h("div", { class: "due-colonne" },
      h("div", {}, h("span", { class: "etichetta" }, "Spese del mese"), h("span", { class: "cifra uscita" }, euro(t.uscite))),
      h("div", {}, h("span", { class: "etichetta" }, "Saldo del mese"), h("span", { class: "cifra" }, euro(t.saldo)))),
    h("a", { class: "bottone", href: "#/finanze/registra" }, "Registra una spesa"));
}

export default {
  id: "finanze",
  nome: "Finanze",
  colore: "var(--finanze)",
  icona: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><path d="M7 15h4"/></svg>',
  sezioni: [
    { id: "registra", nome: "Registra", render: registra },
    { id: "mese", nome: "Mese", render: mese },
    { id: "andamento", nome: "Andamento", render: andamento },
  ],
  riepilogo,
};
