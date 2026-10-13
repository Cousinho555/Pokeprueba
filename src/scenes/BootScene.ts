import Phaser from 'phaser';
import { ESS, registerEssentials, type Especie, type Mundo } from '../data/essentials';
import { initParty } from '../data/party';
import { loadGame } from '../data/save';

/** Carga los datos de Essentials, la fuente y el jugador antes de entrar al mundo. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    const bar = this.add.rectangle(width / 2 - 100, height / 2, 0, 8, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2, 204, 12).setStrokeStyle(1, 0xffffff);
    this.load.on('progress', (v: number) => (bar.width = 200 * v));

    this.load.json('mundo', `${ESS}data/mundo.json`);
    this.load.json('especies', `${ESS}data/especies.json`);
    this.load.json('movimientos', `${ESS}data/movimientos.json`);
  }

  async create(): Promise<void> {
    const mundo = this.cache.json.get('mundo') as Mundo;
    registerEssentials(mundo, this.cache.json.get('especies') as Record<string, Especie>, this.cache.json.get('movimientos'));
    initParty();
    const saved = loadGame();

    try {
      const font = new FontFace('PokemonEmerald', `url(${ESS}fonts/pkmnem.ttf)`);
      (document.fonts as unknown as Set<FontFace>).add(await font.load());
    } catch {
      // Sin la fuente se usa monospace; el juego funciona igual.
    }

    if (saved && mundo.mapas[saved.mapId]) {
      this.scene.start('World', { ...saved, say: ['Partida cargada. Pulsa X para ver tu equipo.'] });
    } else {
      const { mapa, x, y, dir } = mundo.inicio;
      this.scene.start('World', { mapId: mapa, x, y, dir, say: ['¡Bienvenido! Pulsa X para ver tu equipo y tu mochila.'] });
    }
  }
}
