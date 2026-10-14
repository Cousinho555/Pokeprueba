import { makePokemon, type PokemonSpec } from './essentials';

/** Un miembro del equipo y su estado persistente entre combates. */
export interface PartyMember {
  spec: PokemonSpec;
  /** PS actuales; `null` significa "PS al máximo". */
  hp: number | null;
}

export const MAX_PARTY = 6;

/** Una casilla del mundo. */
export interface Position {
  mapId: number;
  x: number;
  y: number;
  dir: number;
}

/** Dinero, entrenadores vencidos ("mapa:evento") y dónde despiertas si pierdes. */
export const progress = {
  dinero: 3000,
  vencidos: [] as string[],
  regreso: null as Position | null,
};

/** Equipo del jugador, Pokémon guardados en el PC y mochila. */
export const party: PartyMember[] = [];
export const pc: PartyMember[] = [];
export const bag: Record<string, number> = {};

/** Poké Balls que entiende el juego: nombre y multiplicador de captura. */
export const BALLS: Record<string, { nombre: string; ratio: number }> = {
  POKEBALL: { nombre: 'Poké Ball', ratio: 1 },
  GREATBALL: { nombre: 'Super Ball', ratio: 1.5 },
  ULTRABALL: { nombre: 'Ultra Ball', ratio: 2 },
};

export function initParty(): void {
  party.length = 0;
  pc.length = 0;
  party.push({ spec: makePokemon('CHARMANDER', 14), hp: null }, { spec: makePokemon('PIKACHU', 12), hp: null });
  for (const k of Object.keys(bag)) delete bag[k];
  Object.assign(bag, { POKEBALL: 10, GREATBALL: 3 });
  Object.assign(progress, { dinero: 3000, vencidos: [], regreso: null });
}

export function healParty(): void {
  for (const m of party) m.hp = null;
}

export function partyCanFight(): boolean {
  return party.some((m) => m.hp !== 0);
}

/** Añade un Pokémon capturado: al equipo si cabe, si no al PC. Devuelve dónde ha ido. */
export function addCaught(member: PartyMember): 'equipo' | 'pc' {
  if (party.length < MAX_PARTY) {
    party.push(member);
    return 'equipo';
  }
  pc.push(member);
  return 'pc';
}
