import Phaser from 'phaser';
import { textStyle } from '../ui';

export interface DialogData {
  lines: string[];
  /** Opciones a elegir tras el último mensaje (como "Mostrar opciones" de RPG Maker). */
  choices?: string[];
  /** Opción que se elige al cancelar con X/Esc; sin ella, no se puede cancelar. */
  cancel?: number;
  /** Se llama al cerrar, con la opción elegida si había opciones. */
  onClose?: (choice: number) => void;
}

/** Caja de texto superpuesta (sin zoom de cámara). Avanza con Z/Enter/Espacio o clic. */
export class DialogScene extends Phaser.Scene {
  constructor() {
    super('Dialog');
  }

  create(data: DialogData): void {
    const { width, height } = this.scale;
    const box = this.add.graphics();
    box.fillStyle(0xf8f8f8).fillRoundedRect(6, height - 100, width - 12, 94, 8);
    box.lineStyle(4, 0x6070a0).strokeRoundedRect(6, height - 100, width - 12, 94, 8);
    const text = this.add.text(24, height - 88, '', { ...textStyle(26), wordWrap: { width: width - 48 }, lineSpacing: 2 });
    const arrow = this.add.text(width - 30, height - 32, '▼', textStyle(16, '#e04040'));
    this.tweens.add({ targets: arrow, y: arrow.y + 4, yoyo: true, repeat: -1, duration: 300 });

    // Partimos los mensajes largos en páginas de 2 líneas, como Essentials.
    const pages: string[] = [];
    for (const line of data.lines) {
      const wrapped = text.getWrappedText(line);
      for (let j = 0; j < wrapped.length; j += 2) pages.push(wrapped.slice(j, j + 2).join('\n'));
    }
    if (!pages.length) pages.push('');

    const choices = data.choices ?? [];
    let i = 0;
    let ready = false;
    let cursor = 0;
    let menu: {
      marker: Phaser.GameObjects.Text; top: number; labels: Phaser.GameObjects.Text[]; x: number;
      up: Phaser.GameObjects.Text; down: Phaser.GameObjects.Text;
    } | null = null;

    const close = (choice: number) => {
      this.scene.stop();
      data.onClose?.(choice);
    };
    // Las listas largas (tiendas) se desplazan: como mucho ROWS opciones a la vista.
    const ROWS = 7;
    const rowH = 30;
    let first = 0;
    const openMenu = () => {
      arrow.setVisible(false);
      const labels = choices.map((c) => this.add.text(0, 0, c, textStyle(26)).setDepth(1));
      const w = Math.max(...labels.map((l) => l.width)) + 56;
      const h = Math.min(ROWS, choices.length) * rowH + 20;
      const x = width - w - 6;
      const y = height - 104 - h;
      this.add.graphics().fillStyle(0xf8f8f8).fillRoundedRect(x, y, w, h, 8).lineStyle(4, 0x6070a0).strokeRoundedRect(x, y, w, h, 8);
      const marker = this.add.text(x + 14, y + 10, '▶', textStyle(22, '#484848')).setDepth(1);
      const up = this.add.text(x + w - 12, y + 6, '▲', textStyle(14, '#e04040')).setOrigin(0.5, 0).setDepth(1);
      const down = this.add.text(x + w - 12, y + h - 6, '▼', textStyle(14, '#e04040')).setOrigin(0.5, 1).setDepth(1);
      menu = { marker, top: y + 10, labels, x: x + 36, up, down };
      layout();
    };
    const layout = () => {
      if (!menu) return;
      if (cursor < first) first = cursor;
      if (cursor >= first + ROWS) first = cursor - ROWS + 1;
      menu.labels.forEach((l, k) => l.setPosition(menu!.x, menu!.top + (k - first) * rowH).setVisible(k >= first && k < first + ROWS));
      menu.marker.y = menu.top + (cursor - first) * rowH;
      menu.up.setVisible(first > 0);
      menu.down.setVisible(first + ROWS < choices.length);
    };
    const moveCursor = (d: number) => {
      if (!menu) return;
      cursor = (cursor + d + choices.length) % choices.length;
      layout();
    };
    const show = () => {
      text.setText(pages[i]);
      ready = false;
      this.time.delayedCall(120, () => (ready = true));
      if (i === pages.length - 1 && choices.length) openMenu();
    };
    const next = () => {
      if (!ready) return;
      if (menu) return close(cursor);
      i++;
      if (i < pages.length) return show();
      close(-1);
    };
    const cancel = () => {
      if (ready && menu && data.cancel != null && data.cancel >= 0) close(data.cancel);
    };
    show();
    const kb = this.input.keyboard!;
    ['Z', 'ENTER', 'SPACE'].forEach((k) => kb.on(`keydown-${k}`, next));
    ['X', 'ESC'].forEach((k) => kb.on(`keydown-${k}`, cancel));
    kb.on('keydown-UP', () => moveCursor(-1));
    kb.on('keydown-DOWN', () => moveCursor(1));
    kb.on('keydown-W', () => moveCursor(-1));
    kb.on('keydown-S', () => moveCursor(1));
    this.input.on('pointerdown', next);
  }
}
