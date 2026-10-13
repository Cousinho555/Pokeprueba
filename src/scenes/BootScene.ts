import Phaser from 'phaser';

/** Carga los recursos comunes y crea las animaciones antes de entrar al mundo. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 100, height / 2, 0, 8, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 204, 12).setStrokeStyle(1, 0xffffff);
    this.load.on('progress', (v: number) => (bar.width = 200 * v));

    this.load.image('tiles', 'assets/tilesets/tiles.png');
    this.load.tilemapTiledJSON('pueblo', 'assets/maps/pueblo.tmj');
    this.load.spritesheet('player', 'assets/sprites/player.png', { frameWidth: 16, frameHeight: 16 });
  }

  create(): void {
    const dirs = ['down', 'left', 'right', 'up'];
    dirs.forEach((dir, row) => {
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers('player', { start: row * 4, end: row * 4 + 3 }),
        frameRate: 8,
        repeat: -1,
      });
    });
    this.scene.start('World');
  }
}
