import Phaser from 'phaser';
import { ESS, encounterChance, mundo, rollEncounter, trainerTeam, type Entrenador, type InfoMapa, type PokemonSpec } from '../data/essentials';
import { bag, BALLS, healParty, party, partyCanFight, pc, progress } from '../data/party';
import { saveGame } from '../data/save';
import { sfx } from './BootScene';
import { textStyle } from '../ui';
import type { DialogData } from './DialogScene';
import type { BattleData, BattleResult } from './BattleScene';

type Dir = 2 | 4 | 6 | 8; // como RPG Maker: abajo, izquierda, derecha, arriba
const DELTA: Record<Dir, [number, number]> = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
const ROW: Record<Dir, number> = { 2: 0, 4: 1, 6: 2, 8: 3 };
const BIT: Record<Dir, number> = { 2: 1, 4: 2, 6: 4, 8: 8 };
const REVERSE: Record<Dir, Dir> = { 2: 8, 4: 6, 6: 4, 8: 2 };
const TILE = 32;
const STEP_MS = 200;

// Etiquetas de terreno de Essentials v16
const TERRAIN_LEDGE = 1;
const TERRAIN_GRASS = 2;
const TERRAIN_TALL_GRASS = 10;

export interface WorldData {
  mapId: number;
  x: number;
  y: number;
  dir: number;
  /** Mensajes a mostrar nada más llegar. */
  say?: string[];
}

interface MapEvent {
  /** Identificador estable para recordar si ya se le ha vencido. */
  key: string;
  name: string;
  dir: Dir;
  x: number;
  y: number;
  sprite?: Phaser.GameObjects.Sprite;
  blocks: boolean;
  trigger: number;
  text?: string[];
  warp?: { mapa: number; x: number; y: number; dir: number };
  trainer?: Entrenador;
  /** Enfermera del Centro Pokémon. */
  heals?: boolean;
}

const mapKey = (id: number) => `map${id}`;
const charKey = (name: string) => `chr:${name}`;

/** Mapas de Essentials: movimiento por casillas, colisiones, eventos, puertas y encuentros. */
export class WorldScene extends Phaser.Scene {
  private info!: InfoMapa;
  private mapId = 0;
  private pasos = '';
  private terreno = '';
  private mapEvents: MapEvent[] = [];
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private tileX = 0;
  private tileY = 0;
  private facing: Dir = 2;
  private moving = false;
  private busy = true;
  private stepFrame = 0;

  constructor() {
    super('World');
  }

  init(data: WorldData): void {
    this.mapId = data.mapId;
    this.tileX = data.x;
    this.tileY = data.y;
    this.facing = ([2, 4, 6, 8].includes(data.dir) ? data.dir : this.facing) as Dir;
    this.mapEvents = [];
    this.busy = true;
    this.moving = false;
  }

  create(data: WorldData): void {
    this.info = mundo.mapas[this.mapId];
    // Carga bajo demanda del mapa, sus tilesets y los personajes que aparecen en él.
    const need = (key: string, add: () => void) => {
      if (!this.textures.exists(key) && !this.cache.tilemap.exists(key)) add();
    };
    need(mapKey(this.mapId), () => this.load.tilemapTiledJSON(mapKey(this.mapId), `${ESS}maps/map${String(this.mapId).padStart(3, '0')}.tmj`));
    need(`ts:${this.info.imagen}`, () => this.load.image(`ts:${this.info.imagen}`, `${ESS}tilesets/${encodeURIComponent(this.info.imagen)}`));
    need(`at:${this.info.autotiles}`, () => this.load.image(`at:${this.info.autotiles}`, `${ESS}autotiles/${this.info.autotiles}.png`));
    for (const g of [mundo.jugador, ...this.info.graficos]) {
      const size = mundo.graficos[g];
      if (size) need(charKey(g), () => this.load.spritesheet(charKey(g), `${ESS}characters/${encodeURIComponent(g)}.png`, { frameWidth: size[0], frameHeight: size[1] }));
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.build(data));
    this.load.start();
  }

  private build(data: WorldData): void {
    const map = this.make.tilemap({ key: mapKey(this.mapId) });
    const tilesets = map.tilesets.map((t) =>
      map.addTilesetImage(t.name, t.name.startsWith('autotiles') ? `at:${this.info.autotiles}` : `ts:${this.info.imagen}`)!,
    );
    for (const layer of map.layers) {
      const l = map.createLayer(layer.name, tilesets)!;
      l.setDepth(layer.name.startsWith('Alto') ? 10000 : 0);
    }
    const props = Object.fromEntries((map.properties as { name: string; value: string }[]).map((p) => [p.name, p.value]));
    this.pasos = props.pasos ?? '';
    this.terreno = props.terreno ?? '';

    for (const obj of map.getObjectLayer('Eventos')?.objects ?? []) this.addEvent(obj);

    this.player = this.add.sprite(0, 0, charKey(mundo.jugador), ROW[this.facing] * 4).setOrigin(0.5, 1);
    this.placePlayer();

    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const w = map.widthInPixels;
    const h = map.heightInPixels;
    cam.setBounds(Math.min(0, (w - width) / 2), Math.min(0, (h - height) / 2), Math.max(w, width), Math.max(h, height));
    cam.startFollow(this.player, true);
    cam.roundPixels = true;
    cam.fadeIn(200);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as WorldScene['wasd'];
    kb.on('keydown-Z', () => this.interact());
    kb.on('keydown-ENTER', () => this.interact());
    kb.on('keydown-SPACE', () => this.interact());
    kb.on('keydown-X', () => this.showParty());
    kb.on('keydown-ESC', () => this.showParty());
    this.events.off(Phaser.Scenes.Events.RESUME).on(Phaser.Scenes.Events.RESUME, () => kb.resetKeys());

    if (this.info.exterior) this.showMapName();
    saveGame({ mapId: this.mapId, x: this.tileX, y: this.tileY, dir: this.facing });
    const lines = [...(data.say ?? [])];
    if (this.mapId === mundo.inicio.mapa) healParty();
    if (lines.length) this.say(lines, () => this.checkTrainers());
    else {
      this.busy = false;
      this.checkTrainers();
    }
  }

  private addEvent(obj: Phaser.Types.Tilemaps.TiledObject): void {
    const p = Object.fromEntries(((obj.properties ?? []) as { name: string; value: string }[]).map((x) => [x.name, x.value]));
    const x = Math.floor(obj.x! / TILE);
    const y = Math.floor(obj.y! / TILE);
    const dir = Number(p.direccion ?? 2) as Dir;
    const ev: MapEvent = {
      key: `${this.mapId}:${x}:${y}:${obj.name}`,
      name: obj.name,
      dir: ([2, 4, 6, 8].includes(dir) ? dir : 2) as Dir,
      x,
      y,
      blocks: false,
      trigger: Number(p.disparo ?? 0),
      text: p.texto ? JSON.parse(p.texto) : undefined,
      warp: p.warp ? JSON.parse(p.warp) : undefined,
      trainer: p.entrenador ? JSON.parse(p.entrenador) : undefined,
      heals: p.cura === 'true',
    };
    const g = p.grafico;
    if (g && this.textures.exists(charKey(g))) {
      const frame = (ROW[dir] ?? 0) * 4 + Number(p.patron ?? 0);
      ev.sprite = this.add
        .sprite(x * TILE + TILE / 2, (y + 1) * TILE, charKey(g), frame)
        .setOrigin(0.5, 1)
        .setDepth(y);
      ev.blocks = p.atraviesa !== 'true';
    }
    this.mapEvents.push(ev);
  }

  update(): void {
    if (this.moving || this.busy || !this.player) return;
    const dir = this.heldDir();
    if (!dir) {
      this.player.setFrame(ROW[this.facing] * 4);
      return;
    }
    this.facing = dir;
    const [dx, dy] = DELTA[dir];
    const nx = this.tileX + dx;
    const ny = this.tileY + dy;

    if (!this.inside(nx, ny)) {
      this.player.setFrame(ROW[dir] * 4);
      if (this.passable(this.tileX, this.tileY, dir)) this.tryConnection(dir);
      return;
    }
    const ev = this.eventAt(nx, ny);
    if (ev?.blocks) {
      this.player.setFrame(ROW[dir] * 4);
      if (ev.warp && ev.trigger === 1) this.warp(ev.warp);
      return;
    }
    if (dir === 2 && this.terrainAt(nx, ny) === TERRAIN_LEDGE) return this.jump();
    if (!this.passable(this.tileX, this.tileY, dir) || !this.passable(nx, ny, REVERSE[dir])) {
      this.player.setFrame(ROW[dir] * 4);
      // Como en RMXP: chocar con un evento de "contacto" lo activa (salidas sobre muros, puertas).
      if (ev?.warp && ev.trigger !== 0) this.warp(ev.warp);
      return;
    }
    this.walkTo(nx, ny, dir);
  }

  // ------------------------------------------------------------- movimiento

  private heldDir(): Dir | null {
    const c = this.cursors;
    if (c.left.isDown || this.wasd.A.isDown) return 4;
    if (c.right.isDown || this.wasd.D.isDown) return 6;
    if (c.up.isDown || this.wasd.W.isDown) return 8;
    if (c.down.isDown || this.wasd.S.isDown) return 2;
    return null;
  }

  private walkTo(nx: number, ny: number, dir: Dir): void {
    this.moving = true;
    this.tileX = nx;
    this.tileY = ny;
    // Animación de paso: alterna los frames 1 y 3 de la fila, como RMXP.
    this.stepFrame = (this.stepFrame + 2) % 4;
    this.player.setFrame(ROW[dir] * 4 + 1 + this.stepFrame);
    this.time.delayedCall(STEP_MS / 2, () => this.player.setFrame(ROW[dir] * 4));
    this.tweens.add({
      targets: this.player,
      x: nx * TILE + TILE / 2,
      y: (ny + 1) * TILE,
      duration: STEP_MS,
      onUpdate: () => this.player.setDepth(this.player.y / TILE - 0.5),
      onComplete: () => {
        this.moving = false;
        this.onStep();
      },
    });
  }

  private jump(): void {
    this.moving = true;
    this.tileY += 2;
    const startY = this.player.y;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: STEP_MS * 2,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        this.player.y = startY + t * TILE * 2 - Math.sin(t * Math.PI) * 20;
      },
      onComplete: () => {
        this.placePlayer();
        this.moving = false;
        this.onStep();
      },
    });
  }

  private placePlayer(): void {
    this.player.setPosition(this.tileX * TILE + TILE / 2, (this.tileY + 1) * TILE).setDepth(this.tileY + 0.5);
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.info.ancho && y < this.info.alto;
  }

  /** ¿Se puede salir de (x, y) en la dirección dir? Usa los bits de paso de RMXP precalculados. */
  private passable(x: number, y: number, dir: Dir): boolean {
    if (!this.inside(x, y)) return false;
    return (parseInt(this.pasos[x + y * this.info.ancho], 16) & BIT[dir]) === 0;
  }

  private terrainAt(x: number, y: number): number {
    return parseInt(this.terreno[x + y * this.info.ancho] ?? '0', 16);
  }

  private eventAt(x: number, y: number): MapEvent | undefined {
    return this.mapEvents.find((e) => e.x === x && e.y === y);
  }

  private onStep(): void {
    const ev = this.eventAt(this.tileX, this.tileY);
    if (ev?.warp && ev.trigger !== 0) return this.warp(ev.warp);
    if (this.checkTrainers()) return;
    const t = this.terrainAt(this.tileX, this.tileY);
    if ((t === TERRAIN_GRASS || t === TERRAIN_TALL_GRASS) && Math.random() < encounterChance(this.mapId)) {
      this.startWildBattle();
    }
  }

  // ------------------------------------------------------------- mapas

  private warp(to: { mapa: number; x: number; y: number; dir: number }, say?: string[]): void {
    if (!mundo.mapas[to.mapa]) return;
    this.busy = true;
    this.cameras.main.fadeOut(200);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ mapId: to.mapa, x: to.x, y: to.y, dir: to.dir || this.facing, say } satisfies WorldData);
    });
  }

  /** Al salir por el borde, busca en connections.txt el mapa vecino. */
  private tryConnection(dir: Dir): void {
    const side = { 2: 'S', 4: 'W', 6: 'E', 8: 'N' }[dir];
    for (const c of mundo.conexiones) {
      for (const [a, b] of [[0, 3], [3, 0]] as const) {
        if (c[a] !== this.mapId || c[a + 1] !== side) continue;
        const other = mundo.mapas[c[b]];
        if (!other) continue;
        // Punto de cada mapa que coincide con el del otro (ver Essentials, connections.txt).
        const anchor = (info: InfoMapa, s: string, off: number): [number, number] =>
          s === 'N' ? [off, 0] : s === 'S' ? [off, info.alto] : s === 'W' ? [0, off] : [info.ancho, off];
        const [ax, ay] = anchor(this.info, c[a + 1] as string, c[a + 2] as number);
        const [bx, by] = anchor(other, c[b + 1] as string, c[b + 2] as number);
        const [dx, dy] = DELTA[dir];
        const x = this.tileX + dx - ax + bx;
        const y = this.tileY + dy - ay + by;
        if (x >= 0 && y >= 0 && x < other.ancho && y < other.alto) {
          return this.warp({ mapa: other.id, x, y, dir });
        }
      }
    }
  }

  private showMapName(): void {
    const label = this.add
      .text(12, -80, this.info.nombre, { ...textStyle(24), backgroundColor: '#f8f8f0', padding: { x: 12, y: 6 } })
      .setScrollFactor(0)
      .setDepth(20000);
    this.tweens.chain({
      targets: label,
      tweens: [
        { y: 8, duration: 300 },
        { y: -80, duration: 300, delay: 1800, onComplete: () => label.destroy() },
      ],
    });
  }

  // ------------------------------------------------------------- interacción

  private interact(): void {
    if (this.busy || this.moving) return;
    const [dx, dy] = DELTA[this.facing];
    // Por encima de un mostrador (casilla que no se puede pisar) se habla con quien está detrás.
    const ev =
      this.eventAt(this.tileX + dx, this.tileY + dy) ??
      (this.passable(this.tileX + dx, this.tileY + dy, REVERSE[this.facing]) ? undefined : this.eventAt(this.tileX + 2 * dx, this.tileY + 2 * dy));
    if (!ev) return;
    if (ev.sprite && ev.blocks && !ev.warp) {
      // El personaje se gira hacia el jugador.
      ev.sprite.setFrame(ROW[REVERSE[this.facing]] * 4);
    }
    if (ev.trainer) this.talkToTrainer(ev);
    else if (ev.heals) this.nurse(ev);
    else if (ev.text) this.say(ev.text);
    else if (ev.warp && ev.trigger === 0) this.warp(ev.warp);
  }

  // ------------------------------------------------------------- Centro Pokémon

  private nurse(ev: MapEvent): void {
    const intro = ev.text ?? ['¡Hola! Bienvenido al Centro Pokémon.'];
    this.say(intro, () => {
      this.busy = true;
      healParty();
      sfx(this, 'Pokemon Healing');
      // Si pierdes un combate, vuelves aquí.
      progress.regreso = { mapId: this.mapId, x: this.tileX, y: this.tileY, dir: this.facing };
      const cam = this.cameras.main;
      cam.flash(300, 255, 255, 255);
      this.time.delayedCall(400, () => cam.flash(300, 255, 255, 255));
      this.time.delayedCall(2400, () => {
        saveGame({ mapId: this.mapId, x: this.tileX, y: this.tileY, dir: this.facing });
        this.say(['Gracias por esperar.', 'Tu equipo Pokémon ha recuperado toda su energía.', '¡Esperamos volver a verte!']);
      });
    });
  }

  // ------------------------------------------------------------- entrenadores

  private beaten(ev: MapEvent): boolean {
    return progress.vencidos.includes(ev.key);
  }

  private talkToTrainer(ev: MapEvent): void {
    const t = ev.trainer!;
    if (this.beaten(ev)) return this.say(t.despues.length ? t.despues : [t.derrota || '...']);
    if (!partyCanFight()) return this.say(['Tus Pokémon no están en condiciones de luchar.']);
    this.say(t.intro.length ? t.intro : ['¡Vamos a luchar!'], () => this.startBattle(trainerTeam(t), ev));
  }

  /** ¿Algún entrenador no vencido te ve? Si es así, viene hacia ti y empieza el combate. */
  private checkTrainers(): boolean {
    if (!partyCanFight()) return false;
    for (const ev of this.mapEvents) {
      const t = ev.trainer;
      if (!t || !t.vision || !ev.sprite || this.beaten(ev)) continue;
      const [dx, dy] = DELTA[ev.dir];
      for (let k = 1; k <= t.vision; k++) {
        const x = ev.x + dx * k;
        const y = ev.y + dy * k;
        if (x === this.tileX && y === this.tileY) {
          this.trainerSpotted(ev, k - 1);
          return true;
        }
        if (this.eventAt(x, y)?.blocks) break;
      }
    }
    return false;
  }

  private trainerSpotted(ev: MapEvent, steps: number): void {
    this.busy = true;
    const sprite = ev.sprite!;
    const mark = this.add
      .text(sprite.x, sprite.y - sprite.height - 4, '!', { ...textStyle(28, '#e03030'), stroke: '#ffffff', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(20000);
    this.time.delayedCall(700, () => {
      mark.destroy();
      const [dx, dy] = DELTA[ev.dir];
      const walk = (left: number) => {
        if (left <= 0) {
          this.facing = REVERSE[ev.dir];
          this.player.setFrame(ROW[this.facing] * 4);
          return this.talkToTrainer(ev);
        }
        ev.x += dx;
        ev.y += dy;
        sprite.setFrame(ROW[ev.dir] * 4 + 1 + (left % 2) * 2);
        this.tweens.add({
          targets: sprite,
          x: ev.x * TILE + TILE / 2,
          y: (ev.y + 1) * TILE,
          duration: STEP_MS,
          onComplete: () => {
            sprite.setFrame(ROW[ev.dir] * 4).setDepth(ev.y);
            walk(left - 1);
          },
        });
      };
      walk(steps);
    });
  }

  /** Resumen del equipo y la mochila (X o Esc), a falta de un menú de pausa completo. */
  private showParty(): void {
    if (this.busy || this.moving) return;
    const rows = party.map(({ spec, hp }) => `${spec.nombre}  Nv.${spec.nivel}  ${hp === 0 ? '(debilitado)' : hp == null ? 'PS al máximo' : `PS ${hp}`}`);
    const pages: string[] = [];
    for (let i = 0; i < rows.length; i += 2) pages.push(rows.slice(i, i + 2).join('\n'));
    const balls = Object.keys(BALLS).filter((b) => bag[b]).map((b) => `${BALLS[b].nombre} x${bag[b]}`);
    pages.push(`Dinero: ${progress.dinero} ₽. Mochila: ${balls.join(', ') || 'vacía'}.` + (pc.length ? ` PC: ${pc.length} Pokémon.` : ''));
    this.say(pages);
  }

  private say(lines: string[], onClose?: () => void): void {
    this.busy = true;
    const data: DialogData = {
      lines,
      onClose: () => {
        this.busy = false;
        this.input.keyboard!.resetKeys();
        onClose?.();
      },
    };
    this.scene.launch('Dialog', data);
  }

  // ------------------------------------------------------------- combate

  private startWildBattle(): void {
    const foe = rollEncounter(this.mapId);
    if (!foe || !partyCanFight()) return;
    this.startBattle([foe]);
  }

  private startBattle(foes: PokemonSpec[], trainerEvent?: MapEvent): void {
    this.busy = true;
    const cam = this.cameras.main;
    cam.flash(250, 255, 255, 255);
    this.time.delayedCall(300, () => cam.flash(250, 255, 255, 255));
    this.time.delayedCall(650, () => {
      const data: BattleData = {
        foes,
        trainer: trainerEvent?.trainer,
        background: this.info.fondoCombate,
        onEnd: (result) => this.afterBattle(result, trainerEvent),
      };
      this.scene.pause();
      this.scene.launch('Battle', data);
    });
  }

  private afterBattle(result: BattleResult, trainerEvent?: MapEvent): void {
    this.scene.resume();
    this.busy = false;
    if (result === 'win' && trainerEvent) progress.vencidos.push(trainerEvent.key);
    if (result === 'lose') {
      // Como en Essentials: vuelves al último Centro Pokémon (o a casa) con el equipo curado.
      healParty();
      const back = progress.regreso;
      const to = back ? { mapa: back.mapId, x: back.x, y: back.y, dir: back.dir } : mundo.inicio;
      saveGame({ mapId: to.mapa, x: to.x, y: to.y, dir: to.dir });
      this.busy = true;
      this.warp(to, [
        '¡No te quedan Pokémon en condiciones de luchar!',
        back ? 'Vuelves corriendo al Centro Pokémon y tu equipo se recupera.' : 'Vuelves corriendo a casa y tu equipo se recupera.',
      ]);
      return;
    }
    saveGame();
    this.checkTrainers();
  }
}
