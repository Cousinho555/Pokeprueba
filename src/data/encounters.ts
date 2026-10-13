import { makeSet } from './party';
import type { PokemonSet } from '@pkmn/sim';

interface Encounter {
  species: string;
  ability: string;
  moves: string[];
  minLevel: number;
  maxLevel: number;
  weight: number;
}

/** Tabla de encuentros de la hierba alta del pueblo (equivalente a encounters.txt de Essentials). */
const HIERBA_PUEBLO: Encounter[] = [
  { species: 'Pidgey', ability: 'Keen Eye', moves: ['Tackle', 'Sand Attack'], minLevel: 3, maxLevel: 5, weight: 40 },
  { species: 'Rattata', ability: 'Run Away', moves: ['Tackle', 'Tail Whip'], minLevel: 3, maxLevel: 5, weight: 35 },
  { species: 'Caterpie', ability: 'Shield Dust', moves: ['Tackle', 'String Shot'], minLevel: 3, maxLevel: 4, weight: 20 },
  { species: 'Bulbasaur', ability: 'Overgrow', moves: ['Tackle', 'Growl', 'Vine Whip'], minLevel: 5, maxLevel: 5, weight: 5 },
];

/** Probabilidad de encuentro por paso en hierba alta. */
export const ENCOUNTER_RATE = 0.12;

export function rollWildPokemon(table: Encounter[] = HIERBA_PUEBLO): PokemonSet {
  const total = table.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  const e = table.find((x) => (r -= x.weight) < 0) ?? table[0];
  const level = e.minLevel + Math.floor(Math.random() * (e.maxLevel - e.minLevel + 1));
  return makeSet(e.species, level, e.moves, e.ability);
}
