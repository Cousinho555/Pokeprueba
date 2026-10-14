import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import { BattleScene } from './scenes/BattleScene';
import { DialogScene } from './scenes/DialogScene';
import { MenuScene } from './scenes/MenuScene';
import { BagScene } from './scenes/BagScene';
import { PartyScene } from './scenes/PartyScene';
import { DexScene } from './scenes/DexScene';

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
  // El orden es el de dibujado: los diálogos van encima del menú.
  scene: [BootScene, WorldScene, BattleScene, MenuScene, BagScene, PartyScene, DexScene, DialogScene],
});
