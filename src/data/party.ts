import { makePokemon, type PokemonSpec } from './essentials';

/** Un miembro del equipo y su estado persistente entre combates. */
export interface PartyMember {
  spec: PokemonSpec;
  /** PS actuales; `null` significa "PS al máximo". */
  hp: number | null;
}

/** Equipo del jugador (provisional, hasta tener elección de inicial y guardado en Supabase). */
export const party: PartyMember[] = [];

export function initParty(): void {
  party.length = 0;
  party.push({ spec: makePokemon('CHARMANDER', 14), hp: null }, { spec: makePokemon('PIKACHU', 12), hp: null });
}

export function healParty(): void {
  for (const m of party) m.hp = null;
}

export function partyCanFight(): boolean {
  return party.some((m) => m.hp !== 0);
}
