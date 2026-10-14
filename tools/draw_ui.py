"""Pixel art propio del menú de pausa y la mochila (public/assets/ui).

Todo se dibuja a la escala de GBA (la mitad de la pantalla de Essentials) y el juego
lo muestra a x2, como los gráficos de Essentials. Uso: python tools/draw_ui.py
Solo necesita Pillow.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "assets" / "ui"


def rgb(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


class Canvas:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.px: dict[tuple[int, int], tuple] = {}

    def set(self, x: int, y: int, c) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            if c is None:
                self.px.pop((x, y), None)
            else:
                self.px[(x, y)] = c

    def get(self, x: int, y: int):
        return self.px.get((x, y))

    def rect(self, x0, y0, x1, y1, c) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    @staticmethod
    def in_rrect(x, y, x0, y0, x1, y1, r) -> bool:
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6

    def rrect(self, x0, y0, x1, y1, r, fill, line=None) -> None:
        """Rectángulo redondeado; con `line`, con borde de 1 px."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if self.in_rrect(x, y, x0, y0, x1, y1, r):
                    inner = self.in_rrect(x, y, x0 + 1, y0 + 1, x1 - 1, y1 - 1, max(0, r - 1))
                    self.set(x, y, fill if (inner or line is None) else line)

    @staticmethod
    def in_ellipse(x, y, cx, cy, rx, ry) -> bool:
        return ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1

    def ellipse(self, cx, cy, rx, ry, fill, line=None) -> None:
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if self.in_ellipse(x, y, cx, cy, rx, ry):
                    inner = self.in_ellipse(x, y, cx, cy, rx - 1, ry - 1)
                    self.set(x, y, fill if (inner or line is None) else line)

    def shade(self, region, light, dark, cx, cy, k=0.45) -> None:
        """Luz arriba a la izquierda y sombra abajo a la derecha sobre los píxeles de `region`."""
        for (x, y) in region:
            d = (x - cx) + (y - cy)
            c = self.get(x, y)
            if c is None:
                continue
            if d < -k * 20:
                self.set(x, y, light)
            elif d > k * 20:
                self.set(x, y, dark)

    def outline(self, c) -> None:
        """Borde exterior de 1 px alrededor de todo lo dibujado."""
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.get(x, y) is None and any(
                    self.get(x + dx, y + dy) is not None and self.get(x + dx, y + dy)[3] == 255
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                ):
                    add.append((x, y))
        for x, y in add:
            self.set(x, y, c)

    def paste(self, other: "Canvas", ox: int, oy: int, mask=None) -> None:
        for (x, y), c in other.px.items():
            if mask is None or mask(x + ox, y + oy):
                self.set(x + ox, y + oy, c)

    def from_rows(self, rows: list[str], pal: dict[str, tuple], ox=0, oy=0) -> None:
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in pal:
                    self.set(ox + x, oy + y, pal[ch])

    def image(self) -> Image.Image:
        im = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            im.putpixel((x, y), c)
        return im


OUTLINE = rgb("#302018")
WHITE = rgb("#f8f8f8")
GREY_L = rgb("#d0d0d8")
GREY = rgb("#a0a0b0")
GREY_D = rgb("#686878")


# ------------------------------------------------------------------ Poké Balls

def ball(top: str, top_l: str, top_d: str, deco=None) -> Canvas:
    c = Canvas(16, 16)
    cx, cy, r = 8, 8, 6.6
    for y in range(16):
        for x in range(16):
            if not c.in_ellipse(x, y, cx, cy, r, r):
                continue
            upper = y < 7
            if upper:
                d = (x - 5) ** 2 + (y - 4) ** 2
                col = top_l if d < 5 else (top_d if x > 10 or (x + y) > 15 else top)
            else:
                col = GREY_L if (x > 10 or y > 12) else WHITE
            c.set(x, y, rgb(col) if isinstance(col, str) else col)
    c.rect(1, 7, 14, 8, OUTLINE)
    c.ellipse(8, 8, 2.6, 2.6, WHITE, OUTLINE)
    c.set(7, 7, WHITE)
    c.set(8, 8, GREY_L)
    c.set(4, 3, rgb("#f8f8f8"))
    if deco:
        deco(c)
    c.outline(OUTLINE)
    return c


def great_deco(c: Canvas) -> None:
    red = rgb("#e83838")
    for (x, y) in [(3, 4), (3, 5), (4, 3), (12, 4), (12, 5), (11, 3)]:
        c.set(x, y, red)
    for (x, y) in [(2, 5), (2, 6), (13, 5), (13, 6), (4, 4), (11, 4)]:
        c.set(x, y, red)


def ultra_deco(c: Canvas) -> None:
    yel = rgb("#f8d030")
    for y in range(3, 7):
        c.set(4, y, yel)
        c.set(11, y, yel)
    c.set(5, 5, yel)
    c.set(10, 5, yel)
    c.set(4, 2, yel)
    c.set(11, 2, yel)


# ------------------------------------------------------------------ iconos de objetos

def potion() -> Canvas:
    c = Canvas(16, 16)
    pur, pur_l, pur_d = rgb("#a058d0"), rgb("#d098f0"), rgb("#7030a0")
    c.rrect(4, 5, 11, 14, 2, pur)
    for y in range(5, 15):
        c.set(4, y, pur_l) if 6 <= y <= 12 else None
        c.set(10, y, pur_d)
        c.set(11, y, pur_d)
    c.rect(5, 8, 10, 11, WHITE)
    c.rect(7, 8, 8, 11, rgb("#58b8f8"))
    c.rect(6, 9, 9, 10, rgb("#58b8f8"))
    c.rect(6, 3, 9, 4, GREY_L)
    c.rect(9, 3, 9, 4, GREY)
    c.rect(7, 1, 8, 2, GREY)
    c.set(9, 1, GREY_D)
    c.set(10, 1, GREY_D)
    c.outline(OUTLINE)
    return c


def gem() -> Canvas:
    c = Canvas(16, 16)
    rows = [
        "......aaaa......",
        "....aabbbbaa....",
        "...abbccccbba...",
        "..abccddddccba..",
        "..abcdddddddca..",
        ".abcdddddddddca.",
        ".abcdddddddddea.",
        ".abcddddddddeea.",
        ".abccddddddeeea.",
        "..abccdddeeeea..",
        "..aabcceeeeeaa..",
        "...aabbeeeeaa...",
        ".....aaaaaa.....",
    ]
    c.from_rows(rows, {"a": rgb("#285880"), "b": rgb("#98e0f8"), "c": rgb("#68c0f0"), "d": rgb("#3898e0"), "e": rgb("#2870b8")}, 0, 2)
    c.set(5, 5, WHITE)
    c.set(6, 4, WHITE)
    c.set(5, 6, rgb("#c8f0f8"))
    return c


def disc() -> Canvas:
    c = Canvas(16, 16)
    c.ellipse(8, 8, 7, 7, GREY_L, OUTLINE)
    for y in range(16):
        for x in range(16):
            if c.in_ellipse(x, y, 8, 8, 6, 6) and x + y > 17:
                c.set(x, y, GREY)
    c.ellipse(8, 8, 3.6, 3.6, rgb("#f8a030"), OUTLINE)
    c.set(7, 7, OUTLINE)
    c.set(8, 7, OUTLINE)
    c.set(7, 8, OUTLINE)
    c.set(8, 8, OUTLINE)
    c.set(4, 4, WHITE)
    c.set(5, 3, WHITE)
    c.set(3, 5, WHITE)
    return c


def berry() -> Canvas:
    c = Canvas(16, 16)
    c.ellipse(8, 9.5, 6, 5.6, rgb("#3878d8"))
    c.shade(list(c.px), rgb("#78b0f8"), rgb("#2050a0"), 8, 9.5, 0.2)
    c.set(5, 7, WHITE)
    c.set(6, 6, rgb("#c8e0f8"))
    leaf = rgb("#58b838")
    leaf_d = rgb("#307820")
    for (x, y) in [(8, 2), (8, 3), (9, 3), (7, 3), (6, 2), (5, 2), (10, 2), (11, 2), (11, 1), (5, 1)]:
        c.set(x, y, leaf)
    c.set(8, 4, leaf_d)
    c.set(9, 2, leaf_d)
    c.outline(OUTLINE)
    return c


def envelope() -> Canvas:
    c = Canvas(16, 16)
    c.rect(1, 4, 14, 12, rgb("#f8f0d8"))
    for x in range(1, 15):
        d = min(x - 1, 14 - x)
        c.set(x, 4 + d // 1 if d < 5 else 9, rgb("#d8c090"))
    for x in range(1, 15):
        d = min(x - 1, 14 - x)
        if d < 6:
            c.set(x, 4 + d, rgb("#c8a868"))
    c.set(7, 9, rgb("#e84848"))
    c.set(8, 9, rgb("#e84848"))
    c.set(7, 10, rgb("#b82828"))
    c.set(8, 10, rgb("#b82828"))
    c.outline(OUTLINE)
    return c


def x_item() -> Canvas:
    c = Canvas(16, 16)
    red, red_l, red_d = rgb("#e04848"), rgb("#f89090"), rgb("#a02020")
    c.rrect(3, 4, 12, 14, 3, red)
    c.rect(4, 6, 4, 11, red_l)
    c.rect(11, 6, 11, 12, red_d)
    c.rect(4, 13, 11, 13, red_d)
    c.rect(5, 2, 10, 3, rgb("#f8d030"))
    c.rect(10, 2, 10, 3, rgb("#c09818"))
    for k in range(4):
        c.set(6 + k, 7 + k, WHITE)
        c.set(9 - k, 7 + k, WHITE)
    c.outline(OUTLINE)
    return c


def key() -> Canvas:
    c = Canvas(16, 16)
    gold, gold_l, gold_d = rgb("#f8c830"), rgb("#f8f0a0"), rgb("#b88818")
    c.ellipse(5, 5, 4, 4, gold)
    c.ellipse(5, 5, 1.6, 1.6, rgb("#000000", 0))
    for (x, y) in list(c.px):
        if c.get(x, y)[3] == 0:
            c.set(x, y, None)
    for k in range(9):
        c.set(7 + k // 1 if False else 6 + k, 6 + k, gold)
        c.set(7 + k, 6 + k, gold)
    c.set(13, 11, gold)
    c.set(12, 12, gold)
    c.set(11, 13, gold)
    c.set(10, 12, gold)
    c.set(3, 3, gold_l)
    c.set(4, 2, gold_l)
    c.set(8, 9, gold_d)
    c.set(10, 11, gold_d)
    c.outline(OUTLINE)
    return c


# ------------------------------------------------------------------ iconos del menú

def pokedex() -> Canvas:
    c = Canvas(16, 16)
    red, red_l, red_d = rgb("#e03838"), rgb("#f87878"), rgb("#a01818")
    c.rrect(2, 1, 13, 14, 2, red)
    c.rect(3, 2, 3, 12, red_l)
    c.rect(12, 2, 12, 13, red_d)
    c.rect(3, 13, 12, 13, red_d)
    c.rect(4, 5, 11, 10, OUTLINE)
    c.rect(5, 6, 10, 9, rgb("#88d8a8"))
    c.rect(5, 6, 6, 6, rgb("#c8f8d8"))
    c.ellipse(5, 3.2, 1.4, 1.4, rgb("#58b8f8"))
    c.set(4, 2, WHITE)
    c.set(8, 3, rgb("#f8d030"))
    c.set(10, 3, rgb("#58c858"))
    c.rect(9, 11, 11, 11, OUTLINE)
    c.outline(OUTLINE)
    return c


def mini_bag() -> Canvas:
    c = Canvas(16, 16)
    org, org_l, org_d, dark = rgb("#e88030"), rgb("#f8b058"), rgb("#b85818"), rgb("#583010")
    c.rect(5, 1, 10, 1, org_d)
    c.set(5, 2, org_d)
    c.set(10, 2, org_d)
    c.rrect(2, 3, 13, 14, 3, org)
    c.rect(3, 5, 3, 11, org_l)
    c.rect(12, 5, 12, 13, org_d)
    c.rect(3, 13, 12, 13, org_d)
    c.rect(4, 3, 11, 4, dark)
    c.rrect(4, 7, 11, 12, 1, org_d)
    c.rect(5, 8, 10, 11, org)
    c.rect(7, 7, 8, 9, rgb("#f8d850"))
    c.outline(OUTLINE)
    return c


def wallet() -> Canvas:
    c = Canvas(16, 16)
    grn, grn_l, grn_d = rgb("#48a858"), rgb("#88d890"), rgb("#287838")
    c.rrect(1, 5, 14, 14, 2, grn)
    c.rect(2, 6, 13, 6, grn_l)
    c.rect(2, 13, 13, 13, grn_d)
    c.rect(13, 7, 13, 12, grn_d)
    c.rect(8, 8, 14, 11, grn_d)
    c.rect(9, 9, 10, 10, rgb("#f8d030"))
    c.ellipse(6, 4, 3.5, 3.5, rgb("#f8c830"))
    c.ellipse(6, 4, 2, 2, rgb("#f8e078"))
    c.set(5, 3, WHITE)
    c.outline(OUTLINE)
    return c


def save_icon() -> Canvas:
    c = Canvas(16, 16)
    blu, blu_l, blu_d = rgb("#4878d8"), rgb("#88b0f8"), rgb("#2850a0")
    c.rect(2, 1, 13, 14, blu)
    c.rect(2, 1, 13, 1, blu_l)
    c.rect(13, 1, 13, 14, blu_d)
    c.rect(2, 14, 13, 14, blu_d)
    c.rect(4, 2, 11, 7, WHITE)
    c.rect(5, 3, 10, 3, GREY_L)
    c.rect(5, 5, 10, 5, GREY_L)
    c.rect(4, 10, 11, 14, GREY_L)
    c.rect(8, 11, 9, 13, GREY_D)
    c.outline(OUTLINE)
    return c


def exit_icon() -> Canvas:
    c = Canvas(16, 16)
    door, door_l, door_d = rgb("#b07040"), rgb("#d89860"), rgb("#784820")
    c.rect(3, 1, 12, 14, door_d)
    c.rect(4, 2, 11, 14, door)
    c.rect(4, 2, 5, 14, door_l)
    c.rect(9, 7, 10, 8, rgb("#f8d030"))
    c.outline(OUTLINE)
    return c


# ------------------------------------------------------------------ mochila abierta

def bag(lining: str = "#58a8a0", lining_d: str = "#387870") -> Canvas:
    W, H = 72, 72
    c = Canvas(W, H)
    org_l, org, org_d, org_dd = rgb("#f8b058"), rgb("#e88030"), rgb("#b85818"), rgb("#803810")
    stitch = rgb("#f8d098")
    lin, lin_d, lin_l = rgb(lining), rgb(lining_d), rgb("#90d8c8")
    inside, inside_d = rgb("#603418"), rgb("#381c08")
    gold, gold_d = rgb("#f8d850"), rgb("#b89020")

    # Solapa abierta hacia atrás: se ve el forro
    for y in range(6, 28):
        t = (y - 6) / 21
        x0 = round(17 - 8 * t)
        x1 = round(54 + 8 * t)
        for x in range(x0, x1 + 1):
            c.set(x, y, lin)
        if y > 7:
            c.set(x0 + 1, y, lin_l)
            c.set(x1 - 1, y, lin_d)
    for x in range(14, 58):
        c.set(x, 6, None if x < 17 or x > 54 else lin)
    for (x, y) in [(17, 6), (18, 6), (53, 6), (54, 6), (17, 7), (54, 7)]:
        c.set(x, y, None)
    # Costura del forro
    for x in range(20, 52, 2):
        c.set(x, 9, lin_d)
    c.outline(OUTLINE)

    # Cuerpo
    body = Canvas(W, H)
    body.rrect(7, 22, 64, 68, 9, org, OUTLINE)
    for (x, y), col in list(body.px.items()):
        if col != org:
            continue
        if x <= 10:
            body.set(x, y, org_l)
        elif x >= 59 or y >= 64:
            body.set(x, y, org_d)
    # Correas laterales con anilla
    for side in (0, 1):
        x0 = 3 if side == 0 else 64
        body.rect(x0, 33, x0 + 4, 40, org_d)
        body.rect(x0, 33, x0 + 4, 33, OUTLINE)
        body.rect(x0, 40, x0 + 4, 40, OUTLINE)
        body.rect(x0 if side == 0 else x0 + 4, 33, x0 if side == 0 else x0 + 4, 40, OUTLINE)
        body.set(x0 + 2 if side == 0 else x0 + 2, 36, gold)
        body.set(x0 + 2, 37, gold_d)
    c.paste(body, 0, 0)

    # Boca de la mochila: interior oscuro
    ocx, ocy, orx, ory = 36, 26, 25, 7
    c.ellipse(ocx, ocy, orx, ory, inside, OUTLINE)
    for y in range(H):
        for x in range(W):
            if c.in_ellipse(x, y, ocx, ocy + 2, orx - 3, ory - 3):
                c.set(x, y, inside_d)

    # Cosas asomando: Poké Ball, Poción y un mapa enrollado
    peek = Canvas(W, H)
    peek.paste(ball("#e83838", "#f87878", "#b02020"), 17, 15)
    peek.paste(potion(), 34, 11)
    for y in range(13, 28):
        for x in range(47, 53):
            if x in (47, 52) or y == 13:
                peek.set(x, y, OUTLINE)
            else:
                peek.set(x, y, rgb("#f8f0c8") if x < 50 else rgb("#d8c890"))
    peek.rect(48, 16, 51, 16, rgb("#e85838"))

    def above_lip(x, y):
        dx = (x + 0.5 - ocx) / orx
        if abs(dx) >= 1:
            return False
        return y + 0.5 < ocy + ory * math.sqrt(1 - dx * dx) - 1

    c.paste(peek, 0, 0, above_lip)
    # Borde delantero de la boca, con brillo
    for x in range(ocx - orx + 1, ocx + orx):
        dx = (x + 0.5 - ocx) / orx
        if abs(dx) >= 1:
            continue
        y = int(ocy + ory * math.sqrt(1 - dx * dx))
        c.set(x, y - 1, OUTLINE)
        c.set(x, y, org_l)

    # Bolsillo delantero
    c.rrect(15, 41, 56, 65, 6, org, OUTLINE)
    for (x, y) in [(x, y) for x in range(16, 56) for y in range(42, 65)]:
        if c.get(x, y) == org and (x >= 52 or y >= 62):
            c.set(x, y, org_d)
    for x in range(19, 53, 2):
        c.set(x, 61, stitch)
    for y in range(50, 61, 2):
        c.set(18, y, stitch)
        c.set(53, y, stitch)
    # Solapa del bolsillo con hebilla
    c.rrect(15, 41, 56, 50, 5, org_d, OUTLINE)
    for x in range(17, 55):
        if c.get(x, 42) == org_d:
            c.set(x, 42, org)
    for x in range(19, 53, 2):
        c.set(x, 47, rgb("#d88848"))
    c.rect(32, 46, 39, 56, org_dd)
    c.rect(32, 46, 32, 56, OUTLINE)
    c.rect(39, 46, 39, 56, OUTLINE)
    c.rrect(30, 51, 41, 57, 1, gold, OUTLINE)
    c.rect(33, 53, 38, 55, org_dd)
    c.set(31, 52, rgb("#fff8c0"))
    c.rect(41, 52, 41, 56, OUTLINE)
    c.set(40, 56, gold_d)
    # Brillo del cuero
    for (x, y) in [(12, 28), (12, 29), (13, 28), (11, 30), (11, 31)]:
        c.set(x, y, rgb("#fcd8a0"))
    # Sombra en el suelo
    for y in range(66, 72):
        for x in range(W):
            if c.get(x, y) is None and c.in_ellipse(x, y, 36, 69, 30, 3):
                c.set(x, y, (0, 0, 0, 70))
    return c


# ------------------------------------------------------------------ fondo de la mochila

# Posiciones (a escala GBA) que también usa src/scenes/BagScene.ts multiplicadas por 2.
PLATE = (4, 4, 100, 21)
LIST = (106, 4, 251, 135)
DESC = (4, 140, 251, 187)
ICON_BOX = (10, 147, 37, 174)


def panel(c: Canvas, box, fill, line, inner) -> None:
    x0, y0, x1, y1 = box
    c.rrect(x0, y0, x1, y1, 4, line)
    c.rrect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, 3, inner)
    c.rrect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, 2, fill)


def bag_background() -> Canvas:
    c = Canvas(256, 192)
    a, b = rgb("#f8e0a0"), rgb("#f0cc80")
    for y in range(192):
        for x in range(256):
            c.set(x, y, a if ((x + y) // 6) % 2 == 0 else b)
    # Alfombrilla redonda bajo la mochila
    c.ellipse(52, 104, 46, 10, rgb("#e8b868"))
    c.ellipse(52, 104, 42, 8, rgb("#f0c878"))
    panel(c, PLATE, rgb("#e88030"), rgb("#803810"), rgb("#f8b058"))
    panel(c, LIST, rgb("#f8f8f0"), rgb("#b06830"), rgb("#e8d8b8"))
    # Rayado suave de las filas de la lista
    for k in range(8):
        y0 = LIST[1] + 6 + k * 15
        if k % 2:
            c.rect(LIST[0] + 3, y0, LIST[2] - 3, y0 + 14, rgb("#f0ece0"))
    panel(c, DESC, rgb("#405890"), rgb("#182848"), rgb("#6888c8"))
    panel(c, ICON_BOX, rgb("#f8f8f0"), rgb("#182848"), rgb("#c8d0e0"))
    return c


def striped_background(a: str, b: str) -> Canvas:
    """Fondo a rayas diagonales con la barra de ayuda abajo (Equipo y Pokédex)."""
    c = Canvas(256, 192)
    for y in range(192):
        for x in range(256):
            c.set(x, y, rgb(a) if ((x + y) // 6) % 2 == 0 else rgb(b))
    panel(c, (3, 162, 252, 189), rgb("#405890"), rgb("#182848"), rgb("#6888c8"))
    return c


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Iconos del menú de pausa, en este orden: Pokédex, Pokémon, Mochila, Monedero, Guardar, Salir.
    menu = [pokedex(), ball("#e83838", "#f87878", "#b02020"), mini_bag(), wallet(), save_icon(), exit_icon()]
    sheet = Image.new("RGBA", (16 * len(menu), 16))
    for i, ic in enumerate(menu):
        sheet.paste(ic.image(), (16 * i, 0))
    sheet.save(OUT / "menu_iconos.png")
    # Iconos de objetos: uno genérico por bolsillo (1-8) y las Poké Balls concretas.
    items = {
        "bolsillo1": gem(), "bolsillo2": potion(), "bolsillo3": ball("#e83838", "#f87878", "#b02020"),
        "bolsillo4": disc(), "bolsillo5": berry(), "bolsillo6": envelope(), "bolsillo7": x_item(), "bolsillo8": key(),
        "POKEBALL": ball("#e83838", "#f87878", "#b02020"),
        "GREATBALL": ball("#3870d8", "#78a8f8", "#2048a0", great_deco),
        "ULTRABALL": ball("#383840", "#686878", "#202028", ultra_deco),
    }
    names = list(items)
    sheet = Image.new("RGBA", (16 * len(items), 16))
    for i, n in enumerate(names):
        sheet.paste(items[n].image(), (16 * i, 0))
    sheet.save(OUT / "objetos_iconos.png")
    bag().image().save(OUT / "mochila.png")
    bag_background().image().save(OUT / "mochila_fondo.png")
    striped_background("#88c8a8", "#78b898").image().save(OUT / "equipo_fondo.png")
    striped_background("#f09080", "#e07868").image().save(OUT / "pokedex_fondo.png")


if __name__ == "__main__":
    main()
