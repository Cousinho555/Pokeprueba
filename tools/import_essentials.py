"""Importa recursos de Pokémon Essentials BES al juego web.

Uso:
    pip install rubymarshal pillow
    python3 tools/import_essentials.py "ruta/a/Pokémon Essentials BES"

Lee la carpeta del proyecto de RPG Maker XP y genera, dentro de
public/assets/essentials/:
  - maps/mapNNN.tmj      mapas convertidos a formato Tiled (32x32)
  - tilesets/, autotiles/ imágenes de tilesets (los autotiles se expanden a 48 variantes)
  - characters/          hojas de personajes usadas por los mapas y el jugador
  - battlers/, battlebacks/, fonts/
  - data/*.json          especies, movimientos, habilidades, encuentros y mapas (de PBS/)

Los mapas importados guardan la colisión y el terreno precalculados en
propiedades del mapa ("pasos" y "terreno"). Si se editan en Tiled, hay que
volver a importarlos o mantener esas propiedades a mano.
"""
from __future__ import annotations

import csv
import json
import re
import shutil
import struct
import sys
from pathlib import Path

from PIL import Image
from rubymarshal.reader import load

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "essentials"
T = 32  # tamaño de tile de RPG Maker XP

# Tabla estándar de RMXP: para cada una de las 48 variantes de un autotile,
# los 4 cuartos (16x16) que la forman, numerados del 1 al 48 sobre la imagen de 96x128.
AUTOTILE_PARTS = [
    [[27, 28, 33, 34], [5, 28, 33, 34], [27, 6, 33, 34], [5, 6, 33, 34],
     [27, 28, 33, 12], [5, 28, 33, 12], [27, 6, 33, 12], [5, 6, 33, 12]],
    [[27, 28, 11, 34], [5, 28, 11, 34], [27, 6, 11, 34], [5, 6, 11, 34],
     [27, 28, 11, 12], [5, 28, 11, 12], [27, 6, 11, 12], [5, 6, 11, 12]],
    [[25, 26, 31, 32], [25, 6, 31, 32], [25, 26, 31, 12], [25, 6, 31, 12],
     [15, 16, 21, 22], [15, 16, 21, 12], [15, 16, 11, 22], [15, 16, 11, 12]],
    [[29, 30, 35, 36], [29, 30, 11, 36], [5, 30, 35, 36], [5, 30, 11, 36],
     [39, 40, 45, 46], [5, 40, 45, 46], [39, 6, 45, 46], [5, 6, 45, 46]],
    [[25, 30, 31, 36], [15, 16, 45, 46], [13, 14, 19, 20], [13, 14, 19, 12],
     [17, 18, 23, 24], [17, 18, 11, 24], [41, 42, 47, 48], [5, 42, 47, 48]],
    [[37, 38, 43, 44], [37, 6, 43, 44], [13, 18, 19, 24], [13, 14, 43, 44],
     [37, 42, 43, 48], [17, 18, 47, 48], [13, 18, 43, 48], [1, 2, 7, 8]],
]
AUTOTILES_PER_SET = 7
AUTOTILE_COLS = 8

# Bits de bloqueo de RMXP por dirección (2=abajo, 4=izquierda, 6=derecha, 8=arriba).
DIR_BIT = {2: 0x01, 4: 0x02, 6: 0x04, 8: 0x08}

# Probabilidades de cada hueco de encuentro en Essentials v16.
LAND_SLOTS = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1]
ENCOUNTER_TYPES = {"Land": LAND_SLOTS, "LandMorning": LAND_SLOTS, "LandDay": LAND_SLOTS,
                   "LandNight": LAND_SLOTS, "Cave": LAND_SLOTS}


def s(b) -> str:
    return b.decode("utf-8", "replace") if isinstance(b, (bytes, bytearray)) else str(b)


def attrs(o):
    return o.attributes


class Table:
    """Table de RGSS (array de int16 de hasta 3 dimensiones)."""

    def __init__(self, userdef):
        raw = userdef._private_data
        _, self.xs, self.ys, self.zs, n = struct.unpack_from("<5i", raw)
        self.data = struct.unpack_from(f"<{n}h", raw, 20)

    def __getitem__(self, key):
        x, y, z = (key + (0, 0))[:3] if isinstance(key, tuple) else (key, 0, 0)
        i = x + y * self.xs + z * self.xs * self.ys
        return self.data[i] if 0 <= i < len(self.data) else 0


# ------------------------------------------------------------------ imágenes

def find_image(folder: Path, name: str) -> Path | None:
    for ext in (".png", ".PNG", ".Png"):
        p = folder / f"{name}{ext}"
        if p.exists():
            return p
    return None


def build_autotile_sheet(gfx: Path, names: list[str], dest: Path) -> None:
    sheet = Image.new("RGBA", (AUTOTILE_COLS * T, (AUTOTILES_PER_SET * 48 // AUTOTILE_COLS) * T))
    for k, name in enumerate(names[:AUTOTILES_PER_SET]):
        src = find_image(gfx / "Autotiles", name) if name else None
        if not src:
            continue
        img = Image.open(src).convert("RGBA")
        for p in range(48):
            idx = k * 48 + p
            ox, oy = (idx % AUTOTILE_COLS) * T, (idx // AUTOTILE_COLS) * T
            if img.height == T:  # autotile de una sola casilla
                sheet.paste(img.crop((0, 0, T, T)), (ox, oy))
                continue
            parts = AUTOTILE_PARTS[p // 8][p % 8]
            for q, part in enumerate(parts):
                sx, sy = ((part - 1) % 6) * 16, ((part - 1) // 6) * 16
                sheet.paste(img.crop((sx, sy, sx + 16, sy + 16)), (ox + (q % 2) * 16, oy + (q // 2) * 16))
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)


def repack_tileset(src: Path, dest: Path, cols: int = 64) -> tuple[int, int]:
    """Los tilesets de RMXP miden 256 px de ancho y pueden superar los 16000 de alto,
    más de lo que admiten muchas GPU. Se reordenan en filas de `cols` tiles
    manteniendo el mismo índice de tile."""
    img = Image.open(src).convert("RGBA")
    src_cols = img.width // T
    n = src_cols * (img.height // T)
    rows = -(-n // cols)
    out = Image.new("RGBA", (cols * T, rows * T))
    for i in range(n):
        sx, sy = (i % src_cols) * T, (i // src_cols) * T
        out.paste(img.crop((sx, sy, sx + T, sy + T)), ((i % cols) * T, (i // cols) * T))
    out.save(dest, optimize=True)
    return out.size


# ------------------------------------------------------------------ mapas

def clean_text(t: str) -> str:
    t = t.replace("\\PN", "Rojo").replace("\\pn", "Rojo")
    t = re.sub(r"\\[bBrRgG](?![a-zA-Z])", "", t)
    t = re.sub(r"\\[a-zA-Z]+\[[^\]]*\]", "", t)
    t = re.sub(r"\\[a-zA-Z]", "", t)
    return " ".join(t.split())


def page_commands(page) -> list[tuple[int, list]]:
    return [(attrs(c)["@code"], attrs(c)["@parameters"]) for c in attrs(page)["@list"]]


def page_texts(cmds, stop=lambda code, params: False) -> list[str]:
    """Mensajes (101 + 401) de una página, hasta que `stop` diga basta."""
    texts: list[str] = []
    for code, params in cmds:
        if stop(code, params):
            break
        if code == 101:
            texts.append(s(params[0]))
        elif code == 401 and texts:
            texts[-1] += " " + s(params[0])
    return [t for t in (clean_text(t) for t in texts) if t]


def script_of(code: int, params) -> str | None:
    """Texto de Ruby de un comando de script (355/655) o de una condición de script (111)."""
    if code in (355, 655):
        return s(params[0])
    if code == 111 and params[0] == 12:
        return s(params[1])
    return None


TRAINER_BATTLE = re.compile(
    r'pbTrainerBattle\(PBTrainers::(\w+),\s*"([^"]*)",\s*_I\("((?:[^"\\]|\\.)*)"\)(?:,\s*(?:true|false))?(?:,\s*(\d+))?')
CUSTOM_MON = re.compile(r"createPokemon\(:(\w+),\s*(\d+)(?:,\s*\[([^\]]*)\])?")
CUSTOM_TRAINER = re.compile(r'createTrainer\(:(\w+),\s*"([^"]*)"')
CUSTOM_DEFEAT = re.compile(r'customTrainerBattle\([^,]*,\s*_I\("((?:[^"\\]|\\.)*)"\)')


def trainer_info(cmds, after_cmds) -> dict | None:
    """Entrenador de un evento: equipo, clase, frase de derrota y textos de antes y después."""
    lines, battle_at = [], None
    for i, (code, params) in enumerate(cmds):
        sc = script_of(code, params)
        if sc is None:
            continue
        lines.append(sc)
        if battle_at is None and ("pbTrainerBattle(" in sc or "customTrainerBattle(" in " ".join(lines)):
            battle_at = i
    script = " ".join(lines)
    team = None
    if m := TRAINER_BATTLE.search(script):
        ttype, name, defeat, party_id = m.group(1), m.group(2), m.group(3), int(m.group(4) or 0)
        team = TRAINERS.get((ttype, name, party_id)) or TRAINERS.get((ttype, name, 0))
    elif (t := CUSTOM_TRAINER.search(script)) and (d := CUSTOM_DEFEAT.search(script)):
        ttype, name, defeat = t.group(1), t.group(2), d.group(1)
        team = [[sp, int(lv), [x.strip().lstrip(":") for x in mv.split(",") if x.strip()] if mv else []]
                for sp, lv, mv in CUSTOM_MON.findall(script)]
    if not team or ttype not in TRAINER_TYPES:
        return None
    tt = TRAINER_TYPES[ttype]
    first_script = next(i for i, (c, p) in enumerate(cmds) if script_of(c, p) is not None and
                        ("pbTrainerBattle(" in script_of(c, p) or "party" in script_of(c, p) or "createPokemon" in script_of(c, p)))
    intro = page_texts(cmds[:first_script], lambda c, p: c in (102, 402, 403))
    return {"clase": tt["nombre"], "nombre": name, "sprite": tt["id"], "dinero": tt["dinero"],
            "derrota": clean_text(defeat.replace("\\", "")), "equipo": team, "intro": intro,
            "despues": page_texts(after_cmds, lambda c, p: c in (102, 111, 402, 403)) if after_cmds else []}


def event_info(ev) -> dict | None:
    e = attrs(ev)
    pages = e["@pages"]
    page = attrs(pages[0])
    g = attrs(page["@graphic"])
    cmds = page_commands(pages[0])
    info: dict = {"id": e["@id"], "nombre": s(e["@name"]), "x": e["@x"], "y": e["@y"],
                  "grafico": s(g["@character_name"]), "direccion": g["@direction"],
                  "patron": g["@pattern"], "atraviesa": bool(page["@through"]),
                  "disparo": page["@trigger"]}
    for code, params in cmds:
        if code in (102, 111, 402, 403):  # elecciones y condiciones: cortamos ahí
            break
        if code == 201 and params[0] == 0:
            info["warp"] = {"mapa": params[1], "x": params[2], "y": params[3], "dir": params[4]}
    texts = page_texts(cmds, lambda c, p: c in (102, 111, 402, 403))

    # Enfermera del Centro Pokémon: cura al equipo (314) y fija el punto de regreso.
    if any(code == 314 for code, _ in cmds):
        info["cura"] = True
        texts = [t for t in texts if not t.endswith("?")]
    # Entrenadores: los que combaten al verte se llaman "Trainer(alcance)".
    if info["grafico"]:
        after = page_commands(pages[1]) if len(pages) > 1 else None
        tr = trainer_info(cmds, after)
        if tr:
            m = re.match(r"Trainer\((\d+)\)", info["nombre"])
            tr["vision"] = int(m.group(1)) if m and info["disparo"] == 2 else 0
            info["entrenador"] = tr
            texts = []

    if texts:
        info["texto"] = texts
    if not info["grafico"] and "warp" not in info and not texts:
        return None
    return info


def convert_map(map_id: int, name: str, data_dir: Path, tilesets: dict, out_maps: Path) -> dict | None:
    m = attrs(load(open(data_dir / f"Map{map_id:03d}.rxdata", "rb")))
    ts_id = m["@tileset_id"]
    ts = tilesets.get(ts_id)
    if not ts:
        return None
    w, h = m["@width"], m["@height"]
    tbl = Table(m["@data"])
    passages, priorities, tags = ts["passages"], ts["priorities"], ts["terrain"]
    at_count = AUTOTILES_PER_SET * 48
    gid_tiles = 1 + at_count

    def gid(t: int) -> int:
        if t >= 384:
            return gid_tiles + (t - 384)
        if t >= 48:
            return 1 + (t - 48)
        return 0

    below = [[0] * (w * h) for _ in range(3)]
    above = [[0] * (w * h) for _ in range(3)]
    pasos, terreno = [], []
    for y in range(h):
        for x in range(w):
            blocked = 0
            tag = 0
            for bit in DIR_BIT.values():
                for z in (2, 1, 0):  # mismo orden que Game_Map#passable? de RMXP
                    t = tbl[x, y, z]
                    if t == 0:
                        continue
                    if passages[t] & bit or passages[t] & 0x0F == 0x0F:
                        blocked |= bit
                        break
                    if priorities[t] == 0:
                        break
            for z in (2, 1, 0):
                t = tbl[x, y, z]
                if t and tags[t]:
                    tag = tags[t]
                    break
            for z in range(3):
                t = tbl[x, y, z]
                if t:
                    (above if priorities[t] > 0 else below)[z][x + y * w] = gid(t)
            pasos.append(format(blocked, "x"))
            terreno.append(format(tag, "x") if tag < 16 else "0")

    layers = []
    lid = 1
    for prefix, group in (("Suelo", below), ("Alto", above)):
        for z, grid in enumerate(group):
            if not any(grid):
                continue
            layers.append({"id": lid, "name": f"{prefix}{z + 1}", "type": "tilelayer", "width": w, "height": h,
                           "x": 0, "y": 0, "opacity": 1, "visible": True, "data": grid})
            lid += 1

    events = [i for i in (event_info(ev) for ev in m["@events"].values()) if i]
    objects = []
    for i, ev in enumerate(sorted(events, key=lambda e: e["id"])):
        props = [{"name": k, "type": "string", "value": json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v}
                 for k, v in ev.items() if k not in ("id", "nombre", "x", "y")]
        objects.append({"id": i + 1, "name": ev["nombre"], "type": "evento", "point": True,
                        "x": ev["x"] * T + T / 2, "y": ev["y"] * T + T / 2, "width": 0, "height": 0,
                        "rotation": 0, "visible": True, "properties": props})
    layers.append({"id": lid, "name": "Eventos", "type": "objectgroup", "x": 0, "y": 0, "opacity": 1,
                   "visible": True, "draworder": "topdown", "objects": objects})

    tmj = {
        "type": "map", "version": "1.10", "tiledversion": "1.11.0", "orientation": "orthogonal",
        "renderorder": "right-down", "width": w, "height": h, "tilewidth": T, "tileheight": T,
        "infinite": False, "nextlayerid": lid + 1, "nextobjectid": len(objects) + 1,
        "properties": [
            {"name": "nombre", "type": "string", "value": name},
            {"name": "pasos", "type": "string", "value": "".join(pasos)},
            {"name": "terreno", "type": "string", "value": "".join(terreno)},
        ],
        "layers": layers,
        "tilesets": [
            {"firstgid": 1, "name": f"autotiles{ts_id}", "image": f"../autotiles/{ts_id}.png",
             "imagewidth": AUTOTILE_COLS * T, "imageheight": at_count // AUTOTILE_COLS * T,
             "tilewidth": T, "tileheight": T, "tilecount": at_count, "columns": AUTOTILE_COLS,
             "margin": 0, "spacing": 0},
            {"firstgid": gid_tiles, "name": ts["name"], "image": f"../tilesets/{ts['file']}",
             "imagewidth": ts["size"][0], "imageheight": ts["size"][1], "tilewidth": T, "tileheight": T,
             "tilecount": (ts["size"][0] // T) * (ts["size"][1] // T), "columns": ts["size"][0] // T,
             "margin": 0, "spacing": 0},
        ],
    }
    (out_maps / f"map{map_id:03d}.tmj").write_text(json.dumps(tmj, ensure_ascii=False, separators=(",", ":")))
    return {"id": map_id, "nombre": name, "ancho": w, "alto": h, "tileset": ts_id,
            "autotiles": ts["autotile_key"], "imagen": ts["file"], "bgm": s(attrs(m["@bgm"])["@name"]),
            "graficos": sorted({e["grafico"] for e in events if e["grafico"]}),
            "entrenadores": [e["entrenador"]["sprite"] for e in events if "entrenador" in e]}


# ------------------------------------------------------------------ PBS

def read_pbs_sections(path: Path) -> list[dict]:
    sections, cur = [], None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = {"_id": line[1:-1]}
            sections.append(cur)
        elif cur is not None and "=" in line:
            k, v = line.split("=", 1)
            cur[k.strip()] = v.strip()
    return sections


def read_species(pbs: Path) -> dict:
    out = {}
    for sec in read_pbs_sections(pbs / "pokemon.txt"):
        if "InternalName" not in sec:
            continue
        moves = sec.get("Moves", "").split(",")
        evos = [e for e in sec.get("Evolutions", "").split(",") if e != ""]
        out[sec["InternalName"]] = {
            "num": int(sec["_id"]),
            "nombre": sec.get("Name", sec["InternalName"]),
            "tipos": [t for t in (sec.get("Type1"), sec.get("Type2")) if t],
            "habilidades": [a for a in sec.get("Abilities", "").split(",") if a],
            "movimientos": [[int(moves[i]), moves[i + 1]] for i in range(0, len(moves) - 1, 2)],
            "especie": sec.get("Kind", ""),
            "exp": int(sec.get("BaseEXP", 0)),
            "crecimiento": sec.get("GrowthRate", "Medium"),
            "captura": int(sec.get("Rareness", 45)),
            # [especie, método, parámetro], p. ej. ["IVYSAUR", "Level", "16"]
            "evoluciones": [evos[i:i + 3] for i in range(0, len(evos) - 2, 3)],
            # Ajustes de posición del sprite en combate (en píxeles del sprite original).
            "posJugadorY": int(sec.get("BattlerPlayerY", 0)),
            "posEnemigoY": int(sec.get("BattlerEnemyY", 0)),
            "altitud": int(sec.get("BattlerAltitude", 0)),
        }
    return out


def read_named_csv(path: Path, name_col: int) -> dict:
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if row and not row[0].startswith("#") and len(row) > name_col:
                out[row[1]] = row[name_col]
    return out


def read_encounters(pbs: Path) -> dict:
    out: dict = {}
    lines = [ln.split("#")[0].strip() for ln in (pbs / "encounters.txt").read_text(encoding="utf-8-sig").splitlines()]
    lines = [ln for ln in lines if ln]
    i = 0
    while i < len(lines):
        if not re.fullmatch(r"\d+", lines[i]):
            i += 1
            continue
        map_id = int(lines[i])
        densities = [int(x) for x in lines[i + 1].split(",")] if re.fullmatch(r"[\d,]+", lines[i + 1]) else [25, 10, 10]
        i += 2 if re.fullmatch(r"[\d,]+", lines[i + 1]) else 1
        tables = {}
        while i < len(lines) and not re.fullmatch(r"\d+", lines[i]):
            kind = lines[i]
            i += 1
            slots = []
            while i < len(lines) and "," in lines[i] and lines[i].split(",")[0].isupper():
                parts = lines[i].split(",")
                lo = int(parts[1])
                hi = int(parts[2]) if len(parts) > 2 else lo
                slots.append([parts[0], lo, hi])
                i += 1
            if kind in ENCOUNTER_TYPES and slots:
                tables[kind] = [[*sl, ENCOUNTER_TYPES[kind][n]] for n, sl in enumerate(slots[:12])]
        out[map_id] = {"densidad": densities[0], "tablas": tables}
    return out


def read_connections(pbs: Path) -> list:
    out = []
    for line in (pbs / "connections.txt").read_text(encoding="utf-8-sig").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        p = [x.strip() for x in line.split(",")]
        if len(p) == 6:
            out.append([int(p[0]), p[1][0].upper(), int(p[2]), int(p[3]), p[4][0].upper(), int(p[5])])
    return out


TRAINERS: dict = {}
TRAINER_TYPES: dict = {}


def read_trainer_types(pbs: Path) -> dict:
    types = {}
    for line in (pbs / "trainertypes.txt").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        f = line.split(",")
        types[f[1]] = {"id": int(f[0]), "nombre": f[2], "dinero": int(f[3] or 30)}
    return types


def read_trainers(pbs: Path) -> dict:
    """trainers.txt: tipo / nombre[,versión] / nº de Pokémon[,objetos] / una línea por Pokémon."""
    lines = [l.strip() for l in (pbs / "trainers.txt").read_text(encoding="utf-8-sig").splitlines()
             if l.strip() and not l.startswith("#")]
    out, i = {}, 0
    while i + 2 < len(lines):
        ttype = lines[i]
        name, _, ver = lines[i + 1].partition(",")
        count = int(lines[i + 2].split(",")[0])
        team = []
        for row in lines[i + 3:i + 3 + count]:
            f = row.split(",")
            team.append([f[0], int(f[1]), [m for m in f[3:7] if m]])
        out[(ttype, name, int(ver or 0))] = team
        i += 3 + count
    return out


def read_metadata(pbs: Path) -> dict:
    meta = {}
    for sec in read_pbs_sections(pbs / "metadata.txt"):
        meta[int(sec["_id"])] = {k: v for k, v in sec.items() if k != "_id"}
    return meta


# ------------------------------------------------------------------ main

def main(src: Path) -> None:
    gfx, data_dir, pbs = src / "Graphics", src / "Data", src / "PBS"
    if OUT.exists():
        shutil.rmtree(OUT)
    for sub in ("maps", "tilesets", "autotiles", "characters", "battlers/front", "battlers/back",
                "battlebacks", "trainers", "fonts", "data"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    # Tilesets
    tilesets = {}
    for ts_obj in load(open(data_dir / "Tilesets.rxdata", "rb")):
        if ts_obj is None:
            continue
        a = attrs(ts_obj)
        name = s(a["@tileset_name"])
        img = find_image(gfx / "Tilesets", name) if name else None
        if not img:
            continue
        ts_id = a["@id"]
        dest = OUT / "tilesets" / f"{name}.png"
        size = repack_tileset(img, dest)
        build_autotile_sheet(gfx, [s(n) for n in a["@autotile_names"]], OUT / "autotiles" / f"{ts_id}.png")
        tilesets[ts_id] = {
            "name": name, "file": f"{name}.png", "size": size, "autotile_key": ts_id,
            "passages": Table(a["@passages"]), "priorities": Table(a["@priorities"]),
            "terrain": Table(a["@terrain_tags"]),
        }

    # Entrenadores (se usan al convertir los eventos de los mapas)
    TRAINER_TYPES.update(read_trainer_types(pbs))
    TRAINERS.update(read_trainers(pbs))

    # Mapas
    infos = load(open(data_dir / "MapInfos.rxdata", "rb"))
    metadata = read_metadata(pbs)
    mapas = {}
    for map_id, info in sorted(infos.items()):
        if not (data_dir / f"Map{map_id:03d}.rxdata").exists():
            continue
        name = clean_text(s(attrs(info)["@name"]))
        res = convert_map(map_id, name, data_dir, tilesets, OUT / "maps")
        if res:
            md = metadata.get(map_id, {})
            res["exterior"] = md.get("Outdoor", "").lower() == "true"
            res["fondoCombate"] = md.get("BattleBack", "Field")
            if "HealingSpot" in md:
                res["curacion"] = [int(x) for x in md["HealingSpot"].split(",")]
            mapas[map_id] = res

    # Personajes usados + jugador
    player_sheet = metadata.get(0, {}).get("PlayerA", "x,trchar000").split(",")[1]
    chars = {player_sheet} | {g for m in mapas.values() for g in m["graficos"]}
    graficos = {}
    for c in sorted(chars):
        img = find_image(gfx / "Characters", c)
        if img:
            shutil.copy(img, OUT / "characters" / f"{c}.png")
            w, h = Image.open(img).size
            graficos[c] = [w // 4, h // 4]

    # Battlers (sin shiny ni formas alternativas, de momento)
    for side, folder in (("front", "Front"), ("back", "Back")):
        for f in (gfx / "Battlers" / folder).iterdir():
            if re.fullmatch(r"\d+\.png", f.name):
                shutil.copy(f, OUT / "battlers" / side / f"{int(f.stem)}.png")
    for f in (gfx / "Battlebacks").iterdir():
        if f.suffix.lower() == ".png":
            shutil.copy(f, OUT / "battlebacks" / f.name)
    # Sprites de combate de los entrenadores que aparecen en los mapas
    for sid in sorted({e for m in mapas.values() for e in m.pop("entrenadores")}):
        img = gfx / "Battlers" / "Trainers" / f"trainer{sid:03d}.png"
        if img.exists():
            shutil.copy(img, OUT / "trainers" / f"{sid}.png")
    for f in (src / "Fonts").glob("pkmnem*.ttf"):
        shutil.copy(f, OUT / "fonts" / f.name)

    home = [int(x) for x in metadata.get(0, {}).get("Home", "2,8,8,2").split(",")]
    world = {
        "inicio": {"mapa": home[0], "x": home[1], "y": home[2], "dir": home[3]},
        "jugador": player_sheet,
        "graficos": graficos,
        "mapas": mapas,
        "conexiones": read_connections(pbs),
        "encuentros": read_encounters(pbs),
    }
    dump = lambda name, obj: (OUT / "data" / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    dump("mundo.json", world)
    dump("especies.json", read_species(pbs))
    dump("movimientos.json", read_named_csv(pbs / "moves.txt", 2))
    dump("habilidades.json", read_named_csv(pbs / "abilities.txt", 2))

    for credits in (src / "Créditos.txt", src.parent / "Créditos.txt"):
        if credits.exists():
            shutil.copy(credits, OUT / "CREDITOS.txt")
            break
    print(f"{len(mapas)} mapas, {len(graficos)} gráficos de personaje -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(Path(sys.argv[1]))
