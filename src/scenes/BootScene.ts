import Phaser from 'phaser';
import { ESS, registerEssentials, type Especie, type InfoMapa, type Mundo } from '../data/essentials';
import { initParty, progress } from '../data/party';
import { loadGame } from '../data/save';
import { UI } from '../ui';

const SOUNDS = [
  'Battle ball drop', 'Battle ball hit', 'Battle ball shake', 'Battle catch click', 'Battle damage normal',
  'Battle damage super', 'Battle damage weak', 'Battle flee', 'Battle jump to ball', 'Battle recall',
  'Battle throw', 'Open Pokeball', 'Pokemon Healing', 'EvolutionSuccess', 'Jingle - HMTM', 'Pkmn exp gain',
  'Pkmn exp full', 'Pkmn faint', 'Player jump', 'Player bump', 'Door enter', 'Door exit',
];

/** Contenido propio de la historia: mapas extra y dónde empieza una partida nueva. */
interface Historia {
  inicio: { mapa: number; x: number; y: number; dir: number };
  /** Interruptor que se activa al terminar la introducción. */
  interruptor: number;
  mapas: Record<string, InfoMapa>;
}

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
    this.load.json('historia', 'assets/historia/historia.json');
    this.load.json('especies', `${ESS}data/especies.json`);
    this.load.json('movimientos', `${ESS}data/movimientos.json`);
    this.load.json('objetos', `${ESS}data/objetos.json`);
    // Sonidos de combate, del Centro Pokémon y de la evolución (los de los ataques se cargan al usarlos).
    for (const name of SOUNDS) this.load.audio(`sfx:${name}`, `${ESS}combate/${encodeURIComponent(name)}.ogg`);
    // Menú de pausa y mochila (pixel art propio, tools/draw_ui.py)
    this.load.spritesheet('ui:menu', `${UI}menu_iconos.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('ui:items', `${UI}objetos_iconos.png`, { frameWidth: 16, frameHeight: 16 });
    this.load.image('ui:bag', `${UI}mochila.png`);
    this.load.image('ui:bagbg', `${UI}mochila_fondo.png`);
    this.load.image('ui:partybg', `${UI}equipo_fondo.png`);
    this.load.image('ui:dexbg', `${UI}pokedex_fondo.png`);
    this.load.audio('sfx:menu', `${ESS}sonidos/SE/menu.ogg`);
    for (const ball of ['POKEBALL', 'GREATBALL', 'ULTRABALL']) {
      this.load.image(`ball:${ball}`, `${ESS}combate/${ball}.png`);
      this.load.image(`ballopen:${ball}`, `${ESS}combate/${ball}_open.png`);
    }
  }

  async create(): Promise<void> {
    const mundo = this.cache.json.get('mundo') as Mundo;
    // Mapas propios de la historia (no vienen de Essentials).
    const historia = this.cache.json.get('historia') as Historia | undefined;
    Object.assign(mundo.mapas, historia?.mapas ?? {});
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
      this.scene.start('World', { ...saved, say: ['Partida cargada. Pulsa Esc o X para abrir el menú.'] });
    } else if (historia && !progress.interruptores[historia.interruptor]) {
      // Partida nueva: empieza la escena de introducción.
      const { mapa, x, y, dir } = historia.inicio;
      this.scene.start('World', { mapId: mapa, x, y, dir, say: ['(Muévete con las flechas y habla con Z o Intro.)'] });
    } else {
      const { mapa, x, y, dir } = mundo.inicio;
      this.scene.start('World', { mapId: mapa, x, y, dir, say: ['¡Bienvenido! Pulsa Esc o X para abrir el menú: equipo, mochila, monedero...'] });
    }
  }
}
