import Phaser from 'phaser';
import type { PokemonSet } from '@pkmn/sim';
import type { BattleEngine } from '../battle/engine';
import type { BattleEvent, SideID } from '../battle/protocol';
import { party } from '../data/party';

export interface BattleData {
  foe: PokemonSet;
  onEnd: (result: 'win' | 'lose' | 'run') => void;
}

const TYPE_COLORS: Record<string, number> = {
  Normal: 0xa8a878, Fire: 0xf08030, Water: 0x6890f0, Grass: 0x78c850, Electric: 0xf8d030,
  Ice: 0x98d8d8, Fighting: 0xc03028, Poison: 0xa040a0, Ground: 0xe0c068, Flying: 0xa890f0,
  Psychic: 0xf85888, Bug: 0xa8b820, Rock: 0xb8a038, Ghost: 0x705898, Dragon: 0x7038f8,
  Dark: 0x705848, Steel: 0xb8b8d0, Fairy: 0xee99ac,
};

const FONT = { fontFamily: 'monospace', color: '#303030' };

interface MenuItem {
  label: string;
  enabled: boolean;
}

interface SideView {
  sprite: Phaser.GameObjects.Container;
  info: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  hpText?: Phaser.GameObjects.Text;
  hp: number;
  maxhp: number;
}

/**
 * Pantalla de combate. La lógica la lleva @pkmn/sim (cargado bajo demanda para
 * que el mundo arranque rápido); esta escena solo dibuja y recoge órdenes.
 */
export class BattleScene extends Phaser.Scene {
  private data_!: BattleData;
  private engine!: BattleEngine;
  private speciesTypes!: (s: string) => string[];
  private message!: Phaser.GameObjects.Text;
  private menuLayer!: Phaser.GameObjects.Container;
  private views = {} as Record<SideID, SideView>;
  /** Índices dentro de `party` de los Pokémon que han entrado al combate. */
  private partyIndexes: number[] = [];
  private advance: (() => void) | null = null;

  constructor() {
    super('Battle');
  }

  init(data: BattleData): void {
    this.data_ = data;
    this.views = {} as Record<SideID, SideView>;
    this.advance = null;
  }

  async create(): Promise<void> {
    this.drawScene();
    this.message.setText('Cargando combate...');

    const kb = this.input.keyboard!;
    const next = () => this.advance?.();
    ['Z', 'ENTER', 'SPACE'].forEach((k) => kb.on(`keydown-${k}`, next));
    this.input.on('pointerdown', next);

    const mod = await import('../battle/engine');
    this.speciesTypes = mod.speciesTypes;

    // Solo combaten los Pokémon del equipo que no estén debilitados.
    this.partyIndexes = party.map((m, i) => (m.hp === 0 ? -1 : i)).filter((i) => i >= 0);
    this.engine = new mod.BattleEngine(
      this.partyIndexes.map((i) => party[i]),
      [{ set: this.data_.foe }],
      { wild: true, playerName: 'Jugador' },
    );
    await this.playEvents(this.engine.drainEvents());
    this.loop();
  }

  // ---------------------------------------------------------------- dibujo

  private drawScene(): void {
    const { width } = this.scale;
    const g = this.add.graphics();
    g.fillGradientStyle(0xb8e0f8, 0xb8e0f8, 0xf0f8e0, 0xf0f8e0).fillRect(0, 0, width, 224);
    g.fillStyle(0x98c878).fillEllipse(350, 120, 170, 40);
    g.fillStyle(0x98c878).fillEllipse(120, 212, 200, 44);

    // Caja de texto inferior
    g.fillStyle(0x283040).fillRect(0, 224, width, 96);
    g.fillStyle(0xf8f8f8).fillRoundedRect(6, 230, width - 12, 84, 6);
    this.message = this.add.text(20, 242, '', { ...FONT, fontSize: '17px', wordWrap: { width: width - 40 } });
    this.menuLayer = this.add.container(0, 0);
  }

  /** Caja con nombre, nivel y barra de PS de un lado. */
  private makeInfoBox(side: SideID, name: string, level: number): Phaser.GameObjects.Container {
    const [x, y] = side === 'p2' ? [16, 18] : [250, 140];
    const h = side === 'p1' ? 62 : 46;
    const box = this.add.graphics();
    box.fillStyle(0xf8f8e8).fillRoundedRect(0, 0, 214, h, 6);
    box.lineStyle(2, 0x404040).strokeRoundedRect(0, 0, 214, h, 6);
    return this.add.container(x, y, [
      box,
      this.add.text(10, 6, `${name}  Nv.${level}`, { ...FONT, fontSize: '15px' }),
      this.add.text(10, 27, 'PS', { ...FONT, fontSize: '12px', color: '#f8a800' }),
      this.add.rectangle(36, 32, 164, 8, 0x505050).setOrigin(0, 0.5),
    ]);
  }

  /** Gráfico provisional: círculo del color del tipo con la inicial de la especie. */
  private makeSprite(side: SideID, species: string): Phaser.GameObjects.Container {
    const [x, y] = side === 'p2' ? [350, 92] : [120, 172];
    const r = side === 'p2' ? 32 : 42;
    const types = this.speciesTypes(species);
    const c = this.add.container(x, y);
    c.add(this.add.circle(0, 0, r, TYPE_COLORS[types[0]] ?? 0x999999).setStrokeStyle(3, 0x303030));
    if (types[1]) c.add(this.add.circle(0, 0, r * 0.45, TYPE_COLORS[types[1]] ?? 0x999999));
    c.add(this.add.text(0, 0, species.slice(0, 2), { ...FONT, fontSize: `${r}px`, color: '#ffffff', stroke: '#303030', strokeThickness: 4 }).setOrigin(0.5));
    return c;
  }

  private setHP(side: SideID, hp: number, maxhp: number, animate: boolean): Promise<void> {
    const v = this.views[side];
    if (!v) return Promise.resolve();
    if (maxhp > 0) v.maxhp = maxhp;
    v.hp = hp;
    const ratio = Phaser.Math.Clamp(hp / v.maxhp, 0, 1);
    const color = ratio > 0.5 ? 0x48d048 : ratio > 0.2 ? 0xf8c800 : 0xe03030;
    v.hpText?.setText(`${hp}/${v.maxhp}`);
    if (!animate) {
      v.hpBar.width = 160 * ratio;
      v.hpBar.fillColor = color;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: v.hpBar,
        width: 160 * ratio,
        duration: 450,
        onComplete: () => {
          v.hpBar.fillColor = color;
          resolve();
        },
      });
    });
  }

  // ---------------------------------------------------------------- flujo

  private async playEvents(events: BattleEvent[]): Promise<void> {
    for (const ev of events) {
      switch (ev.kind) {
        case 'text':
          await this.say(ev.text);
          break;
        case 'switch': {
          const prev = this.views[ev.side];
          prev?.sprite.destroy();
          prev?.info.destroy();
          const info = this.makeInfoBox(ev.side, ev.name, ev.level);
          const hpBar = this.add.rectangle(38, 32, 160, 4, 0x48d048).setOrigin(0, 0.5);
          const hpText = ev.side === 'p1' ? this.add.text(120, 40, '', { ...FONT, fontSize: '14px' }) : undefined;
          info.add(hpText ? [hpBar, hpText] : [hpBar]);
          const sprite = this.makeSprite(ev.side, ev.species);
          this.views[ev.side] = { sprite, info, hpBar, hpText, hp: ev.hp, maxhp: ev.maxhp };
          sprite.setScale(0);
          this.tweens.add({ targets: sprite, scale: 1, duration: 250 });
          await this.setHP(ev.side, ev.hp, ev.maxhp, false);
          break;
        }
        case 'hp':
          await this.setHP(ev.side, ev.hp, ev.maxhp, true);
          break;
        case 'faint': {
          const s = this.views[ev.side]?.sprite;
          if (s) await new Promise((r) => this.tweens.add({ targets: s, y: s.y + 40, alpha: 0, duration: 350, onComplete: r }));
          break;
        }
        case 'end':
          break;
      }
    }
  }

  /** Muestra un mensaje y espera a que el jugador lo pase (o a que pase un rato). */
  private say(text: string): Promise<void> {
    this.message.setText(text);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        timer.remove();
        this.advance = null;
        resolve();
      };
      const timer = this.time.delayedCall(1100, done);
      // Pequeña pausa antes de aceptar la pulsación, para no saltar mensajes sin querer.
      this.time.delayedCall(150, () => {
        if (!finished) this.advance = done;
      });
    });
  }

  private async loop(): Promise<void> {
    while (!this.engine.ended) {
      if (this.engine.mustSwitch) {
        const idx = await this.pickSwitch(false);
        this.engine.chooseSwitch(idx!);
      } else {
        const action = await this.pickAction();
        if (action === 'run') {
          await this.say('¡Escapaste sin problemas!');
          return this.finish('run');
        }
        if (action.kind === 'move') this.engine.chooseMove(action.index);
        else this.engine.chooseSwitch(action.index);
      }
      await this.playEvents(this.engine.drainEvents());
    }
    const won = this.engine.battle.winner === 'Jugador';
    await this.say(won ? '¡Has ganado el combate!' : 'Has perdido el combate...');
    this.finish(won ? 'win' : 'lose');
  }

  private finish(result: 'win' | 'lose' | 'run'): void {
    // Guardamos los PS del equipo para el siguiente combate.
    this.engine.playerHP().forEach((hp, i) => (party[this.partyIndexes[i]].hp = hp));
    this.cameras.main.fadeOut(250);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop();
      this.data_.onEnd(result);
    });
  }

  private async pickAction(): Promise<'run' | { kind: 'move' | 'switch'; index: number }> {
    for (;;) {
      const moves = this.engine.moves;
      const active = this.engine.switches.find((s) => s.active);
      this.message.setText(`¿Qué debería hacer ${active?.name}?`);
      const slot = (i: number): MenuItem => {
        const m = moves[i];
        return m ? { label: `${m.name} ${m.pp}/${m.maxpp}`, enabled: !m.disabled } : { label: '-', enabled: false };
      };
      // Rejilla 3x2: [ataque1, ataque2, POKÉMON] / [ataque3, ataque4, HUIR]
      const items: MenuItem[] = [
        slot(0), slot(1), { label: 'POKÉMON', enabled: this.engine.switches.filter((s) => !s.active && s.hp > 0).length > 0 },
        slot(2), slot(3), { label: 'HUIR', enabled: true },
      ];
      const choice = await this.menu(items, 3, [28, 200, 392], 268, 26);
      if (choice === 5) return 'run';
      if (choice === 2) {
        const idx = await this.pickSwitch(true);
        if (idx != null) return { kind: 'switch', index: idx };
        continue;
      }
      const moveIdx = choice < 2 ? choice : choice - 1;
      return { kind: 'move', index: moves[moveIdx].index };
    }
  }

  /** Elegir Pokémon. Devuelve el índice para Showdown o `null` si se cancela. */
  private async pickSwitch(cancellable: boolean): Promise<number | null> {
    const opts = this.engine.switches;
    this.message.setText('');
    const items: MenuItem[] = opts.map((o) => ({
      label: `${o.name} ${o.hp}/${o.maxhp}`,
      enabled: !o.active && o.hp > 0,
    }));
    if (cancellable) items.push({ label: 'Atrás', enabled: true });
    const choice = await this.menu(items, 2, [24, 250], 244, 22);
    if (cancellable && choice === items.length - 1) return null;
    return opts[choice].index;
  }

  /** Menú en rejilla navegable con flechas y ratón. */
  private menu(items: MenuItem[], cols: number, xs: number[], y0: number, dy: number): Promise<number> {
    const kb = this.input.keyboard!;
    let sel = items.findIndex((i) => i.enabled);
    const texts = items.map((it, i) =>
      this.add
        .text(xs[i % cols], y0 + Math.floor(i / cols) * dy, it.label, {
          ...FONT, fontSize: '15px', color: it.enabled ? '#303030' : '#a0a0a0',
        })
        .setInteractive({ useHandCursor: it.enabled }),
    );
    const cursor = this.add.text(0, 0, '▶', { ...FONT, fontSize: '15px' });
    this.menuLayer.add([...texts, cursor]);
    const draw = () => cursor.setPosition(texts[sel].x - 16, texts[sel].y);
    draw();

    return new Promise((resolve) => {
      const move = (d: number) => {
        const n = sel + d;
        if (n >= 0 && n < items.length && items[n].enabled) {
          sel = n;
          draw();
        }
      };
      const handlers: Record<string, () => void> = {
        'keydown-LEFT': () => move(-1),
        'keydown-RIGHT': () => move(1),
        'keydown-UP': () => move(-cols),
        'keydown-DOWN': () => move(cols),
      };
      const cleanup = () => {
        Object.entries(handlers).forEach(([e, h]) => kb.off(e, h));
        this.menuLayer.removeAll(true);
        this.advance = null;
      };
      let closed = false;
      const pick = (i: number) => {
        if (closed || !items[i].enabled) return;
        closed = true;
        cleanup();
        resolve(i);
      };
      Object.entries(handlers).forEach(([e, h]) => kb.on(e, h));
      texts.forEach((t, i) =>
        t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          ev.stopPropagation();
          pick(i);
        }),
      );
      this.time.delayedCall(150, () => {
        if (!closed) this.advance = () => pick(sel);
      });
    });
  }
}
