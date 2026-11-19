"""Plan A, fase A2: piezas de cara PROVISIONALES de la chibi y recursos del reproductor.

Parte de las capas de chibi_layers.py y del JPG original (solo lectura) y escribe:
  <salida>/assets/*.png          capas y piezas, recortadas y a media resolucion
  <salida>/avatar.manifest.json  descripcion del modelo para el reproductor
  <salida>/hoja-de-contacto.png  las 5 expresiones, bocas, parpadeo y miniaturas

Las piezas dibujadas aqui (parpados, cejas, bocas, rubor) son provisionales:
las definitivas las sustituyen cuando lleguen. Los ojos abiertos y las cejas de
reposo son los pixeles originales del borrador.

Uso: python chibi_pieces.py <origen.jpg> <carpeta_capas> <salida>
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

SCALE = 0.5
PAD = 40
FACE_BOX = (1450, 1000, 2650, 1900)     # x0, y0, x1, y1 en pixeles del original
MIRROR_X = 1996.0                        # eje de simetria de la cara

BG = (0x0E, 0x11, 0x18)
LINE = (1, 1, 1)
SKIN = (0xF5, 0xE1, 0xD3)
SKIN_SHADE = (0xE6, 0xC3, 0xAD)
GAZE_MAX = (30, 14)                      # desplazamiento maximo del iris, en px del original
HAIR_SHADE = (0x7F, 0xBE, 0xDC)
IRIS_SHADE = (0x4F, 0x90, 0xC0)
BLUSH = (0xF4, 0xA9, 0xB0)

FX0, FY0, FX1, FY1 = FACE_BOX
FW, FH = FX1 - FX0, FY1 - FY0
BLUSH_C = (1640, 1548)                   # centro del rubor izquierdo
MODEL_NAME = "Shiro chibi (prototipo)"
CREDITS = ("Diseno original del personaje: borrador original. "
           "Piezas de cara provisionales generadas por codigo.")


def load_pose(path):
    """Sustituye la geometria por la de otra pose (JSON con las mismas claves)."""
    g = globals()
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ("FACE_BOX", "MIRROR_X", "LASH_OPEN", "LASH_CLOSED", "BROW", "MOUTH_C", "BLUSH_C",
                "SCALE", "PAD", "MODEL_NAME", "CREDITS", "GAZE_MAX"):
        if key in cfg:
            g[key] = cfg[key]
    g["FX0"], g["FY0"], g["FX1"], g["FY1"] = g["FACE_BOX"]
    g["FW"], g["FH"] = g["FX1"] - g["FX0"], g["FY1"] - g["FY0"]


# ---------- utilidades de imagen ------------------------------------------------
def read_rgb(path):
    bgr = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)


def read_rgba(path):
    bgra = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_UNCHANGED).astype(np.float32)
    return bgra[..., 2::-1].copy(), bgra[..., 3] / 255.0


def read_mask(path):
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_GRAYSCALE) > 127


def save_rgba(path, rgb, alpha):
    rgba = np.dstack([rgb[..., ::-1], alpha * 255]).clip(0, 255).astype(np.uint8)
    cv2.imencode(".png", rgba)[1].tofile(str(path))


def save_rgb(path, rgb):
    cv2.imencode(".png", rgb[..., ::-1].clip(0, 255).astype(np.uint8))[1].tofile(str(path))


def resize_rgba(rgb, alpha, size):
    """Reduce con alfa premultiplicado para no dejar flecos."""
    pm = cv2.resize(rgb * alpha[..., None], size, interpolation=cv2.INTER_AREA)
    a = cv2.resize(alpha, size, interpolation=cv2.INTER_AREA)
    out = np.divide(pm, a[..., None], out=np.zeros_like(pm), where=a[..., None] > 1e-4)
    return out, a


def over(dst_rgb, dst_a, src_rgb, src_a):
    """Compone src sobre dst (alfa directo). Devuelve (rgb, alfa)."""
    out_a = src_a + dst_a * (1 - src_a)
    num = src_rgb * src_a[..., None] + dst_rgb * (dst_a * (1 - src_a))[..., None]
    out_rgb = np.divide(num, out_a[..., None], out=np.zeros_like(num), where=out_a[..., None] > 1e-4)
    return out_rgb, out_a


class Piece:
    """Lienzo RGBA del tamano de la caja de la cara, en coordenadas del original."""

    def __init__(self):
        self.rgb = np.zeros((FH, FW, 3), np.float32)
        self.a = np.zeros((FH, FW), np.float32)

    def paint(self, mask, color, opacity=1.0):
        src = np.empty_like(self.rgb)
        src[:] = color
        self.rgb, self.a = over(self.rgb, self.a, src, mask * opacity)

    def paste(self, rgb, alpha):
        self.rgb, self.a = over(self.rgb, self.a, rgb, alpha)


# ---------- utilidades de dibujo (coordenadas del original) ----------------------
def bezier(p0, c, p2, n=240):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.array(p0, np.float32) + 2 * (1 - t) * t * np.array(c, np.float32) + t**2 * np.array(p2, np.float32)


def through(p0, apex, p2):
    """Punto de control de una cuadratica que pasa por apex en t=0.5."""
    return (2 * apex[0] - (p0[0] + p2[0]) / 2, 2 * apex[1] - (p0[1] + p2[1]) / 2)


def mirror(pts):
    out = np.array(pts, np.float32).copy()
    out[..., 0] = 2 * MIRROR_X - out[..., 0]
    return out


def stroke_mask(pts, widths):
    """Mascara 0..1 de un trazo de ancho variable (pincel redondo)."""
    m = np.zeros((FH, FW), np.uint8)
    pts = np.asarray(pts, np.float32)
    widths = np.broadcast_to(np.asarray(widths, np.float32), (len(pts),))
    # Muestreo denso para que los circulos se solapen.
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    samples = np.arange(0, d[-1], 1.0)
    xs = np.interp(samples, d, pts[:, 0]) - FX0
    ys = np.interp(samples, d, pts[:, 1]) - FY0
    ws = np.interp(samples, d, widths)
    for x, y, wd in zip(xs, ys, ws):
        cv2.circle(m, (int(round(x * 16)), int(round(y * 16))), max(1, int(round(wd * 8))), 255, -1, cv2.LINE_AA, 4)
    return m.astype(np.float32) / 255.0


def poly_mask(pts):
    m = np.zeros((FH, FW), np.uint8)
    p = (np.asarray(pts, np.float32) - (FX0, FY0)) * 16
    cv2.fillPoly(m, [p.round().astype(np.int32)], 255, cv2.LINE_AA, 4)
    return m.astype(np.float32) / 255.0


def ellipse_mask(center, radii, blur=0.0):
    m = np.zeros((FH, FW), np.uint8)
    c = (int(round((center[0] - FX0) * 16)), int(round((center[1] - FY0) * 16)))
    cv2.ellipse(m, c, (int(radii[0] * 16), int(radii[1] * 16)), 0, 0, 360, 255, -1, cv2.LINE_AA, 4)
    m = m.astype(np.float32) / 255.0
    return cv2.GaussianBlur(m, (0, 0), blur) if blur else m


# ---------- ojos -----------------------------------------------------------------
# Linea central de la pestana superior del ojo izquierdo: abierta y cerrada.
LASH_OPEN = ((1528, 1312), (1685, 1268), (1852, 1308))     # exterior, cima, interior
LASH_CLOSED = ((1532, 1432), (1690, 1470), (1848, 1436))


def lash_curve(level, tilt):
    p0, ap, p2 = (np.array(a, np.float32) * (1 - level) + np.array(b, np.float32) * level
                  for a, b in zip(LASH_OPEN, LASH_CLOSED))
    p2 = p2 + (0, tilt)
    ap = ap + (0, tilt * 0.45)
    return bezier(p0, through(p0, ap, p2), p2)


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def grow(mask, r):
    return cv2.dilate(mask.astype(np.uint8), disk(r)) > 0


def split_eyes(orig_face, eyes_mask):
    """Separa cada ojo en sus partes para poder mover la mirada.

    Devuelve (opening, sclera, iris), mascaras en la caja de la cara:
      opening  hueco del ojo: todo lo que queda dentro del parpado
      sclera   blanco del ojo tal como esta dibujado (con su sombra gris)
      iris     iris completo, con sus brillos y su contorno fino
    """
    from scipy import ndimage

    rgb = orig_face
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    dark = mx < 80
    skin_like = (np.linalg.norm(rgb - np.array(SKIN, np.float32), axis=2) < 30) | (
        np.linalg.norm(rgb - np.array(SKIN_SHADE, np.float32), axis=2) < 30
    )
    # Azulado = iris, incluida la franja oscura que la pestana le sombrea
    # arriba. La pestana es negro puro y no entra.
    blue = eyes_mask & (mx >= 60) & (rgb[..., 2] - rgb[..., 0] > 12)
    # El iris es la envolvente convexa de la mancha azulada mas grande de cada
    # lado: asi entran los brillos, aunque toquen el borde y no sean un hueco.
    iris = np.zeros_like(eyes_mask)
    half = int(round(MIRROR_X - FX0))
    for sl in (np.s_[:, :half], np.s_[:, half:]):
        n, labels, stats, _ = cv2.connectedComponentsWithStats(blue[sl].astype(np.uint8), connectivity=8)
        if n > 1:
            biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            pts = cv2.findNonZero((labels == biggest).astype(np.uint8))
            hull = np.zeros(labels.shape, np.uint8)
            cv2.fillConvexPoly(hull, cv2.convexHull(pts), 1)
            view = iris[sl]
            view |= hull > 0
    # Su contorno es un trazo oscuro fino pegado a el; la pestana es gruesa y no entra.
    thin_dark = dark & ~grow(cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, disk(5)), 3)
    iris = iris | (thin_dark & grow(iris, 5) & eyes_mask)

    sclera = eyes_mask & ~dark & ~blue & ~skin_like & ~iris & (mx > 140) & (mx - mn < 40)
    sclera = cv2.morphologyEx(sclera.astype(np.uint8), cv2.MORPH_OPEN, disk(2)) > 0

    opening = cv2.morphologyEx((sclera | iris).astype(np.uint8), cv2.MORPH_CLOSE, disk(3)) > 0
    opening = ndimage.binary_fill_holes(opening) & grow(eyes_mask, 2)
    return opening, sclera, iris


def iris_piece(orig_face, iris, extra=28):
    """Iris como pieza suelta. Se alarga hacia arriba: esa parte la tapa la
    pestana en el dibujo y solo se ve cuando la mirada baja."""
    piece = Piece()
    rgb = orig_face.copy()
    alpha = iris.astype(np.float32)
    for x in np.unique(np.where(iris)[1]):
        col = np.where(iris[:, x])[0]
        top = col[0]
        src = min(top + 10, col[-1])
        y0 = max(0, top - extra)
        rgb[y0:top, x] = orig_face[src, x]
        alpha[y0:top, x] = 1.0
    piece.paste(rgb, alpha)
    return piece


def eye_state(orig_face, eyes_mask, parts, level, tilt=0.0):
    """Un estado de parpado, en dos piezas: el blanco del ojo y las lineas.

    El iris va aparte y el reproductor lo dibuja entre las dos, recortado por
    el blanco. level 0 = ojo abierto del borrador; 1 = cerrado.
    """
    opening, sclera, _ = parts
    xx = np.arange(FW, dtype=np.float32)[None, :] + FX0
    yy = np.arange(FH, dtype=np.float32)[:, None] + FY0
    hide = np.zeros((FH, FW), bool)
    left = lash_curve(level, tilt)
    if level > 0:
        for pts, side in ((left, xx < MIRROR_X), (mirror(left), xx >= MIRROR_X)):
            order = np.argsort(pts[:, 0])
            y_lid = np.interp(xx[0], pts[order, 0], pts[order, 1])[None, :]
            above = (yy < y_lid + 2) if level < 1 else np.ones((FH, FW), bool)
            hide |= side & above

    white = Piece()
    white_rgb = np.where(sclera[..., None], orig_face, 255.0).astype(np.float32)
    white.paste(white_rgb, (opening & ~hide).astype(np.float32))

    lines = Piece()
    lines.paste(orig_face, (eyes_mask & ~opening & ~hide).astype(np.float32))
    if level > 0:
        w0 = 30 - 13 * level
        t = np.linspace(0, 1, len(left))
        widths = w0 * (0.42 + 0.58 * np.sin(np.pi * t) ** 0.8)
        for pts, out_dir in ((left, -1.0), (mirror(left), 1.0)):
            lines.paint(stroke_mask(pts, widths), LINE)
            tip = pts[0] + (out_dir * 40, 12 + 6 * level)      # colita exterior
            lines.paint(stroke_mask(np.array([pts[0], tip]), [widths[0] + 4, 2]), LINE)
    return white, lines


# ---------- cejas ----------------------------------------------------------------
BROW = dict(outer=(1570, 1128), apex=(1705, 1104), inner=(1838, 1126))


def brow_pts(d_outer=0, d_apex=0, d_inner=0, shift=(0, 0)):
    o = (BROW["outer"][0] + shift[0], BROW["outer"][1] + d_outer + shift[1])
    a = (BROW["apex"][0] + shift[0], BROW["apex"][1] + d_apex + shift[1])
    i = (BROW["inner"][0] + shift[0], BROW["inner"][1] + d_inner + shift[1])
    return bezier(o, through(o, a, i), i)


def brows_piece(left_kw, right_kw):
    piece = Piece()
    t = np.linspace(0, 1, 240)
    widths = 4 + 8 * np.sin(np.pi * t)
    for pts in (brow_pts(**left_kw), mirror(brow_pts(**right_kw))):
        piece.paint(stroke_mask(pts, widths + 4), IRIS_SHADE)
        piece.paint(stroke_mask(pts, widths), HAIR_SHADE)
    return piece


# ---------- bocas ----------------------------------------------------------------
MOUTH_C = (1990, 1637)


def mouth_line(p0, apex, p2, width=6.5):
    piece = Piece()
    pts = bezier(p0, through(p0, apex, p2), p2, 80)
    piece.paint(stroke_mask(pts, width), LINE)
    return piece


def mouth_open(w, h):
    piece = Piece()
    cx, cy = MOUTH_C
    top = bezier((cx - w / 2, cy - h * 0.35), (cx, cy - h * 0.62), (cx + w / 2, cy - h * 0.35), 60)
    bottom = bezier((cx + w / 2, cy - h * 0.35), (cx, cy + h * 1.05), (cx - w / 2, cy - h * 0.35), 60)
    shape = np.vstack([top, bottom])
    inside = poly_mask(shape)
    piece.paint(inside, LINE)
    if h >= 24:  # la lengua asoma en las bocas grandes
        tongue = ellipse_mask((cx, cy + h * 0.42), (w * 0.3, h * 0.2))
        piece.paint(tongue * inside, BLUSH, 0.85)
    return piece


# ---------- programa -------------------------------------------------------------
def main():
    src, layers, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    if len(sys.argv) > 5:
        load_pose(sys.argv[5])
    assets = out / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    layout = json.loads((layers / "layout.json").read_text(encoding="utf-8"))

    rgb = read_rgb(src)
    face = (slice(FY0, FY1), slice(FX0, FX1))
    orig_face = rgb[face]
    m_eyes = read_mask(layers / "mask_eyes.png")[face]
    m_brows = read_mask(layers / "mask_brows.png")[face]

    pieces = {}

    # Ojos. Cada estado de parpado son dos piezas (blanco y lineas); el iris
    # es una pieza aparte que el reproductor mueve entre las dos. Abiertos =
    # borrador; el resto, parpado bajado sobre el borrador.
    parts = split_eyes(orig_face, m_eyes)
    pieces["iris"] = iris_piece(orig_face, parts[2])
    eye_states = {}
    for state, (level, tilt) in {
        "eyes_open": (0.0, 0), "eyes_lid12": (0.12, 0), "eyes_lid22": (0.22, 0),
        "eyes_lid38t": (0.38, 26), "eyes_half": (0.55, 0), "eyes_closed": (1.0, 0),
    }.items():
        white, lines = eye_state(orig_face, m_eyes, parts, level, tilt)
        pieces[f"{state}_lines"] = lines
        eye_states[state] = {"white": None, "lines": f"{state}_lines"}
        if level < 1:
            pieces[f"{state}_white"] = white
            eye_states[state]["white"] = f"{state}_white"
    print(f"ojos: hueco={int(parts[0].sum())} px, blanco={int(parts[1].sum())} px, iris={int(parts[2].sum())} px")

    # Cejas: reposo = borrador; el resto, dibujadas.
    p = Piece()
    p.paste(orig_face, m_brows.astype(np.float32))
    pieces["brows_idle"] = p
    neutral = dict()
    pieces["brows_smirk"] = brows_piece(neutral, dict(shift=(0, -16), d_apex=-4))
    pieces["brows_thinking"] = brows_piece(dict(d_outer=0, d_apex=8, d_inner=20, shift=(9, 2)),
                                           dict(d_outer=-6, d_apex=-2, d_inner=8, shift=(9, -6)))
    pieces["brows_annoyed"] = brows_piece(dict(d_outer=-10, d_apex=8, d_inner=30),
                                          dict(d_outer=-10, d_apex=8, d_inner=30))
    pieces["brows_soft"] = brows_piece(dict(d_outer=9, d_apex=-4, d_inner=-24),
                                       dict(d_outer=9, d_apex=-4, d_inner=-24))

    # Bocas cerradas, una por expresion, y tres aperturas para hablar.
    cx, cy = MOUTH_C
    pieces["mouth_idle"] = mouth_line((cx - 22, cy), (cx, cy), (cx + 22, cy))
    pieces["mouth_smirk"] = mouth_line((cx - 24, cy + 3), (cx + 2, cy + 5), (cx + 26, cy - 11))
    pieces["mouth_thinking"] = mouth_line((cx - 4, cy + 3), (cx + 9, cy + 2), (cx + 22, cy - 1))
    pieces["mouth_annoyed"] = mouth_line((cx - 24, cy + 8), (cx, cy - 7), (cx + 24, cy + 8))
    pieces["mouth_soft"] = mouth_line((cx - 16, cy - 2), (cx, cy + 4), (cx + 16, cy - 2))
    pieces["mouth_open_s"] = mouth_open(32, 14)
    pieces["mouth_open_m"] = mouth_open(40, 27)
    pieces["mouth_open_l"] = mouth_open(46, 42)

    # Rubor: dos manchas suaves bajo los ojos.
    p = Piece()
    bx, by = BLUSH_C
    blush = np.maximum(ellipse_mask((bx, by), (78, 28), 14), ellipse_mask((2 * MIRROR_X - bx, by), (78, 28), 14))
    p.paint(blush, BLUSH, 0.9)
    pieces["blush"] = p

    # ---- Exportar a la resolucion del reproductor --------------------------------
    bx0, by0, bx1, by1 = layout["figure_bbox"]
    bx0, by0, bx1, by1 = bx0 - PAD, by0 - PAD, bx1 + PAD, by1 + PAD
    size = (int(round((bx1 - bx0) * SCALE)), int(round((by1 - by0) * SCALE)))
    face_rect = [int(round((FX0 - bx0) * SCALE)), int(round((FY0 - by0) * SCALE)), int(FW * SCALE), int(FH * SCALE)]

    for stale in assets.glob("eyes_*.png"):   # piezas de ojos de versiones anteriores
        stale.unlink()
    rt = {}
    for name in ("base", "glow", "outline"):
        l_rgb, l_a = read_rgba(layers / f"{name}.png")
        rt[name] = resize_rgba(l_rgb[by0:by1, bx0:bx1], l_a[by0:by1, bx0:bx1], size)
        save_rgba(assets / f"{name}.png", *rt[name])
    for name, piece in pieces.items():
        rt[name] = resize_rgba(piece.rgb, piece.a, (face_rect[2], face_rect[3]))
        save_rgba(assets / f"{name}.png", *rt[name])

    # gaze: mirada de la expresion, de -1 a 1 (x positivo = derecha de la
    # pantalla, y positivo = arriba). setLookAt la sustituye mientras este activa.
    expressions = {
        "idle": dict(eyes="eyes_open", brows="brows_idle", mouth="mouth_idle", blush=0.0, gaze=[0, 0], glow=dict(level=1.0, pattern="steady")),
        "smirk": dict(eyes="eyes_lid22", brows="brows_smirk", mouth="mouth_smirk", blush=0.0, gaze=[0, 0], glow=dict(level=1.0, pattern="flash")),
        "thinking": dict(eyes="eyes_lid12", brows="brows_thinking", mouth="mouth_thinking", blush=0.0, gaze=[0.85, 0.35], glow=dict(level=0.9, pattern="pulse")),
        "annoyed": dict(eyes="eyes_lid38t", brows="brows_annoyed", mouth="mouth_annoyed", blush=0.0, gaze=[0, 0], glow=dict(level=0.7, pattern="steady")),
        "soft": dict(eyes="eyes_open", brows="brows_soft", mouth="mouth_soft", blush=0.45, gaze=[0, -0.4], glow=dict(level=0.6, pattern="steady")),
    }
    gaze_max = [round(GAZE_MAX[0] * SCALE), round(GAZE_MAX[1] * SCALE)]
    manifest = {
        "kind": "sprite-layers",
        "name": MODEL_NAME,
        "version": "0.2",
        "provisional": True,
        "credits": CREDITS,
        "size": list(size),
        "layers": {"outline": "assets/outline.png", "base": "assets/base.png", "glow": "assets/glow.png"},
        "face": {
            "rect": face_rect,
            "pieces": {name: f"assets/{name}.png" for name in pieces},
            "eyes": eye_states,
            "iris": "iris",
            "gaze": {"max": gaze_max},
            "blink": {"open": "eyes_open", "half": "eyes_half", "closed": "eyes_closed", "interval_s": [2.5, 6.0], "duration_ms": 130},
            "mouth_open": ["mouth_open_s", "mouth_open_m", "mouth_open_l"],
            "mouth_thresholds": [0.12, 0.34, 0.6],
            "blush": "blush",
        },
        "expressions": expressions,
        "emotions": {"neutral": "idle", "divertida": "smirk", "pensativa": "thinking", "molesta": "annoyed", "vulnerable": "soft"},
    }
    (out / "avatar.manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- Hoja de contacto ---------------------------------------------------------
    w, h = size
    fx, fy, fw, fh = face_rect

    def eyes_layers(state, gaze):
        """Blanco, iris desplazado y recortado por el blanco, y lineas."""
        st = eye_states[state]
        out_layers = []
        if st["white"]:
            w_rgb, w_a = rt[st["white"]]
            out_layers.append((w_rgb, w_a))
            dx = int(round(gaze[0] * gaze_max[0]))
            dy = int(round(-gaze[1] * gaze_max[1]))
            i_rgb, i_a = (np.roll(arr, (dy, dx), axis=(0, 1)) for arr in rt["iris"])
            out_layers.append((i_rgb, i_a * w_a))
        out_layers.append(rt[st["lines"]])
        return out_layers

    def figure(expr, mouth=None, eyes=None, bg=BG, outline=False, gaze=None):
        e = expressions[expr]
        rgb_c = np.empty((h, w, 3), np.float32)
        rgb_c[:] = bg
        a_c = np.ones((h, w), np.float32)
        if outline:
            rgb_c, a_c = over(rgb_c, a_c, *rt["outline"])
        rgb_c, a_c = over(rgb_c, a_c, *rt["base"])
        sub_rgb, sub_a = rgb_c[fy:fy + fh, fx:fx + fw], a_c[fy:fy + fh, fx:fx + fw]
        for p_rgb, p_a in eyes_layers(eyes or e["eyes"], gaze if gaze is not None else e["gaze"]):
            sub_rgb, sub_a = over(sub_rgb, sub_a, p_rgb, p_a)
        for name, opacity in ((mouth or e["mouth"], 1), ("blush", e["blush"]), (e["brows"], 1)):
            p_rgb, p_a = rt[name]
            sub_rgb, sub_a = over(sub_rgb, sub_a, p_rgb, p_a * opacity)
        rgb_c[fy:fy + fh, fx:fx + fw] = sub_rgb
        g_rgb, g_a = rt["glow"]
        rgb_c, _ = over(rgb_c, a_c, g_rgb, np.clip(g_a * e["glow"]["level"], 0, 1))
        return rgb_c

    def label(img, text):
        img8 = np.ascontiguousarray(img.clip(0, 255).astype(np.uint8))
        cv2.putText(img8, text, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (207, 241, 255), 2, cv2.LINE_AA)
        return img8.astype(np.float32)

    names = list(expressions)
    row1 = [label(cv2.resize(figure(n), (w * 620 // h, 620), interpolation=cv2.INTER_AREA), n) for n in names]
    face_w = row1[0].shape[1]
    face_h = face_w * fh // fw
    crop = lambda img: cv2.resize(img[fy:fy + fh, fx:fx + fw], (face_w, face_h), interpolation=cv2.INTER_AREA)
    row2 = [label(crop(figure(n)), n) for n in names]
    row3 = [label(crop(figure("idle", mouth=m)), t) for m, t in
            (("mouth_idle", "boca cerrada"), ("mouth_open_s", "boca s"), ("mouth_open_m", "boca m"), ("mouth_open_l", "boca l"))]
    row3.append(label(crop(figure("idle", eyes="eyes_half")), "parpadeo medio"))
    row4 = [label(crop(figure("idle", eyes="eyes_closed")), "ojos cerrados"),
            label(crop(figure("soft", mouth="mouth_open_s")), "soft hablando"),
            label(crop(figure("annoyed", mouth="mouth_open_m")), "annoyed hablando")]
    thumbs = np.empty((face_h, face_w * 2, 3), np.float32)
    thumbs[:] = BG
    x = 12
    for bg_c in (BG, (236, 238, 242)):
        for px in (128, 64):
            t_img = cv2.resize(figure("idle", bg=bg_c, outline=True), (px * w // h, px), interpolation=cv2.INTER_AREA)
            thumbs[40:40 + px, x:x + t_img.shape[1]] = t_img
            x += t_img.shape[1] + 16
    row4.append(label(thumbs, "miniaturas 128 y 64 px, oscuro y claro"))
    row5 = [label(crop(figure("idle", gaze=g)), t) for g, t in
            (([-1, 0], "mirada izquierda"), ([1, 0], "mirada derecha"), ([0, 1], "mirada arriba"),
             ([0, -1], "mirada abajo"), ([1, 1], "arriba-derecha"))]

    def hstack(row, width):
        img = np.hstack(row)
        if img.shape[1] < width:
            pad = np.empty((img.shape[0], width - img.shape[1], 3), np.float32)
            pad[:] = BG
            img = np.hstack([img, pad])
        return img

    width = face_w * 5
    sheet = np.vstack([hstack(r, width) for r in (row1, row2, row3, row4, row5)])
    save_rgb(out / "hoja-de-contacto.png", sheet)

    # ---- Comprobacion de paleta ---------------------------------------------------
    palette = json.loads(Path(sys.argv[4]).read_text(encoding="utf-8"))["colors"] if len(sys.argv) > 4 else {}
    if palette:
        cols = np.array([[int(c["hex"][i:i + 2], 16) for i in (1, 3, 5)] for c in palette.values()], np.float32)
        img = figure("idle")
        fig_a = rt["base"][1] > 0.99
        px = img[fig_a]
        d = np.linalg.norm(px[:, None, :] - cols[None, :, :], axis=2).min(axis=1)
        print(f"paleta: {100 * (d < 12).mean():.1f}% de la figura a menos de 12 niveles de un color canonico; "
              f"{100 * (d < 30).mean():.1f}% a menos de 30")

    print(f"size={size} face_rect={face_rect} piezas={len(pieces)}")
    total = sum(f.stat().st_size for f in assets.glob('*.png'))
    print(f"assets={len(list(assets.glob('*.png')))} archivos, {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
