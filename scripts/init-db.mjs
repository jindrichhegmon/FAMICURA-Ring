/**
 * Založí tabulky v CLB1 podle sql/clb1.sql.
 *
 * Spouštět na VPS, kde už .env je a odkud firewall SQL Serveru pouští:
 *   cd /opt/famicura-ring && node scripts/init-db.mjs
 *
 * Skript je bezpečné pustit opakovaně – sql/clb1.sql zakládá jen to, co chybí.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const env = await readFile(path.join(ROOT, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch { /* .env není – použijí se proměnné prostředí */ }

const { clb1 } = await import('../src/db.mjs');

const skript = await readFile(path.join(ROOT, 'sql', 'clb1.sql'), 'utf8');
// GO není T-SQL příkaz, ale oddělovač dávek – musí se rozdělit tady.
// Závěrečná dávka je jen ukázkový dotaz v komentáři; po odstranění komentářů
// z ní nic nezbude, takže se neposílá.
const bezKomentaru = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '').trim();
const davky = skript.split(/^\s*GO\s*$/gim).map(s => s.trim()).filter(s => bezKomentaru(s));

console.log(`CLB1 ${process.env.SQL_SERVER}: ${davky.length} dávek`);
for (const [i, davka] of davky.entries()) {
  await clb1.exec(davka);
  console.log(`  dávka ${i + 1}/${davky.length} hotova`);
}

const [log] = await clb1.query('SELECT COUNT(*) AS pocet FROM dbo.FamicuraRingLog;');
const [nah] = await clb1.query('SELECT COUNT(*) AS pocet FROM dbo.FamicuraRingNahravky;');
console.log(`Hotovo. FamicuraRingLog: ${log.pocet} řádků, FamicuraRingNahravky: ${nah.pocet} řádků.`);
process.exit(0);
