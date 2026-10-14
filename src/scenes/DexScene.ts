import Phaser from 'phaser';
import { ESS, especies } from '../data/essentials';
import { party, pc } from '../data/party';
import { bindMenuKeys, drawWindow, lightText, textStyle, type SubScreenData } from '../ui';

const ROWS = 8;

const TIPOS: Record<string, string> = {
  NORMAL: 'Normal', FIRE: 'Fuego', WATER: 'Agua', GRASS: 'Planta', ELECTRIC: 'Eléctrico', ICE: 'Hielo',
  FIGHTING: 'Lucha', POISON: 'Veneno', GROUND: 'Tierra', FLYING: 'Volador', PSYCHIC: 'Psíquico', BUG: 'Bicho',
  ROCK: 'Roca', GHOST: 'Fantasma', DRAGON: 'Dragón', DARK: 'Siniestro', STEEL: 'Acero', FAIRY: 'Hada',
};
const ROW_H = 36;

/** Pokédex sencilla: las especies que has tenido en el equipo o en el PC. */
export class DexScene extends Phaser.Scene {
  private data_!: SubScreenData;
  private list: { num: number; nombre: string; tipos: string[] }[] = [];
  private cursor = 0;
  private first = 0;
  private rows: Phaser.GameObjects.Text[] = [];
  private marker!: Phaser.GameObjects.Text;
  private sprite!: Phaser.GameObjects.Image;
  private info!: Phaser.GameObjects.Text;

  constructor() {
    super('Dex');
  }

  preload(): void {
    const seen = new Map<number, { num: number; nombre: string; tipos: string[] }>();
    for (const m of [...party, ...pc]) {
      seen.set(m.spec.num, { num: m.spec.num, nombre: especies[m.spec.interno]?.nombre ?? m.spec.nombre, tipos: especies[m.spec.interno]?.tipos ?? [] });
    }
    this.list = [...seen.values()].sort((a, b) => a.num - b.num);
    for (const e of this.list) if (!this.textures.exists(`front:${e.num}`)) this.load.image(`front:${e.num}`, `${ESS}battlers/front/${e.num}.png`);
  }

  create(data: SubScreenData): void {
    this.data_ = data;
    this.rows = [];
    this.cursor = Math.min(this.cursor, this.list.length - 1);
    this.add.image(0, 0, 'ui:dexbg').setOrigin(0).setScale(2);
    drawWindow(this.add.graphics(), 10, 10, 196, 196);
    this.sprite = this.add.image(108, 108, `front:${this.list[0]?.num ?? 0}`);
    this.info = this.add.text(108, 262, '', { ...lightText(24), align: 'center' }).setOrigin(0.5);
    drawWindow(this.add.graphics(), 220, 10, 282, ROWS * ROW_H + 16);
    for (let r = 0; r < ROWS; r++) {
      const y = 18 + r * ROW_H + ROW_H / 2;
      this.rows.push(this.add.text(254, y, '', textStyle(24)).setOrigin(0, 0.5));
      this.add
        .zone(224, y - ROW_H / 2, 274, ROW_H)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(this.first + r));
    }
    this.marker = this.add.text(232, 0, '▶', textStyle(20, '#e04040')).setOrigin(0, 0.5);
    this.add.text(24, 351, `Pokédex  ·  Capturados: ${this.list.length}`, lightText(24)).setOrigin(0, 0.5);
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.select(this.cursor + Math.sign(dy)));
    bindMenuKeys(this, {
      up: () => this.select(this.cursor - 1),
      down: () => this.select(this.cursor + 1),
      back: () => this.close(),
      ok: () => this.close(),
    });
    this.select(this.cursor, true);
  }

  private select(k: number, force = false): void {
    k = Phaser.Math.Clamp(k, 0, this.list.length - 1);
    if (k === this.cursor && !force) return;
    this.cursor = k;
    if (k < this.first) this.first = k;
    if (k >= this.first + ROWS) this.first = k - ROWS + 1;
    this.rows.forEach((t, r) => {
      const e = this.list[this.first + r];
      t.setText(e ? `${String(e.num).padStart(3, '0')}  ${e.nombre}` : '');
    });
    this.marker.setY(18 + (k - this.first) * ROW_H + ROW_H / 2);
    const e = this.list[k];
    if (!e) return;
    this.sprite.setTexture(`front:${e.num}`).setScale(2);
    this.info.setText(`Nº ${String(e.num).padStart(3, '0')} ${e.nombre}\n${e.tipos.map((t) => TIPOS[t] ?? t).join(' / ')}`);
  }

  private close(): void {
    this.scene.stop();
    this.data_.onClose();
  }
}
