# Pokémon Duel Web

Browser-based multiplayer recreation of the retired mobile game *Pokémon Duel* (Pokémon Comaster).
All 593 figures in `data/all_pokemon_data.json` are playable.

## Run
```
npm install
npm start          # http://localhost:3000   (PORT=xxxx to change)
npm test           # headless bot-vs-bot simulation of the rules engine
```
Open the page, build a team (6 figures + plates up to 6 cost), then **Play vs bot**, **Create room**
(share the 4-letter code) or **Join room**. To play over the internet, host it anywhere that runs Node and
supports WebSockets (Render, Fly.io, a VPS…) or tunnel it (e.g. `cloudflared tunnel --url http://localhost:3000`).

## Architecture
- `lib/engine.js` – authoritative rules engine (turns, movement, battles, statuses, plates, KO/P.C., Z-gauge, win conditions)
- `lib/figures.js` – parses the JSON: wheels, damage formats (`40`, `20x`, `70+`, `☆☆`), ability flags and ~1,380 of the ~2,050 move-note texts into effect ops
- `lib/board.js` – board graph; `lib/plates.js` – plate catalogue; `lib/bot.js` – simple AI
- `server.js` – HTTP + WebSocket rooms (reconnect supported, no clock)
- `public/` – SVG board client

## Implemented rules
Plate → move → battle turn order; one Pokémon moves per turn; MP movement along routes; bench entry (1 MP via a free entry point);
first player's first turn −1 MP; mandatory battle when ending adjacent to an enemy; full colour-vs-colour battle table
(White/Gold damage compare, Purple effect, Blue block, Red miss); spin-again damage (`x`, `+`); statuses (poison/noxious/paralysis/burn/
frozen/confusion/sleep); Wait; P.C. (holds 2, overflow returns to bench with Wait 1); surround KO; goal capture; per-player clock; 300-turn draw; Z-Move gauge.

## Battle presentation
When a battle happens the client freezes the board at the pre-battle positions, highlights the attacker (⚔) and defender (🛡), spins both wheels, then reveals the result and finally applies the post-battle board (knock-backs, relocations, KOs). Click to skip.

## Movement animation & tagging
Pieces glide along the board routes, newly entered Pokémon pop in from their entry point, and knocked-out Pokémon fade away. Tagging: ending a move next to your own Pokémon removes their special conditions (Kyurem/Bergmite block frozen removal, Pinsir blocks tagging, Magearna also removes markers).

## Honest limitations
- **Board**: transcribed from the official board image (26 points + 2 goals, corner entry points, inner ring, diagonals); see `lib/board.js`.
- **Plates**: 16 representative plates, not the original ~100+.
- **Move effects**: about 80 % of the ~2,050 move-note texts are parsed and simulated (knock-backs, claim-spot, spin-groups, bench/P.C./Ultra-Space moves, statuses, markers, conditional damage, etc.). The remaining ~20 % (form changes, plate interactions, Photon/Lock-On markers, timed field-wide effects, "next turn is always the other player's") show "(effect not simulated)" in the UI.
- **Abilities**: 264 of the 461 figures with an ability have at least part of it simulated: status immunities and team immunities, contact statuses, damage auras (type/aura/per-count/adjacent/turn bonuses), damage reductions, MP bonuses and penalties, selective pass-through/fly-over rules, Blue/Gold wheel changes, no-Wait, wake-up, and more. The rest (evolution/form changes, switching on being attacked, multi-step choices, plate interactions) show their text only and are labelled in the UI. `npm run test:abilities` runs targeted checks.
- **Not implemented**: Evolution, Mega Evolution, form changes (Rotom etc.), markers other than MP−/Cracked/Curse, "choose" prompts for repositioning effects (auto-chosen toward the enemy goal).
- Figure images load from serebii.net (hotlinked from your data file); offline they fall back to letter tiles.

## Latest update
- Multi-spin attacks (e.g. "spin twice", multiplier/plus wheels) now show each spin in turn ("Spin 1 / 2: …").
- Status conditions and markers (burn, poison, paralysis, MP−, cracked, curse, Focus Band…) appear as badges on the piece, with a pop-in when applied.
- Reposition effects (2 steps away, pull closer, swap, "choose a point") work; when you get to choose, glowing points appear (or "Stay where it is").
- Pokémon may stand on goal points; only the enemy goal wins, and abilities like Whims of the Wind (no goal win) are respected.
- Heat Wave is simulated.
- Each side has a P.C. zone (2 slots) beside the bench; benched Pokémon of the opponent are hidden.
- Animated Victory / Defeat / Draw popup with confetti, stats, Rematch (vs bot) and Team builder.

## Campaign, rematch and fixes (latest)
- **Single-player campaign** (lobby → "Single-player campaign"): you start with 6 random Commons and 🪙500. Beat the 10-boss ladder (Youngster Joey → Master Red); each first win pays coins and drops one of the boss's Pokémon, and certain bosses unlock higher rarities (Uncommon → Rare → Ex → Ultra) in the shop and chests. Tabs: Bosses, Collection (sell duplicates), Decks (up to 5 saved decks built only from owned Pokémon), Shop & Chests (4 chest tiers, rotating stock priced at the figure's material cost). Progress is saved in the browser (`localStorage`). Bots are untimed and get stronger with the boss's skill value.
- **Rematch** from the game-over popup (same team or random team) and a "Restart" button in the header; in PvP both players must accept.
- Fixes: attack in place when adjacent, MP0 bench entry, Foundation, Whiteout (range aura), sleep/Rest/Lullaby/Sing/Mass Hypnosis, "move one Pokémon … gains Wait" effects (interactive choice), knock-back + Wait variants, Energy Ball, Genesis Supernova, Water Jump, Flash Over, Zap Cannon.

## Campaign v2
- Story mode: 12 chapters, 112 fights (v10.13 added Battle Frontier, Shadow Realm, Ultra Space, Mythic Summit + Hard mode) (route trainers, rival Kael ×7, gym leaders, Elite Four, champions, a syndicate arc and a final boss). Each chapter ends in a badge, a free chest and a shop/chest rarity unlock; every boss team is built around a signature "ace".
- Battle Tower: endless floors with checkpoints every 5 floors (free chests; a loss drops you back to the last checkpoint).
- Daily Challenge (new themed opponent each day, free Silver Chest) and 25 Quests with coin/chest rewards.
- Defeats cost coins; replays pay 30% of the first-clear reward.

## Accounts, saves & bot (v3)
- Campaign sign-in (name + passcode) with server-side saves in SQLite (`data/duel.sqlite`, override with `DUEL_DB`). The server records fight results; unfinished fights count as a loss. Needs Node 22+ (`node:sqlite`). Host with a persistent disk.
- Tower leaderboard at `/api/leaderboard`.
- Bot: evaluates win-race tempo (wall-aware path turns), enemy threats against your goal, battle odds (`E.estimate`), targeted plate use (Goal Block, Speed Boost, Hurdle Jump, power plates), Z-move choice by odds. `node test/arena.js 200 0.95 0.1` pits two skill levels against each other.
- ~60 more move effects simulated (Taunt, Torment, Break Energy, Round/Attack Order scaling, Psycho Shift, Flame Gun, Fissure, Hydro Kick, ...). About 180 rare move texts remain "not simulated".

## Simulation coverage (v7)
Move texts: all but 9 distinct are simulated (remaining: Dig, Nebby's Power, White Tentacles, Multiblast Lock-On source, Photon Geyser, Reflect Move, Ancient Power Restored, Mystery Scent evolution).
Abilities added in v7: Stench, Battery, Artificial Turf, Sneaky Steps, Balloon Trick, Queenly Majesty, Static, Rough Skin, Lightning Rod, Sap Sipper, Dry Skin, Scrappy, Thermostat, Intimidating Aura (plate lock + Dark +20), Crescent Veil, Sacred Fencer (damage), Darkness Crystal (no KO by damage), Slow Start (MP part), Electroswap, Magnetic Body, Ocean's Gift, Rally, Enhanced Core, Earth Rapids, Mud Coating, Coral Power, Force Balance, Mold Breaker, Supersonic Speed, Iron Heart, Psychic Surge (gold→white), Arena Trap, Raid, Forest Leap, Refraction, Hypnotic Voice, Serene Light, Behavioral Prediction, Connection.
Still text-only: evolution/form-change abilities, Restored Pokémon chains, Ultra Beast abilities, Lock-On, Illusion, Multitype and other complex abilities.
v8: Run Away (bench dodge), Sand Veil (3 variants), Migraine, Battle Armor, Reflective Laser (auto-used), Psychic Net, Spinning Pattern, Compound Eyes, Bide (cannot start battles). Confused Pokémon now log "spin drifts from X to Y" each time their spin shifts (it was already shifting, but invisibly).
v8.1: fixed accounts inheriting the previous account's save; opening-turn MP-1 is now announced in the log.
v9: Plate-use animation (card with name, user, target, effect) for both players. Campaign plate collection: 4 starter plates (Plus Power, Speed Boost, Full Heal, Switch Pokémon); buy the rest in the Shop (150 coins per cost point, +100 for cost-2 plates), win them from every 4th boss and chapter-end bosses, chests (12%/25%/40% bonus drop) and Tower floors 10/20/30. Multiplayer keeps every plate unlocked.
v10 UI: sound effects (M or 🔊 to mute), KO shake + popup, hover preview of a Pokémon's moves, plate cards with icons, pulsing turn banner + "thinking" dots for the opponent, Esc cancels a selection, fixed clipped player headers, board/benches fit one screen, campaign hover effects.
v10.3: landing on the goal while fully surrounded knocks the Pokémon out instead of winning.
v10.4: new accounts choose 1 of 3 random starter teams (Commons, each with an MP3 Pokémon and 3+ types), 2 free re-rolls.
v10.5: campaign saves live on the server only (no browser copies); old browser copies are deleted on load.
v10.6: Collection PvP (Campaign → PvP): rooms limited to owned Pokémon/plates, server-verified, W/L record + top 10. Resign now works on the opponent's turn too.
v10.7: Loyalty (Lycanroc Midday: bench itself at turn start and reuse immediately, clears Wait) and the 'if evolved +1 MP' text (Lycanroc, Magnezone, Omastar).
v10.8: Psychic Shove / Pancake now push strictly in a straight line (the old knock logic could curve toward the goal).
v10.9: random teams (rematch / restart / practice bot) are truly random again; they were accidentally always the 6 strongest-looking UX Pokémon.
v10.10: Gold now beats Purple (priority), as the rules text says; a bug made Purple's effect win against Gold.
- v10.11: Pokémon surrounded on any point (incl. one it jumps/moves into, or sitting on a goal) are now knocked out for both sides, and a check runs at end of every turn.
- v10.12: moving a poisoned/noxious Pokémon cures it.
- v10.13: 4 new chapters (40 fights) after the League, Hard mode toggle on story fights (2× coins, bonus chest on first Hard win), new quests.
- v10.14: Parting Shot (Pancham/Pangoro) now offers the bench switch as well as the Wait.
- v10.15: clear Z-Move panel (how-to, per-Pokémon Z buttons, armed state); engine ignores a Z colour the attacker doesn't have.
- v10.16: Flame Gun (Magmortar) now knocks out the battle opponent as well as the Pokémon behind it.
- v10.17: battle log now states why colours cancelled (e.g. equal Purple stars = no effects).
- v10.18: confused spins now visibly drift: the pointer lands on the original segment, then slips to the neighbouring one with a label.
- v10.19: moving a Pokémon, or an ally tagging it, removes its MP markers.
- v10.20: Black Core (Cosmoem): cannot be surrounded; negates Energy plates (Plus Power, Mega Plus Power, Type Threat, Speed Boost, Big Guard) while on the field. The 'may evolve' part is flavour only.
- v10.21: 0-damage White attacks (Harden) no longer knock out a Miss; a Pokémon that lands on the enemy goal through an effect move (e.g. Corkscrew Crash) now wins (or is KO'd if surrounded).
- v10.22: Pokémon with two Z-Moves of the same colour (e.g. Magnemite's Corkscrew Crash / Gigavolt Havoc) now let you choose which one; the wheel uses only the chosen Z-Move.
- v10.23: 'moves N steps back' (Shinx Blind, Sentret, Mew/Crobat Shuttle Flip) only offers points farther from the battle opponent; landing on the goal via any effect move already wins (v10.21).
- v10.24: mobile layout pass (header wraps, board fits phone width, scrollable tabs, deck filters wrap, bigger touch targets); Dig implemented (moves away from attached Pokémon); Fly Away/Fly lands on any point around the opponent incl. the goal and a safety net ends the game if any effect leaves a Pokémon on its goal.
"# pokkemonDuel" 
