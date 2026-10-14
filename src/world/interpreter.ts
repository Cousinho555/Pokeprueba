import { makePokemon, objetos, type Entrenador } from '../data/essentials';
import { addCaught, addItem, bag, healParty, party, progress } from '../data/party';
import type { BattleResult } from '../scenes/BattleScene';
import { Character, isDir, REVERSE, type CharacterHost, type Dir } from './character';
import { cleanText } from './text';

/** Comando de evento tal como lo exporta el importador: [código, sangría, ...parámetros]. */
export type Cmd = [number, number, ...unknown[]];

export interface Ruta {
  repite: boolean;
  salta: boolean;
  lista: [number, unknown[]][];
}

interface Audio {
  nombre: string;
  volumen: number;
}

/** Página de un evento de RPG Maker. */
export interface Pagina {
  cond: { s1?: number; s2?: number; v?: [number, number]; ss?: string };
  grafico: string;
  dir: number;
  patron: number;
  tile: number;
  opacidad: number;
  /** 0 botón de acción, 1 contacto del jugador, 2 contacto del evento, 3 automático, 4 proceso paralelo. */
  disparo: number;
  atraviesa: boolean;
  fijo: boolean;
  anda: boolean;
  paso: boolean;
  encima: boolean;
  /** 0 fijo, 1 aleatorio, 2 hacia el jugador, 3 ruta personalizada. */
  mov: number;
  vel: number;
  frec: number;
  ruta: Ruta | null;
  lista: Cmd[];
}

/** Lo que el intérprete necesita del mapa (lo implementa WorldScene). */
export interface EventHost extends CharacterHost {
  mapId: number;
  player: Character;
  /** -1 = jugador, 0 = el propio evento, n = evento n del mapa. */
  character(id: number, self: number): Character | undefined;
  /** Interruptores locales temporales (setTempSwitchOn), que se olvidan al salir del mapa. */
  temp: Record<string, boolean>;
  message(text: string, choices?: string[], cancel?: number): Promise<number>;
  wait(ms: number): Promise<void>;
  transfer(map: number, x: number, y: number, dir: number, fade: boolean): void;
  battle(t: Entrenador): Promise<BattleResult>;
  refreshPages(): void;
  erase(id: number): void;
  playSound(folder: 'SE' | 'ME', name: string, volume?: number): void;
  tone(tone: number[], ms: number): void;
  flash(color: number[], ms: number): void;
  shake(power: number, ms: number): void;
  /** Muestra el "!" sobre un personaje. */
  exclaim(ch: Character): Promise<void>;
  setRespawn(): void;
  shop(items: string[]): Promise<void>;
  openPC(): Promise<void>;
  gameOver(): void;
}

/** RPG Maker XP (y Essentials) van a 40 fotogramas por segundo. */
export const FRAME_MS = 25;

const selfKey = (map: number, ev: number, ch: string) => `${map}:${ev}:${ch}`;

const itemName = (id: string) => objetos?.[id]?.nombre ?? id;
const itemById = (n: number) => Object.keys(objetos ?? {}).find((k) => objetos[k].id === n);

/** Avisos únicos de scripts que todavía no se entienden, para ir ampliando el intérprete. */
const warned = new Set<string>();
function unknown(kind: string, what: string): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.info(`[eventos] ${kind} sin soporte: ${what}`);
}

/**
 * Intérprete de eventos de RPG Maker XP: ejecuta la lista de comandos de una página
 * (mensajes, opciones, condiciones, interruptores, rutas de movimiento...) y los scripts
 * más habituales de Essentials (combates, objetos, Pokémon, tiendas).
 */
export class Interpreter {
  private stopped = false;
  private routes: Promise<void>[] = [];

  constructor(
    private host: EventHost,
    /** Evento que se está ejecutando (0 si es un evento común o del sistema). */
    private eventId: number,
  ) {}

  stop(): void {
    this.stopped = true;
  }

  get self(): Character | undefined {
    return this.host.character(0, this.eventId);
  }

  async run(list: Cmd[]): Promise<void> {
    let i = 0;
    let guard = 0;
    while (i < list.length && !this.stopped) {
      const [code, indent, ...p] = list[i];
      // Seguridad: cede un fotograma de vez en cuando para no congelar el juego en bucles.
      if (++guard % 200 === 0) await this.host.wait(FRAME_MS);
      const next = await this.exec(list, i, code, indent, p);
      if (next === null) return;
      i = next;
    }
    if (this.routes.length) await Promise.all(this.routes);
  }

  /** Índice del siguiente comando con la misma sangría y uno de esos códigos. */
  private find(list: Cmd[], from: number, indent: number, codes: number[]): number {
    for (let j = from + 1; j < list.length; j++) {
      if (list[j][1] === indent && codes.includes(list[j][0])) return j;
      if (list[j][1] < indent) return j - 1;
    }
    return list.length;
  }

  /** Ejecuta el comando i y devuelve el índice del siguiente (null = terminar). */
  private async exec(list: Cmd[], i: number, code: number, indent: number, p: unknown[]): Promise<number | null> {
    const h = this.host;
    switch (code) {
      case 101: {
        // Mensaje: las líneas 401 siguientes son su continuación.
        let text = String(p[0]);
        let j = i + 1;
        while (list[j]?.[0] === 401) text += ' ' + String(list[j++][2]);
        if (list[j]?.[0] === 102) return this.choices(list, j, cleanText(text));
        await h.message(cleanText(text));
        return j;
      }
      case 102:
        return this.choices(list, i, '');
      case 402:
      case 403:
        // Fin de la rama elegida: salta al final de las opciones.
        return this.find(list, i, indent, [404]) + 1;
      case 106:
        await h.wait(Number(p[0]) * FRAME_MS);
        return i + 1;
      case 111: {
        const ok = await this.condition(p, list[i]);
        if (this.stopped) return null;
        if (ok) return i + 1;
        return this.find(list, i, indent, [411, 412]) + 1;
      }
      case 411:
        return this.find(list, i, indent, [412]) + 1;
      case 413: {
        // Repetir: vuelve al comando "Bucle" correspondiente.
        for (let j = i - 1; j >= 0; j--) if (list[j][0] === 112 && list[j][1] === indent) return j + 1;
        return i + 1;
      }
      case 113: {
        for (let j = i + 1; j < list.length; j++) if (list[j][0] === 413 && list[j][1] < indent) return j + 1;
        return list.length;
      }
      case 115:
        return null;
      case 116:
        h.erase(this.eventId);
        return i + 1;
      case 119: {
        const j = list.findIndex((c) => c[0] === 118 && c[2] === p[0]);
        return j >= 0 ? j + 1 : i + 1;
      }
      case 121: {
        const [a, b, off] = p as number[];
        for (let n = a; n <= b; n++) progress.interruptores[n] = off === 0;
        h.refreshPages();
        return i + 1;
      }
      case 122:
        this.controlVariables(p as number[]);
        h.refreshPages();
        return i + 1;
      case 123: {
        progress.locales[selfKey(h.mapId, this.eventId, String(p[0]))] = p[1] === 0;
        h.refreshPages();
        return i + 1;
      }
      case 125: {
        const [op, type, value] = p as number[];
        const n = type === 0 ? value : (progress.variables[value] ?? 0);
        progress.dinero = Math.max(0, progress.dinero + (op === 0 ? n : -n));
        return i + 1;
      }
      case 126: {
        const [id, op, type, value] = p as number[];
        const item = itemById(id);
        const n = type === 0 ? value : (progress.variables[value] ?? 0);
        if (item) addItem(item, op === 0 ? n : -n);
        return i + 1;
      }
      case 201: {
        const [byVar, map, x, y, dir, fade] = p as number[];
        const v = (n: number) => (byVar ? (progress.variables[n] ?? 0) : n);
        h.transfer(v(map), v(x), v(y), dir, fade === 0);
        return null;
      }
      case 202: {
        const [id, type, x, y, dir] = p as number[];
        const ch = h.character(id, this.eventId);
        if (ch && type === 0) {
          ch.x = x;
          ch.y = y;
          if (isDir(dir)) ch.turn(dir);
          ch.place();
        }
        return i + 1;
      }
      case 208:
        h.player.transparent = p[0] === 0;
        h.player.refreshFrame();
        return i + 1;
      case 209: {
        const ch = h.character(Number(p[0]), this.eventId);
        if (ch) this.routes.push(runRoute(h, ch, p[1] as Ruta));
        return i + 1;
      }
      case 210:
        await Promise.all(this.routes);
        this.routes = [];
        return i + 1;
      case 223:
        h.tone(p[0] as number[], Number(p[1]) * FRAME_MS);
        return i + 1;
      case 224:
        h.flash(p[0] as number[], Number(p[1]) * FRAME_MS);
        return i + 1;
      case 225:
        h.shake(Number(p[0]), Number(p[2]) * FRAME_MS);
        return i + 1;
      case 249:
      case 250: {
        const a = p[0] as Audio;
        if (a?.nombre) h.playSound(code === 249 ? 'ME' : 'SE', a.nombre, a.volumen / 100);
        return i + 1;
      }
      case 314:
        healParty();
        return i + 1;
      case 354:
        h.gameOver();
        return null;
      case 355: {
        await this.script(String(p[0]), p[1] as Entrenador | undefined);
        return this.stopped ? null : i + 1;
      }
      case 0: case 108: case 112: case 118: case 404: case 412: case 401: case 655:
        return i + 1;
      default:
        // Música, imágenes, transiciones... se irán añadiendo.
        unknown('Comando', String(code));
        return i + 1;
    }
  }

  private async choices(list: Cmd[], i: number, text: string): Promise<number> {
    const [options, cancelType] = list[i].slice(2) as [string[], number];
    const indent = list[i][1];
    // Cancelar: 0 no se puede, 1-4 elige esa opción, 5 rama propia ("Cuando se cancela").
    const cancel = cancelType === 0 ? -1 : cancelType === 5 ? 4 : cancelType - 1;
    const r = await this.host.message(text, options.map(cleanText), cancel);
    for (let j = i + 1; j < list.length; j++) {
      const c = list[j];
      if (c[1] < indent) break;
      if (c[1] !== indent) continue;
      if ((c[0] === 402 && c[2] === r) || (c[0] === 403 && r === 4)) return j + 1;
      if (c[0] === 404) return j + 1;
    }
    return list.length;
  }

  private controlVariables([a, b, op, type, p1, p2]: number[]): void {
    const h = this.host;
    let value = 0;
    switch (type) {
      case 0: value = p1; break;
      case 1: value = progress.variables[p1] ?? 0; break;
      case 2: value = p1 + Math.floor(Math.random() * (p2 - p1 + 1)); break;
      case 3: value = bag[itemById(p1) ?? ''] ?? 0; break;
      case 6: {
        const ch = h.character(p1, this.eventId);
        value = ch ? [ch.x, ch.y, ch.dir, ch.x * 32, ch.y * 32, 0][p2] ?? 0 : 0;
        break;
      }
      case 7: value = [h.mapId, party.length, progress.dinero, 0, 0, 0, 0][p1] ?? 0; break;
    }
    for (let n = a; n <= b; n++) {
      const cur = progress.variables[n] ?? 0;
      const ops = [value, cur + value, cur - value, cur * value, value ? Math.trunc(cur / value) : cur, value ? cur % value : cur];
      progress.variables[n] = ops[op] ?? value;
    }
  }

  private async condition(p: unknown[], cmd: Cmd): Promise<boolean> {
    const h = this.host;
    const n = (k: number) => Number(p[k]);
    switch (n(0)) {
      case 0: return !!progress.interruptores[n(1)] === (n(2) === 0);
      case 1: {
        const a = progress.variables[n(1)] ?? 0;
        const b = n(2) === 0 ? n(3) : (progress.variables[n(3)] ?? 0);
        return [a === b, a >= b, a <= b, a > b, a < b, a !== b][n(4)] ?? false;
      }
      case 2: return this.selfSwitch(String(p[1])) === (n(2) === 0);
      case 6: return h.character(n(1), this.eventId)?.dir === n(2);
      case 7: return n(2) === 0 ? progress.dinero >= n(1) : progress.dinero <= n(1);
      case 8: return (bag[itemById(n(1)) ?? ''] ?? 0) > 0;
      case 12: return !!(await this.script(String(p[1]), cmd[4] as Entrenador | undefined));
      default:
        unknown('Condición', String(p[0]));
        return false;
    }
  }

  private selfSwitch(ch: string): boolean {
    const key = selfKey(this.host.mapId, this.eventId, ch);
    return !!(progress.locales[key] || this.host.temp[key]);
  }

  // ------------------------------------------------------------- scripts de Essentials

  /** Ejecuta un script de Ruby de los eventos. Solo entiende los usos habituales de Essentials. */
  private async script(code: string, trainer?: Entrenador): Promise<unknown> {
    const h = this.host;
    let m: RegExpMatchArray | null;
    const s = code.trim();
    const sym = String.raw`(?::|PBItems::|PBSpecies::)(\w+)`;
    const str = String.raw`(?:_I\()?"((?:[^"\\]|\\.)*)"\)?`;

    if (trainer && /pbTrainerBattle\(|customTrainerBattle\(/.test(s)) {
      const r = await h.battle(trainer);
      if (r === 'lose') this.stop();
      return r === 'win';
    }
    if ((m = s.match(new RegExp(String.raw`pbItemBall\(${sym}(?:,\s*(\d+))?`)))) {
      const n = Number(m[2] ?? 1);
      addItem(m[1], n);
      h.playSound('ME', 'Jingle - HMTM');
      await h.message(`¡Has encontrado ${n > 1 ? `${n} ` : ''}${itemName(m[1])}!`);
      await h.message(`Has guardado ${itemName(m[1])} en la Mochila.`);
      return true;
    }
    if ((m = s.match(new RegExp(String.raw`pbReceiveItem\(${sym}(?:,\s*(\d+))?`)))) {
      const n = Number(m[2] ?? 1);
      addItem(m[1], n);
      await h.message(`¡Has obtenido ${n > 1 ? `${n} ` : ''}${itemName(m[1])}!`);
      return true;
    }
    if ((m = s.match(new RegExp(String.raw`pbAddPokemon(?:Silent)?\(${sym},\s*(\d+)`)))) {
      const spec = makePokemon(m[1], Number(m[2]));
      const where = addCaught({ spec, hp: null });
      await h.message(`¡Has recibido a ${spec.nombre}!`);
      if (where === 'pc') await h.message(`${spec.nombre} ha sido enviado al PC.`);
      return true;
    }
    if ((m = s.match(new RegExp(String.raw`pbConfirmMessage\(${str}`)))) {
      return (await h.message(cleanText(m[1].replace(/\\"/g, '"')), ['Sí', 'No'], 1)) === 0;
    }
    if ((m = s.match(new RegExp(String.raw`^(?:Kernel\.)?pbMessage\(${str}`)))) {
      await h.message(cleanText(m[1].replace(/\\"/g, '"')));
      return true;
    }
    if ((m = s.match(/pbPokemonMart\(\[([^\]]*)\]/))) {
      await h.shop([...m[1].matchAll(/(?::|PBItems::)(\w+)/g)].map((x) => x[1]));
      return true;
    }
    if (/pbPokeCenterPC|pbTrainerPC/.test(s)) {
      await h.openPC();
      return true;
    }
    if ((m = s.match(/pbNoticePlayer\(get_character\((-?\d+)\)\)/))) {
      const ch = h.character(Number(m[1]), this.eventId);
      if (ch) await notice(h, ch);
      return true;
    }
    if (/pbSetPokemonCenter/.test(s)) {
      h.setRespawn();
      return true;
    }
    if (/pbEraseThisEvent/.test(s)) {
      h.erase(this.eventId);
      return true;
    }
    if ((m = s.match(/pbSEPlay\("([^"]+)"(?:,\s*(\d+))?/))) {
      h.playSound('SE', m[1], m[2] ? Number(m[2]) / 100 : 0.8);
      return true;
    }
    if ((m = s.match(/pbMEPlay\("([^"]+)"/))) {
      h.playSound('ME', m[1]);
      return true;
    }
    if ((m = s.match(/pbWait\((\d+)\)/))) {
      await h.wait(Number(m[1]) * FRAME_MS);
      return true;
    }
    if ((m = s.match(/setTempSwitch(On|Off)\("(\w)"\)/))) {
      h.temp[selfKey(h.mapId, this.eventId, m[2])] = m[1] === 'On';
      h.refreshPages();
      return true;
    }
    if ((m = s.match(/pbSetSelfSwitch\((\d+|@event_id),\s*"(\w)",\s*(true|false)/))) {
      const id = m[1] === '@event_id' ? this.eventId : Number(m[1]);
      progress.locales[selfKey(h.mapId, id, m[2])] = m[3] === 'true';
      h.refreshPages();
      return true;
    }
    if ((m = s.match(/^pbSet\((\d+),\s*(.+)\)$/))) {
      const v = evaluate(m[2], h);
      progress.variables[Number(m[1])] = typeof v === 'boolean' ? Number(v) : Number(v) || 0;
      h.refreshPages();
      return true;
    }
    if ((m = s.match(/^\$game_(switches|variables)\[(\d+)\]\s*=\s*(.+)$/))) {
      const v = evaluate(m[3], h);
      if (m[1] === 'switches') progress.interruptores[Number(m[2])] = !!v;
      else progress.variables[Number(m[2])] = Number(v) || 0;
      h.refreshPages();
      return true;
    }
    // Scripts de varias líneas: cada línea por separado; el valor es el de la última.
    if (s.includes('\n')) {
      let last: unknown = true;
      for (const line of s.split('\n')) if (line.trim()) last = await this.script(line, trainer);
      return last;
    }
    // Expresiones de condición: interruptores, variables, dinero, equipo, mochila...
    const v = evaluate(s, h);
    if (v !== undefined) return v;
    // Scripts que no cambian nada visible aquí (música de entrenador, teléfono, etc.).
    if (/^(pbTrainerIntro|pbTrainerEnd|Kernel\.pbTrainerCheck|pbTrainerCheck|pbPhone|pbRecordLastBattle|pbBGM|pbBGS|pbCaveEntrance|pbCaveExit|pbSetEventTime|pbToneChangeAll|pbBridge|pbHiddenMoveAnimation|end$|else$)/.test(s)) {
      return false;
    }
    unknown('Script', s.slice(0, 80));
    return false;
  }
}

/**
 * Evalúa una expresión sencilla de Ruby (condiciones de eventos): sustituye lo que el
 * juego conoce por su valor y solo calcula si lo que queda son números y operadores.
 */
function evaluate(expr: string, h: EventHost): unknown {
  const count = (id: string) => bag[id] ?? 0;
  let e = expr
    .replace(/\$game_switches\[(\d+)\]/g, (_, n) => String(!!progress.interruptores[Number(n)]))
    .replace(/(?:\$game_variables\[(\d+)\]|pbGet\((\d+)\))/g, (_, a, b) => String(progress.variables[Number(a ?? b)] ?? 0))
    .replace(/\$Trainer\.(?:party\.length|pokemonCount|pokemonParty\.length|ablePokemonCount)/g, String(party.length))
    .replace(/\$Trainer\.money/g, String(progress.dinero))
    .replace(/\$PokemonBag\.pbQuantity\((?::|PBItems::)(\w+)\)/g, (_, id) => String(count(id)))
    .replace(/\$PokemonBag\.pbHasItem\?\((?::|PBItems::)(\w+)\)/g, (_, id) => String(count(id) > 0))
    .replace(/\$game_player\.direction/g, String(h.player.dir))
    .replace(/\$game_player\.x/g, String(h.player.x))
    .replace(/\$game_player\.y/g, String(h.player.y))
    .replace(/\$game_map\.map_id/g, String(h.mapId))
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\b/g, '!')
    .trim();
  if (!e || !/^[\d\s()<>=!&|+\-*/%.]*(?:(?:true|false)[\d\s()<>=!&|+\-*/%.]*)*$/.test(e)) return undefined;
  try {
    return new Function(`return (${e});`)();
  } catch {
    return undefined;
  }
}

/** pbNoticePlayer: "!" sobre el evento, que se acerca hasta ponerse al lado del jugador. */
async function notice(h: EventHost, ch: Character): Promise<void> {
  await h.exclaim(ch);
  const p = h.player;
  for (let k = 0; k < 20; k++) {
    const dx = p.x - ch.x;
    const dy = p.y - ch.y;
    if (Math.abs(dx) + Math.abs(dy) <= 1) break;
    const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
    if (!(await ch.step(dir))) break;
  }
  ch.turnToward(p.x, p.y);
  p.turnToward(ch.x, ch.y);
}

const RIGHT: Record<Dir, Dir> = { 2: 4, 4: 8, 6: 2, 8: 6 };
const LEFT: Record<Dir, Dir> = { 2: 6, 4: 2, 6: 8, 8: 4 };
const randomDir = (): Dir => ([2, 4, 6, 8] as Dir[])[Math.floor(Math.random() * 4)];

/** Dirección de `ch` hacia el jugador (o la contraria). */
function towardPlayer(h: EventHost, ch: Character, away = false): Dir {
  const dx = h.player.x - ch.x;
  const dy = h.player.y - ch.y;
  const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 6 : 4) : dy > 0 ? 2 : 8;
  return away ? REVERSE[d] : d;
}

/**
 * Ejecuta una ruta de movimiento (comando 209 o movimiento personalizado de una página).
 * Si se le asigna otra ruta al personaje, esta se abandona.
 */
export async function runRoute(h: EventHost, ch: Character, route: Ruta): Promise<void> {
  const id = ++ch.routeId;
  do {
    for (const [code, p] of route.lista) {
      if (ch.routeId !== id) return;
      const dir = ([0, 2, 4, 6, 8][code] ?? 0) as Dir;
      const tryStep = async (d: Dir) => {
        // Si no se puede pasar y la ruta no permite saltarse el paso, se espera a que se pueda.
        for (let tries = 0; tries < 40; tries++) {
          if (await ch.step(d)) return;
          if (route.salta || ch.routeId !== id) return;
          await h.wait(100);
        }
      };
      switch (code) {
        case 1: case 2: case 3: case 4: await tryStep(dir); break;
        case 9: await ch.step(randomDir()); break;
        case 10: await tryStep(towardPlayer(h, ch)); break;
        case 11: await tryStep(towardPlayer(h, ch, true)); break;
        case 12: await tryStep(ch.dir); break;
        case 13: {
          const fixed = ch.fixDir;
          ch.fixDir = true;
          await ch.step(REVERSE[ch.dir]);
          ch.fixDir = fixed;
          break;
        }
        case 14: await ch.jump(Number(p[0]), Number(p[1])); break;
        case 15: await h.wait(Number(p[0]) * FRAME_MS); break;
        case 16: ch.turn(2); break;
        case 17: ch.turn(4); break;
        case 18: ch.turn(6); break;
        case 19: ch.turn(8); break;
        case 20: ch.turn(RIGHT[ch.dir]); break;
        case 21: ch.turn(LEFT[ch.dir]); break;
        case 22: ch.turn(REVERSE[ch.dir]); break;
        case 23: ch.turn(Math.random() < 0.5 ? RIGHT[ch.dir] : LEFT[ch.dir]); break;
        case 24: ch.turn(randomDir()); break;
        case 25: ch.turn(towardPlayer(h, ch)); break;
        case 26: ch.turn(towardPlayer(h, ch, true)); break;
        case 27: case 28:
          progress.interruptores[Number(p[0])] = code === 27;
          h.refreshPages();
          break;
        case 29: ch.speed = Number(p[0]); break;
        case 30: ch.freq = Number(p[0]); break;
        case 31: case 32: ch.walkAnime = code === 31; break;
        case 33: case 34: ch.setStepAnime(code === 33); break;
        case 35: case 36: ch.fixDir = code === 35; break;
        case 37: case 38: ch.through = code === 37; break;
        case 39: case 40: ch.onTop = code === 39; ch.place(); break;
        case 41: ch.setGraphic(String(p[0] ?? ''), Number(p[2]), Number(p[3])); break;
        case 42: ch.sprite?.setAlpha(Number(p[0]) / 255); break;
        case 44: {
          const a = p[0] as Audio;
          if (a?.nombre) h.playSound('SE', a.nombre, a.volumen / 100);
          break;
        }
      }
      // Cede un fotograma entre comandos instantáneos para no bloquear rutas que se repiten.
      if (code >= 16) await h.wait(0);
    }
  } while (route.repite && ch.routeId === id);
}
