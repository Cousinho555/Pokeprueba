/**
 * Datos importados de Pokémon Essentials BES (ver tools/import_essentials.py).
 * BootScene los carga y los registra aquí antes de entrar al mundo.
 */

export interface Especie {
  num: number;
  nombre: string;
  tipos: string[];
  habilidades: string[];
  movimientos: [number, string][];
  especie: string;
  posJugadorY: number;
  posEnemigoY: number;
  altitud: number;
}

export interface InfoMapa {
  id: number;
  nombre: string;
  ancho: number;
  alto: number;
  tileset: number;
  autotiles: number;
  imagen: string;
  bgm: string;
  graficos: string[];
  exterior: boolean;
  fondoCombate: string;
  curacion?: [number, number, number];
}

/** [especie, nivel mínimo, nivel máximo, peso] */
export type HuecoEncuentro = [string, number, number, number];

export interface Mundo {
  inicio: { mapa: number; x: number; y: number; dir: number };
  jugador: string;
  /** Tamaño de un frame [ancho, alto] de cada hoja de personaje. */
  graficos: Record<string, [number, number]>;
  mapas: Record<string, InfoMapa>;
  /** [mapa1, lado1, desplazamiento1, mapa2, lado2, desplazamiento2] como en connections.txt */
  conexiones: [number, string, number, number, string, number][];
  encuentros: Record<string, { densidad: number; tablas: Record<string, HuecoEncuentro[]> }>;
}

/** Pokémon descrito con datos de Essentials; el motor de combate lo convierte en un set de Showdown. */
export interface PokemonSpec {
  interno: string;
  num: number;
  nombre: string;
  nivel: number;
  movimientos: string[];
  habilidad: string;
}

export const ESS = 'assets/essentials/';

export let mundo: Mundo;
export let especies: Record<string, Especie>;
export let movimientos: Record<string, string>;

export function registerEssentials(m: Mundo, e: Record<string, Especie>, mv: Record<string, string>): void {
  mundo = m;
  especies = e;
  movimientos = mv;
}

/** Nombre en español de un movimiento a partir de su id de Showdown o nombre interno. */
export function moveName(idOrName: string): string {
  const key = idOrName.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return movimientos?.[key] ?? idOrName;
}

/** Crea un Pokémon con los últimos 4 movimientos que aprende por nivel, como hace Essentials. */
export function makePokemon(interno: string, nivel: number): PokemonSpec {
  const e = especies[interno];
  const learned: string[] = [];
  for (const [lvl, mv] of e.movimientos) {
    if (lvl > nivel) break;
    const i = learned.indexOf(mv);
    if (i >= 0) learned.splice(i, 1);
    learned.push(mv);
  }
  return {
    interno,
    num: e.num,
    nombre: e.nombre,
    nivel,
    movimientos: learned.slice(-4),
    habilidad: e.habilidades[0] ?? '',
  };
}

/** Tirada de encuentro salvaje para un mapa, o null si el mapa no tiene encuentros de tierra. */
export function rollEncounter(mapId: number): PokemonSpec | null {
  const enc = mundo.encuentros[mapId];
  const hour = new Date().getHours();
  const night = hour >= 20 || hour < 5;
  const table = enc?.tablas[night ? 'LandNight' : 'LandDay'] ?? enc?.tablas.Land ?? enc?.tablas.Cave;
  if (!table?.length) return null;
  const total = table.reduce((s, h) => s + h[3], 0);
  let r = Math.random() * total;
  const [interno, lo, hi] = table.find((h) => (r -= h[3]) < 0) ?? table[0];
  return makePokemon(interno, lo + Math.floor(Math.random() * (hi - lo + 1)));
}

/** Probabilidad de encuentro por paso (Essentials: densidad / 180). */
export function encounterChance(mapId: number): number {
  return (mundo.encuentros[mapId]?.densidad ?? 0) / 180;
}
