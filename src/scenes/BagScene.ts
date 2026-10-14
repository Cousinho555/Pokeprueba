import Phaser from 'phaser';
import { objetos } from '../data/essentials';
import { bag, BALLS } from '../data/party';
import { bindMenuKeys, itemIcon, lightText, textStyle, type SubScreenData } from '../ui';

/** Bolsillos de la mochila de Essentials v16, en el orden de items.txt. */
const POCKETS = ['Objetos', 'Medicinas', 'Poké Balls', 'MT y MO', 'Bayas', 'Cartas', 'Combate', 'Obj. clave'];
const KEY_ITEMS = 8;

// Posiciones de tools/draw_ui.py (escala GBA) pasadas a la pantalla (x2).
const PLATE = { x: 8, y: 8, w: 194, h: 36 };
const LIST = { x: 212, y: 8, w: 292, rowY: 20, rowH: 30, rows: 8 };
const ICON_BOX = { x: 48, y: 322 };
const DESC = { x: 90, y: 292, w: 400 };

interface Entry {
  id: string;
  name: string;
  qty: number;
  pocket: number;
  desc: string;
}

function pocketOf(id: string): number {
  return objetos[id]?.bolsillo ?? (BALLS[id] ? 3 : 1);
}

/** Mochila abierta: bolsillos a la izquierda, objetos a la derecha y descripción abajo. */
export class BagScene extends Phaser.Scene {
  private static pocket = 1;
  private static cursors: Record<number, number> = {};
  private data_!: SubScreenData;
  private entries: Entry[] = [];
  private cursor = 0;
  private first = 0;
  private bagImg!: Phaser.GameObjects.Image;
  private plate!: Phaser.GameObjects.Text;
  private dots!: Phaser.GameObjects.Graphics;
  private rowNames: Phaser.GameObjects.Text[] = [];
  private rowQty: Phaser.GameObjects.Text[] = [];
  private marker!: Phaser.GameObjects.Text;
  private up!: Phaser.GameObjects.Text;
  private down!: Phaser.GameObjects.Text;
  private icon!: Phaser.GameObjects.Image;
  private desc!: Phaser.GameObjects.Text;

  constructor() {
    super('Bag');
  }

  create(data: SubScreenData): void {
    this.data_ = data;
    this.rowNames = [];
    this.rowQty = [];
    this.add.image(0, 0, 'ui:bagbg').setOrigin(0).setScale(2);
    this.bagImg = this.add.image(32 + 72, 60 + 144, 'ui:bag').setOrigin(0.5, 1).setScale(2);

    // Nombre del bolsillo con flechas para cambiar
    this.plate = this.add.text(PLATE.x + PLATE.w / 2, PLATE.y + PLATE.h / 2, '', lightText(24)).setOrigin(0.5);
    const arrow = (x: number, ch: string, d: number) => {
      const a = this.add.text(x, PLATE.y + PLATE.h / 2, ch, lightText(18)).setOrigin(0.5).setInteractive({ useHandCursor: true });
      a.on('pointerdown', () => this.changePocket(d));
      this.tweens.add({ targets: a, x: x + 3 * d, yoyo: true, repeat: -1, duration: 350 });
    };
    arrow(PLATE.x + 14, '◀', -1);
    arrow(PLATE.x + PLATE.w - 14, '▶', 1);
    // Un punto por bolsillo debajo de la mochila (también se pueden pulsar)
    this.dots = this.add.graphics();
    POCKETS.forEach((_, k) => {
      this.add
        .zone(this.dotX(k), 238, 22, 22)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.setPocket(k + 1));
    });

    for (let r = 0; r < LIST.rows; r++) {
      const y = LIST.y + LIST.rowY + r * LIST.rowH;
      this.rowNames.push(this.add.text(LIST.x + 34, y, '', textStyle(24)).setOrigin(0, 0.5));
      this.rowQty.push(this.add.text(LIST.x + LIST.w - 22, y, '', textStyle(24)).setOrigin(1, 0.5));
      this.add
        .zone(LIST.x + 6, y - LIST.rowH / 2, LIST.w - 12, LIST.rowH)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(this.first + r))
        .on('pointerdown', () => {
          this.select(this.first + r);
          this.choose();
        });
    }
    this.marker = this.add.text(LIST.x + 12, 0, '▶', textStyle(20, '#e04040')).setOrigin(0, 0.5);
    this.up = this.add.text(LIST.x + LIST.w / 2, LIST.y + 4, '▲', textStyle(14, '#e04040')).setOrigin(0.5, 0);
    this.down = this.add.text(LIST.x + LIST.w / 2, LIST.y + 268, '▼', textStyle(14, '#e04040')).setOrigin(0.5, 1);
    this.tweens.add({ targets: this.down, y: this.down.y + 3, yoyo: true, repeat: -1, duration: 300 });

    this.icon = this.add.image(ICON_BOX.x, ICON_BOX.y, 'ui:items', 0).setScale(2);
    this.desc = this.add.text(DESC.x, DESC.y, '', { ...lightText(24), wordWrap: { width: DESC.w }, lineSpacing: 0 });

    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.select(this.cursor + Math.sign(dy)));
    bindMenuKeys(this, {
      up: () => this.select(this.cursor - 1),
      down: () => this.select(this.cursor + 1),
      left: () => this.changePocket(-1),
      right: () => this.changePocket(1),
      ok: () => this.choose(),
      back: () => this.close(),
    });
    this.setPocket(BagScene.pocket, true);
    // Se abre con un pequeño bote
    this.bagImg.setScale(2, 1.6);
    this.tweens.add({ targets: this.bagImg, scaleY: 2, duration: 220, ease: 'Back.easeOut' });
  }

  private dotX(k: number): number {
    return 104 + (k - (POCKETS.length - 1) / 2) * 22;
  }

  private changePocket(d: number): void {
    this.setPocket(((BagScene.pocket - 1 + d + POCKETS.length) % POCKETS.length) + 1);
  }

  private setPocket(p: number, first = false): void {
    if (p === BagScene.pocket && !first) return;
    if (!first) BagScene.cursors[BagScene.pocket] = this.cursor;
    BagScene.pocket = p;
    this.entries = Object.keys(bag)
      .filter((id) => pocketOf(id) === p && bag[id] > 0)
      .sort((a, b) => (objetos[a]?.id ?? 0) - (objetos[b]?.id ?? 0))
      .map((id) => ({
        id,
        name: objetos[id]?.nombre ?? BALLS[id]?.nombre ?? id,
        qty: bag[id],
        pocket: p,
        desc: objetos[id]?.descripcion ?? '',
      }));
    this.plate.setText(POCKETS[p - 1]);
    this.dots.clear();
    POCKETS.forEach((_, k) => {
      const on = k === p - 1;
      this.dots.fillStyle(0x803810).fillCircle(this.dotX(k), 238, on ? 7 : 5);
      this.dots.fillStyle(on ? 0xf8b058 : 0xd09050).fillCircle(this.dotX(k), 238, on ? 5 : 3);
    });
    if (!first) {
      // La mochila se sacude al cambiar de bolsillo
      this.tweens.killTweensOf(this.bagImg);
      this.bagImg.setAngle(0).setScale(2);
      this.tweens.add({ targets: this.bagImg, angle: { from: -6, to: 0 }, duration: 260, ease: 'Back.easeOut' });
    }
    this.first = 0;
    this.select(Math.min(BagScene.cursors[p] ?? 0, this.entries.length), true);
  }

  /** La última fila es "Cerrar mochila", como en Essentials. */
  private get count(): number {
    return this.entries.length + 1;
  }

  private select(k: number, force = false): void {
    k = Phaser.Math.Clamp(k, 0, this.count - 1);
    if (k === this.cursor && !force) return;
    this.cursor = k;
    if (k < this.first) this.first = k;
    if (k >= this.first + LIST.rows) this.first = k - LIST.rows + 1;
    for (let r = 0; r < LIST.rows; r++) {
      const i = this.first + r;
      const e = this.entries[i];
      this.rowNames[r].setText(e ? e.name : i === this.entries.length ? 'Cerrar mochila' : '');
      this.rowQty[r].setText(e && e.pocket !== KEY_ITEMS ? `x${e.qty}` : '');
    }
    this.marker.setY(LIST.y + LIST.rowY + (k - this.first) * LIST.rowH);
    this.up.setVisible(this.first > 0);
    this.down.setVisible(this.first + LIST.rows < this.count);
    const e = this.entries[k];
    if (e) {
      this.icon.setVisible(true).setFrame(itemIcon(e.id, e.pocket));
      this.tweens.killTweensOf(this.icon);
      this.icon.setScale(2.4);
      this.tweens.add({ targets: this.icon, scale: 2, duration: 140, ease: 'Back.easeOut' });
      this.desc.setText(e.desc || e.name);
    } else {
      this.icon.setVisible(false);
      this.desc.setText(this.entries.length ? 'Cierra la mochila y vuelve al menú.' : 'No llevas nada en este bolsillo.');
    }
  }

  private choose(): void {
    if (this.cursor === this.entries.length) this.close();
  }

  private close(): void {
    BagScene.cursors[BagScene.pocket] = this.cursor;
    this.scene.stop();
    this.data_.onClose();
  }
}
