'use strict';
// Parses Special Ability text into structured rules the engine understands.
const ST = [['noxious', 'noxious'], ['poison', 'poisoned'], ['paraly', 'paralyzed'], ['burn', 'burned'], ['froz', 'frozen'], ['confus', 'confused'], ['asleep', 'asleep'], ['sleep', 'asleep']];
function stsIn(s) { const o = new Set(); for (const [k, v] of ST) if (s.includes(k)) { o.add(v); if (k === 'poison') o.add('noxious'); } return [...o]; }
const typesIn = s => [...s.matchAll(/([a-z]+)-type/g)].map(m => m[1]).filter(x => x !== 'non');
const num = (m, i) => +m[i || 1];

function perDesc(desc) {
  const d = desc.trim();
  if (/time one of your pok.mon has been knocked out/i.test(d)) return { scope: 'ownKOs' };
  if (/of your pok.mon in the p\.?c/i.test(d)) return { scope: 'pc' };
  let m = d.match(/friendly ([A-Z][a-z]+)/); if (m) return { scope: 'friendlyField', names: [m[1].toLowerCase()] };
  if (/each player's bench/i.test(d)) return { scope: 'benches', types: typesIn(d.toLowerCase()) };
  if (/^[A-Z][a-z]+(?:, [A-Z][a-z]+)*(?:,? or [A-Z][a-z]+)?$/.test(d)) return { scope: 'allField', names: d.split(/,? or |, /).map(x => x.toLowerCase()) };
  const ty = typesIn(d.toLowerCase()); if (ty.length) return { scope: /opposi/i.test(d) ? 'oppField' : 'allField', types: ty };
  if (/^pok.mon$/i.test(d.replace(/ on the field/, '')) || /^pok.mon on the field/i.test(d)) return { scope: 'allField' };
  return null;
}

function parseRules(text) {
  const rules = []; if (!text || /^none/i.test(text)) return rules;
  const body = text.replace(/\s+/g, ' ').replace(/^[A-Za-z'\-. ]{2,32}? - (?=[A-Z])/, '');
  const sents = body.split(/(?<=[a-z)])\.\s*(?=[A-Z]|$)/).filter(Boolean);
  for (const s of sents) {
    const l = s.toLowerCase(); let m;
    const healthy = /not affected by a special condition|is not poisoned or noxious/.test(l);
    // --- status immunity
    if (/other than sleep/.test(l) && /cannot be affected|can't be affected/.test(l)) rules.push({ k: 'immuneAllBut', keep: ['asleep'] });
    else if (/^this pok.mon (?:cannot|can't|can not|can never) be (?:affected by |put to )?[a-z ,']*?(?:confus|paraly|poison|burn|froz|sleep|asleep)/.test(l) && !/knocked out|moved|tagged/.test(l.split(/(?:paraly|confus|poison|burn|froz|sleep|asleep)/)[0])) { const sts = stsIn(l.replace(/\.?\s*(?:this pok.mon )?(?:cannot|can't) be moved.*$/, '')); if (sts.length) rules.push({ k: 'immune', sts }); }
    if (/^this pok.mon cannot be surrounded by (?:your )?opponent's pok.mon/.test(l)) rules.push({ k: 'noSurround' });
    if (/while this pok.mon is on the field, effects of energy plates are negated/.test(l)) rules.push({ k: 'noEnergy' });
    if ((m = l.match(/when this pok.mon is on the field, your ([a-z\- ]+?) pok.mon cannot become (poisoned|noxious)/))) rules.push({ k: 'teamImmune', types: typesIn(m[1]), sts: ['poisoned', 'noxious'] });
    if (/this pok.mon cannot (?:have|gain|enter) wait|cannot gain wait|cannot enter wait/.test(l)) rules.push({ k: 'noWait' });
    // --- contact statuses
    if ((m = l.match(/(?:any|opposing)? ?(.*?) that battles? (?:this pok.mon|it) will become (\w+)/))) { const st = stsIn(m[2])[0]; if (st) rules.push({ k: 'contact', types: typesIn(m[1]).length ? typesIn(m[1]) : null, st }); }
    if (/this pok.mon and pok.mon that battle it become burned/.test(l)) { rules.push({ k: 'contact', types: null, st: 'burned' }); rules.push({ k: 'contactSelf', st: 'burned' }); }
    if (/when this pok.mon becomes poisoned.*the pok.mon that caused the condition will also become it/.test(l)) rules.push({ k: 'reflect' });
    if (/pok.mon that this pok.mon moves over using fly are knocked out/.test(l)) rules.push({ k: 'flyKO' });
    if (/when this pok.mon is knocked out, you may move one of your pok.mon that has been excluded from the duel to the bench/.test(l)) rules.push({ k: 'specialDelivery' });
    if ((m = l.match(/this pok.mon has mp (\d+) if it is (\w+)/)) && ST.some(([k]) => m[2].startsWith(k.slice(0, 5)))) rules.push({ k: 'mpIfSt', n: +m[1], st: ST.find(([k]) => m[2].startsWith(k.slice(0, 5)))[1] });
    if ((m = l.match(/at the start of your turn, this pok.mon may route move to a point (\d+)-(\d+) steps away in a straight line instead of an mp move/))) rules.push({ k: 'altMove', lo: +m[1], hi: +m[2], straight: true, battled: true });
    if ((m = l.match(/at the start of your turn, instead of an mp move, you may move this pok.mon to a point (\d+) steps away/))) rules.push({ k: 'altMove', lo: +m[1], hi: +m[1] });
    if (/when this pok.mon moves from the bench, it may move to a point 1 step away from an entry point/.test(l)) rules.push({ k: 'altMoveBench' });
    if (/when attacked, you can move this pok.mon back two steps without battling/.test(l)) rules.push({ k: 'evade', n: 2 });
    // --- damage
    if ((m = l.match(/^(?:if this pok.mon is on the field and )?(?:not affected by a special condition, )?(?:when this pok.mon is on the field, )?your ([a-z\-, ]+?) pok.mon (?:each )?(?:deal|do) \+(\d+) damage(?: for each ([^.]+))?/)) || (m = l.match(/your ([a-z\-, ]+?) pok.mon (?:each )?(?:deal|do) \+(\d+) damage(?: for each ([^.]+))?/))) {
      rules.push({ k: 'aura', types: typesIn(m[1]), n: num(m, 2), healthy: /(?:not affected by a special condition|unless this pok.mon is affected)/.test(l), per: m[3] ? perDesc(m[3].replace(/\.$/, '')) : null });
      const m2 = l.match(/ and your ([a-z\-]+) pok.mon (?:each )?(?:deal|do) \+(\d+) damage/); if (m2) rules.push({ k: 'aura', types: typesIn(m2[1]), n: +m2[2], healthy: false, per: null });
    } else if ((m = l.match(/your other pok.mon deal \+(\d+) damage/))) rules.push({ k: 'aura', types: [], n: num(m), excludeSelf: true });
    else if ((m = l.match(/when this pok.mon is on the field, your pok.mon deal \+(\d+) damage for each pok.mon on the field/))) rules.push({ k: 'aura', types: [], n: num(m), per: { scope: 'allField' } });
    if ((m = l.match(/any pok.mon adjacent to this pok.mon will do \+(\d+) damage/))) rules.push({ k: 'adjAura', n: num(m) });
    if ((m = l.match(/your opponent's ([a-z]+)-type pok.mon will do -(\d+) damage/))) rules.push({ k: 'enemyDmg', types: [m[1]], n: +m[2] });
    if ((m = l.match(/pok.mon that are not ([a-z]+)-type pok.mon or ([a-z]+)-type pok.mon deal (\d+) less damage/))) rules.push({ k: 'dmgNotTypes', types: [m[1], m[2]], n: +m[3] });
    if ((m = l.match(/your ([a-z]+)-type pok.mon and your ([a-z]+)-type pok.mon take -(\d+) damage/))) rules.push({ k: 'teamTake', types: [m[1], m[2]], n: +m[3] });
    if ((m = l.match(/all poisoned pok.mon will do a further -(\d+) damage/))) rules.push({ k: 'poisonedDmg', n: +m[1] });
    if ((m = l.match(/if this pok.mon is affected by a special condition, its opponents deal -(\d+) damage to it/))) rules.push({ k: 'takeLessIfCond', n: +m[1] });
    if ((m = l.match(/(?:this pok.mon (?:deals|games|gains)|this pok.mon's deals) \+(\d+) damage for each ([^.]+)/))) { const p = perDesc(s.match(/for each ([^.]+)/)[1].replace(/ on the field$/, '')); if (p) rules.push({ k: 'perCount', n: +m[1], per: p }); }
    if ((m = l.match(/(?:in battles on your turn, this pok.mon deals|this pok.mon gains) \+(\d+) damage(?: in battles in your turn)?/)) && /your turn/.test(l)) rules.push({ k: 'turnBonus', n: num(m) });
    if ((m = l.match(/this pok.mon's ([a-z ]+?) gains \+(\d+) damage for each of your pok.mon in the p\.?c/))) rules.push({ k: 'moveBonusPC', move: m[1], n: +m[2] });
    if ((m = l.match(/if this pok.mon is paralyzed, it gains \+(\d+) mp and deals \+(\d+) damage/))) rules.push({ k: 'paraBoost', mp: +m[1], dmg: +m[2] });
    if ((m = l.match(/if there is an? ([a-z]+) within \d+ spaces of this pok.mon, this pok.mon's white attacks become gold/)) || (m = l.match(/if there is an adjacent ([a-z]+), this pok.mon's white attacks become gold/))) rules.push({ k: 'nearNameGold', name: m[1], range: /within/.test(l) ? 2 : 1 });
    if (/if (?:your )?[a-z, ]+ (?:is|are) adjacent, deal x(\d+) damage/.test(l)) { m = l.match(/deal x(\d+)/); rules.push({ k: 'adjFamilyMult', n: +m[1], names: [...s.matchAll(/([A-Z][a-z]+)(?:,| or|\s+is| are)/g)].map(x => x[1].toLowerCase()) }); }
    // --- MP
    if ((m = l.match(/if there is an adjacent ([a-z]+)-type pok.mon, this pok.mon gains \+(\d+) ?mp/))) rules.push({ k: 'mpAdjType', type: m[1], n: +m[2] });
    if ((m = l.match(/mp ?\+(\d+) for this pok.mon for each pok.mon you have in your p\.?c/))) rules.push({ k: 'mpPerPC', n: +m[1] });
    if ((m = l.match(/(?:while|when) (?:this pok.mon is )?on the bench, (?:it|this pok.mon) gains \+(\d+) ?mp/)) || (m = l.match(/this pok.mon on the bench gains \+(\d+) ?mp/))) rules.push({ k: 'mpBench', n: +m[1] });
    if ((m = l.match(/if an opponent's pok.mon has a special condition, this pok.mon gains \+(\d+) mp/))) rules.push({ k: 'mpOppCond', n: +m[1] });
    if ((m = l.match(/if there are opposing pok.mon on all (?:of )?(?:your )?entry points, this pok.mon (?:gets|gains|games) (?:\+(\d+) ?mp|mp\+(\d+))/))) rules.push({ k: 'mpEntryBlocked', n: +(m[1] || m[2]) });
    if ((m = l.match(/while this pok.mon is on the field, all poisoned and noxious pok.mon have mp-(\d+)/)) || (m = l.match(/when this pok.mon is on the field, all poisoned and noxious pok.mon have mp-(\d+)/))) rules.push({ k: 'auraMpStatus', sts: ['poisoned', 'noxious'], n: +m[1] });
    if ((m = l.match(/opposing paralyzed pok.mon have mp-(\d+)/))) rules.push({ k: 'auraMpStatus', sts: ['paralyzed'], n: +m[1], opp: true });
    if ((m = l.match(/opposing ([a-z]+)-type and ([a-z]+)-type pok.mon each have mp ?-(\d+)/))) rules.push({ k: 'auraMpEnemy', types: [m[1], m[2]], n: +m[3] });
    if ((m = l.match(/opposing ([a-z]+)-type pok.mon and ([a-z]+)-type pok.mon within (\d+) steps of this pok.mon have mp-(\d+)/))) rules.push({ k: 'auraMpEnemy', types: [m[1], m[2]], n: +m[4], range: +m[3] });
    if (/your pok.mon may move over this pok.mon/.test(l)) rules.push({ k: 'passableBy', own: true });
    // --- movement
    if ((/mp move/.test(l) || /fly over|pass through|move past|move through|move over/.test(l)) && !/your pok.mon may move over this pok.mon/.test(l)) {
      if (/other pok.mon can move over this pok.mon|(?:pass|move) over this pok.mon when using an mp move/.test(l)) rules.push({ k: 'passableBy' });
      else if (/(?:opposing pok.mon|your opponent's pok.mon) cannot (?:mp move through|pass)/.test(l)) rules.push({ k: 'unpassable' });
      else if (/(?:can|may)[a-z ]* (?:mp move|move) (?:from the bench )?(?:past|through|over)|it can mp move through/.test(l) && !/other pok.mon can/.test(l)) {
        const seg = l.replace(/^.*?(?:past|through|over)\s+/, ''); const non = (seg.match(/non-([a-z]+)-type/) || [])[1];
        const r = { k: 'pass', own: /your (?:own )?pok.mon/.test(seg), opp: /opposing/.test(seg), types: typesIn(seg.replace(/non-[a-z]+-type/, '')), nonTypes: non ? [non] : [], sts: stsIn(seg.replace(/\bwait\b/, '')), wait: /wait/.test(seg) };
        if (/other pok.mon|pok.mon on the field|pok.mon that|pok.mon\b/.test(seg) && !r.own && !r.types.length && !r.sts.length && !r.wait && !r.nonTypes.length && !/over this/.test(seg)) r.all = true;
        if (/fly over pok.mon (?:on the field )?that don't have soar|fly over/.test(l) && !r.types.length && !r.sts.length) r.all = true;
        rules.push(r);
      }
    }
    // --- attack colours
    if (/blue attacks? of .*?(?:battle opponents?|opponents?).*? become misses|blue attacks of this pok.mon's battle opponents become misses|all the blue attacks of htis/.test(l)) rules.push({ k: 'blueToMiss', healthy: /not affected by a special condition/.test(l) });
    if (/the battle opponent's gold attacks become misses/.test(l)) rules.push({ k: 'goldToMiss' });
    if (/the dodges of opposing pok.mon adjacent to this pok.mon become misses/.test(l)) rules.push({ k: 'dodgeMiss' });
    if (/in its first battle after moving to the field, all of this pok.mon's white attacks become gold/.test(l)) rules.push({ k: 'firstBattleGold' });
    if (/gold attacks of battle opponents that have an mp-reducing marker become white/.test(l)) rules.push({ k: 'goldToWhiteIfMarked' });
    if (/cannot win (?:you )?the duel by moving to the goal point/.test(l)) rules.push({ k: 'noGoalWin' });
    // --- tagging
    if (/opposing pok.mon adjacent to this pok.mon cannot tag or be tagged/.test(l)) rules.push({ k: 'noTag' });
    if (/frozen condition of pok.mon within (?:two|2) steps of this pok.mon cannot be removed by tagging/.test(l)) rules.push({ k: 'frozenLock', r: 2 });
    if (/frozen pok.mon next to this pok.mon cannot be tagged/.test(l)) rules.push({ k: 'frozenLock', r: 1 });
    if (/can remove curse markers and cracked markers by tagging/.test(l)) rules.push({ k: 'tagMarkers' });

    // --- v7 simulated abilities
    if ((m = l.match(/opposing ([a-z]+)-type and ([a-z]+)-type pok.mon within (\d+) steps of this pok.mon have mp-(\d+)/))) rules.push({ k: 'auraMpEnemy', types: [m[1], m[2]], n: +m[4], range: +m[3] });
    if ((m = l.match(/your ([a-z]+)-type pok.mon next to this pok.mon gain \+(\d+) mp/))) rules.push({ k: 'auraMpAdj', types: [m[1]], n: +m[2] });
    if ((m = l.match(/your mp ?1 ([a-z]+)-type pok.mon gain \+(\d+) ?mp/))) rules.push({ k: 'auraMpBase1', types: [m[1]], n: +m[2], healthy: /not affected by a special condition/.test(l) });
    if ((m = l.match(/if there are no opposing pok.mon within (?:two|2) steps of this pok.mon, this pok.mon has mp (\d)/))) rules.push({ k: 'mpIfNoEnemyNear', n: +m[1], range: 2 });
    if (/all the purple attacks of the battle opponents of this pok.mon become misses/.test(l)) rules.push({ k: 'purpleToMiss' });
    if (/all gold attacks of opposing pok.mon adjacent to this pok.mon become misses/.test(l)) rules.push({ k: 'goldToMissAdj' });
    if (/opposing pok.mon that battle this pok.mon will be paralyzed after the battle/.test(l)) rules.push({ k: 'contact', types: null, st: 'paralyzed' });
    if (/attach a cracked marker to any pok.mon that battle it/.test(l)) rules.push({ k: 'contactCracked', healthy: /not affected by a special condition/.test(l) });
    if ((m = l.match(/if the battle opponent is an? electric-type pok.mon, the damage it deals to this pok.mon is reduced by (\d+)/))) rules.push({ k: 'takeLessVs', types: ['electric'], n: +m[1] });
    if ((m = l.match(/if the battle opponent is an? ([a-z]+)-type pok.mon(?: that does not have any other types)?, this pok.mon is not knocked out in battle/))) rules.push({ k: 'safeVsType', types: [m[1]], pure: /does not have any other types/.test(l) });
    if (/cannot be knocked out if it's not affected by a special condition and its battle opponent is a ghost-type/.test(l)) rules.push({ k: 'safeVsType', types: ['ghost'], healthy: true });
    if ((m = l.match(/your ([a-z]+)-type pok.mon take (\d+) less damage from\s+the attacks of ([a-z]+)-type battle opponents/))) rules.push({ k: 'teamTakeVs', types: [m[1]], vs: [m[3]], n: +m[2], healthy: /not affected by a special condition/.test(l) });
    if (/the opposing player cannot use plates/.test(l)) rules.push({ k: 'plateLock', healthy: /not affected by a special condition/.test(l) });
    if ((m = l.match(/^your ([a-z]+)-type pok.mon deal \+(\d+) dam/)) && !rules.some(r => r.k === 'aura')) rules.push({ k: 'aura', types: [m[1]], n: +m[2] });
    if ((m = l.match(/(moonblast|sword of justice) from (?:any of )?your pok.mon deals \+(\d+) damage/))) rules.push({ k: 'moveAura', move: m[1], n: +m[2], healthy: /not affected by a special condition/.test(l), myTurn: /only valid on your turn/.test(body.toLowerCase()) });
    if (/this pok.mon is not knocked out by battle damage/.test(l)) rules.push({ k: 'safeDamage' });
    if ((m = l.match(/this pok.mon gets \+(\d+) mp for each species of regirock, regice and registeel on the field/))) rules.push({ k: 'mpPerNames', n: +m[1], names: ['regirock', 'regice', 'registeel'] });
    if (/at the start of your turn, instead of an mp move, this pok.mon may switch places with an adjacent electric-type pok.mon or\s+paralyzed pok.mon/.test(l)) rules.push({ k: 'altSwap', cond: 'electricOrPara' });
    if ((m = l.match(/at the start of your turn, if any of your other (\w+) or (\w+) are within (\d) steps, you may move this pok.mon to a point (\d) steps away instead of an mp move/))) rules.push({ k: 'altMove', lo: +m[4], hi: +m[4], battled: false, needNear: { names: ['metang', 'metagross'], range: +m[3] } });
    if ((m = l.match(/your water-type pok.mon's attacks do \+(\d+)/))) rules.push({ k: 'aura', types: ['water'], n: +m[1] });
    if ((m = l.match(/this pok.mon's ([a-z ]+?) is increased by (\d+) for each pok.mon in your p\.?c/))) rules.push({ k: 'moveBonusPC', move: m[1], n: +m[2] });
    if ((m = l.match(/your pok.mon that are both ([a-z]+) and ([a-z]+) type deal \+(\d+) damage/))) rules.push({ k: 'aura', types: [m[1], m[2]], both: true, n: +m[3] });
    if ((m = l.match(/your ([a-z]+)-type pok.mon and ([a-z]+)-type pok.mon get \+(\d)mp/))) rules.push({ k: 'auraMpTypes', types: [m[1], m[2]], n: +m[3] });
    if ((m = l.match(/your ([a-z]+)-type pok.mon and your ([a-z]+)-type pok.mon deal \+(\d+) da/))) rules.push({ k: 'aura', types: [m[1], m[2]], n: +m[3] });
    if (/this pok.mon can mp move under other pok.mon on the field/.test(l)) rules.push({ k: 'pass', own: false, opp: false, types: [], nonTypes: [], sts: [], wait: false, all: true });
    if ((m = l.match(/if there are (\d+) or more wa?.?ster-type pok.mon on the field, your ground-type pok.mon with mp ?1 or lower get \+(\d)mp/))) rules.push({ k: 'auraMpBase1', types: ['ground'], n: +m[2], needType: 'water', needCount: +m[1] });
    if ((m = l.match(/your non-([a-z]+) water-type pok.mon with mp ?1 gain \+(\d) mp/))) rules.push({ k: 'auraMpBase1', types: ['water'], n: +m[2], excl: m[1], noPoison: true });
    if (/will be boosted from 0-1mp to 2 mp/.test(l)) rules.push({ k: 'forceBalance' });
    if (/negates abilities that boost or lower attack damage for your opponent/.test(l)) rules.push({ k: 'moldBreaker' });
    if (/all the gold attacks of battle opponents of this pok.mon become white attacks/.test(l)) rules.push({ k: 'goldToWhiteOpp' });
    if (/not knocked out by gold attacks from their battle opponents/.test(l)) rules.push({ k: 'ironHeart' });
    if (/the gold attacks of pok.mon within 2 steps of this pok.mon become white attacks/.test(l)) rules.push({ k: 'goldToWhiteNear', range: 2 });
    if (/any pok.mon adjacent to it, except for flying-type pok.mon, will be unable to use mp move/.test(l)) rules.push({ k: 'arenaTrap' });
    if (/instead of using an mp move, this pok.mon can move to within 3 spaces of an opponent/.test(l)) rules.push({ k: 'altMove', lo: 0, hi: 0, nearOpp: 3 });
    if (/instead of an mp move, you can move this pok.mon to a spot next to an adjacent grass-type pok.mon/.test(l)) rules.push({ k: 'altMove', lo: 0, hi: 0, chainType: 'grass' });
    if (/friendly pok.mon next to this pok.mon cannot be affected by any new status effects/.test(l)) rules.push({ k: 'refraction' });
    if (/the next turn after using this pok.mon, your opponent will be unable to use plates/.test(l)) rules.push({ k: 'hypnoticVoice' });
    if (/when this pok.mon is knocked out, all pok.mon in your p\.?c\.? are moved to the bench/.test(l)) rules.push({ k: 'koPCtoBench' });
    if (/^this pok.mon gains \+1 ?(?:☆|star)/.test(l)) rules.push({ k: 'starPlus', n: 1 });
    if ((m = l.match(/increased by \+(\d+) for every electric-type pok.mon it is connected to/))) rules.push({ k: 'connection', n: +m[1] });
    if (/when this pok.mon is attacked, it can move to the bench$/.test(l)) rules.push({ k: 'evade', mode: 'bench' });
    if (/if this pok.mon is attacked, it can move under the opponent's pok.mon to another space next to it/.test(l)) rules.push({ k: 'evade', mode: 'around' });
    if (/if this pok.mon is to be attacked, it may slip past the attacking pok.mon/.test(l)) rules.push({ k: 'evade', mode: 'past' });
    if (/if your opponent spins a purple attack, you can force them to respin once a turn/.test(l)) rules.push({ k: 'respinOpp', color: 'Purple' });
    if ((m = l.match(/if your battle opponent spins an attack with (\d+) or more damage, you can force them to?p? ?spin again once per turn/))) rules.push({ k: 'respinOpp', minDmg: +m[1] });
    if (/once per turn, you can force your opponent to spin again/.test(l)) rules.push({ k: 'respinOpp', minDmg: 30 });
    if (/you may redo battle spins up to the number of your other reuniclus on the field/.test(l)) rules.push({ k: 'respinSelfN', name: 'reuniclus' });
    if (/this pok.mon's spin will miss by two segments in a clockwise direction/.test(l)) rules.push({ k: 'spinShift', n: 2 });
    if (/if this pok.mon has evolved, and its attack lands on miss, it will shift to an attack next to it/.test(l)) rules.push({ k: 'missShift' });
    if (/this pok.mon cannot battle\.?$/.test(l)) rules.push({ k: 'noBattle' });
    if (/at the start of your turn, if this pok.mon is on the field, it may move to the bench\. you can use this pok.mon immediately/.test(l + '.') || /^at the start of your turn, if this pok.mon is on the field, it may move to the bench$/.test(l)) rules.push({ k: 'loyalty' });
    if ((m = l.match(/if this pok.mon (?:has evolved|is evolved), (?:it|this pok.mon) (?:gains|gets|has) (?:\+(\d) ?mp|mp ?\+(\d))/))) rules.push({ k: 'mpEvolved', n: +(m[1] || m[2]) });
    // --- misc
    if (/opposing pok.mon that are asleep adjacent to this pok.mon are knocked out/.test(l)) rules.push({ k: 'koAdjAsleep' });
    if (/wake up from sleep condition at the start of your turn/.test(l)) rules.push({ k: 'wakeStart' });
    if (/remove wait from all your pok.mon on the field/.test(l)) rules.push({ k: 'clearWaitOnEntry' });
    if (/moves from the bench to the field, remove any special conditions/.test(l)) rules.push({ k: 'cureOnEntry' });
  }
  return rules;
}
module.exports = { parseRules };
