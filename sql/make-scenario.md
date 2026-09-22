# Scénář v make.com pro zápis do CLB1

Stávající scénář `Claude_Skilll_SQL_MCP` má záměrný filtr *POUZE ČTENÍ*.
Nerozvolňujte ho. Tohle je samostatný scénář jen pro zápis do dvou tabulek.

## Moduly

**1. Webhooks → Custom webhook**
Vytvořte nový webhook, název např. `Famicura Ring CLB1`. Data structure:

| Pole | Typ | Povinné |
|---|---|---|
| `sql` | text | ano |

Získanou URL vložte do Netlify jako proměnnou `CLB_WEBHOOK_URL`.

**2. Filtr mezi webhookem a databází** — tohle je ta pojistka:

- podmínka 1: `{{1.sql}}` **matches pattern** `^INSERT INTO dbo\.FamicuraRing(Log|Nahravky) \(`
- podmínka 2: `{{1.sql}}` **does not match pattern** (case insensitive)
  `\b(update|delete|truncate|drop|alter|merge|grant|revoke|backup|restore|exec|xp_cmdshell|openrowset)\b`

Projde tedy jen vložení do těch dvou tabulek a nic jiného.

**3. MS SQL Server → Execute a query**
Spojení: stejné jako u čtecího scénáře — `CLB BRNO (CLBsa@…/CLB1)`.
Query: `{{1.sql}}`

## Bezpečnost

Aplikace skládá celý příkaz sama a každou hodnotu vkládá jako řetězcový
literál se zdvojenými apostrofy (`netlify/functions/_clb.mjs`). Prohlížeč
webhook URL nikdy nevidí — volá `/api/clb` a teprve Netlify funkce zná adresu.

Volitelně nastavte v Netlify `CLB_WEBHOOK_SECRET`; funkce ho pak posílá
v hlavičce `x-famicura-secret` a ve scénáři si na něj můžete přidat další
podmínku.
