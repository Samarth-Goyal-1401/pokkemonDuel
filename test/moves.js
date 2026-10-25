'use strict';
// Forces every special move to be spun against varied defenders and checks nothing throws and the board stays consistent.
const E = require('../lib/engine'); const { LIST, FIGS } = require('../lib/figures'); const B = require('../lib/board'); const T = E._t;
global.__opCount = {};
const plain = LIST.filter(f => !f.rules.length && f.mp >= 2 && f.segs.length >= 3).slice(0, 30);
const segOf = col => ({ name: 'T' + col, color: col, size: 96, dmg: col === 'White' || col === 'Gold' ? { kind: 'num', n: 60 } : col === 'Purple' ? { kind: 'stars', n: 0, stars: 2 } : { kind: 'none', n: 0 }, notes: '', ops: [], isMiss: col === 'Red', z: false, simulated: true });
const ok = g => { for (const f of Object.values(g.figs)) { if (f.loc === 'field' && (!f.pos || g.occ[f.pos] !== f.uid)) return 'field fig without pos ' + FIGS[f.fid].name; if (f.loc !== 'field' && f.pos) return 'non-field fig has pos ' + FIGS[f.fid].name + ' ' + f.loc; } for (const [p, u] of Object.entries(g.occ)) if (u && (!g.figs[u] || g.figs[u].pos !== p || g.figs[u].loc !== 'field')) return 'stale occ ' + p; return null; };
let n = 0, bad = 0; const seen = new Set();
for (const f of LIST) for (const seg of f.segs.concat(f.zsegs || [])) {
  if (!seg.ops || !seg.ops.length || seen.has(seg.notes)) continue; seen.add(seg.notes); if (!seg.notes) continue;
  for (const dc of ['White', 'Purple', 'Blue', 'Gold', 'Red']) for (let seed = 1; seed <= 2; seed++) {
    const saveSegs = f.segs, saveZ = f.zsegs; const dd = plain[(n + seed) % plain.length]; const saveD = dd.segs;
    try {
      f.segs = [seg]; f.zsegs = []; dd.segs = [segOf(dc)];
      const others = plain.filter(x => x !== dd && x !== f).slice(0, 10).map(x => x.id);
      const g = E.newGame([{ figs: [f.id, ...others.slice(0, 5)], plates: [] }, { figs: [dd.id, ...others.slice(5, 10)], plates: [] }], ['A', 'B'], seed * 31 + n, { bots: [true, true] });
      const A = Object.values(g.figs).find(x => x.owner === 0 && x.fid === f.id), D = Object.values(g.figs).find(x => x.owner === 1 && x.fid === dd.id);
      const pts = ['I00', 'I01', 'I02', 'I10', 'I11', 'I12', 'I20', 'I21'].filter(p => B.ADJ[p]);
      const place = (x, p) => { x.loc = 'field'; T.setPos(g, x, p); };
      place(A, 'I00'); place(D, 'I01'); const rest = Object.values(g.figs).filter(x => x !== A && x !== D); [['I02', 1], ['I10', 0], ['I11', 1], ['I12', 0]].forEach(([p, o], i) => { const x = rest.filter(q => q.owner === o)[0]; if (x && !g.occ[p] && B.ADJ[p]) place(x, p); });
      g.cur = 0; g.phase = 'battleChoice'; g.pending = { attacker: A.uid, targets: [D.uid], z: null }; g.moved = true; n++;
      let r = E.apply(g, 0, { t: 'battle', target: D.uid }); let guard = 0;
      while (g.phase === 'choose' && guard++ < 5) { const s = g.pending.task.seat; r = E.apply(g, s, { t: 'choose', to: g.pending.options[0] }); }
      const e = ok(g); if (e) { bad++; if (bad < 8) console.log('INCONSISTENT', f.name, seg.name, dc, e); }
    } catch (e) { bad++; if (bad < 8) console.log('THROW', f.name + ':' + seg.name, dc, e.stack.split('\n').slice(0, 3).join(' | ')); }
    finally { f.segs = saveSegs; f.zsegs = saveZ; dd.segs = saveD; }
  }
}
console.log({ runs: n, problems: bad, distinctMoves: seen.size });
const NEW = ['spinSel','resetOpp','resetSelfIfKO','rotateWheel','plateBurn','plateExclude','warpHole','swapOppAdj','jumpBeyondIfType','chargeMark','summonAdj','squaredAttack','electricTrap','pumpkin','branded','lariat','throwAdj','cureBurnAll','cosmic','tractor','finalSong','permBoost','ultraEnter','callSignal','ultraBelch','ultraSpin','lightBurns','excludeOppIfType','excludeIfCracked','benchAdjType','callFromPC','statusAdjType','boostTurn','pcToBench','lunarDance','shellTrap','magicCoat','fullMark','missNextOpp','noPassAbility','selfSpinKO','waitBenchOpp','selfPC','pancake','trickRoom','setMpSet','restorePlates','noAbilityName','removeOpp','pickFx','wishKoko','wishLele','wishBulu','wishFini','blueHole','statusPick','breakEnergy','zDrain','missMark'];
console.log('ops never executed:', NEW.filter(o => !global.__opCount[o]).join(', ') || 'none');
