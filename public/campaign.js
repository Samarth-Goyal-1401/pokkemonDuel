// Single-player campaign. Progress is stored on the server under the signed-in account (no copies are kept in the browser).
(function () {
  const KEY = 'duel_camp_v1';
  const RAR = ['C', 'UC', 'R', 'EX', 'UX'];
  const RCOL = { C: '#9aa7c7', UC: '#5cc77d', R: '#4aa3ff', EX: '#c58cf2', UX: '#ffcb05' };
  const RNAME = { C: 'Common', UC: 'Uncommon', R: 'Rare', EX: 'Ex', UX: 'Ultra' };
  const SELL = { C: 100, UC: 180, R: 720, EX: 1600, UX: 2000 };
  const CHESTS = [
    { id: 'bronze', name: 'Bronze Chest', price: 300, icon: '📦', col: '#b87333', odds: { C: 55, UC: 35, R: 9, EX: 1, UX: 0 } },
    { id: 'silver', name: 'Silver Chest', price: 1000, icon: '🎁', col: '#c0c8d8', odds: { C: 10, UC: 45, R: 38, EX: 6, UX: 1 } },
    { id: 'gold', name: 'Gold Chest', price: 2500, icon: '🧰', col: '#ffcb05', odds: { C: 0, UC: 15, R: 50, EX: 28, UX: 7 } },
    { id: 'mythic', name: 'Mythic Chest', price: 5000, icon: '💎', col: '#c58cf2', odds: { C: 0, UC: 0, R: 30, EX: 45, UX: 25 } },
  ];
  // ---- stages generated from CAMP_CHAPTERS (public/campaign_story.js)
  const rarFor = p => p < 0.08 ? ['C'] : p < 0.2 ? ['C', 'UC'] : p < 0.32 ? ['UC'] : p < 0.45 ? ['UC', 'R'] : p < 0.58 ? ['R'] : p < 0.7 ? ['R', 'EX'] : p < 0.82 ? ['EX'] : p < 0.92 ? ['EX', 'UX'] : ['UX'];
  const CH = window.CAMP_CHAPTERS; const BOSSES = []; let N = 0; const BASE = Math.min(72, 1e9); CH.forEach(ch => (N += ch.fights.length));
  CH.forEach((ch, ci) => ch.fights.forEach((f, fi) => {
    const idx = BOSSES.length, p = Math.min(1, idx / (BASE - 1)), last = fi === ch.fights.length - 1; const reward = Math.round((100 + (idx < BASE ? idx : BASE + (idx - BASE) * 0.5) * 50) * (last ? 2 : 1) / 10) * 10;
    BOSSES.push({ id: ch.id + '_' + fi, idx, ch: ci, fi, name: f[0], title: f[1], types: f[2], ace: f[3], say: f[4], rar: last && p > 0.1 ? rarFor(Math.min(1, p + 0.1)) : rarFor(p), skill: idx === BASE - 1 ? 0.99 : idx >= BASE ? Math.min(0.99, 0.97 + 0.02 * (idx - BASE) / Math.max(1, N - BASE - 1)) : Math.min(0.97, 0.04 + 0.93 * Math.pow(p, 0.85)), reward, fee: Math.max(30, Math.round(reward * 0.12 / 10) * 10), unlock: last ? ch.unlock : null, last, rival: f[1] === 'Rival', chest: last ? (ci < 2 ? 'bronze' : ci < 4 ? 'silver' : ci < 6 ? 'gold' : 'mythic') : null });
  }));
  const FREE_NAMES = { bronze: 'Bronze Chest', silver: 'Silver Chest', gold: 'Gold Chest', mythic: 'Mythic Chest' };

  let S = null, cur = null, openCh = null, tab = 'battle', fil = { q: '', r: '' }, editDeck = 0, stock = null, done = false, shake = null, mem = null;
  const $c = id => document.getElementById(id);
  const rngSeed = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const baseName = f => f.name.replace(/^(Mega|Alolan|Galarian|Hisuian|Primal|Origin|Therian|Incarnate)\s+/i, '').split(/[ (]/)[0];
  const tierIdx = () => { let t = 0; for (const b of BOSSES) if (S.beaten[b.id] && b.unlock) t = Math.max(t, RAR.indexOf(b.unlock)); return t; };
  const byRar = r => DATA.figures.filter(f => f.rarity === r);

  const STARTER_PLATES = ['plus_power', 'speed_boost', 'full_heal', 'switch'];
  const platePrice = k => PL[k].cost * 150 + (PL[k].cost >= 2 ? 100 : 0);
  function plateDrop(lines, why) { const left = Object.keys(PL).filter(k => !S.plates[k]); if (!left.length) return null; const k = left[(Math.random() * left.length) | 0]; S.plates[k] = 1; lines.push(`🔶 New plate: ${PL[k].name} (${why})! ${PL[k].text}`); return k; }
  let memOwner = null;
  try { Object.keys(localStorage).filter(k => k.startsWith(KEY)).forEach(k => localStorage.removeItem(k)); } catch (e) { } // saves live on the server only; remove old browser copies
  function load() {
    return (mem && auth && memOwner === auth.name) ? mig(mem) : null;
  }
  function mig(s) { if (!s.plates) { s.plates = {}; STARTER_PLATES.forEach(k => (s.plates[k] = 1)); (s.decks || []).forEach(d => (d.plates || []).forEach(k => (s.plates[k] = 1))); } s.free = s.free || {}; s.stats = s.stats || { chests: 0, earned: 0, rivals: 0 }; s.quests = s.quests || {}; s.tower = s.tower || { best: 0, cur: 0 }; s.daily = s.daily || {}; s.hardWon = s.hardWon || {}; s.beaten = s.beaten || {}; return s; }
  let auth = null; try { auth = JSON.parse(localStorage.getItem('duel_auth') || 'null'); } catch (e) { }
  const api = (url, method, body) => fetch(url, { method: method || 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth.token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json().then(j => ({ ok: r.ok, status: r.status, ...j })));
  let saveT = null, dirty = false; const flush = () => { clearTimeout(saveT); if (!auth || !dirty) return Promise.resolve(); dirty = false; return api('/api/save', 'PUT', { save: S }).catch(() => { dirty = true; }); };
  function save() { mem = S; memOwner = auth && auth.name; if (auth) { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 400); } }
  function genTeam() {
    const pool = byRar('C').filter(f => f.mp >= 2), fast = pool.filter(f => f.mp >= 3);
    for (let tries = 0; tries < 80; tries++) {
      const ids = [], used = {}, types = new Set(); const first = fast[(Math.random() * fast.length) | 0]; ids.push(first.id); used[baseName(first)] = 1; first.types.forEach(t => types.add(t));
      while (ids.length < 6) { const f = pool[(Math.random() * pool.length) | 0]; const b = baseName(f); if (used[b]) continue; used[b] = 1; ids.push(f.id); f.types.forEach(t => types.add(t)); }
      if (types.size >= 3) return ids.sort(() => Math.random() - 0.5);
    }
    return pool.slice(0, 6).map(f => f.id);
  }
  function starterPick() {
    return new Promise(res => {
      let left = 2; const root = $c('camp'); root.innerHTML = '';
      const draw = (teams) => {
        root.innerHTML = '';
        const row = el('div', { class: 'starters' }, ...teams.map((ids, k) => el('div', { class: 'starter' },
          el('h4', {}, 'Team ' + 'ABC'[k]), el('div', { class: 'tags' }, ...[...new Set(ids.flatMap(i => fig(i).types))].map(t => el('span', { class: 'tag' }, t))),
          el('div', { class: 'figrow' }, ...ids.map(i => mini(fig(i)))), el('div', { class: 'small muted' }, 'Fastest: MP ' + Math.max(...ids.map(i => fig(i).mp))),
          el('button', { class: 'primary', onclick: () => res(ids) }, 'Choose this team'))));
        root.append(el('div', { class: 'panel' }, el('h2', {}, '🎒 Choose your starter team'), el('div', { class: 'muted' }, 'All Commons, every team has a fast Pokémon and at least 3 different types. You can re-roll all three teams ' + left + ' more time' + (left === 1 ? '' : 's') + '. You will earn and buy many more Pokémon later.'),
          row, el('div', { class: 'row' }, el('button', { disabled: left > 0 ? null : '', onclick: () => { if (left <= 0) return; left--; draw([genTeam(), genTeam(), genTeam()]); } }, '🎲 Re-roll teams (' + left + ' left)')), el('div', { id: 'campInfo', class: 'card campcard', style: 'margin-top:10px' }, el('div', { class: 'muted' }, 'Hover a Pokémon to see its stats.'))));
        root.querySelectorAll('button').forEach(b => { if (b.getAttribute('disabled') === null) b.removeAttribute('disabled'); });
      };
      draw([genTeam(), genTeam(), genTeam()]);
    });
  }
  function newSave(chosen) {
    const ids = chosen || genTeam();
    const owned = {}; ids.forEach(i => (owned[i] = 1));
    S = { coins: 500, plates: Object.fromEntries(STARTER_PLATES.map(k => [k, 1])), owned, decks: [{ name: 'Starter Team', figs: ids.slice(), plates: [] }], active: 0, beaten: {}, wins: 0, losses: 0, stock: null };
    mig(S); save();
  }
  const fig = id => FIG[id];
  const ownedCount = () => Object.values(S.owned).reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------- rolling
  function weightedRarity(odds, rng) {
    const t = tierIdx(); const w = {}; RAR.forEach(r => (w[r] = 0));
    RAR.forEach((r, i) => { w[RAR[Math.min(i, t)]] += odds[r] || 0; });
    let tot = 0; RAR.forEach(r => (tot += w[r])); let x = rng() * tot;
    for (const r of RAR) { if ((x -= w[r]) < 0) return r; }
    return RAR[0];
  }
  function rollFig(odds, rng) { const r = weightedRarity(odds, rng || Math.random); const p = byRar(r); return p[((rng || Math.random)() * p.length) | 0]; }
  function makeStock() {
    const odds = { C: 40, UC: 33, R: 18, EX: 7, UX: 2 }; const out = [];
    let guard = 0; while (out.length < 8 && guard++ < 100) { const f = rollFig(odds); if (!out.includes(f.id)) out.push(f.id); }
    return out;
  }
  function bossDeck(b) {
    if (b._deck) return b._deck;
    const rng = rngSeed(String(b.id).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)); const pool = DATA.figures.filter(f => b.rar.includes(f.rarity) && f.mp >= 1);
    const maxR = Math.min(4, Math.max(...b.rar.map(r => RAR.indexOf(r))) + 1); const aceKey = (b.ace || '').toLowerCase();
    const aces = aceKey ? DATA.figures.filter(f => RAR.indexOf(f.rarity) <= maxR && f.mp >= 1 && (f.name.toLowerCase() === aceKey || f.name.toLowerCase().replace(/^(mega|shiny|alolan|galarian|hisuian|primal)\s+/, '').startsWith(aceKey))).sort((x, y) => RAR.indexOf(y.rarity) - RAR.indexOf(x.rarity)) : [];
    const themed = pool.filter(f => f.types.some(t => b.types.includes(t))); const ids = []; const used = {};
    if (aces.length) { ids.push(aces[0].id); used[baseName(aces[0])] = 1; }
    const take = list => { if (b.skill > 0.45) list = list.slice().sort((x, y) => y.mp - x.mp); let g = 0; while (list.length && ids.length < 6 && g++ < 400) { const f = list[Math.floor((b.skill > 0.45 ? rng() * rng() : rng()) * list.length)]; const nm = baseName(f); if (used[nm]) continue; used[nm] = 1; ids.push(f.id); } };
    if (b.types.length) take(themed.length > 12 ? themed.filter(f => f.rarity === b.rar[b.rar.length - 1]).length > 5 ? themed.filter(f => f.rarity === b.rar[b.rar.length - 1]) : themed : themed);
    take(pool);
    const keys = Object.keys(PL).sort(() => rng() - 0.5); const pl = []; let c = 0; for (const k of keys) if (c + PL[k].cost <= 6) { pl.push(k); c += PL[k].cost; }
    return (b._deck = { figs: ids, plates: pl });
  }

  // ---------------------------------------------------------------- deck helpers
  const curDeck = () => S.decks[Math.min(S.active, S.decks.length - 1)];
  const deckOk = d => d && d.figs.length === 6 && d.figs.every(i => S.owned[i]) && (() => { const need = {}; d.figs.forEach(i => (need[i] = (need[i] || 0) + 1)); return Object.keys(need).every(i => need[i] <= S.owned[i]); })();
  const plateCost = d => d.plates.reduce((a, k) => a + PL[k].cost, 0);
  function canAdd(d, id) {
    if (d.figs.length >= 6 || !S.owned[id]) return false;
    if (d.figs.filter(x => x === id).length >= S.owned[id]) return false;
    return d.figs.filter(x => baseName(fig(x)) === baseName(fig(id))).length < 3;
  }

  // ---------------------------------------------------------------- UI
  function head() {
    const t = tierIdx();
    return el('div', { class: 'camphead' },
      el('button', { class: 'ghost', onclick: () => { show('lobby'); } }, '← Menu'),
      el('h2', {}, 'Campaign'),
      el('div', { class: 'coins' }, '🪙 ', el('b', {}, S.coins)), auth ? el('button', { class: 'ghost', title: 'Sign out', onclick: () => window.Camp.signOut() }, '👤 ' + auth.name + ' ⏏') : '',
      el('div', { class: 'small muted' }, `Collection ${Object.keys(S.owned).length}/${DATA.figures.length} · Wins ${S.wins} · Shop tier: `, el('b', { style: 'color:' + RCOL[RAR[t]] }, RNAME[RAR[t]] + (t < 4 ? ' → beat bosses to unlock more' : ' (max)'))),
      el('div', { class: 'tabs' }, ...[['battle', '⚔ Story'], ['tower', '🗼 Tower'], ['quest', '📜 Quests' + (questsReady() ? ' ❗' : '')], ['coll', '🎒 Collection'], ['decks', '🃏 Decks'], ['pvp', '🤝 PvP'], ['shop', '🛒 Shop & Chests']].map(([k, n]) => el('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; render(); } }, n))));
  }
  function render() {
    if (!S) return; const root = $c('camp'); root.innerHTML = '';
    const body = el('div', { class: 'campbody' }); root.append(head(), body);
    ({ battle: tBattle, tower: tTower, quest: tQuest, coll: tColl, decks: tDecks, shop: tShop, pvp: tPvp })[tab](body);
  }
  function rarTag(f) { return el('span', { class: 'rtag', style: 'background:' + RCOL[f.rarity] }, f.rarity); }
  function mini(f, extra, onclick) {
    return el('div', { class: 'cfig', style: 'border-color:' + RCOL[f.rarity], onclick, onmouseenter: () => infoCard($c('campInfo'), f) }, img(f), el('span', { class: 'mp' }, f.mp), rarTag(f), extra || '', el('div', { class: 'nm' }, f.name));
  }

  const chDone = ci => CH[ci].fights.every((_, fi) => S.beaten[CH[ci].id + '_' + fi]);
  const isOpen = b => b.idx === 0 || S.beaten[BOSSES[b.idx - 1].id];
  const curStageIdx = () => { const b = BOSSES.find(x => !S.beaten[x.id]); return b ? b.idx : BOSSES.length; };
  function tPvp(body) {
    const ok = deckBar(body); const note = el('div', { id: 'pvpNote', class: 'notice hidden' });
    const rec = el('div', { class: 'panel mini' }, 'Loading PvP record…');
    api('/api/pvp').then(r => { rec.innerHTML = ''; const top = r.top || []; rec.append(el('b', {}, 'Your PvP record: '), `${r.me.w} W – ${r.me.l} L`, el('h4', {}, 'Top duelists'), ...(top.length ? top.map((x, i) => el('div', { class: 'small' }, `${i + 1}. ${x.name} — ${x.w}W ${x.l}L`)) : [el('div', { class: 'small muted' }, 'No PvP games yet – be the first!')])); }).catch(() => { rec.textContent = 'PvP record unavailable.'; });
    const code = el('input', { placeholder: 'ROOM CODE', maxlength: 4, style: 'text-transform:uppercase;width:110px' });
    const go = async t => { if (!ok || !auth) return; await flush(); window.pvpMode = true; const d = curDeck(); window.pvpLast = { auth: auth.token, deck: { figs: d.figs.slice(), plates: d.plates.slice() } }; note.classList.add('hidden'); send({ t, owned: true, auth: auth.token, name: auth.name, code: code.value, deck: window.pvpLast.deck }); };
    body.append(el('div', { class: 'panel' }, el('h3', {}, '🤝 Collection PvP'), el('div', { class: 'muted' }, 'Duel another signed-in player using only the Pokémon and plates you own (your active deck). The server checks your collection. Wins and losses go on your PvP record; coins, chests and progress are not affected.'),
      el('div', { class: 'row gap', style: 'margin-top:10px' }, el('button', { class: 'primary', disabled: ok ? null : '', onclick: () => go('create') }, 'Create room'), code, el('button', { disabled: ok ? null : '', onclick: () => go('join') }, 'Join room')), note), rec);
  }
  function deckBar(body) {
    const d = curDeck(); const ok = deckOk(d);
    body.append(el('div', { class: 'panel mini' }, el('b', {}, 'Your active deck: '), d.name, ' — ', ok ? d.figs.map(i => fig(i).name).join(', ') : el('span', { class: 'err' }, 'incomplete – build a 6-Pokémon deck in the Decks tab'), ' ',
      S.decks.length > 1 ? el('select', { onchange: e => { S.active = +e.target.value; save(); render(); } }, ...S.decks.map((x, i) => el('option', { value: i, ...(i === S.active ? { selected: '' } : {}) }, x.name))) : ''));
    return ok;
  }
  function stageCard(b, ok) {
    const beaten = !!S.beaten[b.id]; const open = isOpen(b); const bd = bossDeck(b);
    const card = el('div', { class: 'boss' + (beaten ? ' beaten' : '') + (open ? '' : ' locked') + (b.last ? ' bigboss' : '') },
      el('div', { class: 'bface' }, open ? img(fig(bd.figs[0])) : el('div', { class: 'lock' }, '🔒')),
      el('div', { class: 'binfo' }, el('div', { class: 'bt' }, (b.rival ? '⚔ ' : b.last ? '👑 ' : '') + b.title), el('div', { class: 'bn' }, b.name, beaten ? ' ✔' : ''),
        el('div', { class: 'small muted' }, 'Skill ', '★'.repeat(Math.max(1, Math.round(b.skill * 5))), ' · Reward 🪙', b.reward, beaten ? ' (replays 30%)' : '', b.unlock ? ' · Unlocks ' + RNAME[b.unlock] : '', b.chest && !beaten ? ' · 🎁 ' + FREE_NAMES[b.chest] : '', ' · Defeat −🪙' + b.fee),
        open ? el('div', { class: 'bteam' }, ...bd.figs.map(id => el('span', { title: fig(id).name, onmouseenter: () => infoCard($c('campInfo'), fig(id)) }, img(fig(id))))) : el('div', { class: 'small muted' }, 'Defeat ' + BOSSES[b.idx - 1].name + ' first')),
      el('button', { class: 'primary', ...(!open || !ok ? { disabled: '' } : {}), onclick: () => preFight(b) }, beaten ? 'Rematch' : 'Fight'));
    return card;
  }
  function tBattle(body) {
    const ok = deckBar(body); const ci0 = Math.min(CH.length - 1, (BOSSES[curStageIdx()] || BOSSES[BOSSES.length - 1]).ch);
    if (openCh == null) openCh = ci0;
    if (curStageIdx() >= BOSSES.length) body.append(el('div', { class: 'panel mini' }, '🏆 You conquered the whole story! Keep climbing the Tower and finishing Quests.'));
    const wrap = el('div', { class: 'chapters' });
    CH.forEach((ch, ci) => {
      const done = ch.fights.filter((_, fi) => S.beaten[ch.id + '_' + fi]).length; const unlocked = ci === 0 || chDone(ci - 1);
      const head = el('div', { class: 'chhead' + (unlocked ? '' : ' locked') + (openCh === ci ? ' on' : ''), onclick: () => { if (!unlocked) return; openCh = openCh === ci ? -1 : ci; render(); } },
        el('span', { class: 'chico' }, unlocked ? ch.icon : '🔒'), el('div', { class: 'chmeta' }, el('b', {}, `Chapter ${ci + 1}: ${ch.name}`), el('div', { class: 'small muted' }, unlocked ? ch.blurb : 'Finish chapter ' + ci + ' to unlock')),
        el('div', { class: 'chprog' }, el('div', { class: 'bar' }, el('i', { style: `width:${done / ch.fights.length * 100}%` })), el('span', { class: 'small' }, `${done}/${ch.fights.length}`, done === ch.fights.length ? ' · ' + ch.badge + ' 🏅' : '')));
      wrap.append(head);
      if (openCh === ci && unlocked) { const lst = el('div', { class: 'bosses' }); BOSSES.filter(b => b.ch === ci).forEach(b => lst.append(stageCard(b, ok))); wrap.append(lst); }
    });
    body.append(wrap, el('div', { id: 'campInfo', class: 'card campcard' }));
  }
  function preFight(b) {
    const bd = bossDeck(b); const ov = el('div', { class: 'overlay chestov' });
    const box = el('div', { class: 'chestbox storybox' }, el('div', { class: 'small muted' }, b.ch != null && b.fi != null ? `Chapter ${b.ch + 1} · ${CH[b.ch].name}` : b.kind === 'tower' ? 'Battle Tower' : 'Daily Challenge'),
      el('div', { class: 'storyface' }, img(fig(bd.figs[0]))), el('h3', {}, b.name), el('div', { class: 'muted' }, b.title),
      el('div', { class: 'quote' }, '“' + (b.say || '...') + '”'), el('div', { class: 'bteam' }, ...bd.figs.map(id => el('span', { title: fig(id).name }, img(fig(id))))),
      el('div', { class: 'small muted', id: 'pfRew' }, `Win 🪙${S.beaten[b.id] ? Math.floor(b.reward * 0.3) : b.reward} · Lose −🪙${b.fee}`),
      b.kind ? '' : el('label', { class: 'hardopt', title: 'Opponent plays near-perfectly. Double coins, double defeat fee, and the first Hard win of each fight gives a bonus chest.' }, el('input', { type: 'checkbox', id: 'hardChk', onchange: e => { const h = e.target.checked, r = S.beaten[b.id] ? Math.floor(b.reward * 0.3) : b.reward; $c('pfRew').textContent = h ? `🔥 HARD · Win 🪙${r * 2}${S.hardWon[b.id] ? '' : ' + 🎁 bonus chest'} · Lose −🪙${b.fee * 2}` : `Win 🪙${r} · Lose −🪙${b.fee}`; } }), ' 🔥 Hard mode (stronger opponent, 2× coins)'),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => { const h = !!($c('hardChk') && $c('hardChk').checked); ov.remove(); fight(h ? { ...b, hard: true, skill: Math.min(0.99, Math.max(b.skill + 0.2, 0.9)), reward: b.reward * 2, fee: b.fee * 2 } : b); } }, 'Fight!'), el('button', { class: 'ghost', onclick: () => ov.remove() }, 'Not yet')));
    ov.append(box); document.body.append(ov);
  }

  // ---------------------------------------------------------------- tower & daily
  const ROLES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
  const TNAMES = ['Tower Guard', 'Climber', 'Warden', 'Sentinel', 'Duelist', 'Challenger', 'Veteran', 'Champion', 'Overseer', 'Archon'];
  function towerStage(f) {
    const rng = rngSeed(f * 7919 + 13); const p = Math.min(1, f / 45); const rar = f < 5 ? ['C', 'UC'] : f < 10 ? ['UC', 'R'] : f < 18 ? ['R'] : f < 26 ? ['R', 'EX'] : f < 36 ? ['EX'] : ['EX', 'UX'];
    const t1 = ROLES[(rng() * ROLES.length) | 0], t2 = ROLES[(rng() * ROLES.length) | 0]; const boss = f % 5 === 0;
    const reward = Math.round((120 + f * 55) * (boss ? 1.6 : 1) / 10) * 10;
    return { id: 'tw' + f, kind: 'tower', floor: f, name: boss ? `Floor Master ${TNAMES[(f / 5 - 1) % TNAMES.length | 0]}` : `${TNAMES[f % TNAMES.length]} #${f}`, title: `Floor ${f}${boss ? ' · Checkpoint' : ''}`, types: [t1, t2], rar: boss && f > 3 ? rar : rar, skill: Math.min(0.99, 0.2 + f * 0.022), reward, fee: Math.max(60, Math.round(reward * 0.15 / 10) * 10), say: boss ? 'You reached a checkpoint floor. Lose here and you restart from it — win and it becomes your new safe floor.' : 'Another climber? Show me your strength.', _tw: true };
  }
  function dailyStage() {
    const d = new Date(); const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); const rng = rngSeed(key);
    const t = [ROLES[(rng() * 18) | 0], ROLES[(rng() * 18) | 0]]; const prog = curStageIdx() / BOSSES.length;
    return { id: 'daily' + key, kind: 'daily', key, name: 'Daily Challenger', title: 'Daily Challenge', types: t, rar: rarFor(Math.min(0.95, 0.15 + prog * 0.9)), skill: Math.min(0.95, 0.4 + prog * 0.55), reward: 400 + Math.round(prog * 1600 / 10) * 10, fee: 80, say: `Today's theme: ${t.join(' & ')}. Win for a free Silver Chest!` };
  }
  function tTower(body) {
    const ok = deckBar(body); const T = S.tower; const f = T.cur + 1; const st = towerStage(f); const dl = dailyStage(); const dd = S.daily.key === dl.key && S.daily.won;
    body.append(el('div', { class: 'panel' }, el('h3', {}, '🗼 The Battle Tower'), el('div', { class: 'muted' }, 'An endless climb. Every 5th floor is a checkpoint. Lose and you fall back to your last checkpoint (and pay a fee). Every checkpoint gives a free chest.'),
      el('div', {}, `Current floor: `, el('b', {}, f), ` · Best: `, el('b', {}, T.best), ` · Last checkpoint: ${Math.floor(T.cur / 5) * 5}`),
      towerCard(st, ok)));
    const lb = el('div', { class: 'small muted' }, 'Loading leaderboard…'); api('/api/leaderboard').then(r => { lb.innerHTML = ''; (Array.isArray(r) ? r : []).forEach((u, i) => lb.append(el('div', {}, `${i + 1}. `, el('b', {}, u.name), ` — floor ${u.tower} · ${u.wins} wins`))); if (!lb.childNodes.length) lb.textContent = 'No scores yet.'; }).catch(() => (lb.textContent = ''));
    body.append(el('div', { class: 'panel' }, el('h3', {}, '🏆 Leaderboard'), lb));
    body.append(el('div', { class: 'panel' }, el('h3', {}, '📅 Daily Challenge'), dd ? el('div', { class: 'muted' }, 'Completed today ✔. Come back tomorrow for a new theme!') : towerCard(dl, ok, 'Daily'), el('div', { id: 'campInfo', class: 'card campcard' })));
  }
  function towerCard(st, ok, lab) {
    const bd = bossDeck(st);
    return el('div', { class: 'boss' }, el('div', { class: 'bface' }, img(fig(bd.figs[0]))), el('div', { class: 'binfo' }, el('div', { class: 'bt' }, st.title), el('div', { class: 'bn' }, st.name),
      el('div', { class: 'small muted' }, 'Skill ', '★'.repeat(Math.max(1, Math.round(st.skill * 5))), ` · Reward 🪙${st.reward} · Defeat −🪙${st.fee}`), el('div', { class: 'bteam' }, ...bd.figs.map(id => el('span', { title: fig(id).name, onmouseenter: () => infoCard($c('campInfo'), fig(id)) }, img(fig(id)))))),
      el('button', { class: 'primary', ...(!ok ? { disabled: '' } : {}), onclick: () => preFight(st) }, lab ? 'Fight' : 'Climb'));
  }

  // ---------------------------------------------------------------- quests
  const QUESTS = [
    { id: 'w1', n: 'First Blood', d: 'Win 1 battle', k: () => S.wins, g: 1, r: { coins: 100 } },
    { id: 'w10', n: 'Trainer', d: 'Win 10 battles', k: () => S.wins, g: 10, r: { coins: 300 } },
    { id: 'w25', n: 'Veteran', d: 'Win 25 battles', k: () => S.wins, g: 25, r: { coins: 600, chest: 'bronze' } },
    { id: 'w50', n: 'Elite', d: 'Win 50 battles', k: () => S.wins, g: 50, r: { coins: 1000, chest: 'silver' } },
    { id: 'w100', n: 'Legend', d: 'Win 100 battles', k: () => S.wins, g: 100, r: { coins: 2500, chest: 'gold' } },
    { id: 'c20', n: 'Collector', d: 'Own 20 different Pokémon', k: () => Object.keys(S.owned).length, g: 20, r: { coins: 400 } },
    { id: 'c50', n: 'Hoarder', d: 'Own 50 different Pokémon', k: () => Object.keys(S.owned).length, g: 50, r: { coins: 900, chest: 'silver' } },
    { id: 'c100', n: 'Curator', d: 'Own 100 different Pokémon', k: () => Object.keys(S.owned).length, g: 100, r: { coins: 2000, chest: 'gold' } },
    { id: 'c200', n: 'Professor', d: 'Own 200 different Pokémon', k: () => Object.keys(S.owned).length, g: 200, r: { coins: 5000, chest: 'mythic' } },
    { id: 'ex1', n: 'Ex-cellent', d: 'Own an Ex Pokémon', k: () => Object.keys(S.owned).filter(i => fig(i) && fig(i).rarity === 'EX').length, g: 1, r: { coins: 500 } },
    { id: 'ux1', n: 'Ultra Rare', d: 'Own an Ultra Pokémon', k: () => Object.keys(S.owned).filter(i => fig(i) && fig(i).rarity === 'UX').length, g: 1, r: { coins: 1000, chest: 'silver' } },
    { id: 'ux10', n: 'Ultra Collection', d: 'Own 10 Ultra Pokémon', k: () => Object.keys(S.owned).filter(i => fig(i) && fig(i).rarity === 'UX').length, g: 10, r: { coins: 3000, chest: 'mythic' } },
    { id: 'ch5', n: 'Chest Opener', d: 'Open 10 chests', k: () => S.stats.chests, g: 10, r: { coins: 400 } },
    { id: 'ch25', n: 'Chest Addict', d: 'Open 40 chests', k: () => S.stats.chests, g: 40, r: { coins: 1500, chest: 'gold' } },
    { id: 'riv', n: 'Rival Rivalry', d: 'Beat Rival Kael 3 times', k: () => BOSSES.filter(b => b.rival && S.beaten[b.id]).length, g: 3, r: { coins: 700, chest: 'silver' } },
    { id: 'riv2', n: 'Settled', d: 'Beat Rival Kael in all ' + BOSSES.filter(b => b.rival).length + ' duels', k: () => BOSSES.filter(b => b.rival && S.beaten[b.id]).length, g: BOSSES.filter(b => b.rival).length, r: { coins: 2500, chest: 'gold' } },
    { id: 'st20', n: 'Story: 20%', d: 'Beat 15 story fights', k: () => Object.keys(S.beaten).length, g: 15, r: { coins: 500 } },
    { id: 'st50', n: 'Story: Halfway', d: 'Beat 36 story fights', k: () => Object.keys(S.beaten).length, g: 36, r: { coins: 1500, chest: 'silver' } },
    { id: 'st90', n: 'Story: Beyond the League', d: 'Beat 72 story fights', k: () => Object.keys(S.beaten).length, g: 72, r: { coins: 3000, chest: 'gold' } },
    { id: 'hard1', n: 'Hard Mode', d: 'Win 1 fight on Hard', k: () => Object.keys(S.hardWon).length, g: 1, r: { coins: 600 } },
    { id: 'hard10', n: 'Hard Mode: Veteran', d: 'Win 10 different fights on Hard', k: () => Object.keys(S.hardWon).length, g: 10, r: { coins: 2500, chest: 'gold' } },
    { id: 'hard40', n: 'Hard Mode: Master', d: 'Win 40 different fights on Hard', k: () => Object.keys(S.hardWon).length, g: 40, r: { coins: 8000, chest: 'mythic' } },
    { id: 'stAll', n: 'Story: Complete', d: 'Beat all ' + BOSSES.length + ' story fights', k: () => Object.keys(S.beaten).length, g: BOSSES.length, r: { coins: 8000, chest: 'mythic' } },
    { id: 't5', n: 'Tower: 5', d: 'Reach floor 5', k: () => S.tower.best, g: 5, r: { coins: 400 } },
    { id: 't15', n: 'Tower: 15', d: 'Reach floor 15', k: () => S.tower.best, g: 15, r: { coins: 1200, chest: 'silver' } },
    { id: 't30', n: 'Tower: 30', d: 'Reach floor 30', k: () => S.tower.best, g: 30, r: { coins: 3000, chest: 'gold' } },
    { id: 't50', n: 'Tower: Summit', d: 'Reach floor 50', k: () => S.tower.best, g: 50, r: { coins: 8000, chest: 'mythic' } },
    { id: 'rich', n: 'Moneybags', d: 'Hold 10,000 coins at once', k: () => S.coins, g: 10000, r: { chest: 'gold' } },
    { id: 'dly', n: 'Daily Habit', d: 'Win 7 Daily Challenges', k: () => S.stats.daily || 0, g: 7, r: { coins: 1500, chest: 'silver' } },
  ];
  const questsReady = () => S && QUESTS.some(q => !S.quests[q.id] && q.k() >= q.g);
  function tQuest(body) {
    const lst = el('div', { class: 'quests' });
    QUESTS.slice().sort((a, b) => (S.quests[a.id] ? 1 : 0) - (S.quests[b.id] ? 1 : 0) || (b.k() >= b.g) - (a.k() >= a.g)).forEach(q => {
      const v = Math.min(q.k(), q.g), done = !!S.quests[q.id], ready = !done && v >= q.g;
      lst.append(el('div', { class: 'quest' + (done ? ' done' : ready ? ' ready' : '') }, el('div', { class: 'qinfo' }, el('b', {}, q.n), el('div', { class: 'small muted' }, q.d), el('div', { class: 'bar' }, el('i', { style: `width:${v / q.g * 100}%` })), el('span', { class: 'small' }, `${v}/${q.g}`)),
        el('div', { class: 'qrew small' }, (q.r.coins ? '🪙' + q.r.coins : ''), ' ', q.r.chest ? '🎁 ' + FREE_NAMES[q.r.chest] : ''),
        el('button', { class: ready ? 'primary' : 'ghost', ...(ready ? {} : { disabled: '' }), onclick: () => { S.quests[q.id] = 1; S.coins += q.r.coins || 0; if (q.r.chest) S.free[q.r.chest] = (S.free[q.r.chest] || 0) + 1; save(); render(); } }, done ? 'Claimed' : 'Claim')));
    });
    body.append(el('div', { class: 'panel mini' }, `Quests: ${Object.keys(S.quests).length}/${QUESTS.length} claimed. Free chests are opened in the Shop & Chests tab.`), lst);
  }

  function tColl(body) {
    const bar = el('div', { class: 'filters' }, el('input', { placeholder: 'Search…', value: fil.q, oninput: e => { fil.q = e.target.value; grid(); } }),
      el('select', { onchange: e => { fil.r = e.target.value; grid(); } }, el('option', { value: '' }, 'Rarity'), ...RAR.map(r => el('option', { value: r, ...(fil.r === r ? { selected: '' } : {}) }, RNAME[r]))));
    const g = el('div', { class: 'figgrid' });
    const grid = () => {
      g.innerHTML = ''; let n = 0;
      const ids = Object.keys(S.owned).map(Number).filter(i => fig(i)).sort((a, b) => RAR.indexOf(fig(b).rarity) - RAR.indexOf(fig(a).rarity) || fig(a).name.localeCompare(fig(b).name));
      for (const id of ids) { const f = fig(id); if (fil.q && !(f.name.toLowerCase().includes(fil.q.toLowerCase()) || f.types.join(' ').includes(fil.q.toLowerCase()))) continue; if (fil.r && f.rarity !== fil.r) continue; n++;
        const extra = S.owned[id] > 1 ? el('span', { class: 'cnt' }, '×' + S.owned[id]) : '';
        const c = mini(f, extra, () => { infoCard($c('campInfo'), f); sel = id; sellBox(); }); g.append(c); }
      if (!n) g.append(el('div', { class: 'muted' }, 'No Pokémon match.'));
    };
    let sel = null; const sb = el('div', { class: 'panel mini' }, 'Click a Pokémon to see details.');
    const sellBox = () => { sb.innerHTML = ''; if (!sel) return; const f = fig(sel); const spare = S.owned[sel] - (S.decks.some(d => d.figs.includes(sel)) ? 1 : 0);
      sb.append(el('b', {}, f.name), ` — owned ×${S.owned[sel]}`, ' ', el('button', { disabled: S.owned[sel] > 1 ? null : '', onclick: () => { if (S.owned[sel] < 2) return; S.owned[sel]--; S.coins += SELL[f.rarity]; S.decks.forEach(d => { if (d.figs.filter(x => x === sel).length > S.owned[sel]) { const k = d.figs.lastIndexOf(sel); d.figs.splice(k, 1); } }); save(); render(); } }, `Sell 1 duplicate (+🪙${SELL[f.rarity]})`)); if (S.owned[sel] < 2) sb.lastChild.setAttribute('disabled', ''); else sb.lastChild.removeAttribute('disabled'); };
    body.append(el('div', { class: 'collgrid' }, el('div', {}, bar, g), el('div', {}, sb, el('div', { id: 'campInfo', class: 'card campcard' })))); grid();
  }

  function tDecks(body) {
    editDeck = Math.min(editDeck, S.decks.length - 1); const d = S.decks[editDeck];
    const tabs = el('div', { class: 'tabs' }, ...S.decks.map((x, i) => el('button', { class: i === editDeck ? 'on' : '', onclick: () => { editDeck = i; render(); } }, x.name + (i === S.active ? ' ★' : ''))),
      S.decks.length < 5 ? el('button', { onclick: () => { S.decks.push({ name: 'Deck ' + (S.decks.length + 1), figs: [], plates: [] }); editDeck = S.decks.length - 1; save(); render(); } }, '+ New deck') : '');
    const slots = el('div', { class: 'slots' });
    for (let i = 0; i < 6; i++) { const id = d.figs[i]; const s = el('div', { class: 'slot', onclick: () => { if (id) { d.figs.splice(i, 1); save(); render(); } } }); if (id) { s.append(img(fig(id)), fig(id).name); s.onmouseenter = () => infoCard($c('campInfo'), fig(id)); } else s.append('Empty'); slots.append(s); }
    const pl = el('div', { class: 'plates' });
    d.plates = d.plates.filter(k => S.plates[k]);
    for (const k of Object.keys(PL)) { const Pp = PL[k]; const on = d.plates.includes(k); const lock = !S.plates[k]; pl.append(el('div', { class: 'plate' + (on ? ' on' : '') + (lock ? ' locked' : ''), title: lock ? 'Locked – buy it in the Shop, or win it from bosses and chests.' : Pp.text, onclick: () => { if (lock) return; if (on) d.plates = d.plates.filter(x => x !== k); else if (plateCost(d) + Pp.cost <= 6) d.plates.push(k); save(); render(); } }, el('span', { class: 'dot', style: 'background:' + (COL[Pp.color] || '#f78fb3') }), Pp.name, el('span', { class: 'muted' }, ' ' + Pp.cost), lock ? el('span', { class: 'lock' }, ' 🔒') : '', el('div', { class: 'small muted' }, Pp.text))); }
    const g = el('div', { class: 'figgrid' });
    Object.keys(S.owned).map(Number).filter(i => fig(i)).sort((a, b) => RAR.indexOf(fig(b).rarity) - RAR.indexOf(fig(a).rarity) || fig(a).name.localeCompare(fig(b).name)).forEach(id => {
      const inDeck = d.figs.filter(x => x === id).length; const f = fig(id); const can = canAdd(d, id);
      g.append(mini(f, el('span', { class: 'cnt' }, inDeck + '/' + S.owned[id]), () => { if (can) { d.figs.push(id); save(); render(); } else infoCard($c('campInfo'), f); })); if (!can) g.lastChild.classList.add('dim'); });
    body.append(el('div', { class: 'collgrid' }, el('div', {}, tabs, el('h4', {}, 'Choose from your collection'), g),
      el('div', {}, el('div', { class: 'panel mini' }, el('b', {}, d.name), ' ', el('button', { class: 'ghost', onclick: () => { const n = prompt('Deck name', d.name); if (n) { d.name = n.slice(0, 18); save(); render(); } } }, 'Rename'), ' ',
        el('button', { class: 'ghost', onclick: () => { S.active = editDeck; save(); render(); } }, S.active === editDeck ? '★ Active' : 'Set active'), ' ',
        S.decks.length > 1 ? el('button', { class: 'ghost', onclick: () => { if (confirm('Delete this deck?')) { S.decks.splice(editDeck, 1); S.active = 0; editDeck = 0; save(); render(); } } }, 'Delete') : '',
        el('h4', {}, `Team (${d.figs.length}/6)`), slots, el('div', { class: 'row' }, el('button', { class: 'ghost', onclick: () => { d.figs = []; save(); render(); } }, 'Clear'), el('button', { class: 'ghost', onclick: () => { autoFill(d); save(); render(); } }, 'Auto-fill best')),
        el('h4', {}, `Plates (${plateCost(d)}/6)`), pl, el('div', { class: deckOk(d) ? 'muted' : 'err' }, deckOk(d) ? 'Deck ready.' : 'Needs 6 Pokémon you own.')), el('div', { id: 'campInfo', class: 'card campcard' }))));
  }
  function autoFill(d) {
    const ids = Object.keys(S.owned).map(Number).filter(i => fig(i)).sort((a, b) => RAR.indexOf(fig(b).rarity) - RAR.indexOf(fig(a).rarity) || fig(b).mp - fig(a).mp);
    d.figs = []; for (const id of ids) { while (canAdd(d, id) && d.figs.filter(x => x === id).length < 1) d.figs.push(id); if (d.figs.length >= 6) break; }
    if (d.figs.length < 6) for (const id of ids) { while (canAdd(d, id)) d.figs.push(id); if (d.figs.length >= 6) break; }
  }

  function tShop(body) {
    if (!S.stock) { S.stock = makeStock(); save(); }
    const chests = el('div', { class: 'chests' });
    const t = tierIdx();
    CHESTS.forEach(c => {
      const odds = {}; RAR.forEach(r => (odds[r] = 0)); RAR.forEach((r, i) => (odds[RAR[Math.min(i, t)]] += c.odds[r]));
      chests.append(el('div', { class: 'chest', style: '--cc:' + c.col }, el('div', { class: 'cicon' }, c.icon), el('b', {}, c.name),
        el('div', { class: 'small muted' }, RAR.filter(r => odds[r] > 0).map(r => `${r} ${odds[r]}%`).join(' · ')),
        el('button', { class: 'primary', disabled: S.coins >= c.price ? null : '', onclick: () => openChest(c) }, `Open · 🪙${c.price}`), (S.free[c.id] > 0) ? el('button', { class: 'buy', onclick: () => openChest(c, true) }, `Open FREE ×${S.free[c.id]}`) : ''));
    });
    chests.querySelectorAll('button').forEach(b => { if (b.getAttribute('disabled') === null) b.removeAttribute('disabled'); });
    const st = el('div', { class: 'figgrid' });
    S.stock.forEach(id => { const f = fig(id); const price = f.cost; const can = S.coins >= price;
      st.append(el('div', { class: 'cfig' + (can ? '' : ' dim'), style: 'border-color:' + RCOL[f.rarity], onmouseenter: () => infoCard($c('campInfo'), f) }, img(f), el('span', { class: 'mp' }, f.mp), rarTag(f), S.owned[id] ? el('span', { class: 'cnt' }, 'own ×' + S.owned[id]) : '', el('div', { class: 'nm' }, f.name),
        el('button', { class: 'buy', onclick: () => { if (S.coins < price) return; S.coins -= price; S.owned[id] = (S.owned[id] || 0) + 1; S.stock = S.stock.filter(x => x !== id); save(); render(); } }, '🪙' + price))); });
    const pb = el('div', { class: 'platebuy' });
    Object.keys(PL).forEach(k => { const Pp = PL[k]; const own = !!S.plates[k]; const pr = platePrice(k);
      pb.append(el('div', { class: 'pb' + (own ? ' own' : ''), style: '--pc:' + (COL[Pp.color] || '#f78fb3') }, el('b', {}, Pp.name), el('span', { class: 'muted' }, ' · ' + Pp.color + ' · cost ' + Pp.cost), el('div', { class: 'small muted' }, Pp.text),
        own ? el('div', { class: 'small' }, '✓ Owned') : el('button', { class: 'buy', disabled: S.coins >= pr ? null : '', onclick: () => { if (S.coins < pr) return; S.coins -= pr; S.plates[k] = 1; save(); render(); } }, '🪙' + pr))); });
    pb.querySelectorAll('button').forEach(b => { if (b.getAttribute('disabled') === null) b.removeAttribute('disabled'); });
    body.append(el('div', { class: 'collgrid' }, el('div', {}, el('h4', {}, 'Chests'), chests, el('h4', {}, `Plates (${Object.keys(S.plates).length}/${Object.keys(PL).length} owned)`), el('div', { class: 'small muted' }, 'Plates are one-use boosts you take into a duel (6 plate-points per deck). Buy them here, or win them from chapter bosses, chests and the Tower.'), pb, el('h4', {}, 'Today\'s stock ', el('button', { class: 'ghost', onclick: () => { if (S.coins >= 100) { S.coins -= 100; S.stock = makeStock(); save(); render(); } } }, 'Restock · 🪙100')), st), el('div', { id: 'campInfo', class: 'card campcard' })));
  }

  function openChest(c, free) {
    if (free) { if (!(S.free[c.id] > 0)) return; S.free[c.id]--; } else { if (S.coins < c.price) return; S.coins -= c.price; } S.stats.chests++; const platePl = Math.random() < (c.id === 'gold' ? 0.4 : c.id === 'silver' ? 0.25 : 0.12) ? plateDrop([], 'chest') : null; const f = rollFig(c.odds); const dup = !!S.owned[f.id]; S.owned[f.id] = (S.owned[f.id] || 0) + 1; save();
    const ov = el('div', { class: 'overlay chestov' }); const box = el('div', { class: 'chestbox', style: '--cc:' + c.col }, el('div', { class: 'bigchest shake' }, c.icon), el('div', { class: 'muted' }, 'Opening…'));
    ov.append(box); document.body.append(ov);
    setTimeout(() => {
      box.innerHTML = ''; const card = el('div', { class: 'reveal', style: '--rc:' + RCOL[f.rarity] }, el('div', { class: 'rglow' }), img(f), el('div', { class: 'rname' }, f.name), el('div', { class: 'rrar', style: 'color:' + RCOL[f.rarity] }, RNAME[f.rarity] + (dup ? ' · duplicate (×' + S.owned[f.id] + ')' : ' · NEW!')), platePl ? el('div', { class: 'rrar', style: 'color:#ffcb05;margin-top:8px' }, '🔶 Bonus plate: ' + PL[platePl].name + '!') : '');
      const ok = el('button', { class: 'primary', onclick: () => { ov.remove(); render(); } }, 'Awesome'); box.append(card, ok);
      for (let i = 0; i < 40; i++) { const p = el('i', { class: 'cf' }); p.style.cssText = `left:${Math.random() * 100}%;background:${RCOL[f.rarity]};animation-delay:${Math.random()}s;animation-duration:${1.8 + Math.random() * 1.6}s;width:7px;height:12px`; box.append(p); }
    }, 1400);
  }

  // ---------------------------------------------------------------- fighting
  function fight(b) {
    const d = curDeck(); if (!deckOk(d)) return;
    cur = b; window.pvpMode = false; window.campFight = { id: b.id }; const bd = bossDeck(b);
    send({ t: 'bot', auth: auth && auth.token, name: ($('#name') && $('#name').value) || 'Trainer', deck: { figs: d.figs, plates: d.plates }, boss: { name: b.name, deck: bd, skill: b.skill, stage: b.id, fee: Math.min(S.coins, b.fee) } });
  }
  function finish(v) {
    const b = cur; if (!b || done) return null; done = true; const box = el('div', { class: 'reward' }, el('div', { class: 'muted' }, 'Verifying result…'));
    const run = win => { const el2 = apply(b, win); box.innerHTML = ''; el2.childNodes.forEach(n => box.append(n.cloneNode(true))); };
    if (auth) api('/api/claim').then(r => { const x = r.result; run(x && !x.pending && x.stage === b.id ? !!x.win : false); }).catch(() => run(v.winner === v.seat)); else run(v.winner === v.seat);
    return box;
  }
  function apply(b, win) {
    const lines = [];
    if (win) {
      S.wins++;
      if (b.kind === 'tower') {
        const T = S.tower; T.cur = b.floor; T.best = Math.max(T.best, b.floor); S.coins += b.reward; S.stats.earned += b.reward; lines.push(`+🪙${b.reward} — Floor ${b.floor} cleared!`);
        if (b.floor % 10 === 0) plateDrop(lines, 'Tower floor ' + b.floor);
        if (b.floor % 5 === 0) { const ck = b.floor >= 30 ? 'gold' : b.floor >= 15 ? 'silver' : 'bronze'; S.free[ck] = (S.free[ck] || 0) + 1; lines.push(`Checkpoint reached! 🎁 Free ${FREE_NAMES[ck]}`); }
        lines.push(`Next: floor ${b.floor + 1}`);
      } else if (b.kind === 'daily') {
        S.coins += b.reward; S.daily = { key: b.key, won: true }; S.stats.daily = (S.stats.daily || 0) + 1; S.free.silver = (S.free.silver || 0) + 1; lines.push(`+🪙${b.reward}`, '🎁 Free Silver Chest!');
      } else {
        const first = !S.beaten[b.id]; const coins = first ? b.reward : Math.floor(b.reward * 0.3); S.coins += coins; S.stats.earned += coins; lines.push(`+🪙${coins}${first ? ' (first victory!)' : ''}`);
        if (b.hard) { lines.push('🔥 Hard mode cleared!'); if (!S.hardWon[b.id]) { S.hardWon[b.id] = 1; const ck = b.ch < 4 ? 'bronze' : b.ch < 8 ? 'silver' : 'gold'; S.free[ck] = (S.free[ck] || 0) + 1; lines.push('🎁 Bonus: free ' + FREE_NAMES[ck] + ' for the first Hard win!'); } }
        if (first) {
          S.beaten[b.id] = 1; const bd = bossDeck(b); const dropId = b.last ? bd.figs[0] : bd.figs[(Math.random() * bd.figs.length) | 0]; const f = fig(dropId); S.owned[dropId] = (S.owned[dropId] || 0) + 1; lines.push(`${b.name} gives you ${f.name} (${RNAME[f.rarity]})!`);
          if (b.last || (b.idx % 4 === 3)) plateDrop(lines, b.last ? 'chapter reward' : 'boss reward');
          if (b.unlock) lines.push(`${RNAME[b.unlock]} Pokémon now appear in the shop and chests!`);
          if (b.last) { const ch = CH[b.ch]; lines.push(`🏅 ${ch.badge} earned! Chapter ${b.ch + 1} complete!`); if (b.chest) { S.free[b.chest] = (S.free[b.chest] || 0) + 1; lines.push(`🎁 Free ${FREE_NAMES[b.chest]}`); } const nc = CH[b.ch + 1]; lines.push(nc ? `Chapter ${b.ch + 2} unlocked: ${nc.name}` : 'You beat the entire campaign — you are a legend!'); }
          else { const nx = BOSSES[b.idx + 1]; if (nx) lines.push(`Next challenger: ${nx.name}`); }
        }
      }
    } else {
      S.losses++; const fee = Math.min(S.coins, b.fee); S.coins -= fee; lines.push(fee ? `-🪙${fee} lost on defeat. Tweak your deck and try again!` : 'Defeated. Tweak your deck and try again!');
      if (b.kind === 'tower') { S.tower.cur = Math.floor(S.tower.cur / 5) * 5; lines.push(`You fall back to floor ${S.tower.cur + 1}.`); }
    }
    S.stock = null; save();
    return el('div', { class: 'reward' }, ...lines.map(x => el('div', {}, x)));
  }

  function loginScreen(msg) {
    const root = $c('camp'); root.innerHTML = ''; let nm, pw; const err = el('div', { class: 'err' }, msg || '');
    const go = async kind => { err.textContent = ''; try { const r = await api('/api/' + kind, 'POST', { name: nm.value, pass: pw.value }); if (!r.ok) { err.textContent = r.error || 'Failed'; return; } clearTimeout(saveT); dirty = false; auth = { name: r.name, token: r.token }; mem = null; try { localStorage.setItem('duel_auth', JSON.stringify(auth)); } catch (e) { } S = null; start(true, kind === 'register'); } catch (e) { err.textContent = 'Server unreachable.'; } };
    root.append(el('div', { class: 'panel loginbox' }, el('h2', {}, '⭐ Campaign sign-in'), el('div', { class: 'muted' }, 'Your collection, decks and progress are saved on the server under your name, so you can play from any device.'),
      nm = el('input', { placeholder: 'Trainer name', maxlength: 20, autocomplete: 'username' }), pw = el('input', { type: 'password', placeholder: 'Passcode (4+ characters)', autocomplete: 'current-password', onkeydown: e => { if (e.key === 'Enter') go('login'); } }),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => go('login') }, 'Sign in'), el('button', { onclick: () => go('register') }, 'Create account'), el('button', { class: 'ghost', onclick: () => show('lobby') }, '← Menu')), err,
      el('div', { class: 'small muted' }, 'Note: do not reuse an important password. There is no password recovery.')));
  }
  async function start(fresh, isNew) {
    if (!auth) return loginScreen();
    try {
      await flush(); const r = await api('/api/save'); if (r.status === 401) { auth = null; try { localStorage.removeItem('duel_auth'); } catch (e) { } return loginScreen('Session expired - please sign in again.'); }
      if (r.save && r.save.owned) S = mig(r.save); else { S = load(); if (!S) newSave(await starterPick()); else save(); }
      // an unfinished fight counts as a loss (closing the tab mid-fight does not dodge the fee)
      const c = await api('/api/claim'); const res = c.result;
      if (res && !res.win && !(window.campFight)) { const fee = Math.min(S.coins, +res.fee || 0); S.coins -= fee; S.losses++; save(); if (fee) setTimeout(() => alert(`Unfinished fight: -${fee} coins.`), 100); }
    } catch (e) { S = load(); if (!S) newSave(); }
    window.campFight = null; done = false; show('camp'); render();
  }

  window.Camp = {
    init() { const b = $c('goCamp'); if (b) b.onclick = () => window.Camp.open(); },
    open() { S = null; window.campFight = null; done = false; show('camp'); start(); },
    signOut() { flush(); clearTimeout(saveT); dirty = false; auth = null; S = null; mem = null; try { localStorage.removeItem('duel_auth'); } catch (e) { } loginScreen(); },
    auth: () => auth,
    finish, reset() { done = false; }, bosses: BOSSES,
    pvpMsg(t, isErr) { const n = document.getElementById('pvpNote'); if (!n) return false; n.classList.remove('hidden'); n.className = 'notice' + (isErr ? ' err' : ''); n.textContent = t; return true; },
    pvpRematch() { const L = window.pvpLast; if (L) send({ t: 'rematch', auth: L.auth, deck: L.deck }); },
    leaveToCamp() { window.pvpMode = false; window.campFight = null; sessionStorage.removeItem('duel_session'); V = null; window.Camp.open(); },
  };
})();
