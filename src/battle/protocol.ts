/**
 * Traduce el protocolo de Pokémon Showdown (líneas "|move|p1a: X|...") a
 * eventos que la escena de combate sabe mostrar, con textos en español.
 */

export type SideID = 'p1' | 'p2';

export type BattleEvent =
  | { kind: 'text'; text: string }
  /** Cambio de PS; `effect` dice cómo ha sido el golpe (para el sonido y el temblor). */
  | { kind: 'hp'; side: SideID; hp: number; maxhp: number; effect?: HitEffect }
  | { kind: 'switch'; side: SideID; name: string; species: string; level: number; hp: number; maxhp: number }
  | { kind: 'faint'; side: SideID }
  /** Animación de Essentials: "Move:EMBER" (con quien la usa y a quién) o "Common:Burn". */
  | { kind: 'anim'; name: string; user: SideID; target: SideID }
  /** El Pokémon desaparece del campo (bajo tierra, en el aire...) o vuelve a aparecer. */
  | { kind: 'hide'; side: SideID; hidden: boolean }
  | { kind: 'end'; winner: SideID | null };

export type HitEffect = 'normal' | 'super' | 'weak' | 'crit';

/** Animaciones comunes de Essentials para cada problema de estado y efecto que dura varios turnos. */
const STATUS_ANIM: Record<string, string> = {
  brn: 'Common:Burn', par: 'Common:Paralysis', psn: 'Common:Poison', tox: 'Common:Poison',
  slp: 'Common:Sleep', frz: 'Common:Frozen', confusion: 'Common:Confusion',
  leechseed: 'Common:LeechSeed', attract: 'Common:Attract', wrap: 'Common:Wrap', bind: 'Common:Bind',
  firespin: 'Common:FireSpin', whirlpool: 'Common:Whirlpool', clamp: 'Common:Clamp', sandtomb: 'Common:SandTomb',
  infestation: 'Common:Infestation', magmastorm: 'Common:Magma Storm', curse: 'Common:Curse',
};

/** Clima: animación de Essentials y mensajes al empezar, seguir y acabar. */
const WEATHER: Record<string, [string, string, string, string]> = {
  raindance: ['Common:Rain', '¡Ha empezado a llover!', 'Sigue lloviendo.', 'Ha dejado de llover.'],
  primordialsea: ['Common:HeavyRain', '¡Ha empezado a diluviar!', 'Sigue diluviando.', 'Ha dejado de diluviar.'],
  sunnyday: ['Common:Sunny', '¡El sol pega fuerte!', 'El sol sigue pegando fuerte.', 'El sol ya no pega tan fuerte.'],
  desolateland: ['Common:Sunny', '¡El sol abrasa!', 'El sol sigue abrasando.', 'El sol ya no abrasa.'],
  sandstorm: ['Common:Sandstorm', '¡Se ha levantado una tormenta de arena!', 'La tormenta de arena sigue.', 'La tormenta de arena ha amainado.'],
  hail: ['Common:Hail', '¡Ha empezado a granizar!', 'Sigue granizando.', 'Ha dejado de granizar.'],
  snow: ['Common:Hail', '¡Ha empezado a nevar!', 'Sigue nevando.', 'Ha dejado de nevar.'],
};

/** Movimientos de dos turnos en los que el Pokémon desaparece mientras carga, con su animación de carga. */
const SEMI_INVULNERABLE: Record<string, string | null> = {
  dig: 'Common:Dig charging', dive: 'Common:Dive charging', fly: null, bounce: null, phantomforce: null, shadowforce: null,
};

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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
    /** Nombre del entrenador rival ("Campista Liam"), en combates contra entrenadores. */
    private foeTrainer = 'El rival',
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

  private weather = '';
  /** Pokémon que están bajo tierra, en el aire... (hasta que atacan). */
  private hidden = new Set<SideID>();

  translate(lines: string[]): BattleEvent[] {
    const out: BattleEvent[] = [];
    // Showdown avisa de "muy eficaz" o del crítico antes del daño; como en los juegos, el
    // mensaje va después de que baje la barra, y el golpe suena según la eficacia.
    let pending: BattleEvent[] = [];
    let effect: HitEffect | undefined;
    const flush = () => {
      out.push(...pending);
      pending = [];
      effect = undefined;
    };
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // "|split|pX" va seguido de la línea privada (datos exactos) y la pública: usamos la privada.
      if (line.startsWith('|split|')) {
        line = lines[++i];
        i++;
      }
      const cmd = line.split('|')[1];
      const ev = this.translateLine(line);
      if (cmd === '-supereffective' || cmd === '-resisted' || cmd === '-crit') {
        effect = cmd === '-crit' ? 'crit' : effect === 'crit' ? 'crit' : cmd === '-supereffective' ? 'super' : 'weak';
        if (ev) pending.push(...ev);
        continue;
      }
      if (cmd === '-damage' && ev && !line.includes('[from]')) {
        for (const e of ev) if (e.kind === 'hp') e.effect = effect ?? 'normal';
        out.push(...ev);
        flush();
        continue;
      }
      if (pending.length && cmd !== '-damage') flush();
      if (ev) out.push(...ev);
    }
    flush();
    return out;
  }

  private translateLine(line: string): BattleEvent[] | null {
    // El movimiento oculto de lanzar Poké Ball (ver engine.ts) no se muestra.
    if (line.includes('pokeballthrow') || line.includes('Poke Ball Throw')) return null;
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
          : this.wild ? `¡Un ${name} salvaje apareció!` : `¡${this.foeTrainer} saca a ${name}!`;
        return [{ kind: 'switch', side, name, species, level, hp, maxhp }, text(msg)];
      }
      case 'move': {
        const out: BattleEvent[] = [text(`¡${this.who(a, true)} usó ${this.moveName(b)}!`)];
        const user = this.side(a);
        // Si estaba bajo tierra o en el aire, reaparece para atacar.
        if (this.hidden.delete(user)) out.unshift({ kind: 'hide', side: user, hidden: false });
        // "[still]" (turno de carga) y "[miss]"/"[notarget]" no llevan animación.
        if (!p.slice(4).some((x) => /\[(still|miss|notarget)\]/.test(x))) {
          const target = c?.startsWith('p') ? this.side(c) : user;
          out.push({ kind: 'anim', name: `Move:${toId(b).toUpperCase()}`, user, target });
        }
        return out;
      }
      case '-prepare': {
        const id = toId(b);
        if (!(id in SEMI_INVULNERABLE)) return null;
        const side = this.side(a);
        const anim = SEMI_INVULNERABLE[id];
        this.hidden.add(side);
        return [
          ...(anim ? [{ kind: 'anim', name: anim, user: side, target: side } as BattleEvent] : []),
          { kind: 'hide', side, hidden: true },
        ];
      }
      case '-weather': {
        const id = toId(a);
        const w = WEATHER[id];
        const upkeep = p.includes('[upkeep]');
        if (id === 'none') {
          const prev = WEATHER[this.weather];
          this.weather = '';
          return prev ? [text(prev[3])] : null;
        }
        if (!w) return null;
        const first = this.weather !== id || !upkeep;
        this.weather = id;
        return [{ kind: 'anim', name: w[0], user: 'p1', target: 'p1' }, text(first && !upkeep ? w[1] : w[2])];
      }
      case '-start':
      case '-activate': {
        const id = toId((b ?? '').replace(/^move: /, ''));
        const anim = STATUS_ANIM[id];
        if (!anim || !a?.startsWith('p')) return null;
        const side = this.side(a);
        const ev: BattleEvent[] = [{ kind: 'anim', name: anim, user: side, target: side }];
        if (cmd === '-start' && id === 'confusion') ev.push(text(`¡${this.who(a, true)} está confuso!`));
        if (cmd === '-activate' && id === 'confusion') ev.push(text(`${this.who(a, true)} está confuso.`));
        if (cmd === '-start' && id === 'leechseed') ev.push(text(`¡${this.who(a, true)} ha sido infectado!`));
        if (cmd === '-start' && id === 'attract') ev.push(text(`¡${this.who(a, true)} se ha enamorado!`));
        return ev;
      }
      case '-damage':
      case '-heal':
      case '-sethp': {
        const { hp, maxhp } = parseHP(b);
        const ev: BattleEvent[] = [];
        const from = toId((p.find((x) => x.startsWith('[from]')) ?? '').replace(/\[from\]\s*(move: )?/, ''));
        const side = this.side(a);
        if (from && STATUS_ANIM[from]) ev.push({ kind: 'anim', name: STATUS_ANIM[from], user: side, target: side });
        if (cmd === '-heal') ev.push({ kind: 'anim', name: 'Common:HealthUp', user: side, target: side });
        ev.push({ kind: 'hp', side, hp, maxhp });
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
        const side = this.side(a);
        const anim: BattleEvent[] = n ? [{ kind: 'anim', name: up ? 'Common:StatUp' : 'Common:StatDown', user: side, target: side }] : [];
        return [...anim, text(`¡${msg[0].toUpperCase()}${msg.slice(1)}!`)];
      }
      case '-status': {
        const side = this.side(a);
        const anim: BattleEvent[] = STATUS_ANIM[b] ? [{ kind: 'anim', name: STATUS_ANIM[b], user: side, target: side }] : [];
        return [...anim, text(`¡${this.who(a, true)} ${STATUS[b] ?? b}!`)];
      }
      case '-curestatus':
        return [text(`${this.who(a, true)} ya no tiene problemas de estado.`)];
      case 'cant': {
        const reason: Record<string, string> = {
          par: 'está paralizado. ¡No se puede mover!', slp: 'está dormido.', frz: 'está congelado.',
        };
        const side = this.side(a);
        const anim: BattleEvent[] = STATUS_ANIM[b] ? [{ kind: 'anim', name: STATUS_ANIM[b], user: side, target: side }] : [];
        return [...anim, text(`¡${this.who(a, true)} ${reason[b] ?? 'no se puede mover'}!`)];
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
