'use strict';
// Plate catalogue. Original Pokémon Duel had ~100+ plates; this is a representative
// set that covers every plate category (red/purple/gold/blue/pink). Each plate may be used once per duel.
// target: 'none' | 'ownField' | 'ownBench' | 'ownPC' | 'switch' (field + bench)
const PLATES = {
  plus_power:   { name: 'Plus Power',     color: 'Red',    cost: 1, target: 'ownField', text: 'Chosen field Pokémon: White/Gold attacks deal +30 damage this turn.' },
  plus_power_2: { name: 'Mega Plus Power',color: 'Red',    cost: 2, target: 'ownField', text: 'Chosen field Pokémon: White/Gold attacks deal +60 damage this turn.' },
  threat:       { name: 'Type Threat',    color: 'Red',    cost: 1, target: 'ownField', text: 'Chosen field Pokémon deals +20 damage this turn and +30 against Pokémon sharing a type with it.' },
  switch:       { name: 'Switch Pokémon', color: 'Purple', cost: 1, target: 'switch',   text: 'Swap a field Pokémon with one from your bench (it takes that exact point; the benched Pokémon cannot be Waiting).' },
  hurdle_jump:  { name: 'Hurdle Jump',    color: 'Purple', cost: 1, target: 'ownField', text: 'Chosen field Pokémon may move through other Pokémon this turn.' },
  speed_boost:  { name: 'Speed Boost',    color: 'Purple', cost: 1, target: 'ownField', text: 'Chosen Pokémon (field or bench) gets +1 MP this turn.' , bench: true },
  retreat:      { name: 'Retreat',        color: 'Purple', cost: 1, target: 'ownField', text: 'Move a field Pokémon to your bench.' },
  goal_block:   { name: 'Goal Block',     color: 'Gold',   cost: 1, target: 'none',     text: 'Opponent cannot enter your goal during their next turn.' },
  focus_band:   { name: 'Focus Band',     color: 'Gold',   cost: 1, target: 'ownField', text: 'Chosen field Pokémon is not knocked out in its next battle (it moves to the bench instead).' },
  big_guard:    { name: 'Big Guard',      color: 'Gold',   cost: 1, target: 'ownField', text: 'Chosen field Pokémon takes -30 damage from attackers until your next turn.' },
  double_chance:{ name: 'Double Chance',  color: 'Blue',   cost: 1, target: 'none',     text: 'This turn, your first Miss spin in battle is automatically re-spun once.' },
  respin_all:   { name: 'Lucky Egg',      color: 'Blue',   cost: 2, target: 'none',     text: 'Until your next turn you may re-spin one Miss or Blue result (battle you take part in).' },
  revive:       { name: 'Revive',         color: 'Pink',   cost: 1, target: 'ownPC',    text: 'Move a Pokémon from your P.C. to your bench.' },
  full_heal:    { name: 'Full Heal',      color: 'Pink',   cost: 1, target: 'none',     text: 'Remove all special conditions from your Pokémon on the field.' },
  wake_up:      { name: 'Wake Up',        color: 'Pink',   cost: 1, target: 'ownField', text: 'Remove Wait from a chosen Pokémon (field or bench).', bench: true },
  z_charge:     { name: 'Z-Ring Charge',  color: 'Pink',   cost: 2, target: 'none',     text: 'Your Z-Move gauge is filled by 50%.' },
};
module.exports = { PLATES };
