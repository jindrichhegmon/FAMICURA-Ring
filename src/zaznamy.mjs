/**
 * Zápis logu analýzy a metadat nahrávek do CLB1.
 *
 * Tabulky zakládá sql/clb1.sql. Text dotazu je konstanta a všechny hodnoty
 * jdou přes parametry @nazev, takže se nic neescapuje ani nelepí do SQL.
 */

const MAX = { popis: 1000, nazev: 200, id: 256, soubor: 400, kratke: 40, zdroj: 20 };

const text = (v, max) => {
  if (v === undefined || v === null || v === '') return null;
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
};

const cislo = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const datum = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const SQL_UDALOST = `INSERT INTO dbo.FamicuraRingLog
  (Cas, KameraId, KameraNazev, Druh, Zavaznost, Popis, OdZacatkuS)
  VALUES (@cas, @kameraId, @kameraNazev, @druh, @zavaznost, @popis, @odZacatkuS);`;

const SQL_NAHRAVKA = `INSERT INTO dbo.FamicuraRingNahravky
  (Od, Do, KameraId, KameraNazev, VelikostB, Soubor, Slozka, Zdroj)
  VALUES (@od, @do, @kameraId, @kameraNazev, @velikostB, @soubor, @slozka, @zdroj);`;

/** Ověří řádek a vrátí { sql, params } k provedení, nebo chybu. */
export function pripravit(row) {
  if (!row || typeof row !== 'object') return { chyba: 'Chybí data.' };

  if (row.typ === 'udalost') {
    const cas = datum(row.cas);
    if (!cas) return { chyba: 'Událost nemá platný čas.' };
    return { sql: SQL_UDALOST, params: {
      cas,
      kameraId: text(row.kameraId, MAX.id),
      kameraNazev: text(row.kameraNazev, MAX.nazev),
      druh: text(row.druh, MAX.kratke),
      zavaznost: text(row.zavaznost, MAX.zdroj),
      popis: text(row.popis, MAX.popis),
      odZacatkuS: cislo(row.odZacatkuS),
    } };
  }

  if (row.typ === 'nahravka') {
    const od = datum(row.od);
    if (!od) return { chyba: 'Nahrávka nemá platný začátek.' };
    return { sql: SQL_NAHRAVKA, params: {
      od,
      do: datum(row.do),
      kameraId: text(row.kameraId, MAX.id),
      kameraNazev: text(row.kameraNazev, MAX.nazev),
      velikostB: cislo(row.velikostB),
      soubor: text(row.soubor, MAX.soubor),
      slozka: text(row.slozka, MAX.soubor),
      zdroj: text(row.zdroj, MAX.zdroj),
    } };
  }

  return { chyba: 'Neznámý typ záznamu.' };
}

export async function zapsat(dbs, row) {
  const p = pripravit(row);
  if (p.chyba) return { ok: false, chyba: p.chyba, status: 400 };
  await dbs.clb1.exec(p.sql, p.params);
  return { ok: true };
}

/** Kolik řádků v obou tabulkách – pro /api/diag. */
export async function diagnostika(dbs) {
  const [log] = await dbs.clb1.query('SELECT COUNT(*) AS pocet FROM dbo.FamicuraRingLog;');
  const [nah] = await dbs.clb1.query('SELECT COUNT(*) AS pocet FROM dbo.FamicuraRingNahravky;');
  return { log: log?.pocet ?? null, nahravky: nah?.pocet ?? null };
}
