// =============================================================================
// STRUMENTI DI INTERFACCIA condivisi da tutti i moduli:
// creazione di elementi, formattazione di numeri e date, grafici, avvisi.
// =============================================================================

/**
 * Crea un elemento HTML.
 *   h("button", { class: "primario", onclick: salva }, "Salva")
 * I testi vengono inseriti come testo semplice, mai come HTML: così un
 * nome con caratteri strani non può "rompere" la pagina.
 */
export function h(tag, attributi = {}, ...figli) {
  const el = document.createElement(tag);
  for (const [chiave, valore] of Object.entries(attributi || {})) {
    if (valore === null || valore === undefined || valore === false) continue;
    if (chiave.startsWith("on") && typeof valore === "function") {
      el.addEventListener(chiave.slice(2), valore);
    } else if (chiave === "class") {
      el.className = valore;
    } else if (chiave === "style" && typeof valore === "object") {
      for (const [prop, v] of Object.entries(valore)) {
        // le variabili CSS (--nome) vanno impostate con setProperty
        if (prop.startsWith("--")) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (chiave === "html") {
      el.innerHTML = valore; // solo per icone SVG scritte da noi, mai per dati dell'utente
    } else if (valore === true) {
      el.setAttribute(chiave, "");
    } else {
      el.setAttribute(chiave, valore);
    }
  }
  for (const figlio of figli.flat(Infinity)) {
    if (figlio === null || figlio === undefined || figlio === false) continue;
    el.append(figlio instanceof Node ? figlio : document.createTextNode(String(figlio)));
  }
  return el;
}

// ------------------------------------------------------------------ numeri
const formatoEuro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const formatoNumero = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

export const euro = (n) => formatoEuro.format(n);
export const numero = (n) => formatoNumero.format(n);

/** Legge un numero scritto dall'utente: accetta sia "62,5" (tastiera italiana) sia "62.5". */
export function leggiNumero(testo) {
  if (testo === null || testo === undefined) return null;
  const pulito = String(testo).trim().replace(/\s/g, "").replace(",", ".");
  if (pulito === "") return null;
  const n = Number(pulito);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ date
// Le date sono salvate come testo "AAAA-MM-GG": si ordinano bene e non hanno
// problemi di fuso orario.
const aISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const oggi = () => aISO(new Date());

function daISO(iso) {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(a, m - 1, g);
}

/** Sposta una data di n giorni: spostaGiorno("2026-11-12", -1) → "2026-11-11" */
export function spostaGiorno(iso, n) {
  const d = daISO(iso);
  d.setDate(d.getDate() + n);
  return aISO(d);
}
/** Giorno della settimana: 0 = domenica, 1 = lunedì, ... 6 = sabato */
export const giornoSettimana = (iso) => daISO(iso).getDay();

export const dataBreve = (iso) =>
  daISO(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
export const dataLunga = (iso) =>
  daISO(iso).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
export const nomeMese = (chiave) => {
  const [a, m] = chiave.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};
export const meseBreve = (chiave) => {
  const [a, m] = chiave.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("it-IT", { month: "short" });
};
export const chiaveMese = (iso) => iso.slice(0, 7);
export function spostaMese(chiave, delta) {
  const [a, m] = chiave.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function giorniFa(iso) {
  return Math.round((daISO(oggi()) - daISO(iso)) / 86400000);
}

// ------------------------------------------------------------------ avvisi
let timerAvviso;
export function avviso(testo) {
  let el = document.getElementById("avviso");
  if (!el) {
    el = h("div", { id: "avviso", role: "status" });
    document.body.append(el);
  }
  el.textContent = testo;
  el.classList.add("visibile");
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => el.classList.remove("visibile"), 2200);
}

// ------------------------------------------------------------------ componenti
/** Controllo a segmenti (come quello di iOS). opzioni: [{valore, etichetta}] */
export function segmenti(opzioni, attuale, alCambio, { nome = "seg" } = {}) {
  return h("div", { class: "segmenti", role: "radiogroup" },
    opzioni.map((o) =>
      h("button", {
        type: "button",
        role: "radio",
        class: o.valore === attuale ? "attivo" : "",
        "aria-checked": o.valore === attuale ? "true" : "false",
        "data-gruppo": nome,
        onclick: () => alCambio(o.valore),
      }, o.etichetta)
    )
  );
}

/** Campo con etichetta. */
export function campo(etichetta, input, nota) {
  return h("label", { class: "campo" },
    h("span", { class: "etichetta" }, etichetta), input,
    nota ? h("span", { class: "nota" }, nota) : null);
}

/** Campo per numeri decimali: mostra la tastiera numerica con la virgola. */
export function inputNumero(attributi = {}) {
  return h("input", { type: "text", inputmode: "decimal", autocomplete: "off", ...attributi });
}

export function vuoto(testo, azione) {
  return h("div", { class: "vuoto" }, h("p", {}, testo), azione || null);
}

export async function conferma(testo) {
  return window.confirm(testo);
}

// ------------------------------------------------------------------ grafici
/**
 * Grafico a linee in SVG. punti: [{x: "AAAA-MM-GG", y: numero}]
 * L'asse verticale NON parte da zero: si vedono anche le piccole variazioni.
 */
export function graficoLinea(punti, { unita = "", formato = numero } = {}) {
  const L = 340, A = 170, sx = 36, dx = 14, su = 14, giu = 26;
  if (punti.length < 2) {
    return h("p", { class: "nota-grafico" }, "Il grafico comparirà dalla seconda registrazione.");
  }
  const ys = punti.map((p) => p.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const margine = (max - min) * 0.15;
  min -= margine; max += margine;

  const t0 = daISO(punti[0].x).getTime();
  const t1 = daISO(punti.at(-1).x).getTime();
  const X = (iso) => sx + ((daISO(iso).getTime() - t0) / (t1 - t0 || 1)) * (L - sx - dx);
  const Y = (v) => su + (1 - (v - min) / (max - min)) * (A - su - giu);

  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, attr, testo) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attr)) el.setAttribute(k, v);
    if (testo !== undefined) el.textContent = testo;
    return el;
  };
  const svg = s("svg", { viewBox: `0 0 ${L} ${A}`, class: "grafico", role: "img",
    "aria-label": `Andamento da ${formato(punti[0].y)} a ${formato(punti.at(-1).y)} ${unita}` });

  // 3 linee guida orizzontali con il valore
  for (let i = 0; i < 3; i++) {
    const v = min + ((max - min) * (i + 0.5)) / 3;
    svg.append(s("line", { x1: sx, x2: L - dx, y1: Y(v), y2: Y(v), class: "griglia" }));
    svg.append(s("text", { x: sx - 6, y: Y(v) + 3.5, class: "asse", "text-anchor": "end" }, formato(v)));
  }
  // date: prima e ultima
  svg.append(s("text", { x: sx, y: A - 6, class: "asse" }, dataBreve(punti[0].x)));
  svg.append(s("text", { x: L - dx, y: A - 6, class: "asse", "text-anchor": "end" }, dataBreve(punti.at(-1).x)));

  const d = punti.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  svg.append(s("path", { d, class: "linea" }));
  punti.forEach((p, i) => {
    const ultimo = i === punti.length - 1;
    svg.append(s("circle", { cx: X(p.x), cy: Y(p.y), r: ultimo ? 4 : 2.5, class: ultimo ? "punto ultimo" : "punto" }));
  });
  return svg;
}

/** Barre affiancate per mese: dati [{etichetta, a, b}] (a = entrate, b = uscite). */
export function graficoBarre(dati, { formato = euro } = {}) {
  const L = 340, A = 170, sx = 8, dx = 8, su = 10, giu = 24;
  const max = Math.max(1, ...dati.flatMap((d) => [d.a, d.b]));
  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, attr, testo) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attr)) el.setAttribute(k, v);
    if (testo !== undefined) el.textContent = testo;
    return el;
  };
  const svg = s("svg", { viewBox: `0 0 ${L} ${A}`, class: "grafico", role: "img",
    "aria-label": "Entrate e uscite per mese" });
  const slot = (L - sx - dx) / dati.length;
  const barra = Math.min(14, slot * 0.32);
  const H = (v) => (v / max) * (A - su - giu);
  svg.append(s("line", { x1: sx, x2: L - dx, y1: A - giu, y2: A - giu, class: "griglia" }));
  dati.forEach((d, i) => {
    const cx = sx + slot * i + slot / 2;
    svg.append(s("rect", { x: cx - barra - 1, y: A - giu - H(d.a), width: barra, height: H(d.a), rx: 2, class: "barra-a" },));
    svg.append(s("rect", { x: cx + 1, y: A - giu - H(d.b), width: barra, height: H(d.b), rx: 2, class: "barra-b" }));
    svg.append(s("text", { x: cx, y: A - 7, class: "asse", "text-anchor": "middle" }, d.etichetta));
  });
  return svg;
}

// ------------------------------------------------------------------ modifica in linea
/**
 * Riquadro di modifica che si apre al posto di una riga di un elenco.
 *   campi:  [{ chiave, etichetta, attributi, intera }]  (intera = occupa tutta la riga)
 *   valori: l'oggetto da modificare (viene copiato: l'originale cambia solo con "Salva")
 *   salva(copia), annulla(): cosa fare con i due bottoni
 */
export function formModifica({ campi, valori, salva, annulla, extra = null }) {
  const copia = { ...valori };
  return h("div", { class: "modifica" },
    h("div", { class: "griglia-modifica" }, campi.map((c) => {
      const el = campo(c.etichetta, h("input", {
        type: "text", value: copia[c.chiave] ?? "", ...(c.attributi || {}),
        oninput: (e) => (copia[c.chiave] = e.target.value),
      }));
      if (c.intera) el.classList.add("intera");
      return el;
    })),
    extra,
    h("div", { class: "azioni-modifica" },
      h("button", { type: "button", class: "secondario", onclick: annulla }, "Annulla"),
      h("button", { type: "button", class: "primario", onclick: () => salva(copia) }, "Salva")));
}
