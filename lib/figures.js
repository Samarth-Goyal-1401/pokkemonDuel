'use strict';
const path = require('path');
const { parseRules } = require('./abilities');
const raw = require(path.join(__dirname, '..', 'data', 'all_pokemon_data.json'));

const STATUS_WORDS = [
  ['noxious', 'noxious'], ['poison', 'poisoned'], ['paraly', 'paralyzed'], ['burn', 'burned'],
  ['froz', 'frozen'], ['noxi', 'noxious'], ['confus', 'confused'], ['asleep', 'asleep'], ['sleep', 'asleep'],
];
function stWord(s) { s = String(s||"").toLowerCase(); for (const [k, v] of STATUS_WORDS) if (s.includes(k)) return v; return null; }

function parseDamage(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return { kind: 'none', n: 0 };
  if (/^\d+$/.test(s)) return { kind: 'num', n: +s };
  let m = s.match(/^(\d+)\s*x$/i); if (m) return { kind: 'mult', n: +m[1] };
  m = s.match(/^(\d+)\s*\+$/); if (m) return { kind: 'plus', n: +m[1] };
  if (/^[☆★]+$/.test(s)) return { kind: 'stars', n: 0, stars: s.length };
  m = s.match(/(\d+)/); if (m) return { kind: 'num', n: +m[1] };
  return { kind: 'none', n: 0 };
}

// ---- move note -> effect ops -------------------------------------------------
function parseEffects(notes) {
  const ops = []; if (!notes) return ops;
  let text = notes.replace(/\s+/g, ' ').replace(/\bone step/gi, '1 step').replace(/\btwo steps?/gi, '2 steps').replace(/\bthree steps?/gi, '3 steps');
  // multi-sentence effects are matched on the whole text first, then removed
  const WHOLE = [
    [/(?:A|One other) Pok.mon on the field spins\.? ?-? ?If (?:it|they) spins? a Miss or a White Attack of (\d+) damage or more, (?:it|they) (?:is|are) knocked out\.?/i, m => [{ op: 'spinOne', thr: +m[1] }]],
    [/All opposing Pok.mon on the field spin\.? Those that spin White Attacks (?:become (\w+)|get an? MP-?(\d+) marker)\.?/i, m => [m[1] && stWord(m[1]) ? { op: 'spinAll', cond: 'white', then: { op: 'status', st: stWord(m[1]) } } : { op: 'spinAll', cond: 'white', then: { op: 'mpMarker', n: +m[2] } }]],
    [/Any Pok.mon adjacent to the battle opponent other than this Pok.mon spin\.? Those that spin White Attacks move to the bench\.?/i, () => [{ op: 'spinAdj', cond: 'white', then: { op: 'bench' } }]],
    [/Spin again until an? attack other than ([\w' ]+?) is spun\.? Damage attacks deal (x|\+)(\d+) damage,?/i, m => [{ op: 'buffSpin', name: m[1], mode: m[2].toLowerCase() === 'x' ? 'mult' : 'add', n: +m[3] }]],
    [/Opposing Pok.mon adjacent to this Pok.mon spin, and if they spin a Gold Attack, then they are knocked out\.?/i, () => [{ op: 'spinGroup', group: 'adjSelfOpp', cond: 'gold', then: [{ op: 'ko', who: 'opp' }] }]],
    [/The battle opponent and all opposing Pok.mon adjacent to it spin, and if they spin a White Attack, they fall asleep\.?/i, () => [{ op: 'spinGroup', group: 'oppAndAdj', cond: 'white', then: [{ op: 'status', who: 'opp', st: 'asleep' }] }]],
    [/All opposing Pok.mon and your ([A-Za-z]+) Pok.mon on the field spin\.? Those that spin Gold Attacks become (\w+)\.?/i, m => [{ op: 'spinGroup', group: 'oppAndOwnType', type: m[1].toLowerCase(), cond: 'gold', then: [{ op: 'status', who: 'opp', st: stWord(m[2]) }] }]],
    [/One Pok.mon within (\d+) steps'? range is drawn (\d+)(?:-(\d+))? steps? closer to this Pok.mon and gains Wait\.?/i, m => [{ op: 'pull', r: +m[1], lo: +m[2], hi: +(m[3] || m[2]) }]],
    [/The battle opponent or one opposing Pok.mon adjacent to the battle opponent spins\.? If that Pok.mon spins a Purple Attack or Miss, it moves to its P\.?C\.? and gains Wait\.?/i, () => [{ op: 'spinGroup', group: 'oppOrAdj', cond: 'purpleOrMiss', then: [{ op: 'pc' }, { op: 'wait', who: 'opp', n: 1 }] }]],
    [/One other (\w+)-type Pok.mon on the field \(that is not ([a-z ]+)\) may be moved within (?:their|its) MP range\.? (?:That|The moved) Pok.mon gains Wait\.?( If the moved Pok.mon is one of the opponent's Pok.mon, that Pok.mon falls asleep\.?)?/i, m => [{ op: 'moveOther', filter: { types: [m[1].toLowerCase()], notSt: m[2].toLowerCase().split(/ or |, /).map(x => ({ asleep: 'asleep', frozen: 'frozen' }[x.trim()])).filter(Boolean) }, sleepOpp: !!m[3] }]],
    [/One of your ([A-Za-z, ]+?) \(that is not asleep or frozen\) may be moved within their MP range\.? That Pok.mon gains wait\.?/i, m => [{ op: 'moveOther', filter: { names: m[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map(x => x.trim().toLowerCase()).filter(Boolean), own: true, notSt: ['asleep', 'frozen'] } }]],
    [/You may move one Pok.mon that is asleep to a point within its MP range\.? The moved Pok.mon gains Wait\.?/i, () => [{ op: 'moveOther', filter: { needSt: 'asleep', own: true } }]],
    [/You may move one Pok.mon that is on your bench within its MP range\.? The moved Pok.mon gains Wait\.?/i, () => [{ op: 'moveOther', filter: { bench: true, own: true } }]],
    [/All opposing Pok.mon on the field spin\.? Those that spin a Purple Attack are knocked out\.? This Pok.mon is excluded from the duel\.?/i, () => [{ op: 'spinGroup', group: 'allOpp', cond: 'purple', then: [{ op: 'ko', who: 'opp' }] }, { op: 'selfRemove' }]],
    [/This Pok.mon moves away from any Pok.mon attached to it\.?/i, () => [{ op: 'digAway' }]],
    [/This Pok.mon can move to a point that is (\d+) steps away\.? In that case, it gains Wait\.?/i, m => [{ op: 'selfMove', n: +m[1] }, { op: 'wait', who: 'self', n: 1 }]],
    [/All opposing Pok.mon on the field spin\.? Those that spin a Miss are knocked out\.?/i, () => [{ op: 'spinGroup', group: 'allOpp', cond: 'miss', then: [{ op: 'ko', who: 'opp' }] }]],
    [/All opposing Flying-type Pok.mon on the field spin\.? Those that spin a Miss or a White Attack of (\d+) damage or less are knocked out\.?/i, m => [{ op: 'spinGroup', group: 'oppFlying', cond: 'missOrWhiteLE', n: +m[1], then: [{ op: 'ko', who: 'opp' }] }]],
    [/Opposing Pok.mon adjacent to this Pok.mon spin, and if they spin a Gold Attack then they are knocked out\.?/i, () => [{ op: 'spinGroup', group: 'adjSelfOpp', cond: 'gold', then: [{ op: 'ko', who: 'opp' }] }]],
    [/All other Pok.mon on the field spin\W+ ?those that spin purple are knocked out\.?/i, () => [{ op: 'spinGroup', group: 'allOther', cond: 'purpleOnly', then: [{ op: 'ko', who: 'opp' }] }]],
    [/While the battle opponent is on the field, all of that Pok.mon's Blue Attacks that are not Dodge become misses\.?/i, () => [{ op: 'blueMissMark' }]],
  ];
  // ---- v5 whole-text patterns
  WHOLE.push(
    [/Spin again - if ([\w' ]+?) is spun, it deals (\d+)\+ damage\.?/i, m => [{ op: 'plusSpin', name: m[1].trim().toLowerCase(), n: +m[2] }]],
    [/Spin one more time\. If it lands on ([\w' ]+?), this attack does (\d+) more damage\.?/i, m => [{ op: 'plusSpin', name: m[1].trim().toLowerCase(), n: +m[2] }]],
    [/An opposing Pok.mon adjacent to the battle opponent spins, and if it spins a (Gold|Purple) Attack then it is knocked out\.?/i, m => [{ op: 'spinGroup', group: 'adjToOppOne', cond: m[1] === 'Gold' ? 'gold' : 'purpleOnly', then: [{ op: 'ko', who: 'opp' }] }]],
    [/The battle opponent and the Pok.mon behind it in a straight line spin\. Those that spin Purple Attacks are knocked out\.?/i, () => [{ op: 'spinGroup', group: 'oppAndBehind', cond: 'purpleOnly', then: [{ op: 'ko', who: 'opp' }] }]],
    [/If there is a different opponent Pok.mon on a surrounding spot, that Pok.mon must spin again - If it misses, it is knocked out\.?/i, () => [{ op: 'spinGroup', group: 'adjToOppOne', cond: 'miss', then: [{ op: 'ko', who: 'opp' }] }]],
    [/Knock out the battle opponent if it is not a ([A-Za-z]+)-type Pok.mon\.?/i, m => [{ op: 'koIfOppNotType', type: m[1].toLowerCase() }]],
    [/Benches your battle Pok.mon \(exc[a-z]+ when opponent has Fainted\)\. Your battle opponent must then Wait\.?/i, () => [{ op: 'hydroKick' }]],
    [/This attack's damage is boosted by the number of Pok.mon in your P\.?C\.? \+(\d+)\.?/i, m => [{ op: 'pcBonus', n: +m[1] }]],
    [/If the battle opponent's t[a-z]*pe is (\w+), this Pok.mon takes no damage and the opponent is knocked out\. If the battle opponent is (\w+), exclude that \w+ from the duel\.?/i, m => [{ op: 'koIfOppType', type: m[1].toLowerCase() }, { op: 'excludeIfName', name: m[2].toLowerCase() }]],
    [/Until the end of the duel, this Pok.mon's MP becomes (\d+) and its Blue Attacks become Misses\.?/i, m => [{ op: 'shiftGear', mp: +m[1] }]],

    [/This Pok.mon may cause one Pok.mon within (\d+) steps to become (\w+)\.?/i, m => stWord(m[2]) ? [{ op: 'statusPick', n: +m[1], st: stWord(m[2]) }] : []],
    [/If this Pok.mon or the opponent Pok.mon spins purple, they must respin for that turn\.?/i, () => [{ op: 'respinPurple' }]],
    [/Until the end of your next turn, if the Pok.mon hit by this Attack spins a Purple Attack or a Blue attack, shift the result clockwise until a non-Purple, non-Blue Attack comes up\.?/i, () => [{ op: 'tauntMark' }]],
    [/Your opponent's Energy Plate-based effects are lost\.?/i, () => [{ op: 'breakEnergy' }]],
    [/If the battle is a tie, the battle opponent is excluded from the duel\.?/i, () => [{ op: 'excludeOnTie' }]],
    [/If the battle opponent's type is (\w+), this Pok.mon takes no damage and the opponent is knocked out\.?/i, m => [{ op: 'koIfOppType', type: m[1].toLowerCase() }]],
    [/If the battle opponent has MP(\d+) or more, this Pok.mon will not get dam[a-z]*ged and will knock out the battle opponent\.?/i, m => [{ op: 'koIfOppMp', n: +m[1] }]],
    [/If the opponent's Pok.mon is knocked out, so is this Pok.mon\.?/i, () => [{ op: 'selfKOIfOppKO' }]],
    [/This Pok.mon is kn\w*ked out if the opponent's Attack deals more than half the damage that this Pok.mon's Attack deals\.?/i, () => [{ op: 'recoilKO' }]],
    [/Allows this Pok.mon to respin once\.?/i, () => [{ op: 'respinSelf' }]],
    [/This Pok.mon and optionally the opponent Pok.mon may respin one time\.?/i, () => [{ op: 'respinSelf', both: true }]],
    [/Both Pok.mon spin twice\.? If the battle opponent spins the same Attack both times, it misses\.?/i, () => [{ op: 'tormentOpp' }]],
    [/If ?this Pok.mon is knocked out, the battle opponent gains an MP-?(\d+) marker\.?/i, m => [{ op: 'onSelfKO', mp: +m[1] }]],
    [/If the battle opponent or this Pok.mon is paralyzed, this Pok.mon can't be knocked out\.?/i, () => [{ op: 'safeIfPara' }]],
    [/If this Pok.mon has a special condition, that condition is applied to its battle opponent and removed from this Pok.mon instead\.?/i, () => [{ op: 'shiftCond' }]],
    [/The battle opponent and one Pok.mon directly behind it are knocked out\.?/i, () => [{ op: 'koBehind' }]],
    [/The opponent is moved (\d+) steps? behind this Pok.mon\.?/i, () => [{ op: 'flipBehind' }]],
    [/All Pok.mon on the field will spin their wheel\.? If (?:is |it )?Misses, the Pok.mon is sent to the PC\.?/i, () => [{ op: 'spinEveryone', then: 'pc' }]],
    [/Spin or one of your opponent's Pok.mon on the field--if they spin a White Attack, they are knocked out\.?(?: If this Pok.mon has evolved, this effect repeats for each time this Pok.mon has evolved\.?)?/i, () => [{ op: 'spinOne', white: true }]],
    [/Damage is multiplied by the number of your own Pok.mon on the field that also have ([A-Za-z ]+)\.?/i, m => [{ op: 'scaleMove', name: m[1].trim().toLowerCase() }]],
    [/Damage \+(\d+) for each of your own neighboring ([A-Za-z]+)\.?/i, m => [{ op: 'adjBonus', n: +m[1], name: m[2].toLowerCase() }]],
    [/Deals x(\d+) damage if one of your own ([A-Za-z]+) is within (\d+) steps of this Pok.mon\.?/i, m => [{ op: 'nearMult', n: +m[1], name: m[2].toLowerCase(), r: +m[3] }]],
    [/If there are any poisoned and\/or noxious Pok.mon, this damage is multiplied by the number of those Pok.mon\.? Removes all Poisoned and Noxious conditions from all Pok.mon\.?/i, () => [{ op: 'poisonMult' }]],
    [/Opposing Pok.mon adjacent to your ([A-Za-z, ]+?) gain Wait\.?/i, m => [{ op: 'waitNearNames', names: m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map(x => x.trim().toLowerCase()).filter(Boolean) }]],
    [/This Pok.mon must Wait\.? In exchange, it receives a damage boost of \+(\d+) until the next time it lands on ([A-Za-z ]+?)\.?$/i, m => [{ op: 'wait', who: 'self', n: 1 }, { op: 'dmgBoostNext', n: +m[1], until: m[2].trim().toLowerCase() }]],
  );
  // ---- v6 whole-text patterns (remaining special moves)
  const SS = (who, cond, then, extra) => [{ op: 'spinSel', who, cond, then, ...(extra || {}) }];
  const KO = [{ op: 'ko', who: 'opp' }];
  WHOLE.push(
    [/Return the battle opponent to (?:their|its) start-of-(?:the-)?duel (?:state|stage)[^.]*\.?/i, () => [{ op: 'resetOpp' }]],
    [/If the battle opponent is knocked out, this Pok.mon returns to its start-of-the-duel state[^.]*\.?/i, () => [{ op: 'resetSelfIfKO', ifKO: true }]],
    [/Shifts? this Pok.mon's Attacks two segments clockwise\.?/i, () => [{ op: 'rotateWheel', n: 2 }]],
    [/Spin again until an? attack other than ([\w' ]+?) is spun\.? Damage attacks do \+(\d+) damage\.?/i, m => [{ op: 'buffSpin', name: m[1], mode: 'add', n: +m[2] }]],
    [/Spin again until an? attack other than ([\w' ]+?) is spun,\s*then double its damage or it gains \+1.\.?/i, m => [{ op: 'buffSpin', name: m[1], mode: 'mult', n: 2 }]],
    [/A random Pok.mon on your bench other than [A-Za-z]+ spins\.? The attack that is spun takes the place of this attack\.?/i, () => [{ op: 'assist' }]],
    [/This move's damage is boosted by the number of Pok.mon on the field that know moves that can cause Poison or Toxic status effect, plus (\d+)\.\s*If this Pok.mon faints, the battle opponent will become Poisoned/i, m => [{ op: 'poisonersBonus', n: +m[1] }, { op: 'onSelfKO', st: 'poisoned' }]],
    [/Switches one of the opponent's plates from unused to used\.[\s\S]*$/i, () => [{ op: 'plateBurn' }]],
    [/Switches the battle opponent for [^.]*P\.?C\.?\.*\s*(?:Then, )?[Tt]hose Pok.mon (?:must wait|gain Wait) (\d+)\.?/i, m => [{ op: 'warpHole', w: +m[1] }]],
    [/Benches the battle opponent\.\s*This Pok.mon will then switch with another of your Pok.mon from the field, bench or P\.?C\.?/i, () => [{ op: 'bench' }, { op: 'swapIn' }]],
    [/Attaches an Imprisoned marker to the battle opponent\.[^.]*\.?/i, () => [{ op: 'imprison' }]],
    [/Opposing Pok.mon within (\d+) steps of this Pok.mon spin\. If the result is anything other than a Blue attack, the effects of Sphere plates[^.]*\.?/i, () => [{ op: 'noop' }]],
    [/If any Sphere plates have been used[^.]*\.?/i, () => [{ op: 'noop' }]],
    [/Switches the battle opponent with an opposing Pok.mon adjacent to the battle opponent\.\s*Those Pok.mon gain Wait\.?/i, () => [{ op: 'swapOppAdj' }]],
    [/If the battle opponent is an? (\w+)-type Pok.mon, this Pok.mon takes no damage and moves to a spot beyond the battle opponent\.?/i, m => [{ op: 'safeIfOppType', type: m[1].toLowerCase() }, { op: 'jumpBeyondIfType', type: m[1].toLowerCase() }]],
    [/Attach a Charge Marker to this Pok.mon\.[\s\S]*?will become (Paralyzed|Burned|Frozen)[\s\S]*$/i, m => [{ op: 'chargeMark', st: stWord(m[1]) }]],
    [/One of your own ([A-Za-z]+) on the field moves next to this Pok.mon\.?/i, m => [{ op: 'summonAdj', name: m[1].toLowerCase() }]],
    [/If there are Pok.mon at three entry points, switch this Pok.mon with another Pok.mon on the field\.?/i, () => [{ op: 'squaredAttack' }]],
    [/The battle opponent and Flying-type Pok.mon and Water-type Pok.mon that are not Ground-type pok.mon within (\d+) steps are Paralyzed\.?/i, m => [{ op: 'electricTrap', n: +m[1] }]],
    [/If the battle opponent's t[a-z]{1,3}e is (\w+), this Pok.mon takes no damage and the opponent is knocked out\.\s*If the battle opponent is (\w+), exclude that \w+ from the duel\.?/i, m => [{ op: 'koIfOppType', type: m[1].toLowerCase() }, { op: 'excludeIfName', name: m[2].toLowerCase() }]],
    [/If the battle opponent has MP(\d+) or (?:higher|more), t[a-z]*s Pok.mon takes no damage and the battle opponent is knocked out\.?/i, m => [{ op: 'koIfOppMp', n: +m[1] }]],
    [/This Pok.mon may switch places with its battle opponent\.?/i, () => [{ op: 'swap' }]],
    [/Attach a Pumpkin marker to the battle opponent\.[^.]*\.?/i, () => [{ op: 'pumpkin' }]],
    [/You may select 1 of your Pok.mon\. If you do, this Pok.mon is excluded from the duel\.[^.]*MP(\d+)[^.]*\.?/i, m => [{ op: 'wishKoko', mp: +m[1] }]],
    [/You may exclude this Pok.mon from the duel\. If you do, your used plates all return to their unused state\.?/i, () => [{ op: 'wishLele' }]],
    [/You may select one opposing Pok.mon\. If you do, exclude this Pok.mon from the duel\.[^.]*\.?/i, () => [{ op: 'wishBulu' }]],
    [/You may select one opposing Pok.mon\. If you do, this Pok.mon and the selected opposing Pok.mon are excluded from the duel\.?/i, () => [{ op: 'wishFini' }]],
    [/You may exclude this Pok.mon and the battle opponent from the duel\.?/i, () => [{ op: 'blueHole' }]],
    [/If the battle opponent is burned, attach a Branded marker to the battle opponent\.[^.]*\.?/i, () => [{ op: 'branded' }]],
    [/Knock out a Pok.mon that has a Branded marker attached to it\.?/i, () => [{ op: 'pickFx', cand: 'branded', then: KO }]],
    [/Poisons and attaches a Clinging Gas marker to an opposing Pok.mon within (\d+) steps\.[\s\S]*$/i, m => [{ op: 'statusPick', n: +m[1], st: 'poisoned', mark: 'branded' }]],
    [/Opposing Pok.mon within (\d+) steps of the battle opponent spin\.? Those that spin Purple Attacks are knocked out\.?/i, m => SS('oppWithinOpp', 'purpleOnly', KO, { n: +m[1] })],
    [/If the battle opponent is knocked out, move the Pok.mon adjacent to the battle opponent \(excluding this one\) to their bench\.?/i, () => [{ op: 'lariat', ifKO: true }]],
    [/Any Pok.mon adjacent to the battle opponent other than this Pok.mon spin\.? Those that spin White Attacks gain Wait (\d+)\.?/i, m => SS('adjOpp', 'white', [{ op: 'wait', who: 'opp', n: +m[1] }])],
    [/Moves one Pok.mon that is both adjacent to this Pok.mon and not its battle opponent to a point (?:three|3) steps away\.\s*That Pok.mon gains Wait\.?/i, () => [{ op: 'throwAdj', n: 3 }]],
    [/Removes the burned condition from all Pok.mon\.\s*Fire-type Pok.mon on the field spin\.? Those that spin White Attacks gain Wait (\d+)\.?/i, m => [{ op: 'cureBurnAll' }, ...SS('allField', 'white', [{ op: 'wait', who: 'opp', n: +m[1] }], { only: ['fire'] })]],
    [/All opposing Pok.mon on the field spin\.? Those that spin Blue Attacks are knocked out\.?/i, () => SS('opp', 'blue', KO)],
    [/All adjacent Pok.mon on the field that are not Fire, Water, Ice or Steel-type spin\.\s*Attach MP ?-? ?1 markers to those that spin White Attacks\.?/i, () => SS('adjSelf', 'white', [{ op: 'mpMarker', who: 'opp', n: 1 }], { not: ['fire', 'water', 'ice', 'steel'] })],
    [/All adjacent opposing Pok.mon on the field that are not Fire-?, Water-?, Ice-? or Steel-type spin\.\s*Attach MP ?-? ?1 markers to those that spin White Attacks\.?/i, () => SS('adjSelfOpp', 'white', [{ op: 'mpMarker', who: 'opp', n: 1 }], { not: ['fire', 'water', 'ice', 'steel'] })],
    [/All opposing Pok.mon on the field that are not Fire-?, Water-?, Ice-? or Steel-type spin\.\s*Attach MP ?-? ?1 markers to those that spin White Attacks\.?/i, () => SS('opp', 'white', [{ op: 'mpMarker', who: 'opp', n: 1 }], { not: ['fire', 'water', 'ice', 'steel'] })],
    [/Wh?ile this Pok.mon is on the field, this Pok.mon gains \+1MP and Purple Attacks gain .\.\s*This effect is not cumulative\.?/i, () => [{ op: 'cosmic' }]],
    [/Move one other Steel-type Pok.mon within (\d+) steps of this Pok.mon to a point not more than[^.]*\.?/i, () => [{ op: 'tractor' }]],
    [/On your next turn, your opponent cannot use plates\.?/i, () => [{ op: 'plateLock' }]],
    [/Spin for an opposing Pok.mon within (\d+) steps\. If the result is anything other than a Blue Attack, knock it out\.?/i, m => SS('oppWithinSelf', 'notBlue', KO, { n: +m[1], one: true })],
    [/Spin for an opposing Pok.mon within (\d+) steps\. If it spins a Miss or a White Attack of (\d+) damage or less, it is knocked out\.?/i, m => SS('oppWithinSelf', 'missOrWhiteLE', KO, { n: +m[1], le: +m[2], one: true })],
    [/The battle opponent spins\. If it spins a Blue Attack, it is knocked out\.?/i, () => SS('oppOnly', 'blue', KO)],
    [/All Pok.mon on the field spin\. Those that spin White Attacks gain Wait\.?/i, () => SS('allField', 'white', [{ op: 'wait', who: 'opp', n: 1 }])],
    [/Opposing Pok.mon on the field spin\. Those that spin a Purple Attack gain Wait\.?/i, () => SS('opp', 'purpleOnly', [{ op: 'wait', who: 'opp', n: 1 }])],
    [/Attaches a Final Song marker to all Pok.mon within (\d+) steps\.\s*(?:The )?Pok.mon with that marker are knocked out (?:after )?(\d+) turns(?: later)?\.?/i, m => [{ op: 'finalSong', n: +m[1], turns: +m[2] }]],
    [/Your Pok.mon that have ([A-Za-z ]+) deal \+(\d+) damage while that Pok.mon is on the field\.?/i, m => [{ op: 'auraFor', move: m[1].trim().toLowerCase(), n: +m[2] }]],
    [/While they are on the field, your G[a-z]*ss-type Pok.mon deal \+(\d+) damage to your battle opponent\.?/i, m => [{ op: 'auraFor', types: ['grass'], n: +m[1] }]],
    [/Your Eevee and their evolutions deal \+(\d+) damage while they are on the field\.?/i, m => [{ op: 'auraFor', names: ['eevee', 'vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon'], n: +m[1] }]],
    [/Deals \+(\d+) damage for each Pok.mon that knows ([A-Za-z]+) on the field\.?/i, m => [{ op: 'countMoveBonus', n: +m[1], move: m[2].toLowerCase() }]],
    [/After this battle, this Pok.mon deals \+(\d+) damage while it is on the field\.?/i, m => [{ op: 'permBoost', n: +m[1] }]],
    [/If there is an Electric-type Pok.mon next to this Pok.mon, \+(\d+) damage\.?/i, m => [{ op: 'nearTypeBonus', type: 'electric', n: +m[1] }]],
    [/The battle opponent, and a succession of opposing Pok.mon adjacent to it, spin\. Those that spin Blue Attacks are knocked out\.?/i, () => SS('oppChain', 'blue', KO)],
    [/This Pok.mon is el?minated from the duel\.?/i, () => [{ op: 'selfRemove' }]],
    [/This Pok.mon and its battle opponent become par[a-z]*d\.?/i, () => [{ op: 'status', who: 'self', st: 'paralyzed' }, { op: 'status', who: 'opp', st: 'paralyzed' }]],
    [/Attaches an MP ?- ?(\d+) Marker to the battle opponent\.?/i, m => [{ op: 'mpMarker', who: 'opp', n: +m[1] }]],
    [/Attaches an MP ?- ?(\d+) Marker to this Pok.mon\.?/i, m => [{ op: 'mpMarker', who: 'self', n: +m[1] }]],
    [/Nullifies the effects of one of (?:this Pok.mon's battle opponent's|the opponent's) in-use plates, and that plate counts as having been used\.?/i, () => [{ op: 'breakEnergy' }]],
    [/Poisons an opposing Pok.mon within (\d+) steps\.\s*Nullifies the effects of one of that Pok.mon's in-use[^.]*\.\s*The nullified plate counts as having been used\.?/i, m => [{ op: 'statusPick', n: +m[1], st: 'poisoned' }, { op: 'breakEnergy' }]],
    [/Deals x(\d+) damage if the battle opponent is paralyzed\.?/i, m => [{ op: 'condMult', n: +m[1], sts: ['paralyzed'] }]],
    [/This Pok.mon and its battle opponent move to the Ultra Space outside of the field\.?/i, () => [{ op: 'ultraEnter' }]],
    [/If there are any Pok.mon in the Ultra Space, this damage is multiplied by the number of those Pok.mon\.?/i, () => [{ op: 'ultraMult' }]],
    [/Move one of your Pok.mon that is in the Ultra Space to a point (\d+) steps away from this Pok.mon\.?/i, m => [{ op: 'callSignal', n: +m[1] }]],
    [/Moves one opposing Pok.mon in the Ultra Space to a point of your choosing on the field\.\s*That Pok.mon gains Wait (\d+)\.?/i, m => [{ op: 'ultraBelch', w: +m[1] }]],
    [/If there are any Pok.mon in the Ultra Space, a Pok.mon on the field spins\. If it spins a White Attack, it becomes Paralyzed\.[^]*$/i, () => [{ op: 'ultraSpin', who: 'any', st: 'paralyzed' }]],
    [/If there is any Pok.mon in the Ultra Space, an opposing Pok.mon on the field spins\. If it spins a White Attack, it becomes noxious\.[^]*$/i, () => [{ op: 'ultraSpin', who: 'opp', st: 'noxious' }]],
    [/An opposing Pok.mon within X\+1 steps spins, where X is the number of Pok.mon in the Ultra Space\. If it spins a Purple Attack, that Pok.mon is excluded from the duel\.?/i, () => [{ op: 'lightBurns' }]],
    [/Temporarily excludes its battle opponent from the duel if it is a Rock- or Fairy-type Pok.mon\.\s*That Pok.mon returns to the bench after (\d+) turns\.?/i, m => [{ op: 'excludeOppIfType', types: ['rock', 'fairy'], turns: +m[1] }]],
    [/Moves all Fire-type and Flying-type Pok.mon that are adjacent to this Pok.mon to the bench\.?/i, () => [{ op: 'benchAdjType', types: ['fire', 'flying'] }]],
    [/All adjacent Pok.mon on the field spin\. Those that spin a Blue Attack are knocked out\.?/i, () => SS('adjSelf', 'blue', KO)],
    [/All other Pok.mon on the field spin\. Those that spin a Blue Attack are knocked out\.?/i, () => SS('allOther', 'blue', KO)],
    [/Spin for all opposing Pok.mon on the field\.\s*If they spin a Miss \([^)]*\), they are knocked out\.(?: If they spin a Blue Attack, they move to the bench and gain Wait\.?)?/i, (m) => /Blue Attack/.test(m[0]) ? [{ op: 'spinSel', who: 'opp', rules: [{ cond: 'miss', then: KO }, { cond: 'blue', then: [{ op: 'bench' }, { op: 'wait', who: 'opp', n: 1 }] }] }] : SS('opp', 'miss', KO)],
    [/This attack's damage is boosted by (\d+) for each Pok.mon in your P\.?C\.?/i, m => [{ op: 'pcBonus', n: +m[1] }]],
    [/If the battle opponent spins an Attack of (\d+) damage or higher, the battle opponent is knocked out instead of this Pok.mon\.?/i, m => [{ op: 'counter', n: +m[1] }]],
    [/If the battle opponent's Attack is (\d+) or more, the battle opponent is knocked out instead of this Pok.mon\.?/i, m => [{ op: 'counter', n: +m[1] }]],
    [/In the battle opponent's next battle, that Pok.mon's White Attacks become misses\.?/i, () => [{ op: 'missMark', colors: ['White'], once: true }]],
    [/Moves Murkrow in the P\.C\.? To your bench\.?/i, () => [{ op: 'callFromPC', name: 'murkrow' }]],
    [/All adjacent Water-type Pok.mon become paralyzed\.\s*On the next turn, this Pok.mon deals \+(\d+) damage\.?/i, m => [{ op: 'statusAdjType', type: 'water', st: 'paralyzed' }, { op: 'boostTurn', n: +m[1] }]],
    [/Choose one Pok.mon in your P\.?C\.? and move it to the bench\.?/i, () => [{ op: 'pickFx', cand: 'ownPC', then: [{ op: 'pcToBench' }] }]],
    [/Removes the asleep condition from your Pok.mon and moves all your Pok.mon that are in a P\.?C\.? To the ben[a-z]*\.\s*Then, this Pok.mon moves to your P\.?C\.?/i, () => [{ op: 'lunarDance' }]],
    [/In battle on the next turn, this Pok.mon's battle opponent is knocked out if it spins a White Attack\.?/i, () => [{ op: 'shellTrap' }]],
    [/If a battle opponent uses an Attack that attaches a marker or causes a special condition, that effect will be caused on the battle opponent instead\.?/i, () => [{ op: 'magicCoat' }]],
    [/If the battle opponent's Attack would inflict a marker or special condition on this Pok.mon, that effect is instead inflicted on the opponent\.?/i, () => [{ op: 'magicCoat' }]],
    [/Attaches a Full marker to this Pok.mon\.[\s\S]*$/i, () => [{ op: 'fullMark' }]],
    [/If this Pok.mon is knocked out, all Po.mon within (\d+) steps become poisoned\.?/i, m => [{ op: 'onSelfKOWithin', n: +m[1], st: 'poisoned' }]],
    [/Opposing Psychic-type Pok.mon on the field spin\. Those that spin White Attacks gain Wait (\d+)\.?/i, m => SS('opp', 'white', [{ op: 'wait', who: 'opp', n: +m[1] }], { only: ['psychic'] })],
    [/If the battle opponent is under an effect that increases Attack damage, this Attack deals \+(\d+) damage\.?/i, m => [{ op: 'punishBonus', n: +m[1] }]],
    [/Spin for adjacent opposing Pok.mon\.\s*Any attacks spun become misses for the next turn\.?/i, () => SS('adjSelfOpp', 'any', [{ op: 'missNextOpp' }])],
    [/All opposing Pok.mon on the field spin\. Those that spin a Miss become frozen\.?/i, () => SS('opp', 'miss', [{ op: 'status', who: 'opp', st: 'frozen' }])],
    [/Deal \+(\d+) damage if the battle opponent is an? (\w+)-type Pok.mon\.?/i, m => [{ op: 'typeBonus', type: m[2].toLowerCase(), n: +m[1] }]],
    [/If this Pok.mon is affected by a special condition, it deals x(\d+) damage\.?/i, m => [{ op: 'selfCondMult', n: +m[1] }]],
    [/If this Pok.mon has a special condition, this Attack's damage is cut in half\.?/i, () => [{ op: 'selfCondMult', n: 0.5 }]],
    [/If the battle opponent has a Cracker?d marker on it, exclude the battle opponent from the duel\.?/i, () => [{ op: 'excludeIfCracked' }]],
    [/All opposing Pok.mon and all your Water-type Pok.mon on the field spin\. Those that spin Purple Attacks become paralyzed\.?/i, () => SS('oppAndOwnType', 'purpleOnly', [{ op: 'status', who: 'opp', st: 'paralyzed' }], { type: 'water' })],
    [/Excludes one of the opponent's used plates from the duel\.?/i, () => [{ op: 'plateExclude' }]],
    [/While the battle opponent is on the field, that Pok.mon loses any Ability effects that allow it to MP move through other Pok.mon\.?/i, () => [{ op: 'noPassAbility' }]],
    [/This Pok.mon spins\. If it spins a miss \([^)]*\), it is knocked out\.?/i, () => [{ op: 'selfSpinKO' }]],
    [/All opposing non-Flying-type Pok.mon on the field spin\. Those that spin a Purple Attack are knocked out\.\s*Opposing Pok.mon on the bench gain Wait (\d+)\.?/i, m => [...SS('opp', 'purpleOnly', KO, { not: ['flying'] }), { op: 'waitBenchOpp', n: +m[1] }]],
    [/All opposing Pok.mon on the field spin\. Those that spin a Purple Attack are knocked out\.?/i, () => SS('opp', 'purpleOnly', KO)],
    [/This Pok.mon can change form to one of your Rotom\.?/i, () => [{ op: 'pickFx', cand: 'ownBenchName:rotom', optional: true, then: [{ op: 'benchSwap' }] }]],
    [/You may move this Pok.mon to the bench\. When you do, change this Pok.mon's form, if possible\.?/i, () => [{ op: 'pickFx', cand: 'self', optional: true, then: [{ op: 'selfBench' }] }]],
    [/One Bug-type Pok.mon on the field, or one other Pok.mon within (\d+) steps moves 1 step\. That Pok.mon gains wait\.?/i, m => [{ op: 'pickFx', cand: 'guideLight:' + m[1], then: [{ op: 'stepMove' }, { op: 'wait', who: 'opp', n: 1 }] }]],
    [/This attack's damage is boosted by the amount of any Attack damage increases from the battle opponent's Abilit[a-z]*\.?/i, () => [{ op: 'spectralThief' }]],
    [/All adjacent Pok.mon become par[a-z]*d\.?/i, () => [{ op: 'statusAdjAll', st: 'paralyzed' }]],
    [/Reduces the opponent's Z-Move gauge by two thirds of its max value\.?/i, () => [{ op: 'zDrain', f: 2 / 3 }]],
    [/This Pok.mon moves to your P\.?C\.? The battle opponent moves to your P\.?C\.?/i, () => [{ op: 'pc' }, { op: 'selfPC' }]],
    [/Until the end of your turn, if the Pok.mon hit by this Attack spins a Purple attack or Blue Attack, shift the result clockwise until a non-Purple, non-Blue attack comes up\.?/i, () => [{ op: 'tauntMark', now: true }]],
    [/Spin again - if ([\w' ]+?) is spun, it deals x(\d+) damage\.?/i, m => [{ op: 'multAgain', name: m[1].trim().toLowerCase(), n: +m[2] }]],
    [/Knocks the battle opponent and all Pok.mon in a straight line directly behind it as far back as possible \(the battle opponent is not knocked out\)\.\s*Those Pok.mon gain Wait\.?/i, () => [{ op: 'shove', n: 1 }]],
    [/For 5 turns, the Gold Attacks of all Pok.mon become Misses[\s\S]*$/i, () => [{ op: 'trickRoom', turns: 5 }]],
    [/You can move this Pok.mon to an open spot next to an adjacent figure \(or adjacent figures in succession to the first\)\.?/i, () => [{ op: 'selfMove', n: 1, chain: true }]],
    [/If this Pok.mon is knocked out, the battle opponent will become Poisoned/i, () => [{ op: 'onSelfKO', st: 'poisoned' }]],
  );
  for (const [re, fn] of WHOLE) { const m = text.match(re); if (m) { ops.push(...fn(m)); text = text.replace(re, ' '); } }
  const sents = text.split(/(?<=[.!])\s+(?=[A-Z])/).filter(x => x.trim());
  for (let s of sents) {
    const l = s.toLowerCase();
    let m, st;
    // --- v4 patterns
    { const stw = x => (x ? stWord(x) : null); let mm, s2;
      if ((mm = l.match(/^(?:the )?(?:battle opponent|opponent pok.mon) (?:is|are) (?:now )?(\w+)\.?$/)) && stw(mm[1])) { ops.push({ op: 'status', who: 'opp', st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^one pok.mon within (\d+) steps becomes (\w+)/)) && stw(mm[2])) { ops.push({ op: 'statusPick', n: +mm[1], st: stw(mm[2]) }); continue; }
      if ((mm = l.match(/^may cause one pok.mon within (\d+) steps to become (\w+)/)) && stw(mm[2])) { ops.push({ op: 'statusPick', n: +mm[1], st: stw(mm[2]) }); continue; }
      if ((mm = l.match(/^(?:if this pok.mon (?:is knocked out|faints), )(?:the )?(?:battle opponent|opponent pok.mon) (?:becomes|will become) (\w+)/)) && stw(mm[1])) { ops.push({ op: 'onSelfKO', st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^if this pok.mon is knocked out, all pok.mon within (\d+) steps become (\w+)/)) && stw(mm[2])) { ops.push({ op: 'onSelfKOWithin', n: +mm[1], st: stw(mm[2]) }); continue; }
      if ((mm = l.match(/^if this pok.mon is knocked out, the battle opponent gains an mp-(\d+) marker/))) { ops.push({ op: 'onSelfKO', mp: +mm[1] }); continue; }
      if ((mm = l.match(/^(?:if this pok.mon faints, the battle opponent moves to your p\.?c)/))) { ops.push({ op: 'onSelfKOPC' }); continue; }
      if ((mm = l.match(/^the battle opponent,? and a (?:a )?succession of (?:opposing )?pok.mon adjacent to it(?: \(excluding this one\))?,? (?:become|are) (\w+)/)) && stw(mm[1])) { ops.push({ op: 'statusChain', st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^the battle opponent,? and a succession of opposing pok.mon adjacent to it,? gain wait (\d+)/))) { ops.push({ op: 'statusChain', wait: +mm[1] }); continue; }
      if ((mm = l.match(/^all pok.mon adjacent to the opponent pok.mon are (\w+)/)) && stw(mm[1])) { ops.push({ op: 'statusArea', area: { kind: 'adj' }, st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^this pok.mon and all neigh?bou?r pok.mon become (\w+)/)) && stw(mm[1])) { ops.push({ op: 'status', who: 'self', st: stw(mm[1]) }, { op: 'statusAdjAll', st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^all neigh?bou?r pok.mon become (\w+)/)) && stw(mm[1])) { ops.push({ op: 'statusAdjAll', st: stw(mm[1]) }); continue; }
      if ((mm = l.match(/^all (?:adjacent|neigh?bou?r) pok.mon (?:now )?(?:gain|have) wait ?(\d+)?/))) { ops.push({ op: 'waitAdjAll', n: +(mm[1] || 1) }); continue; }
      if ((mm = l.match(/^the battle opponent and all pok.mon directly behind it are given wait/))) { ops.push({ op: 'statusArea', area: { kind: 'behind' }, wait: 1 }, { op: 'wait', who: 'opp', n: 1 }); continue; }
      if ((mm = l.match(/^if the battle opponent is paralyzed, deal x(\d+) damage/))) { ops.push({ op: 'condMult', n: +mm[1], sts: ['paralyzed'] }); continue; }
      if ((mm = l.match(/^deals x(\d+) damage if the battle opponent is (?:poisoned or noxious)/))) { ops.push({ op: 'condMult', n: +mm[1], sts: ['poisoned', 'noxious'] }); continue; }
      if ((mm = l.match(/^deals x(\d+) damage if the battle opponent is an? (\w+)-type pok.mon/))) { ops.push({ op: 'condMult', n: +mm[1], type: mm[2] }); continue; }
      if ((mm = l.match(/^if the battle opponent has a status condition, damage is x(\d+)/))) { ops.push({ op: 'condMult', n: +mm[1] }); continue; }
      if ((mm = l.match(/if the battle opponent's attack is (below|[\d]+ damage or more|\d+ damage or below), this pok.mon cannot be knocked out/)) || (mm = l.match(/if the battle opponent's attack is (below) (\d+) damage, this pok.mon cannot be knocked out/))) {
        const t = l.match(/attack is below (\d+)/), u = l.match(/(\d+) damage or more/), w = l.match(/(\d+) damage or below/);
        ops.push(t ? { op: 'safeIf', cmp: 'lt', n: +t[1] } : u ? { op: 'safeIf', cmp: 'gte', n: +u[1] } : { op: 'safeIf', cmp: 'lte', n: +w[1] }); continue; }
      if ((mm = l.match(/^if the battle opponent spins an attack of (\d+) damage or less, this pok.mon is not knocked out/))) { ops.push({ op: 'safeIf', cmp: 'lte', n: +mm[1] }); continue; }
      if ((mm = l.match(/^if the damage inflicted onto this pok.mon is (\d+) or less, this pok.mon does not faint/))) { ops.push({ op: 'safeIf', cmp: 'lte', n: +mm[1] }); continue; }
      if (/^increases your z-move gauge by half/.test(l)) { ops.push({ op: 'zGain', n: 50 }); continue; }
      if (/if the battle opponent is knocked out, the next turn will always be the other player's/.test(l)) { ops.push({ op: 'skipNextIfKO' }); continue; }
      if ((mm = l.match(/^attach mp -(\d+) to battle opponent/))) { ops.push({ op: 'mpMarker', who: 'opp', n: +mm[1] }); continue; }
      if ((mm = l.match(/on the next turn, this pok.mon gains \+(\d+) mp/))) { ops.push({ op: 'mpBuff', n: +mm[1], self: true }); continue; }
      if ((mm = l.match(/^your (\w+)-type pok.mon gain \+(\d+) mp until the end of your next turn/))) { ops.push({ op: 'mpBuff', n: +mm[2], types: [mm[1]] }); continue; }
      if (/until the end of your next turn, the white attacks of this pok.mon become gold attacks/.test(l)) { ops.push({ op: 'goldNext' }); continue; }
      if (/(?:on the next turn|in the battle opponent's next battle),? (?:that pok.mon's |all the )?purple attacks (?:of the battle opponent of this pok.mon )?become misses/.test(l) || /in the battle opponent's next battle, that pok.mon's purple attacks become misses/.test(l)) { ops.push({ op: 'missMark', colors: ['Purple'], turn: /on the next turn/.test(l) }); continue; }
      if (/the blue attacks of the pok.mon hit by this attack will be misses during the next turn/.test(l)) { ops.push({ op: 'missMark', colors: ['Blue'], any: true, turn: true }); continue; }
      if (/on the next turn, any blue attacks of opposing pok.mon that are not dodge become misses/.test(l)) { ops.push({ op: 'missMarkAllOpp', colors: ['Blue'] }); continue; }
      if (/all adjacent pok.mon gain wait (\d+)\. the purple attacks of the pok.mon hit by this attack will be misses during the next turn/.test(l)) { ops.push({ op: 'waitAdjAll', n: +l.match(/wait (\d+)/)[1] }); continue; }
      if ((mm = l.match(/while they are on the field, your (\w+)-type pok.mon deal \+(\d+) damage to the battle opponent/)) || (mm = l.match(/when this pok.mon is on the field, your (\w+)-type pok.mon receive a \+(\d+) boost to attack damage/))) { ops.push({ op: 'addRule', rule: { k: 'aura', types: [mm[1]], n: +mm[2], healthy: false, per: null } }); continue; }
      if (/^this pok.mon switches with (?:a|another) (?:of your )?pok.mon (?:on|from) your bench or in your p\.?c/.test(l) || /^this pok.mon switches with a pok.mon on your bench or in your p\.?c/.test(l)) { ops.push({ op: 'swapIn', src: 'both' }); continue; }
      if (/^this pok.mon switches with (?:a pok.mon on your bench|another of your pok.mon from the bench)/.test(l)) { ops.push({ op: 'swapIn', src: 'bench' }); continue; }
      if (/^this pok.mon may switch with (?:a|another) (?:of your )?pok.mon (?:on|from) your bench/.test(l)) { ops.push({ op: 'swapIn', src: 'bench', ifAlive: true }); continue; }
      if (/^this pok.mon switches with another of your pok.mon from the p\.?c/.test(l)) { ops.push({ op: 'swapIn', src: 'pc' }); continue; }
      if (/if this pok.mon is not knocked out, you may switch this pok.mon with 1 of your benched pok.mon/.test(l)) { ops.push({ op: 'swapIn', src: 'bench', ifAlive: true }); continue; }
      if (/if one of your (?:own )?pok.mon neigh?bou?rs this pok.mon, the two switch places/.test(l)) { ops.push({ op: 'swapIn', src: 'adjOwn' }); continue; }
      if (/^(?:this pok.mon switches place with its battle opponent|switch this pok.mon with the adjacent opponent pok.mon)/.test(l)) { ops.push({ op: 'swap' }); continue; }
      if (/^all other pok.mon on the field spin\W+ those that spin purple are knocked out/.test(l)) { ops.push({ op: 'spinGroup', group: 'allOther', cond: 'purpleOnly', then: [{ op: 'ko', who: 'opp' }] }); continue; }
      if (/^all neigh?bou?r pok.mon spin\W+ those that miss are knocked out/.test(l)) { ops.push({ op: 'spinGroup', group: 'adjAll', cond: 'miss', then: [{ op: 'ko', who: 'opp' }] }); continue; }
      if (/^all opposing pok.mon on the field spin\. those that spin a miss are knocked out/.test(l)) { ops.push({ op: 'spinGroup', group: 'allOpp', cond: 'miss', then: [{ op: 'ko', who: 'opp' }] }); continue; }
      if (/^opposing pok.mon adjacent to this pok.mon spin, and if they spin a gold attack then they are knocked out/.test(l)) { ops.push({ op: 'spinGroup', group: 'adjSelfOpp', cond: 'gold', then: [{ op: 'ko', who: 'opp' }] }); continue; }
      if (/^all opposing flying-type pok.mon on the field spin\. those that spin a miss or a white attack of (\d+) damage or less are knocked out/.test(l)) { ops.push({ op: 'spinGroup', group: 'oppFlying', cond: 'missOrWhiteLE', n: +l.match(/of (\d+) damage/)[1], then: [{ op: 'ko', who: 'opp' }] }); continue; }
      if (/^all pok.mon on the field will spin their wheel\. if is misses, the pok.mon is sent to the pc/.test(l)) { ops.push({ op: 'spinGroup', group: 'allField', cond: 'miss', then: [{ op: 'pc', who: 'opp' }] }); continue; }
      if (/^knock out 1 of your opponent's flying-type pok.mon within 2 steps/.test(l)) { ops.push({ op: 'koPick', n: 2, type: 'flying' }); continue; }
    }
    // --- v3 patterns
    if (/^all neighbou?r pok.mon become confused/.test(l)) { ops.push({ op: 'statusAdjAll', st: 'confused' }); continue; }
    if (/if this pok.mon is knocked out, the opponent pok.mon is confused/.test(l)) { ops.push({ op: 'onSelfKO', st: 'confused' }); continue; }
    if (/may cause one opponent within (\d+) steps to become confused/.test(l)) { ops.push({ op: 'statusPick', n: +l.match(/within (\d+) steps/)[1], st: 'confused' }); continue; }
    if (/^the battle opponent, or one opposing pok.mon adjacent to a succession of pok.mon adjacent to this pok.mon, become confused/.test(l)) { ops.push({ op: 'status', who: 'opp', st: 'confused' }); continue; }
    if (/move this pok.mon to an open slot next to an adjacent figure/.test(l)) { ops.push({ op: 'selfMove', n: 1, chain: true }); continue; }
    if ((m = l.match(/^if the battle opponent is knocked out, this pok.mon moves (?:one|1) step and gains wait/))) { ops.push({ op: 'selfMove', n: 1, ifKO: true }, { op: 'wait', who: 'self', n: 1 }); continue; }
    if ((m = l.match(/the battle opponent is moved to a (?:point|spot) (\d+) steps? away and has an mp-(\d+) marker/))) { ops.push({ op: 'knockback', n: +m[1], choose: true, by: 'self' }, { op: 'mpMarker', who: 'opp', n: +m[2] }); continue; }
    if ((m = l.match(/^moves the battle opponent to a (?:point|spot) (\d+) steps? away/))) { ops.push({ op: 'knockback', n: +m[1], choose: true, by: 'self' }); continue; }
    if ((m = l.match(/^the battle opponent also becomes (\w+)/)) && stWord(m[1])) { ops.push({ op: 'status', who: 'opp', st: stWord(m[1]) }); continue; }
    if (/^this pok.mon falls asleep\.?$/.test(l)) { ops.push({ op: 'status', who: 'self', st: 'asleep' }); continue; }
    if (/^all adjacent pok.mon are asleep/.test(l)) { ops.push({ op: 'statusAdjAll', st: 'asleep' }); continue; }
    if (/the battle opponent and all pok.mon of the same species as the battle opponent fall asleep/.test(l)) { ops.push({ op: 'statusSpecies', st: 'asleep' }); continue; }
    if (/the battle opponents? fall asleep/.test(l)) { ops.push({ op: 'status', who: 'opp', st: 'asleep' }); continue; }
    if (/the battle opponent either becomes poisoned, paralyzed, or fals? asleep/.test(l)) { ops.push({ op: 'statusRandom', list: ['poisoned', 'paralyzed', 'asleep'] }); continue; }
    if ((m = l.match(/the battle opponent and opposing pok.mon adjacent to it become (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'status', who: 'opp', st }, { op: 'statusArea', area: { kind: 'adj' }, st }); continue; }
    if ((m = l.match(/the battle opponent, and the pok.mon in a straight line directly behind it,? become (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'status', who: 'opp', st }, { op: 'statusArea', area: { kind: 'behind' }, st }); continue; }
    if ((m = l.match(/^those pok.mon gains? wait ?(\d+)?/))) { const n = +(m[1] || 1); const last = [...ops].reverse().find(o => o.op === 'statusArea'); if (last) { last.wait = n; ops.push({ op: 'wait', who: 'opp', n }); continue; } }
    if ((m = l.match(/the battle opponent is knocked\s+back (\d+) steps?( and gains wait)?/))) { ops.push({ op: 'knockback', n: +m[1] }); if (m[2]) ops.push({ op: 'wait', who: 'opp', n: 1 }); continue; }
    if ((m = l.match(/^(?:adjacent opposing pok.mon|all neighbou?r pok.mon) are knocked (\d+) steps? back(?: and gain wait)?/))) { ops.push({ op: 'knockAdj', n: +m[1], all: /neighbou?r/.test(l), wait: /gain wait/.test(l) || undefined }); continue; }
    if (/^those pok.mon gain wait\.?$/.test(l) && ops.length && ops[ops.length - 1].op === 'knockAdj') { ops[ops.length - 1].wait = true; continue; }
    if (/the battle opponent is moved back to the bench and gains wait/.test(l)) { ops.push({ op: 'bench', who: 'opp' }, { op: 'wait', who: 'opp', n: 1 }); continue; }
    if ((m = l.match(/this pok.mon moves to the bench and gains wait ?(\d+)?/))) { ops.push({ op: 'selfBench' }, { op: 'wait', who: 'self', n: +(m[1] || 1) }); continue; }
    if ((m = l.match(/this pok.mon can move to a point that is (\d+) steps away\. in that case, it gains wait/))) { ops.push({ op: 'selfMove', n: +m[1] }, { op: 'wait', who: 'self', n: 1 }); continue; }
    if (/^your pok.mon gains wait\.?$/.test(l)) { ops.push({ op: 'wait', who: 'self', n: 1 }); continue; }
    // --- v2 patterns
    if ((m = l.match(/knocks? the battle opponent (\d+) steps? back and claims its previous spot/))) { ops.push({ op: 'knockback', n: +m[1] }, { op: 'claimSpot' }); continue; }
    if (/if the battle opponent is knocked out, this pok.mon claims its previous spot/.test(l)) { ops.push({ op: 'claimSpot', ifKO: true }); if (/gains wait/.test(l)) ops.push({ op: 'wait', who: 'self', n: 1 }); continue; }
    if (/if the battle opponent's mp is the same or higher than this pok.mon's mp, the battle opponent moves to your p\.?c/.test(l)) { ops.push({ op: 'mpDuel' }); continue; }
    if (/either the battle opponent or a pok.mon behind it in a straight line from this pok.mon is knocked out/.test(l)) { ops.push({ op: 'ko', who: 'opp' }); continue; }
    if ((m = l.match(/the battle opponent temporarily moves to the ultra space, returning to the bench after (\d+) turns/))) { ops.push({ op: 'excludeOpp', turns: +m[1] }); const w = l.match(/gain wait (\d+)/); if (w) ops.push({ op: 'waitAdj', n: +w[1] }); continue; }
    if ((m = l.match(/deals \+ ?(\d+) damage if the battle opponent's mp is higher than this pok.mon's mp/))) { ops.push({ op: 'mpHigherBonus', n: +m[1] }); continue; }
    if ((m = l.match(/if the battle opponent is affected by a special condition, deal x(\d+) damage/))) { ops.push({ op: 'condMult', n: +m[1] }); continue; }
    if (/all neighbou?r pok.mon are moved to the bench and gain wait/.test(l)) { ops.push({ op: 'benchAdjAll' }); continue; }
    if (/this pok.mon and all neighbou?r pok.mon faint/.test(l)) { ops.push({ op: 'koAdjAll' }); continue; }
    if ((m = l.match(/if this pok.mon is knocked out, all adjacent pok.mon become (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'onSelfKOArea', st }); continue; }
    if (/move the battle opponent or one opposing pok.mon that is adjacent to the battle opponent to its p\.?c/.test(l)) { ops.push({ op: 'pcArea', one: true }); continue; }
    if (/move the battle opponent and opposi\w+ pok.mon adjacent to the battle opponent to their p\.?c/.test(l)) { ops.push({ op: 'pcArea', one: false }); continue; }
    if (/moves? the battle opponent to the p\.?c/.test(l)) { ops.push({ op: 'pc', who: 'opp' }); continue; }
    if ((m = l.match(/the battle opponent and one neigh?bou?r pok.mon directly behind it are knocked (\d+) steps? back and gain wait/))) { ops.push({ op: 'knockbackChain', n: +m[1] }); continue; }
    if ((m = l.match(/the battle opponent is moved (\d+) steps away from this pok.mon/))) { ops.push({ op: 'knockback', n: +m[1], choose: true, by: 'self' }); continue; }
    if ((m = l.match(/the battle opponent is now (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'status', who: 'opp', st }); continue; }
    if (/this pok.mon and the battle opponent fall asleep/.test(l)) { ops.push({ op: 'status', who: 'opp', st: 'asleep' }, { op: 'status', who: 'self', st: 'asleep' }); continue; }
    if ((m = l.match(/in this pok.mon's next battle, it cannot be knocked out/))) { ops.push({ op: 'selfFocus' }); continue; }
    if ((m = l.match(/if the battle opponent spins an attack of (\d+) or more damage, the battle opponent is knocked out/))) { ops.push({ op: 'oppDmgKO', n: +m[1] }); continue; }
    if (/the battle opponent is knocked out if they spin purple/.test(l)) { ops.push({ op: 'oppPurpleKO' }); continue; }
    // on-KO triggers
    if ((m = l.match(/if this pok.mon is knocked out(?: when using this move)?, the battle opponent becomes (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'onSelfKO', st }); continue; }
    if (/if this pok.mon is knocked out, so is the battle opponent/.test(l)) { ops.push({ op: 'onSelfKOKO' }); continue; }
    if ((m = l.match(/if the battle opponent's attack is (\d+)(?: damage)? or (?:higher|more), the opponent is knocked out instead/))) { ops.push({ op: 'counter', n: +m[1] }); continue; }
    if ((m = l.match(/if the battle opponent has mp ?(\d+) or higher, this pok.mon takes no damage and the battle opponent is knocked out/))) { ops.push({ op: 'mpCounter', n: +m[1] }); continue; }
    if ((m = l.match(/deals \+(\d+) damage if the battle opponent is an? (\w+)-type/))) { ops.push({ op: 'typeBonus', n: +m[1], type: m[2] }); }
    if (/pok.mon (?:that are |)knocked out by (?:this attack|this attack's damage|the damage|this)/.test(l) || /knocked out by this attack's damage are temporarily excluded/.test(l)) {
      const t = l.match(/(\d+) turns? later/); ops.push({ op: 'excludeOnKO', turns: t ? +t[1] : 3 }); continue;
    }
    // spin-again loops
    if ((m = l.match(/spin again until an? attack other than ([\w' ]+?) is spun\.? damage attacks deal (x|\+)(\d+)/))) { ops.push({ op: 'buffSpin', name: m[1], mode: m[2] === 'x' ? 'mult' : 'add', n: +m[3] }); continue; }
    if ((m = l.match(/spin again - if ([\w' ]+?) is spun, it deals \+(\d+)/))) { ops.push({ op: 'plusSpin', name: m[1], n: +m[2] }); continue; }
    if (/spin again until .* does not land/.test(l)) { ops.push({ op: 'multSpin' }); if (/become burned/.test(l)) ops.push({ op: 'statusArea', st: 'burned', area: { kind: 'adj' }, who: 'oppAll' }); continue; }
    // mass spins
    if ((m = l.match(/all opposing pok.mon on the field spin\.? those that spin white attacks (?:become (\w+)|get an? mp-?(\d+) marker)/))) {
      if (m[1] && stWord(m[1])) ops.push({ op: 'spinAll', cond: 'white', then: { op: 'status', st: stWord(m[1]) } });
      else if (m[2]) ops.push({ op: 'spinAll', cond: 'white', then: { op: 'mpMarker', n: +m[2] } });
      continue;
    }
    if ((m = l.match(/any pok.mon adjacent to the battle opponent other than this pok.mon spin\.? those that spin white attacks move to the bench/))) { ops.push({ op: 'spinAdj', cond: 'white', then: { op: 'bench' } }); const w = l.match(/gains wait (\d+)/); continue; }
    if ((m = l.match(/(?:a|one other) pok.mon on the field spins\.? if (?:it|they) spins? a miss or a white attack of (\d+) damage or more, (?:it|they) (?:is|are) knocked out/))) { ops.push({ op: 'spinOne', thr: +m[1] }); continue; }
    if (/all pok.mon on the field spin, except this one - if they spin a miss, they are knocked out/.test(l)) { ops.push({ op: 'spinEveryone', thr: 0 }); continue; }
    // area statuses
    if ((m = l.match(/the battle opponent and (?:opposing pok.mon within (\d+) steps of it|opposing pok.mon adjacent to the battle opponent|a succession of pok.mon adjacent to the battle opponent[^.]*?|the pok.mon in a straight line directly behind it) (?:become|becomes) (\w+)/)) && (st = stWord(m[2]))) {
      const area = /straight line/.test(l) ? { kind: 'behind' } : m[1] ? { kind: 'within', n: +m[1] } : { kind: 'adj' };
      ops.push({ op: 'status', who: 'opp', st }); ops.push({ op: 'statusArea', st, area, who: 'oppAll' }); continue;
    }
    if ((m = l.match(/an opposing pok.mon ?within (\d+) steps becomes (\w+)/)) && (st = stWord(m[2]))) { ops.push({ op: 'statusPick', n: +m[1], st }); continue; }
    // markers
    if ((m = l.match(/mp-?(\d+) marker to (?:opposing pok.mon within (\d+) steps|the battle opponent)/))) { ops.push(m[2] ? { op: 'mpMarkerWithin', n: +m[1], r: +m[2] } : { op: 'mpMarker', n: +m[1], who: 'opp' }); continue; }
    if (/cracked marker/.test(l)) { ops.push({ op: 'cracked' }); continue; }
    if (/curse marker/.test(l)) { ops.push({ op: 'curse' }); continue; }
    // direct statuses
    if ((m = l.match(/^this pok.mon becomes (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'status', who: 'self', st }); continue; }
    if ((m = l.match(/the battle opponent (?:becomes|falls) (\w+)/)) && (st = stWord(m[1]))) { ops.push({ op: 'status', who: 'opp', st }); if (/this pok.mon retreats one step/.test(l)) ops.push({ op: 'selfMove', n: 1 }); continue; }
    if (/the battle opponent falls asleep/.test(l)) { ops.push({ op: 'status', who: 'opp', st: 'asleep' }); continue; }
    // removal / bench / ko
    if (/removes all special conditions from your pok.mon/.test(l)) { ops.push({ op: 'cure', who: 'team' }); continue; }
    if ((m = l.match(/this pok.mon recovers from all status effects\. in exchange, it must then wait ?(\d+)?/)) || /recovers from all status effects/.test(l)) { ops.push({ op: 'cure', who: 'self' }); ops.push({ op: 'wait', who: 'self', n: 1 }); continue; }
    if (/moves? the battle opponent to its p\.?c/.test(l)) { ops.push({ op: 'pc', who: 'opp' }); continue; }
    if (/(?:benches your battle opponent|moves the battle opponent to the bench|the battle opponent is moved to the bench)/.test(l)) {
      ops.push({ op: 'bench', who: 'opp' }); if (/gains wait|must then wait/.test(l)) ops.push({ op: 'wait', who: 'opp', n: 1 }); continue;
    }
    if (/this pok.mon and the battle opponent are knocked out/.test(l)) { ops.push({ op: 'ko', who: 'both' }); continue; }
    if (/^knocks out the battle opponent|the battle opponent is knocked out\.?$/.test(l) && !/if /.test(l)) { ops.push({ op: 'ko', who: 'opp' }); continue; }
    if (/switches places with its battle opponent/.test(l)) { ops.push({ op: 'swap' }); continue; }
    // knockback / movement
    if ((m = l.match(/the battle opponent is knocked (\d+) steps? back/))) { ops.push({ op: 'knockback', n: +m[1], choose: /chooses the point/.test(l) }); if (/gains wait|has wait/.test(l)) ops.push({ op: 'wait', who: 'opp', n: 1 }); continue; }
    if (/knocked as far back as possible in a straight line/.test(l)) { ops.push({ op: 'shove', n: /gain wait/.test(l) ? 1 : 0 }); continue; }
    if ((m = l.match(/this pok.mon (?:moves|can take) (?:to a (?:point|spot) )?(\d+)(?:-(\d+))? steps? (?:away|back)(?: after battle)?/)) || (m = l.match(/if this pok.mon is on the field, this pok.mon moves to a point (\d+)/))) {
      const hi = m[2] ? +m[2] : undefined;
      if (!/becomes a miss/.test(l)) { ops.push({ op: 'selfMove', n: +m[1], hi, ifKO: /if the battle opponent is knocked out/.test(l), ...(/steps? back/.test(l) ? { back: true } : {}) }); } else ops.push({ op: 'selfMove', n: +m[1], hi, noSteel: true }); continue;
    }
    if (/jumps? over (?:its |the )?battle opponent and lands on a surrounding point/.test(l)) { ops.push({ op: 'selfMove', n: 1, hi: 1, jump: true, around: true }); continue; }
    if (/jumps? over (?:its |the )?battle opponent/.test(l)) { const r = l.match(/lands (\d+)-(\d+) steps away/) || l.match(/lands (\d+) steps? away/); ops.push({ op: 'selfMove', n: r ? +r[1] : 1, hi: r && r[2] ? +r[2] : r ? +r[1] : 1, jump: true }); continue; }
    if ((m = l.match(/if the battle opponent is knocked out, then after the battle, this pok.mon moves to a point (\d+)/))) { ops.push({ op: 'selfMove', n: +m[1], ifKO: true }); continue; }
    if (/reduces the opponet?n?'?s z-move gauge by two thirds/.test(l)) { ops.push({ op: 'zDrain', f: 2 / 3 }); continue; }
    // wait
    if ((m = l.match(/the battle opponent and (?:opposing pok.mon adjacent to the battle opponent|opposing pok.mon within \d+ steps of it) gain wait ?(\d+)?/))) { ops.push({ op: 'wait', who: 'opp', n: +(m[1] || 1) }); ops.push({ op: 'waitAdj', n: +(m[1] || 1) }); continue; }
    if ((m = l.match(/the battle opponent (?:now )?(?:gains|has) wait ?(\d+)?/))) { ops.push({ op: 'wait', who: 'opp', n: +(m[1] || 1) }); continue; }
    if ((m = l.match(/this pok.mon gains wait ?(\d+)?/))) { ops.push({ op: 'wait', who: 'self', n: +(m[1] || 1) }); continue; }
    if (/on the next turn, your opponent cannot use plates/.test(l)) { ops.push({ op: 'plateLock' }); continue; }
    if (/attack becomes a miss for the next turn/.test(l)) { ops.push({ op: 'selfMissNext' }); continue; }
  }
  return ops;
}

// ---- build figure records ----------------------------------------------------
const FIGS = {};
const LIST = [];
for (const p of raw) {
  const idm = String(p['ID No.'] || '').match(/(\d+)/); if (!idm) continue;
  const id = +idm[1];
  if (FIGS[id]) continue;
  const segs = [], zsegs = [];
  for (const mv of p.Moves || []) {
    const mt = String(mv['Move Type'] || '').trim(); if (!mt) continue;
    const size = parseFloat(mv['Base Wheel Size']); if (!(size > 0)) continue;
    const isZ = /z-move/i.test(mt);
    let color = /purple/i.test(mt) ? 'Purple' : /white/i.test(mt) ? 'White' : /gold/i.test(mt) ? 'Gold' : /blue/i.test(mt) ? 'Blue' : /red/i.test(mt) ? 'Red' : 'White';
    if (isZ && /^z-move$/i.test(mt)) color = 'White';
    const seg = { name: (mv.Name || '').trim() || (color === 'Red' ? 'Miss' : '???'), color, size, dmg: parseDamage(mv.Damage), notes: (mv['Additional Notes'] || '').trim(), z: isZ };
    seg.ops = parseEffects(seg.notes);
    seg.simulated = !seg.notes || seg.ops.length > 0;
    seg.isMiss = color === 'Red' || /^miss$/i.test(seg.name);
    (isZ ? zsegs : segs).push(seg);
  }
  const ability = String(p['Special Ability'] || '');
  const types = String(p.Type || '').split('/').map(s => s.trim().toLowerCase()).filter(Boolean);
  const f = {
    id, name: p['Pokémon Name'], rarity: p.Rarity, mp: Math.max(0, parseInt(p.Movement) || 0),
    cost: parseInt(p['Material Cost']) || 0, picture: p.Picture, types,
    ability, abilityName: (ability.match(/^([^-]{2,40}?)\s+-\s+/) || [])[1] || '',
    segs, zsegs, flags: abilityFlags(ability), rules: parseRules(ability),
  };
  if (!f.segs.length) f.segs = [{ name: 'Miss', color: 'Red', size: 96, dmg: { kind: 'none', n: 0 }, notes: '', ops: [], isMiss: true, z: false, simulated: true }];
  f.total = f.segs.reduce((a, s) => a + s.size, 0);
  f.wheelSample = f.segs.map(s => ({ name: s.name, color: s.color, size: s.size, dmg: s.dmg, notes: s.notes, simulated: s.simulated }));
  FIGS[id] = f; LIST.push(f);
}

function abilityFlags(text) {
  const t = text.toLowerCase(), fl = {}; if (!t || t.startsWith('none')) return fl;
  if (/pass through other pok|mp move through other pok|move through other pok|can mp move past other pok|may mp move through other/.test(t)) fl.passThrough = true;
  if (/fly over pok.mon (?:on the field )?that don't have soar|can fly over/.test(t)) fl.flyOver = true;
  if (/cannot be affected by sleep/.test(t)) fl.sleepImmune = true;
  if (/(?:is )?not knocked out in battle ?[-–]? ?\(?if it would be, it moves to the bench/.test(t)) fl.koToBench = true;
  let m;
  if ((m = t.match(/if this pok.mon has a special condition, it deals \+(\d+) damage/))) fl.condBonus = +m[1];
  if ((m = t.match(/if this pok.mon is not affected by a special condition, it deals \+(\d+) damage/))) fl.healthyBonus = +m[1];
  if ((m = t.match(/opponent has groudon, kyogre or rayquaza on the field, this pok.mon does \+(\d+)/))) fl.legendBonus = +m[1];
  if ((m = t.match(/if this pok.mon is at an entry point, this pok.mon deals \+(\d+)/))) fl.entryBonus = +m[1];
  if (/damage deal[dt]? to this pok.mon by its battle opponents[^.]*is cut in half/.test(t)) fl.halfDmg = true;
  if (/pok.mon that battle with this pok.mon gain wait/.test(t)) fl.battlerWait = true;
  if (/any pok.mon that battles this pok.mon will become poisoned/.test(t)) fl.battlerPoison = true;
  if (/all the blue attacks of the battle opponents of this pok.mon become misses/.test(t)) fl.blueToMiss = true;
  if (/gains wait (\d+) at the start of the duel/.test(t)) fl.startWait = +t.match(/gains wait (\d+) at the start/)[1];
  if (/when this pok.mon moves from the bench to the field, remove any special conditions from all of your pok.mon/.test(t)) fl.cureOnEntry = true;
  if (/if this pok.mon is knocked out, it is removed from the duel/.test(t)) fl.removeOnKO = true;
  if ((m = t.match(/when this pok.mon evolves, it will gain \+(\d+) mp/))) fl.evoMp = +m[1];
  return fl;
}

module.exports = { FIGS, LIST, parseEffects, parseDamage };
