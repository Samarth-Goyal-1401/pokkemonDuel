'use strict';
// Stress test: random decks from the whole roster, many games, any exception fails.
const E = require('../lib/engine'); const { LIST } = require('../lib/figures'); const { botAct } = require('../lib/bot'); const { PLATES } = require('../lib/plates');
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const N = +process.argv[2] || 300; const onlyNew = process.argv[3] === 'new';
const special = LIST.filter(f => f.segs.some(s => s.ops && s.ops.some(o => ['spinSel', 'resetOpp', 'assist', 'warpHole', 'imprison', 'chargeMark', 'finalSong', 'ultraEnter', 'pancake', 'trickRoom', 'wishKoko', 'wishLele', 'wishBulu', 'wishFini', 'blueHole', 'magicCoat', 'fullMark', 'lunarDance', 'pickFx', 'plateBurn', 'rotateWheel', 'cosmic', 'lariat', 'throwAdj', 'swapOppAdj'].includes(o.op))));
global.__opCount = {}; let errs = 0, done = 0, fin = 0; const ops = {};
for (let i = 0; i < N; i++) {
  const r = mulberry(i + 1); const mk = () => { const ids = []; const pool = onlyNew ? special : LIST.filter(f => f.mp >= 1); while (ids.length < 6) { const f = pool[(r() * pool.length) | 0]; if (!ids.includes(f.id)) ids.push(f.id); } const keys = Object.keys(PLATES).sort(() => r() - 0.5); const pl = []; let c = 0; for (const k of keys) if (c + PLATES[k].cost <= 6) { pl.push(k); c += PLATES[k].cost; } return { figs: ids, plates: pl }; };
  const dk = [mk(), mk()]; if (E.validateDeck(dk[0]) || E.validateDeck(dk[1])) { i--; continue; }
  try {
    const g = E.newGame(dk, ['A', 'B'], i + 77, { bots: [true, true] }); let guard = 0;
    while (!g.over && guard++ < 1500) { const s = g.phase === 'choose' ? g.pending.task.seat : g.cur; const a = botAct(g, s, r, 0.3); if (!a) break; const res = E.apply(g, s, a); if (res.error) { const L = E.legal(g); const u = Object.keys(L.moves)[0]; if (u) E.apply(g, s, { t: 'move', uid: +u, to: L.moves[u][0] }); else break; } }
    done++; if (g.over) fin++;
  } catch (e) { errs++; if (errs < 6) console.log('EXC game', i, e.stack.split('\n').slice(0, 4).join(' | ')); }
}
console.log({ games: done, finished: fin, exceptions: errs });

const NEWOPS = ['spinSel','resetOpp','resetSelfIfKO','rotateWheel','plateBurn','plateExclude','warpHole','swapOppAdj','jumpBeyondIfType','chargeMark','summonAdj','squaredAttack','electricTrap','pumpkin','branded','lariat','throwAdj','cureBurnAll','cosmic','tractor','finalSong','permBoost','ultraEnter','callSignal','ultraBelch','ultraSpin','lightBurns','excludeOppIfType','excludeIfCracked','benchAdjType','callFromPC','statusAdjType','boostTurn','pcToBench','lunarDance','shellTrap','magicCoat','fullMark','missNextOpp','noPassAbility','selfSpinKO','waitBenchOpp','selfPC','pancake','trickRoom','setMpSet','restorePlates','noAbilityName','removeOpp','pickFx','wishKoko','wishLele','wishBulu','wishFini','blueHole','statusPick','assist','imprison','tauntMark','breakEnergy','zDrain','missMark'];
console.log('never executed:', NEWOPS.filter(o => !global.__opCount[o]).join(', ') || 'none');
