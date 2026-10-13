/**
 * Traduce el protocolo de Pokémon Showdown (líneas "|move|p1a: X|...") a
 * eventos que la escena de combate sabe mostrar, con textos en español.
 */

export type SideID = 'p1' | 'p2';

export type BattleEvent =
  | { kind: 'text'; text: string }
  | { kind: 'hp'; side: SideID; hp: number; maxhp: number }
  | { kind: 'switch'; side: SideID; name: string; species: string; level: number; hp: number; maxhp: number }
  | { kind: 'faint'; side: SideID }
  | { kind: 'end'; winner: SideID | null };

const STATS: Record<string, string> = {
  atk: 'el Ataque', def: 'la Defensa', spa: 'el Ataque Especial', spd: 'la Defensa Especial',
  spe: 'la Velocidad', accuracy: 'la Precisión', evasion: 'la Evasión',
};

const STATUS: Record<string, string> = {
  brn: 'se ha quemado', par: 'está paralizado', psn: 'ha sido envenenado',
  tox: 'ha sido gravemente envenenado', slp: 'se ha dormido', frz: 'se ha congelado',
};

function parseHP(s: string): { hp: number; maxhp: number } {
  const [frac] = s.split(' ');
  if (frac === '0') return { hp: 0, maxhp: 0 };
  const [hp, maxhp] = frac.split('/').map(Number);
  return { hp, maxhp };
}

export class ProtocolTranslator {
  constructor(
    private playerName: string,
    private wild: boolean,
    private moveName: (name: string) => string = (n) => n,
  ) {}

  private side(ident: string): SideID {
    return ident.startsWith('p1') ? 'p1' : 'p2';
  }

  /** "p2a: Pidgey" -> "el Pidgey salvaje" / "Charmander" */
  private who(ident: string, capital = false): string {
    const name = ident.split(': ')[1] ?? ident;
    if (this.side(ident) === 'p1') return name;
    const prefix = this.wild ? `${capital ? 'El' : 'el'} ${name} salvaje` : `${capital ? 'El' : 'el'} ${name} rival`;
    return prefix;
  }

  translate(lines: string[]): BattleEvent[] {
    const out: BattleEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // "|split|pX" va seguido de la línea privada (datos exactos) y la pública: usamos la privada.
      if (line.startsWith('|split|')) {
        line = lines[++i];
        i++;
      }
      const ev = this.translateLine(line);
      if (ev) out.push(...ev);
    }
    return out;
  }

  private translateLine(line: string): BattleEvent[] | null {
    const p = line.split('|').slice(1);
    const [cmd, a, b, c] = p;
    const text = (t: string): BattleEvent => ({ kind: 'text', text: t });
    switch (cmd) {
      case 'switch':
      case 'drag': {
        const side = this.side(a);
        const [species, lvl] = b.split(', ');
        const level = lvl?.startsWith('L') ? Number(lvl.slice(1)) : 100;
        const { hp, maxhp } = parseHP(c);
        const name = a.split(': ')[1];
        const msg = side === 'p1'
          ? `¡Adelante, ${name}!`
          : this.wild ? `¡Un ${name} salvaje apareció!` : `¡El rival saca a ${name}!`;
        return [{ kind: 'switch', side, name, species, level, hp, maxhp }, text(msg)];
      }
      case 'move':
        return [text(`¡${this.who(a, true)} usó ${this.moveName(b)}!`)];
      case '-damage':
      case '-heal':
      case '-sethp': {
        const { hp, maxhp } = parseHP(b);
        const ev: BattleEvent[] = [{ kind: 'hp', side: this.side(a), hp, maxhp }];
        if (cmd === '-heal') ev.push(text(`${this.who(a, true)} recuperó PS.`));
        return ev;
      }
      case '-supereffective':
        return [text('¡Es muy eficaz!')];
      case '-resisted':
        return [text('No es muy eficaz...')];
      case '-immune':
        return [text(`No afecta a ${this.who(a)}...`)];
      case '-crit':
        return [text('¡Un golpe crítico!')];
      case '-miss':
        return [text(`¡${this.who(b ?? a, true)} esquivó el ataque!`)];
      case '-fail':
        return [text('¡Pero falló!')];
      case '-boost':
      case '-unboost': {
        const stat = STATS[b] ?? b;
        const n = Number(c);
        const up = cmd === '-boost';
        const verb = n === 0
          ? `no puede ${up ? 'subir' : 'bajar'} más`
          : up ? (n > 1 ? 'subió mucho' : 'subió') : (n > 1 ? 'bajó mucho' : 'bajó');
        const msg = `${stat} de ${this.who(a)} ${verb}`;
        return [text(`¡${msg[0].toUpperCase()}${msg.slice(1)}!`)];
      }
      case '-status':
        return [text(`¡${this.who(a, true)} ${STATUS[b] ?? b}!`)];
      case '-curestatus':
        return [text(`${this.who(a, true)} ya no tiene problemas de estado.`)];
      case 'cant': {
        const reason: Record<string, string> = {
          par: 'está paralizado. ¡No se puede mover!', slp: 'está dormido.', frz: 'está congelado.',
        };
        return [text(`¡${this.who(a, true)} ${reason[b] ?? 'no se puede mover'}!`)];
      }
      case 'faint':
        return [{ kind: 'faint', side: this.side(a) }, text(`¡${this.who(a, true)} se debilitó!`)];
      case 'win':
        return [{ kind: 'end', winner: a === this.playerName ? 'p1' : 'p2' }];
      case 'tie':
        return [{ kind: 'end', winner: null }];
      default:
        return null;
    }
  }
}
