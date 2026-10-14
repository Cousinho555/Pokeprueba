import { progress } from '../data/party';

/** Nombre del jugador mientras no haya pantalla para elegirlo. */
export const PLAYER_NAME = 'Rojo';

/**
 * Limpia los códigos de los mensajes de RPG Maker/Essentials: \PN es el nombre del
 * jugador, \v[n] el valor de una variable; los colores (\b, \r, \c[n]...) y las pausas se quitan.
 */
export function cleanText(t: string): string {
  t = t
    .replace(/\\\\/g, '\\')
    .replace(/\\[Pp][Nn]/g, PLAYER_NAME)
    .replace(/\\[Vv]\[(\d+)\]/g, (_, n) => String(progress.variables[Number(n)] ?? 0))
    .replace(/\\n/g, ' ')
    .replace(/\\[a-zA-Z]+\[[^\]]*\]/g, '')
    .replace(/\\[a-zA-Z.!|^<>]/g, '');
  return t.split(/\s+/).filter(Boolean).join(' ');
}
