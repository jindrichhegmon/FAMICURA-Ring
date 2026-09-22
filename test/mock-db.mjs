/** Náhrada CLB1 pro testy: zapamatuje si dotazy i parametry, nic nepřipojuje. */
export function mockDbs(radky = { log: 7, nahravky: 3 }) {
  const provedene = [];
  return {
    provedene,
    dbs: {
      clb1: {
        name: 'clb1-mock',
        async exec(text, params) { provedene.push({ text, params }); return 1; },
        async query(text) {
          provedene.push({ text, params: null });
          return [{ pocet: /FamicuraRingLog/.test(text) ? radky.log : radky.nahravky }];
        },
      },
    },
  };
}
