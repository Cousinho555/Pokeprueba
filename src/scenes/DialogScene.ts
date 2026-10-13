import Phaser from 'phaser';
import { textStyle } from '../ui';

export interface DialogData {
  lines: string[];
  onClose?: () => void;
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

    let i = 0;
    let ready = false;
    const show = () => {
      text.setText(pages[i]);
      ready = false;
      this.time.delayedCall(120, () => (ready = true));
    };
    const next = () => {
      if (!ready) return;
      i++;
      if (i < pages.length) return show();
      this.scene.stop();
      data.onClose?.();
    };
    show();
    const kb = this.input.keyboard!;
    ['Z', 'ENTER', 'SPACE'].forEach((k) => kb.on(`keydown-${k}`, next));
    this.input.on('pointerdown', next);
  }
}
