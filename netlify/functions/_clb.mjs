/*
 * Builds the INSERT statements written into CLB1.
 *
 * make.com's MSSQL module interpolates mapped values into the query text; it
 * does not parameterize. So every value is escaped here, in code that can be
 * tested, and the table name is a constant rather than anything from input.
 * The Make scenario additionally refuses anything that is not an INSERT into
 * these two tables, mirroring the read-only guard on the existing scenario.
 */

export const TABLE_LOG = "dbo.FamicuraRingLog";
export const TABLE_REC = "dbo.FamicuraRingNahravky";

const MAX_TEXT = 1000;

/** A T-SQL string literal, or NULL. Doubling the quote is what makes it safe. */
export function sqlStr(value, max = MAX_TEXT) {
  if (value === undefined || value === null || value === "") return "NULL";
  const clean = String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")   // control chars
    .slice(0, max);
  return `N'${clean.replace(/'/g, "''")}'`;
}

export function sqlNum(value) {
  if (value === undefined || value === null || value === "") return "NULL";
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : "NULL";
}

/** DATETIME2 literal in the server's own format, or NULL. */
export function sqlDate(value) {
  if (!value) return "NULL";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "NULL";
  const p = (n) => String(n).padStart(2, "0");
  return `'${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}'`;
}

export function buildInsert(row) {
  if (!row || typeof row !== "object") return { ok: false, error: "Chybí data." };

  if (row.typ === "udalost") {
    if (!row.cas) return { ok: false, error: "Událost nemá čas." };
    const sql =
      `INSERT INTO ${TABLE_LOG} ` +
      `(Cas, KameraId, KameraNazev, Druh, Zavaznost, Popis, OdZacatkuS) VALUES (` +
      [sqlDate(row.cas), sqlStr(row.kameraId, 256), sqlStr(row.kameraNazev, 200),
       sqlStr(row.druh, 40), sqlStr(row.zavaznost, 20), sqlStr(row.popis, MAX_TEXT),
       sqlNum(row.odZacatkuS)].join(", ") + ");";
    return { ok: true, sql };
  }

  if (row.typ === "nahravka") {
    if (!row.od) return { ok: false, error: "Nahrávka nemá začátek." };
    const sql =
      `INSERT INTO ${TABLE_REC} ` +
      `(Od, Do, KameraId, KameraNazev, VelikostB, Soubor, Slozka, Zdroj) VALUES (` +
      [sqlDate(row.od), sqlDate(row.do), sqlStr(row.kameraId, 256),
       sqlStr(row.kameraNazev, 200), sqlNum(row.velikostB), sqlStr(row.soubor, 400),
       sqlStr(row.slozka, 400), sqlStr(row.zdroj, 20)].join(", ") + ");";
    return { ok: true, sql };
  }

  return { ok: false, error: "Neznámý typ záznamu." };
}
