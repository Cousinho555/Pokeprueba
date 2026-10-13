import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { BattleScene } from './scenes/BattleScene';
import { DialogScene } from './scenes/DialogScene';

// Misma resolución que Pokémon Essentials (RPG Maker XP).
export const GAME_WIDTH = 512;
export const GAME_HEIGHT = 384;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'juego',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  backgroundColor: '#000000',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene, BattleScene, DialogScene],
});
