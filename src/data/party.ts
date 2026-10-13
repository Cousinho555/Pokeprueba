import type { PokemonSet } from '@pkmn/sim';

/** Construye un set de Showdown con valores por defecto razonables para el juego. */
export function makeSet(species: string, level: number, moves: string[], ability: string): PokemonSet {
  return {
    name: species,
    species,
    level,
    moves,
    ability,
    item: '',
    nature: 'Hardy',
    gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

/** Un miembro del equipo: su set de Showdown y su estado persistente entre combates. */
export interface PartyMember {
  set: PokemonSet;
  /** PS actuales; `null` significa "PS al máximo". */
  hp: number | null;
}

/** Equipo del jugador (provisional, hasta tener elección de inicial y guardado en Supabase). */
export const party: PartyMember[] = [
  { set: makeSet('Charmander', 7, ['Scratch', 'Ember', 'Growl', 'Smokescreen'], 'Blaze'), hp: null },
  { set: makeSet('Pikachu', 6, ['Thunder Shock', 'Quick Attack', 'Tail Whip'], 'Static'), hp: null },
];

export function healParty(): void {
  for (const m of party) {
    m.hp = null;
  }
}

export function partyCanFight(): boolean {
  return party.some((m) => m.hp !== 0);
}
