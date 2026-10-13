import { Battle, Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { ProtocolTranslator, type BattleEvent } from './protocol';

export interface MoveOption {
  index: number; // 1-based, como espera Showdown ("move 1")
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
  set: PokemonSet;
  hp?: number | null;
}

/**
 * Envuelve el simulador de Showdown (@pkmn/sim) para un combate individual
 * jugador (p1) contra la IA (p2). Todo se ejecuta en el navegador, sin servidor.
 */
export class BattleEngine {
  readonly battle: Battle;
  private cursor = 0;
  private translator: ProtocolTranslator;

  constructor(player: Combatant[], foe: Combatant[], opts: { wild: boolean; playerName?: string }) {
    const playerName = opts.playerName ?? 'Jugador';
    this.translator = new ProtocolTranslator(playerName, opts.wild);
    this.battle = new Battle({ formatid: 'gen9customgame' as never });
    this.battle.setPlayer('p1', { name: playerName, team: player.map((c) => c.set) });
    this.battle.setPlayer('p2', { name: opts.wild ? 'Salvaje' : 'Rival', team: foe.map((c) => c.set) });
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
    return req.active[0].moves.map((m, i) => ({
      index: i + 1,
      name: m.move,
      pp: m.pp ?? 0,
      maxpp: m.maxpp ?? 0,
      disabled: !!m.disabled || m.pp === 0,
    }));
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

/** Tipos de una especie, para colorear los gráficos provisionales. */
export function speciesTypes(species: string): string[] {
  return [...Dex.species.get(species).types];
}
