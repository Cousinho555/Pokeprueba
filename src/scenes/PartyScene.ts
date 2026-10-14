import Phaser from 'phaser';
import { ESS, moveName } from '../data/essentials';
import { MAX_PARTY, party } from '../data/party';
import { bindMenuKeys, lightText, type SubScreenData } from '../ui';

const SLOT = { w: 244, h: 98, x0: 8, x1: 260, y0: 8, dy: 104 };

/** Pantalla del equipo: los seis huecos con su sprite, nivel y PS. */
export class PartyScene extends Phaser.Scene {
  private data_!: SubScreenData;
  private cursor = 0;
  private frames!: Phaser.GameObjects.Graphics;
  private sprites: Phaser.GameObjects.Image[] = [];
  private help!: Phaser.GameObjects.Text;

  constructor() {
    super('Party');
  }

  preload(): void {
    for (const m of party) {
      const key = `front:${m.spec.num}`;
      if (!this.textures.exists(key)) this.load.image(key, `${ESS}battlers/front/${m.spec.num}.png`);
    }
  }

  create(data: SubScreenData): void {
    this.data_ = data;
    this.sprites = [];
    this.add.image(0, 0, 'ui:partybg').setOrigin(0).setScale(2);
    // El motor de combate (y con él los PS máximos) va en un trozo aparte que se carga al usarlo.
    void import('../battle/engine').then(({ maxHP }) => this.sys.isActive() && this.build(maxHP));
  }

  private build(maxHP: (spec: (typeof party)[number]['spec']) => number): void {
    this.cursor = Math.min(this.cursor, party.length - 1);
    this.frames = this.add.graphics();
    for (let k = 0; k < MAX_PARTY; k++) {
      const { x, y } = this.slot(k);
      const m = party[k];
      if (!m) continue;
      const max = maxHP(m.spec);
      const hp = m.hp ?? max;
      const sprite = this.add.image(x + 46, y + SLOT.h / 2, `front:${m.spec.num}`);
      this.sprites.push(sprite);
      this.add.text(x + 92, y + 10, m.spec.nombre, lightText(24));
      this.add.text(x + 92, y + 68, `Nv.${m.spec.nivel}`, lightText(22));
      const ratio = Phaser.Math.Clamp(hp / max, 0, 1);
      const bar = this.add.graphics();
      bar.fillStyle(0x303850).fillRoundedRect(x + 92, y + 50, 142, 12, 3);
      bar.fillStyle(0xf8f8f8).fillRect(x + 118, y + 53, 112, 6);
      bar.fillStyle(ratio > 0.5 ? 0x48d048 : ratio > 0.2 ? 0xf8c800 : 0xe03030).fillRect(x + 118, y + 53, Math.round(112 * ratio), 6);
      this.add.text(x + 96, y + 56, 'PS', lightText(14)).setOrigin(0, 0.5);
      this.add.text(x + SLOT.w - 10, y + 68, hp === 0 ? 'Debilitado' : `${hp}/${max}`, lightText(20)).setOrigin(1, 0);
      this.add
        .zone(x, y, SLOT.w, SLOT.h)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(k));
    }
    this.help = this.add.text(24, 351, '', { ...lightText(22), wordWrap: { width: 470 } }).setOrigin(0, 0.5);
    this.input.on('pointerdown', (_p: unknown, over: unknown[]) => over.length || this.close());

    const cols = (d: number) => this.select(Phaser.Math.Clamp(this.cursor + d, 0, party.length - 1));
    bindMenuKeys(this, {
      up: () => cols(-2),
      down: () => cols(2),
      left: () => cols(-1),
      right: () => cols(1),
      back: () => this.close(),
      ok: () => this.close(),
    });
    this.select(this.cursor, true);
  }

  private slot(k: number): { x: number; y: number } {
    return { x: k % 2 ? SLOT.x1 : SLOT.x0, y: SLOT.y0 + Math.floor(k / 2) * SLOT.dy };
  }

  private select(k: number, force = false): void {
    if (k === this.cursor && !force) return;
    this.cursor = k;
    const g = this.frames.clear();
    for (let i = 0; i < MAX_PARTY; i++) {
      const { x, y } = this.slot(i);
      const m = party[i];
      if (!m) {
        g.fillStyle(0x000000, 0.12).fillRoundedRect(x, y, SLOT.w, SLOT.h, 10);
        continue;
      }
      const on = i === k;
      const fill = m.hp === 0 ? (on ? 0xe08878 : 0xc06858) : on ? 0x78b0f0 : 0x5890d0;
      g.fillStyle(fill).fillRoundedRect(x, y, SLOT.w, SLOT.h, 10);
      g.lineStyle(on ? 6 : 4, on ? 0xf8d050 : 0x283868).strokeRoundedRect(x, y, SLOT.w, SLOT.h, 10);
    }
    this.sprites.forEach((s, i) => {
      this.tweens.killTweensOf(s);
      s.setY(this.slot(i).y + SLOT.h / 2);
      if (i === k) this.tweens.add({ targets: s, y: s.y - 4, yoyo: true, repeat: -1, duration: 220 });
    });
    const m = party[k];
    this.help.setText(m ? `Ataques: ${m.spec.movimientos.map(moveName).join(', ')}` : '');
  }

  private close(): void {
    this.scene.stop();
    this.data_.onClose();
  }
}
