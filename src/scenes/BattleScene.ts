import Phaser from 'phaser';
import type { BattleEngine } from '../battle/engine';
import type { BattleEvent, SideID } from '../battle/protocol';
import { ESS, especies, type Especie, type PokemonSpec } from '../data/essentials';
import { party } from '../data/party';
import { textStyle } from '../ui';

export interface BattleData {
  foe: PokemonSpec;
  /** Nombre del fondo de Essentials (Field, IndoorB...). */
  background: string;
  onEnd: (result: 'win' | 'lose' | 'run') => void;
}

interface MenuItem {
  label: string;
  enabled: boolean;
}

interface SideView {
  sprite: Phaser.GameObjects.Image;
  info: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  hpText?: Phaser.GameObjects.Text;
  hp: number;
  maxhp: number;
}

// Posiciones para una pantalla de 512x384. Los sprites de BES se colocan por la parte
// inferior del bitmap; BattlerPlayerY/BattlerEnemyY compensan el hueco transparente.
const FOE_X = 384;
const FOE_Y = 176;
const FOE_FEET_Y = 150;
const PLAYER_X = 128;
const PLAYER_FEET_Y = 260;
const SPRITE_SCALE = 2;
const BOX_Y = 288;

/**
 * Pantalla de combate. La lógica la lleva @pkmn/sim (cargado bajo demanda para
 * que el mundo arranque rápido); esta escena solo dibuja y recoge órdenes.
 */
export class BattleScene extends Phaser.Scene {
  private data_!: BattleData;
  private engine!: BattleEngine;
  private speciesNum!: (s: string) => number;
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
    const bg = this.data_.background || 'Field';
    await this.loadAssets(bg);
    this.drawScene(bg);
    this.message.setText('Cargando combate...');

    const kb = this.input.keyboard!;
    const next = () => this.advance?.();
    ['Z', 'ENTER', 'SPACE'].forEach((k) => kb.on(`keydown-${k}`, next));
    this.input.on('pointerdown', next);

    const mod = await import('../battle/engine');
    this.speciesNum = mod.speciesNum;

    // Solo combaten los Pokémon del equipo que no estén debilitados.
    this.partyIndexes = party.map((m, i) => (m.hp === 0 ? -1 : i)).filter((i) => i >= 0);
    this.engine = new mod.BattleEngine(
      this.partyIndexes.map((i) => party[i]),
      [{ spec: this.data_.foe }],
      { wild: true, playerName: 'Jugador' },
    );
    await this.playEvents(this.engine.drainEvents());
    this.loop();
  }

  /** Sprites de los Pokémon implicados y el fondo de combate. */
  private loadAssets(bg: string): Promise<void> {
    const want = (key: string, url: string) => {
      if (!this.textures.exists(key)) this.load.image(key, url);
    };
    want(`front:${this.data_.foe.num}`, `${ESS}battlers/front/${this.data_.foe.num}.png`);
    for (const m of party) want(`back:${m.spec.num}`, `${ESS}battlers/back/${m.spec.num}.png`);
    want(`bg:${bg}`, `${ESS}battlebacks/battlebg${bg}.png`);
    want(`foebase:${bg}`, `${ESS}battlebacks/enemybase${bg}.png`);
    want(`playerbase:${bg}`, `${ESS}battlebacks/playerbase${bg}.png`);
    return new Promise((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.start();
    });
  }

  // ---------------------------------------------------------------- dibujo

  private drawScene(bg: string): void {
    const { width, height } = this.scale;
    if (this.textures.exists(`bg:${bg}`)) this.add.image(0, 0, `bg:${bg}`).setOrigin(0);
    if (this.textures.exists(`foebase:${bg}`)) this.add.image(FOE_X, FOE_Y, `foebase:${bg}`).setOrigin(0.5, 0.75);
    if (this.textures.exists(`playerbase:${bg}`)) this.add.image(PLAYER_X, BOX_Y, `playerbase:${bg}`).setOrigin(0.5, 1);

    // Caja de texto inferior
    const g = this.add.graphics().setDepth(50);
    g.fillStyle(0x283040).fillRect(0, BOX_Y, width, height - BOX_Y);
    g.fillStyle(0xf8f8f8).fillRoundedRect(6, BOX_Y + 6, width - 12, height - BOX_Y - 12, 6);
    this.message = this.add.text(22, BOX_Y + 16, '', { ...textStyle(26), wordWrap: { width: width - 44 } }).setDepth(51);
    this.menuLayer = this.add.container(0, 0).setDepth(52);
  }

  /** Caja con nombre, nivel y barra de PS de un lado. */
  private makeInfoBox(side: SideID, name: string, level: number): Phaser.GameObjects.Container {
    const [x, y] = side === 'p2' ? [12, 24] : [268, 186];
    const h = side === 'p1' ? 84 : 62;
    const box = this.add.graphics();
    box.fillStyle(0xf8f8e8).fillRoundedRect(0, 0, 232, h, 8);
    box.lineStyle(3, 0x404040).strokeRoundedRect(0, 0, 232, h, 8);
    return this.add
      .container(x, y, [
        box,
        this.add.text(12, 4, name, textStyle(26)),
        this.add.text(220, 4, `Nv${level}`, textStyle(22)).setOrigin(1, 0),
        this.add.text(14, 37, 'PS', textStyle(18, '#f8a800')),
        this.add.rectangle(44, 46, 176, 10, 0x505050).setOrigin(0, 0.5),
      ])
      .setDepth(40);
  }

  /** Sprite de Essentials (frontal para el rival, de espaldas para el jugador). */
  private makeSprite(side: SideID, species: string): Phaser.GameObjects.Image {
    const num = this.speciesNum(species);
    const meta: Especie | undefined = Object.values(especies).find((e) => e.num === num);
    const key = side === 'p2' ? `front:${num}` : `back:${num}`;
    const sprite = this.add.image(0, 0, this.textures.exists(key) ? key : '__MISSING').setScale(SPRITE_SCALE).setOrigin(0.5, 1);
    if (side === 'p2') {
      sprite.setPosition(FOE_X, FOE_FEET_Y + ((meta?.posEnemigoY ?? 0) - (meta?.altitud ?? 0)) * SPRITE_SCALE);
    } else {
      sprite.setPosition(PLAYER_X, PLAYER_FEET_Y + (meta?.posJugadorY ?? 0) * SPRITE_SCALE);
    }
    return sprite.setDepth(side === 'p2' ? 10 : 20);
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
      v.hpBar.width = 172 * ratio;
      v.hpBar.fillColor = color;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: v.hpBar,
        width: 172 * ratio,
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
          const hpBar = this.add.rectangle(46, 46, 172, 6, 0x48d048).setOrigin(0, 0.5);
          const hpText = ev.side === 'p1' ? this.add.text(220, 52, '', textStyle(22)).setOrigin(1, 0) : undefined;
          info.add(hpText ? [hpBar, hpText] : [hpBar]);
          const sprite = this.makeSprite(ev.side, ev.species);
          this.views[ev.side] = { sprite, info, hpBar, hpText, hp: ev.hp, maxhp: ev.maxhp };
          sprite.setScale(0);
          this.tweens.add({ targets: sprite, scale: SPRITE_SCALE, duration: 250 });
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
      const active = this.engine.switches.find((s) => s.active);
      // Menú principal, como Essentials: mensaje a la izquierda y opciones a la derecha.
      this.message.setWordWrapWidth(270).setText(`¿Qué debería hacer ${active?.name}?`);
      const canSwitch = this.engine.switches.some((s) => !s.active && s.hp > 0);
      const main = await this.menu(
        [
          { label: 'LUCHAR', enabled: true },
          { label: 'MOCHILA', enabled: false },
          { label: 'POKÉMON', enabled: canSwitch },
          { label: 'HUIR', enabled: true },
        ],
        2, [300, 410], BOX_Y + 14, 36,
      );
      this.message.setWordWrapWidth(this.scale.width - 44).setText('');
      if (main === 3) return 'run';
      if (main === 2) {
        const idx = await this.pickSwitch(true);
        if (idx != null) return { kind: 'switch', index: idx };
        continue;
      }
      // Ataques en rejilla 2x2 y "Atrás" a la derecha.
      const moves = this.engine.moves;
      const slot = (i: number): MenuItem => {
        const m = moves[i];
        return m ? { label: m.name, enabled: !m.disabled } : { label: '-', enabled: false };
      };
      const choice = await this.menu(
        [slot(0), slot(1), { label: 'Atrás', enabled: true }, slot(2), slot(3), { label: '', enabled: false }],
        3, [36, 226, 420], BOX_Y + 14, 36,
      );
      if (choice === 2) continue;
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
    const choice = await this.menu(items, 2, [36, 280], BOX_Y + 10, 26);
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
          ...textStyle(24, it.enabled ? '#484848' : '#b0b0b0'),
        })
        .setInteractive({ useHandCursor: it.enabled }),
    );
    const cursor = this.add.text(0, 0, '▶', textStyle(20));
    this.menuLayer.add([...texts, cursor]);
    const draw = () => cursor.setPosition(texts[sel].x - 22, texts[sel].y + 2);
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
