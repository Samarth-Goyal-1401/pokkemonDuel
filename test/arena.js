'use strict';
// Bot-vs-bot strength test: node test/arena.js [games] [skillA] [skillB]
const E = require('../lib/engine'); const { botDeck, botAct } = require('../lib/bot');
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const N = +process.argv[2] || 60, SA = +(process.argv[3] ?? 0.95), SB = +(process.argv[4] ?? 0.1);
let wa = 0, wb = 0, dr = 0, turns = 0, err = 0; const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = mulberry(i + 7); const decks = [botDeck(r), botDeck(r)]; const aSeat = i % 2; // A plays seat aSeat; decks swap too
  const dk = aSeat === 0 ? decks : [decks[1], decks[0]];
  const g = E.newGame(dk, ['A', 'B'], i + 500, { bots: [true, true] }); let guard = 0;
  while (!g.over && guard++ < 3000) {
    const s = (g.phase === 'choose') ? g.pending.task.seat : g.cur; const sk = s === aSeat ? SA : SB; const a = botAct(g, s, r, sk); if (!a) break;
    const res = E.apply(g, s, a); if (res.error) { err++; const L = E.legal(g); const uid = Object.keys(L.moves)[0]; if (uid) E.apply(g, s, { t: 'move', uid: +uid, to: L.moves[uid][0] }); }
  }
  if (!g.over) { dr++; continue; } turns += g.turn; if (g.winner === aSeat) wa++; else if (g.winner === 1 - aSeat) wb++; else dr++;
}
console.log(`skill ${SA} vs ${SB}: A wins ${wa}, B wins ${wb}, unfinished/draw ${dr}, avg turns ${(turns / N).toFixed(1)}, errors ${err}, ${((Date.now() - t0) / N).toFixed(0)}ms/game`);
