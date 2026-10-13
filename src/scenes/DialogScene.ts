import Phaser from 'phaser';

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
    box.fillStyle(0xf8f8f8).fillRoundedRect(8, height - 88, width - 16, 80, 8);
    box.lineStyle(3, 0x404858).strokeRoundedRect(8, height - 88, width - 16, 80, 8);
    const text = this.add.text(24, height - 76, '', {
      fontFamily: 'monospace', fontSize: '18px', color: '#303030', wordWrap: { width: width - 48 },
    });

    let i = 0;
    const show = () => text.setText(data.lines[i]);
    const next = () => {
      i++;
      if (i < data.lines.length) return show();
      this.scene.stop();
      data.onClose?.();
    };
    show();
    const kb = this.input.keyboard!;
    ['Z', 'ENTER', 'SPACE'].forEach((k) => kb.on(`keydown-${k}`, next));
    this.input.on('pointerdown', next);
  }
}
