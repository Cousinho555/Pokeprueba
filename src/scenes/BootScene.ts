import Phaser from 'phaser';
import { ESS, registerEssentials, type Especie, type Mundo } from '../data/essentials';
import { initParty } from '../data/party';
import { loadGame } from '../data/save';

const SOUNDS = [
  'Battle ball drop', 'Battle ball hit', 'Battle ball shake', 'Battle catch click', 'Battle damage normal',
  'Battle damage super', 'Battle damage weak', 'Battle flee', 'Battle jump to ball', 'Battle recall',
  'Battle throw', 'Open Pokeball', 'Pokemon Healing', 'EvolutionSuccess', 'Jingle - HMTM', 'Pkmn exp gain',
  'Pkmn exp full', 'Pkmn faint', 'Player jump', 'Player bump', 'Door enter', 'Door exit',
];

/** Reproduce un sonido de Essentials si está cargado. */
export function sfx(scene: Phaser.Scene, name: string, volume = 0.7): void {
  if (scene.cache.audio.exists(`sfx:${name}`)) scene.sound.play(`sfx:${name}`, { volume });
}

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
    this.load.json('objetos', `${ESS}data/objetos.json`);
    // Sonidos de combate, del Centro Pokémon y de la evolución (los de los ataques se cargan al usarlos).
    for (const name of SOUNDS) this.load.audio(`sfx:${name}`, `${ESS}combate/${encodeURIComponent(name)}.ogg`);
    for (const ball of ['POKEBALL', 'GREATBALL', 'ULTRABALL']) {
      this.load.image(`ball:${ball}`, `${ESS}combate/${ball}.png`);
      this.load.image(`ballopen:${ball}`, `${ESS}combate/${ball}_open.png`);
    }
  }

  async create(): Promise<void> {
    const mundo = this.cache.json.get('mundo') as Mundo;
    registerEssentials(mundo, this.cache.json.get('especies') as Record<string, Especie>, this.cache.json.get('movimientos'), this.cache.json.get('objetos'));
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
