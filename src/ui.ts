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
