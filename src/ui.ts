import Phaser from 'phaser';

/** Estilo de texto común, con la fuente de Essentials (pkmnem). */
export const FONT_FAMILY = 'PokemonEmerald, monospace';

export function textStyle(size = 26, color = '#484848'): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color,
    shadow: { offsetX: 2, offsetY: 2, color: '#d0d0c8', fill: true },
  };
}

/** Texto claro sobre fondo oscuro. */
export function lightText(size = 26): Phaser.Types.GameObjects.Text.TextStyle {
  return { ...textStyle(size, '#f8f8f8'), shadow: { offsetX: 2, offsetY: 2, color: '#303850', fill: true } };
}

/** Pixel art propio del menú (tools/draw_ui.py), a escala GBA: se dibuja a x2. */
export const UI = 'assets/ui/';

/** Orden de los iconos en objetos_iconos.png (igual que en tools/draw_ui.py). */
const ITEM_ICONS = [
  'bolsillo1', 'bolsillo2', 'bolsillo3', 'bolsillo4', 'bolsillo5', 'bolsillo6', 'bolsillo7', 'bolsillo8',
  'POKEBALL', 'GREATBALL', 'ULTRABALL',
];

/** Frame del icono de un objeto: el suyo si lo hay, si no el genérico de su bolsillo. */
export function itemIcon(id: string, pocket: number): number {
  const own = ITEM_ICONS.indexOf(id);
  return own >= 0 ? own : Math.max(0, ITEM_ICONS.indexOf(`bolsillo${pocket}`));
}

/** Ventana blanca con borde azul, como la caja de texto. */
export function drawWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  return g.fillStyle(0xf8f8f8).fillRoundedRect(x, y, w, h, 8).lineStyle(4, 0x6070a0).strokeRoundedRect(x, y, w, h, 8);
}

export interface MenuKeys {
  up?: () => void;
  down?: () => void;
  left?: () => void;
  right?: () => void;
  ok?: () => void;
  back?: () => void;
}

/**
 * Teclas de los menús: flechas/WASD para moverse, Z/Enter/Espacio para aceptar y X/Esc
 * para volver. Se ignoran un momento al abrir o reanudar la escena, para que la tecla
 * que cerró otra pantalla no actúe también en esta.
 */
export function bindMenuKeys(scene: Phaser.Scene, keys: MenuKeys): void {
  const kb = scene.input.keyboard!;
  let since = scene.game.loop.time;
  scene.events.on(Phaser.Scenes.Events.RESUME, () => (since = scene.game.loop.time));
  const on = (names: string[], fn?: () => void) => {
    if (!fn) return;
    for (const n of names) kb.on(`keydown-${n}`, () => scene.game.loop.time - since >= 120 && fn());
  };
  on(['UP', 'W'], keys.up);
  on(['DOWN', 'S'], keys.down);
  on(['LEFT', 'A'], keys.left);
  on(['RIGHT', 'D'], keys.right);
  on(['Z', 'ENTER', 'SPACE'], keys.ok);
  on(['X', 'ESC'], keys.back);
}

/** Lo que reciben las pantallas que se abren desde el menú de pausa. */
export interface SubScreenData {
  onClose: () => void;
}
