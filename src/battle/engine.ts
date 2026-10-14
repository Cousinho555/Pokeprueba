import { Battle, Dex, toID } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { ProtocolTranslator, type BattleEvent } from './protocol';
import { moveName, type PokemonSpec } from '../data/essentials';

export interface MoveOption {
  index: number; // 1-based, como espera Showdown ("move 1")
  id: string;
  name: string;
  pp: number;
  maxpp: number;
  disabled: boolean;
}

export interface SwitchOption {
  index: number; // 1-based ("switch 2")
  name: string;
  hp: number;
  maxhp: number;
  active: boolean;
}

export interface Combatant {
  spec: PokemonSpec;
  hp?: number | null;
}

/**
 * Showdown no sabe capturar Pokémon. Para lanzar una Poké Ball sin que el
 * jugador ataque, se le da un movimiento oculto que no hace nada: así el rival
 * actúa con normalidad en ese turno.
 */
const BALL_MOVE = 'pokeballthrow';
const dex = Dex.mod('pokeprueba', {
  Moves: {
    [BALL_MOVE]: {
      num: -1000, name: 'Poke Ball Throw', accuracy: true, basePower: 0, category: 'Status',
      pp: 64, priority: 7, flags: {}, target: 'self', type: '???', onTryMove: () => null,
    },
  },
} as never);

/** Convierte un Pokémon de Essentials en un set de Showdown. */
export function toSet(spec: PokemonSpec): PokemonSet {
  const species = Dex.species.all().find((sp) => sp.num === spec.num && !sp.forme) ?? Dex.species.get(spec.interno);
  const moves = spec.movimientos.map(toID).filter((id) => Dex.moves.get(id).exists);
  const ability = Dex.abilities.get(toID(spec.habilidad));
  return {
    name: spec.nombre,
    species: species.name,
    level: spec.nivel,
    moves: moves.length ? moves : ['tackle'],
    ability: ability.exists ? ability.name : species.abilities[0],
    item: '',
    nature: 'Hardy',
    gender: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  };
}

/**
 * Envuelve el simulador de Showdown (@pkmn/sim) para un combate individual
 * jugador (p1) contra la IA (p2). Todo se ejecuta en el navegador, sin servidor.
 */
export class BattleEngine {
  readonly battle: Battle;
  private cursor = 0;
  private translator: ProtocolTranslator;

  constructor(player: Combatant[], foe: Combatant[], opts: { wild: boolean; playerName?: string; foeName?: string }) {
    const playerName = opts.playerName ?? 'Jugador';
    this.translator = new ProtocolTranslator(playerName, opts.wild, moveName, opts.foeName);
    this.battle = new Battle({ formatid: 'gen9customgame' as never }, dex);
    const withBall = (set: PokemonSet) => ({ ...set, moves: [...set.moves, BALL_MOVE] });
    this.battle.setPlayer('p1', { name: playerName, team: player.map((c) => withBall(toSet(c.spec))) });
    this.battle.setPlayer('p2', { name: opts.wild ? 'Salvaje' : 'Rival', team: foe.map((c) => toSet(c.spec)) });
    applyState(this.battle.p1.pokemon, player);
    applyState(this.battle.p2.pokemon, foe);
    // Saltamos la vista previa de equipos del formato "custom game".
    this.battle.choose('p1', 'default');
    this.battle.choose('p2', 'default');
  }

  /** Eventos nuevos desde la última llamada. */
  drainEvents(): BattleEvent[] {
    const lines = this.battle.log.slice(this.cursor);
    this.cursor = this.battle.log.length;
    return this.translator.translate(lines);
  }

  get ended(): boolean {
    return this.battle.ended;
  }

  /** El jugador tiene que elegir un Pokémon (porque el suyo se ha debilitado). */
  get mustSwitch(): boolean {
    const req = this.battle.p1.activeRequest;
    return !!req && 'forceSwitch' in req && !!req.forceSwitch?.[0];
  }

  get moves(): MoveOption[] {
    const req = this.battle.p1.activeRequest;
    if (!req || !('active' in req) || !req.active) return [];
    return req.active[0].moves
      .map((m, i) => ({
        index: i + 1,
        id: m.id,
        name: moveName(m.id),
        pp: m.pp ?? 0,
        maxpp: m.maxpp ?? 0,
        disabled: !!m.disabled || m.pp === 0,
      }))
      .filter((m) => m.id !== BALL_MOVE);
  }

  get switches(): SwitchOption[] {
    return this.battle.p1.pokemon.map((p, i) => ({
      index: i + 1,
      name: p.name,
      hp: p.hp,
      maxhp: p.maxhp,
      active: p.isActive,
    }));
  }

  chooseMove(index: number): void {
    this.battle.choose('p1', `move ${index}`);
    this.runAI();
  }

  /** Turno en el que el jugador lanza una Poké Ball que no ha atrapado al rival. */
  chooseBallTurn(): void {
    const req = this.battle.p1.activeRequest;
    const idx = req && 'active' in req && req.active ? req.active[0].moves.findIndex((m) => m.id === BALL_MOVE) : -1;
    this.battle.choose('p1', idx >= 0 ? `move ${idx + 1}` : 'default');
    this.runAI();
  }

  /**
   * Fórmula de captura de 3ª/4ª generación. Devuelve cuántas veces se sacude
   * la Poké Ball (0-3) o 4 si el Pokémon queda atrapado.
   */
  tryCatch(catchRate: number, ballRatio: number): number {
    const foe = this.battle.p2.active[0];
    const status = foe.status === 'slp' || foe.status === 'frz' ? 2 : foe.status ? 1.5 : 1;
    const a = Math.floor((((3 * foe.maxhp - 2 * foe.hp) * catchRate * ballRatio) / (3 * foe.maxhp)) * status);
    if (a >= 255) return 4;
    const b = Math.floor(1048560 / Math.floor(Math.sqrt(Math.floor(Math.sqrt(16711680 / Math.max(1, a))))));
    let shakes = 0;
    while (shakes < 4 && Math.random() * 65536 < b) shakes++;
    return shakes;
  }

  /** Índice (en el equipo rival) del Pokémon activo del rival. */
  foeIndex(): number {
    return this.battle.p2.pokemon.findIndex((p) => p.isActive);
  }

  /** PS máximos en combate de cada Pokémon del jugador. */
  playerMaxHP(): number[] {
    return this.battle.p1.pokemon.map((p) => p.maxhp);
  }

  /** PS actuales del rival activo. */
  foeHP(): number {
    return this.battle.p2.active[0]?.hp ?? 0;
  }

  /** Índice (en el equipo del combate) del Pokémon activo del jugador. */
  activeIndex(): number {
    return this.battle.p1.pokemon.findIndex((p) => p.isActive);
  }

  chooseSwitch(index: number): void {
    this.battle.choose('p1', `switch ${index}`);
    this.runAI();
  }

  /** Estado final de los Pokémon del jugador, para guardarlo tras el combate. */
  playerHP(): number[] {
    return this.battle.p1.pokemon.map((p) => p.hp);
  }

  /** IA sencilla: ataque aleatorio entre los disponibles. Se mejorará más adelante. */
  private runAI(): void {
    const side = this.battle.p2;
    // El jugador ya ha elegido; si el rival también debe elegir, lo hace ahora.
    for (let guard = 0; guard < 5 && !this.battle.ended; guard++) {
      const req = side.activeRequest;
      if (!req || req.wait || side.isChoiceDone()) break;
      if ('forceSwitch' in req && req.forceSwitch) {
        this.battle.choose('p2', 'default');
      } else if ('active' in req && req.active) {
        const usable = req.active[0].moves
          .map((m, i) => ({ m, i: i + 1 }))
          .filter(({ m }) => !m.disabled && m.pp !== 0);
        const pick = usable[Math.floor(Math.random() * usable.length)];
        this.battle.choose('p2', pick ? `move ${pick.i}` : 'default');
      } else {
        this.battle.choose('p2', 'default');
      }
    }
  }
}

function applyState(mons: Battle['p1']['pokemon'], state: Combatant[]): void {
  mons.forEach((p, i) => {
    const s = state[i];
    if (s.hp != null) p.hp = Math.min(s.hp, p.maxhp);
  });
}

/** Número de Pokédex de una especie de Showdown (para elegir el sprite). */
export function speciesNum(species: string): number {
  return Dex.species.get(species).num;
}

/** PS máximos de un Pokémon a su nivel (IV 31, sin EV), como los calcula Showdown. */
export function maxHP(spec: PokemonSpec): number {
  const species = Dex.species.get(toSet(spec).species);
  if (species.baseStats.hp === 1) return 1;
  return Math.floor(((2 * species.baseStats.hp + 31) * spec.nivel) / 100) + spec.nivel + 10;
}

/** Tipo y categoría de un movimiento (para elegir una animación parecida si no tiene propia). */
export function moveInfo(id: string): { type: string; category: string } | null {
  const m = Dex.moves.get(id);
  return m.exists ? { type: m.type, category: m.category } : null;
}
