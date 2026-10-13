"""Genera assets provisionales (tileset, sprite del jugador y mapa Tiled).

Son gráficos de relleno, propios y libres, para poder jugar sin depender de
recursos con copyright. Se sustituirán por los de Essentials u otros más adelante.

Uso: python3 tools/gen_assets.py   (requiere Pillow)
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
T = 16  # tamaño de tile en píxeles

# Orden de tiles en el tileset (id local = índice). Propiedades usadas por el juego:
#   colisiona: no se puede pisar
#   hierba:    puede salir un Pokémon salvaje
TILES = [
    ("cesped", {}),
    ("hierba_alta", {"hierba": True}),
    ("camino", {}),
    ("arbol", {"colisiona": True}),
    ("agua", {"colisiona": True}),
    ("muro", {"colisiona": True}),
    ("tejado", {"colisiona": True}),
    ("puerta", {"colisiona": True}),
    ("flores", {}),
    ("valla", {"colisiona": True}),
]
ID = {name: i for i, (name, _) in enumerate(TILES)}


def draw_tile(d: ImageDraw.ImageDraw, ox: int, name: str, rnd: random.Random) -> None:
    r = (ox, 0, ox + T - 1, T - 1)
    grass = (104, 184, 88)
    if name in ("cesped", "flores", "hierba_alta", "arbol", "valla"):
        d.rectangle(r, fill=grass)
        for _ in range(6):
            x, y = ox + rnd.randrange(T), rnd.randrange(T)
            d.point((x, y), fill=(88, 160, 72))
    if name == "hierba_alta":
        for x in range(0, T, 4):
            for y in (2, 9):
                d.polygon([(ox + x, y + 6), (ox + x + 2, y), (ox + x + 4, y + 6)], fill=(56, 128, 48))
    elif name == "camino":
        d.rectangle(r, fill=(222, 196, 140))
        for _ in range(5):
            d.point((ox + rnd.randrange(T), rnd.randrange(T)), fill=(196, 168, 112))
    elif name == "arbol":
        d.rectangle((ox + 6, 10, ox + 9, 15), fill=(112, 72, 40))
        d.ellipse((ox + 1, 0, ox + 14, 12), fill=(40, 112, 56), outline=(24, 72, 32))
    elif name == "agua":
        d.rectangle(r, fill=(72, 136, 216))
        for y in (4, 11):
            d.line((ox + 2, y, ox + 6, y), fill=(160, 200, 248))
            d.line((ox + 9, y + 2, ox + 13, y + 2), fill=(160, 200, 248))
    elif name == "muro":
        d.rectangle(r, fill=(232, 224, 208))
        d.rectangle((ox + 3, 4, ox + 7, 9), fill=(136, 184, 232), outline=(80, 80, 96))
        d.rectangle((ox + 9, 4, ox + 13, 9), fill=(136, 184, 232), outline=(80, 80, 96))
    elif name == "tejado":
        d.rectangle(r, fill=(200, 72, 64))
        for y in range(0, T, 4):
            d.line((ox, y, ox + T - 1, y), fill=(160, 48, 48))
    elif name == "puerta":
        d.rectangle(r, fill=(232, 224, 208))
        d.rectangle((ox + 4, 3, ox + 11, 15), fill=(120, 80, 48), outline=(72, 48, 24))
    elif name == "flores":
        for x, y, c in ((3, 3, (240, 80, 96)), (11, 5, (248, 216, 64)), (6, 11, (240, 240, 248)), (12, 12, (240, 80, 96))):
            d.ellipse((ox + x - 1, y - 1, ox + x + 1, y + 1), fill=c)
    elif name == "valla":
        d.rectangle((ox, 5, ox + T - 1, 7), fill=(240, 240, 232))
        d.rectangle((ox, 10, ox + T - 1, 12), fill=(240, 240, 232))
        for x in (2, 13):
            d.rectangle((ox + x, 3, ox + x + 1, 15), fill=(208, 208, 200))


def gen_tileset() -> None:
    rnd = random.Random(1)
    img = Image.new("RGBA", (T * len(TILES), T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i, (name, _) in enumerate(TILES):
        draw_tile(d, i * T, name, rnd)
    img.save(ASSETS / "tilesets" / "tiles.png")


def gen_player() -> None:
    """Spritesheet 4x4: filas abajo, izquierda, derecha, arriba; 4 frames de paso."""
    img = Image.new("RGBA", (T * 4, T * 4), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for row, facing in enumerate(("down", "left", "right", "up")):
        for f in range(4):
            ox, oy = f * T, row * T
            step = (0, 1, 0, -1)[f]
            # piernas
            d.rectangle((ox + 5, oy + 12, ox + 7, oy + 15 - max(step, 0)), fill=(48, 64, 128))
            d.rectangle((ox + 9, oy + 12, ox + 11, oy + 15 - max(-step, 0)), fill=(48, 64, 128))
            # cuerpo
            d.rectangle((ox + 4, oy + 7, ox + 12, oy + 12), fill=(216, 56, 56), outline=(120, 24, 24))
            # cabeza
            d.ellipse((ox + 4, oy + 1, ox + 12, oy + 8), fill=(248, 208, 168), outline=(120, 80, 56))
            # gorra
            d.rectangle((ox + 4, oy + 1, ox + 12, oy + 3), fill=(216, 56, 56))
            if facing == "down":
                d.point((ox + 6, oy + 5), fill=(32, 32, 32))
                d.point((ox + 10, oy + 5), fill=(32, 32, 32))
                d.rectangle((ox + 5, oy + 3, ox + 11, oy + 3), fill=(176, 32, 32))
            elif facing == "left":
                d.point((ox + 5, oy + 5), fill=(32, 32, 32))
                d.rectangle((ox + 2, oy + 3, ox + 5, oy + 3), fill=(176, 32, 32))
            elif facing == "right":
                d.point((ox + 11, oy + 5), fill=(32, 32, 32))
                d.rectangle((ox + 11, oy + 3, ox + 14, oy + 3), fill=(176, 32, 32))
            else:
                d.rectangle((ox + 4, oy + 1, ox + 12, oy + 6), fill=(216, 56, 56))
    img.save(ASSETS / "sprites" / "player.png")


def gen_map() -> None:
    W, H = 30, 22
    rnd = random.Random(7)
    g = [[ID["cesped"]] * W for _ in range(H)]
    o = [[-1] * W for _ in range(H)]  # capa de obstáculos (-1 = vacío)

    # borde de árboles
    for x in range(W):
        o[0][x] = o[H - 1][x] = ID["arbol"]
    for y in range(H):
        o[y][0] = o[y][W - 1] = ID["arbol"]
    # camino vertical y horizontal
    for y in range(1, H - 1):
        g[y][14] = g[y][15] = ID["camino"]
    for x in range(1, W - 1):
        g[11][x] = ID["camino"]
    # casa
    for y in range(3, 5):
        for x in range(4, 9):
            o[y][x] = ID["tejado"]
    for x in range(4, 9):
        o[5][x] = ID["muro"]
    o[5][6] = ID["puerta"]
    g[6][6] = ID["camino"]
    for x in range(6, 14):
        g[7][x] = ID["camino"]
    for y in range(6, 8):
        g[y][6] = ID["camino"]
    # estanque
    for y in range(15, 19):
        for x in range(3, 9):
            o[y][x] = ID["agua"]
    # valla
    for x in range(18, 27):
        o[8][x] = ID["valla"]
    # hierba alta (zona de encuentros)
    for y in range(2, 8):
        for x in range(18, 28):
            g[y][x] = ID["hierba_alta"]
    for y in range(13, 20):
        for x in range(18, 27):
            g[y][x] = ID["hierba_alta"]
    # flores y árboles sueltos
    for _ in range(18):
        x, y = rnd.randrange(1, W - 1), rnd.randrange(1, H - 1)
        if g[y][x] == ID["cesped"] and o[y][x] == -1:
            g[y][x] = ID["flores"]
    for x, y in ((10, 15), (11, 17), (24, 10), (2, 9)):
        o[y][x] = ID["arbol"]

    first = 1  # firstgid
    def flat(m):
        return [v + first if v >= 0 else 0 for row in m for v in row]

    tiles_meta = []
    for i, (_, props) in enumerate(TILES):
        if props:
            tiles_meta.append({
                "id": i,
                "properties": [{"name": k, "type": "bool", "value": v} for k, v in props.items()],
            })

    tmj = {
        "type": "map", "version": "1.10", "tiledversion": "1.11.0",
        "orientation": "orthogonal", "renderorder": "right-down",
        "width": W, "height": H, "tilewidth": T, "tileheight": T,
        "infinite": False, "nextlayerid": 4, "nextobjectid": 2,
        "layers": [
            {"id": 1, "name": "Suelo", "type": "tilelayer", "width": W, "height": H,
             "x": 0, "y": 0, "opacity": 1, "visible": True, "data": flat(g)},
            {"id": 2, "name": "Obstaculos", "type": "tilelayer", "width": W, "height": H,
             "x": 0, "y": 0, "opacity": 1, "visible": True, "data": flat(o)},
            {"id": 3, "name": "Objetos", "type": "objectgroup", "x": 0, "y": 0,
             "opacity": 1, "visible": True, "draworder": "topdown",
             "objects": [{"id": 1, "name": "inicio", "type": "spawn", "point": True,
                          "x": 6 * T + T / 2, "y": 8 * T + T / 2, "width": 0, "height": 0,
                          "rotation": 0, "visible": True}]},
        ],
        "tilesets": [{
            "firstgid": first, "name": "tiles", "image": "../tilesets/tiles.png",
            "imagewidth": T * len(TILES), "imageheight": T,
            "tilewidth": T, "tileheight": T, "tilecount": len(TILES), "columns": len(TILES),
            "margin": 0, "spacing": 0, "tiles": tiles_meta,
        }],
    }
    (ASSETS / "maps" / "pueblo.tmj").write_text(json.dumps(tmj, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    gen_tileset()
    gen_player()
    gen_map()
    print("Assets generados en", ASSETS)
