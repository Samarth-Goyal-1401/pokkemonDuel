'use strict';
const E = require('../lib/engine'); const { botDeck, botAct } = require('../lib/bot');
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const N = +process.argv[2] || 200; const bcs = {}; const stats = { win0: 0, win1: 0, draw: 0, turns: 0, goal: 0, errors: 0 }; const reasons = {};
for (let i = 0; i < N; i++) {
  const r = mulberry(i + 1); const d = [botDeck(r), botDeck(r)];
  for (const dk of d) { const e = E.validateDeck(dk); if (e) throw new Error('bad deck ' + e); }
  const g = E.newGame(d, ['A', 'B'], i + 1000, { bots: [true, true] }); let guard = 0;
  while (!g.over && guard++ < 5000) {
    const s = g.cur; const a = botAct(g, s, r);
    if (!a) { throw new Error('bot has no action in game ' + i + ' phase ' + g.phase); }
    const res = E.apply(g, s, a); if (res.battle) { stats.battles = (stats.battles||0)+1; const bc = res.battle.attacker.color + ' v ' + res.battle.defender.color; bcs[bc]=(bcs[bc]||0)+1; if (res.battle.aKO||res.battle.dKO) stats.kos=(stats.kos||0)+1; }
    if (res.error) { stats.errors++; if (stats.errors < 6) console.log('ERR', res.error, JSON.stringify(a)); const alt = botAct(g, s, r); }
    if (res.error && guard > 4000) break;
  }
  if (!g.over) { console.log('game', i, 'did not finish'); continue; }
  if (g.winner === 0) stats.win0++; else if (g.winner === 1) stats.win1++; else stats.draw++;
  stats.turns += g.turn; if (/goal/.test(g.reason)) stats.goal++;
  const k = /goal/.test(g.reason) ? 'goal' : g.reason.replace(/^.*?(ran out|resigned|draw|no Pok)/, '$1'); reasons[k] = (reasons[k] || 0) + 1;
}
stats.avgTurns = (stats.turns / N).toFixed(1); console.log(stats, reasons, bcs);
