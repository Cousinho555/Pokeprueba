import { bag, party, pc, type PartyMember } from './party';

/**
 * Partida guardada en el navegador (localStorage). Es provisional: cuando esté
 * Supabase, la partida irá a la nube. Si el navegador no deja guardar, se juega igual.
 */
const KEY = 'pokeprueba-partida-v1';

export interface Position {
  mapId: number;
  x: number;
  y: number;
  dir: number;
}

interface SaveData {
  party: PartyMember[];
  pc: PartyMember[];
  bag: Record<string, number>;
  pos: Position;
}

let lastPos: Position | null = null;

export function saveGame(pos?: Position): void {
  if (pos) lastPos = pos;
  if (!lastPos) return;
  const data: SaveData = { party, pc, bag, pos: lastPos };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Sin almacenamiento disponible.
  }
}

/** Carga la partida guardada en el estado del juego. Devuelve la posición, o null si no había. */
export function loadGame(): Position | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (!data.party?.length || !data.pos) return null;
    party.splice(0, party.length, ...data.party);
    pc.splice(0, pc.length, ...(data.pc ?? []));
    for (const k of Object.keys(bag)) delete bag[k];
    Object.assign(bag, data.bag ?? {});
    lastPos = data.pos;
    return data.pos;
  } catch {
    return null;
  }
}
