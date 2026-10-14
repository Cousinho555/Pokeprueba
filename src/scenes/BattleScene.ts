import Phaser from 'phaser';
import type { BattleEngine } from '../battle/engine';
type EngineModule = typeof import('../battle/engine');
import type { BattleEvent, SideID } from '../battle/protocol';
import {
  ESS, especies, evolve, expForLevel, expYield, levelEvolution, moveName, movesLearnedAt, trainerPrize,
  type Entrenador, type Especie, type PokemonSpec,
} from '../data/essentials';
import { addCaught, bag, BALLS, party, progress, type PartyMember } from '../data/party';
import { textStyle } from '../ui';
import { AnimationPlayer, type Actor } from '../battle/animations';
import { sfx } from './BootScene';

export interface BattleData {
  /** Pokémon rivales: uno si es salvaje, el equipo entero si es un entrenador. */
  foes: PokemonSpec[];
  trainer?: Entrenador;
  /** Nombre del fondo de Essentials (Field, IndoorB...). */
  background: string;
  onEnd: (result: BattleResult) => void;
}

export type BattleResult = 'win' | 'lose' | 'run' | 'catch';

type Action = 'run' | { kind: 'move' | 'switch'; index: number } | { kind: 'ball'; ball: string };

interface MenuItem {
  label: string;
  enabled: boolean;
}

interface SideView {
  sprite: Phaser.GameObjects.Image;
  info: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Rectangle;
  hpText?: Phaser.GameObjects.Text;
  expBar?: Phaser.GameObjects.Rectangle;
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
  private mod!: EngineModule;
  /** Índices (en el equipo del combate) de los Pokémon del jugador que han salido. */
  private participants = new Set<number>();
  private message!: Phaser.GameObjects.Text;
  private menuLayer!: Phaser.GameObjects.Container;
  private views = {} as Record<SideID, SideView>;
  private anim!: AnimationPlayer;
  /** Índices dentro de `party` de los Pokémon que han entrado al combate. */
  private partyIndexes: number[] = [];
  private advance: (() => void) | null = null;
  /** Posición en `foes` del Pokémon rival que está en el campo. */
  private foeSlot = -1;
  /** Miembros del equipo que han subido de nivel (pueden evolucionar al acabar). */
  private leveled = new Set<PartyMember>();
  /** Rival recién debilitado cuya experiencia falta por repartir. */
  private expDue: PokemonSpec | null = null;

  constructor() {
    super('Battle');
  }

  init(data: BattleData): void {
    this.data_ = data;
    this.views = {} as Record<SideID, SideView>;
    this.advance = null;
    this.participants = new Set();
    this.foeSlot = -1;
    this.leveled = new Set();
    this.expDue = null;
  }

  private get trainerName(): string {
    const t = this.data_.trainer;
    return t ? `${t.clase} ${t.nombre}` : '';
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
    this.mod = mod;
    this.anim = new AnimationPlayer(this);
    this.speciesNum = mod.speciesNum;

    // Solo combaten los Pokémon del equipo que no estén debilitados.
    this.partyIndexes = party.map((m, i) => (m.hp === 0 ? -1 : i)).filter((i) => i >= 0);
    this.engine = new mod.BattleEngine(
      this.partyIndexes.map((i) => party[i]),
      this.data_.foes.map((spec) => ({ spec })),
      { wild: !this.data_.trainer, playerName: 'Jugador', foeName: this.trainerName },
    );
    if (this.data_.trainer) {
      await this.showTrainer(true);
      await this.say(`¡${this.trainerName} quiere luchar!`);
      await this.showTrainer(false);
    }
    await this.playEvents(this.engine.drainEvents());
    this.loop();
  }

  /** Sprites de los Pokémon implicados y el fondo de combate. */
  private loadAssets(bg: string): Promise<void> {
    const want = (key: string, url: string) => {
      if (!this.textures.exists(key)) this.load.image(key, url);
    };
    for (const f of this.data_.foes) want(`front:${f.num}`, `${ESS}battlers/front/${f.num}.png`);
    const t = this.data_.trainer;
    if (t) want(`trainer:${t.sprite}`, `${ESS}trainers/${t.sprite}.png`);
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
          if (this.expDue) await this.awardExp();
          break;
        case 'switch': {
          const prev = this.views[ev.side];
          prev?.sprite.destroy();
          prev?.info.destroy();
          const info = this.makeInfoBox(ev.side, ev.name, ev.level);
          const hpBar = this.add.rectangle(46, 46, 172, 6, 0x48d048).setOrigin(0, 0.5);
          const hpText = ev.side === 'p1' ? this.add.text(220, 52, '', textStyle(22)).setOrigin(1, 0) : undefined;
          info.add(hpText ? [hpBar, hpText] : [hpBar]);
          let expBar: Phaser.GameObjects.Rectangle | undefined;
          if (ev.side === 'p2') {
            // El rival saca su siguiente Pokémon: la experiencia es para quien se enfrente a él.
            this.foeSlot++;
            this.participants = new Set([this.engine.activeIndex()]);
          }
          if (ev.side === 'p1') {
            this.participants.add(this.engine.activeIndex());
            info.add(this.add.rectangle(44, 78, 176, 6, 0x505050).setOrigin(0, 0.5));
            expBar = this.add.rectangle(46, 78, 0, 4, 0x40a8f8).setOrigin(0, 0.5);
            info.add(expBar);
          }
          const sprite = this.makeSprite(ev.side, ev.species);
          this.views[ev.side] = { sprite, info, hpBar, hpText, expBar, hp: ev.hp, maxhp: ev.maxhp };
          this.refreshExpBar(false);
          sprite.setScale(0);
          sfx(this, ev.side === 'p1' || this.data_.trainer ? 'Open Pokeball' : 'Battle jump to ball', 0.5);
          this.tweens.add({ targets: sprite, scale: SPRITE_SCALE, duration: 250 });
          await this.setHP(ev.side, ev.hp, ev.maxhp, false);
          break;
        }
        case 'hp': {
          const v = this.views[ev.side];
          // Al recibir daño el Pokémon parpadea mientras baja la barra, como en Essentials.
          if (v && ev.hp < v.hp) {
            sfx(this, 'Battle damage normal');
            this.tweens.add({ targets: v.sprite, alpha: 0, duration: 70, yoyo: true, repeat: 3 });
          }
          await this.setHP(ev.side, ev.hp, ev.maxhp, true);
          break;
        }
        case 'anim': {
          const actor = (side: SideID): Actor | undefined =>
            this.views[side]?.sprite.active ? { sprite: this.views[side].sprite, scale: SPRITE_SCALE } : undefined;
          const played = await this.anim.play(ev.name, actor(ev.user), actor(ev.target), ev.user === 'p2');
          if (!played && ev.name.startsWith('Move:')) await this.lunge(ev.user);
          break;
        }
        case 'faint': {
          // La experiencia se reparte tras el mensaje de "se debilitó".
          if (ev.side === 'p2') this.expDue = this.data_.foes[this.foeSlot] ?? null;
          const s = this.views[ev.side]?.sprite;
          if (s) await new Promise((r) => this.tweens.add({ targets: s, y: s.y + 40, alpha: 0, duration: 350, onComplete: r }));
          break;
        }
        case 'end':
          break;
      }
    }
  }

  /** Efecto sencillo para los movimientos sin animación en Essentials: el Pokémon embiste. */
  private lunge(side: SideID): Promise<void> {
    const s = this.views[side]?.sprite;
    if (!s) return Promise.resolve();
    const dx = side === 'p1' ? 24 : -24;
    return new Promise((r) => this.tweens.add({ targets: s, x: s.x + dx, y: s.y - dx / 2, duration: 90, yoyo: true, onComplete: () => r() }));
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
        if (action === 'run' && this.data_.trainer) {
          await this.say('¡No puedes huir de un combate contra un entrenador!');
          continue;
        }
        if (action === 'run') {
          await this.say('¡Escapaste sin problemas!');
          this.saveHP();
          return this.finish('run');
        }
        if (action.kind === 'ball' && this.data_.trainer) {
          await this.say('¡El entrenador ha bloqueado la Poké Ball! ¡No seas ladrón!');
          continue;
        }
        if (action.kind === 'ball') {
          if (await this.throwBall(action.ball)) {
            await this.evolvePending();
            return this.finish('catch');
          }
          continue;
        }
        if (action.kind === 'move') this.engine.chooseMove(action.index);
        else this.engine.chooseSwitch(action.index);
      }
      await this.playEvents(this.engine.drainEvents());
    }
    const won = this.engine.battle.winner === 'Jugador';
    if (this.expDue) await this.awardExp();
    this.saveHP();
    const t = this.data_.trainer;
    if (won && t) {
      const prize = trainerPrize(t);
      progress.dinero += prize;
      await this.showTrainer(true);
      await this.say(`¡Has derrotado a ${this.trainerName}!`);
      if (t.derrota) await this.say(t.derrota);
      await this.say(`Has ganado ${prize} ₽ por vencer.`);
    }
    if (won) await this.evolvePending();
    else await this.say('Has perdido el combate...');
    this.finish(won ? 'win' : 'lose');
  }

  /** Guarda los PS del equipo para el siguiente combate (sumando lo ganado al subir de nivel). */
  private saveHP(): void {
    const max = this.engine.playerMaxHP();
    this.engine.playerHP().forEach((hp, i) => {
      const member = party[this.partyIndexes[i]];
      const gained = Math.max(0, this.mod.maxHP(member.spec) - max[i]);
      member.hp = hp > 0 ? hp + gained : 0;
    });
  }

  /** PS que se muestran ahora de un miembro del equipo que está combatiendo. */
  private liveHP(member: PartyMember): [number, number] {
    const max = this.mod.maxHP(member.spec);
    const i = this.partyIndexes.indexOf(party.indexOf(member));
    if (this.engine.ended || i < 0) return [member.hp ?? max, max];
    const hp = this.engine.playerHP()[i];
    return [hp > 0 ? hp + Math.max(0, max - this.engine.playerMaxHP()[i]) : 0, max];
  }

  /** Sprite del entrenador rival entrando (o saliendo) por la derecha. */
  private showTrainer(show: boolean): Promise<void> {
    const t = this.data_.trainer;
    const key = `trainer:${t?.sprite}`;
    if (!t || !this.textures.exists(key)) return Promise.resolve();
    let img = this.children.getByName('trainer') as Phaser.GameObjects.Image | null;
    if (!img) img = this.add.image(FOE_X, FOE_FEET_Y - 6, key).setOrigin(0.5, 1).setName('trainer').setDepth(15);
    img.setVisible(true);
    const [from, to] = show ? [this.scale.width + 120, FOE_X] : [FOE_X, this.scale.width + 120];
    img.x = from;
    return new Promise((resolve) =>
      this.tweens.add({ targets: img, x: to, duration: 400, onComplete: () => { if (!show) img!.setVisible(false); resolve(); } }),
    );
  }

  private finish(result: BattleResult): void {
    this.cameras.main.fadeOut(250);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop();
      this.data_.onEnd(result);
    });
  }

  // ---------------------------------------------------------------- captura

  /** Lanza una Poké Ball. Devuelve true si el Pokémon queda atrapado. */
  private async throwBall(ball: string): Promise<boolean> {
    const info = BALLS[ball];
    bag[ball] = (bag[ball] ?? 1) - 1;
    const foe = this.data_.foes[0];
    const sprite = this.views.p2?.sprite;
    this.message.setText(`¡Has lanzado una ${info.nombre}!`);
    const shakes = this.engine.tryCatch(especies[foe.interno]?.captura ?? 45, info.ratio);
    const ballImg = await this.throwBallAnim(ball, sprite, shakes);

    if (shakes >= 4) {
      await this.say(`¡Ya está! ¡Has atrapado a ${foe.nombre}!`);
      ballImg.destroy();
      this.saveHP();
      const where = addCaught({ spec: { ...foe, movimientos: [...foe.movimientos] }, hp: this.engine.foeHP() });
      if (where === 'pc') await this.say(`Tu equipo está lleno. ${foe.nombre} se ha enviado al PC.`);
      return true;
    }
    // El Pokémon se escapa: la Poké Ball se abre y vuelve a aparecer.
    sfx(this, 'Battle recall');
    if (this.textures.exists(`ballopen:${ball}`)) ballImg.setTexture(`ballopen:${ball}`);
    if (sprite) {
      sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.MULTIPLY);
      await new Promise((r) => this.tweens.add({ targets: sprite, scale: SPRITE_SCALE, alpha: 1, duration: 250, onComplete: r }));
    }
    ballImg.destroy();
    const fail = [
      '¡Oh, no! ¡El Pokémon se ha escapado!',
      '¡Vaya! ¡Parecía que lo había atrapado!',
      '¡Qué rabia! ¡Casi lo consigo!',
      '¡Por poco! ¡Casi lo había atrapado!',
    ];
    await this.say(fail[shakes]);
    this.engine.chooseBallTurn();
    await this.playEvents(this.engine.drainEvents());
    return false;
  }

  /**
   * Lanzamiento como en Essentials: la Poké Ball vuela en arco hasta el Pokémon, se abre y
   * lo absorbe, cae al suelo y se sacude. Devuelve la imagen de la Poké Ball (aún en pantalla).
   */
  private async throwBallAnim(ball: string, foe: Phaser.GameObjects.Image | undefined, shakes: number): Promise<Phaser.GameObjects.Image> {
    const tween = (cfg: Phaser.Types.Tweens.TweenBuilderConfig) =>
      new Promise<void>((r) => this.tweens.add({ ...cfg, onComplete: () => r() }));
    const wait = (ms: number) => new Promise<void>((r) => this.time.delayedCall(ms, () => r()));
    const key = this.textures.exists(`ball:${ball}`) ? `ball:${ball}` : 'ball:POKEBALL';
    const fx = foe ? foe.x : FOE_X;
    const fy = foe ? foe.y - foe.displayHeight / 2 : 110;
    // El bitmap tiene hueco transparente debajo: el suelo está algo por debajo del centro visible.
    const groundY = fy + 34;
    const img = this.add.image(40, 250, key).setScale(SPRITE_SCALE).setDepth(30);

    // Vuelo en arco
    sfx(this, 'Battle throw');
    await tween({
      targets: img, duration: 550, angle: 720,
      onUpdate: (tw: Phaser.Tweens.Tween) => {
        const t = tw.progress;
        img.setPosition(40 + (fx - 40) * t, 250 + (fy - 40 - 250) * t - Math.sin(t * Math.PI) * 120);
      },
    });
    img.setAngle(0);

    // Se abre y absorbe al Pokémon
    sfx(this, 'Battle jump to ball');
    if (this.textures.exists(`ballopen:${ball}`)) img.setTexture(`ballopen:${ball}`);
    if (foe) {
      foe.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      await tween({ targets: foe, scale: 0, alpha: 0.4, duration: 300 });
    }
    img.setTexture(key);
    await wait(150);

    // Cae al suelo y bota
    await tween({ targets: img, y: groundY, duration: 300, ease: 'Bounce.easeOut' });
    sfx(this, 'Battle ball drop');
    await wait(400);

    // Sacudidas
    for (let i = 0; i < Math.min(shakes, 3); i++) {
      sfx(this, 'Battle ball shake');
      await tween({ targets: img, angle: { from: 0, to: -25 }, duration: 120, yoyo: true });
      await tween({ targets: img, angle: { from: 0, to: 25 }, duration: 120, yoyo: true });
      await wait(450);
    }
    if (shakes >= 4) {
      sfx(this, 'Battle catch click');
      img.setTint(0x909090);
      await wait(500);
    }
    return img;
  }

  // ---------------------------------------------------------------- experiencia

  /** Reparte la experiencia entre los Pokémon que han participado y siguen en pie. */
  private async awardExp(): Promise<void> {
    const foe = this.expDue;
    this.expDue = null;
    if (!foe) return;
    const hp = this.engine.playerHP();
    const alive = [...this.participants].filter((i) => hp[i] > 0);
    if (!alive.length) return;
    const each = Math.max(1, Math.floor(expYield(foe, !this.data_.trainer) / alive.length));
    for (const i of alive) await this.gainExp(party[this.partyIndexes[i]], each);
  }

  private async gainExp(member: PartyMember, amount: number): Promise<void> {
    const spec = member.spec;
    await this.say(`¡${spec.nombre} ganó ${amount} puntos de experiencia!`);
    spec.exp += amount;
    while (spec.nivel < 100 && spec.exp >= expForLevel(especies[spec.interno].crecimiento, spec.nivel + 1)) {
      spec.nivel++;
      this.leveled.add(member);
      this.refreshPlayerBox(member);
      this.refreshExpBar(true);
      await this.say(`¡${spec.nombre} subió al nivel ${spec.nivel}!`);
      for (const mv of movesLearnedAt(spec.interno, spec.nivel)) await this.learnMove(member, mv);
    }
    this.refreshExpBar(true);
  }

  /** Al terminar el combate evolucionan los que han subido de nivel y ya les toca. */
  private async evolvePending(): Promise<void> {
    for (const member of this.leveled) {
      const spec = member.spec;
      const target = levelEvolution(spec);
      if (!target || member.hp === 0) continue;
      const oldName = spec.nombre;
      await this.say(`¿Eh? ¡${oldName} está evolucionando!`);
      const oldMax = this.mod.maxHP(spec);
      evolve(spec, target);
      if (member.hp != null) member.hp += this.mod.maxHP(spec) - oldMax;
      this.refreshPlayerBox(member);
      sfx(this, 'EvolutionSuccess');
      await this.say(`¡Enhorabuena! ¡Tu ${oldName} ha evolucionado en ${spec.nombre}!`);
      for (const mv of movesLearnedAt(spec.interno, spec.nivel)) await this.learnMove(member, mv);
    }
  }

  /** Aprender un movimiento; si ya sabe cuatro, el jugador elige cuál olvidar. */
  private async learnMove(member: PartyMember, move: string): Promise<void> {
    const spec = member.spec;
    if (spec.movimientos.includes(move)) return;
    const name = moveName(move);
    if (spec.movimientos.length < 4) {
      spec.movimientos.push(move);
      await this.say(`¡${spec.nombre} aprendió ${name}!`);
      return;
    }
    await this.say(`${spec.nombre} quiere aprender ${name}, pero ya conoce cuatro movimientos.`);
    this.message.setText('');
    const items: MenuItem[] = spec.movimientos.map((m) => ({ label: moveName(m), enabled: true }));
    items.push({ label: `No aprender ${name}`, enabled: true });
    const choice = await this.menu(items, 2, [36, 280], BOX_Y + 10, 26);
    if (choice === 4) {
      await this.say(`${spec.nombre} no aprendió ${name}.`);
      return;
    }
    const old = moveName(spec.movimientos[choice]);
    spec.movimientos[choice] = move;
    await this.say(`1, 2 y... ¡Puf! ${spec.nombre} olvidó ${old} y aprendió ${name}.`);
  }

  /** Tras subir de nivel o evolucionar: nombre, nivel, PS y sprite del Pokémon en combate. */
  private refreshPlayerBox(member: PartyMember): void {
    const v = this.views.p1;
    if (!v || party[this.partyIndexes[this.engine.activeIndex()]] !== member) return;
    const [, name, level] = v.info.list as Phaser.GameObjects.Text[];
    name.setText(member.spec.nombre);
    level.setText(`Nv${member.spec.nivel}`);
    const [hp, max] = this.liveHP(member);
    void this.setHP('p1', hp, max, false);
    const key = `back:${member.spec.num}`;
    if (this.textures.exists(key)) {
      v.sprite.setTexture(key);
    } else {
      this.load.image(key, `${ESS}battlers/back/${member.spec.num}.png`);
      this.load.once(`filecomplete-image-${key}`, () => v.sprite.active && v.sprite.setTexture(key));
      this.load.start();
    }
  }

  /** Barra de experiencia del Pokémon activo del jugador. */
  private refreshExpBar(animate: boolean): void {
    const bar = this.views.p1?.expBar;
    if (!bar || !this.engine) return;
    const member = party[this.partyIndexes[this.engine.activeIndex()]];
    if (!member) return;
    const { exp, nivel, interno } = member.spec;
    const growth = especies[interno].crecimiento;
    const lo = expForLevel(growth, nivel);
    const hi = expForLevel(growth, nivel + 1);
    const width = nivel >= 100 ? 0 : 172 * Phaser.Math.Clamp((exp - lo) / Math.max(1, hi - lo), 0, 1);
    if (animate) this.tweens.add({ targets: bar, width, duration: 400 });
    else bar.width = width;
  }

  private async pickAction(): Promise<Action> {
    for (;;) {
      const active = this.engine.switches.find((s) => s.active);
      // Menú principal, como Essentials: mensaje a la izquierda y opciones a la derecha.
      this.message.setWordWrapWidth(270).setText(`¿Qué debería hacer ${active?.name}?`);
      const canSwitch = this.engine.switches.some((s) => !s.active && s.hp > 0);
      const main = await this.menu(
        [
          { label: 'LUCHAR', enabled: true },
          { label: 'MOCHILA', enabled: Object.keys(BALLS).some((b) => (bag[b] ?? 0) > 0) },
          { label: 'POKÉMON', enabled: canSwitch },
          { label: 'HUIR', enabled: true },
        ],
        2, [300, 410], BOX_Y + 14, 36,
      );
      this.message.setWordWrapWidth(this.scale.width - 44).setText('');
      if (main === 3) return 'run';
      if (main === 1) {
        const ball = await this.pickBall();
        if (ball) return { kind: 'ball', ball };
        continue;
      }
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

  /** Mochila: de momento solo Poké Balls. Devuelve la elegida o null si se cancela. */
  private async pickBall(): Promise<string | null> {
    const balls = Object.keys(BALLS).filter((b) => (bag[b] ?? 0) > 0);
    const items: MenuItem[] = balls.map((b) => ({ label: `${BALLS[b].nombre} x${bag[b]}`, enabled: true }));
    items.push({ label: 'Atrás', enabled: true });
    const choice = await this.menu(items, 2, [36, 280], BOX_Y + 10, 26);
    return choice < balls.length ? balls[choice] : null;
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
