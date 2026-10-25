'use strict';
const { FIGS } = require('./figures');
const B = require('./board');
const { PLATES } = require('./plates');

const MAX_TURNS = 300, PC_LIMIT = 2, MAX_COST = 6, GAUGE_FULL = 100;
const NEG = new Set(['poisoned', 'noxious', 'paralyzed', 'burned', 'frozen', 'confused', 'asleep']);

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function validateDeck(deck) {
  if (!deck || !Array.isArray(deck.figs) || deck.figs.length !== 6) return 'Pick exactly 6 Pokémon.';
  const names = {};
  for (const id of deck.figs) {
    const f = FIGS[id]; if (!f) return 'Unknown Pokémon ' + id;
    const base = f.name.replace(/^(Mega|Alolan|Galarian|Hisuian|Primal|Origin|Therian|Incarnate)\s+/i, '').split(/[ (]/)[0];
    names[base] = (names[base] || 0) + 1;
    if (names[base] > 3) return 'Max 3 of the same Pokémon (' + base + ').';
  }
  const pl = deck.plates || []; let cost = 0; const seen = new Set();
  for (const k of pl) { if (!PLATES[k]) return 'Unknown plate ' + k; if (seen.has(k)) return 'Each plate only once.'; seen.add(k); cost += PLATES[k].cost; }
  if (cost > MAX_COST) return 'Plate cost total must be ≤ ' + MAX_COST + ' (is ' + cost + ').';
  return null;
}

function newGame(decks, names, seed, opts) {
  const rng = mulberry(seed == null ? (Math.random() * 2 ** 31) | 0 : seed);
  const g = {
    rng, seq: 0, turn: 1, cur: 0, phase: 'main', moved: false, winner: null, reason: '', over: false,
    players: [0, 1].map(i => ({ name: names[i] || 'Player ' + (i + 1), plates: (decks[i].plates || []).map(k => ({ key: k, used: false })), gauge: 0, pc: [], clock: null, plateLock: false, dc: false, lucky: false })),
    figs: {}, occ: {}, buff: {}, pending: null, tasks: [], log: [], passes: 0, uidN: 0, usedZ: false, lockedGoal: [0, 0],
  };
  for (let s = 0; s < 2; s++) for (const id of decks[s].figs) {
    const uid = ++g.uidN;
    const f = { uid, fid: id, owner: s, loc: 'bench', pos: null, wait: 0, st: [], mpMark: 0, cracked: false, curse: false, focus: false, guard: false, missNext: false, returnIn: 0, returnTo: 'bench', canActAtTurnStart: true };
    const fl = FIGS[id].flags; if (fl.startWait) f.wait = fl.startWait;
    g.figs[uid] = f;
  }
  if (opts && opts.bots) opts.bots.forEach((b, i) => (g.players[i].bot = !!b));
  if (opts && opts.bots && opts.bots.some(Boolean)) g.players.forEach(p => (p.clock = null)); // untimed vs bot
  g.first = opts && opts.randomStart ? (Math.random() < 0.5 ? 1 : 0) : 0; g.cur = g.first;
  startTurn(g);
  return g;
}

const R = g => g.rng();
const fig = (g, uid) => g.figs[uid];
const data = (g, uid) => FIGS[g.figs[uid].fid];
function log(g, msg) { g.logSeq = (g.logSeq || 0) + 1; g.log.push({ t: g.turn, msg, seq: g.logSeq }); if (g.log.length > 200) g.log.shift(); }
const nameOf = (g, uid) => { const f = g.figs[uid]; return FIGS[f.fid].name + (f.owner === 0 ? '' : ''); };
const own = (g, s) => Object.values(g.figs).filter(f => f.owner === s);
const onField = (g, s) => Object.values(g.figs).filter(f => f.loc === 'field' && (s == null || f.owner === s));
const hasSt = (f, s) => f.st.includes(s);
const rulesOf = f => f.noAbility ? [] : (f.tempRules && f.tempRules.length ? (FIGS[f.fid].rules || []).concat(f.tempRules) : (FIGS[f.fid].rules || []));
const hasRule = (f, k) => rulesOf(f).some(r => r.k === k);
function fieldHolders(g, k) { const out = []; for (const f of onField(g)) for (const r of rulesOf(f)) if (r.k === k) out.push([f, r]); return out; }
function addWait(g, f, n) { if (f.loc === 'field' && hasRule(f, 'noWait')) return; f.wait += n; }
const sharesType = (f, types) => !!types && FIGS[f.fid].types.some(t => types.includes(t));
function countPer(g, f, per) {
  if (!per) return 1; let list;
  switch (per.scope) {
    case 'ownKOs': return g.players[f.owner].kos || 0;
    case 'pc': return g.players[f.owner].pc.length;
    case 'friendlyField': list = onField(g, f.owner); break;
    case 'oppField': list = onField(g, 1 - f.owner); break;
    case 'benches': list = Object.values(g.figs).filter(x => x.loc === 'bench'); break;
    default: list = onField(g);
  }
  return list.filter(x => (!per.names || per.names.some(n => FIGS[x.fid].name.toLowerCase().includes(n))) && (!per.types || !per.types.length || sharesType(x, per.types))).length;
}
const bu = (g, uid) => g.buff[uid] || (g.buff[uid] = { dmg: 0, mp: 0, pass: false, threat: 0 });

function setPos(g, f, pos) { if (!pos) { f.blueMiss = false; f.tempRules = []; f.mpBuff = null; f.goldUntil = 0; f.cosmic = false; f.perm = 0; f.finalSong = 0; f.pumpkin = false; f.noPass = false; f.coat = 0; f.shellTrap = 0; f.charge = null; f.boostTurn = null; if (f.burned) { for (const b of f.burned) { const pl = g.players[b.owner].plates[b.idx]; if (pl && !pl.gone) pl.used = false; } f.burned = null; } }  if (f.pos) delete g.occ[f.pos]; f.pos = pos; if (pos) g.occ[pos] = f.uid; }

function startTurn(g) {
  g.moved = false; g.pending = null; g.buff = {};
  if (g.turn === 1 && g.cur === g.first) log(g, 'Opening turn: ' + g.players[g.first].name + '’s Pokémon have MP-1 this turn (first-player handicap). Normal MP returns next turn.');
  const p = g.players[g.cur];
  for (const f of own(g, g.cur)) if (f.loc === 'field' && hasRule(f, 'wakeStart')) f.st = f.st.filter(x => x !== 'asleep');
  for (const f of own(g, g.cur)) f.canActAtTurnStart = f.wait <= 0;
  // returns from exclusion
  for (const f of own(g, g.cur)) if (f.loc === 'excluded') { f.returnIn--; if (f.returnIn <= 0) { f.loc = 'bench'; f.wait = Math.max(f.wait, 1); log(g, FIGS[f.fid].name + ' returns to the bench.'); } }
  const other = g.players[1 - g.cur]; p.plateLockNow = !!p.plateLock; p.plateLock = false; // lock was set on this player by opponent
  p.dc = false; p.lucky = false; p.lockedGoalNow = false;
  for (const f of Object.values(g.figs)) if (f.owner === g.cur) { f.guard = false; }
}

function endTurn(g) {
  surroundCheck(g, g.cur); surroundCheck(g, 1 - g.cur);
  for (const sd of [g.cur, 1 - g.cur]) for (const f of onField(g, sd)) { if (g.over) break; goalCheck(g, f); } // safety net: any effect that left a Pokémon on its goal
  if (g.over) return;
  // tick wait for figures that were unable to act this turn
  for (const f of own(g, g.cur)) if (!f.canActAtTurnStart && f.wait > 0) f.wait--;
  g.lockedGoal[1 - g.cur] = 0; // opponent's Goal Block (set on their turn) expires after this turn
  g.seq++;
  for (const f of onField(g)) if (f.finalSong && g.seq >= f.finalSong) { log(g, 'The Final Song claims ' + FIGS[f.fid].name + '!'); f.finalSong = 0; koFigure(g, f, { force: true }); }
  if (g.cur !== g.first) g.turn++;
  g.cur = 1 - g.cur;
  if (g.players[g.cur].skipNext) { g.players[g.cur].skipNext = false; log(g, g.players[g.cur].name + ' must skip this turn (recharge).'); if (g.cur !== g.first) g.turn++; g.cur = 1 - g.cur; g.seq++; }
  if (g.turn > MAX_TURNS) return finish(g, null, 'Turn limit reached – draw.');
  startTurn(g);
  // auto-pass if no legal moves
  const la = legal(g);
  if (!Object.keys(la.moves).length) {
    log(g, g.players[g.cur].name + ' has no legal move and passes.');
    g.passes++; if (g.passes >= 6) return finish(g, null, 'Neither player can move – draw.');
    endTurn(g);
  } else g.passes = 0;
}

function finish(g, winner, reason, fid) { g.over = true; g.phase = 'over'; g.winner = winner; g.reason = reason; g.endFid = fid || null; log(g, reason); }

// ------------------------------------------------------------------ movement
function baseMp(g, f) {
  const d = FIGS[f.fid]; let b0 = f.mpSet != null ? f.mpSet : d.mp; if (g.trickRoom && g.seq <= g.trickRoom) b0 = b0 >= 3 ? 1 : b0 <= 1 ? 3 : b0; let mp = b0 + (bu(g, f.uid).mp || 0) - f.mpMark + (f.cosmic ? 1 : 0);
  for (const r of d.rules) {
    if (r.k === 'mpAdjType' && f.loc === 'field' && B.ADJ[f.pos].some(p => g.occ[p] && FIGS[g.figs[g.occ[p]].fid].types.includes(r.type))) mp += r.n;
    else if (r.k === 'mpEvolved') mp += r.n;
    else if (r.k === 'mpPerNames') mp += r.n * new Set(onField(g).map(x => FIGS[x.fid].name.toLowerCase()).filter(n => r.names.some(q => n.includes(q)))).size;
    else if (r.k === 'mpPerPC') mp += r.n * g.players[f.owner].pc.length;
    else if (r.k === 'mpBench' && f.loc === 'bench') mp += r.n;
    else if (r.k === 'mpOppCond' && onField(g, 1 - f.owner).some(x => x.st.length)) mp += r.n;
    else if (r.k === 'mpEntryBlocked' && B.ENTRY[f.owner].every(e => g.occ[e] && g.figs[g.occ[e]].owner !== f.owner)) mp += r.n;
    else if (r.k === 'paraBoost' && hasSt(f, 'paralyzed')) mp += r.mp;
    else if (r.k === 'mpIfSt' && hasSt(f, r.st)) mp = Math.max(mp, r.n);
  }
  if (f.loc === 'field') {
    let pen = 0;
    for (const [h, r] of fieldHolders(g, 'auraMpStatus')) if ((!r.opp || h.owner !== f.owner) && f.st.some(s => r.sts.includes(s))) pen = Math.max(pen, r.n);
    for (const [h, r] of fieldHolders(g, 'auraMpEnemy')) if (h.owner !== f.owner && sharesType(f, r.types) && (!r.range || B.bfs(h.pos)[f.pos] <= r.range)) pen = Math.max(pen, r.n);
    mp -= pen;
    for (const [h, r] of fieldHolders(g, 'auraMpAdj')) if (h !== f && h.owner === f.owner && B.ADJ[h.pos].includes(f.pos) && sharesType(f, r.types)) mp = Math.max(mp, Math.min(3, mp + r.n));
    for (const [h, r] of fieldHolders(g, 'auraMpBase1')) if (h.owner === f.owner && !(r.healthy && h.st.length) && !(r.noPoison && (hasSt(h, 'poisoned') || hasSt(h, 'noxious'))) && FIGS[f.fid].mp <= 1 && sharesType(f, r.types) && !(r.excl && FIGS[f.fid].name.toLowerCase().includes(r.excl)) && (!r.needType || onField(g).filter(x => FIGS[x.fid].types.includes(r.needType)).length >= r.needCount)) mp += r.n;
    for (const [h, r] of fieldHolders(g, 'auraMpTypes')) if (h.owner === f.owner && sharesType(f, r.types)) mp = Math.max(mp, Math.min(3, mp + r.n));
    for (const [h, r] of fieldHolders(g, 'forceBalance')) if (B.ADJ[h.pos].includes(f.pos)) { if (h.owner === f.owner && mp <= 1) mp = 2; else if (h.owner !== f.owner && mp >= 3) mp = 2; }
    for (const r of rulesOf(f)) if (r.k === 'mpIfNoEnemyNear' && !onField(g, 1 - f.owner).some(x => B.bfs(f.pos)[x.pos] <= r.range)) mp = Math.max(mp, r.n);
  }
  if (f.mpBuff && g.seq <= f.mpBuff.until && f.loc === 'field') mp = Math.min(mp + f.mpBuff.n, Math.max(4, mp));
  if (g.turn === 1 && g.cur === g.first && f.owner === g.first) mp -= 1;
  return Math.max(0, mp);
}
function canMove(g, f) { if (f.loc === 'field' && !FIGS[f.fid].types.includes('flying') && fieldHolders(g, 'arenaTrap').some(([h]) => h !== f && B.ADJ[h.pos].includes(f.pos))) return false; return f.canActAtTurnStart && f.wait <= 0 && !hasSt(f, 'frozen') && !hasSt(f, 'asleep') && (f.loc === 'field' || f.loc === 'bench'); }

function reach(g, f) {
  const d = FIGS[f.fid]; const mp = baseMp(g, f); const out = {};
  if (mp <= 0 && f.loc !== 'bench') return out;
  const canPassOver = o => {
    const od = FIGS[o.fid]; const mine = o.owner === f.owner;
    if (o.pumpkin && o !== f) return true;
    if (!mine && hasRule(o, 'unpassable') && !bu(g, f.uid).pass) return false;
    if (bu(g, f.uid).pass || d.flags.passThrough || d.flags.flyOver || rulesOf(o).some(r => r.k === 'passableBy' && (!r.own || mine))) return true;
    if (!f.noPass) for (const r of d.rules) if (r.k === 'pass') {
      if (r.all) return true;
      if (mine && r.own) return true;
      if (r.types.length && od.types.some(t => r.types.includes(t)) && (!mine || !r.opp)) return true;
      if (r.nonTypes.length && !od.types.some(t => r.nonTypes.includes(t))) return true;
      if (r.sts.length && o.st.some(s => r.sts.includes(s))) return true;
      if (r.wait && o.wait > 0) return true;
    }
    return false;
  };
  const enemyGoal = B.GOALS[f.owner];
  const walk = (start, left) => {
    const dist = { [start]: 0 }; const q = [start];
    while (q.length) {
      const c = q.shift(); if (dist[c] >= left) continue;
      for (const n of B.ADJ[c]) {
        if (n in dist) continue;
        if (n === enemyGoal && g.lockedGoal[1 - f.owner] > 0) continue;
        const occ = g.occ[n];
        if (occ && occ !== f.uid) { if (!canPassOver(g.figs[occ])) continue; dist[n] = dist[c] + 1; q.push(n); continue; }
        dist[n] = dist[c] + 1; q.push(n); out[n] = true;
      }
    }
  };
  if (f.loc === 'bench') {
    if (d.flags && FIGS[f.fid].ability.toLowerCase().includes('cannot enter the field using an mp move') && own(g, f.owner).some(x => x.loc === 'bench' && x.uid !== f.uid)) return out;
    for (const e of B.ENTRY[f.owner]) if (!g.occ[e]) { out[e] = true; if (mp > 1) walk(e, mp - 1); }
  } else walk(f.pos, mp);
  delete out[f.pos];
  if (f.loc === 'field' && !hasRule(f, 'noBattle') && !g.noInPlace && B.ADJ[f.pos].some(p => g.occ[p] && g.figs[g.occ[p]].owner !== f.owner)) out[f.pos] = true; // attack in place
  return out;
}

function altReach(g, f) {
  const out = {}; if (g.over) return out;
  if (f.loc === 'bench') { if (hasRule(f, 'altMoveBench')) for (const e of B.ENTRY[f.owner]) for (const n of B.ADJ[e]) if (!g.occ[n] && !n.startsWith('G') && !B.ENTRY[f.owner].includes(n)) out[n] = true; return out; }
  if (f.loc !== 'field') return out;
  for (const r of rulesOf(f)) if (r.k === 'altSwap') {
    for (const n of B.ADJ[f.pos]) { const o = g.occ[n] && g.figs[g.occ[n]]; if (o && (FIGS[o.fid].types.includes('electric') || o.st.includes('paralyzed'))) out[n] = true; }
  }
  for (const r of rulesOf(f)) if (r.k === 'altMove') {
    if (r.nearOpp) { for (const o of onField(g, 1 - f.owner)) { const dd = B.bfs(o.pos); for (const p of Object.keys(dd)) if (dd[p] <= r.nearOpp && !g.occ[p] && !p.startsWith('G') && !B.ENTRY[0].includes(p) && !B.ENTRY[1].includes(p)) out[p] = true; } continue; }
    if (r.chainType) { const seen = new Set(), q = []; for (const n of B.ADJ[f.pos]) { const y = g.occ[n] && g.figs[g.occ[n]]; if (y && FIGS[y.fid].types.includes(r.chainType)) { seen.add(y.uid); q.push(y); } } while (q.length) { const x = q.pop(); for (const n of B.ADJ[x.pos]) { if (!g.occ[n]) { if (!n.startsWith('G')) out[n] = true; continue; } const y = g.figs[g.occ[n]]; if (!seen.has(y.uid) && FIGS[y.fid].types.includes(r.chainType)) { seen.add(y.uid); q.push(y); } } } continue; }
    if (r.needNear) { const dd = B.bfs(f.pos); if (!onField(g, f.owner).some(x => x !== f && r.needNear.names.some(q => FIGS[x.fid].name.toLowerCase().includes(q)) && dd[x.pos] <= r.needNear.range)) continue; }
    if (r.straight) { for (const n1 of B.ADJ[f.pos]) { let prev = f.pos, cur = n1; for (let i = 1; i <= r.hi && cur && !g.occ[cur]; i++) { if (i >= r.lo) out[cur] = true; const nx = B.beyond(prev, cur); prev = cur; cur = nx; } } }
    else { const d = B.bfs(f.pos, p => g.occ[p] && p !== f.pos); for (const p of Object.keys(d)) if (d[p] >= r.lo && d[p] <= r.hi && !g.occ[p]) out[p] = true; }
  }
  return out;
}
function legal(g) {
  const L = { moves: {}, plates: [], battle: null, loyalty: [] };
  if (g.over) return L;
  if (g.phase === 'choose') { L.choose = { seat: g.pending.task.seat, options: g.pending.options, uid: g.pending.task.uid, kind: g.pending.task.kind }; return L; }
  if (g.phase === 'battleChoice') { L.battle = g.pending.targets; return L; }
  if (g.moved) return L;
  for (const f of own(g, g.cur)) if (f.loc === 'field' && hasRule(f, 'loyalty')) L.loyalty.push(f.uid);
  for (const f of own(g, g.cur)) {
    if (!canMove(g, f)) continue;
    const rs = reach(g, f); Object.assign(rs, Object.fromEntries(Object.keys(altReach(g, f)).filter(k => !rs[k]).map(k => [k, 'alt']))); const r = Object.keys(rs); if (r.length) L.moves[f.uid] = r;
  }
  const p = g.players[g.cur];
  if (!g.moved && !p.plateLockNow && !absolLock(g)) p.plates.forEach((pl, i) => { if (!pl.used) L.plates.push(i); });
  return L;
}

// ------------------------------------------------------------------ wheel + spin
function buildWheel(g, f, opp, useZ) {
  const d = FIGS[f.fid];
  let segs = (useZ ? d.zsegs.filter(s => s.name === useZ || s.color === useZ) : d.segs).map(s => ({ ...s }));
  if (!segs.length) segs = d.segs.map(s => ({ ...s }));
  if (f.rot && !useZ && segs.length > 1) { const k = f.rot % segs.length; const at = segs.map(s => ({ name: s.name, color: s.color, dmg: s.dmg, notes: s.notes, ops: s.ops, isMiss: s.isMiss, z: s.z, simulated: s.simulated })); segs = segs.map((s, i) => ({ ...s, ...at[(i - k + segs.length) % segs.length] })); }
  const blueMiss = (opp && FIGS[opp.fid].flags.blueToMiss) || f.blueMiss;
  const miss = s => { s.color = 'Red'; s.name = 'Miss'; s.dmg = { kind: 'none', n: 0 }; s.ops = []; s.isMiss = true; s.notes = ''; };
  if (opp && opp.loc === 'field') {
    if (rulesOf(opp).some(r => r.k === 'goldToMiss')) segs.forEach(s => { if (s.color === 'Gold') miss(s); });
    if (rulesOf(opp).some(r => r.k === 'blueToMiss' && (!r.healthy || !opp.st.length))) segs.forEach(s => { if (s.color === 'Blue' && !/dodge/i.test(s.name)) miss(s); });
    if (f.loc === 'field' && fieldHolders(g, 'dodgeMiss').some(([h]) => h.owner !== f.owner && B.ADJ[f.pos].some(p => g.occ[p] === h.uid))) segs.forEach(s => { if (s.color === 'Blue' && /dodge/i.test(s.name)) miss(s); });
    if (rulesOf(opp).some(r => r.k === 'goldToWhiteOpp')) segs.forEach(s => { if (s.color === 'Gold') s.color = 'White'; });
    if (f.loc === 'field' && fieldHolders(g, 'goldToWhiteNear').some(([h, r]) => B.bfs(h.pos)[f.pos] <= r.range)) segs.forEach(s => { if (s.color === 'Gold') s.color = 'White'; });
    if (rulesOf(opp).some(r => r.k === 'purpleToMiss')) segs.forEach(s => { if (s.color === 'Purple') miss(s); });
    if (f.loc === 'field' && fieldHolders(g, 'goldToMissAdj').some(([h]) => h.owner !== f.owner && B.ADJ[f.pos].includes(h.pos))) segs.forEach(s => { if (s.color === 'Gold') miss(s); });
    if (f.mpMark > 0 && rulesOf(opp).some(r => r.k === 'goldToWhiteIfMarked')) segs.forEach(s => { if (s.color === 'Gold') s.color = 'White'; });
  }
  if (g.trickRoom && g.seq <= g.trickRoom) segs.forEach(s => { if (s.color === 'Gold') miss(s); });
  const toGold = () => segs.forEach(s => { if (s.color === 'White' && !s.z) s.color = 'Gold'; });
  for (const r of rulesOf(f)) {
    if (r.k === 'firstBattleGold' && !f.battled) toGold();
    if (r.k === 'nearNameGold' && f.loc === 'field') { const dd = B.bfs(f.pos); if (onField(g, f.owner).some(x => x.uid !== f.uid && FIGS[x.fid].name.toLowerCase().includes(r.name) && dd[x.pos] <= r.range)) toGold(); }
  }
  for (const mk of f.missMarks || []) if (!mk.until || g.seq <= mk.until) segs.forEach(s => { if (mk.colors.includes(s.color) && (mk.any || !/dodge/i.test(s.name))) miss(s); });
  if (f.goldUntil && g.seq <= f.goldUntil) toGold();
  if (hasSt(f, 'paralyzed') || hasSt(f, 'burned')) { let m = null; for (const s of segs) if (!s.isMiss && (!m || s.size < m.size)) m = s; if (m) miss(m); }
  if (blueMiss) segs.forEach(s => { if (s.color === 'Blue' && !/dodge/i.test(s.name)) miss(s); });
  if (f.missNext) { segs.forEach(miss); f.missNext = false; }
  if (f.taunt && g.seq <= f.taunt.until && segs.some(s => s.color !== 'Purple' && s.color !== 'Blue')) {
    const bad = s => s.color === 'Purple' || s.color === 'Blue'; const out = [];
    for (let i = 0; i < segs.length; i++) { if (!bad(segs[i])) continue; let j = (i + 1) % segs.length, k = 0; while (bad(segs[j]) && k++ < segs.length) j = (j + 1) % segs.length; segs[j] = { ...segs[j], size: segs[j].size + segs[i].size }; segs[i] = { ...segs[i], size: 0 }; }
    return segs.filter(s => s.size > 0);
  }
  return segs;
}
function pick(g, segs, confused) {
  const tot = segs.reduce((a, s) => a + s.size, 0); let r = R(g) * tot, i = 0;
  for (; i < segs.length; i++) { r -= segs[i].size; if (r < 0) break; }
  if (i >= segs.length) i = segs.length - 1;
  if (confused && segs.length > 1) i = (i + (R(g) < 0.5 ? 1 : segs.length - 1)) % segs.length;
  return segs[i];
}
function spinOnce(g, f, segs) {
  const sh = rulesOf(f).find(r => r.k === 'spinShift'); if (sh && segs.length > 1) { const s0 = pick(g, segs, false); return segs[(segs.indexOf(s0) + sh.n) % segs.length]; }
  if (hasRule(f, 'missShift') && segs.length > 1 && !hasSt(f, 'confused')) { const s0 = pick(g, segs, false); if (s0.isMiss || s0.color === 'Red') { const nx = segs[(segs.indexOf(s0) + 1) % segs.length]; log(g, FIGS[f.fid].name + '’s Compound Eyes shift the spin to ' + nx.name + '.'); return nx; } return s0; }
  if (!hasSt(f, 'confused') || segs.length < 2) return pick(g, segs, false);
  const s0 = pick(g, segs, false), i0 = segs.indexOf(s0); const s1 = segs[(i0 + (R(g) < 0.5 ? 1 : segs.length - 1)) % segs.length];
  g._drift = i0;
  log(g, '💫 ' + FIGS[f.fid].name + ' is confused – the spin drifts from ' + s0.name + ' (' + s0.color + ') to ' + s1.name + ' (' + s1.color + ').');
  return s1;
}

// returns {seg, dmg, color}
const wInfoOf = (w, r) => ({ segs: w.map(x => ({ n: x.name, c: x.color, s: x.size, d: x.dmg })), idx: Math.max(0, w.findIndex(x => x.name === r.seg.name && x.color === r.color)), trace: r.trace, spins: r.spins, drifts: r.drifts });
function effSpin(g, t) {
  const w = buildWheel(g, t, null); const r = doSpin(g, t, w);
  if (g.effSpins) g.effSpins.push({ uid: t.uid, fid: t.fid, owner: t.owner, seg: r.seg.name, color: r.color, dmg: r.dmg, info: wInfoOf(w, r) });
  return r;
}
function doSpin(g, f, segs) {
  const rec = [], drifts = []; const sp = () => { g._drift = -1; const s = spinOnce(g, f, segs); rec.push(segs.indexOf(s)); drifts.push(g._drift); g._drift = -1; return s; };
  let seg = sp(); const trace = [seg.name];
  let dmg = seg.dmg.n;
  const op = n => seg.ops.find(o => o.op === n);
  if (seg.dmg.kind === 'mult' && !op('scaleMove')) { let c = 1; for (let k = 0; k < 8; k++) { const s2 = sp(); if (s2.name === seg.name) c++; else break; } dmg = seg.dmg.n * c; trace.push('x' + c); }
  else if (seg.dmg.kind === 'plus') { const s2 = sp(); const po = op('plusSpin'); if (s2.name === seg.name || (po && s2.name.toLowerCase() === po.name)) dmg += po ? po.n : 30; trace.push('+spin'); }
  else if (op('buffSpin')) {
    const bo = op('buffSpin'); let s2 = seg, guard = 0; const buffName = seg.name;
    while (s2.name === buffName && guard++ < 8) s2 = sp();
    const res = { ...s2 }; if (res.dmg.kind === 'num') res.dmg = { kind: 'num', n: bo.mode === 'mult' ? res.dmg.n * bo.n : res.dmg.n + bo.n }; seg = res; dmg = res.dmg.n; trace.push('buff');
  }
  { const ma = op('multAgain'); if (ma) { const s2 = sp(); if (s2.name.toLowerCase() === ma.name) { dmg *= ma.n; trace.push('x' + ma.n); } } }
  return { seg, dmg, color: seg.color, trace, spins: rec, drifts };
}

function modDamage(g, f, opp, res) {
  if (res.color !== 'White' && res.color !== 'Gold') return 0;
  const d = FIGS[f.fid], od = FIGS[opp.fid]; let dmg = res.dmg;
  for (const o of res.seg.ops) if (o.op === 'typeBonus' && od.types.includes(o.type.toLowerCase())) dmg += o.n;
  for (const o of res.seg.ops) { if (o.op === 'mpHigherBonus' && baseMp(g, opp) > baseMp(g, f)) dmg += o.n; if (o.op === 'condMult' && (o.sts ? opp.st.some(s => o.sts.includes(s)) : o.type ? FIGS[opp.fid].types.includes(o.type) : opp.st.length)) dmg *= o.n; }
  for (const o of res.seg.ops) {
    if (o.op === 'scaleMove') { const k = onField(g, f.owner).filter(x => FIGS[x.fid].segs.some(s => s.name.toLowerCase() === o.name)).length; dmg = res.seg.dmg.n * Math.max(1, k); }
    else if (o.op === 'adjBonus' && f.pos) dmg += o.n * B.ADJ[f.pos].filter(p => { const x = g.occ[p] && g.figs[g.occ[p]]; return x && x.owner === f.owner && FIGS[x.fid].name.toLowerCase().includes(o.name); }).length;
    else if (o.op === 'nearMult' && f.pos) { const dd2 = B.bfs(f.pos); if (onField(g, f.owner).some(x => x.uid !== f.uid && FIGS[x.fid].name.toLowerCase().includes(o.name) && dd2[x.pos] <= o.r)) dmg *= o.n; }
    else if (o.op === 'pcBonus') dmg += o.n * g.players[f.owner].pc.length;
    else if (o.op === 'spectralThief') dmg += modDamage(g, opp, f, { color: 'White', dmg: 0, seg: { ops: [], dmg: { n: 0 } } });
    else if (o.op === 'poisonMult') { const k = onField(g).filter(x => hasSt(x, 'poisoned') || hasSt(x, 'noxious')).length; if (k) dmg *= k; }
  }
  { const sk = f.branded; const ud = onField(g).length;
    for (const o of res.seg.ops) {
      if (o.op === 'poisonersBonus') dmg += o.n * onField(g).filter(x => FIGS[x.fid].segs.some(s => s.ops.some(q => q.st === 'poisoned' || q.st === 'noxious'))).length;
      else if (o.op === 'ultraMult') { const k = Object.values(g.figs).filter(x => x.loc === 'ultra').length; if (k) dmg *= k; }
      else if (o.op === 'punishBonus') { if ((bu(g, opp.uid).dmg || 0) > 0 || opp.boost || opp.perm > 0 || (opp.boostTurn && g.seq <= opp.boostTurn.until)) dmg += o.n; }
      else if (o.op === 'selfCondMult' && f.st.length) dmg = Math.floor(dmg * o.n);
      else if (o.op === 'nearTypeBonus' && f.pos && B.ADJ[f.pos].some(p => g.occ[p] && g.figs[g.occ[p]].uid !== f.uid && FIGS[g.figs[g.occ[p]].fid].types.includes(o.type))) dmg += o.n;
      else if (o.op === 'countMoveBonus') dmg += o.n * onField(g).filter(x => FIGS[x.fid].segs.some(s => s.name.toLowerCase() === o.move)).length;
    }
    if (!sk) { const seen = new Set(); for (const h of onField(g, f.owner)) for (const s of FIGS[h.fid].segs) for (const o of s.ops) if (o.op === 'auraFor') { const key = h.uid + ':' + s.name; if (seen.has(key)) continue; seen.add(key); const nm = FIGS[f.fid].name.toLowerCase(); if ((o.move && FIGS[f.fid].segs.some(q => q.name.toLowerCase() === o.move)) || (o.types && sharesType(f, o.types)) || (o.names && o.names.some(n => nm.includes(n)))) dmg += o.n; } }
    if (f.perm) dmg += f.perm; if (f.boostTurn && g.seq <= f.boostTurn.until) dmg += f.boostTurn.n; }
  if (f.boost) dmg += f.boost.n;
  const b = bu(g, f.uid); dmg += b.dmg; if (b.threat && od.types.some(t => d.types.includes(t))) dmg += 30;
  const fl = d.flags;
  if (fl.condBonus && f.st.length) dmg += fl.condBonus;
  if (fl.healthyBonus && !f.st.length) dmg += fl.healthyBonus;
  if (fl.legendBonus && /groudon|kyogre|rayquaza/i.test(od.name)) dmg += fl.legendBonus;
  if (fl.entryBonus && B.ENTRY[f.owner].concat(B.ENTRY[1 - f.owner]).includes(f.pos)) dmg += fl.entryBonus;
  for (const r of d.rules) {
    if (r.k === 'perCount') dmg += r.n * countPer(g, f, r.per);
    else if (r.k === 'turnBonus' && g.cur === f.owner) dmg += r.n;
    else if (r.k === 'paraBoost' && hasSt(f, 'paralyzed')) dmg += r.dmg;
    else if (r.k === 'connection' && f.loc === 'field') { const seen = new Set([f.uid]), q = [f]; let c = 0; while (q.length) { const x = q.pop(); for (const p of B.ADJ[x.pos]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y && !seen.has(y.uid) && y.owner === f.owner && FIGS[y.fid].types.includes('electric')) { seen.add(y.uid); q.push(y); c++; } } } dmg += r.n * c; }
    else if (r.k === 'moveBonusPC' && res.seg.name.toLowerCase() === r.move.toLowerCase()) dmg += r.n * g.players[f.owner].pc.length;
    else if (r.k === 'adjFamilyMult' && B.ADJ[f.pos].some(p => g.occ[p] && g.figs[g.occ[p]].owner === f.owner && r.names.some(n => FIGS[g.figs[g.occ[p]].fid].name.toLowerCase().includes(n)))) dmg *= r.n;
  }
  for (const [h, r] of fieldHolders(g, 'aura')) {
    if (h.owner !== f.owner || (r.excludeSelf && h === f) || (r.healthy && h.st.length)) continue;
    if (r.types.length && (r.both ? !r.types.every(t => FIGS[f.fid].types.includes(t)) : !sharesType(f, r.types))) continue;
    dmg += r.n * (r.per ? countPer(g, h, r.per) : 1);
  }
  const mold = hasRule(f, 'moldBreaker');
  for (const [h, r] of fieldHolders(g, 'moveAura')) if (h.owner === f.owner && !(r.healthy && h.st.length) && (!r.myTurn || g.cur === h.owner) && res.seg.name.toLowerCase() === r.move) dmg += r.n;
  for (const [h, r] of fieldHolders(g, 'adjAura')) if (f.pos && B.ADJ[h.pos].includes(f.pos)) dmg += r.n;
  for (const [h, r] of fieldHolders(g, 'enemyDmg')) if (!mold && h.owner !== f.owner && sharesType(f, r.types)) dmg -= r.n;
  for (const [h, r] of fieldHolders(g, 'dmgNotTypes')) if (!sharesType(f, r.types)) dmg -= r.n;
  for (const [h, r] of fieldHolders(g, 'poisonedDmg')) if (hasSt(f, 'poisoned') || hasSt(f, 'noxious')) { dmg -= r.n; break; }
  for (const [h, r] of fieldHolders(g, 'teamTake')) if (!mold && h.owner === opp.owner && sharesType(opp, r.types)) dmg -= r.n;
  for (const r of rulesOf(opp)) if (!mold && r.k === 'takeLessIfCond' && opp.st.length) dmg -= r.n;
  for (const r of rulesOf(opp)) if (!mold && r.k === 'takeLessVs' && sharesType(f, r.types)) dmg -= r.n;
  for (const [h, r] of fieldHolders(g, 'teamTakeVs')) if (!mold && h.owner === opp.owner && !(r.healthy && h.st.length) && sharesType(opp, r.types) && sharesType(f, r.vs)) { dmg -= r.n; break; }
  if (hasSt(f, 'poisoned')) dmg -= 20; if (hasSt(f, 'noxious')) dmg -= 40; if (f.cracked) dmg -= 20;
  if (opp.guard) dmg -= 30;
  if (od.flags.halfDmg) dmg = Math.floor(dmg / 2);
  return Math.max(0, dmg);
}

// outcome of colours -> {aKO,dKO,aFx,dFx}
function outcome(a, d) {
  const ac = a.color, dc = d.color; const wg = c => c === 'White' || c === 'Gold';
  const r = { aKO: false, dKO: false, aFx: false, dFx: false, text: '' };
  const pair = (x, y) => { // x attacker colour, y defender colour -> result from x's view
    return null;
  };
  if (wg(ac) && wg(dc)) { if (a.dmg > d.dmg) { r.dKO = true; r.aFx = true; } else if (d.dmg > a.dmg) { r.aKO = true; r.dFx = true; } else r.text = 'Tie'; }
  else if (ac === 'Gold' && dc === 'Purple') { r.dKO = true; r.aFx = true; } // Gold has priority over Purple
  else if (ac === 'Purple' && dc === 'Gold') { r.aKO = true; r.dFx = true; }
  else if (wg(ac) && dc === 'Purple') { r.dFx = true; }
  else if (ac === 'Purple' && wg(dc)) { r.aFx = true; }
  else if (wg(ac) && dc === 'Red') { if (a.dmg > 0) r.dKO = true; else r.text = 'A 0-damage attack cannot knock out a Miss'; r.aFx = true; }
  else if (ac === 'Red' && wg(dc)) { if (d.dmg > 0) r.aKO = true; else r.text = 'A 0-damage attack cannot knock out a Miss'; r.dFx = true; }
  else if (ac === 'Gold' && dc === 'Blue') { r.text = 'Blocked'; }
  else if (ac === 'Blue' && dc === 'Gold') { r.text = 'Blocked'; }
  else if (ac === 'White' && dc === 'Blue') { r.text = 'Blocked'; }
  else if (ac === 'Blue' && dc === 'White') { r.text = 'Blocked'; }
  else if (ac === 'Purple' && dc === 'Red') { r.aFx = true; }
  else if (ac === 'Red' && dc === 'Purple') { r.dFx = true; }
  else if (ac === 'Blue' && dc === 'Red') { r.text = 'Blocked'; }
  else if (ac === 'Red' && dc === 'Blue') { r.text = 'Blocked'; }
  else if (ac === 'Red' && dc === 'Red') { r.text = 'Both Miss'; }
  else if (ac === 'Purple' && dc === 'Gold') { r.aKO = true; r.dFx = true; }
  else if (ac === 'Gold' && dc === 'Purple') { r.dKO = true; r.aFx = true; }
  else if (ac === 'Purple' && dc === 'Purple') { const sa = ((a.seg.dmg && a.seg.dmg.stars) || 0) + (a.starBonus || 0), sd = ((d.seg.dmg && d.seg.dmg.stars) || 0) + (d.starBonus || 0); if (sa > sd) { r.aFx = true; r.text = 'More stars wins (' + sa + ' vs ' + sd + ')'; } else if (sd > sa) { r.dFx = true; r.text = 'More stars wins (' + sd + ' vs ' + sa + ')'; } else r.text = 'Equal stars – nothing happens'; }
  else r.text = 'Nothing happens';
  if (ac === 'Blue') r.aFx = true; if (dc === 'Blue') r.dFx = true; // Blue moves still resolve their own effect text
  return r;
}

// ------------------------------------------------------------------ status / KO helpers
function applyStatus(g, f, st, src) {
  if (!f || f.loc !== 'field') return;
  if (fieldHolders(g, 'refraction').some(([h]) => h !== f && h.owner === f.owner && B.ADJ[h.pos].includes(f.pos))) return;
  if (f.coat && g.seq <= f.coat && src && src.owner !== f.owner && src.loc === 'field') { log(g, FIGS[f.fid].name + ' reflects the effect back with Magic Coat!'); f.coat = 0; return applyStatus(g, src, st, null); }
  const d = FIGS[f.fid];
  for (const r of d.rules) { if (r.k === 'immune' && r.sts.includes(st)) return; if (r.k === 'immuneAllBut' && !r.keep.includes(st)) return; }
  for (const [h, r] of fieldHolders(g, 'teamImmune')) if (h.owner === f.owner && r.sts.includes(st) && sharesType(f, r.types)) return;

  if (st === 'asleep' && d.flags.sleepImmune) return;
  if (st === 'poisoned' && hasSt(f, 'noxious')) return;
  if (st === 'noxious') f.st = f.st.filter(x => x !== 'poisoned');
  if (!hasSt(f, st)) { f.st.push(st); log(g, d.name + ' became ' + st + '.'); if (src && src !== f && src.loc === 'field' && hasRule(f, 'reflect')) applyStatus(g, src, st, null); }
}
function neighborsEnemy(g, f) { return B.ADJ[f.pos].filter(p => g.occ[p] && g.figs[g.occ[p]].owner !== f.owner).map(p => g.figs[g.occ[p]]); }
function distFrom(g, pos, maxd) { return B.bfs(pos); }
function koFigure(g, f, opts) {
  opts = opts || {};
  if (!f || f.loc !== 'field') return false;
  const d = FIGS[f.fid];
  if (!opts.force) {
    if (d.flags.koToBench || f.focus) { f.focus = false; log(g, d.name + ' survives and is returned to the bench.'); toBench(g, f); return false; }
  }
  g.players[f.owner].kos = (g.players[f.owner].kos || 0) + 1;
  const pos = f.pos; setPos(g, f, null);
  f.st = []; f.mpMark = 0; f.cracked = false;
  if (hasRule(f, 'koPCtoBench')) for (const uid of g.players[f.owner].pc.slice()) { const x = g.figs[uid]; if (x && x !== f) { x.loc = 'bench'; g.players[f.owner].pc = g.players[f.owner].pc.filter(u => u !== uid); log(g, FIGS[x.fid].name + ' returns to the bench (Serene Light).'); } }
  if (hasRule(f, 'specialDelivery')) {
    const ex = own(g, f.owner).filter(x => x !== f && (x.loc === 'excluded' || x.loc === 'removed')).sort((x, y) => (x.loc === 'excluded' ? 0 : 1) - (y.loc === 'excluded' ? 0 : 1))[0];
    if (ex) { ex.loc = 'bench'; ex.returnIn = 0; ex.curse = false; log(g, FIGS[ex.fid].name + ' is delivered back to the bench!'); }
    f.loc = 'removed'; log(g, d.name + ' is excluded from the duel.'); return true;
  }
  if (d.flags.removeOnKO || f.curse) { f.loc = 'removed'; f.curse = false; log(g, d.name + ' is removed from the duel!'); return true; }
  if (opts.excludeTurns) { f.loc = 'excluded'; f.returnIn = opts.excludeTurns; log(g, d.name + ' is temporarily excluded from the duel.'); return true; }
  const p = g.players[f.owner]; f.loc = 'pc'; p.pc.push(f.uid);
  log(g, d.name + ' is knocked out!');
  if (p.pc.length > PC_LIMIT) { const old = g.figs[p.pc.shift()]; old.loc = 'bench'; old.wait = Math.max(old.wait, 1); log(g, FIGS[old.fid].name + ' recovers to the bench (Wait 1).'); }
  return true;
}
function toBench(g, f) { if (f.pos) setPos(g, f, null); f.loc = 'bench'; f.st = []; f.mpMark = 0; f.cracked = false; }
function toPC(g, f) {
  setPos(g, f, null); f.loc = 'pc'; f.st = []; const p = g.players[f.owner]; p.pc.push(f.uid);
  if (p.pc.length > PC_LIMIT) { const old = g.figs[p.pc.shift()]; old.loc = 'bench'; old.wait = Math.max(old.wait, 1); }
}

// "Tagging": ending a move next to a friendly Pokémon removes that Pokémon's special conditions.
function tagBlocked(g, x) { return fieldHolders(g, 'noTag').some(([h]) => h.owner !== x.owner && B.ADJ[h.pos].includes(x.pos)); }
function frozenLocked(g, x) { return fieldHolders(g, 'frozenLock').some(([h, r]) => B.bfs(h.pos)[x.pos] <= r.r); }
function tagAllies(g, f) {
  if (f.loc !== 'field' || tagBlocked(g, f)) return;
  const markers = hasRule(f, 'tagMarkers');
  for (const p of B.ADJ[f.pos]) {
    const x = g.occ[p] && g.figs[g.occ[p]]; if (!x || x.owner !== f.owner || x === f || tagBlocked(g, x)) continue;
    const rem = x.st.filter(s => !(s === 'frozen' && frozenLocked(g, x)));
    if (rem.length) { x.st = x.st.filter(s => !rem.includes(s)); log(g, FIGS[f.fid].name + ' tags ' + FIGS[x.fid].name + ' – ' + rem.join(', ') + ' removed.'); }
    if (x.mpMark > 0) { log(g, FIGS[f.fid].name + ' tags ' + FIGS[x.fid].name + ' – its MP-' + x.mpMark + ' marker is removed.'); x.mpMark = 0; }
    if (markers && (x.cracked || x.curse)) { x.cracked = false; x.curse = false; log(g, FIGS[f.fid].name + ' removes markers from ' + FIGS[x.fid].name + '.'); }
  }
}
function surroundCheck(g, by) {
  // opponent figures with every adjacent route point occupied by enemies of that figure are knocked out
  for (const f of onField(g, 1 - by)) {
    const adj = B.ADJ[f.pos]; if (!adj.length) continue;
    if (hasRule(f, 'noSurround')) continue;
    if (adj.every(p => g.occ[p] && g.figs[g.occ[p]].owner === by)) { log(g, FIGS[f.fid].name + ' is surrounded!'); koFigure(g, f); }
  }
  for (const [h] of fieldHolders(g, 'koAdjAsleep')) for (const p of B.ADJ[h.pos]) { const x = g.occ[p] && g.figs[g.occ[p]]; if (x && x.owner !== h.owner && hasSt(x, 'asleep') && x.loc === 'field') { log(g, FIGS[x.fid].name + ' is knocked out by ' + FIGS[h.fid].name + "'s ability."); koFigure(g, x); } }
}

// ------------------------------------------------------------------ effects
function farther(g, from, pos) { const d = B.bfs(from); return d[pos] != null ? d[pos] : 0; }
function bestForward(g, owner, cands) {
  const goal = B.GOALS[owner]; const d = B.bfs(goal);
  return cands.sort((a, b) => (d[a] ?? 99) - (d[b] ?? 99))[0];
}
function knock(g, from, tgt, n) {
  let cur = tgt.pos, prev = from.pos;
  for (let i = 0; i < n; i++) {
    let nx = B.beyond(prev, cur); if (!nx || g.occ[nx]) { const d = B.bfs(from.pos); nx = B.ADJ[cur].filter(p => !g.occ[p] && d[p] > d[cur]).sort((x, y) => (B.beyond(prev, cur) === y) - (B.beyond(prev, cur) === x))[0] || null; }
    if (!nx) break; setPos(g, tgt, nx); prev = cur; cur = nx;
  }
}
function runOps(g, ops, ctx) {
  const { self, opp } = ctx;
  for (const o of ops) {
    if (global.__opCount) global.__opCount[o.op] = (global.__opCount[o.op] || 0) + 1;
    const sOn = self && self.loc === 'field', oOn = opp && opp.loc === 'field';
    switch (o.op) {
      case 'status': { const t = o.who === 'self' ? self : opp; if (t && t.loc === 'field') applyStatus(g, t, o.st, t === self ? null : self); break; }
      case 'statusArea': {
        if (!oOn) break; const set = [];
        if (o.area.kind === 'adj') set.push(...neighborsEnemy(g, self && sOn ? { ...opp, owner: opp.owner === 0 ? 1 : 0, pos: opp.pos } : { ...opp, owner: 1 - opp.owner, pos: opp.pos }));
        else if (o.area.kind === 'within') { const d = B.bfs(opp.pos); for (const x of onField(g, opp.owner)) if (x.uid !== opp.uid && d[x.pos] <= o.area.n) set.push(x); }
        else if (o.area.kind === 'behind' && sOn) { let a = self.pos, b = opp.pos; for (let i = 0; i < 6; i++) { const n = B.beyond(a, b); if (!n) break; if (g.occ[n]) { const x = g.figs[g.occ[n]]; if (x.owner === opp.owner) set.push(x); } a = b; b = n; } }
        set.filter(x => x.owner === opp.owner && x.uid !== opp.uid).forEach(x => { if (o.st) applyStatus(g, x, o.st); if (o.wait) addWait(g, x, o.wait); }); break;
      }
      case 'statusPick': { if (!sOn) break; const d = B.bfs(self.pos); const c = onField(g, 1 - self.owner).filter(x => d[x.pos] <= o.n); if (c.length) { const tg = c[(R(g) * c.length) | 0]; applyStatus(g, tg, o.st, self); if (o.mark) tg[o.mark] = true; } break; }
      case 'wait': { const t = o.who === 'self' ? self : opp; if (t && t.loc !== 'pc') { addWait(g, t, o.n); log(g, FIGS[t.fid].name + ' gains Wait ' + o.n + '.'); } break; }
      case 'waitAdj': { if (!oOn) break; for (const p of B.ADJ[opp.pos]) { const x = g.occ[p] && g.figs[g.occ[p]]; if (x && x.owner === opp.owner) addWait(g, x, o.n); } break; }
      case 'bench': { if (oOn) { log(g, FIGS[opp.fid].name + ' is moved to the bench.'); toBench(g, opp); } break; }
      case 'pc': { if (oOn) { log(g, FIGS[opp.fid].name + ' is moved to its P.C.'); toPC(g, opp); } break; }
      case 'ko': { if (o.who === 'both' && sOn) koFigure(g, self, { force: true }); if (oOn) koFigure(g, opp); break; }
      case 'swap': { if (sOn && oOn) { const a = self.pos, b = opp.pos; g.occ[a] = opp.uid; g.occ[b] = self.uid; self.pos = b; opp.pos = a; } break; }
      case 'statusAdjAll': { if (!sOn) break; for (const p of B.ADJ[self.pos]) { const x = g.occ[p] && g.figs[g.occ[p]]; if (x) applyStatus(g, x, o.st, x.owner === self.owner ? null : self); } break; }
      case 'statusSpecies': { if (!oOn) break; const nm = FIGS[opp.fid].name; onField(g, opp.owner).filter(x => FIGS[x.fid].name === nm).forEach(x => applyStatus(g, x, o.st, self)); break; }
      case 'statusRandom': { if (oOn) applyStatus(g, opp, o.list[(R(g) * o.list.length) | 0], self); break; }
      case 'knockAdj': {
        if (!sOn) break; const xs = B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && (o.all || x.owner !== self.owner));
        for (const x of xs) { knock(g, self, x, o.n); if (o.wait) addWait(g, x, 1); } break;
      }
      case 'selfBench': { if (sOn) { log(g, FIGS[self.fid].name + ' returns to the bench.'); toBench(g, self); } break; }
      case 'selfRemove': { if (self && self.loc === 'field') { setPos(g, self, null); self.loc = 'removed'; self.st = []; log(g, FIGS[self.fid].name + ' is excluded from the duel!'); } break; }
      case 'blueMissMark': { if (oOn) { opp.blueMiss = true; log(g, FIGS[opp.fid].name + "'s Blue Attacks (except Dodge) become Misses while it stays on the field."); } break; }
      case 'moveOther': { if (self) g.tasks.push({ kind: 'pickOther', seat: self.owner, uid: self.uid, filter: o.filter || {}, sleepOpp: !!o.sleepOpp }); break; }
      case 'statusChain': {
        if (!oOn) break; const seen = new Set([opp.uid]), q = [opp]; const list = [opp];
        while (q.length) { const x = q.shift(); for (const p of B.ADJ[x.pos]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y && y.owner === opp.owner && !seen.has(y.uid) && y !== self) { seen.add(y.uid); q.push(y); list.push(y); } } }
        list.forEach(x => { if (o.st) applyStatus(g, x, o.st, self); if (o.wait) addWait(g, x, o.wait); }); break;
      }
      case 'waitAdjAll': { if (!sOn) break; for (const p of B.ADJ[self.pos]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y) addWait(g, y, o.n); } break; }
      case 'zGain': { if (self) g.players[self.owner].gauge = Math.min(GAUGE_FULL, g.players[self.owner].gauge + o.n); break; }
      case 'skipNextIfKO': { if (self && opp && opp.loc !== 'field') { g.players[self.owner].skipNext = true; log(g, g.players[self.owner].name + ' must recharge: the next turn is the opponent\'s.'); } break; }
      case 'mpBuff': { const until = g.seq + 2; const t = o.self ? (sOn ? [self] : []) : onField(g, self.owner).filter(x => (o.types || []).some(ty => FIGS[x.fid].types.includes(ty))); t.forEach(x => (x.mpBuff = { n: o.n, until })); break; }
      case 'goldNext': { if (sOn) self.goldUntil = g.seq + 2; break; }
      case 'missMark': { if (oOn) (opp.missMarks = opp.missMarks || []).push({ colors: o.colors, any: !!o.any, until: o.turn ? g.seq + 1 : 0, once: !!o.once, born: g.battleNo }); break; }
      case 'missMarkAllOpp': { onField(g, 1 - self.owner).forEach(x => (x.missMarks = x.missMarks || []).push({ colors: o.colors, any: false, until: g.seq + 1 })); break; }
      case 'addRule': { if (sOn) self.tempRules = (self.tempRules || []).concat(o.rule); break; }
      case 'koPick': { if (!sOn) break; const dd = B.bfs(self.pos); const c = onField(g, 1 - self.owner).filter(x => dd[x.pos] <= o.n && (!o.type || FIGS[x.fid].types.includes(o.type))); if (c.length) koFigure(g, c[(R(g) * c.length) | 0]); break; }
      case 'swapIn': { if (sOn && (!o.ifAlive || self.loc === 'field')) g.tasks.push({ kind: 'pickSwap', seat: self.owner, uid: self.uid, src: o.src }); break; }
      case 'knockback': {
        if (!sOn || !oOn) break; if (o.choose) { g.tasks.push({ kind: 'knock', seat: o.by === 'self' ? self.owner : opp.owner, uid: opp.uid, fromUid: self.uid, n: o.n }); break; } knock(g, self, opp, o.n); break;
      }
      case 'knockbackChain': {
        if (!sOn || !oOn) break; let behind = null; const n1 = B.beyond(self.pos, opp.pos); if (n1 && g.occ[n1]) behind = g.figs[g.occ[n1]];
        if (behind && behind.owner === opp.owner) { knock(g, self, behind, o.n); addWait(g, behind, 1); }
        knock(g, self, opp, o.n); addWait(g, opp, 1); break;
      }
      case 'claimSpot': {
        if (!sOn) break; if (o.ifKO && !(opp && opp.loc !== 'field')) break;
        const p = ctx.oppPos; if (p && !g.occ[p]) setPos(g, self, p); break;
      }
      case 'mpDuel': { if (sOn && oOn && baseMp(g, opp) >= baseMp(g, self)) { toPC(g, opp); toBench(g, self); } break; }
      case 'excludeOpp': { if (oOn) { setPos(g, opp, null); opp.loc = 'excluded'; opp.returnIn = o.turns; opp.st = []; log(g, FIGS[opp.fid].name + ' is sent to the Ultra Space.'); } break; }
      case 'benchAdjAll': { if (!sOn) break; for (const p of B.ADJ[self.pos]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y) { toBench(g, y); addWait(g, y, 1); } } break; }
      case 'koAdjAll': { if (!sOn) break; const nb = B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(Boolean); koFigure(g, self, { force: true }); nb.forEach(y => koFigure(g, y, { force: true })); break; }
      case 'pcArea': { if (!oOn) break; const adj = B.ADJ[opp.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(y => y && y.owner === opp.owner); toPC(g, opp); if (o.one) { if (adj.length) toPC(g, adj[0]); } else adj.forEach(y => toPC(g, y)); break; }
      case 'selfFocus': { if (self) self.focus = true; break; }
      case 'spinGroup': {
        let targets = [];
        if (o.group === 'allOpp' && self) targets = onField(g, 1 - self.owner);
        else if (o.group === 'oppAndOwnType' && self) targets = onField(g, 1 - self.owner).concat(onField(g, self.owner).filter(x => FIGS[x.fid].types.includes(o.type)));
        else if (o.group === 'allOther' && self) targets = onField(g).filter(x => x !== self);
        else if (o.group === 'allField') targets = onField(g);
        else if (o.group === 'oppFlying' && self) targets = onField(g, 1 - self.owner).filter(x => FIGS[x.fid].types.includes('flying'));
        else if (o.group === 'adjToOppOne' && oOn) { const c = B.ADJ[opp.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.owner === opp.owner && x.uid !== opp.uid); if (c.length) targets = [c[(R(g) * c.length) | 0]]; }
        else if (o.group === 'oppAndBehind' && oOn && sOn) { targets = [opp]; const bh = B.beyond(self.pos, opp.pos); const y = bh && g.occ[bh] && g.figs[g.occ[bh]]; if (y && y.owner === opp.owner) targets.push(y); }
        else if (o.group === 'adjAll' && sOn) targets = B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(Boolean);
        else if (o.group === 'adjSelfOpp' && sOn) targets = B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.owner !== self.owner);
        else if ((o.group === 'oppAndAdj' || o.group === 'oppOrAdj') && oOn) { const c = [opp, ...B.ADJ[opp.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.owner === opp.owner)]; targets = o.group === 'oppAndAdj' ? c : [c[(R(g) * c.length) | 0]]; }
        for (const t of targets) { if (t.loc !== 'field') continue; const r = effSpin(g, t); log(g, FIGS[t.fid].name + ' spins ' + r.seg.name + '.');
          const hit = o.cond === 'white' ? (r.color === 'White' && !r.seg.isMiss) : o.cond === 'gold' ? r.color === 'Gold' : o.cond === 'purpleOnly' ? (r.color === 'Purple' && !r.seg.isMiss) : o.cond === 'miss' ? !!r.seg.isMiss : o.cond === 'missOrWhiteLE' ? (r.seg.isMiss || (r.color === 'White' && r.dmg <= o.n)) : (r.color === 'Purple' || r.seg.isMiss);
          if (hit) runOps(g, o.then, { self, opp: t, oppPos: t.pos }); }
        break;
      }
      case 'digAway': { if (!sOn) break; const att = B.ADJ[self.pos].filter(q => g.occ[q] && g.occ[q] !== self.uid); if (!att.length) { log(g, FIGS[self.fid].name + ' digs but nothing is attached to it.'); break; } g.tasks.push({ kind: 'self', seat: self.owner, uid: self.uid, lo: 1, hi: 2, dig: att }); log(g, FIGS[self.fid].name + ' digs underground to get away!'); break; }
      case 'selfMove': {
        if (sOn && o.jump && oOn && hasRule(self, 'flyKO')) { log(g, FIGS[opp.fid].name + ' is knocked out by Fly!'); koFigure(g, opp); }
        if (!sOn) break; if (o.ifKO && !(opp && opp.loc !== 'field')) break; if (o.noSteel && opp && FIGS[opp.fid].types.includes('steel')) break;
        g.tasks.push({ kind: 'self', seat: self.owner, uid: self.uid, lo: o.n, hi: o.hi || o.n, jump: !!o.jump, chain: !!o.chain, around: !!o.around, back: !!o.back, from: (opp && opp.pos) || ctx.oppPos || null });
        break;
      }
      case 'pull': {
        if (!sOn) break; const d = B.bfs(self.pos); const c = onField(g, 1 - self.owner).filter(x => d[x.pos] <= o.r && d[x.pos] > 1).sort((x, y) => d[x.pos] - d[y.pos]); if (!c.length) break;
        const t = c[0]; let cur = t.pos; for (let i = 0; i < o.hi; i++) { const nx = B.ADJ[cur].find(p => !g.occ[p] && !p.startsWith('G') && d[p] < d[cur]); if (!nx) break; setPos(g, t, nx); cur = nx; }
        addWait(g, t, 1); log(g, FIGS[t.fid].name + ' is pulled closer.'); break;
      }
      case 'cure': { if (o.who === 'team') onField(g, self.owner).forEach(x => (x.st = [])); else if (self) self.st = []; break; }
      case 'mpMarker': { const t = o.who === 'opp' || !o.who ? opp : self; if (t && t.loc === 'field') { t.mpMark += o.n; } break; }
      case 'mpMarkerWithin': { if (!sOn) break; const d = B.bfs(self.pos); onField(g, 1 - self.owner).filter(x => d[x.pos] <= o.r).forEach(x => (x.mpMark += o.n)); break; }
      case 'cracked': { if (!sOn || !oOn) break; let a = self.pos, b = opp.pos; for (let i = 0; i < 6; i++) { const n = B.beyond(a, b); if (!n) break; if (g.occ[n] && g.figs[g.occ[n]].owner === opp.owner) g.figs[g.occ[n]].cracked = true; a = b; b = n; } break; }
      case 'curse': { if (oOn) opp.curse = true; break; }
      case 'zDrain': { const p = g.players[opp.owner]; p.gauge = Math.floor(p.gauge * (1 - o.f)); break; }
      case 'plateLock': { g.players[opp.owner].plateLock = true; break; }
      case 'selfMissNext': { if (self) self.missNext = true; break; }
      case 'spinAll': case 'spinAdj': {
        const targets = o.op === 'spinAll' ? onField(g, 1 - self.owner) : (oOn ? B.ADJ[opp.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.uid !== self.uid) : []);
        for (const t of targets) { if (t.loc !== 'field') continue; const r = effSpin(g, t); const white = r.color === 'White' && !r.seg.isMiss; log(g, FIGS[t.fid].name + ' spins ' + r.seg.name + '.'); if (white) runOps(g, [o.then], { self, opp: t }); }
        break;
      }
      case 'hydroKick': { if (sOn && oOn) { toBench(g, self); addWait(g, opp, 1); log(g, FIGS[self.fid].name + ' retreats; ' + FIGS[opp.fid].name + ' must Wait.'); } break; }
      case 'koIfOppNotType': { if (oOn && !FIGS[opp.fid].types.includes(o.type)) koFigure(g, opp); break; }
      case 'excludeIfName': { if (oOn && FIGS[opp.fid].name.toLowerCase().includes(o.name)) { setPos(g, opp, null); opp.loc = 'removed'; opp.st = []; log(g, FIGS[opp.fid].name + ' is excluded from the duel!'); } break; }
      case 'shiftGear': { if (self) { self.mpSet = o.mp; self.blueMiss = true; log(g, FIGS[self.fid].name + ' shifts gear: MP ' + o.mp + ', Blue Attacks become Misses.'); } break; }
      case 'noop': break;
      case 'benchSwap': { if (sOn && opp && opp.loc === 'bench') { const pos = self.pos; toBench(g, self); opp.loc = 'field'; opp.battled = false; setPos(g, opp, pos); log(g, FIGS[self.fid].name + ' changes form into ' + FIGS[opp.fid].name + '.'); surroundCheck(g, 1 - opp.owner); } break; }
      case 'stepMove': { if (opp && opp.loc === 'field') g.tasks.push({ kind: 'self', seat: ctx.self ? ctx.self.owner : opp.owner, uid: opp.uid, lo: 1, hi: 1 }); break; }
      case 'spinSel': {
        if (!self) break; const oppSide = 1 - self.owner; let targets = [];
        const near = (ctr, n, side) => { if (!ctr || !ctr.pos) return []; const dd = B.bfs(ctr.pos); return onField(g, side).filter(x => x !== self && x !== ctr && dd[x.pos] != null && dd[x.pos] <= n); };
        const adjOf = ctr => (ctr && ctr.pos ? B.ADJ[ctr.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(Boolean) : []);
        switch (o.who) {
          case 'opp': targets = onField(g, oppSide); break;
          case 'allField': targets = onField(g); break;
          case 'allOther': targets = onField(g).filter(x => x !== self); break;
          case 'adjSelf': targets = sOn ? adjOf(self) : []; break;
          case 'adjSelfOpp': targets = sOn ? adjOf(self).filter(x => x.owner !== self.owner) : []; break;
          case 'adjOpp': targets = oOn ? adjOf(opp).filter(x => x !== self) : []; break;
          case 'oppWithinOpp': targets = oOn ? near(opp, o.n, oppSide) : []; break;
          case 'oppWithinSelf': targets = sOn ? near(self, o.n, oppSide) : []; break;
          case 'oppOnly': targets = oOn ? [opp] : []; break;
          case 'oppAndOwnType': targets = onField(g, oppSide).concat(onField(g, self.owner).filter(x => FIGS[x.fid].types.includes(o.type))); break;
          case 'oppChain': if (oOn) { const seen = new Set([opp.uid]), q = [opp]; targets = [opp]; while (q.length) { const x = q.shift(); for (const y of adjOf(x)) if (y.owner === opp.owner && !seen.has(y.uid)) { seen.add(y.uid); targets.push(y); q.push(y); } } } break;
        }
        if (o.only) targets = targets.filter(x => FIGS[x.fid].types.some(t => o.only.includes(t)));
        if (o.not) targets = targets.filter(x => !FIGS[x.fid].types.some(t => o.not.includes(t)));
        if (o.one && targets.length) targets = [targets[(R(g) * targets.length) | 0]];
        const rules = o.rules || [{ cond: o.cond, then: o.then }];
        for (const t of targets) {
          if (t.loc !== 'field') continue; const r = effSpin(g, t); log(g, FIGS[t.fid].name + ' spins ' + r.seg.name + '.');
          for (const ru of rules) {
            const w = r.color === 'White' && !r.seg.isMiss;
            const hit = ru.cond === 'white' ? w : ru.cond === 'blue' ? r.color === 'Blue' : ru.cond === 'purpleOnly' ? (r.color === 'Purple' && !r.seg.isMiss) : ru.cond === 'miss' ? !!r.seg.isMiss : ru.cond === 'notBlue' ? r.color !== 'Blue' : ru.cond === 'missOrWhiteLE' ? (r.seg.isMiss || (w && r.dmg <= o.le)) : ru.cond === 'gold' ? r.color === 'Gold' : true;
            if (hit && t.loc === 'field') runOps(g, ru.then, { self, opp: t, oppPos: t.pos });
          }
        }
        break;
      }
      case 'resetOpp': { if (oOn) { log(g, FIGS[opp.fid].name + ' is returned to its start-of-duel state.'); toBench(g, opp); opp.curse = false; } break; }
      case 'resetSelfIfKO': { if (sOn) { log(g, FIGS[self.fid].name + ' returns to its start-of-duel state.'); toBench(g, self); } break; }
      case 'rotateWheel': { if (self) { self.rot = (self.rot || 0) + o.n; log(g, FIGS[self.fid].name + "'s Attacks shift two segments clockwise."); } break; }
      case 'plateBurn': { if (!oOn && !(opp && opp.owner != null)) break; const pl = g.players[opp.owner].plates.map((x, i) => [x, i]).filter(([x]) => !x.used); if (pl.length) { const [x, i] = pl[(R(g) * pl.length) | 0]; x.used = true; (self.burned = self.burned || []).push({ owner: opp.owner, idx: i }); log(g, 'One of ' + g.players[opp.owner].name + "'s plates is switched to used!"); } break; }
      case 'plateExclude': { if (!opp) break; const pl = g.players[opp.owner].plates.filter(x => x.used && !x.gone); if (pl.length) { pl[(R(g) * pl.length) | 0].gone = true; log(g, "One of the opponent's used plates is excluded from the duel."); } break; }
      case 'warpHole': {
        if (!oOn) break; const side = opp.owner; const pool = own(g, side).filter(x => x !== opp && (x.loc === 'field' || x.loc === 'bench' || x.loc === 'pc') && x.fid); if (!pool.length) break;
        const x = pool[(R(g) * pool.length) | 0]; const pos = opp.pos;
        if (x.loc === 'field') { const pb = x.pos; g.occ[pos] = x.uid; g.occ[pb] = opp.uid; opp.pos = pb; x.pos = pos; }
        else { const lo = x.loc; if (lo === 'pc') g.players[side].pc = g.players[side].pc.filter(u => u !== x.uid); setPos(g, opp, null); opp.st = []; if (lo === 'pc') { opp.loc = 'pc'; g.players[side].pc.push(opp.uid); } else opp.loc = 'bench'; x.loc = 'field'; setPos(g, x, pos); }
        addWait(g, x, o.w); addWait(g, opp, o.w); log(g, FIGS[opp.fid].name + ' is swapped out for ' + FIGS[x.fid].name + ' (Wait ' + o.w + ').'); surroundCheck(g, side); break;
      }
      case 'swapOppAdj': { if (!oOn) break; const c2 = B.ADJ[opp.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x.owner === opp.owner && x.uid !== opp.uid); if (!c2.length) break; const x = c2[(R(g) * c2.length) | 0]; const a1 = opp.pos, b1 = x.pos; g.occ[a1] = x.uid; g.occ[b1] = opp.uid; opp.pos = b1; x.pos = a1; addWait(g, opp, 1); addWait(g, x, 1); log(g, FIGS[opp.fid].name + ' and ' + FIGS[x.fid].name + ' are switched and must Wait.'); break; }
      case 'jumpBeyondIfType': { if (!sOn || !opp || !ctx.oppPos || !FIGS[opp.fid].types.includes(o.type)) break; const to = B.beyond(self.pos, ctx.oppPos); if (to && !g.occ[to]) { setPos(g, self, to); log(g, FIGS[self.fid].name + ' lands beyond its opponent.'); } break; }
      case 'chargeMark': { if (sOn) { self.charge = { st: o.st }; log(g, FIGS[self.fid].name + ' gains a Charge Marker.'); } break; }
      case 'summonAdj': { if (!sOn) break; const free = B.ADJ[self.pos].filter(p => !g.occ[p]); const c2 = onField(g, self.owner).filter(x => x !== self && FIGS[x.fid].name.toLowerCase().includes(o.name)); if (free.length && c2.length) { setPos(g, c2[0], free[(R(g) * free.length) | 0]); log(g, FIGS[c2[0].fid].name + ' moves next to ' + FIGS[self.fid].name + '.'); } break; }
      case 'squaredAttack': { if (!sOn) break; if (B.ENTRY[0].concat(B.ENTRY[1]).filter(p => g.occ[p]).length < 3) break; const c2 = onField(g, self.owner).filter(x => x !== self); if (!c2.length) break; const x = c2[(R(g) * c2.length) | 0]; const a1 = self.pos, b1 = x.pos; g.occ[a1] = x.uid; g.occ[b1] = self.uid; self.pos = b1; x.pos = a1; log(g, FIGS[self.fid].name + ' switches with ' + FIGS[x.fid].name + '.'); break; }
      case 'electricTrap': { if (oOn) applyStatus(g, opp, 'paralyzed', self); if (!sOn) break; const dd = B.bfs(self.pos); onField(g).filter(x => x !== self && x !== opp && dd[x.pos] != null && dd[x.pos] <= o.n && (FIGS[x.fid].types.includes('flying') || FIGS[x.fid].types.includes('water')) && !FIGS[x.fid].types.includes('ground')).forEach(x => applyStatus(g, x, 'paralyzed', self)); break; }
      case 'pumpkin': { if (oOn) { opp.pumpkin = true; log(g, FIGS[opp.fid].name + ' gets a Pumpkin marker.'); } break; }
      case 'branded': { if (oOn && hasSt(opp, 'burned')) { opp.branded = true; log(g, FIGS[opp.fid].name + ' is Branded.'); } break; }
      case 'lariat': { const pos0 = ctx.oppPos; if (!pos0 || !self) break; B.ADJ[pos0].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x !== self).forEach(x => { toBench(g, x); log(g, FIGS[x.fid].name + ' is thrown to the bench.'); }); break; }
      case 'throwAdj': { if (!sOn) break; const c2 = B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && x !== opp); if (!c2.length) break; const x = c2[(R(g) * c2.length) | 0]; const dd = B.bfs(x.pos, null); const spots = Object.keys(dd).filter(p => dd[p] === o.n && !g.occ[p]); if (spots.length) { setPos(g, x, spots[(R(g) * spots.length) | 0]); addWait(g, x, 1); log(g, FIGS[x.fid].name + ' is thrown away and must Wait.'); } break; }
      case 'cureBurnAll': { onField(g).forEach(x => { x.st = x.st.filter(s => s !== 'burned'); }); break; }
      case 'cosmic': { if (sOn) { self.cosmic = true; log(g, FIGS[self.fid].name + ' gains +1 MP and Purple Attacks gain a star while on the field.'); } break; }
      case 'tractor': { if (!sOn) break; const dd = B.bfs(self.pos); const c2 = onField(g, self.owner).filter(x => x !== self && FIGS[x.fid].types.includes('steel') && dd[x.pos] <= 2); if (!c2.length) break; const free = Object.keys(dd).filter(p => dd[p] >= 1 && dd[p] <= 2 && !g.occ[p]).sort((a1, b1) => dd[a1] - dd[b1]); if (free.length) setPos(g, c2[0], free[0]); break; }
      case 'finalSong': { if (!sOn) break; const dd = B.bfs(self.pos); onField(g).filter(x => x !== self && dd[x.pos] != null && dd[x.pos] <= o.n).forEach(x => { x.finalSong = g.seq + 2 * o.turns; log(g, FIGS[x.fid].name + ' hears the Final Song...'); }); break; }
      case 'permBoost': { if (sOn) self.perm = (self.perm || 0) + o.n; break; }
      case 'ultraEnter': { for (const x of [self, opp]) if (x && x.loc === 'field') { setPos(g, x, null); x.loc = 'ultra'; x.st = []; log(g, FIGS[x.fid].name + ' is sent to the Ultra Space.'); } break; }
      case 'callSignal': { if (!sOn) break; const u = own(g, self.owner).filter(x => x.loc === 'ultra'); if (!u.length) break; const dd = B.bfs(self.pos); const spots = Object.keys(dd).filter(p => dd[p] === o.n && !g.occ[p]); if (spots.length) { const x = u[0]; x.loc = 'field'; setPos(g, x, spots[(R(g) * spots.length) | 0]); log(g, FIGS[x.fid].name + ' returns from the Ultra Space.'); surroundCheck(g, 1 - x.owner); } break; }
      case 'ultraBelch': { if (!self) break; const u = own(g, 1 - self.owner).filter(x => x.loc === 'ultra'); if (!u.length) break; const spots = B.POINTS.filter(p => !g.occ[p]); if (!spots.length) break; const x = u[0]; x.loc = 'field'; setPos(g, x, spots[(R(g) * spots.length) | 0]); addWait(g, x, o.w); log(g, FIGS[x.fid].name + ' is dragged out of the Ultra Space (Wait ' + o.w + ').'); break; }
      case 'ultraSpin': { const k = Object.values(g.figs).filter(x => x.loc === 'ultra').length; for (let i = 0; i < k; i++) { const c2 = o.who === 'opp' ? onField(g, 1 - self.owner) : onField(g); if (!c2.length) break; const t = c2[(R(g) * c2.length) | 0]; const r = effSpin(g, t); log(g, FIGS[t.fid].name + ' spins ' + r.seg.name + '.'); if (r.color === 'White' && !r.seg.isMiss) applyStatus(g, t, o.st, self); } break; }
      case 'lightBurns': { if (!sOn) break; const k = Object.values(g.figs).filter(x => x.loc === 'ultra').length; const dd = B.bfs(self.pos); const c2 = onField(g, 1 - self.owner).filter(x => dd[x.pos] <= k + 1); if (!c2.length) break; const t = c2[(R(g) * c2.length) | 0]; const r = effSpin(g, t); if (r.color === 'Purple' && !r.seg.isMiss) { setPos(g, t, null); t.loc = 'removed'; t.st = []; log(g, FIGS[t.fid].name + ' is excluded from the duel!'); } break; }
      case 'excludeOppIfType': { if (oOn && FIGS[opp.fid].types.some(t => o.types.includes(t))) { setPos(g, opp, null); opp.loc = 'excluded'; opp.returnIn = o.turns; opp.st = []; log(g, FIGS[opp.fid].name + ' is temporarily excluded from the duel.'); } break; }
      case 'excludeIfCracked': { if (oOn && opp.cracked) { setPos(g, opp, null); opp.loc = 'removed'; opp.st = []; log(g, FIGS[opp.fid].name + ' is excluded from the duel!'); } break; }
      case 'benchAdjType': { if (!sOn) break; B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && FIGS[x.fid].types.some(t => o.types.includes(t))).forEach(x => { toBench(g, x); log(g, FIGS[x.fid].name + ' is blown to the bench.'); }); break; }
      case 'callFromPC': { if (!self) break; const x = own(g, self.owner).find(q => q.loc === 'pc' && FIGS[q.fid].name.toLowerCase().includes(o.name)); if (x) { g.players[x.owner].pc = g.players[x.owner].pc.filter(u => u !== x.uid); x.loc = 'bench'; log(g, FIGS[x.fid].name + ' is called to the bench.'); } break; }
      case 'statusAdjType': { if (!sOn) break; B.ADJ[self.pos].map(p => g.occ[p] && g.figs[g.occ[p]]).filter(x => x && FIGS[x.fid].types.includes(o.type)).forEach(x => applyStatus(g, x, o.st, self)); break; }
      case 'boostTurn': { if (self) self.boostTurn = { n: o.n, until: g.seq + 2 }; break; }
      case 'pcToBench': { if (opp && opp.loc === 'pc') { g.players[opp.owner].pc = g.players[opp.owner].pc.filter(u => u !== opp.uid); opp.loc = 'bench'; log(g, FIGS[opp.fid].name + ' moves to the bench.'); } break; }
      case 'lunarDance': { if (!self) break; own(g, self.owner).forEach(x => { x.st = x.st.filter(s => s !== 'asleep'); }); const pc = g.players[self.owner].pc.slice(); g.players[self.owner].pc = []; pc.forEach(u => { g.figs[u].loc = 'bench'; }); if (sOn) toPC(g, self); log(g, 'Lunar Dance heals the team.'); break; }
      case 'shellTrap': { if (self) self.shellTrap = g.seq + 2; break; }
      case 'magicCoat': { if (self) self.coat = g.seq + 2; break; }
      case 'fullMark': { if (self) self.full = true; break; }
      case 'missNextOpp': { if (opp) opp.missNext = true; break; }
      case 'noPassAbility': { if (oOn) opp.noPass = true; break; }
      case 'selfSpinKO': { if (sOn) { const r = effSpin(g, self); if (r.seg.isMiss) koFigure(g, self); } break; }
      case 'waitBenchOpp': { if (self) own(g, 1 - self.owner).filter(x => x.loc === 'bench').forEach(x => addWait(g, x, o.n)); break; }
      case 'selfPC': { if (sOn) toPC(g, self); break; }
      case 'shove': {
        if (!sOn || !oOn) break;
        // strictly straight line away from the attacker; the opponent and every Pokémon in the way are pushed to the end of the line
        const line = [opp.pos]; let prev = self.pos, cur2 = opp.pos; for (let i = 0; i < 12; i++) { const nx = B.beyond(prev, cur2); if (!nx) break; line.push(nx); prev = cur2; cur2 = nx; }
        const pieces = line.map(p => g.occ[p] && g.figs[g.occ[p]]).filter(Boolean); if (!pieces.length) break;
        const dest = line.slice(line.length - pieces.length); line.forEach(p => { if (g.occ[p]) delete g.occ[p]; });
        pieces.forEach((x, i) => { g.occ[dest[i]] = x.uid; x.pos = dest[i]; }); pieces.forEach(x => addWait(g, x, o.n || 1));
        log(g, FIGS[opp.fid].name + (pieces.length > 1 ? ' and ' + (pieces.length - 1) + ' other Pokémon are' : ' is') + ' shoved back in a straight line.'); break;
      }
      case 'pancake': { if (!sOn || !oOn) break; const chain = [opp]; let cur2 = opp.pos, prev = self.pos; for (let i = 0; i < 6; i++) { const nx = B.beyond(prev, cur2); if (!nx || !g.occ[nx]) break; chain.push(g.figs[g.occ[nx]]); prev = cur2; cur2 = nx; } for (const x of chain.slice().reverse()) { if (x.loc === 'field') { knock(g, self, x, 6); addWait(g, x, 1); } } break; }
      case 'trickRoom': { g.trickRoom = g.seq + 2 * o.turns; log(g, 'Trick Room! For ' + o.turns + ' turns Gold Attacks become Misses and MP is inverted.'); break; }
      case 'setMpSet': { if (opp) { opp.mpSet = o.mp; log(g, FIGS[opp.fid].name + ' gets MP' + o.mp + '.'); } break; }
      case 'restorePlates': { if (self) g.players[self.owner].plates.forEach(x => { if (!x.gone) x.used = false; }); break; }
      case 'noAbilityName': { if (opp) { const nm = FIGS[opp.fid].name; own(g, opp.owner).filter(x => FIGS[x.fid].name === nm).forEach(x => (x.noAbility = true)); log(g, nm + ' lose their Abilities for the rest of the duel.'); } break; }
      case 'removeOpp': { if (opp && (opp.loc === 'field' || opp.loc === 'bench')) { if (opp.pos) setPos(g, opp, null); opp.loc = 'removed'; opp.st = []; log(g, FIGS[opp.fid].name + ' is excluded from the duel.'); } break; }
      case 'pickFx': {
        if (!self) break; const cands = pickFxCands(g, self, opp, o.cand); if (!cands.length) break;
        g.tasks.push({ kind: 'pickFx', seat: self.owner, uid: self.uid, cands, then: o.then, optional: !!o.optional, botRule: o.botRule });
        break;
      }
      case 'wishKoko': { runOps(g, [{ op: 'pickFx', cand: 'ownOther', optional: true, then: [{ op: 'setMpSet', mp: o.mp }, { op: 'selfRemove' }] }], ctx); break; }
      case 'wishLele': { runOps(g, [{ op: 'pickFx', cand: 'self', optional: true, botRule: 'lele', then: [{ op: 'restorePlates' }, { op: 'selfRemove' }] }], ctx); break; }
      case 'wishBulu': { runOps(g, [{ op: 'pickFx', cand: 'oppField', optional: true, then: [{ op: 'noAbilityName' }, { op: 'selfRemove' }] }], ctx); break; }
      case 'wishFini': { runOps(g, [{ op: 'pickFx', cand: 'oppField', optional: true, then: [{ op: 'removeOpp' }, { op: 'selfRemove' }] }], ctx); break; }
      case 'blueHole': { runOps(g, [{ op: 'pickFx', cand: 'oppBattle', optional: true, then: [{ op: 'removeOpp' }, { op: 'selfRemove' }] }], ctx); break; }
      case 'shiftCond': { if (sOn && oOn && self.st.length) { const sts = self.st.slice(); self.st = []; sts.forEach(s => applyStatus(g, opp, s, self)); log(g, FIGS[self.fid].name + ' passes its condition to ' + FIGS[opp.fid].name + '!'); } break; }
      case 'koBehind': { if (!sOn || !oOn) break; const behind = B.beyond(self.pos, opp.pos); const y = behind && g.occ[behind] && g.figs[g.occ[behind]]; koFigure(g, opp); if (y && y.loc === 'field') koFigure(g, y); break; }
      case 'flipBehind': { if (!sOn || !oOn) break; const to = B.beyond(opp.pos, self.pos); if (to && !g.occ[to]) { const via = B.ADJ[self.pos].includes(to) ? to : null; if (via) { setPos(g, opp, to); log(g, FIGS[opp.fid].name + ' is tossed behind ' + FIGS[self.fid].name + '.'); } } break; }
      case 'waitNearNames': { const mine = onField(g, self.owner).filter(x => o.names.some(n => FIGS[x.fid].name.toLowerCase().includes(n))); const seen = new Set(); for (const m of mine) for (const p of B.ADJ[m.pos]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y && y.owner !== self.owner && !seen.has(y.uid)) { seen.add(y.uid); addWait(g, y, 1); } } break; }
      case 'tauntMark': { if (oOn) { opp.taunt = { until: o.now ? g.seq : g.seq + 2 }; log(g, FIGS[opp.fid].name + ' is taunted: Purple and Blue results shift away until the end of your next turn.'); } break; }
      case 'dmgBoostNext': { if (self) self.boost = { n: o.n, until: o.until }; break; }
      case 'poisonMult': { onField(g).forEach(x => { x.st = x.st.filter(s => s !== 'poisoned' && s !== 'noxious'); }); break; }
      case 'spinOne': { const c = onField(g, 1 - (self ? self.owner : 0)); if (!c.length) break; const t = c[(R(g) * c.length) | 0]; const r = effSpin(g, t); log(g, FIGS[t.fid].name + ' spins ' + r.seg.name + '.'); if (o.white ? (r.color === 'White' && !r.seg.isMiss) : (r.seg.isMiss || (r.color === 'White' && r.dmg >= o.thr))) koFigure(g, t); break; }
      case 'spinEveryone': { for (const t of onField(g).filter(x => x !== self)) { const r = effSpin(g, t); if (r.seg.isMiss) { if (o.then === 'pc') toPC(g, t); else koFigure(g, t); } } break; }
    }
  }
}

// ------------------------------------------------------------------ battle
function battle(g, aUid, dUid, zColor) {
  const a = fig(g, aUid), d = fig(g, dUid), ad = FIGS[a.fid], dd = FIGS[d.fid];
  const useZ = zColor && g.players[a.owner].gauge >= GAUGE_FULL && ad.zsegs.some(s => s.name === zColor || s.color === zColor) ? zColor : null;
  if (useZ) { g.players[a.owner].gauge = 0; log(g, ad.name + ' unleashes a Z-Move!'); }
  const pre = Object.values(g.figs).map(f => { const o = { uid: f.uid, loc: f.loc, pos: f.pos, wait: f.wait, st: f.st.slice(), mpMark: f.mpMark, cracked: f.cracked, curse: f.curse }; if (f.loc === 'field') o.fid = f.fid; return o; });
  const aw = buildWheel(g, a, d, useZ), dw = buildWheel(g, d, a, null);
  if (hasSt(d, 'asleep') || hasSt(d, 'frozen')) dw.forEach(s => { s.color = 'Red'; s.name = 'Miss'; s.dmg = { kind: 'none', n: 0 }; s.ops = []; s.isMiss = true; });
  const spinFor = (f, w, pl) => {
    let r = doSpin(g, f, w);
    if ((r.seg.isMiss) && (pl.dc || pl.lucky)) { if (pl.dc) pl.dc = false; else pl.lucky = false; log(g, 'Re-spin!'); const first = r.spins, fd = r.drifts || []; r = doSpin(g, f, w); r.spins = first.concat(r.spins); r.drifts = fd.concat(r.drifts || []); }
    return r;
  };
  const seq0 = g.logSeq || 0;
  let ar = spinFor(a, aw, g.players[a.owner]), dr = spinFor(d, dw, g.players[d.owner]);
  // v5 spin hooks
  g.battleNo = (g.battleNo || 0) + 1;
  { const has = (r, n) => r.seg.ops.some(o => o.op === n);
    const reroll = (f, w, r) => { const r2 = doSpin(g, f, w); r2.drifts = (r.drifts || []).concat(r2.drifts || []); r2.spins = r.spins.concat(r2.spins); return r2; };
    const missRes = (w, r) => { const ms = w.find(s => s.isMiss) || { name: 'Miss', color: 'Red', dmg: { kind: 'none', n: 0 }, ops: [], isMiss: true, size: 1, notes: '' }; return { seg: ms, dmg: 0, color: 'Red', trace: ['Miss'], spins: r.spins }; };
    const assistFor = (f, w, r, opp2, ow) => { const nm = FIGS[f.fid].name; const bn = own(g, f.owner).filter(x => x.loc === 'bench' && FIGS[x.fid].name !== nm && x.fid); if (!bn.length) return r; const b2 = bn[(R(g) * bn.length) | 0]; const r2 = doSpin(g, b2, buildWheel(g, b2, opp2)); log(g, FIGS[b2.fid].name + ' assists with ' + r2.seg.name + '!'); r2.spins = r.spins; return r2; };
    if (has(ar, 'assist')) ar = assistFor(a, aw, ar, d); if (has(dr, 'assist')) dr = assistFor(d, dw, dr, a);
    { g.used = g.used || {}; const abRespin = (me, other, ow, oR) => { for (const r of rulesOf(me)) { if (r.k !== 'respinOpp') continue; const key = g.turn + ':' + me.uid + ':' + r.k; if (g.used[key]) continue; if (r.color ? oR.color === r.color : (['White', 'Gold'].includes(oR.color) && oR.dmg >= r.minDmg)) { g.used[key] = true; log(g, FIGS[me.fid].name + ' forces ' + FIGS[other.fid].name + ' to spin again!'); oR = reroll(other, ow, oR); } } return oR; };
      dr = abRespin(a, d, dw, dr); ar = abRespin(d, a, aw, ar); }
    if (has(ar, 'imprison') && ar.color === 'Purple') { dr = missRes(dw, dr); log(g, FIGS[d.fid].name + ' is imprisoned: its Attack becomes a Miss.'); }
    if (has(dr, 'imprison') && dr.color === 'Purple') { ar = missRes(aw, ar); log(g, FIGS[a.fid].name + ' is imprisoned: its Attack becomes a Miss.'); }
    if (has(ar, 'respinPurple')) { for (let i = 0; i < 6 && dr.color === 'Purple'; i++) dr = reroll(d, dw, dr); }
    if (has(dr, 'respinPurple')) { for (let i = 0; i < 6 && ar.color === 'Purple'; i++) ar = reroll(a, aw, ar); }
    if (has(ar, 'tormentOpp')) { const r2 = doSpin(g, d, dw); if (r2.seg.name === dr.seg.name) { dr = missRes(dw, dr); log(g, FIGS[d.fid].name + ' is tormented and misses!'); } }
    if (has(dr, 'tormentOpp')) { const r2 = doSpin(g, a, aw); if (r2.seg.name === ar.seg.name) { ar = missRes(aw, ar); log(g, FIGS[a.fid].name + ' is tormented and misses!'); } }
    const bad = forA => { const ta = { ...ar, dmg: modDamage(g, a, d, ar) }, td = { ...dr, dmg: modDamage(g, d, a, dr) }; const o = outcome(ta, td); return forA ? (o.aKO || (!o.dKO && !o.aFx)) : (o.dKO || (!o.aKO && !o.dFx)); };
    const rs = ar.seg.ops.find(o => o.op === 'respinSelf'), rs2 = dr.seg.ops.find(o => o.op === 'respinSelf');
    for (const [me, mw, sideA] of [[a, aw, true], [d, dw, false]]) for (const r of rulesOf(me)) if (r.k === 'respinSelfN') { const cnt = onField(g, me.owner).filter(x => x !== me && FIGS[x.fid].name.toLowerCase().includes(r.name)).length; const key = g.battleNo + ':' + me.uid; g.used = g.used || {}; let left = cnt - (g.used[key] || 0); while (left-- > 0 && bad(sideA)) { g.used[key] = (g.used[key] || 0) + 1; log(g, FIGS[me.fid].name + ' redoes its spin (Psychic Net).'); if (sideA) ar = reroll(a, aw, ar); else dr = reroll(d, dw, dr); } }
    if (rs && bad(true)) { log(g, ad.name + ' respins!'); ar = reroll(a, aw, ar); }
    if (rs && rs.both && bad(false)) { log(g, dd.name + ' respins too!'); dr = reroll(d, dw, dr); }
    if (rs2 && bad(false)) { log(g, dd.name + ' respins!'); dr = reroll(d, dw, dr); }
    if (rs2 && rs2.both && bad(true)) { log(g, ad.name + ' respins too!'); ar = reroll(a, aw, ar); }
    if (has(ar, 'breakEnergy')) { const b2 = bu(g, d.uid); b2.dmg = 0; b2.threat = 0; b2.mp = 0; d.guard = false; log(g, 'Energy Plate effects on ' + dd.name + ' are lost!'); }
    if (has(dr, 'breakEnergy')) { const b2 = bu(g, a.uid); b2.dmg = 0; b2.threat = 0; b2.mp = 0; a.guard = false; log(g, 'Energy Plate effects on ' + ad.name + ' are lost!'); }
  }
  ar.starBonus = (a.cosmic ? 1 : 0) + rulesOf(a).filter(r => r.k === 'starPlus').reduce((t, r) => t + r.n, 0); dr.starBonus = (d.cosmic ? 1 : 0) + rulesOf(d).filter(r => r.k === 'starPlus').reduce((t, r) => t + r.n, 0); if (ar.color !== 'Purple') ar.starBonus = 0; if (dr.color !== 'Purple') dr.starBonus = 0;
  ar.dmg = modDamage(g, a, d, ar); dr.dmg = modDamage(g, d, a, dr);
  const out = outcome(ar, dr);
  { const wg = c => c === 'White' || c === 'Gold';
    const sideHooks = (me, meR, other, otherR, meIsA) => {
      const ko = meIsA ? 'dKO' : 'aKO', self = meIsA ? 'aKO' : 'dKO';
      for (const o of meR.seg.ops) {
        if (otherR.color === 'Blue' && !(o.op === 'excludeOnTie')) { if (o.op === 'koIfOppType' || o.op === 'koIfOppMp') continue; }
        if (o.op === 'koIfOppType' && FIGS[other.fid].types.includes(o.type)) { out[ko] = true; out[self] = false; log(g, FIGS[me.fid].name + ' crushes ' + FIGS[other.fid].name + '!'); }
        if (o.op === 'koIfOppMp' && baseMp(g, other) >= o.n) { out[ko] = true; out[self] = false; }
        if (o.op === 'safeIfOppType' && FIGS[other.fid].types.includes(o.type) && out[self]) { out[self] = false; log(g, FIGS[me.fid].name + ' takes no damage!'); }
        if (o.op === 'recoilKO' && wg(otherR.color) && otherR.dmg > meR.dmg / 2) out[self] = true;
        if (o.op === 'safeIfPara' && (hasSt(me, 'paralyzed') || hasSt(other, 'paralyzed')) && out[self]) { out[self] = false; log(g, FIGS[me.fid].name + ' cannot be knocked out!'); }
        if (o.op === 'excludeOnTie' && out.text === 'Tie' && other.loc === 'field') { setPos(g, other, null); other.loc = 'removed'; other.st = []; log(g, FIGS[other.fid].name + ' is excluded from the duel!'); }
      }
    };
    sideHooks(a, ar, d, dr, true); sideHooks(d, dr, a, ar, false);
    for (const [me, other, self, oc] of [[a, d, 'aKO', dr], [d, a, 'dKO', ar]]) if (out[self] && oc.color === 'Gold' && (hasRule(me, 'ironHeart') || fieldHolders(g, 'ironHeart').some(([h]) => h.owner === me.owner && B.ADJ[h.pos].includes(me.pos)))) { out[self] = false; log(g, FIGS[me.fid].name + ' is protected by Iron Heart!'); }
    for (const [me, other, self] of [[a, d, 'aKO'], [d, a, 'dKO']]) for (const r of rulesOf(me)) if (r.k === 'safeDamage' && out[self] && wg(other === a ? ar.color : dr.color)) { out[self] = false; log(g, FIGS[me.fid].name + ' is not knocked out by battle damage!'); } else if (r.k === 'safeVsType' && out[self] && !(r.healthy && me.st.length)) {
      const ot = FIGS[other.fid].types; if (ot.some(t => r.types.includes(t)) && (!r.pure || ot.length === 1)) { out[self] = false; log(g, FIGS[me.fid].name + ' cannot be knocked out!'); } }
    const passive = (me, meR, other, otherR, meIsA) => { const ko = meIsA ? 'dKO' : 'aKO', self = meIsA ? 'aKO' : 'dKO';
      if (me.shellTrap && g.seq <= me.shellTrap && otherR.color === 'White' && !otherR.seg.isMiss) { out[ko] = true; log(g, 'Shell Trap snaps shut!'); }
      if (me.full && out[self] && wg(otherR.color)) { out[self] = false; me.full = false; me.st = []; log(g, FIGS[me.fid].name + ' survives thanks to its Full marker!'); } };
    passive(a, ar, d, dr, true); passive(d, dr, a, ar, false); }
  // counters
  const cnt = (me, meR, other, otherR, o) => { const c = meR.seg.ops.find(x => x.op === 'counter'); return c && otherR.dmg >= c.n && o; };
  if (out.aKO && cnt(a, ar, d, dr, true)) { out.aKO = false; out.dKO = true; }
  else if (out.dKO && cnt(d, dr, a, ar, true)) { out.dKO = false; out.aKO = true; }
  const safe = (ops, other) => ops.some(o => o.op === 'safeIf' && (o.cmp === 'lt' ? other.dmg < o.n : o.cmp === 'lte' ? other.dmg <= o.n : other.dmg >= o.n));
  if (out.aKO && safe(ar.seg.ops, dr)) { out.aKO = false; log(g, FIGS[a.fid].name + ' cannot be knocked out by that attack!'); }
  if (out.dKO && safe(dr.seg.ops, ar)) { out.dKO = false; log(g, FIGS[d.fid].name + ' cannot be knocked out by that attack!'); }
  const mc = (R_, other) => R_.seg.ops.find(x => x.op === 'mpCounter');
  if (out.aKO && ar.seg.ops.length === 0 && dr.seg.ops.some(x => x.op === 'mpCounter')) { /* defender-only; ignored */ }
  const res = {
    attacker: { uid: aUid, seg: ar.seg.name, color: ar.color, dmg: ar.dmg, stars: (ar.seg.dmg && ar.seg.dmg.stars) || 0, z: !!useZ, notes: ar.seg.notes },
    defender: { uid: dUid, seg: dr.seg.name, stars: (dr.seg.dmg && dr.seg.dmg.stars) || 0, color: dr.color, dmg: dr.dmg, notes: dr.seg.notes },
    text: out.text, aKO: false, dKO: false, pre,
  };
  res.aw = wInfoOf(aw, ar); res.dw = wInfoOf(dw, dr); res.aw.confused = hasSt(a, 'confused'); res.dw.confused = hasSt(d, 'confused'); res.aw.cond = a.st.slice(); res.dw.cond = d.st.slice(); g.effSpins = []; res.effSpins = g.effSpins;
  log(g, `${ad.name} → ${ar.seg.name} (${ar.color}${ar.color === 'White' || ar.color === 'Gold' ? ' ' + ar.dmg : ''})  vs  ${dd.name} → ${dr.seg.name} (${dr.color}${dr.color === 'White' || dr.color === 'Gold' ? ' ' + dr.dmg : ''})`);
  if (out.text && out.text !== 'Tie') log(g, 'Result: ' + out.text + (out.aFx || out.dFx || out.aKO || out.dKO ? '' : ' (no effects).'));
  const seq1 = g.logSeq || 0;
  // battle passives
  if (ad.flags.battlerWait) addWait(g, d, 1); if (dd.flags.battlerWait) addWait(g, a, 1);
  if (ad.flags.battlerPoison) applyStatus(g, d, 'poisoned'); if (dd.flags.battlerPoison) applyStatus(g, a, 'poisoned');
  // gauge
  for (const f of [a, d]) g.players[f.owner].gauge = Math.min(GAUGE_FULL, g.players[f.owner].gauge + 20);
  const exA = ar.seg.ops.find(o => o.op === 'excludeOnKO'), exD = dr.seg.ops.find(o => o.op === 'excludeOnKO');
  const ctxA = { self: a, opp: d, oppPos: d.pos, selfPos: a.pos }, ctxD = { self: d, opp: a, oppPos: a.pos, selfPos: d.pos };
  const aPos0 = a.pos, dPos0 = d.pos;
  // effects first (ordering: KO then post effects). Run non-KO-dependent effects before KOs so statuses reach the target.
  const immediate = ops => ops.filter(o => !['onSelfKO', 'onSelfKOKO', 'onSelfKOArea', 'counter', 'mpCounter', 'typeBonus', 'excludeOnKO', 'selfMove', 'digAway', 'claimSpot', 'buffSpin', 'plusSpin', 'multSpin', 'condMult', 'mpHigherBonus', 'safeIf', 'skipNextIfKO', 'swapIn', 'hydroKick', 'resetSelfIfKO', 'lariat', 'jumpBeyondIfType', 'onSelfKOWithin', 'onSelfKOPC', 'respinPurple', 'tormentOpp', 'respinSelf', 'breakEnergy', 'excludeOnTie', 'koIfOppType', 'koIfOppMp', 'selfKOIfOppKO', 'recoilKO', 'safeIfPara', 'scaleMove', 'adjBonus', 'nearMult', 'pcBonus', 'poisonMult2'].includes(o.op));
  const post = ops => ops.filter(o => o.op === 'selfMove' || o.op === 'digAway' || o.op === 'claimSpot' || o.op === 'skipNextIfKO' || o.op === 'swapIn' || o.op === 'hydroKick' || o.op === 'resetSelfIfKO' || o.op === 'lariat' || o.op === 'jumpBeyondIfType');
  if (out.aFx) runOps(g, immediate(ar.seg.ops), ctxA);
  if (out.dFx && a.loc === 'field' && d.loc === 'field') runOps(g, immediate(dr.seg.ops), ctxD);
  if (out.aKO || out.dKO) {
    const aWasField = a.loc === 'field', dWasField = d.loc === 'field';
    if (out.aKO && aWasField) { res.aKO = koFigure(g, a, { excludeTurns: exD ? exD.turns : 0 }); const t = ar.seg.ops.find(o => o.op === 'onSelfKO'); if (t && d.loc === 'field') { if (t.st) applyStatus(g, d, t.st); if (t.mp) d.mpMark += t.mp; } if (ar.seg.ops.some(o => o.op === 'onSelfKOPC') && d.loc === 'field') toPC(g, d); { const w = ar.seg.ops.find(o => o.op === 'onSelfKOWithin'); if (w && aPos0) { const dd = B.bfs(aPos0); onField(g).forEach(y => { if (dd[y.pos] <= w.n) applyStatus(g, y, w.st); }); } } if (ar.seg.ops.some(o => o.op === 'onSelfKOKO') && d.loc === 'field') koFigure(g, d, { force: true }); if (ar.seg.ops.some(o => o.op === 'onSelfKO') === false) { /* also check defender notes for onSelfKO belonging to a */ } }
    if (out.dKO && dWasField) { res.dKO = koFigure(g, d, { excludeTurns: exA ? exA.turns : 0 }); const t = dr.seg.ops.find(o => o.op === 'onSelfKO'); if (t && a.loc === 'field') { if (t.st) applyStatus(g, a, t.st); if (t.mp) a.mpMark += t.mp; } if (dr.seg.ops.some(o => o.op === 'onSelfKOPC') && a.loc === 'field') toPC(g, a); { const w = dr.seg.ops.find(o => o.op === 'onSelfKOWithin'); if (w && dPos0) { const dd = B.bfs(dPos0); onField(g).forEach(y => { if (dd[y.pos] <= w.n) applyStatus(g, y, w.st); }); } } if (dr.seg.ops.some(o => o.op === 'onSelfKOKO') && a.loc === 'field') koFigure(g, a, { force: true }); }
  }
  // spin-conditional knock-outs and area triggers
  const spinKO = (me, meR, other, otherR, fx) => { if (!fx || other.loc !== 'field') return; for (const o of meR.seg.ops) { if (o.op === 'oppDmgKO' && (otherR.color === 'White' || otherR.color === 'Gold') && otherR.dmg >= o.n) koFigure(g, other); if (o.op === 'oppPurpleKO' && otherR.color === 'Purple') koFigure(g, other); } };
  spinKO(a, ar, d, dr, out.aFx); spinKO(d, dr, a, ar, out.dFx);
  for (const f of [a, d]) if (f.missMarks) f.missMarks = f.missMarks.filter(m => !(m.once && m.born < g.battleNo));
  if (res.dKO && ar.seg.ops.some(o => o.op === 'selfKOIfOppKO') && a.loc === 'field') { log(g, ad.name + ' goes down with its opponent!'); koFigure(g, a, { force: true }); }
  if (res.aKO && dr.seg.ops.some(o => o.op === 'selfKOIfOppKO') && d.loc === 'field') { log(g, dd.name + ' goes down with its opponent!'); koFigure(g, d, { force: true }); }
  if (a.boost && a.boost.until === ar.seg.name.toLowerCase()) a.boost = null; if (d.boost && d.boost.until === dr.seg.name.toLowerCase()) d.boost = null;
  const koArea = (x, r, pos0) => { if (x.loc === 'field') return; const o = r.seg.ops.find(q => q.op === 'onSelfKOArea'); if (!o || !pos0) return; for (const p of B.ADJ[pos0]) { const y = g.occ[p] && g.figs[g.occ[p]]; if (y) applyStatus(g, y, o.st, null); } };
  koArea(a, ar, aPos0); koArea(d, dr, dPos0);
  // mp-counter style
  if (out.dFx !== undefined) {
    const mcA = ar.seg.ops.find(o => o.op === 'mpCounter');
    if (mcA && baseMp(g, d) >= mcA.n && d.loc === 'field' && a.loc === 'field' && out.aFx) koFigure(g, d);
  }
  if (out.aFx && a.loc === 'field') runOps(g, post(ar.seg.ops).filter(o => !o.ifKO || d.loc !== 'field'), ctxA);
  if (out.dFx && d.loc === 'field') runOps(g, post(dr.seg.ops).filter(o => !o.ifKO || a.loc !== 'field'), ctxD);
  // endpoint clear temporary
  if (a.focus && a.loc === 'field') a.focus = false;
  const contact = (x, y) => { if (y.loc === 'field') for (const r of rulesOf(x)) { if (r.k === 'contact' && (!r.types || sharesType(y, r.types))) applyStatus(g, y, r.st, x); } if (y.loc === 'field' && x.loc === 'field') for (const r of rulesOf(x)) if (r.k === 'contactCracked' && !(r.healthy && x.st.length)) { y.cracked = true; log(g, FIGS[y.fid].name + ' is cracked!'); }
  if (x.loc === 'field') for (const r of rulesOf(x)) if (r.k === 'contactSelf') applyStatus(g, x, r.st, null); };
  contact(a, d); contact(d, a); a.battled = d.battled = true; a.missMarks = (a.missMarks || []).filter(m => m.until); d.missMarks = (d.missMarks || []).filter(m => m.until);
  surroundCheck(g, a.owner); surroundCheck(g, d.owner);
  res.events = g.log.filter(x => x.seq > seq1).map(x => x.msg);
  g.effSpins = null; g.lastBattle = res; return res;
}

// ------------------------------------------------------------------ plates
function plateTargets(g, idx) {
  const p = g.players[g.cur]; const pl = p.plates[idx]; if (!pl || pl.used) return null; const P = PLATES[pl.key];
  const field = onField(g, g.cur).map(f => f.uid), bench = own(g, g.cur).filter(f => f.loc === 'bench').map(f => f.uid), pc = own(g, g.cur).filter(f => f.loc === 'pc').map(f => f.uid);
  switch (P.target) {
    case 'none': return { a: [] };
    case 'ownField': return { a: P.bench ? field.concat(bench) : field };
    case 'ownPC': return { a: pc };
    case 'switch': return { a: field, b: bench };
  }
}
const absolLock = g => onField(g, 1 - g.cur).some(h => rulesOf(h).some(r => r.k === 'plateLock' && !(r.healthy && h.st.length)));
function usePlate(g, idx, a, b) {
  const p = g.players[g.cur]; const pl = p.plates[idx]; if (!pl || pl.used) return 'Plate unavailable.'; if (g.moved) return 'Plates must be used before moving.'; if (absolLock(g)) return 'Intimidating Aura: plates cannot be used.'; if (p.plateLockNow) return 'Plates are locked this turn.';
  const T = plateTargets(g, idx); const P = PLATES[pl.key];
  if (P.target !== 'none' && (!T.a.includes(a))) return 'Choose a valid target.';
  if (P.target === 'switch' && !(T.b || []).includes(b)) return 'Choose a bench Pokémon.';
  const f = a && g.figs[a], bf = b && g.figs[b];
  const ENERGY = ['plus_power', 'plus_power_2', 'threat', 'speed_boost', 'big_guard'];
  const nullE = ENERGY.includes(pl.key) && [...fieldHolders(g, 'noEnergy')].length > 0;
  if (nullE) log(g, 'Black Core negates the effect of the Energy plate!');
  switch (nullE ? 'none' : pl.key) {
    case 'plus_power': bu(g, a).dmg += 30; break;
    case 'plus_power_2': bu(g, a).dmg += 60; break;
    case 'threat': bu(g, a).dmg += 20; bu(g, a).threat = 1; break;
    case 'switch': { if (bf.wait > 0) return 'That Pokémon is Waiting.'; const pos = f.pos; setPos(g, f, null); f.loc = 'bench'; f.st = []; bf.loc = 'field'; setPos(g, bf, pos); break; }
    case 'hurdle_jump': bu(g, a).pass = true; break;
    case 'speed_boost': bu(g, a).mp += 1; break;
    case 'retreat': toBench(g, f); break;
    case 'goal_block': g.lockedGoal[g.cur] = 1; break;
    case 'focus_band': f.focus = true; break;
    case 'big_guard': f.guard = true; break;
    case 'double_chance': p.dc = true; break;
    case 'respin_all': p.lucky = true; break;
    case 'revive': { p.pc = p.pc.filter(u => u !== a); f.loc = 'bench'; break; }
    case 'full_heal': onField(g, g.cur).forEach(x => (x.st = [])); break;
    case 'wake_up': f.wait = 0; f.canActAtTurnStart = true; break;
    case 'z_charge': p.gauge = Math.min(GAUGE_FULL, p.gauge + 50); break;
  }
  pl.used = true; g.plateEv = { n: ((g.plateEv && g.plateEv.n) || 0) + 1, seat: g.cur, key: pl.key, targets: [a, b].filter(u => u != null && g.figs[u]).map(u => FIGS[g.figs[u].fid].name) }; log(g, p.name + ' uses ' + P.name + ([a, b].filter(u => u != null && g.figs[u]).length ? ' on ' + [a, b].filter(u => u != null && g.figs[u]).map(u => FIGS[g.figs[u].fid].name).join(' and ') : '') + '.');
  return null;
}

// ------------------------------------------------------------------ player-chosen repositioning
function pickCandidates(g, t) {
  const me = g.figs[t.uid]; const fl = t.filter; const out = [];
  for (const x of Object.values(g.figs)) {
    if (x.uid === t.uid || !x.fid) continue;
    if (fl.bench ? x.loc !== 'bench' : x.loc !== 'field') continue;
    if (fl.own && x.owner !== t.seat) continue;
    const d = FIGS[x.fid];
    if (fl.types && !fl.types.some(ty => d.types.includes(ty))) continue;
    if (fl.names && !fl.names.some(n => d.name.toLowerCase().includes(n))) continue;
    if (fl.notSt && fl.notSt.some(s => hasSt(x, s))) continue;
    if (fl.needSt && !hasSt(x, fl.needSt)) continue;
    if (!Object.keys(reach(g, x)).length) continue;
    out.push(x.uid);
  }
  return out;
}
function pickFxCands(g, self, opp, name) {
  switch (name) {
    case 'branded': return onField(g).filter(x => x.branded).map(x => x.uid);
    case 'ownPC': return own(g, self.owner).filter(x => x.loc === 'pc').map(x => x.uid);
    case 'self': return self && self.loc === 'field' ? [self.uid] : [];
    case 'oppBattle': return opp && opp.loc === 'field' ? [opp.uid] : [];
    case 'ownOther': return own(g, self.owner).filter(x => x !== self && (x.loc === 'field' || x.loc === 'bench')).map(x => x.uid);
    case 'oppField': return onField(g, 1 - self.owner).map(x => x.uid);
  }
  if (name.startsWith('ownBenchName:')) { const nm = name.split(':')[1]; return own(g, self.owner).filter(x => x.loc === 'bench' && FIGS[x.fid].name.toLowerCase().includes(nm)).map(x => x.uid); }
  if (name.startsWith('guideLight:')) { const n = +name.split(':')[1]; if (!self || !self.pos) return []; const dd = B.bfs(self.pos); return onField(g).filter(x => (x !== self && dd[x.pos] != null && dd[x.pos] <= n) || FIGS[x.fid].types.includes('bug')).map(x => x.uid); }
  switch (name) {
  }
  return [];
}
function taskOptions(g, t) {
  if (t.kind === 'pickFx') return (t.cands || []).filter(u => g.figs[u]);
  if (t.kind === 'evade' && t.mode && t.mode !== 'back') {
    const D = g.figs[t.uid], A = g.figs[t.attacker]; if (!D || !A || D.loc !== 'field' || A.loc !== 'field') return [];
    if (t.mode === 'bench') return [D.pos];
    if (t.mode === 'past') { const x = B.beyond(D.pos, A.pos); return x && !g.occ[x] && !x.startsWith('G') ? [x] : []; }
    return B.ADJ[A.pos].filter(p => !g.occ[p] && !p.startsWith('G'));
  }
  if (t.kind === 'evade') t = { ...t, kind: 'knock', fromUid: t.attacker, n: t.n };
  if (t.kind === 'pickSwap') {
    const me = g.figs[t.uid]; if (!me || me.loc !== 'field') return [];
    if (t.src === 'adjOwn') return B.ADJ[me.pos].map(p => g.occ[p]).filter(u => u && g.figs[u].owner === me.owner);
    return own(g, me.owner).filter(x => x !== me && ((t.src !== 'pc' && x.loc === 'bench') || (t.src !== 'bench' && x.loc === 'pc')) && x.fid).map(x => x.uid);
  }
  if (t.kind === 'pickOther') return pickCandidates(g, t);
  if (t.kind === 'moveOther') { const x = g.figs[t.uid]; return x && (x.loc === 'field' || x.loc === 'bench') ? Object.keys(reach(g, x)).filter(p => p !== x.pos) : []; }
  const f = g.figs[t.uid]; if (!f || f.loc !== 'field') return [];
  const free = p => !g.occ[p];
  if (t.kind === 'self') {
    if (t.chain) {
      const seen = new Set(), q = B.ADJ[f.pos].filter(p => g.occ[p] && g.occ[p] !== f.uid); q.forEach(p => seen.add(p));
      while (q.length) { const x = q.shift(); for (const n of B.ADJ[x]) if (g.occ[n] && g.occ[n] !== f.uid && !seen.has(n)) { seen.add(n); q.push(n); } }
      const out = new Set(); for (const x of seen) for (const n of B.ADJ[x]) if (!g.occ[n]) out.add(n); return [...out];
    }
    if (t.around && t.from) return B.ADJ[t.from].filter(p => free(p) && p !== f.pos);
    if (t.dig) { const dd = B.bfs(f.pos, p => g.occ[p] && p !== f.pos); return Object.keys(dd).filter(p => dd[p] >= 1 && dd[p] <= 2 && free(p) && !t.dig.some(q => B.ADJ[q].includes(p))); }
    const d = B.bfs(f.pos, t.jump ? null : (p => g.occ[p] && p !== f.pos));
    const bk = t.back && t.from ? B.bfs(t.from) : null; const okBack = p => !bk || (bk[p] ?? 0) > (bk[f.pos] ?? 0);
    let o = Object.keys(d).filter(p => d[p] >= t.lo && d[p] <= t.hi && free(p) && okBack(p));
    if (!o.length) o = Object.keys(d).filter(p => d[p] >= 1 && d[p] <= t.hi && free(p) && okBack(p));
    return o;
  }
  if (t.kind === 'knock') {
    const from = g.figs[t.fromUid]; const base = from && from.pos ? B.bfs(from.pos) : {}; const d = B.bfs(f.pos, p => g.occ[p]);
    const away = p => (base[p] ?? 0) > (base[f.pos] ?? 0);
    let o = Object.keys(d).filter(p => d[p] === t.n && free(p) && away(p));
    if (!o.length) o = Object.keys(d).filter(p => d[p] >= 1 && d[p] <= t.n && free(p) && away(p));
    return o;
  }
  return [];
}
function applyTask(g, t, to) {
  if (t.kind === 'pickFx') { runOps(g, t.then, { self: g.figs[t.uid], opp: g.figs[to] }); return; }
  if (t.kind === 'pickSwap') {
    const me = g.figs[t.uid], x = g.figs[to]; if (!me || !x || me.loc !== 'field') return;
    if (t.src === 'adjOwn') { const a = me.pos, b = x.pos; g.occ[a] = x.uid; g.occ[b] = me.uid; me.pos = b; x.pos = a; log(g, FIGS[me.fid].name + ' and ' + FIGS[x.fid].name + ' switch places.'); return; }
    const pos = me.pos; if (x.loc === 'pc') g.players[x.owner].pc = g.players[x.owner].pc.filter(u => u !== x.uid);
    toBench(g, me); x.loc = 'field'; x.battled = false; setPos(g, x, pos); log(g, FIGS[me.fid].name + ' switches out for ' + FIGS[x.fid].name + '.'); surroundCheck(g, 1 - x.owner); return;
  }
  if (t.kind === 'pickOther') { g.tasks.unshift({ kind: 'moveOther', seat: t.seat, uid: to, sleepOpp: t.sleepOpp }); return; }
  if (t.kind === 'moveOther') {
    const x = g.figs[t.uid]; if (!x || g.occ[to]) return; const wasBench = x.loc === 'bench';
    x.loc = 'field'; setPos(g, x, to); if (wasBench) x.battled = false; addWait(g, x, 1);
    log(g, FIGS[x.fid].name + ' is moved' + (wasBench ? ' onto the field' : '') + ' and gains Wait.');
    if (t.sleepOpp && x.owner !== t.seat) applyStatus(g, x, 'asleep'); surroundCheck(g, 1 - x.owner); surroundCheck(g, x.owner); return;
  }
  const f = g.figs[t.uid]; if (!f || f.loc !== 'field' || g.occ[to]) return; setPos(g, f, to); log(g, FIGS[f.fid].name + ' moves to a new point.'); surroundCheck(g, 1 - f.owner); surroundCheck(g, f.owner); goalCheck(g, f); }
function goalCheck(g, f) {
  if (g.over || f.loc !== 'field' || f.pos !== B.GOALS[f.owner] || hasRule(f, 'noGoalWin')) return;
  if (!hasRule(f, 'noSurround') && B.ADJ[f.pos].length && B.ADJ[f.pos].every(q => g.occ[q] && g.figs[g.occ[q]].owner !== f.owner)) { log(g, FIGS[f.fid].name + ' lands on the goal but is surrounded!'); koFigure(g, f); return; }
  finish(g, f.owner, g.players[f.owner].name + ' reached the goal with ' + FIGS[f.fid].name + '!', f.fid);
}
function resolveTasks(g) {
  while (g.tasks.length) {
    const t = g.tasks[0]; const opts = taskOptions(g, t);
    if (!opts.length) { g.tasks.shift(); continue; }
    if (t.kind === 'pickFx' && t.optional && g.players[t.seat].bot) { g.tasks.shift(); if (t.botRule === 'lele' && g.players[t.seat].plates.filter(x => x.used).length >= 2) applyTask(g, t, opts[0]); continue; }
    if ((opts.length === 1 && !t.optional) || g.players[t.seat].bot) { g.tasks.shift(); applyTask(g, t, (t.kind === 'self' || t.kind === 'moveOther') ? bestForward(g, t.seat, opts.slice()) : opts[0]); continue; }
    g.phase = 'choose'; g.pending = { task: t, options: opts }; return false;
  }
  g.phase = g.over ? 'over' : 'main'; g.pending = null; return true;
}

// ------------------------------------------------------------------ actions
function apply(g, seat, act) {
  if (g.over) return { error: 'Game over.' };
  if (act.t === 'choose') {
    if (g.phase !== 'choose' || g.pending.task.seat !== seat) return { error: 'Nothing to choose.' };
    const t = g.pending.task; if (act.to != null && !g.pending.options.includes(act.to)) return { error: 'Illegal point.' };
    if (t.kind === 'evade') { g.phase = 'main'; g.pending = null; if (act.to != null) { applyEvade(g, t, act.to); return afterBattle(g); } return runBattle(g, t.attacker, t.uid, t.z); }
    g.tasks.shift(); if (act.to != null) applyTask(g, t, act.to);
    if (!resolveTasks(g)) return { ok: true }; return afterBattle(g);
  }
  if (g.phase === 'choose') return { error: 'Waiting for a point to be chosen.' };
  if (act.t === 'resign' && !g.over) { finish(g, 1 - seat, g.players[seat].name + ' resigned.'); return { ok: true }; }
  if (seat !== g.cur) return { error: 'Not your turn.' };
  if (act.t === 'resign') { finish(g, 1 - seat, g.players[seat].name + ' resigned.'); return { ok: true }; }
  if (act.t === 'loyalty') {
    if (g.phase !== 'main' || g.moved) return { error: 'Not now.' }; const f = fig(g, act.uid); if (!f || f.owner !== seat || f.loc !== 'field' || !hasRule(f, 'loyalty')) return { error: 'That Pokémon cannot use Loyalty.' };
    toBench(g, f); f.wait = 0; f.canActAtTurnStart = true; log(g, g.players[seat].name + ' returns ' + FIGS[f.fid].name + ' to the bench with Loyalty – it can be used right away.'); return { ok: true };
  }
  if (act.t === 'plate') {
    if (g.phase !== 'main') return { error: 'Not now.' };
    const e = usePlate(g, act.idx, act.a, act.b); return e ? { error: e } : { ok: true };
  }
  if (act.t === 'move') {
    if (g.phase !== 'main' || g.moved) return { error: 'You already moved.' };
    const f = fig(g, act.uid); if (!f || f.owner !== seat) return { error: 'Not your Pokémon.' };
    if (!canMove(g, f)) return { error: 'That Pokémon cannot move.' };
    const r = reach(g, f); const alt = !r[act.to] ? altReach(g, f)[act.to] : false; if (!r[act.to] && !alt) return { error: 'Illegal destination.' };
    g.moved = true; g.players[seat].plateLockNow = true;
    if (hasRule(f, 'hypnoticVoice')) { g.players[1 - seat].plateLock = true; log(g, FIGS[f.fid].name + '’s Hypnotic Voice: the opponent cannot use plates next turn.'); }
    const wasBench = f.loc === 'bench';
    if (alt && g.occ[act.to] && g.occ[act.to] !== f.uid) { const o = g.figs[g.occ[act.to]]; const a1 = f.pos, b1 = o.pos; g.occ[a1] = o.uid; g.occ[b1] = f.uid; f.pos = b1; o.pos = a1; log(g, `${g.players[seat].name} uses ${FIGS[f.fid].name}'s Electroswap – ${FIGS[f.fid].name} and ${FIGS[o.fid].name} switch places.`); surroundCheck(g, 0); surroundCheck(g, 1); return afterBattle(g); }
    const fromPos = f.pos; if (act.to !== f.pos) { f.loc = 'field'; setPos(g, f, act.to); }
    if (act.to !== fromPos && f.mpMark > 0) { log(g, FIGS[f.fid].name + ' moves and shakes off its MP-' + f.mpMark + ' marker.'); f.mpMark = 0; }
    if (act.to !== fromPos && (hasSt(f, 'poisoned') || hasSt(f, 'noxious'))) { const was = hasSt(f, 'noxious') ? 'noxious' : 'poisoned'; f.st = f.st.filter(x => x !== 'poisoned' && x !== 'noxious'); log(g, FIGS[f.fid].name + ' moves and is cured of being ' + was + '.'); }
    if (alt) { const rr = rulesOf(f).find(x => x.k === 'altMove'); if (rr && rr.battled) f.battled = true; log(g, `${g.players[seat].name} uses ${FIGS[f.fid].name}'s special move – the turn ends.`); surroundCheck(g, seat); return afterBattle(g); }
    if (act.to === B.GOALS[seat] && !hasRule(f, 'noSurround') && B.ADJ[act.to].length && B.ADJ[act.to].every(q => g.occ[q] && g.figs[g.occ[q]].owner !== seat)) { log(g, FIGS[f.fid].name + ' lands on the goal but is surrounded!'); koFigure(g, f); surroundCheck(g, seat); return afterBattle(g); }
    if (act.to === B.GOALS[seat] && !hasRule(f, 'noGoalWin')) { finish(g, seat, g.players[seat].name + ' reached the goal with ' + FIGS[f.fid].name + '!', f.fid); return { ok: true }; }
    log(g, `${g.players[seat].name} ${act.to === f.pos && !wasBench ? 'attacks with' : 'moves'} ${FIGS[f.fid].name}${wasBench ? ' onto the field' : ''}.`);
    if (wasBench) { f.battled = false; if (FIGS[f.fid].flags.cureOnEntry || hasRule(f, 'cureOnEntry')) onField(g, seat).forEach(x => (x.st = [])); if (hasRule(f, 'clearWaitOnEntry')) onField(g, seat).forEach(x => { x.wait = 0; x.canActAtTurnStart = true; }); }
    surroundCheck(g, seat); surroundCheck(g, 1 - seat);
    if (f.loc !== 'field') return afterBattle(g);
    tagAllies(g, f);
    const foes = tagBlocked(g, f) ? [] : neighborsEnemy(g, f).filter(x => !tagBlocked(g, x));
    if (!foes.length) { return afterBattle(g); }
    g.zChoice = act.z || null;
    if (foes.length === 1) { return startBattle(g, f.uid, foes[0].uid, act.z); }
    g.phase = 'battleChoice'; g.pending = { attacker: f.uid, targets: foes.map(x => x.uid), z: act.z }; return { ok: true };
  }
  if (act.t === 'battle') {
    if (g.phase !== 'battleChoice') return { error: 'No battle pending.' };
    if (!g.pending.targets.includes(act.target)) return { error: 'Invalid target.' };
    const at = g.pending.attacker, z = g.pending.z; g.phase = 'main'; g.pending = null; return startBattle(g, at, act.target, z);
  }
  return { error: 'Unknown action.' };
}
function estimate(g, a, d, zColor) {
  const aw = buildWheel(g, a, d, zColor || null), dw = buildWheel(g, d, a, null);
  if (hasSt(d, 'asleep') || hasSt(d, 'frozen')) dw.forEach(s => { s.color = 'Red'; s.dmg = { kind: 'none', n: 0 }; s.ops = []; s.isMiss = true; });
  const ta = aw.reduce((x, s) => x + s.size, 0), td = dw.reduce((x, s) => x + s.size, 0); let pKOd = 0, pKOa = 0;
  const dm = s => (s.dmg.kind === 'num' ? s.dmg.n : s.dmg.kind === 'mult' ? s.dmg.n * 1.4 : s.dmg.kind === 'plus' ? s.dmg.n + 15 : 0);
  for (const sa of aw) for (const sd of dw) {
    const p = (sa.size / ta) * (sd.size / td); const ar = { seg: sa, color: sa.color, dmg: dm(sa) }, dr = { seg: sd, color: sd.color, dmg: dm(sd) };
    ar.dmg = modDamage(g, a, d, ar); dr.dmg = modDamage(g, d, a, dr); const o = outcome(ar, dr); if (o.dKO) pKOd += p; if (o.aKO) pKOa += p;
  }
  return { pKOd, pKOa };
}
function startBattle(g, a, d, z) {
  const D = g.figs[d], A0 = g.figs[a];
  if (A0 && A0.charge && D && D.loc === 'field') {
    const st = A0.charge.st; A0.charge = null; log(g, FIGS[A0.fid].name + ' releases its Charge! ' + FIGS[D.fid].name + ' and the Pokémon behind it become ' + st + '.');
    const line = [D]; let prev = A0.pos, cur2 = D.pos; for (let i = 0; i < 6; i++) { const nx = B.beyond(prev, cur2); if (!nx || !g.occ[nx]) break; const y = g.figs[g.occ[nx]]; if (y !== A0) line.push(y); prev = cur2; cur2 = nx; }
    line.forEach(x => applyStatus(g, x, st, A0)); return afterBattle(g);
  }
  if (D && D.loc === 'field' && hasRule(D, 'evade') && !hasSt(D, 'asleep') && !hasSt(D, 'frozen')) {
    const rule = rulesOf(D).find(r => r.k === 'evade'); const task = { kind: 'evade', seat: D.owner, uid: d, attacker: a, n: rule.n, mode: rule.mode, z };
    const opts = taskOptions(g, task);
    if (opts.length) {
      if (g.players[D.owner].bot) { if (Math.random() < 0.4) { applyEvade(g, task, opts[(Math.random() * opts.length) | 0]); return afterBattle(g); } }
      else { g.phase = 'choose'; g.pending = { task, options: opts }; return { ok: true }; }
    }
  }
  return runBattle(g, a, d, z);
}
function applyEvade(g, t, to) { const D = g.figs[t.uid]; if (t.mode === 'bench' && D && D.loc === 'field') { toBench(g, D); addWait(g, D, 1); log(g, FIGS[D.fid].name + ' runs away to the bench and must Wait.'); return; } if (!D || D.loc !== 'field' || g.occ[to]) return; setPos(g, D, to); addWait(g, D, 1); log(g, FIGS[D.fid].name + ' uses Surprise Back and retreats without battling.'); surroundCheck(g, D.owner); }
function runBattle(g, a, d, z) {
  const res = battle(g, a, d, z);
  if (g.over) return { ok: true, battle: res };
  if (!resolveTasks(g)) return { ok: true, battle: res };
  const r = afterBattle(g); r.battle = res; return r;
}
function afterBattle(g) {
  if (g.over) return { ok: true };
  // loss check: a side with no figure that could ever act? (everyone removed)
  for (const s of [0, 1]) if (own(g, s).every(f => f.loc === 'removed')) { finish(g, 1 - s, g.players[s].name + ' has no Pokémon left.'); return { ok: true }; }
  endTurn(g); return { ok: true };
}
function timeout(g, seat) { if (!g.over) finish(g, 1 - seat, g.players[seat].name + ' ran out of time.'); }

// ------------------------------------------------------------------ view
function pubFig(g, f, seat) {
  const d = FIGS[f.fid];
  const hide = f.owner !== seat && f.loc === 'bench';
  if (hide) return { uid: f.uid, owner: f.owner, loc: 'bench', hidden: true };
  return { uid: f.uid, fid: f.fid, owner: f.owner, loc: f.loc, pos: f.pos, wait: f.wait, st: f.st, mp: (f.loc === 'field' || f.loc === 'bench') ? baseMp(g, f) : 0, mpMark: f.mpMark, cracked: f.cracked, curse: f.curse, focus: f.owner === seat ? f.focus : undefined, ret: f.returnIn };
}
function view(g, seat) {
  const mine = g.phase === 'choose' ? g.pending.task.seat === seat : seat === g.cur;
  const L = mine ? legal(g) : { moves: {}, plates: [], battle: null };
  const plateInfo = g.players[seat].plates.map((p, i) => ({ idx: i, key: p.key, used: p.used, targets: p.used ? null : plateTargets(g, i) }));
  return {
    seat, turn: g.turn, cur: g.cur, phase: g.phase, moved: g.moved, over: g.over, winner: g.winner, reason: g.reason, endFid: g.endFid || null,
    players: g.players.map((p, i) => ({ name: p.name, kos: p.kos || 0, bot: !!p.bot, gauge: p.gauge, clock: p.clock, pc: p.pc, platesLeft: p.plates.filter(x => !x.used).length, usedPlates: p.plates.filter(x => x.used).map(x => x.key), ownPlates: i === seat ? plateInfo : undefined })),
    figs: Object.values(g.figs).map(f => pubFig(g, f, seat)),
    legal: mine ? { moves: L.moves, plates: L.plates, battle: L.battle, choose: L.choose || null } : null,
    lastBattle: g.lastBattle || null, plateEv: g.plateEv || null,
    log: g.log.slice(-40),
    lockedGoal: g.lockedGoal,
  };
}

module.exports = { estimate, altReach, reach, _t: { taskOptions, buildWheel, goalCheck, outcome, resolveTasks, runOps, tagAllies, tagBlocked, applyStatus, baseMp, modDamage, buildWheel, reach, koFigure, addWait, setPos, surroundCheck, startTurn, countPer }, newGame, apply, view, legal, validateDeck, timeout, MAX_COST, GAUGE_FULL };
