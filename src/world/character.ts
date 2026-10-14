import Phaser from 'phaser';
import { mundo } from '../data/essentials';

/** Direcciones como en RPG Maker: abajo, izquierda, derecha, arriba. */
export type Dir = 2 | 4 | 6 | 8;
export const DELTA: Record<Dir, [number, number]> = { 2: [0, 1], 4: [-1, 0], 6: [1, 0], 8: [0, -1] };
export const ROW: Record<Dir, number> = { 2: 0, 4: 1, 6: 2, 8: 3 };
export const REVERSE: Record<Dir, Dir> = { 2: 8, 4: 6, 6: 4, 8: 2 };
export const TILE = 32;
export const isDir = (d: number): d is Dir => d === 2 || d === 4 || d === 6 || d === 8;
export const charKey = (name: string) => `chr:${name}`;

/** Lo que un personaje necesita saber del mapa para moverse. */
export interface CharacterHost {
  /** La escena donde se dibuja. */
  stage: Phaser.Scene;
  /** ¿Puede `ch` avanzar desde su casilla en la dirección `dir`? */
  canMove(ch: Character, dir: Dir): boolean;
  /** Se llama cada vez que un personaje termina un paso o un salto. */
  moved(ch: Character): void;
}

/**
 * Personaje del mapa (jugador o evento), equivalente a Game_Character de RPG Maker:
 * casilla, dirección, gráfico, velocidad y animación al andar.
 */
export class Character {
  sprite?: Phaser.GameObjects.Sprite;
  graphic = '';
  pattern = 0;
  /** Velocidad de RPG Maker (1-6, 4 = normal). */
  speed = 4;
  /** Frecuencia de movimiento autónomo (1-6). */
  freq = 3;
  through = false;
  fixDir = false;
  walkAnime = true;
  stepAnime = false;
  onTop = false;
  transparent = false;
  /** El jugador se dibuja por encima de los eventos de su misma fila (puertas, alfombras). */
  depthBias = 0;
  moving = false;
  /** Ruta de movimiento en curso: al cambiarla, la anterior se abandona. */
  routeId = 0;
  private stepTimer?: Phaser.Time.TimerEvent;
  private walkFrame = 0;

  constructor(
    private host: CharacterHost,
    public x: number,
    public y: number,
    public dir: Dir = 2,
  ) {}

  get stepMs(): number {
    // RMXP avanza 2^velocidad / 128 casillas por frame a 40 fps: velocidad 4 = 200 ms por casilla.
    return 3200 / 2 ** this.speed;
  }

  /** ¿Bloquea el paso a otros personajes? */
  get solid(): boolean {
    return !this.through && !!this.sprite && !this.transparent;
  }

  setGraphic(name: string, dir?: number, pattern?: number): void {
    this.graphic = name;
    if (dir && isDir(dir)) this.dir = dir;
    if (pattern != null) this.pattern = pattern;
    const scene = this.host.stage;
    if (!name || !scene.textures.exists(charKey(name))) {
      this.sprite?.destroy();
      this.sprite = undefined;
      return;
    }
    if (!this.sprite) this.sprite = scene.add.sprite(0, 0, charKey(name)).setOrigin(0.5, 1);
    else this.sprite.setTexture(charKey(name));
    this.place();
    this.refreshFrame();
  }

  setStepAnime(on: boolean): void {
    this.stepAnime = on;
    this.stepTimer?.remove();
    this.stepTimer = undefined;
    if (on) {
      this.stepTimer = this.host.stage.time.addEvent({
        delay: this.stepMs, loop: true,
        callback: () => {
          this.pattern = (this.pattern + 1) % 4;
          this.refreshFrame();
        },
      });
    }
  }

  place(): void {
    this.sprite?.setPosition(this.x * TILE + TILE / 2, (this.y + 1) * TILE);
    this.refreshDepth();
  }

  refreshFrame(): void {
    if (!this.sprite) return;
    this.sprite.setFrame(ROW[this.dir] * 4 + (this.pattern % 4));
    this.sprite.setVisible(!this.transparent);
  }

  private refreshDepth(): void {
    this.sprite?.setDepth(this.onTop ? 20000 : this.sprite.y / TILE + this.depthBias);
  }

  turn(dir: Dir): void {
    if (this.fixDir) return;
    this.dir = dir;
    this.refreshFrame();
  }

  turnToward(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    if (!dx && !dy) return;
    this.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8);
  }

  /** Avanza una casilla si se puede. Devuelve si se ha movido. */
  async step(dir: Dir): Promise<boolean> {
    this.turn(dir);
    if (!this.host.canMove(this, dir)) return false;
    const [dx, dy] = DELTA[dir];
    this.x += dx;
    this.y += dy;
    await this.slide(this.stepMs);
    return true;
  }

  private slide(ms: number): Promise<void> {
    this.moving = true;
    if (this.sprite && this.walkAnime && !this.stepAnime) {
      // Paso: alterna los frames 1 y 3 de la fila, como RMXP.
      this.walkFrame = (this.walkFrame + 2) % 4;
      this.pattern = 1 + this.walkFrame;
      this.refreshFrame();
    }
    return new Promise((resolve) => {
      const done = () => {
        this.moving = false;
        if (this.walkAnime && !this.stepAnime) this.pattern = 0;
        this.place();
        this.refreshFrame();
        this.host.moved(this);
        resolve();
      };
      if (!this.sprite) return this.host.stage.time.delayedCall(ms, done);
      this.host.stage.time.delayedCall(ms / 2, () => {
        if (this.walkAnime && !this.stepAnime) {
          this.pattern = 0;
          this.refreshFrame();
        }
      });
      this.host.stage.tweens.add({
        targets: this.sprite,
        x: this.x * TILE + TILE / 2,
        y: (this.y + 1) * TILE,
        duration: ms,
        onUpdate: () => this.refreshDepth(),
        onComplete: done,
      });
    });
  }

  /** Salto de (dx, dy) casillas, como el comando "Saltar" de las rutas o un bordillo. */
  jump(dx: number, dy: number): Promise<void> {
    this.x += dx;
    this.y += dy;
    if (dx || dy) this.turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8);
    this.moving = true;
    const sprite = this.sprite;
    const ms = this.stepMs * 2;
    return new Promise((resolve) => {
      const done = () => {
        this.moving = false;
        this.place();
        this.host.moved(this);
        resolve();
      };
      if (!sprite) return this.host.stage.time.delayedCall(ms, done);
      const sx = sprite.x;
      const sy = sprite.y;
      const tx = this.x * TILE + TILE / 2;
      const ty = (this.y + 1) * TILE;
      this.host.stage.tweens.addCounter({
        from: 0, to: 1, duration: ms,
        onUpdate: (tw) => {
          const t = tw.getValue() ?? 0;
          sprite.setPosition(sx + (tx - sx) * t, sy + (ty - sy) * t - Math.sin(t * Math.PI) * 20);
          this.refreshDepth();
        },
        onComplete: done,
      });
    });
  }

  /** Tamaño del frame de su hoja de personaje. */
  get frameSize(): [number, number] {
    return mundo.graficos[this.graphic] ?? [TILE, TILE * 1.5];
  }

  destroy(): void {
    this.stepTimer?.remove();
    this.sprite?.destroy();
  }
}
