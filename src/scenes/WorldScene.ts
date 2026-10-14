import Phaser from 'phaser';
import { especies, ESS, encounterChance, mundo, objetos, rollEncounter, trainerTeam, type Entrenador, type InfoMapa, type PokemonSpec } from '../data/essentials';
import { addItem, healParty, partyCanFight, pc, progress } from '../data/party';
import { saveGame } from '../data/save';
import { sfx } from './BootScene';
import { textStyle } from '../ui';
import type { DialogData } from './DialogScene';
import type { MenuData } from './MenuScene';
import type { BattleData, BattleResult } from './BattleScene';
import { Character, charKey, DELTA, isDir, REVERSE, TILE, type Dir } from '../world/character';
import { FRAME_MS, Interpreter, runRoute, type EventHost, type Pagina } from '../world/interpreter';
import { MapAnimations } from '../world/mapAnimations';

const BIT: Record<Dir, number> = { 2: 1, 4: 2, 6: 4, 8: 8 };

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

/** Evento de RPG Maker en el mapa: sus páginas y el personaje que lo representa. */
interface MapEvent {
  id: number;
  name: string;
  /** Casillas a las que ve un entrenador ("Trainer(n)"). */
  vision: number;
  pages: Pagina[];
  /** Página activa (-1 si no se cumple ninguna). */
  page: number;
  ch: Character;
  erased: boolean;
  running: boolean;
  /** Página automática que ya se ejecutó sin cambiar nada (no se repite en bucle). */
  autoDone: number;
  /** Próximo movimiento autónomo (aleatorio o hacia el jugador). */
  nextMove: number;
}

const mapKey = (id: number) => `map${id}`;

/** Mapas de Essentials: movimiento por casillas, colisiones, eventos, puertas y encuentros. */
export class WorldScene extends Phaser.Scene implements EventHost {
  private info!: InfoMapa;
  mapId = 0;
  player!: Character;
  temp: Record<string, boolean> = {};
  private pasos = '';
  private terreno = '';
  private mapEvents: MapEvent[] = [];
  private interpreters = new Set<Interpreter>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private startPos: { x: number; y: number; dir: Dir } = { x: 0, y: 0, dir: 2 };
  /** Cosas que impiden moverse: mensajes, eventos en curso, combates, cambios de mapa. */
  private locks = 0;
  /** Se está cambiando de mapa: los eventos en curso ya no deben tocar nada. */
  private leaving = false;
  private lastUnlock = 0;
  private toneRect?: Phaser.GameObjects.Rectangle;
  private mapAnims!: MapAnimations;
  private lastBump = 0;
  /** Mapas oscuros: halo de luz bajo cada personaje que tenga gráfico. */
  private halos?: Map<Character, Phaser.GameObjects.Image>;

  constructor() {
    super('World');
  }

  get stage(): Phaser.Scene {
    return this;
  }

  private get busy(): boolean {
    return this.locks > 0;
  }

  init(data: WorldData): void {
    this.mapId = data.mapId;
    const dir = isDir(data.dir) ? data.dir : (this.player?.dir ?? 2);
    this.startPos = { x: data.x, y: data.y, dir };
    this.mapEvents = [];
    this.interpreters = new Set();
    this.temp = {};
    this.locks = 1;
    this.leaving = false;
    this.toneRect = undefined;
    this.halos = undefined;
  }

  create(data: WorldData): void {
    this.info = mundo.mapas[this.mapId];
    // Carga bajo demanda del mapa, sus tilesets y los personajes que aparecen en él.
    const need = (key: string, add: () => void) => {
      if (!this.textures.exists(key) && !this.cache.tilemap.exists(key)) add();
    };
    const file = this.info.archivo ?? `${ESS}maps/map${String(this.mapId).padStart(3, '0')}.tmj`;
    need(mapKey(this.mapId), () => this.load.tilemapTiledJSON(mapKey(this.mapId), file));
    need(`ts:${this.info.imagen}`, () => this.load.image(`ts:${this.info.imagen}`, `${ESS}tilesets/${encodeURIComponent(this.info.imagen)}`));
    need(`at:${this.info.autotiles}`, () => this.load.image(`at:${this.info.autotiles}`, `${ESS}autotiles/${this.info.autotiles}.png`));
    for (const g of [mundo.jugador, ...this.info.graficos]) {
      const size = mundo.graficos[g];
      if (size) need(charKey(g), () => this.load.spritesheet(charKey(g), `${ESS}characters/${encodeURIComponent(g)}.png`, { frameWidth: size[0], frameHeight: size[1] }));
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.build(data));
    this.load.start();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const it of this.interpreters) it.stop();
    });
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
    if (props.oscuro) this.halos = new Map();

    this.mapAnims = new MapAnimations(this);
    this.player = new Character(this, this.startPos.x, this.startPos.y, this.startPos.dir);
    this.player.depthBias = 0.5;
    this.player.setGraphic(mundo.jugador);
    for (const obj of map.getObjectLayer('Eventos')?.objects ?? []) this.addEvent(obj);
    this.refreshPages();

    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const w = map.widthInPixels;
    const h = map.heightInPixels;
    cam.setBounds(Math.min(0, (w - width) / 2), Math.min(0, (h - height) / 2), Math.max(w, width), Math.max(h, height));
    cam.startFollow(this.player.sprite!, true);
    cam.roundPixels = true;
    cam.fadeIn(200);

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as WorldScene['wasd'];
    kb.on('keydown-Z', () => this.interact());
    kb.on('keydown-ENTER', () => this.interact());
    kb.on('keydown-SPACE', () => this.interact());
    kb.on('keydown-X', () => this.openMenu());
    kb.on('keydown-ESC', () => this.openMenu());
    this.events.off(Phaser.Scenes.Events.RESUME).on(Phaser.Scenes.Events.RESUME, () => kb.resetKeys());

    if (this.info.exterior) this.showMapName();
    saveGame(this.position());
    if (this.mapId === mundo.inicio.mapa) healParty();
    this.locks = 0;
    const lines = [...(data.say ?? [])];
    if (lines.length) this.say(lines, () => this.afterEvents());
    else this.afterEvents();
  }

  private addEvent(obj: Phaser.Types.Tilemaps.TiledObject): void {
    const p = Object.fromEntries(((obj.properties ?? []) as { name: string; value: string }[]).map((x) => [x.name, x.value]));
    if (!p.paginas) return;
    const ch = new Character(this, Math.floor(obj.x! / TILE), Math.floor(obj.y! / TILE));
    this.mapEvents.push({
      id: Number(p.id), name: obj.name, vision: Number(p.vision ?? 0), pages: JSON.parse(p.paginas),
      page: -2, ch, erased: false, running: false, autoDone: -1, nextMove: 0,
    });
  }

  // ------------------------------------------------------------- páginas de los eventos

  private pageOk(ev: MapEvent, pg: Pagina): boolean {
    const c = pg.cond;
    const self = (ch: string) => {
      const key = `${this.mapId}:${ev.id}:${ch}`;
      return !!(progress.locales[key] || this.temp[key]);
    };
    if (c.s1 && !progress.interruptores[c.s1]) return false;
    if (c.s2 && !progress.interruptores[c.s2]) return false;
    if (c.v && (progress.variables[c.v[0]] ?? 0) < c.v[1]) return false;
    if (c.ss && !self(c.ss)) return false;
    return true;
  }

  /** Como RPG Maker: cada evento muestra la última página cuyas condiciones se cumplen. */
  refreshPages(): void {
    for (const ev of this.mapEvents) {
      if (ev.erased) continue;
      let page = -1;
      for (let k = ev.pages.length - 1; k >= 0; k--) {
        if (this.pageOk(ev, ev.pages[k])) {
          page = k;
          break;
        }
      }
      if (page === ev.page) continue;
      ev.page = page;
      ev.autoDone = -1;
      const ch = ev.ch;
      ch.routeId++;
      const pg = ev.pages[page];
      if (!pg) {
        ch.setGraphic('');
        continue;
      }
      Object.assign(ch, { through: pg.atraviesa, fixDir: false, walkAnime: pg.anda, onTop: pg.encima, speed: pg.vel, freq: pg.frec });
      ch.setGraphic(pg.grafico, pg.dir, pg.patron);
      ch.fixDir = pg.fijo;
      ch.sprite?.setAlpha(pg.opacidad / 255);
      ch.setStepAnime(pg.paso);
      if (pg.mov === 3 && pg.ruta) void runRoute(this, ch, { ...pg.ruta, repite: true });
      if (pg.disparo === 4) void this.parallel(ev, page);
    }
    // Los eventos automáticos se lanzan en cuanto se puede.
    if (!this.busy) this.time.delayedCall(0, () => this.checkAutorun());
  }

  private activePage(ev: MapEvent): Pagina | undefined {
    return ev.erased ? undefined : ev.pages[ev.page];
  }

  /** Ejecuta un evento. Los procesos que no son paralelos bloquean al jugador. */
  private async runEvent(ev: MapEvent): Promise<void> {
    const pg = this.activePage(ev);
    if (!pg || ev.running || !pg.lista.length) return;
    ev.running = true;
    this.locks++;
    // Al hablarle, el personaje se gira hacia el jugador (salvo que tenga la dirección fija).
    if (pg.disparo <= 2 && ev.ch.sprite && !ev.ch.fixDir) ev.ch.turnToward(this.player.x, this.player.y);
    const page = ev.page;
    const it = new Interpreter(this, ev.id);
    this.interpreters.add(it);
    await it.run(pg.lista);
    this.interpreters.delete(it);
    ev.running = false;
    if (this.leaving) return;
    saveGame(this.position());
    if (pg.disparo === 3 && ev.page === page) ev.autoDone = page;
    this.unlock();
    this.afterEvents();
  }

  private async parallel(ev: MapEvent, page: number): Promise<void> {
    const pg = ev.pages[page];
    while (ev.page === page && !ev.erased && !this.leaving) {
      const it = new Interpreter(this, ev.id);
      this.interpreters.add(it);
      await it.run(pg.lista);
      this.interpreters.delete(it);
      await this.wait(FRAME_MS);
    }
  }

  private checkAutorun(): boolean {
    if (this.busy) return false;
    const ev = this.mapEvents.find((e) => this.activePage(e)?.disparo === 3 && !e.running && e.autoDone !== e.page);
    if (!ev) return false;
    void this.runEvent(ev);
    return true;
  }

  /** Tras un mensaje, un evento o un combate: automáticos y entrenadores que te ven. */
  private afterEvents(): void {
    if (this.busy) return;
    if (!this.checkAutorun()) this.checkTrainers();
  }

  private unlock(): void {
    this.locks = Math.max(0, this.locks - 1);
    this.lastUnlock = this.time.now;
    this.input.keyboard?.resetKeys();
  }

  // ------------------------------------------------------------- movimiento

  update(time: number): void {
    if (!this.player?.sprite) return;
    if (this.halos) this.updateHalos();
    this.moveEvents(time);
    if (this.player.moving || this.busy) return;
    const dir = this.heldDir();
    if (!dir) return;
    const p = this.player;
    const [dx, dy] = DELTA[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!this.inside(nx, ny)) {
      p.turn(dir);
      if (this.passable(p.x, p.y, dir)) this.tryConnection(dir);
      return;
    }
    if (dir === 2 && this.terrainAt(nx, ny) === TERRAIN_LEDGE && !this.eventsAt(nx, ny).some((e) => e.ch.solid)) {
      // Salto del bordillo: sonido al saltar y polvo al caer.
      sfx(this, 'Player jump');
      p.turn(2);
      void p.jump(0, 2).then(() => this.mapAnims.playAtTile('polvo', p.x, p.y, p.y + 1.7));
      return;
    }
    if (this.canMove(p, dir)) {
      void p.step(dir);
      return;
    }
    p.turn(dir);
    if (!this.eventsAt(nx, ny).length && this.time.now - this.lastBump > 450) {
      this.lastBump = this.time.now;
      sfx(this, 'Player bump', 0.5);
    }
    // Como en RMXP: chocar con un evento de contacto lo activa (puertas, salidas sobre muros).
    this.touch(nx, ny);
  }

  /** En la oscuridad solo se ven los personajes, cada uno con un halo tenue a sus pies. */
  private updateHalos(): void {
    if (!this.textures.exists('luz')) {
      const size = 160;
      const tex = this.textures.createCanvas('luz', size, size)!;
      const ctx = tex.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255, 244, 200, 0.35)');
      g.addColorStop(0.5, 'rgba(255, 236, 170, 0.12)');
      g.addColorStop(1, 'rgba(255, 230, 160, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      tex.refresh();
    }
    const chars = [this.player, ...this.mapEvents.filter((e) => !e.erased).map((e) => e.ch)];
    for (const ch of chars) {
      let light = this.halos!.get(ch);
      if (!light) this.halos!.set(ch, (light = this.add.image(0, 0, 'luz').setBlendMode(Phaser.BlendModes.ADD)));
      const s = ch.sprite;
      light.setVisible(!!s?.visible);
      if (s) light.setPosition(s.x, s.y - 12).setDepth(s.depth - 0.01);
    }
  }

  /** Movimiento autónomo de los eventos: aleatorio o hacia el jugador. */
  private moveEvents(time: number): void {
    if (this.busy) return;
    for (const ev of this.mapEvents) {
      const pg = this.activePage(ev);
      if (!pg || ev.running || ev.ch.moving || (pg.mov !== 1 && pg.mov !== 2)) continue;
      if (time < ev.nextMove) continue;
      // Frecuencia 1-6: de un paso cada ~3 s a uno seguido.
      ev.nextMove = time + 2 ** (6 - ev.ch.freq) * 100 * (0.5 + Math.random());
      const dirs: Dir[] = [2, 4, 6, 8];
      const dir = pg.mov === 1 ? dirs[Math.floor(Math.random() * 4)] : this.dirToPlayer(ev.ch);
      void ev.ch.step(dir);
    }
  }

  private dirToPlayer(ch: Character): Dir {
    const dx = this.player.x - ch.x;
    const dy = this.player.y - ch.y;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
  }

  private heldDir(): Dir | null {
    const c = this.cursors;
    if (c.left.isDown || this.wasd.A.isDown) return 4;
    if (c.right.isDown || this.wasd.D.isDown) return 6;
    if (c.up.isDown || this.wasd.W.isDown) return 8;
    if (c.down.isDown || this.wasd.S.isDown) return 2;
    return null;
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

  private eventsAt(x: number, y: number): MapEvent[] {
    return this.mapEvents.filter((e) => e.ch.x === x && e.ch.y === y && this.activePage(e));
  }

  /** Paso de RMXP: casillas del mapa, eventos sólidos y el jugador. */
  canMove(ch: Character, dir: Dir): boolean {
    const [dx, dy] = DELTA[dir];
    const nx = ch.x + dx;
    const ny = ch.y + dy;
    if (!this.inside(nx, ny)) return false;
    if (ch.through) return true;
    if (!this.passable(ch.x, ch.y, dir) || !this.passable(nx, ny, REVERSE[dir])) return false;
    for (const e of this.eventsAt(nx, ny)) {
      if (e.ch === ch || e.ch.through) continue;
      // Al jugador solo le bloquean los eventos con gráfico; a los eventos, cualquiera.
      if (ch !== this.player || e.ch.sprite) return false;
    }
    if (ch !== this.player && this.player.x === nx && this.player.y === ny && !this.player.through) return false;
    return true;
  }

  moved(ch: Character): void {
    // La hierba se mueve al pisarla (también cuando la pisa un NPC).
    const t = this.terrainAt(ch.x, ch.y);
    if (ch.sprite && (t === TERRAIN_GRASS || t === TERRAIN_TALL_GRASS)) {
      void this.mapAnims.playAtTile('hierba', ch.x, ch.y, ch.y + 1.7);
    }
    if (ch === this.player) this.onStep();
  }

  private onStep(): void {
    const p = this.player;
    if (this.busy) return;
    // Eventos de contacto en la casilla que se pisa (puertas, alfombras de salida...).
    const here = this.eventsAt(p.x, p.y).find((e) => [1, 2].includes(this.activePage(e)!.disparo));
    if (here) return void this.runEvent(here);
    if (this.checkTrainers()) return;
    const t = this.terrainAt(p.x, p.y);
    if ((t === TERRAIN_GRASS || t === TERRAIN_TALL_GRASS) && Math.random() < encounterChance(this.mapId)) {
      this.startWildBattle();
    }
  }

  private touch(x: number, y: number): void {
    const ev = this.eventsAt(x, y).find((e) => [1, 2].includes(this.activePage(e)!.disparo));
    if (ev) void this.runEvent(ev);
  }

  private position() {
    return { mapId: this.mapId, x: this.player.x, y: this.player.y, dir: this.player.dir };
  }

  // ------------------------------------------------------------- mapas

  private warp(to: { mapa: number; x: number; y: number; dir: number }, say?: string[], fade = true): void {
    if (!mundo.mapas[to.mapa]) return;
    this.locks++;
    this.leaving = true;
    const go = () => void this.scene.restart({ mapId: to.mapa, x: to.x, y: to.y, dir: to.dir || this.player.dir, say } satisfies WorldData);
    if (!fade) return go();
    this.cameras.main.fadeOut(200);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
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
        const x = this.player.x + dx - ax + bx;
        const y = this.player.y + dy - ay + by;
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
    if (this.busy || this.player.moving || this.time.now - this.lastUnlock < 150) return;
    const p = this.player;
    const [dx, dy] = DELTA[p.dir];
    const actionable = (e: MapEvent, triggers: number[]) => triggers.includes(this.activePage(e)!.disparo);
    // Primero lo que hay bajo los pies (eventos sin gráfico), luego lo de delante.
    const here = this.eventsAt(p.x, p.y).find((e) => e.ch !== p && actionable(e, [0]));
    const front = this.eventsAt(p.x + dx, p.y + dy).find((e) => actionable(e, [0, 1, 2]));
    // Por encima de un mostrador (casilla que no se puede pisar) se habla con quien está detrás.
    const counter = !front && !this.passable(p.x + dx, p.y + dy, REVERSE[p.dir])
      ? this.eventsAt(p.x + 2 * dx, p.y + 2 * dy).find((e) => actionable(e, [0, 1, 2]))
      : undefined;
    const ev = here ?? front ?? counter;
    if (ev) void this.runEvent(ev);
  }

  // ------------------------------------------------------------- entrenadores

  /** ¿Algún entrenador te ve? Su evento ("Trainer(n)" con contacto del evento) se pone en marcha. */
  private checkTrainers(): boolean {
    if (this.busy || !partyCanFight()) return false;
    const p = this.player;
    for (const ev of this.mapEvents) {
      const pg = this.activePage(ev);
      if (!ev.vision || !pg || pg.disparo !== 2 || !ev.ch.sprite || ev.running) continue;
      const [dx, dy] = DELTA[ev.ch.dir];
      for (let k = 1; k <= ev.vision; k++) {
        const x = ev.ch.x + dx * k;
        const y = ev.ch.y + dy * k;
        if (x === p.x && y === p.y) {
          void this.runEvent(ev);
          return true;
        }
        if (this.eventsAt(x, y).some((e) => e.ch.solid)) break;
      }
    }
    return false;
  }

  // ------------------------------------------------------------- servicios para el intérprete

  character(id: number, self: number): Character | undefined {
    if (id === -1) return this.player;
    const target = id === 0 ? self : id;
    return this.mapEvents.find((e) => e.id === target)?.ch;
  }

  message(text: string, choices?: string[], cancel?: number): Promise<number> {
    return new Promise((resolve) => {
      const data: DialogData = {
        lines: text ? [text] : [],
        choices,
        cancel,
        onClose: (choice) => {
          this.lastUnlock = this.time.now;
          this.input.keyboard!.resetKeys();
          resolve(choice);
        },
      };
      this.scene.launch('Dialog', data);
    });
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  transfer(map: number, x: number, y: number, dir: number, fade: boolean): void {
    this.warp({ mapa: map, x, y, dir }, undefined, fade);
  }

  erase(id: number): void {
    const ev = this.mapEvents.find((e) => e.id === id);
    if (!ev) return;
    ev.erased = true;
    ev.ch.routeId++;
    ev.ch.setGraphic('');
  }

  playSound(folder: 'SE' | 'ME', name: string, volume = 0.8): void {
    const key = `snd:${folder}/${name}`;
    if (this.cache.audio.exists(key)) return void this.sound.play(key, { volume });
    const file = mundo.sonidos?.[`${folder}/${name}`];
    if (!file) return sfx(this, name, volume);
    this.load.audio(key, `${ESS}sonidos/${file.split('/').map(encodeURIComponent).join('/')}`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.cache.audio.exists(key)) this.sound.play(key, { volume });
    });
    this.load.start();
  }

  /** Tono de pantalla de RPG Maker (rojo, verde, azul, gris de -255 a 255), aproximado con un velo. */
  tone(tone: number[], ms: number): void {
    const [r, g, b] = tone;
    const avg = (r + g + b) / 3;
    const { width, height } = this.scale;
    this.toneRect ??= this.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0).setScrollFactor(0).setDepth(15000).setAlpha(0);
    const color = avg < 0 ? 0x000000 : 0xffffff;
    this.toneRect.setFillStyle(color, 1);
    this.tweens.add({ targets: this.toneRect, alpha: Math.min(1, Math.abs(avg) / 255), duration: Math.max(1, ms) });
  }

  flash(color: number[], ms: number): void {
    this.cameras.main.flash(Math.max(50, ms), color[0], color[1], color[2]);
  }

  shake(power: number, ms: number): void {
    this.cameras.main.shake(Math.max(50, ms), 0.002 * power);
  }

  exclaim(ch: Character): Promise<void> {
    const sprite = ch.sprite;
    if (!sprite) return Promise.resolve();
    // Bocadillo "!" de Essentials sobre la cabeza.
    return this.mapAnims.play('exclamacion', sprite.x, sprite.y, sprite.y - sprite.height, 20000).then(() => this.wait(150));
  }

  cry(species: string): void {
    const num = especies[species]?.num;
    if (!num) return;
    const key = `cry:${num}`;
    if (this.cache.audio.exists(key)) return void this.sound.play(key, { volume: 0.6 });
    this.load.audio(key, `${ESS}combate/gritos/${num}.ogg`);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.cache.audio.exists(key)) this.sound.play(key, { volume: 0.6 });
    });
    this.load.start();
  }

  setRespawn(): void {
    progress.regreso = this.position();
  }

  /** Tienda (pbPokemonMart): compra de una en una con el dinero del jugador. */
  async shop(items: string[]): Promise<void> {
    const list = items.filter((id) => objetos[id]);
    await this.message('¡Bienvenido! ¿En qué puedo ayudarte?');
    for (;;) {
      const names = list.map((id) => `${objetos[id].nombre}  ${objetos[id].precio} ₽`);
      const pick = await this.message(`Tienes ${progress.dinero} ₽. ¿Qué quieres comprar?`, [...names, 'Salir'], list.length);
      if (pick < 0 || pick >= list.length) break;
      const it = objetos[list[pick]];
      if (progress.dinero < it.precio) {
        await this.message('No tienes suficiente dinero.');
        continue;
      }
      progress.dinero -= it.precio;
      addItem(list[pick]);
      await this.message(`¡Aquí tienes! Has comprado ${it.nombre}.`);
    }
    await this.message('¡Vuelve cuando quieras!');
    saveGame(this.position());
  }

  async openPC(): Promise<void> {
    await this.message(`Has encendido el PC. Tienes ${pc.length} Pokémon guardados.`);
  }

  gameOver(): void {
    this.respawn(['Todo se vuelve negro...']);
  }

  battle(t: Entrenador): Promise<BattleResult> {
    return this.startBattle(trainerTeam(t), t);
  }

  // ------------------------------------------------------------- menús

  /** Menú de pausa (Esc o X): Pokédex, equipo, mochila, monedero y guardar. */
  private openMenu(): void {
    if (this.busy || this.player.moving || this.time.now - this.lastUnlock < 150) return;
    this.locks++;
    const data: MenuData = { onSave: () => saveGame(this.position()), onClose: () => this.unlock() };
    this.scene.launch('Menu', data);
  }

  private say(lines: string[], onClose?: () => void): void {
    this.locks++;
    const data: DialogData = {
      lines,
      onClose: () => {
        this.unlock();
        onClose?.();
      },
    };
    this.scene.launch('Dialog', data);
  }

  // ------------------------------------------------------------- combate

  private startWildBattle(): void {
    const foe = rollEncounter(this.mapId);
    if (!foe || !partyCanFight()) return;
    void this.startBattle([foe]);
  }

  private startBattle(foes: PokemonSpec[], trainer?: Entrenador): Promise<BattleResult> {
    this.locks++;
    return new Promise((resolve) => {
      void this.battleTransition().then((bars) => {
        const data: BattleData = {
          foes,
          trainer,
          background: this.info.fondoCombate,
          onEnd: (result) => {
            bars.destroy();
            this.scene.resume();
            this.unlock();
            if (result === 'lose') {
              this.respawn(['¡No te quedan Pokémon en condiciones de luchar!']);
            } else {
              saveGame(this.position());
              // Un combate salvaje no viene de un evento: se miran los entrenadores al volver.
              if (!trainer) this.afterEvents();
            }
            resolve(result);
          },
        };
        this.scene.pause();
        this.scene.launch('Battle', data);
      });
    });
  }

  /**
   * Transición al combate: dos destellos y la pantalla se cierra con franjas negras
   * que entran alternando desde cada lado. Devuelve las franjas para quitarlas al volver.
   */
  private async battleTransition(): Promise<Phaser.GameObjects.Container> {
    const cam = this.cameras.main;
    cam.flash(200, 255, 255, 255);
    await this.wait(260);
    cam.flash(200, 255, 255, 255);
    await this.wait(300);
    const { width, height } = this.scale;
    const rows = 8;
    const h = Math.ceil(height / rows);
    const bars = this.add.container(0, 0).setScrollFactor(0).setDepth(30000);
    await Promise.all(
      Array.from({ length: rows }, (_, k) => {
        const fromLeft = k % 2 === 0;
        const bar = this.add.rectangle(fromLeft ? -width : width, k * h, width, h, 0x000000).setOrigin(0);
        bars.add(bar);
        return new Promise<void>((r) =>
          this.tweens.add({ targets: bar, x: 0, duration: 380, delay: k * 35, ease: 'Quad.easeIn', onComplete: () => r() }),
        );
      }),
    );
    return bars;
  }

  /** Como en Essentials: vuelves al último Centro Pokémon (o a casa) con el equipo curado. */
  private respawn(first: string[]): void {
    healParty();
    const back = progress.regreso;
    const to = back ? { mapa: back.mapId, x: back.x, y: back.y, dir: back.dir } : mundo.inicio;
    saveGame({ mapId: to.mapa, x: to.x, y: to.y, dir: to.dir });
    this.warp(to, [...first, back ? 'Vuelves corriendo al Centro Pokémon y tu equipo se recupera.' : 'Vuelves corriendo a casa y tu equipo se recupera.']);
  }
}
