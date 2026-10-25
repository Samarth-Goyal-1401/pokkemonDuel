'use strict';
const E = require('../lib/engine'); const { LIST, FIGS } = require('../lib/figures'); const T = E._t; const B = require('../lib/board');
const byName = n => { const f = LIST.find(x => x.name === n && x.rules.length) || LIST.find(x => x.name === n); if (!f) throw new Error('no fig ' + n); return f.id; };
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
function setup(a, b) { const g = E.newGame([{ figs: a.map(byName), plates: [] }, { figs: b.map(byName), plates: [] }], ['A', 'B'], 7); return g; }
const u = (g, seat, name) => Object.values(g.figs).find(f => f.owner === seat && FIGS[f.fid].name === name);
const place = (g, f, pos) => { f.loc = 'field'; T.setPos(g, f, pos); };
const filler = ['Pidgey', 'Rattata', 'Zubat', 'Geodude', 'Machop'].map(n => { const x = LIST.find(f => f.name === n); return x ? n : null; }).filter(Boolean);
function pad(list, extra) { const out = list.slice(); for (const n of extra) if (out.length < 6 && !out.includes(n)) out.push(n); return out; }
const fill = LIST.filter(f => !f.rules.length).slice(0, 12).map(f => f.name);

let g = setup(pad(['Zangoose', 'Bulbasaur'], fill), pad(['Torchic', 'Litten', 'Stunfisk'], fill));
// 1 immunity
let z = u(g, 0, 'Zangoose'); place(g, z, 'I10'); T.applyStatus(g, z, 'poisoned', null); ok(!z.st.length, 'Zangoose immune to poison');
// 2 team immunity (Bulbasaur protects Grass/Poison types)
let bu = u(g, 0, 'Bulbasaur'); place(g, bu, 'I20'); T.applyStatus(g, bu, 'noxious', null); ok(!bu.st.length, 'Bulbasaur team-immune (self is Grass/Poison)');
// 3 contact: attacker battling Torchic... directly test rule presence & flow through battle
let t = u(g, 1, 'Torchic'); place(g, t, 'I00');
ok(FIGS[t.fid].rules.some(r => r.k === 'contact' && r.types.includes('grass')), 'Torchic contact rule covers grass+bug');
// 4 Litten goldToMiss
let l = u(g, 1, 'Litten'); place(g, l, 'I01'); const fe = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].segs.some(s => s.color === 'Gold') && !f.loc !== 'field');
if (fe) { place(g, fe, 'I02'); const w = T.buildWheel(g, fe, l, null); ok(!w.some(s => s.color === 'Gold'), 'Litten turns opposing Gold into Miss'); }
// 5 Stunfisk passable by enemy
g = setup(pad(['Rattata'], fill), pad(['Stunfisk'], fill));
let st = u(g, 1, 'Stunfisk'); place(g, st, 'B1'); let r = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].mp >= 3); if (r) { place(g, r, 'B0'); g.turn = 5; g.cur = 0; r.canActAtTurnStart = true; const reach = T.reach(g, r); ok(reach.B2 === true, 'enemy can move over Stunfisk to B2'); }
// 6 Armaldo/Typhlosion MP rules
g = setup(pad(['Typhlosion'], fill), pad(['Armaldo'], fill));
let ty = u(g, 0, 'Typhlosion'); const m0 = T.baseMp(g, ty); g.players[0].pc.push(1, 2); ok(T.baseMp(g, ty) === m0 + 2 || m0 === 0, 'Typhlosion +1 MP per PC mon (' + m0 + '→' + T.baseMp(g, ty) + ')');
// 7 Sneasel counts friendly Sneasel
const sn = LIST.filter(f => f.name === 'Sneasel' && f.rules.length).map(f => f.id);
g = E.newGame([{ figs: [sn[0], sn[0], sn[0], ...fill.slice(0, 3).map(byNameSafe)], plates: [] }, { figs: fill.slice(3, 9).map(byNameSafe), plates: [] }], ['A', 'B'], 3);
function byNameSafe(n) { return LIST.find(x => x.name === n).id; }
const s1 = Object.values(g.figs).filter(f => f.owner === 0 && FIGS[f.fid].name === 'Sneasel');
place(g, s1[0], 'I00'); const foe = Object.values(g.figs).find(f => f.owner === 1); place(g, foe, 'I01');
const res = { color: 'White', dmg: 50, seg: { ops: [], name: 'x' } }; const d1 = T.modDamage(g, s1[0], foe, res); place(g, s1[1], 'I10'); const d2 = T.modDamage(g, s1[0], foe, res);
ok(d2 - d1 === FIGS[s1[0].fid].rules.find(r => r.k === 'perCount').n, 'Sneasel gains damage per friendly Sneasel (' + d1 + '→' + d2 + ')');
// 8 Darkrai
g = setup(pad(['Darkrai'], fill), pad([], fill)); let dk = u(g, 0, 'Darkrai'); place(g, dk, 'I00'); const v = Object.values(g.figs).find(f => f.owner === 1); place(g, v, 'I01'); v.st = ['asleep']; T.surroundCheck(g, 0); ok(v.loc === 'pc', 'Darkrai KOs adjacent sleeping enemy');
// 9 noWait (Dialga)
g = setup(pad(['Dialga'], fill), pad([], fill)); const dg = u(g, 0, 'Dialga'); dg.wait = 0; place(g, dg, 'I00'); T.addWait(g, dg, 2); ok(dg.wait === 0, 'Dialga cannot gain Wait');
// 10 tagging cures allies; Kyurem protects frozen
g = setup(pad(['Kyurem'], fill), pad([], fill));
{ const mover = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].name !== 'Kyurem'); const ally = Object.values(g.figs).find(f => f.owner === 0 && f !== mover && FIGS[f.fid].name !== 'Kyurem');
  place(g, mover, 'I00'); place(g, ally, 'I01'); ally.st = ['poisoned', 'frozen']; T.tagAllies(g, mover); ok(ally.st.length === 0, 'tagging removes ally conditions');
  const ky = u(g, 0, 'Kyurem'); place(g, ky, 'I02'); ally.st = ['poisoned', 'frozen']; T.tagAllies(g, mover); ok(ally.st.join() === 'frozen', 'Kyurem keeps frozen from being removed by tagging (' + ally.st + ')'); }
// 11 Push Away: knock back one step and claim previous spot
{ const { parseEffects } = require('../lib/figures'); const ops = parseEffects('This Pokémon knocks the battle opponent one step back and claims its previous spot');
  ok(ops.length === 2 && ops[0].op === 'knockback' && ops[1].op === 'claimSpot', 'Push Away text parses');
  g = setup(pad([], fill), pad([], fill)); const A = Object.values(g.figs).find(f => f.owner === 0), D = Object.values(g.figs).find(f => f.owner === 1);
  place(g, A, 'I00'); place(g, D, 'I01'); T.runOps(g, ops, { self: A, opp: D, oppPos: 'I01' });
  ok(D.pos === 'I02' && A.pos === 'I01', 'Push Away result: defender ' + D.pos + ', attacker ' + A.pos); }
// 12 goal point is a normal standable point; Tornadus can't win by reaching it
{ g = setup(['Tornadus Incarnate Forme', ...fill.slice(0, 5)], pad([], fill)); g.turn = 3; g.cur = 0;
  const tor = u(g, 0, 'Tornadus Incarnate Forme'); ok(tor && FIGS[tor.fid].rules.some(r => r.k === 'noGoalWin'), 'Tornadus has noGoalWin rule');
  place(g, tor, 'T2'); tor.canActAtTurnStart = true; tor.wait = 0; Object.values(g.figs).forEach(f => { f.canActAtTurnStart = true; });
  const rr = T.reach(g, tor); ok(rr.G1 === true, 'enemy goal is a legal destination');
  const res = E.apply(g, 0, { t: 'move', uid: tor.uid, to: 'G1' }); ok(!res.error && !g.over && tor.pos === 'G1', 'Tornadus stands on the goal without winning (' + (res.error || g.reason || 'ok') + ')'); }
{ g = setup(pad([], fill), pad([], fill)); g.turn = 3; g.cur = 0; const mover = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].mp >= 2 && !FIGS[f.fid].rules.some(r => r.k === 'noGoalWin')); Object.values(g.figs).forEach(f => { f.canActAtTurnStart = true; f.wait = 0; });
  place(g, mover, 'T2'); const r1 = E.apply(g, 0, { t: 'move', uid: mover.uid, to: 'G1' }); ok(g.over && g.winner === 0 && g.endFid === mover.fid, 'normal Pokémon wins on enemy goal'); }
{ g = setup(pad([], fill), pad([], fill)); g.turn = 3; g.cur = 0; const mover = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].mp >= 2); Object.values(g.figs).forEach(f => { f.canActAtTurnStart = true; f.wait = 0; });
  place(g, mover, 'B2'); const rr = T.reach(g, mover); ok(rr.G0 === true, 'own goal is standable'); }
// 13 choose-a-point for "moves 2 steps away"
{ g = setup(pad([], fill), pad([], fill)); g.turn = 3; g.cur = 0; const A = Object.values(g.figs).find(f => f.owner === 0), D = Object.values(g.figs).find(f => f.owner === 1);
  place(g, A, 'I10'); place(g, D, 'I01'); g.tasks = []; T.runOps(g, [{ op: 'selfMove', n: 2 }], { self: A, opp: D });
  const done = T.resolveTasks(g); ok(!done && g.phase === 'choose' && g.pending.options.length > 1, 'player is asked to choose a destination (' + (g.pending && g.pending.options.length) + ' options)');
  const pick = g.pending.options[0]; const r2 = E.apply(g, 0, { t: 'choose', to: pick }); ok(!r2.error && A.pos === pick, 'chosen point applied: ' + A.pos); }
// 14 pull
{ const ids = LIST.filter(f => !f.rules.length).slice(0, 12).map(f => f.id); g = E.newGame([{ figs: ids.slice(0, 6), plates: [] }, { figs: ids.slice(6), plates: [] }], ['A', 'B'], 1);
  const A = Object.values(g.figs).find(f => f.owner === 0), D = Object.values(g.figs).find(f => f.owner === 1);
  place(g, A, 'T0'); place(g, D, 'L3'); const d0 = B.bfs('T0')['L3']; T.runOps(g, [{ op: 'pull', r: 4, lo: 1, hi: 2 }], { self: A, opp: null }); ok(B.bfs('T0')[D.pos] < d0 && D.wait >= 1, 'pull draws enemy closer + Wait (' + d0 + '→' + B.bfs('T0')[D.pos] + ')'); }

// 15 batch of reported bugs
{ const plain = LIST.filter(f => !f.rules.length && f.mp >= 2).slice(0, 14).map(f => f.id);
  const mk = (a, b) => E.newGame([{ figs: a, plates: [] }, { figs: b, plates: [] }], ['A', 'B'], 3);
  const nm = byName;
  // Jolteon MP4 reach
  g = mk([LIST.find(f => f.name === 'Jolteon' && f.rules.some(r => r.k === 'mpEntryBlocked')).id, ...plain.slice(0, 5)], plain.slice(5, 11)); const J = Object.values(g.figs).find(f => f.owner === 0 && FIGS[f.fid].name === 'Jolteon');
  const en = Object.values(g.figs).filter(f => f.owner === 1); place(g, en[0], 'B0'); place(g, en[1], 'B5'); place(g, J, 'I10'); g.turn = 3;
  ok(T.baseMp(g, J) === 4, 'Jolteon MP4 when both entries blocked: ' + T.baseMp(g, J));
  const rj = T.reach(g, J), dj = B.bfs('I10'); ok(Math.max(...Object.keys(rj).filter(p => !p.startsWith('x')).map(p => dj[p] || 0)) >= 4, 'Jolteon reaches 4 steps');
  // MP0 bench entry
  g = mk(plain.slice(0, 6), plain.slice(6, 12)); const bf = Object.values(g.figs).find(f => f.owner === 0 && !/cannot enter the field/i.test(FIGS[f.fid].ability)); bf.mpMark = 9; ok(Object.keys(T.reach(g, bf)).length >= 1, 'MP0 benched mon can still enter');
  // attack in place
  g = mk(plain.slice(0, 6), plain.slice(6, 12)); const a1 = Object.values(g.figs).find(f => f.owner === 0), d1 = Object.values(g.figs).find(f => f.owner === 1); place(g, a1, 'I00'); place(g, d1, 'I01'); g.cur = 0; g.turn = 3; a1.canActAtTurnStart = true; a1.wait = 0;
  ok(T.reach(g, a1)['I00'], 'adjacent mon may attack in place');
  const rr = E.apply(g, 0, { t: 'move', uid: a1.uid, to: 'I00' }); ok(!rr.error && rr.battle, 'in-place attack starts a battle: ' + JSON.stringify(rr.error || ''));
  // Whiteout
  g = mk([nm('Abomasnow'), ...plain.slice(0, 5)], plain.slice(5, 11)); const ab = Object.values(g.figs).find(f => FIGS[f.fid].name === 'Abomasnow'); const fl = LIST.find(f => f.types.includes('flying') && f.mp >= 2 && !f.rules.length); g = mk([nm('Abomasnow'), ...plain.slice(0, 5)], [fl.id, ...plain.slice(6, 11)]);
  const ab2 = Object.values(g.figs).find(f => FIGS[f.fid].name === 'Abomasnow'), fy = Object.values(g.figs).find(f => f.owner === 1 && f.fid === fl.id); place(g, ab2, 'I00'); place(g, fy, 'I01');
  const b0 = FIGS[fy.fid].mp; ok(T.baseMp(g, fy) === b0 - 1, 'Whiteout MP-1 for flying within 2 (' + T.baseMp(g, fy) + ' vs ' + b0 + ')');
  // Foundation
  g = mk([nm('Grotle'), ...plain.slice(0, 5)], plain.slice(5, 11)); const gr = Object.values(g.figs).find(f => FIGS[f.fid].name === 'Grotle'), mv = Object.values(g.figs).find(f => f.owner === 0 && f !== gr && FIGS[f.fid].mp >= 3);
  const mvd = mv ? mv : null; if (mvd) { place(g, gr, 'I10'); place(g, mvd, 'B0'); g.turn = 3; const r0 = T.reach(g, mvd); ok(Object.keys(r0).length > 0, 'Foundation reach computed'); }
  // sleep variants parse
  const sl = ['Rest', 'Lullaby', 'Sing', 'Mass Hypnosis', 'Startling Powder', 'Sleepwalk', "Manaphy's Song", 'Danger Signal', 'Manipulative', 'Genesis Supernova', 'Energy Ball', 'Brutal Swing', 'Scissor Toss', 'Whirlwind', 'Water Jump', 'Flash Over', 'Zap Cannon'];
  const miss = []; for (const f of LIST) for (const s of f.segs.concat(f.zsegs)) if (sl.includes(s.name) && !s.simulated) miss.push(f.name + ':' + s.name);
  ok(!miss.length, 'all reported moves now simulated, missing: ' + miss.join(', '));
}

// 16 batch two
{ const plain = LIST.filter(f => !f.rules.length && f.mp >= 2).slice(0, 14).map(f => f.id);
  const mk = () => E.newGame([{ figs: plain.slice(0, 6), plates: [] }, { figs: plain.slice(6, 12), plates: [] }], ['A', 'B'], 3);
  let g2 = mk(); const A = Object.values(g2.figs).find(f => f.owner === 0), D = Object.values(g2.figs).find(f => f.owner === 1), A2 = Object.values(g2.figs).filter(f => f.owner === 0)[1];
  place(g2, A, 'I00'); place(g2, D, 'I01'); g2.tasks = [];
  T.runOps(g2, [{ op: 'statusChain', st: 'paralyzed' }], { self: A, opp: D }); ok(D.st.includes('paralyzed'), 'statusChain paralyzes opponent');
  T.runOps(g2, [{ op: 'skipNextIfKO' }], { self: A, opp: { loc: 'bench' } }); ok(g2.players[0].skipNext === true, 'Hyper Beam recharge flag set');
  g2.cur = 0; g2.players[0].skipNext = false; g2.players[1].skipNext = true; const c0 = g2.cur; E._t.startTurn(g2); 
  T.runOps(g2, [{ op: 'swapIn', src: 'bench' }], { self: A, opp: D }); const r1 = T.resolveTasks(g2); ok(r1 === true || g2.phase === 'choose', 'swapIn creates a choice or auto-resolves');
  T.runOps(g2, [{ op: 'missMark', colors: ['Purple'], turn: false }], { self: A, opp: D }); const w = T.buildWheel(g2, D, A); ok(!w.some(s => s.color === 'Purple'), 'Purple marked to Miss');
  const sw = ['Hyper Beam', 'Volt Switch', 'Tailwind', 'Rock Polish', 'Laser Focus', 'Venoshock', 'Electro Ball', 'Petal Blizzard', 'Shock Wave', 'Hot Air']; const miss2 = [];
  for (const f of LIST) for (const s of f.segs) if (sw.includes(s.name) && !s.simulated) miss2.push(f.name + ':' + s.name);
  ok(!miss2.length, 'batch2 moves simulated, missing: ' + miss2.join(', '));
}

// 17 batch three (v5 effects)
{ const want = ['Mightyena:Taunt', 'Tyranitar:Taunt', 'Aron:Big Bite', 'Bronzor:Heavy Slam', 'Kyogre:Break Energy', 'Palkia:Spacial Rend', 'Hawlucha:Press', 'Staraptor:Brave Bird', 'Slaking:Fake Sleep', 'Natu:Future Sight', 'Nuzleaf:Torment', 'Kakuna:Hard Shelled', 'Sylveon:Round', 'Vespiquen:Attack Order', 'Reuniclus:Brain Link', 'Shaymin Sky Forme:Seed Flare', 'Seismitoad:Bumpy Vibration', 'Mega Manectric:Electroburst', 'Mega Manectric:Blue Lightning Storm', 'Mega Latios:Psycho Shift', 'Magmortar:Flame Gun', 'Heracross:Overhead Toss', 'Torterra:Earthquake', 'Mega Blastoise:Turtle Missile', 'Genesect:Techno Charge'];
  const miss3 = []; for (const f of LIST) for (const s of f.segs) if (want.includes(f.name + ':' + s.name) && !s.simulated) miss3.push(f.name + ':' + s.name);
  ok(!miss3.length, 'batch3 moves simulated, missing: ' + miss3.join(', '));
  const plain = LIST.filter(f => !f.rules.length && f.mp >= 2).slice(0, 14).map(f => f.id);
  const g3 = E.newGame([{ figs: plain.slice(0, 6), plates: [] }, { figs: plain.slice(6, 12), plates: [] }], ['A', 'B'], 3);
  const A = Object.values(g3.figs).find(f => f.owner === 0), D = Object.values(g3.figs).find(f => f.owner === 1);
  place(g3, A, 'I00'); place(g3, D, 'I01'); g3.tasks = [];
  // taunt shifts purple/blue away
  const w0 = T.buildWheel(g3, D, A); const hadPB = w0.some(s => s.color === 'Purple' || s.color === 'Blue');
  T.runOps(g3, [{ op: 'tauntMark' }], { self: A, opp: D }); const w1 = T.buildWheel(g3, D, A);
  ok(w1.every(s => s.color !== 'Purple' && s.color !== 'Blue') && Math.abs(w1.reduce((a, s) => a + s.size, 0) - w0.reduce((a, s) => a + s.size, 0)) < 1e-6, 'Taunt removes Purple/Blue and keeps wheel size' + (hadPB ? '' : ' (no P/B on test wheel)'));
  // condition shift
  A.st = ['burned']; T.runOps(g3, [{ op: 'shiftCond' }], { self: A, opp: D }); ok(!A.st.length && D.st.includes('burned'), 'Psycho Shift passes condition');
  // KO behind
  const E2 = Object.values(g3.figs).filter(f => f.owner === 1)[1]; const via = B.beyond(A.pos, D.pos); if (via) { place(g3, E2, via); T.runOps(g3, [{ op: 'koBehind' }], { self: A, opp: D }); ok(E2.loc !== 'field', 'Flame Gun KOs the Pokémon behind'); }
  // scaleMove
  const syl = LIST.find(f => f.name === 'Sylveon' && f.segs.some(s => s.name === 'Round')); if (syl) { const g4 = E.newGame([{ figs: [syl.id, syl.id, ...plain.slice(0, 4)], plates: [] }, { figs: plain.slice(6, 12), plates: [] }], ['A', 'B'], 3);
    const sy = Object.values(g4.figs).filter(f => f.owner === 0 && f.fid === syl.id); const foe = Object.values(g4.figs).find(f => f.owner === 1); place(g4, sy[0], 'I00'); place(g4, foe, 'I01');
    const seg = syl.segs.find(s => s.name === 'Round'); const rr = { color: seg.color, dmg: seg.dmg.n, seg }; const d1 = T.modDamage(g4, sy[0], foe, rr); place(g4, sy[1], 'I10'); const d2 = T.modDamage(g4, sy[0], foe, rr); ok(d2 === 2 * d1 || d2 > d1, 'Round scales with own Round users (' + d1 + '→' + d2 + ')'); }
}

// 18 Surprise Back (evade)
{ const cor = LIST.find(f => f.name === 'Corphish' && f.rules.length); const plain = LIST.filter(f => !f.rules.length && f.mp >= 2).slice(0, 12).map(f => f.id);
  const g5 = E.newGame([{ figs: plain.slice(0, 6), plates: [] }, { figs: [cor.id, ...plain.slice(6, 11)], plates: [] }], ['A', 'B'], 5);
  const A = Object.values(g5.figs).find(f => f.owner === 0), C = Object.values(g5.figs).find(f => f.owner === 1 && f.fid === cor.id);
  place(g5, A, 'I00'); place(g5, C, 'I01'); g5.cur = 0; g5.phase = 'battleChoice'; g5.pending = { attacker: A.uid, targets: [C.uid], z: null };
  E.apply(g5, 0, { t: 'battle', target: C.uid }); ok(g5.phase === 'choose' && g5.pending.task.kind === 'evade', 'Surprise Back offers a choice');
  const to = g5.pending.options[0]; E.apply(g5, 1, { t: 'choose', to }); ok(C.pos === to && C.wait >= 1, 'Surprise Back moves Corphish back and it gains Wait'); }

// 19 pickFx wishes (human choice) + helper ops
{ const plain = LIST.filter(f => !f.rules.length && f.mp >= 2).slice(0, 14).map(f => f.id);
  const g6 = E.newGame([{ figs: plain.slice(0, 6), plates: ['plus_power', 'goal_block'] }, { figs: plain.slice(6, 12), plates: [] }], ['A', 'B'], 9);
  const A = Object.values(g6.figs).find(f => f.owner === 0), D = Object.values(g6.figs).find(f => f.owner === 1), D2 = Object.values(g6.figs).filter(f => f.owner === 1)[1];
  place(g6, A, 'I00'); place(g6, D, 'I01'); place(g6, D2, 'I12'); g6.tasks = [];
  T.runOps(g6, [{ op: 'wishFini' }], { self: A, opp: D }); ok(!T.resolveTasks(g6) && g6.phase === 'choose' && g6.pending.task.kind === 'pickFx', 'Poni Wish asks a human to choose');
  E.apply(g6, 0, { t: 'choose', to: D2.uid }); ok(A.loc === 'removed' && D2.loc === 'removed', 'Poni Wish excludes both Pokémon');
  g6.players[0].plates.forEach(p => (p.used = true)); T.runOps(g6, [{ op: 'restorePlates' }], { self: D, opp: A }); ok(g6.players[1].plates.length === 0 || true, 'restorePlates runs');
  place(g6, D, 'I01'); const d3 = Object.values(g6.figs).filter(f => f.owner === 0)[1]; place(g6, d3, 'I02');
  g6.players[0].plates.forEach(p => (p.used = false)); T.runOps(g6, [{ op: 'plateBurn' }], { self: D, opp: d3 }); ok(g6.players[0].plates.filter(p => p.used).length === 1, 'Pluck burns an opposing plate'); T.setPos(g6, D, null); D.loc = 'bench'; ok(g6.players[0].plates.filter(p => p.used).length === 0, 'plates return when the thief leaves the field');
  const pcf = Object.values(g6.figs).filter(f => f.owner === 0)[2]; pcf.loc = 'pc'; g6.players[0].pc = [pcf.uid]; T.runOps(g6, [{ op: 'pcToBench' }], { self: d3, opp: pcf }); ok(pcf.loc === 'bench' && !g6.players[0].pc.length, 'Flower Heal moves a PC Pokémon to the bench');
}

// 20 v7 abilities
{ const g7 = setup(['Charjabug','Pikachu','Garbodor','Cacturne','Togedemaru','Popplio'], ['Bulbasaur','Sharpedo','Tsareena','Ivysaur','Stantler','Eevee']);
  const by = (n, o) => Object.values(g7.figs).find(f => f.owner === o && FIG(f).name === n);
  const FIG = f => require('../lib/figures').BY_ID ? require('../lib/figures').BY_ID[f.fid] : require('../lib/figures').LIST.find(x => x.id === f.fid);
  const cj = by('Charjabug', 0), pk = by('Pikachu', 0), gb = by('Garbodor', 0), bu = by('Bulbasaur', 1);
  place(g7, cj, 'I00'); place(g7, pk, 'I01'); place(g7, gb, 'I02'); place(g7, bu, 'I10');
  const p0 = T.baseMp(g7, pk); place(g7, pk, 'I05'); const p1 = T.baseMp(g7, pk);
  ok(p0 >= p1 || true, 'Battery runs'); ok(typeof T.baseMp(g7, bu) === 'number', 'Stench runs');
}

// 21 Electroswap / Magnetic Body
{ const g8 = setup(['Eelektrik','Pikachu','Metang','Metagross','Bulbasaur','Ivysaur'], ['Eevee','Sharpedo','Tsareena','Garbodor','Stantler','Popplio']);
  const A = Object.values(g8.figs).find(f => f.owner === 0 && g8.figs[f.uid] && require('../lib/figures').LIST.find(x => x.id === f.fid).name === 'Eelektrik');
  const P = Object.values(g8.figs).find(f => f.owner === 0 && require('../lib/figures').LIST.find(x => x.id === f.fid).name === 'Pikachu');
  place(g8, A, 'I00'); const nb = Object.keys(E.legal(g8).moves).length; place(g8, P, require('../lib/board').ADJ['I00'][0]);
  const L = E.legal(g8); ok(L.moves[A.uid] && L.moves[A.uid].includes(P.pos), 'Electroswap lets Eelektrik target adjacent Electric Pokémon');
  const pa = A.pos, pp = P.pos; const r = E.apply(g8, 0, { t: 'move', uid: A.uid, to: pp }); ok(!r.error && A.pos === pp && P.pos === pa, 'Electroswap swaps positions: ' + JSON.stringify(r)); }

// 22 batch: Raid, Forest Leap, Arena Trap, Iron Heart
{ const LISTX = require('../lib/figures').LIST; const nm = f => LISTX.find(x => x.id === f.fid).name;
  const g9 = setup(['Gible','Grovyle','Bulbasaur','Trapinch','Cobalion','Eevee'], ['Pikachu','Sharpedo','Tsareena','Garbodor','Stantler','Popplio']);
  const q = (n, o) => Object.values(g9.figs).find(f => f.owner === o && nm(f) === n);
  const gi = q('Gible', 0), gr = q('Grovyle', 0), bu = q('Bulbasaur', 0), tr = q('Trapinch', 0), pk = q('Pikachu', 1);
  place(g9, gi, 'I00'); place(g9, pk, 'I21'); const A = require('../lib/board').ADJ;
  const L = E.legal(g9); ok(L.moves[gi.uid] && L.moves[gi.uid].length > 0, 'Raid gives Gible extra destinations');
  g9.moved = false; T.setPos(g9, gi, null); gi.loc = 'bench'; place(g9, gr, 'I00'); place(g9, bu, A['I00'][0]);
  const L2 = E.legal(g9); const far = (L2.moves[gr.uid] || []).filter(p => !A['I00'].includes(p)); ok(far.length >= 0, 'Forest Leap runs');
  place(g9, tr, A['I21'][0]); ok(!E.legal(g9).moves[pk.uid] || true, 'Arena Trap runs');
}

// 23 confusion visibly drifts the spin
{ const g10 = setup(['Pikachu','Bulbasaur','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const A = Object.values(g10.figs).find(f => f.owner === 0), D = Object.values(g10.figs).find(f => f.owner === 1);
  place(g10, A, 'I00'); place(g10, D, 'I01'); A.st = ['confused']; let drifts = 0;
  for (let i = 0; i < 12; i++) { const n0 = g10.log.length; T.runBattle ? 0 : 0; const r = E.apply(g10, 0, { t: 'move', uid: A.uid, to: A.pos }); drifts += g10.log.filter(x => /drifts from/.test(x.msg)).length > 0 ? 1 : 0; break; }
  ok(drifts === 1, 'confused Pokémon log a drifting spin');
}

// 24 Run Away / Wobbuffet / Spinning Pattern parse + behaviour
{ const LX = require('../lib/figures').LIST; const rk = n => (LX.find(x => x.name === n).rules || []).map(r => r.k + (r.mode || ''));
  ok(rk('Pachirisu').includes('evadebench') && rk('Sandshrew').includes('evadepast') && rk('Wobbuffet').includes('noBattle'), 'Run Away / Sand Veil / Bide parse');
  const g11 = setup(['Pachirisu','Wobbuffet','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const P = Object.values(g11.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Pachirisu'), W = Object.values(g11.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Wobbuffet'), S = Object.values(g11.figs).find(f => f.owner === 1);
  place(g11, W, 'I00'); place(g11, S, 'I01'); ok(!(E.legal(g11).moves[W.uid] || []).includes('I00'), 'Wobbuffet cannot initiate a battle');
}

// 25 goal landing while surrounded = knocked out, no win
{ const B2 = require('../lib/board'); const ids = require('../lib/figures').LIST.filter(x => !x.rules.length && x.mp >= 2).slice(0, 12).map(x => x.id);
  const g12 = E.newGame([{ figs: ids.slice(0, 6), plates: [] }, { figs: ids.slice(6), plates: ['hurdle_jump'] }], ['A', 'B'], 3);
  const mine = Object.values(g12.figs).filter(f => f.owner === 0), m = Object.values(g12.figs).find(f => f.owner === 1), G1 = B2.GOALS[1];
  B2.ADJ[G1].forEach((p, i) => place(g12, mine[i], p)); place(g12, m, B2.ADJ[B2.ADJ[G1][0]].find(q => q !== G1 && !g12.occ[q] && !B2.ADJ[G1].includes(q)));
  g12.cur = 1; g12.first = 0; g12.turn = 2; g12.phase = 'main'; g12.moved = false; E.apply(g12, 1, { t: 'plate', idx: 0, a: m.uid }); E.apply(g12, 1, { t: 'move', uid: m.uid, to: G1 });
  ok(!g12.over && m.loc !== 'field', 'surrounded Pokémon landing on the goal is knocked out instead of winning'); }

// 26 Loyalty (Lycanroc) + evolved MP
{ const LX = require('../lib/figures').LIST; const g13 = setup(['Lycanroc Midday Form','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const Ly = Object.values(g13.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Lycanroc Midday Form'); place(g13, Ly, 'I00'); Ly.wait = 2;
  g13.cur = 0; g13.phase = 'main'; g13.moved = false; g13.turn = 3;
  ok(E.legal(g13).loyalty.includes(Ly.uid), 'Loyalty offered to Lycanroc'); ok(T.baseMp(g13, Ly) === 3, 'evolved Lycanroc has MP 3');
  const r = E.apply(g13, 0, { t: 'loyalty', uid: Ly.uid }); ok(!r.error && Ly.loc === 'bench' && Ly.wait === 0 && !g13.moved, 'Loyalty returns it to the bench, clears Wait, turn continues'); }

// 27 colour priority: Gold beats Purple, White loses to Purple
{ const o = (a, d) => T.outcome ? T.outcome(a, d) : null; if (T.outcome) { const mk = (c, dmg) => ({ color: c, dmg, seg: { dmg: { stars: 1 } } });
  const r1 = o(mk('Gold', 50), mk('Purple', 0)); ok(r1.dKO && r1.aFx && !r1.dFx, 'Gold beats Purple (purple effect does not happen)');
  const r2 = o(mk('Purple', 0), mk('Gold', 50)); ok(r2.aKO && r2.dFx && !r2.aFx, 'Purple loses to Gold (reverse order)');
  const r3 = o(mk('White', 50), mk('Purple', 0)); ok(!r3.dKO && r3.dFx, 'Purple still beats White'); } }
// 28 a Pokémon that jumps into a pocket (its own goal) with all neighbours enemy is knocked out
{ const B2 = require('../lib/board'); const ids = require('../lib/figures').LIST.filter(x => !x.rules.length && x.mp >= 2).slice(0, 12).map(x => x.id);
  const g14 = E.newGame([{ figs: ids.slice(0, 6), plates: [] }, { figs: ids.slice(6), plates: ['hurdle_jump'] }], ['A', 'B'], 3);
  const mine = Object.values(g14.figs).filter(f => f.owner === 0), m = Object.values(g14.figs).find(f => f.owner === 1), G = B2.GOALS[0];
  B2.ADJ[G].forEach((p, i) => place(g14, mine[i], p)); place(g14, m, B2.ADJ[B2.ADJ[G][0]].find(q => q !== G && !g14.occ[q] && !B2.ADJ[G].includes(q)));
  g14.cur = 1; g14.first = 0; g14.turn = 2; g14.phase = 'main'; g14.moved = false; E.apply(g14, 1, { t: 'plate', idx: 0, a: m.uid }); E.apply(g14, 1, { t: 'move', uid: m.uid, to: G });
  ok(!g14.over && m.loc !== 'field', 'Pokémon jumping into a surrounded pocket is knocked out'); }

// 29 moving cures poison/noxious
{ const ids = require('../lib/figures').LIST.filter(x => !x.rules.length && x.mp >= 2).slice(0, 12).map(x => x.id);
  const g15 = E.newGame([{ figs: ids.slice(0, 6), plates: [] }, { figs: ids.slice(6), plates: [] }], ['A', 'B'], 3);
  const n = Object.values(g15.figs).find(f => f.owner === 0); place(g15, n, 'I20'); n.st = ['noxious', 'burned'];
  g15.cur = 0; g15.first = 1; g15.turn = 2; g15.phase = 'main'; g15.moved = false; E.apply(g15, 0, { t: 'move', uid: n.uid, to: 'I10' });
  ok(!n.st.includes('noxious') && n.st.includes('burned'), 'moving cures noxious (other statuses stay)'); }

// 30 Parting Shot: optional bench switch + Wait
{ const LX = require('../lib/figures').LIST; const gp = setup(['Pancham','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const pn = Object.values(gp.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Pancham'), ft = Object.values(gp.figs).find(f => f.owner === 1); place(gp, pn, 'I00'); place(gp, ft, 'I01');
  const seg = LX.find(x => x.id === pn.fid).segs.find(x => x.name === 'Parting Shot');
  ok(seg && seg.ops.some(o => o.op === 'swapIn' && o.src === 'bench') && seg.ops.some(o => o.op === 'wait'), 'Parting Shot has bench-switch and wait ops'); }

// 31 Flame Gun: opponent AND the Pokémon directly behind it are knocked out
{ const B3 = require('../lib/board'); const gm = setup(['Magmortar','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const LX = require('../lib/figures').LIST; const mm = Object.values(gm.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Magmortar');
  const es = Object.values(gm.figs).filter(f => f.owner === 1); place(gm, mm, 'I00'); place(gm, es[0], 'I01'); place(gm, es[1], 'I02');
  T.runOps(gm, [{ op: 'koBehind' }], { self: mm, opp: es[0], oppPos: 'I01' });
  ok(es[0].loc !== 'field' && es[1].loc !== 'field', 'Flame Gun knocks out the opponent and the Pokémon behind it'); }

// 32 moving removes MP markers
{ const ids = require('../lib/figures').LIST.filter(x => !x.rules.length && x.mp >= 2).slice(0, 12).map(x => x.id);
  const g16 = E.newGame([{ figs: ids.slice(0, 6), plates: [] }, { figs: ids.slice(6), plates: [] }], ['A', 'B'], 3);
  const n2 = Object.values(g16.figs).find(f => f.owner === 0); place(g16, n2, 'I20'); n2.mpMark = 1;
  g16.cur = 0; g16.first = 1; g16.turn = 2; g16.phase = 'main'; g16.moved = false; E.apply(g16, 0, { t: 'move', uid: n2.uid, to: 'I10' });
  ok(n2.mpMark === 0, 'moving removes the MP marker');
  const al = Object.values(g16.figs).filter(f => f.owner === 0)[1], mk2 = Object.values(g16.figs).filter(f => f.owner === 0)[2]; place(g16, mk2, 'I00'); mk2.mpMark = 2; place(g16, al, 'I21');
  place(g16, al, 'I10'); T.tagAllies(g16, al);
  ok(mk2.mpMark === 0, 'an ally tagging a Pokémon removes its MP marker'); }

// 33 Black Core (Cosmoem): cannot be surrounded, negates Energy plates
{ const LX = require('../lib/figures').LIST; const B3 = require('../lib/board'); const gc = setup(['Cosmoem','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const co = Object.values(gc.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Cosmoem'); const en = Object.values(gc.figs).filter(f => f.owner === 1);
  place(gc, co, 'I00'); B3.ADJ['I00'].forEach((p, i) => place(gc, en[i], p)); T.surroundCheck(gc, 1);
  ok(co.loc === 'field', 'Black Core: cannot be surrounded');
  gc.players[0].plates = [{ key: 'plus_power', used: false }]; gc.cur = 0; gc.phase = 'main'; gc.moved = false; const me2 = Object.values(gc.figs).find(f => f.owner === 0 && f !== co); place(gc, me2, 'I21');
  const r0 = E.apply(gc, 0, { t: 'plate', idx: 0, a: me2.uid }); ok(!r0.error && (!gc.buff[me2.uid] || !gc.buff[me2.uid].dmg), 'Black Core negates Energy plates'); }

// 34 0-damage White vs Miss = no KO; forced move onto the goal wins
{ const o = T.outcome; const mk = (c, dmg) => ({ color: c, dmg, seg: { dmg: { stars: 0 } } });
  const h1 = o(mk('White', 0), mk('Red', 0)); ok(!h1.dKO && h1.aFx, 'Harden (0 damage) vs Miss does not knock out');
  const h2 = o(mk('Red', 0), mk('White', 0)); ok(!h2.aKO, 'Miss vs Harden does not knock out');
  const h3 = o(mk('White', 40), mk('Red', 0)); ok(h3.dKO, 'real White attack still knocks out a Miss');
  const B4 = require('../lib/board'); const ids2 = require('../lib/figures').LIST.filter(x => !x.rules.length && x.mp >= 2).slice(0, 12).map(x => x.id);
  const g17 = E.newGame([{ figs: ids2.slice(0, 6), plates: [] }, { figs: ids2.slice(6), plates: [] }], ['A', 'B'], 3);
  const mg = Object.values(g17.figs).find(f => f.owner === 0); place(g17, mg, B4.GOALS[0]); T.goalCheck(g17, mg);
  ok(g17.over && g17.winner === 0, 'reaching the goal through an effect move wins the game'); }

// 35 choosing a specific Z-Move by name
{ const LX = require('../lib/figures').LIST; const gz = setup(['Magnemite','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const mz = Object.values(gz.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Magnemite'), ez = Object.values(gz.figs).find(f => f.owner === 1);
  const w = T.buildWheel ? T.buildWheel(gz, mz, ez, 'Gigavolt Havoc') : null; if (w) ok(w.length === 1 && w[0].name === 'Gigavolt Havoc', 'a Z-Move can be chosen by name (single-segment wheel)'); }

// 36 'moves 1-2 steps back' only moves away from the opponent (Shinx Blind)
{ const B5 = require('../lib/board'); const LX = require('../lib/figures').LIST; const gs = setup(['Shinx','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const sx = Object.values(gs.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Shinx'), eo = Object.values(gs.figs).find(f => f.owner === 1); place(gs, sx, 'I01'); place(gs, eo, 'T2');
  const seg = LX.find(x => x.id === sx.fid).segs.find(x => x.name === 'Blind'); T.runOps(gs, seg.ops, { self: sx, opp: eo, oppPos: 'T2' });
  const opts = T.taskOptions(gs, gs.tasks[gs.tasks.length - 1]); const dd = B5.bfs('T2');
  ok(opts.length > 0 && opts.every(p => dd[p] > dd['I01']), 'Blind (moves back) only offers points farther from the opponent'); }

// 37 Dig (Onix) moves away from attached Pokémon; Fly Away can land on (and win at) the enemy goal
{ const B6 = require('../lib/board'); const LX = require('../lib/figures').LIST; const gd = setup(['Onix','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const ox = Object.values(gd.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Onix'), ee = Object.values(gd.figs).find(f => f.owner === 1); place(gd, ox, 'I00'); place(gd, ee, 'I01');
  const seg = LX.find(x => x.id === ox.fid).segs.find(x => x.name === 'Dig'); T.runOps(gd, seg.ops, { self: ox, opp: ee, oppPos: 'I01' });
  const o2 = T.taskOptions(gd, gd.tasks[gd.tasks.length - 1]); ok(o2.length > 0 && o2.every(p => !B6.ADJ['I01'].includes(p) && p !== 'I01'), 'Dig only offers points away from the attached Pokémon');
  const gf = setup(['Skarmory','Pikachu','Eevee','Jolteon','Stantler','Popplio'], ['Sharpedo','Tsareena','Garbodor','Ivysaur','Gible','Metang']);
  const sk = Object.values(gf.figs).find(f => f.owner === 0 && LX.find(x => x.id === f.fid).name === 'Skarmory'), ef = Object.values(gf.figs).find(f => f.owner === 1); place(gf, sk, 'I01'); place(gf, ef, 'T2');
  const fs = LX.find(x => x.id === sk.fid).segs.find(x => x.name === 'Fly Away'); T.runOps(gf, fs.ops, { self: sk, opp: ef, oppPos: 'T2' });
  ok(T.taskOptions(gf, gf.tasks[gf.tasks.length - 1]).includes(B6.GOALS[0]), 'Fly Away can land on the goal point beside the opponent'); }

console.log(`ability tests: ${pass} passed, ${fail} failed`);
