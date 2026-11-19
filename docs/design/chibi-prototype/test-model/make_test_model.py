"""Genera las imagenes del modelo sintetico de prueba del motor de capas.

Son formas de color plano, sin arte del personaje: cada pieza tiene un color
distinto para que un test pueda saber cual se ha dibujado mirando un pixel.
Solo se generan las imagenes; los manifiestos estan escritos a mano junto a
este script.

Uso: python make_test_model.py            (escribe en ./assets)
Requisito: Pillow.
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent / "assets"

SIZE = (120, 200)  # figura completa
FACE = (80, 60)  # caja de la cara (face.rect = [20, 30, 80, 60])

# Ojos, en coordenadas de la caja de la cara. Cada ojo abierto es un
# rectangulo de 20 x 20; el parpado baja el borde superior.
EYE_X = (10, 50)
EYE_W = 20
EYE_TOP = 10
EYE_BOTTOM = 29
# estado -> (pixeles que baja el parpado, color de la linea del parpado)
LIDS = {
    "eyes_open": (0, "#101010"),
    "eyes_lid12": (2, "#201000"),
    "eyes_lid22": (4, "#302000"),
    "eyes_lid38t": (8, "#403000"),
    "eyes_half": (11, "#504000"),
    "eyes_closed": (None, "#605000"),
}
BROWS = {
    "idle": "#804000",
    "smirk": "#904000",
    "thinking": "#A04000",
    "annoyed": "#B04000",
    "soft": "#C04000",
}
MOUTHS = {  # pieza -> (alto, color)
    "mouth_idle": (2, "#A00000"),
    "mouth_smirk": (2, "#A01000"),
    "mouth_thinking": (2, "#A02000"),
    "mouth_annoyed": (2, "#A03000"),
    "mouth_soft": (2, "#A04000"),
    "mouth_open_s": (5, "#D00000"),
    "mouth_open_m": (9, "#D01000"),
    "mouth_open_l": (13, "#D02000"),
}


def blank(size):
    return Image.new("RGBA", size, (0, 0, 0, 0))


def save(img, name):
    OUT.mkdir(exist_ok=True)
    img.save(OUT / f"{name}.png", optimize=True)


def main():
    # ---- capas de figura completa ----
    img = blank(SIZE)
    ImageDraw.Draw(img).rectangle((8, 8, 111, 191), outline="#FF00FF", width=2)
    save(img, "outline")

    img = blank(SIZE)
    d = ImageDraw.Draw(img)
    d.rectangle((10, 10, 109, 189), fill="#404858")  # cuerpo
    d.rectangle((20, 30, 99, 89), fill="#F0D8C8")  # cara en blanco
    save(img, "base")

    img = blank(SIZE)
    d = ImageDraw.Draw(img)
    d.rectangle((20, 120, 27, 127), fill="#FFFFFF")
    d.rectangle((92, 120, 99, 127), fill="#FFFFFF")
    save(img, "glow")

    # ---- ojos: blanco y lineas por estado de parpado ----
    for state, (drop, line) in LIDS.items():
        lines = blank(FACE)
        dl = ImageDraw.Draw(lines)
        if drop is None:  # cerrado: solo una linea abajo
            for x in EYE_X:
                dl.rectangle((x, EYE_BOTTOM - 1, x + EYE_W - 1, EYE_BOTTOM), fill=line)
        else:
            white = blank(FACE)
            dw = ImageDraw.Draw(white)
            top = EYE_TOP + drop
            for x in EYE_X:
                dw.rectangle((x, top, x + EYE_W - 1, EYE_BOTTOM), fill="#FFFFFF")
                dl.rectangle((x, top - 2, x + EYE_W - 1, top - 1), fill=line)
            save(white, f"{state}_white")
        save(lines, f"{state}_lines")

    # ---- iris: cuadrado de 8 x 8 centrado en cada ojo ----
    img = blank(FACE)
    d = ImageDraw.Draw(img)
    for x in EYE_X:
        d.rectangle((x + 6, 16, x + 13, 23), fill="#2060FF")
    save(img, "iris")

    # ---- cejas, bocas y rubor ----
    for name, colour in BROWS.items():
        img = blank(FACE)
        d = ImageDraw.Draw(img)
        for x in EYE_X:
            d.rectangle((x, 3, x + EYE_W - 1, 5), fill=colour)
        save(img, f"brows_{name}")

    for name, (height, colour) in MOUTHS.items():
        img = blank(FACE)
        ImageDraw.Draw(img).rectangle((30, 40, 49, 40 + height - 1), fill=colour)
        save(img, name)

    img = blank(FACE)
    d = ImageDraw.Draw(img)
    d.rectangle((10, 32, 17, 35), fill="#FF80A0")
    d.rectangle((62, 32, 69, 35), fill="#FF80A0")
    save(img, "blush")

    print(f"{len(list(OUT.glob('*.png')))} imagenes en {OUT}")


if __name__ == "__main__":
    main()
