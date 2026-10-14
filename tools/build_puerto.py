"""Construye el pueblo inicial inspirado en El Puerto de Santa María.

Uso:
    python3 tools/draw_puerto.py    # si cambia el pixel art propio
    python3 tools/build_puerto.py

Genera public/assets/historia/maps/puerto.tmj, que sustituye al mapa 2 de
Essentials (Pueblo Empanada) mediante historia.json. Mezcla tiles de
Essentials (suelos, agua, pinos, fuente, laboratorio) con el tileset propio
de tools/draw_puerto.py, y conserva los eventos del pueblo original
(puertas, entrenadores, el huevo...) recolocados en el nuevo trazado.

El paso de cada tile de Essentials se deduce de los mapas ya importados
(sus propiedades "pasos"), así que este script no necesita el proyecto de
RPG Maker: basta con public/assets/essentials.

Trazado (norte arriba): la Calle Larga baja desde la Ruta 1; a la izquierda,
bodega, casas encaladas, el castillo de San Marcos y la plaza de toros; a la
derecha la Prioral y la Ribera del Marisco junto al río Guadalete, que se
cruza por un puente hacia Valdelagrana y desemboca al sur, junto a la playa
de la Puntilla.
"""
from __future__ import annotations

import collections
import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ESS = ROOT / "public" / "assets" / "essentials"
HIST = ROOT / "public" / "assets" / "historia"
T = 32
W, H = 46, 40
MAP_ID = 2
NOMBRE = "El Puerto de Santa María"

AT_COUNT = 7 * 48
GID_OUTSIDE = 1 + AT_COUNT
OUTSIDE_COUNT = 4032
GID_PUERTO = GID_OUTSIDE + OUTSIDE_COUNT
DIR_BITS = (1, 2, 4, 8)  # abajo, izquierda, derecha, arriba (como en el importador)

# Autotiles del tileset 1 (Outside)
AT_RIO, AT_MAR_CLARO, AT_MAR, AT_ARENA, AT_FLORES_ROJAS, AT_FLORES_BLANCAS = 0, 1, 2, 3, 4, 5

# Suelos de Essentials hechos con 9 piezas + 4 esquinas interiores (índices del tileset Outside).
MATERIALES = {
    # TL, T, TR, L, C, R, BL, B, BR, falta NO, falta NE, falta SO, falta SE
    "g": (265, 266, 267, 273, 274, 275, 281, 282, 283, 286, 284, 268, 270),  # adoquín gris
    "k": (328, 329, 330, 336, 337, 338, 344, 345, 346, 331, 332, 339, 340),  # ladrillo
    "y": (153, 154, 155, 161, 162, 163, 169, 170, 171, 174, 172, 156, 158),  # albero / arena
}


# ------------------------------------------------------------------ paso de los tiles de Essentials

def infer_outside() -> dict:
    """Paso y prioridad de cada tile de Outside, deducidos de los mapas importados.

    Repite el algoritmo de RMXP al revés: si una casilla es transitable, todos los
    tiles que se miran en ella (de arriba abajo hasta el primero de prioridad 0)
    dejan pasar; si está bloqueada y solo queda un sospechoso, ese bloquea.
    """
    prio: dict = {}
    cells = []
    for f in glob.glob(str(ESS / "maps" / "*.tmj")):
        m = json.load(open(f))
        if len(m["tilesets"]) < 2 or m["tilesets"][1]["name"] != "Outside":
            continue
        w, h = m["width"], m["height"]
        pasos = next(p["value"] for p in m["properties"] if p["name"] == "pasos")
        stack = [[None] * 3 for _ in range(w * h)]
        for layer in m["layers"]:
            if layer["type"] != "tilelayer":
                continue
            z = int(layer["name"][-1]) - 1
            high = layer["name"].startswith("Alto")
            for k, g in enumerate(layer["data"]):
                if g:
                    key = ("a", (g - 1) // 48) if g <= AT_COUNT else ("o", g - GID_OUTSIDE)
                    stack[k][z] = key
                    prio.setdefault(key, set()).add(high)
        for k in range(w * h):
            tiles = [t for t in reversed(stack[k]) if t]
            if tiles:
                cells.append((tiles, int(pasos[k], 16)))
    high = {k: True in v for k, v in prio.items()}
    ok = {b: set() for b in DIR_BITS}
    blocks = {b: set() for b in DIR_BITS}
    for _ in range(6):
        for tiles, v in cells:
            for b in DIR_BITS:
                seen = []
                for t in tiles:
                    seen.append(t)
                    if not high[t]:
                        break
                if not v & b:
                    ok[b].update(seen)
                else:
                    cand = [t for t in seen if t not in ok[b]]
                    if len(cand) == 1:
                        blocks[b].add(cand[0])
    flags = {}
    for t in high:
        bits = 0
        for b in DIR_BITS:
            if t in blocks[b] and t not in ok[b]:
                bits |= b
            elif t not in ok[b] and not high[t]:
                bits |= b  # sin datos: un tile de suelo desconocido bloquea, por si acaso
        flags[t] = (bits, high[t])
    return flags


# ------------------------------------------------------------------ autotiles

# Cuartos de 16 px de cada una de las 48 variantes (mismo orden que el importador).
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
VARIANT = {tuple(parts): i * 8 + j for i, row in enumerate(AUTOTILE_PARTS) for j, parts in enumerate(row)}


def autotile_variant(same) -> int:
    """Variante (0-47) según qué vecinos son del mismo autotile. same(dx, dy) -> bool."""
    n, s, w, e = same(0, -1), same(0, 1), same(-1, 0), same(1, 0)

    def quarter(v, h, d, center, inner, outer, edge_v_missing, edge_h_missing):
        if v and h:
            return center if d else inner
        if not v and not h:
            return outer
        return edge_v_missing if not v else edge_h_missing

    parts = (
        quarter(n, w, same(-1, -1), 27, 5, 13, 15, 25),
        quarter(n, e, same(1, -1), 28, 6, 18, 16, 30),
        quarter(s, w, same(-1, 1), 33, 11, 43, 45, 31),
        quarter(s, e, same(1, 1), 34, 12, 48, 46, 36),
    )
    if parts in VARIANT:
        return VARIANT[parts]
    # Combinaciones que RMXP no tiene (p. ej. una sola casilla de ancho): la más parecida.
    return max(VARIANT.items(), key=lambda kv: sum(a == b for a, b in zip(kv[0], parts)))[1]


# ------------------------------------------------------------------ el mapa

class Mapa:
    def __init__(self):
        self.suelo = [["."] * W for _ in range(H)]   # tipo de terreno de cada casilla
        # Capas de tiles: (fuente, índice) con fuente 'a' autotile (tipo, variante), 'o' Outside, 'p' propio.
        self.capas = {name: [[None] * W for _ in range(H)] for name in ("Suelo1", "Suelo2", "Suelo3", "Alto1")}
        self.bloqueo = [[None] * W for _ in range(H)]  # forzado por las piezas propias
        self.puerto = json.loads((HIST / "tilesets" / "puerto.json").read_text())

    def fill(self, x0, y0, x1, y1, kind):
        for y in range(max(0, y0), min(H, y1 + 1)):
            for x in range(max(0, x0), min(W, x1 + 1)):
                self.suelo[y][x] = kind

    def put(self, layer, x, y, tile):
        if 0 <= x < W and 0 <= y < H:
            self.capas[layer][y][x] = tile

    def pieza(self, name, x0, y0, layer="Suelo3"):
        """Coloca una pieza del tileset propio. '^' va a la capa alta."""
        info = self.puerto["piezas"][name]
        cols = self.puerto["columnas"]
        for j, row in enumerate(info["mascara"]):
            for i, c in enumerate(row):
                idx = info["origen"] + j * cols + i
                x, y = x0 + i, y0 + j
                if c == "^":
                    self.put("Alto1", x, y, ("p", idx))
                    self.bloqueo[y][x] = self.bloqueo[y][x] or "."
                else:
                    self.put(layer, x, y, ("p", idx))
                    self.bloqueo[y][x] = c

    def outside(self, block, x0, y0, layers=None, solid=None):
        """Coloca un bloque de tiles de Outside (lista de filas de índices)."""
        for j, row in enumerate(block):
            for i, t in enumerate(row):
                if t is None:
                    continue
                layer = (layers[j] if layers else "Suelo3")
                self.put(layer, x0 + i, y0 + j, ("o", t))
                if solid is not None:
                    self.bloqueo[y0 + j][x0 + i] = solid[j][i]

    # --------------------------------------------------- suelo

    def render_ground(self):
        water = {"w", "s", "b"}  # la arena de playa va encima de agua
        for y in range(H):
            for x in range(W):
                kind = self.suelo[y][x]
                if kind in water:
                    at = AT_RIO if kind == "w" else AT_MAR_CLARO

                    def same(dx, dy, x=x, y=y):
                        nx, ny = x + dx, y + dy
                        if not (0 <= nx < W and 0 <= ny < H):
                            return True
                        return self.suelo[ny][nx] in water
                    self.put("Suelo1", x, y, ("a", at, autotile_variant(same)))
                    if kind == "b":
                        def same_sand(dx, dy, x=x, y=y):
                            nx, ny = x + dx, y + dy
                            if not (0 <= nx < W and 0 <= ny < H):
                                return True
                            return self.suelo[ny][nx] not in ("w", "s")
                        self.put("Suelo2", x, y, ("a", AT_ARENA, autotile_variant(same_sand)))
                    continue
                # Hierba con alguna mata suelta
                h = (x * 73856093 ^ y * 19349663) % 23
                self.put("Suelo1", x, y, ("o", (2, 3, 4, 5)[h % 4] if h < 3 else 1))
                if kind in MATERIALES:
                    self.put("Suelo2", x, y, ("o", self.material_tile(x, y, kind)))
                elif kind in ("f", "F"):
                    at = AT_FLORES_ROJAS if kind == "f" else AT_FLORES_BLANCAS

                    def same_f(dx, dy, x=x, y=y, kind=kind):
                        nx, ny = x + dx, y + dy
                        return not (0 <= nx < W and 0 <= ny < H) or self.suelo[ny][nx] == kind
                    self.put("Suelo2", x, y, ("a", at, autotile_variant(same_f)))
        self.render_forest()

    def material_tile(self, x, y, kind):
        tl, t, tr, l, c, r, bl, b, br, nw, ne, sw, se = MATERIALES[kind]
        family = {"g", "k", "y", "b"}  # entre suelos pavimentados no hay borde de hierba

        def same(dx, dy):
            nx, ny = x + dx, y + dy
            return not (0 <= nx < W and 0 <= ny < H) or self.suelo[ny][nx] in family
        n, s, w, e = same(0, -1), same(0, 1), same(-1, 0), same(1, 0)
        if not n:
            return tl if not w else tr if not e else t
        if not s:
            return bl if not w else br if not e else b
        if not w:
            return l
        if not e:
            return r
        if not same(-1, -1):
            return nw
        if not same(1, -1):
            return ne
        if not same(-1, 1):
            return sw
        if not same(1, 1):
            return se
        return c

    def render_forest(self):
        """Pinar de los bordes: pares de pinos de Essentials que encajan entre sí."""
        def is_f(x, y):
            return not (0 <= x < W and 0 <= y < H) or self.suelo[y][x] == "T"
        for y in range(H):
            for x in range(W):
                if self.suelo[y][x] != "T":
                    continue
                left = x % 2 == 0
                if not is_f(x, y + 1):
                    t = 434 if left else 435
                elif not is_f(x, y - 1):
                    t = 426 if left else 427
                    self.put("Alto1", x, y - 1, ("o", 420 if left else 421))
                elif y % 2 == 0:
                    t = 424 if left else 425
                else:
                    t = 416 if left else 417
                if left and not is_f(x - 1, y) and t in (424, 416):
                    t += 2
                if not left and not is_f(x + 1, y) and t in (425, 417):
                    t += 2
                self.put("Suelo2", x, y, ("o", t))

    # --------------------------------------------------- salida

    def gid(self, tile):
        if tile is None:
            return 0
        if tile[0] == "a":
            return 1 + tile[1] * 48 + tile[2]
        if tile[0] == "o":
            return GID_OUTSIDE + tile[1]
        return GID_PUERTO + tile[1]

    def pasos(self, flags):
        out = []
        for y in range(H):
            for x in range(W):
                forced = self.bloqueo[y][x]
                if forced in ("#", "."):
                    out.append("f" if forced == "#" else "0")
                    continue
                blocked = 0
                stack = [(self.capas[n][y][x], n == "Alto1") for n in ("Alto1", "Suelo3", "Suelo2", "Suelo1")]
                for b in DIR_BITS:
                    for tile, high in stack:
                        if tile is None:
                            continue
                        if tile[0] == "p":
                            if not high:
                                break
                            continue
                        key = ("a", tile[1]) if tile[0] == "a" else ("o", tile[1])
                        bits, _ = flags.get(key, (0x0F, False))
                        if key == ("a", AT_MAR_CLARO):
                            bits = 0x0F
                        if bits & b:
                            blocked |= b
                            break
                        if not high:
                            break
                out.append(format(blocked, "x"))
        return "".join(out)


# Puertas del pueblo y adónde llevaban en el mapa original (para historia.json "traslados").
PUERTAS = {"Home door": (14, 10), "Next door": (5, 10), "Lab door": (16, 27)}


def build() -> Mapa:
    m = Mapa()
    # ---- Terreno
    m.fill(0, 0, 19, 1, "T")           # pinar del norte
    m.fill(22, 0, 33, 1, "T")
    m.fill(40, 0, 45, 13, "T")         # pinar de la otra orilla
    m.fill(0, 0, 1, 29, "T")           # pinar del oeste
    m.fill(34, 0, 38, 39, "w")         # río Guadalete
    m.fill(30, 32, 33, 39, "w")        # desembocadura
    m.fill(0, 36, 29, 39, "s")         # bahía de Cádiz
    m.fill(0, 31, 29, 31, "y")         # arena seca
    m.fill(0, 32, 29, 35, "b")         # playa de la Puntilla
    m.fill(20, 0, 21, 30, "k")         # Calle Larga
    m.fill(2, 12, 27, 13, "k")         # calle de la Prioral
    m.fill(2, 20, 27, 21, "k")         # calle del castillo
    m.fill(28, 2, 33, 31, "g")         # Ribera del Marisco
    m.fill(22, 10, 27, 11, "g")        # plaza de España
    m.fill(22, 14, 27, 19, "g")        # plaza junto al castillo
    m.fill(2, 22, 13, 30, "y")         # albero de la plaza de toros
    m.fill(40, 14, 43, 39, "y")        # camino de Valdelagrana
    m.fill(39, 20, 39, 21, "y")
    m.fill(3, 17, 7, 18, "f")          # arriates
    m.fill(24, 23, 27, 23, "F")
    m.fill(44, 16, 45, 17, "f")
    m.render_ground()

    # ---- Edificios
    m.pieza("bodega", 3, 2)
    m.pieza("toro", 13, 2)
    m.pieza("casa_b", 12, 6)           # casa del jugador
    m.pieza("casa_a", 3, 7)            # casa vecina
    m.pieza("prioral", 22, 3)
    m.pieza("castillo", 10, 14)
    m.pieza("casa_a", 3, 14)
    m.pieza("plaza_toros", 3, 23)
    m.pieza("casa_a", 22, 25)
    # Laboratorio de Essentials (el del pueblo original)
    lab = [[3070, 3091, 3090, 3091, 3093, 3094, 3095],
           [3078, 3099, 3098, 3099, 3101, 3102, 3103],
           [3086, 3107, 3106, 3107, 3109, 3110, 3111],
           [3112, 3113, 3114, 3115, 3117, 3118, 3119],
           [3120, 3121, 3122, 3123, 3125, 3126, 3127]]
    m.outside(lab, 13, 23, layers=["Alto1", "Suelo3", "Suelo3", "Suelo3", "Suelo3"],
              solid=[["#"] * 7] * 5)
    # ---- Ribera: puestos, el Vapor, la fuente de las Galeras y el puente
    m.pieza("puesto_marisco", 28, 5)
    m.pieza("puesto_marisco", 28, 9)
    m.pieza("vapor", 34, 25)
    fuente = [[1117, 1118, 1119], [1125, 1126, 1127], [1133, 1134, 1135], [1141, 1142, 1143]]
    m.outside(fuente, 29, 15, layers=["Alto1", "Suelo3", "Suelo3", "Suelo3"],
              solid=[[".", ".", "."], ["#", "#", "#"], ["#", "#", "#"], [".", ".", "."]])
    for x in range(34, 39):
        m.pieza("puente", x, 20)
    # ---- Árboles, farolas y carteles
    for x, y in ((40, 15), (40, 22), (42, 33), (2, 9), (24, 27)):
        m.pieza("palmera", x, y)
    for x, y in ((9, 9), (18, 6), (18, 15), (18, 22), (22, 14), (27, 14), (22, 18), (27, 18), (2, 15)):
        m.pieza("naranjo", x, y)
    for x, y in ((33, 3), (33, 9), (33, 14), (33, 27), (19, 10), (22, 20)):
        m.pieza("farola", x, y)
    for k, (x, y) in enumerate(((5, 32), (11, 33), (17, 32), (23, 33), (14, 34))):
        m.pieza("sombrilla_roja" if k % 2 == 0 else "sombrilla_azul", x, y)
    # Las puertas se pisan: el evento de la puerta es el que frena al jugador.
    for x, y in PUERTAS.values():
        m.bloqueo[y][x] = "."
    return m


def cartel(texto: list[str]) -> list:
    lista = [[101, 0, "\\w[signskin]" + texto[0]]] + [[401, 0, t] for t in texto[1:]]
    return lista + [[0, 0]]


def pagina(lista, grafico="", patron=0, disparo=0) -> dict:
    return {"cond": {}, "grafico": grafico, "dir": 2, "patron": patron, "tile": 0, "opacidad": 255,
            "disparo": disparo, "atraviesa": False, "fijo": False, "anda": True, "paso": False,
            "encima": False, "mov": 0, "vel": 3, "frec": 3, "ruta": None, "lista": lista}


def events(m: Mapa) -> list:
    """Eventos del pueblo original recolocados, y carteles nuevos."""
    old = json.load(open(ESS / "maps" / "map002.tmj"))
    objs = next(l for l in old["layers"] if l["type"] == "objectgroup")["objects"]
    sitio = {
        **PUERTAS,
        "EV007": (24, 15), "EV009": (26, 15), "Trainer(1)": [(24, 17), (26, 17)],
        "Trainer": (39, 31), "Regala huevo": (10, 11), "Restos de la base": (45, 39),
        "Portero": (19, 3),
    }
    out = []
    used = collections.Counter()
    for o in objs:
        pos = sitio[o["name"]]
        if isinstance(pos, list):
            pos = pos[used[o["name"]]]
            used[o["name"]] += 1
        props = {p["name"]: p["value"] for p in o["properties"]}
        pags = json.loads(props["paginas"])
        if o["name"] in ("Home door", "Next door"):
            for pg in pags:
                pg["patron"] = 1  # puerta de madera, como las casas encaladas
        if o["name"] == "Portero":
            pags[0]["lista"] = [
                [101, 0, "¡Bienvenido a El Puerto de Santa María, "], [401, 0, "la ciudad de los Cien Palacios!"],
                [101, 0, "Baja por la Calle Larga hasta la Ribera del "], [401, 0, "Marisco y prueba el pescaíto frito."],
                [0, 0]]
        props["paginas"] = json.dumps(pags, ensure_ascii=False)
        out.append((o["name"], pos, props))
    carteles = [
        ((22, 2), ["El Puerto de Santa María", "Calle Larga"]),
        ((18, 19), ["Castillo de San Marcos", "Fortaleza del siglo XIII junto a la Prioral."]),
        ((27, 10), ["Iglesia Mayor Prioral"]),
        ((12, 30), ["Plaza de Toros", "\"Quien no ha visto toros en El Puerto, no sabe", "lo que es un día de toros.\""]),
        ((32, 19), ["Fuente de las Galeras Reales"]),
        ((11, 5), ["Bodega", "Vino fino de El Puerto, criado en barricas de roble."]),
        ((29, 23), ["Ribera del Marisco", "Embarcadero del Vapor a Cádiz."]),
        ((39, 19), ["Puente de San Alejandro", "Al otro lado: Valdelagrana."]),
        ((27, 30), ["Playa de la Puntilla"]),
    ]
    next_id = 100
    for (x, y), texto in carteles:
        m.pieza("azulejo", x, y)
        out.append((f"Cartel {texto[0]}", (x, y), {"id": str(next_id), "vision": "0",
                                                    "paginas": json.dumps([pagina(cartel(texto))], ensure_ascii=False)}))
        next_id += 1
    objects = []
    for i, (name, (x, y), props) in enumerate(out):
        objects.append({"id": i + 1, "name": name, "type": "evento", "point": True,
                        "x": x * T + T / 2, "y": y * T + T / 2, "width": 0, "height": 0, "rotation": 0,
                        "visible": True, "properties": [{"name": k, "type": "string", "value": v} for k, v in props.items()]})
    return objects


def main() -> None:
    flags = infer_outside()
    m = build()
    objects = events(m)
    puerto = json.loads((HIST / "tilesets" / "puerto.json").read_text())
    from PIL import Image
    pw, ph = Image.open(HIST / "tilesets" / "puerto.png").size
    layers = []
    for lid, name in enumerate(("Suelo1", "Suelo2", "Suelo3", "Alto1"), start=1):
        layers.append({"id": lid, "name": name, "type": "tilelayer", "width": W, "height": H, "x": 0, "y": 0,
                       "opacity": 1, "visible": True,
                       "data": [m.gid(m.capas[name][y][x]) for y in range(H) for x in range(W)]})
    layers.append({"id": 5, "name": "Eventos", "type": "objectgroup", "x": 0, "y": 0, "opacity": 1,
                   "visible": True, "draworder": "topdown", "objects": objects})
    tmj = {
        "type": "map", "version": "1.10", "tiledversion": "1.11.0", "orientation": "orthogonal",
        "renderorder": "right-down", "width": W, "height": H, "tilewidth": T, "tileheight": T,
        "infinite": False, "nextlayerid": 6, "nextobjectid": len(objects) + 1,
        "properties": [
            {"name": "nombre", "type": "string", "value": NOMBRE},
            {"name": "pasos", "type": "string", "value": m.pasos(flags)},
            {"name": "terreno", "type": "string", "value": "0" * (W * H)},
        ],
        "layers": layers,
        "tilesets": [
            {"firstgid": 1, "name": "autotiles1", "image": "../../essentials/autotiles/1.png",
             "imagewidth": 256, "imageheight": AT_COUNT // 8 * T, "tilewidth": T, "tileheight": T,
             "tilecount": AT_COUNT, "columns": 8, "margin": 0, "spacing": 0},
            {"firstgid": GID_OUTSIDE, "name": "Outside", "image": "../../essentials/tilesets/Outside.png",
             "imagewidth": 2048, "imageheight": 2016, "tilewidth": T, "tileheight": T,
             "tilecount": OUTSIDE_COUNT, "columns": 64, "margin": 0, "spacing": 0},
            {"firstgid": GID_PUERTO, "name": "puerto", "image": "../tilesets/puerto.png",
             "imagewidth": pw, "imageheight": ph, "tilewidth": T, "tileheight": T,
             "tilecount": (pw // T) * (ph // T), "columns": puerto["columnas"], "margin": 0, "spacing": 0},
        ],
    }
    (HIST / "maps").mkdir(parents=True, exist_ok=True)
    (HIST / "maps" / "puerto.tmj").write_text(json.dumps(tmj, ensure_ascii=False, separators=(",", ":")))
    print(f"Mapa {W}x{H} con {len(objects)} eventos -> {HIST / 'maps' / 'puerto.tmj'}")


if __name__ == "__main__":
    main()
