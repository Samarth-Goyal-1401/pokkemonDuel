'use strict';
const E = require('./engine'); const B = require('./board'); const { FIGS } = require('./figures'); const { PLATES } = require('./plates');
// Simple heuristic bot: wins by goal when possible, otherwise advances toward the goal, prefers battles at good odds, uses plates sometimes.
function botDeck(rnd, quality) {
  // Prefer fast Pokémon (the game is mostly a race to the goal) with decent wheels, but keep variety.
  const q = quality == null ? 0.5 : quality;
  const L = Object.values(FIGS).filter(f => f.mp >= 1).map(f => ({ f, s: f.mp * (1.2 + q) + (f.cost || 250) / 500 * q + rnd() * (3.2 - 2.2 * q) }));
  L.sort((a, b) => b.s - a.s);
  const ids = []; const names = {};
  for (const { f } of L) { if (ids.length >= 6) break; const n = f.name.replace(/^(Mega|Shiny|Alolan|Galarian|Hisuian|Primal)\s+/i, '').split(' ')[0]; if ((names[n] || 0) >= 1) continue; names[n] = 1; ids.push(f.id); }
  const pref = ['goal_block', 'speed_boost', 'plus_power', 'hurdle_jump', 'big_guard', 'double_chance', 'threat', 'focus_band', 'wake_up'];
  const rest = Object.keys(PLATES).filter(k => !pref.includes(k)).sort(() => rnd() - 0.5); const pl = []; let cst = 0;
  for (const k of (q > 0.5 ? pref.concat(rest) : Object.keys(PLATES).sort(() => rnd() - 0.5))) if (PLATES[k] && cst + PLATES[k].cost <= E.MAX_COST && !pl.includes(k)) { pl.push(k); cst += PLATES[k].cost; }
  return { figs: ids, plates: pl };
}

// Truly random team: any rarity, at most one of each species, random plates within the cost limit.
function randomDeck(rnd) {
  rnd = rnd || Math.random; const L = Object.values(FIGS).filter(f => f.mp >= 1).sort(() => rnd() - 0.5); const ids = []; const names = {};
  for (const f of L) { if (ids.length >= 6) break; const n = f.name.replace(/^(Mega|Shiny|Alolan|Galarian|Hisuian|Primal)\s+/i, '').split(' ')[0]; if (names[n]) continue; names[n] = 1; ids.push(f.id); }
  const pl = []; let cst = 0; for (const k of Object.keys(PLATES).sort(() => rnd() - 0.5)) if (cst + PLATES[k].cost <= E.MAX_COST) { pl.push(k); cst += PLATES[k].cost; }
  return { figs: ids, plates: pl };
}

// turns a figure needs to reach `target`, treating occupied points as walls (except the target itself)
function pathTurns(g, f, target, mp) {
  const dist = {}; const q = [];
  if (f.loc === 'bench') { for (const p of B.ENTRY[f.owner]) if (!g.occ[p] || p === target) { dist[p] = 1; q.push(p); } }
  else if (f.pos) { dist[f.pos] = 0; q.push(f.pos); } else return 9;
  while (q.length) { const c = q.shift(); if (c === target) break; for (const n of B.ADJ[c]) { if (dist[n] != null) continue; if (g.occ[n] && n !== target) continue; dist[n] = dist[c] + 1; q.push(n); } }
  return dist[target] == null ? 9 : Math.ceil(dist[target] / Math.max(1, mp));
}
function botAct(g, seat, rnd, skill) {
  skill = skill == null ? 0.4 : skill;
  const v = E.view(g, seat); if (!v.legal) return null;
  const W = 0.3 + 0.7 * skill;               // how seriously the bot evaluates
  const myGoal = B.GOALS[1 - seat], goal = B.GOALS[seat];
  const dist = B.bfs(goal);
  const field = o => Object.values(g.figs).filter(f => f.loc === 'field' && (o === undefined || (o ? f.owner !== seat : f.owner === seat)));
  const bench = o => Object.values(g.figs).filter(f => f.loc === 'bench' && f.owner === seat);
  const st = (f, s) => f.st && f.st.includes(s);
  const canActNow = f => f.wait <= 0 && !st(f, 'asleep') && !st(f, 'frozen');
  const val = (f, runner) => 1 + (FIGS[f.fid].cost || 250) / 2500 + (runner ? 1.6 : 0);
  const turnsTo = (f, d) => { const mp = Math.max(1, E._t.baseMp(g, f)); return d == null ? 9 : Math.ceil(d / mp); };
  const runnerish = f => f.loc === 'field' && dist[f.pos] != null && turnsTo(f, dist[f.pos]) <= 2;

  if (g.phase === 'battleChoice') {
    const a = g.figs[g.pending.attacker]; let best = null;
    for (const t of v.legal.battle) { const d = g.figs[t]; const e = E.estimate(g, a, d); const s = e.pKOd * val(d, d.pos && B.bfs(myGoal)[d.pos] <= 5) * 1.2 - e.pKOa * val(a, runnerish(a)) + rnd() * (1 - skill) * 0.4; if (!best || s > best.s) best = { t, s }; }
    return { t: 'battle', target: best ? best.t : v.legal.battle[0] };
  }
  const moves = v.legal.moves; const opts = [];
  for (const uid of Object.keys(moves)) for (const to of moves[uid]) opts.push({ uid: +uid, to });
  if (!opts.length) { return null; }
  const goalSafe = B.ADJ[goal].some(q => !g.occ[q] || g.figs[g.occ[q]].owner === seat); const winMove = goalSafe && opts.find(o => o.to === goal && !(FIGS[g.figs[o.uid].fid].rules || []).some(r => r.k === 'noGoalWin')); if (winMove) return { t: 'move', uid: winMove.uid, to: winMove.to };

  // threats: enemies able to reach my goal next turn
  const threatsNow = () => { let n = 0; const who = []; for (const e of Object.values(g.figs)) { if (e.owner === seat || !(e.loc === 'field' || e.loc === 'bench') || !canActNow(e)) continue; let r; try { r = E.reach(g, e); } catch (x) { continue; } if (r[myGoal]) { n++; who.push(e); } } return { n, who }; };
  const T0 = threatsNow();
  const ownPlates = v.players[seat].ownPlates || [];
  // ---- plates (targeted use only)
  if (v.legal.plates.length) {
    const use = (key, fn) => { const pi = ownPlates.findIndex(p => p && p.key === key && !p.used); if (pi >= 0 && v.legal.plates.includes(pi)) return fn(pi, ownPlates[pi]); return null; };
    if (T0.n > 0 && rnd() < 0.5 + 0.5 * skill) { const r = use('goal_block', pi => ({ t: 'plate', idx: pi })); if (r) return r; }
    if (rnd() < 0.3 + 0.7 * skill) {
      const r = use('speed_boost', (pi, info) => { const cands = (info.targets && info.targets.a || []).map(u => g.figs[u]).filter(f => f && canActNow(f) && f.loc === 'field' && dist[f.pos] != null && dist[f.pos] === E._t.baseMp(g, f) + 1); return cands.length ? { t: 'plate', idx: pi, a: cands[0].uid } : null; });
      if (r) return r;
      const r2 = use('hurdle_jump', (pi, info) => { const cands = (info.targets && info.targets.a || []).map(u => g.figs[u]).filter(f => f && canActNow(f) && f.loc === 'field' && dist[f.pos] != null && dist[f.pos] <= E._t.baseMp(g, f) && !(E.reach(g, f)[goal])); return cands.length ? { t: 'plate', idx: pi, a: cands[0].uid } : null; });
      if (r2) return r2;
    }
    // power plates when we already stand next to an enemy
    const adjFight = field(false).filter(f => canActNow(f) && B.ADJ[f.pos].some(p => g.occ[p] && g.figs[g.occ[p]].owner !== seat));
    if (adjFight.length && rnd() < 0.25 + 0.5 * skill) { for (const key of ['plus_power_2', 'plus_power', 'threat', 'big_guard']) { const r = use(key, (pi, info) => ({ t: 'plate', idx: pi, a: adjFight[0].uid })); if (r) return r; } }
    if (g.players[seat].pc.length && rnd() < 0.3 * (0.4 + skill)) { const r = use('revive', (pi, info) => info.targets && info.targets.a && info.targets.a.length ? { t: 'plate', idx: pi, a: info.targets.a[0] } : null); if (r) return r; }
  }

  const gaugeFull = v.players[seat].gauge >= E.GAUGE_FULL;
  const eAll = field(true);
  const enemyMin = () => { let m = 9; for (const e of Object.values(g.figs)) { if (e.owner === seat || !(e.loc === 'field' || e.loc === 'bench')) continue; const t = pathTurns(g, e, myGoal, E._t.baseMp(g, e)) + (canActNow(e) ? 0 : 1); if (t < m) m = t; } return m; };
  const myMin = () => { let m = 9, m2 = 9; for (const x of Object.values(g.figs)) { if (x.owner !== seat || !(x.loc === 'field' || x.loc === 'bench')) continue; const t = pathTurns(g, x, goal, E._t.baseMp(g, x)); if (t < m) { m2 = m; m = t; } else if (t < m2) m2 = t; } return [m, m2]; };
  let best = null;
  for (const o of opts) {
    const f = g.figs[o.uid]; const from = f.pos, loc = f.loc;
    if (o.to !== from) { if (from) delete g.occ[from]; g.occ[o.to] = f.uid; f.pos = o.to; f.loc = 'field'; }
    let s = 0, adjBest = null;
    try {
      // 1) battle prospects
      const adjE = (B.ADJ[o.to] || []).map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.owner !== seat);
      let ev = 0;
      for (const e of adjE) {
        const est = E.estimate(g, f, e); const eRun = e.pos != null && B.bfs(myGoal)[e.pos] <= 5;
        const x = est.pKOd * val(e, eRun) * 9 - est.pKOa * val(f, runnerish(f)) * 10;
        if (!adjBest || x > adjBest.x) adjBest = { e, x, est };
      }
      if (adjBest) ev = adjBest.x;
      s += ev * W;
      // 2) exposure to enemy attacks next turn (only reachable adjacency matters; approximated by current neighbours)
      // 3) threats against my goal after this move (battle may stop one)
      const T1 = threatsNow(); let unstopped = T1.n;
      if (adjBest && T1.who.includes(adjBest.e)) unstopped -= adjBest.est.pKOd;
      s -= Math.max(0, unstopped) * 40 * W;
      s += (T0.n - T1.n) * 6 * W;
      // 4) my own goal threats and progress
      const mine = field(false).filter(x => x.uid !== f.uid || true);
      let threats = 0, ts = [];
      for (const x of mine) { if (x.wait > 1 || st(x, 'asleep') || st(x, 'frozen')) continue; const dd = dist[x.pos]; if (dd == null) continue; ts.push(turnsTo(x, dd)); let r = null; try { r = E.reach(g, x); } catch (e2) { } if (r && r[goal]) threats++; }
      ts.sort((p, q) => p - q);
      s += threats > 0 ? 18 + Math.min(2, threats - 1) * 10 : 0;
      { const eT = enemyMin(), [m1, m2] = myMin(); s += Math.min(eT, 5) * 5 * W; s += (5 - Math.min(m1, 5)) * 2.5 + (5 - Math.min(m2, 5)) * 0.8; }
      s += (6 - (ts[0] == null ? 6 : Math.min(6, ts[0]))) * 3.2 + (6 - (ts[1] == null ? 6 : Math.min(6, ts[1]))) * 1.0;
      s += ((dist[from] != null ? dist[from] : 8) - (dist[o.to] != null ? dist[o.to] : 8)) * (0.7 + 0.4 * skill);
      // 5) entering from the bench when few pokémon are on the field
      if (loc === 'bench') s += field(false).length <= 1 ? 4 : 1.2;
      // 6) don't strand next to a much stronger enemy
      for (const e of adjE) { if (adjBest && e === adjBest.e) continue; const est = E.estimate(g, e, f); s -= est.pKOd * val(f, runnerish(f)) * 3 * W; }
    } catch (err) { s = -999; }
    o.s = s + rnd() * (3.2 * (1 - skill) * (1 - skill) + 0.2); o.adj = adjBest; 
    if (o.to !== from) { delete g.occ[o.to]; if (from) g.occ[from] = f.uid; f.pos = from; f.loc = loc; }
    if (!best || o.s > best.s) best = o;
  }
  if (!best) best = opts[0];
  let z;
  if (gaugeFull && best.adj) {
    // evaluate Z-moves against the target (temporarily placed)
    const f = g.figs[best.uid], from = f.pos, loc = f.loc;
    if (best.to !== from) { if (from) delete g.occ[from]; g.occ[best.to] = f.uid; f.pos = best.to; f.loc = 'field'; }
    try { let base = best.adj.est.pKOd * 9 - best.adj.est.pKOa * 10, bz = null; for (const c of ['White', 'Purple']) { const e2 = E.estimate(g, f, best.adj.e, c); const x = e2.pKOd * 9 - e2.pKOa * 10; if (x > base + 0.5 && (!bz || x > bz.x)) bz = { c, x }; } if (bz) z = bz.c; else if (rnd() < 0.15) z = 'White'; } catch (e3) { }
    if (best.to !== from) { delete g.occ[best.to]; if (from) g.occ[from] = f.uid; f.pos = from; f.loc = loc; }
  }
  return { t: 'move', uid: best.uid, to: best.to, z };
}

module.exports = { botDeck, randomDeck, botAct };
