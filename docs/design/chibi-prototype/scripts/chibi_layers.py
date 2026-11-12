"""Plan A, fase A1: separa la chibi de la silla (shiro proto4) en capas.

Lee el JPG original (solo lectura) y escribe en <salida>/:
  base.png           figura sin lineas de circuito y con la cara en blanco
  glow.png           lineas de circuito y su halo (blanco con alfa)
  face_original.png  ojos, cejas y boca del borrador (para recomponer el original)
  hair_front.png     pelo que cae sobre la cara (va por encima de las piezas de cara)
  outline.png        contorno de luz opcional (color del halo)
  layout.json        tamano, orden de capas y anclas de la cara
  debug_*.png        vistas reducidas para revisar

Uso: python chibi_layers.py <origen.jpg> <carpeta_salida>
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

# Paleta canonica (RGB).
BG = np.array([0x0E, 0x11, 0x18], np.float32)
UNI = np.array([0x1B, 0x22, 0x33], np.float32)
WHITE = np.array([255, 255, 255], np.float32)
SKIN = np.array([0xF5, 0xE1, 0xD3], np.float32)
SKIN_SHADE = np.array([0xE6, 0xC3, 0xAD], np.float32)
HAIR = np.array([0xBB, 0xE2, 0xF2], np.float32)
HAIR_SHADE = np.array([0x7F, 0xBE, 0xDC], np.float32)
HAIR_LIGHT = np.array([0xE9, 0xF7, 0xFF], np.float32)
HALO = np.array([0xCF, 0xF1, 0xFF], np.float32)

# Geometria en pixeles del original (medida a ojo sobre recortes ampliados).
Y_CLOTHES = 1880                      # por debajo de aqui empieza la ropa
Y_SHOES = 3480                        # por debajo de aqui solo hay zapatos y silla
EYES = {                              # elipse ajustada al ojo: centro y radios
    "left": dict(c=(1685, 1372), r=(205, 142)),
    "right": dict(c=(2300, 1368), r=(212, 144)),
}
CREASES = [(1735, 1218, 1845, 1262), (2145, 1218, 2255, 1262)]   # pliegue del parpado
MOUTH = (1945, 1612, 2035, 1660)
BROWS = {"left": (1555, 1090, 1850, 1150), "right": (2130, 1090, 2435, 1150)}
FACE_BOX = (1450, 1000, 2650, 1900)   # zona donde el pelo puede tapar la cara
LINE_HALO_MIN = 0.18                  # halo minimo para que un trazo fino cuente como circuito
TRIM_BOXES = []                       # zonas donde todo blanco es ribete, nunca circuito


def load_pose(path):
    """Sustituye la geometria por la de otra pose (JSON con las mismas claves)."""
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ("Y_CLOTHES", "Y_SHOES", "EYES", "CREASES", "MOUTH", "BROWS", "FACE_BOX",
                "LINE_HALO_MIN", "TRIM_BOXES"):
        if key in cfg:
            globals()[key] = cfg[key]


def dist(rgb, color):
    return np.linalg.norm(rgb - color, axis=2)


def fit_white_over(rgb, base):
    span = WHITE - base
    a = ((rgb - base) / span).mean(axis=2)
    res = np.linalg.norm(rgb - (base + a[..., None] * span), axis=2)
    return np.clip(a, 0, 1), res


def save_rgba(path, rgb, alpha):
    rgba = np.dstack([rgb[..., ::-1], alpha * 255]).clip(0, 255).astype(np.uint8)
    cv2.imencode(".png", rgba)[1].tofile(str(path))


def save_rgb(path, rgb, width=None):
    img = rgb
    if width:
        img = cv2.resize(img, (width, width * img.shape[0] // img.shape[1]), interpolation=cv2.INTER_AREA)
    cv2.imencode(".png", img[..., ::-1].clip(0, 255).astype(np.uint8))[1].tofile(str(path))


def compose(layers, bg, shape):
    canvas = np.empty(shape, np.float32)
    canvas[:] = bg
    for rgb, alpha in layers:
        canvas = canvas * (1 - alpha[..., None]) + rgb * alpha[..., None]
    return canvas


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def grow(mask, r):
    return cv2.dilate(mask.astype(np.uint8), disk(r)) > 0


def nearest_fill(image, mask, source):
    """Devuelve image con los pixeles de mask copiados del pixel de source mas cercano."""
    _, idx = ndimage.distance_transform_edt(~source, return_indices=True)
    out = image.copy()
    out[mask] = image[idx[0], idx[1]][mask]
    return out


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    if len(sys.argv) > 3:
        load_pose(sys.argv[3])
    out.mkdir(parents=True, exist_ok=True)
    bgr = cv2.imdecode(np.fromfile(str(src), np.uint8), cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    h, w = rgb.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]

    # ---- 1. Alfa de la figura ------------------------------------------------
    # El borde suavizado entre una linea negra y el uniforme pasa por el color
    # del fondo. Por eso solo cuenta como fondo lo que es ancho: sobrevive a una
    # apertura. Las lineas finas de ese color quedan opacas.
    d_bg = dist(rgb, BG)
    bg_like = (d_bg < 12).astype(np.uint8)
    bg_core = cv2.morphologyEx(bg_like, cv2.MORPH_OPEN, disk(6))
    bg = grow(bg_core, 8) & (bg_like > 0)
    alpha = np.where(grow(bg, 4), np.clip((d_bg - 6) / 10, 0, 1), 1.0).astype(np.float32)

    # ---- 2. Blancos: lineas de circuito frente a ribetes ----------------------
    a_uni, r_uni = fit_white_over(rgb, UNI)
    a_bg, r_bg = fit_white_over(rgb, BG)
    use_uni = r_uni <= r_bg
    a_w = np.where(use_uni, a_uni, a_bg)
    res = np.where(use_uni, r_uni, r_bg)
    whiteish = (res < 12) & (a_w > 0.04)
    clothes = (yy > Y_CLOTHES) & (yy < Y_SHOES)

    solid = (whiteish & (a_w > 0.55)).astype(np.uint8)
    # Grueso = lo que sobrevive a una apertura; asi una linea fina unida a una
    # banda ancha (la de la media) se separa de ella.
    opened = cv2.morphologyEx(solid, cv2.MORPH_OPEN, disk(9))
    thick = grow(opened, 4) & (solid > 0)
    thin = (solid > 0) & ~thick

    # Entre los finos, las lineas de circuito llevan halo pintado; los ribetes
    # finos tienen el borde limpio. Se decide por componente.
    faint = whiteish & (a_w > 0.06) & (a_w <= 0.5)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(thin.astype(np.uint8), connectivity=8)
    ring = grow(thin, 16) & ~grow(solid, 3)
    _, idx = ndimage.distance_transform_edt(~thin, return_indices=True)
    nearest = labels[idx[0], idx[1]]
    ring_total = np.bincount(nearest[ring], minlength=n).astype(np.float32)
    ring_faint = np.bincount(nearest[ring & faint], minlength=n).astype(np.float32)
    halo_ratio = np.divide(ring_faint, ring_total, out=np.zeros(n, np.float32), where=ring_total > 0)
    area = stats[:, cv2.CC_STAT_AREA]
    is_line = (halo_ratio >= LINE_HALO_MIN) | (area < 400)   # marcas pequenas: cuadrados y puntos
    is_line[0] = False
    not_trim = np.ones((h, w), bool)
    for x0, y0, x1, y1 in TRIM_BOXES:
        not_trim &= ~((xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1))
    line = is_line[labels] & clothes & not_trim
    trim_thin = thin & ~line

    halo = whiteish & (a_w <= 0.55) & grow(line, 40) & ~grow(thick | trim_thin, 5) & clothes
    glow_alpha = np.where(line | halo, a_w, 0).astype(np.float32)

    white_img = np.empty_like(rgb)
    white_img[:] = WHITE

    base = rgb.copy()
    under = np.where(use_uni[..., None], UNI, BG)
    sel = glow_alpha > 0
    base[sel] = under[sel]
    base_alpha = alpha.copy()
    base_alpha[sel & ~use_uni] = 0

    # ---- 3. Cara en blanco -----------------------------------------------------
    fx0, fy0, fx1, fy1 = FACE_BOX
    sub = (slice(fy0, fy1), slice(fx0, fx1))
    anchors = {}

    in_eyes = np.zeros((h, w), bool)
    for e in EYES.values():
        (cx, cy), (rx, ry) = e["c"], e["r"]
        in_eyes |= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1

    # Pelo de verdad = zonas de color de pelo que salen de las elipses; el
    # celeste del iris queda encerrado dentro del ojo y no cuenta.
    hair_color = (dist(rgb, HAIR) < 22) | (dist(rgb, HAIR_SHADE) < 30) | (dist(rgb, HAIR_LIGHT) < 20)
    n_h, lab_h = cv2.connectedComponents(hair_color[sub].astype(np.uint8), connectivity=4)
    outside = np.zeros(n_h, bool)
    outside[np.unique(lab_h[~in_eyes[sub]])] = True
    outside[0] = False
    real_hair = np.zeros((h, w), bool)
    real_hair[sub] = outside[lab_h]

    # Lineas del pelo dentro del ojo: trazos oscuros finos que van pegados al
    # pelo en casi todo su recorrido. El pliegue del parpado solo lo roza.
    dark = (rgb.max(axis=2) < 80).astype(np.uint8)
    thin_dark = (dark > 0) & ~grow(cv2.morphologyEx(dark, cv2.MORPH_OPEN, disk(5)), 3) & in_eyes
    near_hair = grow(real_hair, 4)
    n_d, lab_d = cv2.connectedComponents(thin_dark[sub].astype(np.uint8), connectivity=8)
    tot = np.bincount(lab_d.ravel(), minlength=n_d).astype(np.float32)
    hit = np.bincount(lab_d[near_hair[sub]].ravel(), minlength=n_d).astype(np.float32)
    is_hair_line = np.divide(hit, tot, out=np.zeros(n_d, np.float32), where=tot > 0) >= 0.6
    is_hair_line[0] = False
    hair_line = np.zeros((h, w), bool)
    hair_line[sub] = is_hair_line[lab_d]

    # Solo se conservan zonas con cuerpo: los hilos sueltos de color parecido
    # al pelo (bordes suavizados del ojo) dejaban vetas claras en la cara.
    kept = real_hair | (dist(rgb, SKIN_SHADE) < 22)
    kept_solid = grow(cv2.morphologyEx(kept.astype(np.uint8), cv2.MORPH_OPEN, disk(5)), 5) & kept
    keep = kept_solid | hair_line
    eye_mask = in_eyes & ~keep
    # El pliegue del parpado queda justo encima de la elipse: se quita aparte.
    for x0, y0, x1, y1 in CREASES:
        box = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        eye_mask |= grow(box & (dark > 0) & ~grow(real_hair, 2), 4) & box
    for name, e in EYES.items():
        anchors[f"eye_{name}"] = {"center": list(e["c"]), "radius": list(e["r"])}
    fx0, fy0, fx1, fy1 = FACE_BOX

    skin_like = (dist(rgb, SKIN) < 30) | (dist(rgb, SKIN_SHADE) < 30)
    x0, y0, x1, y1 = MOUTH
    box = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    mouth_mask = grow(box & ~skin_like, 4)
    anchors["mouth"] = {"center": [(x0 + x1) // 2, (y0 + y1) // 2], "box": list(MOUTH)}

    brow_mask = np.zeros((h, w), bool)
    for name, (x0, y0, x1, y1) in BROWS.items():
        box = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
        brow_mask |= grow(box & (dist(rgb, HAIR_SHADE) < 42), 8) & box
        anchors[f"brow_{name}"] = {"box": [x0, y0, x1, y1]}

    face_mask = eye_mask | mouth_mask | brow_mask

    # Ojos y boca estan sobre piel: se rellenan solo con piel base. Las cejas
    # cruzan pelo y piel: se rellenan con el tono base mas cercano de los dos.
    clean = ~grow(face_mask, 3)
    skin_src = (dist(rgb, SKIN) < 12) & clean
    both_src = ((dist(rgb, SKIN) < 12) | (dist(rgb, HAIR) < 12)) & clean
    # La piel es un color plano: copiar del vecino mas cercano dejaba vetas
    # radiales cuando la piel de origen tiene algo de ruido.
    patch = base[sub].copy()
    patch[(eye_mask | mouth_mask)[sub]] = SKIN
    patch = nearest_fill(patch, (brow_mask & ~eye_mask)[sub], both_src[sub])
    blurred = cv2.GaussianBlur(patch, (0, 0), 2.0)
    soft = grow(face_mask, 2)[sub] & ~grow(real_hair | hair_line, 2)[sub]
    patch[soft] = blurred[soft]
    base[sub] = patch

    # La capa con la cara del borrador cubre tambien el borde suavizado, para
    # que base + face_original recompongan el original exacto.
    face_original_alpha = (grow(face_mask, 3) & (yy >= fy0) & (yy < fy1) & (xx >= fx0) & (xx < fx1)).astype(np.float32)

    # ---- 4. Pelo que cae sobre la cara -----------------------------------------
    all_dark_thin = (dark > 0) & ~grow(cv2.morphologyEx(dark, cv2.MORPH_OPEN, disk(5)), 3)
    in_box = (xx >= fx0) & (xx < fx1) & (yy >= fy0) & (yy < fy1)
    hair_front = ((hair_color & ~(in_eyes & ~real_hair)) | (all_dark_thin & grow(real_hair, 6))) & in_box & ~face_mask
    hair_front_alpha = cv2.GaussianBlur(hair_front.astype(np.float32), (0, 0), 0.8)

    # ---- 5. Contorno de luz opcional -------------------------------------------
    fig = (alpha > 0.5).astype(np.uint8)
    grown = cv2.dilate(fig, disk(12))
    outline_alpha = cv2.GaussianBlur((grown - fig).astype(np.float32), (0, 0), 3) * 0.9
    outline_rgb = np.empty_like(rgb)
    outline_rgb[:] = HALO

    # ---- Guardar ----------------------------------------------------------------
    save_rgba(out / "base.png", base, base_alpha)
    save_rgba(out / "glow.png", white_img, glow_alpha)
    save_rgba(out / "face_original.png", rgb, face_original_alpha)
    save_rgba(out / "hair_front.png", rgb, hair_front_alpha)
    save_rgba(out / "outline.png", outline_rgb, outline_alpha)
    # Mascaras de cada pieza original, para poder usarlas por separado.
    in_face = (yy >= fy0) & (yy < fy1) & (xx >= fx0) & (xx < fx1)
    for name, m in (("eyes", eye_mask), ("mouth", mouth_mask), ("brows", brow_mask & ~eye_mask)):
        m8 = (grow(m, 3) & in_face).astype(np.uint8) * 255
        cv2.imencode(".png", m8)[1].tofile(str(out / f"mask_{name}.png"))

    ys, xs = np.where(alpha > 0.5)
    layout = {
        "source": src.name,
        "canvas": [w, h],
        "figure_bbox": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "layers_bottom_to_top": ["outline (opcional)", "base", "piezas de cara", "hair_front", "glow"],
        "anchors": anchors,
        "note": "Coordenadas en pixeles del original. face_original.png recompone la cara del borrador.",
    }
    (out / "layout.json").write_text(json.dumps(layout, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- Comprobaciones ---------------------------------------------------------
    recomposed = compose(
        [(base, base_alpha), (rgb, face_original_alpha), (white_img, glow_alpha)], BG, rgb.shape
    )
    diff = np.abs(recomposed - rgb)
    print(f"canvas={w}x{h} bbox={layout['figure_bbox']}")
    print(f"figura={100 * (alpha > 0.5).mean():.1f}% huecos_en_la_figura={int(((alpha < 0.99) & ~grow(bg, 6)).sum())} px")
    print(f"blancos: finos={n - 1} lineas={int(is_line.sum())} ribetes_finos={n - 1 - int(is_line.sum())}")
    print(f"brillo={100 * (glow_alpha > 0.05).mean():.2f}% cara_quitada={100 * face_mask.mean():.2f}% del lienzo")
    print(f"recomposicion: error_medio={diff.mean():.3f} error_max={diff.max():.0f} (niveles de 255)")

    x0, y0, x1, y1 = layout["figure_bbox"]
    cls = (rgb * 0.35).copy()
    cls[line] = (60, 255, 90)
    cls[halo] = (30, 140, 60)
    cls[trim_thin] = (255, 70, 70)
    cls[thick] = (80, 140, 255)
    save_rgb(out / "debug_blancos.png", cls[y0:y1, x0:x1], 1000)
    gray = (120, 124, 132)
    blank = compose([(base, base_alpha)], gray, rgb.shape)
    save_rgb(out / "debug_cara_en_blanco.png", blank[fy0:fy1, fx0:fx1], 1000)
    light = compose([(base, base_alpha), (white_img, glow_alpha)], (236, 238, 242), rgb.shape)
    save_rgb(out / "debug_sobre_claro.png", light[y0:y1, x0:x1], 900)
    dark_bg = compose([(outline_rgb, outline_alpha), (base, base_alpha), (white_img, glow_alpha)], BG, rgb.shape)
    save_rgb(out / "debug_con_contorno.png", dark_bg[y0:y1, x0:x1], 900)


if __name__ == "__main__":
    main()
