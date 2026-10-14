import Phaser from 'phaser';
import { progress } from '../data/party';
import { sfx } from './BootScene';
import { bindMenuKeys, drawWindow, lightText, textStyle, type SubScreenData } from '../ui';
import type { DialogData } from './DialogScene';

export interface MenuData {
  onSave: () => void;
  onClose: () => void;
}

interface Option {
  label: string;
  /** Frame en menu_iconos.png. */
  icon: number;
  help: string;
  run: (m: MenuScene) => void;
}

const OPTIONS: Option[] = [
  { label: 'Pokédex', icon: 0, help: 'Los Pokémon que has registrado.', run: (m) => m.openScreen('Dex') },
  { label: 'Pokémon', icon: 1, help: 'Mira cómo está tu equipo.', run: (m) => m.openScreen('Party') },
  { label: 'Mochila', icon: 2, help: 'Los objetos que llevas encima.', run: (m) => m.openScreen('Bag') },
  { label: 'Monedero', icon: 3, help: 'El dinero que tienes.', run: (m) => m.toggleWallet() },
  { label: 'Guardar', icon: 4, help: 'Guarda la partida en este navegador.', run: (m) => m.save() },
  { label: 'Salir', icon: 5, help: 'Cierra el menú y vuelve a jugar.', run: (m) => m.close() },
];

/** Menú de pausa (Esc o X en el mapa), como el de Essentials. */
export class MenuScene extends Phaser.Scene {
  /** Se recuerda la última opción entre aperturas, como en Essentials. */
  private static last = 0;
  private data_!: MenuData;
  private cursor = 0;
  private icons: Phaser.GameObjects.Image[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private highlight!: Phaser.GameObjects.Graphics;
  private help!: Phaser.GameObjects.Text;
  private wallet?: Phaser.GameObjects.Container;
  private rows: { y: number; h: number; x: number; w: number } = { y: 0, h: 0, x: 0, w: 0 };

  constructor() {
    super('Menu');
  }

  create(data: MenuData): void {
    this.data_ = data;
    this.cursor = MenuScene.last;
    this.icons = [];
    this.labels = [];
    this.wallet = undefined;
    const { width, height } = this.scale;
    const rowH = 42;
    const w = 208;
    const h = OPTIONS.length * rowH + 16;
    const x = width - w - 6;
    const y = 6;
    this.rows = { x: x + 8, y: y + 8, w: w - 16, h: rowH };
    drawWindow(this.add.graphics(), x, y, w, h);
    this.highlight = this.add.graphics();
    OPTIONS.forEach((o, k) => {
      const ry = this.rows.y + k * rowH;
      this.icons.push(this.add.image(x + 30, ry + rowH / 2, 'ui:menu', o.icon).setScale(2));
      this.labels.push(this.add.text(x + 58, ry + rowH / 2, o.label, textStyle(26)).setOrigin(0, 0.5));
      this.add
        .zone(this.rows.x, ry, this.rows.w, rowH)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(k))
        .on('pointerdown', () => this.choose());
    });
    // Ayuda de la opción elegida, abajo, en el sitio de la caja de texto.
    const g = this.add.graphics();
    g.fillStyle(0x405890).fillRoundedRect(6, height - 60, width - 12, 54, 8).lineStyle(4, 0x182848).strokeRoundedRect(6, height - 60, width - 12, 54, 8);
    this.help = this.add.text(24, height - 33, '', lightText(24)).setOrigin(0, 0.5);

    bindMenuKeys(this, {
      up: () => this.select((this.cursor + OPTIONS.length - 1) % OPTIONS.length),
      down: () => this.select((this.cursor + 1) % OPTIONS.length),
      ok: () => (this.wallet ? this.toggleWallet() : this.choose()),
      back: () => (this.wallet ? this.toggleWallet() : this.close()),
    });
    this.select(this.cursor, true);
    sfx(this, 'menu', 0.6);
  }

  private select(k: number, force = false): void {
    if (k === this.cursor && !force) return;
    this.cursor = k;
    MenuScene.last = k;
    const { x, y, w, h } = this.rows;
    this.highlight.clear().fillStyle(0xd8e4f8).fillRoundedRect(x, y + k * h + 2, w, h - 4, 6).lineStyle(2, 0x8098d0).strokeRoundedRect(x, y + k * h + 2, w, h - 4, 6);
    this.icons.forEach((ic, i) => {
      this.tweens.killTweensOf(ic);
      ic.setY(y + i * h + h / 2);
      if (i === k) this.tweens.add({ targets: ic, y: ic.y - 3, yoyo: true, repeat: -1, duration: 260, ease: 'Sine.easeInOut' });
    });
    this.help.setText(OPTIONS[k].help);
  }

  private choose(): void {
    if (this.wallet) return;
    OPTIONS[this.cursor].run(this);
  }

  /** Abre una pantalla a pantalla completa (Mochila, Equipo, Pokédex) encima del menú. */
  openScreen(key: string): void {
    const data: SubScreenData = { onClose: () => this.scene.resume() };
    this.scene.pause();
    this.scene.launch(key, data);
  }

  toggleWallet(): void {
    if (this.wallet) {
      this.wallet.destroy();
      this.wallet = undefined;
      return;
    }
    const g = drawWindow(this.add.graphics(), 0, 0, 236, 96);
    this.wallet = this.add.container(6, 6, [
      g,
      this.add.image(34, 32, 'ui:menu', 3).setScale(2),
      this.add.text(62, 32, 'Monedero', textStyle(26)).setOrigin(0, 0.5),
      this.add.text(220, 70, `${progress.dinero.toLocaleString('es-ES')} ₽`, textStyle(28, '#3060c0')).setOrigin(1, 0.5),
    ]);
    this.wallet.setScale(0.9).setAlpha(0);
    this.tweens.add({ targets: this.wallet, scale: 1, alpha: 1, duration: 120, ease: 'Back.easeOut' });
  }

  save(): void {
    this.data_.onSave();
    const data: DialogData = { lines: ['Partida guardada.'], onClose: () => this.scene.resume() };
    this.scene.pause();
    this.scene.launch('Dialog', data);
  }

  close(): void {
    this.scene.stop();
    this.data_.onClose();
  }
}
