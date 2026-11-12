// =============================================================================
// DATI E BACKUP
// I dati vivono solo sul telefono: il backup è un file .json che puoi salvare
// su iCloud Drive e reimportare (o aprire con pandas sul PC).
// =============================================================================

import { h, oggi, dataBreve, giorniFa, avviso, conferma } from "../ui.js";

const CHIAVE_ULTIMO = "agenda.ultimoBackup";
const GIORNI_PROMEMORIA = 14;

const NOMI = {
  "finanze.movimenti": "Movimenti",
  "palestra.schede": "Schede",
  "palestra.registro": "Carichi registrati",
  "palestra.misure": "Misurazioni",
};

function ultimoBackup() {
  try { return localStorage.getItem(CHIAVE_ULTIMO); } catch { return null; }
}

async function esporta(ctx) {
  const voci = await ctx.db.esportaTutto();
  const contenuto = JSON.stringify({ app: "agenda", versione: 1, esportato: new Date().toISOString(), voci }, null, 1);
  const nome = `agenda-backup-${oggi()}.json`;
  const file = new File([contenuto], nome, { type: "application/json" });

  // Su iPhone si apre il menu "Condividi": scegli "Salva su File" → iCloud Drive
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: nome });
    } catch (e) {
      if (e.name === "AbortError") return; // annullato dall'utente
      throw e;
    }
  } else {
    const a = h("a", { href: URL.createObjectURL(file), download: nome });
    document.body.append(a);
    a.click();
    a.remove();
  }
  try { localStorage.setItem(CHIAVE_ULTIMO, oggi()); } catch {}
  avviso("Backup creato");
  ctx.ricarica();
}

async function importa(ctx, file) {
  let dati;
  try {
    dati = JSON.parse(await file.text());
  } catch {
    avviso("Il file non è un backup valido");
    return;
  }
  if (dati?.app !== "agenda" || !Array.isArray(dati.voci)) {
    avviso("Il file non è un backup di Agenda");
    return;
  }
  const quando = dati.esportato ? dataBreve(dati.esportato.slice(0, 10)) : "data sconosciuta";
  if (!(await conferma(`Ripristinare il backup del ${quando} (${dati.voci.length} voci)? I dati attuali verranno sostituiti.`))) return;
  await ctx.db.importaTutto(dati.voci);
  avviso("Backup ripristinato");
  ctx.ricarica();
}

async function pagina(el, ctx) {
  const voci = await ctx.db.esportaTutto();
  const conteggi = {};
  for (const v of voci) conteggi[v.collezione] = (conteggi[v.collezione] || 0) + 1;
  const ultimo = ultimoBackup();

  const scegliFile = h("input", { type: "file", accept: ".json,application/json", hidden: true,
    onchange: (e) => e.target.files[0] && importa(ctx, e.target.files[0]) });

  el.append(
    h("section", { class: "gruppo" },
      h("h2", { class: "nel-gruppo" }, "Backup"),
      h("p", {}, "I tuoi dati sono salvati solo su questo telefono. Se elimini l'app dalla schermata Home, si cancellano anche loro: fai un backup ogni tanto e salvalo su iCloud Drive."),
      h("p", { class: "nota" }, ultimo ? `Ultimo backup: ${dataBreve(ultimo)}` : "Non hai ancora fatto nessun backup."),
      h("button", { class: "primario", type: "button", onclick: () => esporta(ctx) }, "Crea backup"),
      h("button", { class: "secondario", type: "button", onclick: () => scegliFile.click() }, "Ripristina da file"),
      scegliFile),
    h("h2", {}, "Contenuto"),
    h("ul", { class: "elenco" },
      Object.keys(conteggi).length
        ? Object.entries(conteggi).map(([k, n]) =>
            h("li", { class: "riga" }, h("span", { class: "riga-titolo" }, NOMI[k] || k), h("span", { class: "cifra" }, n)))
        : h("li", { class: "riga" }, h("span", { class: "riga-sotto" }, "Ancora nessun dato"))));
}

/** Riquadro in Home se il backup è vecchio (e ci sono dati da proteggere). */
async function promemoria(ctx) {
  const voci = await ctx.db.esportaTutto();
  if (voci.length < 5) return null;
  const ultimo = ultimoBackup();
  if (ultimo && giorniFa(ultimo) < GIORNI_PROMEMORIA) return null;
  return h("a", { class: "promemoria", href: "#/dati" },
    ultimo ? `Ultimo backup ${giorniFa(ultimo)} giorni fa. Tocca per farne uno nuovo.`
           : "Non hai ancora un backup dei tuoi dati. Tocca per crearlo.");
}

export default {
  id: "dati",
  nome: "Dati",
  colore: "var(--inchiostro)",
  icona: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>',
  sezioni: [{ id: "backup", nome: "Backup", render: pagina }],
  promemoria,
};
