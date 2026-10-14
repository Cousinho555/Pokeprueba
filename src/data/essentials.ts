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
  exp: number;
  crecimiento: string;
  captura: number;
  evoluciones: [string, string, string][];
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

/** Entrenador de un combate de un evento (pbTrainerBattle o customTrainerBattle). */
export interface Entrenador {
  clase: string;
  nombre: string;
  /** Número del sprite de combate (trainers/N.png). */
  sprite: number;
  /** Dinero base: se multiplica por el nivel de su último Pokémon. */
  dinero: number;
  derrota: string;
  /** [especie, nivel, movimientos (vacío = los que aprende por nivel)] */
  equipo: [string, number, string[]][];
}

/** Objeto de items.txt. */
export interface Objeto {
  id: number;
  nombre: string;
  plural: string;
  bolsillo: number;
  precio: number;
  descripcion: string;
  usoMapa: number;
  usoCombate: number;
  mt: string;
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
  /** "SE/nombre" -> ruta dentro de sonidos/, para los sonidos que usan los eventos. */
  sonidos: Record<string, string>;
}

/** Pokémon descrito con datos de Essentials; el motor de combate lo convierte en un set de Showdown. */
export interface PokemonSpec {
  interno: string;
  num: number;
  nombre: string;
  nivel: number;
  /** Experiencia total acumulada. */
  exp: number;
  movimientos: string[];
  habilidad: string;
}

export const ESS = 'assets/essentials/';

export let mundo: Mundo;
export let especies: Record<string, Especie>;
export let movimientos: Record<string, string>;
export let objetos: Record<string, Objeto>;

export function registerEssentials(m: Mundo, e: Record<string, Especie>, mv: Record<string, string>, o: Record<string, Objeto>): void {
  mundo = m;
  especies = e;
  movimientos = mv;
  objetos = o;
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
    exp: expForLevel(e.crecimiento, nivel),
    movimientos: learned.slice(-4),
    habilidad: e.habilidades[0] ?? '',
  };
}

// ------------------------------------------------------------------ progresión

/** Experiencia total necesaria para tener un nivel, según el ritmo de crecimiento. */
export function expForLevel(growth: string, n: number): number {
  if (n <= 1) return 0;
  const n3 = n ** 3;
  switch (growth) {
    case 'Fast':
      return Math.floor((4 * n3) / 5);
    case 'Slow':
      return Math.floor((5 * n3) / 4);
    case 'Parabolic':
      return Math.max(0, Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140));
    case 'Erratic':
      if (n <= 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n <= 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n <= 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case 'Fluctuating':
      if (n <= 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n <= 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
    default: // Medium
      return n3;
  }
}

/** Experiencia que da derrotar a un Pokémon (fórmula clásica: experiencia base × nivel / 7). */
export function expYield(foe: PokemonSpec, wild: boolean): number {
  const base = especies[foe.interno]?.exp ?? 50;
  return Math.max(1, Math.floor(((base * foe.nivel) / 7) * (wild ? 1 : 1.5)));
}

/** Movimientos que la especie aprende justo en ese nivel. */
export function movesLearnedAt(interno: string, nivel: number): string[] {
  return (especies[interno]?.movimientos ?? []).filter(([l]) => l === nivel).map(([, m]) => m);
}

/** Especie a la que evoluciona por nivel, si ya le toca. */
export function levelEvolution(spec: PokemonSpec): string | null {
  for (const [target, method, param] of especies[spec.interno]?.evoluciones ?? []) {
    if ((method === 'Level' || method === 'LevelForm0') && spec.nivel >= Number(param) && especies[target]) {
      return target;
    }
  }
  return null;
}

/** Cambia la especie de un Pokémon (evolución), manteniendo nivel, experiencia y movimientos. */
export function evolve(spec: PokemonSpec, target: string): void {
  const e = especies[target];
  spec.interno = target;
  spec.num = e.num;
  spec.nombre = e.nombre;
  if (!e.habilidades.includes(spec.habilidad)) spec.habilidad = e.habilidades[0] ?? spec.habilidad;
}

/** Equipo de un entrenador listo para combatir. */
export function trainerTeam(t: Entrenador): PokemonSpec[] {
  return t.equipo
    .filter(([sp]) => especies[sp])
    .map(([sp, nivel, moves]) => {
      const spec = makePokemon(sp, nivel);
      if (moves.length) spec.movimientos = moves.slice(0, 4);
      return spec;
    });
}

/** Dinero que se gana al vencer a un entrenador (como Essentials: base × nivel del último Pokémon). */
export function trainerPrize(t: Entrenador): number {
  return t.dinero * (t.equipo.at(-1)?.[1] ?? 1);
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
