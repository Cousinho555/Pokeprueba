import Phaser from 'phaser';
import { ENCOUNTER_RATE, rollWildPokemon } from '../data/encounters';
import { healParty, partyCanFight } from '../data/party';
import type { DialogData } from './DialogScene';
import type { BattleData } from './BattleScene';

type Dir = 'down' | 'left' | 'right' | 'up';
const DELTA: Record<Dir, [number, number]> = { down: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1] };
const TILE = 16;
const STEP_MS = 180;

/** Mapa del mundo: movimiento por casillas, colisiones e encuentros en hierba alta. */
export class WorldScene extends Phaser.Scene {
  private map!: Phaser.Tilemaps.Tilemap;
  private layers: (Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer)[] = [];
  private player!: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private tileX = 0;
  private tileY = 0;
  private spawn = { x: 0, y: 0 };
  private facing: Dir = 'down';
  private moving = false;
  private busy = false;

  constructor() {
    super('World');
  }

  create(): void {
    this.map = this.make.tilemap({ key: 'pueblo' });
    const tiles = this.map.addTilesetImage('tiles', 'tiles')!;
    this.layers = ['Suelo', 'Obstaculos'].map((name) => this.map.createLayer(name, tiles)!);

    const start = this.map.findObject('Objetos', (o) => o.name === 'inicio');
    this.spawn = {
      x: Math.floor((start?.x ?? TILE) / TILE),
      y: Math.floor((start?.y ?? TILE) / TILE),
    };
    this.tileX = this.spawn.x;
    this.tileY = this.spawn.y;
    this.player = this.add.sprite(0, 0, 'player', 0).setDepth(10);
    this.placePlayer();

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    cam.startFollow(this.player, true);
    cam.roundPixels = true;

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasd = kb.addKeys('W,A,S,D') as WorldScene['wasd'];
    kb.on('keydown-Z', () => this.interact());
    kb.on('keydown-ENTER', () => this.interact());

    this.events.on(Phaser.Scenes.Events.RESUME, () => kb.resetKeys());

    this.say([
      '¡Bienvenido a Pokeprueba!',
      'Muévete con las flechas o WASD. Z o Enter para interactuar.',
      'Entra en la hierba alta para encontrar Pokémon salvajes. La puerta de la casa cura a tu equipo.',
    ]);
  }

  update(): void {
    if (this.moving || this.busy) return;
    const dir = this.heldDir();
    if (!dir) {
      this.player.anims.stop();
      this.player.setFrame(this.frameFor(this.facing));
      return;
    }
    this.facing = dir;
    const [dx, dy] = DELTA[dir];
    const nx = this.tileX + dx;
    const ny = this.tileY + dy;
    if (this.blocked(nx, ny)) {
      this.player.anims.stop();
      this.player.setFrame(this.frameFor(dir));
      return;
    }
    this.moving = true;
    this.player.anims.play(`walk-${dir}`, true);
    this.tileX = nx;
    this.tileY = ny;
    this.tweens.add({
      targets: this.player,
      x: nx * TILE + TILE / 2,
      y: ny * TILE + TILE / 2,
      duration: STEP_MS,
      onComplete: () => {
        this.moving = false;
        this.onStep();
      },
    });
  }

  private heldDir(): Dir | null {
    const c = this.cursors;
    if (c.left.isDown || this.wasd.A.isDown) return 'left';
    if (c.right.isDown || this.wasd.D.isDown) return 'right';
    if (c.up.isDown || this.wasd.W.isDown) return 'up';
    if (c.down.isDown || this.wasd.S.isDown) return 'down';
    return null;
  }

  private frameFor(dir: Dir): number {
    return ['down', 'left', 'right', 'up'].indexOf(dir) * 4;
  }

  private placePlayer(): void {
    this.player.setPosition(this.tileX * TILE + TILE / 2, this.tileY * TILE + TILE / 2);
  }

  /** Propiedad booleana de Tiled en cualquiera de las capas en esa casilla. */
  private tileHas(x: number, y: number, prop: string): boolean {
    return this.layers.some((l) => {
      const t = l.getTileAt(x, y);
      return !!t && !!(t.properties as Record<string, unknown>)[prop];
    });
  }

  private blocked(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return true;
    return this.tileHas(x, y, 'colisiona');
  }

  private onStep(): void {
    if (this.tileHas(this.tileX, this.tileY, 'hierba') && Math.random() < ENCOUNTER_RATE) {
      this.startWildBattle();
    }
  }

  private interact(): void {
    if (this.busy || this.moving) return;
    const [dx, dy] = DELTA[this.facing];
    const t = this.layers[1].getTileAt(this.tileX + dx, this.tileY + dy);
    // Tile "puerta" del tileset (id local 7).
    if (t && t.index - 1 === 7) {
      healParty();
      this.say(['Mamá: ¡Has vuelto! Descansa un poco...', 'Tu equipo se ha recuperado por completo.']);
    }
  }

  private say(lines: string[], onClose?: () => void): void {
    this.busy = true;
    this.player.anims.stop();
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

  private startWildBattle(): void {
    if (!partyCanFight()) return;
    this.busy = true;
    this.player.anims.stop();
    const cam = this.cameras.main;
    cam.flash(300, 255, 255, 255);
    this.time.delayedCall(350, () => {
      const data: BattleData = {
        foe: rollWildPokemon(),
        onEnd: (result) => this.afterBattle(result),
      };
      this.scene.pause();
      this.scene.launch('Battle', data);
    });
  }

  private afterBattle(result: 'win' | 'lose' | 'run'): void {
    this.scene.resume();
    this.busy = false;
    if (result === 'lose') {
      healParty();
      this.tileX = this.spawn.x;
      this.tileY = this.spawn.y;
      this.facing = 'down';
      this.placePlayer();
      this.say(['¡No te quedan Pokémon en condiciones de luchar!', 'Vuelves corriendo a casa y tu equipo se recupera.']);
    }
  }
}
