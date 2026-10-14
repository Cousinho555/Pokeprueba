import Phaser from 'phaser';
import { ESS } from '../data/essentials';

/**
 * Reproductor de las animaciones de combate de Pokémon Essentials (PkmnAnimations),
 * exportadas por tools/import_essentials.py. Sigue PBAnimationPlayerX de Essentials:
 * 20 frames por segundo, cada celda colocada respecto al usuario, al objetivo o a la
 * línea entre ambos, y los "tiempos" para sonidos y fondos.
 */

const BASE = `${ESS}animaciones/`;
const FRAME_MS = 50;
const CELL = 192;
// Posiciones del usuario y el objetivo en el editor de animaciones de Essentials.
const SRC: [number, number, number, number] = [128, 224, 384, 96];

// Índices de cada celda exportada.
const K = 0, X = 1, Y = 2, ZX = 3, ZY = 4, ANGLE = 5, MIRROR = 6, BLEND = 7, VISIBLE = 8,
  PATTERN = 9, OPACITY = 10, PRIORITY = 11, FOCUS = 12;

type Cell = number[];
/** [frame, tipo, recurso, volumen, tono, duración, bgX, bgY, opacidad, [r, g, b, a]] */
type Timing = [number, number, string, number, number, number, number | null, number | null, number | null, (number | null)[]];

interface AnimData {
  grafico: string;
  frames: Cell[][];
  tiempos: Timing[];
}

/** Un Pokémon en el campo: su sprite y su escala normal. */
export interface Actor {
  sprite: Phaser.GameObjects.Image;
  scale: number;
}

interface Plane {
  rect: Phaser.GameObjects.Rectangle;
  img?: Phaser.GameObjects.TileSprite;
  // Estado guardado para las transiciones (tipos 2 y 4)
  old: { x: number; y: number; opacity: number; color: number[] };
  ox: number;
  oy: number;
  opacity: number;
  color: number[];
}

let index: Record<string, number> | null = null;

export class AnimationPlayer {
  constructor(private scene: Phaser.Scene) {}

  /** Carga un fichero con el loader de Phaser y espera a que termine. */
  private loadAll(add: (load: Phaser.Loader.LoaderPlugin) => boolean): Promise<void> {
    const load = this.scene.load;
    if (!add(load)) return Promise.resolve();
    return new Promise((resolve) => {
      load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      load.start();
    });
  }

  private async getIndex(): Promise<Record<string, number>> {
    if (!index) {
      await this.loadAll((l) => (l.json('anim:indice', `${BASE}indice.json`), true));
      index = (this.scene.cache.json.get('anim:indice') as Record<string, number>) ?? {};
    }
    return index;
  }

  /**
   * Busca la animación como Essentials: si la usa el rival y existe "OppMove:X", esa
   * (y se juega con usuario y objetivo intercambiados); si no, "Move:X".
   */
  async find(name: string, foeIsUser: boolean): Promise<{ id: number; opp: boolean } | null> {
    const idx = await this.getIndex();
    if (foeIsUser && name.startsWith('Move:')) {
      const opp = idx[`Opp${name}`];
      if (opp != null) return { id: opp, opp: true };
    }
    return idx[name] != null ? { id: idx[name], opp: false } : null;
  }

  /** Reproduce una animación. Devuelve false si no existe (para usar un efecto sencillo). */
  async play(name: string, user: Actor | undefined, target: Actor | undefined, foeIsUser: boolean): Promise<boolean> {
    const found = await this.find(name, foeIsUser);
    if (!found) return false;
    const key = `anim:${found.id}`;
    await this.loadAll((l) => {
      if (this.scene.cache.json.exists(key)) return false;
      l.json(key, `${BASE}${found.id}.json`);
      return true;
    });
    const data = this.scene.cache.json.get(key) as AnimData | undefined;
    if (!data?.frames?.length) return false;
    await this.loadResources(data);
    if (found.opp) [user, target] = [target, user];
    await this.run(data, user, target ?? user);
    return true;
  }

  private loadResources(data: AnimData): Promise<void> {
    return this.loadAll((l) => {
      let any = false;
      const img = (file: string) => {
        if (!file || this.scene.textures.exists(`animg:${file}`)) return;
        l.spritesheet(`animg:${file}`, `${BASE}graficos/${encodeURIComponent(file)}`, { frameWidth: CELL, frameHeight: CELL });
        l.image(`animbg:${file}`, `${BASE}graficos/${encodeURIComponent(file)}`);
        any = true;
      };
      img(data.grafico);
      for (const t of data.tiempos) {
        if (t[1] === 0 && t[2] && !this.scene.cache.audio.exists(`se:${t[2]}`)) {
          l.audio(`se:${t[2]}`, `${BASE}sonidos/${encodeURIComponent(t[2])}`);
          any = true;
        }
        if ((t[1] === 1 || t[1] === 3) && t[2]) img(t[2]);
      }
      return any;
    });
  }

  private run(data: AnimData, user: Actor | undefined, target: Actor | undefined): Promise<void> {
    const scene = this.scene;
    const center = (a?: Actor): [number, number] => {
      if (!a) return [256, 192];
      const s = a.sprite;
      return [s.x, s.y - s.displayHeight / 2];
    };
    const [ux, uy] = center(user);
    const [tx, ty] = center(target);
    const reversed = SRC[0] < SRC[2] ? ux > tx : ux < tx;
    const transform = (x: number, y: number): [number, number] => [
      ux + ((x - SRC[0]) / (SRC[2] - SRC[0])) * (tx - ux),
      uy + ((y - SRC[1]) / (SRC[3] - SRC[1])) * (ty - uy),
    ];

    // Estado de los dos Pokémon para dejarlos como estaban al acabar.
    const actors = [user, target];
    const saved = actors.map((a) => a && {
      x: a.sprite.x, y: a.sprite.y, alpha: a.sprite.alpha, angle: a.sprite.angle,
      flipX: a.sprite.flipX, visible: a.sprite.visible, scaleX: a.sprite.scaleX, scaleY: a.sprite.scaleY,
    });

    const sheetKey = `animg:${data.grafico}`;
    const hasSheet = !!data.grafico && scene.textures.exists(sheetKey);
    const cols = hasSheet ? Math.max(1, Math.floor(scene.textures.get(sheetKey).getSourceImage().width / CELL)) : 5;
    const pool: Phaser.GameObjects.Image[] = [];
    const cellSprite = (k: number) => {
      while (pool.length <= k) pool.push(scene.add.image(0, 0, hasSheet ? sheetKey : '__WHITE').setVisible(false));
      return pool[k];
    };

    const { width, height } = scene.scale;
    const makePlane = (depth: number): Plane => ({
      rect: scene.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setDepth(depth),
      old: { x: 0, y: 0, opacity: 0, color: [0, 0, 0, 0] },
      ox: 0, oy: 0, opacity: 0, color: [0, 0, 0, 0],
    });
    const bg = makePlane(3);
    const fg = makePlane(45);

    const drawPlane = (pl: Plane) => {
      const a = (pl.opacity / 255);
      if (pl.img) {
        pl.img.setAlpha(a).setTilePosition(-pl.ox, -pl.oy);
        pl.rect.setFillStyle(0, 0);
      } else {
        pl.rect.setFillStyle(Phaser.Display.Color.GetColor(pl.color[0], pl.color[1], pl.color[2]), a * (pl.color[3] / 255));
      }
    };

    const timing = (frame: number) => {
      for (const t of data.tiempos) {
        const [f, kind, res, vol, pitch, dur, bx, by, op, col] = t;
        const pl = kind <= 2 ? bg : fg;
        if (f === frame) {
          if (kind === 0 && res && scene.cache.audio.exists(`se:${res}`)) {
            scene.sound.play(`se:${res}`, { volume: Math.min(1, (vol / 100) * 0.7), rate: pitch / 100 });
          } else if (kind === 1 || kind === 3) {
            pl.img?.destroy();
            pl.img = undefined;
            if (res && scene.textures.exists(`animbg:${res}`)) {
              pl.img = scene.add.tileSprite(0, 0, width, height, `animbg:${res}`).setOrigin(0).setDepth(pl.rect.depth);
            }
            pl.ox = -(bx ?? 0);
            pl.oy = -(by ?? 0);
            pl.opacity = op ?? 0;
            pl.color = col.map((c) => c ?? 0);
            drawPlane(pl);
          } else if (kind === 2 || kind === 4) {
            pl.old = { x: pl.ox, y: pl.oy, opacity: pl.opacity, color: [...pl.color] };
          }
        }
        if ((kind === 2 || kind === 4) && dur > 0 && frame >= f && frame <= f + dur) {
          const k = (frame - f) / dur;
          const o = pl.old;
          if (bx != null) pl.ox = o.x - (bx - o.x) * k;
          if (by != null) pl.oy = o.y - (by - o.y) * k;
          if (op != null) pl.opacity = o.opacity + (op - o.opacity) * k;
          pl.color = o.color.map((c, i) => (col[i] != null ? c + ((col[i] as number) - c) * k : c));
          drawPlane(pl);
        }
      }
    };

    const showFrame = (frame: number) => {
      pool.forEach((s) => s.setVisible(false));
      for (const cell of data.frames[frame]) {
        const k = cell[K];
        const actor = k === 0 ? user : k === 1 ? target : undefined;
        if (k <= 1 && !actor) continue;
        let x = cell[X];
        let y = cell[Y];
        let mirror = cell[MIRROR] > 0;
        switch (cell[FOCUS]) {
          case 1:
            x += tx - SRC[2];
            y += ty - SRC[3];
            break;
          case 2:
            x += ux - SRC[0];
            y += uy - SRC[1];
            break;
          case 3:
            [x, y] = transform(x, y);
            if (reversed && cell[PATTERN] >= 0) mirror = !mirror;
            break;
        }
        const visible = cell[VISIBLE] === 1;
        if (actor) {
          // El propio Pokémon (se mueve, se encoge, desaparece...). Su origen está en los pies.
          const s = actor.sprite;
          s.setScale(actor.scale * (cell[ZX] / 100), actor.scale * (cell[ZY] / 100));
          s.setPosition(x, y + s.displayHeight / 2).setAngle(cell[ANGLE]).setAlpha(cell[OPACITY] / 255).setVisible(visible);
          s.setFlipX(saved[k]!.flipX !== mirror);
          continue;
        }
        const p = cell[PATTERN];
        const col = p % 5;
        if (!hasSheet || p < 0 || col >= cols) continue;
        const s = cellSprite(k);
        const frameIdx = Math.floor(p / 5) * cols + col;
        if (!scene.textures.get(sheetKey).has(String(frameIdx))) continue;
        s.setFrame(frameIdx)
          .setPosition(x, y)
          .setScale(cell[ZX] / 100, cell[ZY] / 100)
          .setAngle(cell[ANGLE])
          .setFlipX(mirror)
          .setAlpha(cell[OPACITY] / 255)
          .setVisible(visible)
          .setBlendMode(cell[BLEND] === 1 ? Phaser.BlendModes.ADD : cell[BLEND] === 2 ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
        const focusActor = cell[FOCUS] === 1 ? target : cell[FOCUS] === 2 ? user : undefined;
        const prio = cell[PRIORITY];
        s.setDepth(
          prio === 0 ? 5
            : prio === 2 ? (focusActor ? focusActor.sprite.depth - 1 : 5)
              : prio === 3 ? (focusActor ? focusActor.sprite.depth + 1 : 35)
                : 35,
        );
      }
      timing(frame);
    };

    return new Promise((resolve) => {
      let frame = 0;
      showFrame(0);
      scene.time.addEvent({
        delay: FRAME_MS,
        repeat: data.frames.length - 1,
        callback: () => {
          frame++;
          if (frame < data.frames.length) return showFrame(frame);
          pool.forEach((s) => s.destroy());
          for (const pl of [bg, fg]) {
            pl.rect.destroy();
            pl.img?.destroy();
          }
          actors.forEach((a, i) => {
            const s = saved[i];
            if (a && s) a.sprite.setPosition(s.x, s.y).setAlpha(s.alpha).setAngle(s.angle).setFlipX(s.flipX).setVisible(s.visible).setScale(s.scaleX, s.scaleY);
          });
          resolve();
        },
      });
    });
  }
}
