"""Pixel art propio para el pueblo inicial inspirado en El Puerto de Santa María.

Uso:
    python3 tools/draw_puerto.py

Dibuja con código los edificios y adornos que no existen en los tilesets de
Essentials (castillo de San Marcos, plaza de toros, Iglesia Mayor Prioral,
bodega, casas encaladas, palmeras, el Vapor...) y los guarda como un tileset
de 32x32 en public/assets/historia/tilesets/puerto.png, junto con
puerto.json: dónde empieza cada pieza y qué casillas bloquean el paso.

En la máscara de cada pieza: '#' bloquea, '.' se puede pisar y '^' se pinta
por encima del jugador (copas de árboles, tejados altos) y se puede pisar.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

T = 32
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "assets" / "historia" / "tilesets"
COLS = 16

# Paleta (tonos parecidos a los de Essentials: contornos oscuros de color, no negros).
OUTLINE = (56, 56, 72)
WHITE = (246, 244, 236)
WHITE_SH = (222, 220, 212)
WHITE_DK = (190, 190, 196)
TERRA = (214, 102, 58)
TERRA_HI = (240, 146, 92)
TERRA_SH = (168, 70, 40)
TERRA_DK = (118, 46, 30)
OCHRE = (226, 170, 60)
OCHRE_DK = (176, 120, 30)
ALBERO = (234, 196, 104)
ALBERO_DK = (200, 156, 72)
STONE = (226, 194, 138)
STONE_HI = (244, 220, 172)
STONE_SH = (190, 152, 96)
STONE_DK = (122, 92, 56)
WOOD = (150, 88, 42)
WOOD_DK = (96, 54, 26)
IRON = (44, 44, 52)
GLASS = (70, 96, 140)
GLASS_HI = (120, 160, 200)
GREEN = (60, 140, 80)
GREEN_DK = (34, 92, 52)
LEAF = (70, 150, 64)
LEAF_HI = (124, 196, 88)
LEAF_DK = (36, 98, 46)
BLUE = (48, 104, 184)
BLUE_HI = (104, 156, 224)
RED = (196, 40, 40)
YELLOW = (248, 200, 40)
PINK = (198, 56, 140)
GRAY = (200, 200, 196)
GRAY_SH = (160, 160, 160)


class Pic:
    """Lienzo transparente de w x h casillas con utilidades de dibujo."""

    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * T, h * T), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def px(self, x, y, c):
        if 0 <= x < self.img.width and 0 <= y < self.img.height:
            self.img.putpixel((int(x), int(y)), c + (255,) if len(c) == 3 else c)

    def rect(self, x0, y0, x1, y1, c):
        """Rectángulo relleno con los extremos incluidos."""
        if x1 >= x0 and y1 >= y0:
            self.d.rectangle((x0, y0, x1, y1), fill=c)

    def box(self, x0, y0, x1, y1, fill, line=OUTLINE):
        self.rect(x0, y0, x1, y1, line)
        self.rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, fill)

    def hline(self, x0, x1, y, c):
        self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, y0, x, y1, c)

    def ellipse(self, cx, cy, rx, ry, c):
        self.d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=c)

    def poly(self, pts, c):
        self.d.polygon(pts, fill=c)


# ------------------------------------------------------------------ piezas sueltas

def tile_roof(p: Pic, x0, y0, x1, y1, base=TERRA, hi=TERRA_HI, sh=TERRA_SH, dk=TERRA_DK):
    """Tejado de teja árabe visto desde arriba: canales verticales e hiladas."""
    p.rect(x0, y0, x1, y1, base)
    for x in range(x0, x1 + 1):
        k = (x - x0) % 8
        if k in (1, 2):
            p.vline(x, y0, y1, hi)
        elif k == 6:
            p.vline(x, y0, y1, sh)
        elif k == 7:
            p.vline(x, y0, y1, dk)
    for y in range(y0 + 9, y1, 10):
        for x in range(x0, x1 + 1):
            k = (x - x0) % 8
            p.px(x, y, dk if k in (0, 7) else sh)
            if k in (3, 4):
                p.px(x, y + 1, sh)
    p.hline(x0, x1, y0, dk)
    p.vline(x0, y0, y1, dk)
    p.vline(x1, y0, y1, dk)


def eave(p: Pic, x0, x1, y):
    """Remate del alero: bocas de teja y la sombra sobre la pared."""
    p.hline(x0, x1, y, TERRA_DK)
    for x in range(x0, x1 + 1):
        k = (x - x0) % 8
        c = TERRA_HI if k in (1, 2, 3) else TERRA if k in (0, 4, 5) else TERRA_SH
        p.vline(x, y + 1, y + 4, c)
        if k == 7:
            p.vline(x, y + 1, y + 4, TERRA_DK)
    p.hline(x0, x1, y + 5, TERRA_DK)
    p.hline(x0, x1, y + 6, WHITE_DK)
    p.hline(x0, x1, y + 7, WHITE_SH)


def white_wall(p: Pic, x0, y0, x1, y1, plinth=OCHRE, plinth_dk=OCHRE_DK, plinth_h=10):
    p.rect(x0, y0, x1, y1, WHITE)
    # Textura de cal: motas suaves.
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x * 7 + y * 13) % 29 == 0:
                p.px(x, y, WHITE_SH)
    p.rect(x0, y1 - plinth_h + 1, x1, y1, plinth)
    p.hline(x0, x1, y1 - plinth_h + 1, plinth_dk)
    p.vline(x0, y0, y1, WHITE_DK)
    p.vline(x1, y0, y1, WHITE_DK)
    p.hline(x0, x1, y1, OUTLINE)


def window(p: Pic, x, y, w=20, h=24, shutters=GREEN, pots=True):
    """Ventana con reja de hierro, contraventanas y macetas."""
    p.box(x, y, x + w - 1, y + h - 1, GLASS, IRON)
    p.rect(x + 2, y + 2, x + w - 3, y + 6, GLASS_HI)
    for bx in range(x + 3, x + w - 2, 4):
        p.vline(bx, y + 1, y + h - 2, IRON)
    p.hline(x + 1, x + w - 2, y + h // 2, IRON)
    # Contraventanas abiertas
    p.box(x - 6, y, x - 1, y + h - 1, shutters, OUTLINE)
    p.box(x + w, y, x + w + 5, y + h - 1, shutters, OUTLINE)
    for yy in range(y + 3, y + h - 2, 3):
        p.hline(x - 5, x - 2, yy, GREEN_DK if shutters == GREEN else OUTLINE)
        p.hline(x + w + 1, x + w + 4, yy, GREEN_DK if shutters == GREEN else OUTLINE)
    # Alféizar
    p.rect(x - 2, y + h, x + w + 1, y + h + 2, WHITE_DK)
    if pots:
        for k, px0 in enumerate(range(x + 1, x + w - 4, 7)):
            p.rect(px0, y + h - 4, px0 + 4, y + h - 1, (200, 96, 48))
            p.px(px0 + 1, y + h - 6, RED if k % 2 == 0 else PINK)
            p.px(px0 + 3, y + h - 7, RED if k % 2 == 0 else PINK)
            p.px(px0 + 2, y + h - 5, LEAF)
            p.px(px0 + 0, y + h - 5, LEAF)
            p.px(px0 + 4, y + h - 5, LEAF)


def door(p: Pic, x, y, w=22, h=30, color=WOOD, dark=WOOD_DK):
    """Puerta de madera con arco de medio punto."""
    r = w // 2
    p.ellipse(x + r - 1, y + r, r + 1, r + 1, OUTLINE)
    p.rect(x - 1, y + r, x + w, y + h, OUTLINE)
    p.ellipse(x + r - 1, y + r, r - 1, r - 1, color)
    p.rect(x + 1, y + r, x + w - 2, y + h - 1, color)
    p.vline(x + r - 1, y + 2, y + h - 1, dark)
    for yy in range(y + r, y + h - 2, 6):
        p.px(x + 4, yy, YELLOW)
        p.px(x + w - 5, yy, YELLOW)


def write(p: Pic, x, y, text, c):
    """Letras de 3x5 para los rótulos."""
    font = {
        "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"],
        "D": ["110", "101", "101", "101", "110"], "E": ["111", "100", "110", "100", "111"],
        "G": ["011", "100", "101", "101", "011"], "O": ["010", "101", "101", "101", "010"],
        "S": ["011", "100", "010", "001", "110"], "N": ["101", "111", "111", "101", "101"],
        "R": ["110", "101", "110", "101", "101"], "T": ["111", "010", "010", "010", "010"],
        "M": ["101", "111", "111", "101", "101"], "C": ["011", "100", "100", "100", "011"],
        "I": ["111", "010", "010", "010", "111"], "L": ["100", "100", "100", "100", "111"],
        " ": ["000"] * 5,
    }
    for ch in text:
        for j, row in enumerate(font[ch]):
            for i, b in enumerate(row):
                if b == "1":
                    p.px(x + i, y + j, c)
        x += 4


# ------------------------------------------------------------------ edificios

def casa_a() -> tuple[Pic, list[str]]:
    """Casa encalada de una planta con zócalo de albero (5x4)."""
    p = Pic(5, 4)
    tile_roof(p, 0, 4, 159, 57)
    eave(p, 0, 159, 56)
    white_wall(p, 0, 64, 159, 127)
    window(p, 14, 74, pots=True)
    window(p, 126, 74, pots=True)
    door(p, 69, 92)
    # Farolillo junto a la puerta
    p.rect(100, 82, 104, 88, IRON)
    p.rect(101, 83, 103, 86, YELLOW)
    return p, ["#####", "#####", "#####", "#####"]


def casa_b() -> tuple[Pic, list[str]]:
    """Casa de dos plantas con balcón de forja y buganvilla (5x5)."""
    p = Pic(5, 5)
    tile_roof(p, 0, 4, 159, 57)
    eave(p, 0, 159, 56)
    white_wall(p, 0, 64, 159, 159, plinth=BLUE, plinth_dk=(30, 70, 140), plinth_h=12)
    # Planta alta: balcón central y dos ventanas
    window(p, 16, 72, w=18, h=22, shutters=GREEN, pots=False)
    window(p, 126, 72, w=18, h=22, shutters=GREEN, pots=False)
    p.box(62, 68, 97, 100, GLASS, IRON)
    p.rect(64, 70, 95, 76, GLASS_HI)
    p.vline(79, 69, 99, IRON)
    p.rect(56, 98, 103, 101, WHITE_DK)  # repisa del balcón
    p.hline(56, 103, 86, IRON)
    for bx in range(56, 104, 4):
        p.vline(bx, 86, 98, IRON)
    for bx in range(58, 104, 8):
        p.px(bx, 92, IRON)
    # Buganvilla que cae por la fachada desde el alero
    for k, (bx, by, r) in enumerate(((6, 66, 7), (18, 66, 8), (30, 67, 6), (8, 78, 6), (20, 77, 5), (6, 90, 5), (14, 88, 4), (5, 101, 4))):
        p.ellipse(bx, by, r + 1, r, LEAF_DK)
        p.ellipse(bx, by - 1, r, r - 1, PINK)
        for j in range(r):
            p.px(bx - r // 2 + (j * 3) % r, by - 2 + (j * 5) % max(1, r - 1), (236, 120, 186))
    # Planta baja: ventanas y puerta
    window(p, 14, 116, w=20, h=22, pots=True)
    window(p, 126, 116, w=20, h=22, pots=True)
    door(p, 69, 124, h=35)
    # Azulejo con el número
    p.box(100, 124, 109, 133, (240, 240, 255), BLUE)
    p.rect(103, 127, 106, 130, BLUE)
    return p, ["#####"] * 5


def bodega() -> tuple[Pic, list[str]]:
    """Bodega de vino fino: nave larga encalada, zócalo negro y gran portón (8x4)."""
    p = Pic(8, 4)
    tile_roof(p, 0, 2, 255, 57, base=(196, 92, 56), hi=(226, 130, 84), sh=(150, 62, 38))
    eave(p, 0, 255, 56)
    white_wall(p, 0, 64, 255, 127, plinth=(40, 40, 44), plinth_dk=(20, 20, 24), plinth_h=12)
    # Ventanales altos con reja
    for x in (14, 50, 182, 218):
        p.box(x, 72, x + 21, 108, (60, 70, 70), IRON)
        p.ellipse(x + 10, 74, 10, 6, IRON)
        p.ellipse(x + 10, 74, 9, 5, (60, 70, 70))
        for bx in range(x + 3, x + 20, 4):
            p.vline(bx, 74, 107, IRON)
    # Rótulo
    p.box(92, 66, 163, 78, (250, 240, 214), OUTLINE)
    write(p, 116, 70, "BODEGA", OUTLINE)
    # Portón
    p.box(104, 82, 151, 127, WOOD, OUTLINE)
    p.vline(127, 83, 126, WOOD_DK)
    for y in range(88, 126, 8):
        p.hline(105, 150, y, WOOD_DK)
    # Barricas junto a la entrada
    for x in (78, 160):
        p.ellipse(x + 8, 116, 9, 10, OUTLINE)
        p.ellipse(x + 8, 116, 8, 9, (150, 92, 48))
        p.hline(x + 1, x + 15, 112, (90, 60, 40))
        p.hline(x + 1, x + 15, 120, (90, 60, 40))
    return p, ["########"] * 4


def castillo() -> tuple[Pic, list[str]]:
    """Castillo de San Marcos: murallas almenadas, torres y la torre del homenaje (8x6)."""
    p = Pic(8, 6)
    W, H = 256, 192

    def block(x0, x1, top, face, crenels=True):
        # Superficie superior (adarve)
        p.box(x0, top, x1, face, STONE_HI, STONE_DK)
        for y in range(top + 6, face, 6):
            p.hline(x0 + 1, x1 - 1, y, STONE)
        # Paramento
        p.box(x0, face, x1, H - 1, STONE, STONE_DK)
        for y in range(face + 1, H - 1):
            row = (y - face) // 6
            if (y - face) % 6 == 0:
                p.hline(x0 + 1, x1 - 1, y, STONE_SH)
            else:
                for x in range(x0 + 1 + (row % 2) * 6, x1, 12):
                    p.px(x, y, STONE_SH)
        p.vline(x0 + 1, face + 1, H - 2, STONE_HI)
        p.vline(x1 - 1, face + 1, H - 2, STONE_SH)
        # Almenas sobre el borde del paramento
        if crenels:
            for x in range(x0 + 2, x1 - 5, 10):
                p.box(x, face - 7, x + 6, face + 1, STONE_HI, STONE_DK)
                p.rect(x + 1, face + 2, x + 5, face + 3, STONE_SH)

    # Cortinas de muralla
    block(56, 200, 60, 92)
    # Torres de las esquinas
    block(0, 63, 22, 50)
    block(192, 255, 22, 50)
    # Torre del homenaje
    block(92, 163, 8, 36)
    # Bandera
    p.vline(128, 0, 30, OUTLINE)
    p.rect(129, 2, 145, 5, RED)
    p.rect(129, 6, 145, 11, YELLOW)
    p.rect(129, 12, 145, 15, RED)
    # Saeteras
    for x, y in ((30, 80), (222, 80), (30, 130), (222, 130), (110, 70), (144, 70)):
        p.rect(x, y, x + 2, y + 12, (60, 44, 30))
    # Puerta con arco y rastrillo
    p.ellipse(127, 140, 18, 18, STONE_DK)
    p.rect(109, 140, 145, H - 1, STONE_DK)
    p.ellipse(127, 140, 15, 15, (52, 36, 24))
    p.rect(112, 140, 142, H - 1, (52, 36, 24))
    for x in range(115, 142, 5):
        p.vline(x, 128, H - 6, (110, 100, 90))
    for y in range(132, H - 4, 8):
        p.hline(112, 142, y, (110, 100, 90))
    # Escudo sobre la puerta
    p.box(120, 104, 135, 118, (220, 60, 50), STONE_DK)
    p.rect(124, 108, 131, 114, YELLOW)
    return p, ["#" * 8] * 6


def prioral() -> tuple[Pic, list[str]]:
    """Iglesia Mayor Prioral: nave con portada gótica y campanario (6x7)."""
    p = Pic(6, 7)
    H = 224
    # Nave: tejado y fachada de piedra
    tile_roof(p, 0, 34, 131, 103, base=(200, 110, 70), hi=(226, 146, 100), sh=(160, 80, 50), dk=(110, 54, 34))
    p.box(0, 100, 131, H - 1, STONE, STONE_DK)
    for y in range(106, H - 1, 8):
        p.hline(1, 130, y, STONE_SH)
    # Contrafuertes
    for x in (0, 124):
        p.box(x, 96, x + 8, H - 1, STONE_HI, STONE_DK)
    # Rosetón
    p.ellipse(66, 128, 13, 13, STONE_DK)
    p.ellipse(66, 128, 11, 11, (120, 60, 140))
    for a in range(0, 360, 45):
        p.d.line((66, 128, 66 + 11 * math.cos(math.radians(a)), 128 + 11 * math.sin(math.radians(a))), fill=YELLOW)
    p.ellipse(66, 128, 3, 3, RED)
    # Portada ojival con arquivoltas
    for k, c in enumerate((STONE_DK, STONE_HI, STONE_SH, STONE_HI)):
        r = 26 - k * 4
        p.poly([(66 - r, H - 1), (66 - r, 182), (66, 182 - r - 14), (66 + r, 182), (66 + r, H - 1)], c)
    p.poly([(52, H - 1), (52, 186), (66, 164), (80, 186), (80, H - 1)], WOOD_DK)
    p.rect(54, 188, 78, H - 1, WOOD)
    p.vline(66, 176, H - 1, WOOD_DK)
    # Campanario
    p.box(136, 60, 191, H - 1, STONE, STONE_DK)
    for y in range(66, H - 1, 8):
        p.hline(137, 190, y, STONE_SH)
    p.vline(137, 61, H - 2, STONE_HI)
    p.box(132, 50, 195, 62, STONE_HI, STONE_DK)
    # Cuerpo de campanas
    p.box(140, 18, 187, 52, STONE_HI, STONE_DK)
    for x in (146, 168):
        p.ellipse(x + 7, 30, 7, 7, (50, 40, 36))
        p.rect(x, 30, x + 14, 50, (50, 40, 36))
        p.poly([(x + 3, 46), (x + 7, 34), (x + 11, 46)], (214, 170, 60))
    # Chapitel con cruz
    p.poly([(138, 18), (163, 2), (189, 18)], TERRA_SH)
    p.poly([(146, 16), (163, 5), (163, 16)], TERRA)
    p.vline(163, 0, 4, OUTLINE)
    p.hline(161, 165, 1, OUTLINE)
    # Reloj
    p.ellipse(163, 84, 9, 9, STONE_DK)
    p.ellipse(163, 84, 7, 7, (250, 250, 240))
    p.vline(163, 79, 84, OUTLINE)
    p.hline(163, 167, 84, OUTLINE)
    mask = [".....#"] * 1 + ["....##"] + ["######"] * 5
    return p, mask


def plaza_toros() -> tuple[Pic, list[str]]:
    """Plaza de toros: coso redondo con albero, tendidos y fachada de arcos (10x7)."""
    p = Pic(10, 7)
    cx, cy, rx, ry = 160, 84, 156, 80
    wall_h = 56
    # Fachada curva (la mitad delantera del cilindro)
    for x in range(cx - rx, cx + rx + 1):
        dx = (x - cx) / rx
        yb = cy + ry * math.sqrt(max(0.0, 1 - dx * dx))
        for y in range(int(yb) - 2, int(yb) + wall_h):
            shade = WHITE if abs(dx) < 0.6 else WHITE_SH if abs(dx) < 0.85 else WHITE_DK
            p.px(x, y, shade)
        p.px(x, int(yb) + wall_h, OUTLINE)
        p.px(x, int(yb) + wall_h - 1, OCHRE_DK)
        p.px(x, int(yb) + 22, OCHRE)
        p.px(x, int(yb) + 23, OCHRE_DK)
    # Arcos en dos alturas, siguiendo la curva
    for k in range(-9, 10):
        x = cx + k * 16
        dx = (x - cx) / rx
        if abs(dx) > 0.92:
            continue
        yb = cy + ry * math.sqrt(1 - dx * dx)
        squash = math.sqrt(1 - dx * dx)
        aw = max(2, int(5 * squash))
        for top, hgt in ((yb + 4, 14), (yb + 28, 22)):
            p.ellipse(x, top + aw, aw + 1, aw + 1, OCHRE_DK)
            p.rect(x - aw - 1, top + aw, x + aw + 1, top + hgt, OCHRE_DK)
            p.ellipse(x, top + aw, aw, aw, (70, 56, 50))
            p.rect(x - aw, top + aw, x + aw, top + hgt, (70, 56, 50))
    # Puerta grande
    yb = cy + ry
    p.ellipse(cx, yb + 30, 12, 12, OCHRE_DK)
    p.rect(cx - 12, yb + 30, cx + 12, yb + wall_h - 2, OCHRE_DK)
    p.ellipse(cx, yb + 30, 10, 10, RED)
    p.rect(cx - 10, yb + 30, cx + 10, yb + wall_h - 2, RED)
    p.vline(cx, yb + 22, yb + wall_h - 2, (120, 20, 20))
    p.box(cx - 14, yb + 6, cx + 14, yb + 16, (240, 240, 255), BLUE)
    write(p, cx - 11, yb + 9, "TOROS", BLUE)
    # Anillos vistos desde arriba: tejado, tendidos, barrera y albero
    p.ellipse(cx, cy, rx, ry, OUTLINE)
    p.ellipse(cx, cy, rx - 1, ry - 1, TERRA)
    for k in range(0, 14, 3):
        p.d.ellipse((cx - rx + 2 + k, cy - ry + 2 + k, cx + rx - 2 - k, cy + ry - 2 - k), outline=TERRA_SH)
    p.ellipse(cx, cy, rx - 16, ry - 14, TERRA_DK)
    p.ellipse(cx, cy, rx - 18, ry - 16, GRAY)
    for k in range(0, 24, 4):
        p.d.ellipse((cx - rx + 18 + k, cy - ry + 16 + k * 0.6, cx + rx - 18 - k, cy + ry - 16 - k * 0.6), outline=GRAY_SH)
    p.ellipse(cx, cy, rx - 44, ry - 34, (140, 30, 30))
    p.ellipse(cx, cy, rx - 46, ry - 36, ALBERO)
    p.d.ellipse((cx - rx + 60, cy - ry + 46, cx + rx - 60, cy + ry - 46), outline=ALBERO_DK)
    p.d.ellipse((cx - 30, cy - 14, cx + 30, cy + 14), outline=(250, 250, 250))
    # Sombra del tendido sobre la arena (mitad norte)
    for x in range(cx - rx + 47, cx + rx - 46):
        dx = (x - cx) / (rx - 46)
        if abs(dx) >= 1:
            continue
        yt = cy - (ry - 36) * math.sqrt(1 - dx * dx)
        for y in range(int(yt) + 1, int(yt) + 6):
            c = p.img.getpixel((x, y))
            if c[:3] == ALBERO:
                p.px(x, y, ALBERO_DK)
    mask = []
    for ty in range(7):
        row = ""
        for tx in range(10):
            a = sum(1 for yy in range(ty * T, ty * T + T, 4) for xx in range(tx * T, tx * T + T, 4)
                    if p.img.getpixel((xx, yy))[3] > 0)
            row += "#" if a > 20 else "."
        mask.append(row)
    return p, mask


# ------------------------------------------------------------------ adornos

def palmera() -> tuple[Pic, list[str]]:
    """Palmera de tronco anillado (3x3; el tronco ocupa la casilla central de abajo)."""
    p = Pic(3, 3)
    # Sombra
    p.ellipse(48, 90, 12, 4, (0, 0, 0, 60))
    # Tronco con algo de curva
    for y in range(34, 92):
        x = 48 + int(3 * math.sin((y - 34) / 20))
        p.rect(x - 4, y, x + 4, y, (150, 110, 70))
        p.px(x - 4, y, (96, 66, 40))
        p.px(x + 4, y, (96, 66, 40))
        if y % 5 == 0:
            p.hline(x - 3, x + 3, y, (110, 80, 50))
        p.px(x - 2, y, (186, 146, 100))
    # Hojas
    top = (50, 32)
    for ang, length in ((-170, 42), (-140, 44), (-110, 34), (-70, 34), (-40, 44), (-10, 42), (20, 34), (160, 34), (90, 22)):
        a = math.radians(ang)
        pts = []
        for i in range(length):
            t = i / length
            x = top[0] + math.cos(a) * i
            y = top[1] + math.sin(a) * i + 16 * t * t
            pts.append((x, y))
        for i, (x, y) in enumerate(pts):
            t = i / length
            wdt = 4 * (1 - t) + 1
            p.ellipse(x, y, wdt + 1, wdt * 0.7 + 1, LEAF_DK)
        for i, (x, y) in enumerate(pts):
            t = i / length
            wdt = 4 * (1 - t) + 0.5
            p.ellipse(x, y, wdt, wdt * 0.6, LEAF if i % 4 else LEAF_HI)
    p.ellipse(50, 33, 5, 4, (120, 90, 50))
    for x, y in ((46, 36), (54, 37), (50, 38)):
        p.ellipse(x, y, 2, 2, (200, 140, 40))
    return p, ["^^^", "^^^", ".#."]


def naranjo() -> tuple[Pic, list[str]]:
    """Naranjo de calle (1x2)."""
    p = Pic(1, 2)
    p.ellipse(16, 58, 9, 3, (0, 0, 0, 60))
    p.box(13, 36, 18, 58, (130, 90, 56), (80, 54, 32))
    p.ellipse(16, 24, 15, 16, LEAF_DK)
    p.ellipse(16, 23, 13, 14, LEAF)
    for x, y in ((9, 16), (18, 12), (22, 22), (12, 26), (20, 30), (8, 22), (16, 20)):
        p.ellipse(x, y, 3, 3, LEAF_HI if (x + y) % 3 else LEAF)
    for x, y in ((7, 20), (14, 14), (23, 18), (19, 27), (11, 31), (24, 28), (16, 24)):
        p.rect(x, y, x + 2, y + 2, (240, 140, 30))
        p.px(x, y, (255, 200, 90))
    p.d.ellipse((1, 7, 31, 39), outline=OUTLINE)
    return p, ["^", "#"]


def farola() -> tuple[Pic, list[str]]:
    """Farola isabelina de hierro (1x2)."""
    p = Pic(1, 2)
    p.ellipse(16, 60, 6, 2, (0, 0, 0, 70))
    p.rect(14, 22, 17, 60, IRON)
    p.rect(12, 56, 19, 60, IRON)
    p.rect(11, 34, 20, 36, IRON)
    p.poly([(9, 8), (16, 2), (23, 8)], IRON)
    p.box(9, 8, 22, 20, (255, 230, 140), IRON)
    p.rect(11, 10, 20, 18, (255, 244, 190))
    p.rect(10, 20, 21, 22, IRON)
    return p, ["^", "#"]


def azulejo() -> tuple[Pic, list[str]]:
    """Cartel de azulejo sobre poste (1x1)."""
    p = Pic(1, 1)
    p.rect(14, 18, 17, 31, WOOD_DK)
    p.box(3, 3, 28, 20, (240, 244, 255), (30, 60, 130))
    p.rect(5, 5, 26, 18, (240, 244, 255))
    for x in range(5, 27, 2):
        p.px(x, 5, BLUE)
        p.px(x, 18, BLUE)
    for y in range(9, 15, 2):
        p.hline(8, 23, y, BLUE_HI if y % 4 else BLUE)
    return p, ["#"]


def toro() -> tuple[Pic, list[str]]:
    """El toro de Osborne en su valla, sobre un altillo (4x3)."""
    p = Pic(4, 3)
    # Andamio
    for x in (30, 64, 98):
        p.rect(x, 50, x + 2, 92, (110, 110, 120))
    p.d.line((30, 60, 98, 86), fill=(110, 110, 120))
    p.d.line((30, 86, 98, 60), fill=(110, 110, 120))
    # Silueta del toro (mirando a la izquierda)
    B = (20, 18, 22)
    ox, oy = 14, 8

    def pt(x, y):
        return (ox + x, oy + y)

    p.ellipse(*pt(58, 32), 28, 13, B)                     # cuerpo
    p.ellipse(*pt(36, 24), 13, 13, B)                     # morrillo
    p.poly([pt(34, 14), pt(18, 20), pt(8, 30), pt(4, 38), pt(10, 44), pt(20, 42), pt(36, 36)], B)  # cabeza
    p.ellipse(*pt(14, 24), 6, 5, B)                       # testuz
    for pts in ((pt(14, 22), pt(9, 15), pt(10, 6)), (pt(20, 19), pt(18, 11), pt(21, 3))):
        p.d.line(pts, fill=B, width=4)                    # cuernos
    for a, b in ((pt(31, 40), pt(29, 62)), (pt(41, 42), pt(43, 62)), (pt(72, 40), pt(73, 62)), (pt(81, 38), pt(86, 60))):
        p.d.line((a, b), fill=B, width=5)                 # patas
    p.d.line((pt(85, 28), pt(92, 38), pt(90, 52)), fill=B, width=2)  # rabo
    p.ellipse(*pt(90, 54), 2, 4, B)
    return p, ["^^^^", "^^^^", ".##."]


def vapor() -> tuple[Pic, list[str]]:
    """El Vapor del Puerto, amarrado en el río (5x2)."""
    p = Pic(5, 2)
    W = 160
    p.ellipse(80, 54, 76, 8, (30, 60, 110, 90))
    p.poly([(4, 30), (156, 30), (146, 56), (14, 56)], OUTLINE)
    p.poly([(6, 31), (154, 31), (144, 54), (16, 54)], WHITE)
    p.rect(10, 44, 150, 48, BLUE)
    p.rect(14, 50, 146, 54, RED)
    # Cubierta y cabina
    p.box(40, 10, 120, 32, WHITE, OUTLINE)
    for x in range(46, 116, 12):
        p.box(x, 16, x + 7, 24, GLASS_HI, OUTLINE)
    p.rect(36, 6, 124, 10, (90, 140, 200))
    # Chimenea
    p.box(124, 0, 134, 22, (220, 220, 210), OUTLINE)
    p.rect(125, 3, 133, 7, RED)
    # Barandilla de proa
    for x in range(10, 38, 4):
        p.vline(x, 24, 31, OUTLINE)
    p.hline(8, 38, 24, OUTLINE)
    return p, ["#####", "#####"]


def puesto_marisco() -> tuple[Pic, list[str]]:
    """Puesto de la Ribera del Marisco: toldo a rayas y mostrador (3x2)."""
    p = Pic(3, 2)
    # Toldo
    p.box(0, 4, 95, 26, WHITE, OUTLINE)
    for x in range(1, 95, 12):
        p.rect(x, 5, x + 5, 25, BLUE)
    for x in range(0, 96, 8):
        p.ellipse(x + 4, 27, 4, 3, BLUE if (x // 8) % 2 == 0 else WHITE)
    # Mostrador
    p.box(4, 34, 91, 60, (190, 140, 90), OUTLINE)
    p.rect(6, 36, 89, 44, (230, 230, 236))
    for k, x in enumerate(range(10, 86, 6)):
        c = (240, 120, 110) if k % 3 else (220, 60, 50)
        p.ellipse(x, 40, 3, 2, c)
    p.box(30, 46, 65, 56, WHITE, OUTLINE)
    write(p, 34, 49, "MARISCO", BLUE)
    return p, ["###", "###"]


def puente() -> tuple[Pic, list[str]]:
    """Tablero de un puente de piedra que cruza el río de oeste a este (1x2)."""
    p = Pic(1, 2)
    p.rect(0, 0, 31, 63, (196, 186, 170))
    for y in range(10, 54, 8):
        p.hline(0, 31, y, (176, 166, 150))
    for x in (0, 16):
        p.vline(x, 8, 55, (176, 166, 150))
    # Pretiles
    p.rect(0, 0, 31, 7, (228, 222, 210))
    p.hline(0, 31, 7, OUTLINE)
    p.hline(0, 31, 0, OUTLINE)
    for x in range(2, 32, 8):
        p.rect(x, 2, x + 3, 5, (196, 186, 170))
    p.rect(0, 56, 31, 63, (228, 222, 210))
    p.hline(0, 31, 56, OUTLINE)
    p.hline(0, 31, 63, OUTLINE)
    for x in range(2, 32, 8):
        p.rect(x, 58, x + 3, 61, (196, 186, 170))
    return p, [".", "."]


def sombrilla(color) -> tuple[Pic, list[str]]:
    """Sombrilla de playa a rayas con su toalla (1x2)."""
    p = Pic(1, 2)
    p.rect(6, 44, 27, 60, (240, 240, 250))
    p.rect(6, 44, 27, 47, color)
    p.rect(6, 52, 27, 55, color)
    p.rect(15, 14, 16, 46, (110, 110, 120))
    p.ellipse(16, 14, 15, 9, OUTLINE)
    p.ellipse(16, 14, 14, 8, WHITE)
    for k in range(-14, 15, 7):
        p.poly([(16, 6), (16 + k - 3, 22), (16 + k + 3, 22)], color if (k // 7) % 2 == 0 else WHITE)
    p.d.ellipse((2, 6, 30, 22), outline=OUTLINE)
    p.ellipse(16, 6, 2, 2, OUTLINE)
    return p, ["^", "."]


PIECES = {
    "sombrilla_roja": lambda: sombrilla(RED), "sombrilla_azul": lambda: sombrilla(BLUE),
    "casa_a": casa_a, "casa_b": casa_b, "bodega": bodega, "castillo": castillo,
    "prioral": prioral, "plaza_toros": plaza_toros, "palmera": palmera, "naranjo": naranjo,
    "farola": farola, "azulejo": azulejo, "toro": toro, "vapor": vapor,
    "puesto_marisco": puesto_marisco, "puente": puente,
}


def main() -> None:
    drawn = {name: fn() for name, fn in PIECES.items()}
    # Empaquetado en estantes de COLS casillas de ancho.
    x = y = shelf = 0
    placed = {}
    for name, (pic, mask) in sorted(drawn.items(), key=lambda kv: -kv[1][0].h):
        if x + pic.w > COLS:
            x, y, shelf = 0, y + shelf, 0
        placed[name] = (x, y)
        x += pic.w
        shelf = max(shelf, pic.h)
    rows = y + shelf
    sheet = Image.new("RGBA", (COLS * T, rows * T), (0, 0, 0, 0))
    info = {}
    for name, (pic, mask) in drawn.items():
        px, py = placed[name]
        assert len(mask) == pic.h and all(len(r) == pic.w for r in mask), name
        sheet.alpha_composite(pic.img, (px * T, py * T))
        info[name] = {"origen": py * COLS + px, "ancho": pic.w, "alto": pic.h, "mascara": mask}
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / "puerto.png", optimize=True)
    (OUT / "puerto.json").write_text(json.dumps({"columnas": COLS, "piezas": info}, ensure_ascii=False, indent=1))
    print(f"{len(info)} piezas -> {OUT / 'puerto.png'} ({COLS}x{rows} casillas)")


if __name__ == "__main__":
    main()
