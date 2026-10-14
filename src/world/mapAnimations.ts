import Phaser from 'phaser';
import { ESS } from '../data/essentials';
import { TILE } from './character';

/**
 * Animaciones del mapa de RPG Maker (Animations.rxdata de Essentials): la hierba que se
 * mueve al pisarla, el polvo al saltar un bordillo y los bocadillos de "!" y "?".
 */
export type MapAnimName = 'hierba' | 'polvo' | 'exclamacion' | 'pregunta';

interface MapAnim {
  grafico: string;
  /** 0 arriba, 1 centro, 2 abajo del personaje (3 = pantalla). */
  posicion: number;
  /** Celdas por frame: [patrón, x, y, zoom, ángulo, espejo, opacidad, mezcla]. */
  frames: number[][][];
  sonidos: [number, string, number][];
}

const BASE = `${ESS}mapa/`;
const CELL = 192;
/** RPG Maker XP muestra un frame de animación cada 2 de pantalla (40 fps): 50 ms. */
const FRAME_MS = 50;

export class MapAnimations {
  private ready: Promise<void>;

  constructor(private scene: Phaser.Scene) {
    const load = scene.load;
    let any = false;
    for (const name of ['hierba', 'polvo', 'exclamacion', 'pregunta']) {
      if (!scene.cache.json.exists(`mapanim:${name}`)) {
        load.json(`mapanim:${name}`, `${BASE}${name}.json`);
        any = true;
      }
    }
    this.ready = (any ? new Promise<void>((r) => { load.once(Phaser.Loader.Events.COMPLETE, () => r()); load.start(); }) : Promise.resolve())
      .then(() => this.loadGraphics());
  }

  private loadGraphics(): Promise<void> {
    const load = this.scene.load;
    let any = false;
    for (const name of ['hierba', 'polvo', 'exclamacion', 'pregunta']) {
      const a = this.scene.cache.json.get(`mapanim:${name}`) as MapAnim | undefined;
      if (!a) continue;
      const key = `mapanimg:${a.grafico}`;
      if (!this.scene.textures.exists(key)) {
        load.spritesheet(key, `${BASE}${encodeURIComponent(a.grafico)}`, { frameWidth: CELL, frameHeight: CELL });
        any = true;
      }
      for (const [, file] of a.sonidos) {
        if (!this.scene.cache.audio.exists(`mapse:${file}`)) {
          load.audio(`mapse:${file}`, `${BASE}${encodeURIComponent(file)}`);
          any = true;
        }
      }
    }
    if (!any) return Promise.resolve();
    return new Promise((r) => {
      load.once(Phaser.Loader.Events.COMPLETE, () => r());
      load.start();
    });
  }

  /**
   * Reproduce una animación sobre un punto del mapa: `x` es el centro del personaje o la
   * casilla, `bottom` sus pies y `top` su cabeza. Se resuelve al terminar.
   */
  async play(name: MapAnimName, x: number, bottom: number, top: number, depth: number): Promise<void> {
    await this.ready;
    const scene = this.scene;
    const a = scene.cache.json.get(`mapanim:${name}`) as MapAnim | undefined;
    const key = a && `mapanimg:${a.grafico}`;
    if (!a || !key || !scene.textures.exists(key)) return;
    const cols = Math.max(1, Math.floor(scene.textures.get(key).getSourceImage().width / CELL));
    const y = a.posicion === 0 ? top : a.posicion === 2 ? bottom : (top + bottom) / 2;
    const sprites: Phaser.GameObjects.Image[] = [];
    const show = (f: number) => {
      sprites.forEach((s) => s.setVisible(false));
      a.frames[f].forEach(([pat, cx, cy, zoom, angle, mirror, opacity, blend], k) => {
        sprites[k] ??= scene.add.image(0, 0, key).setDepth(depth);
        const frame = Math.floor(pat / 5) * cols + (pat % 5);
        if (!scene.textures.get(key).has(String(frame))) return;
        sprites[k]
          .setFrame(frame)
          .setPosition(x + cx, y + cy)
          .setScale(zoom / 100)
          .setAngle(angle)
          .setFlipX(mirror === 1)
          .setAlpha(opacity / 255)
          .setBlendMode(blend === 1 ? Phaser.BlendModes.ADD : blend === 2 ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL)
          .setVisible(true);
      });
      for (const [frame, file, vol] of a.sonidos) {
        if (frame === f && scene.cache.audio.exists(`mapse:${file}`)) scene.sound.play(`mapse:${file}`, { volume: (vol / 100) * 0.7 });
      }
    };
    await new Promise<void>((resolve) => {
      let f = 0;
      show(0);
      scene.time.addEvent({
        delay: FRAME_MS,
        repeat: a.frames.length - 1,
        callback: () => {
          f++;
          if (f < a.frames.length) return show(f);
          sprites.forEach((s) => s.destroy());
          resolve();
        },
      });
    });
  }

  /** Animación sobre una casilla (centro de la casilla, pies en su borde inferior). */
  playAtTile(name: MapAnimName, tx: number, ty: number, depth: number): Promise<void> {
    return this.play(name, tx * TILE + TILE / 2, (ty + 1) * TILE, ty * TILE, depth);
  }
}
