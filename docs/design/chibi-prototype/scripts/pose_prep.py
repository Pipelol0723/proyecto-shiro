"""Prepara una imagen generada para el proceso de capas de la chibi.

1. La amplia para que la cara tenga la misma escala que la chibi del borrador.
2. Filtro de paleta: acerca cada color plano a su color canonico, sin tocar
   los bordes ni los tonos que no esten cerca de ninguno.

Uso: python pose_prep.py <origen> <salida.png> <factor>
"""
import sys

import cv2
import numpy as np

# color medido en la imagen generada -> color canonico (RGB)
MAP = [
    ((17, 18, 24), (14, 17, 23)),       # fondo
    ((30, 36, 54), (27, 34, 51)),       # uniforme
    ((183, 220, 239), (187, 226, 242)), # pelo
    ((245, 220, 207), (245, 225, 211)), # piel
    ((253, 253, 253), (255, 255, 255)), # blanco
    ((0, 0, 2), (1, 1, 1)),             # linea
]
SIGMA = 14.0


def main():
    src, out, factor = sys.argv[1], sys.argv[2], float(sys.argv[3])
    bgr = cv2.imdecode(np.fromfile(src, np.uint8), cv2.IMREAD_COLOR)
    size = (round(bgr.shape[1] * factor), round(bgr.shape[0] * factor))
    bgr = cv2.resize(bgr, size, interpolation=cv2.INTER_LANCZOS4)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32)

    shift = np.zeros_like(rgb)
    total = np.zeros(rgb.shape[:2], np.float32)
    for measured, canon in MAP:
        d2 = ((rgb - np.array(measured, np.float32)) ** 2).sum(axis=2)
        wgt = np.exp(-d2 / (2 * SIGMA**2))
        shift += wgt[..., None] * (np.array(canon, np.float32) - np.array(measured, np.float32))
        total += wgt
    rgb += shift / np.maximum(total, 1.0)[..., None]

    # Fondo plano de verdad: el de la imagen generada tiene ruido, y en la
    # esquina inferior derecha suele ir la marca del generador.
    bg = np.array(MAP[0][1], np.float32)
    corner = round(170 * factor)
    rgb[-corner:, -corner:] = bg
    rgb[np.linalg.norm(rgb - bg, axis=2) < 9] = bg

    res = cv2.cvtColor(rgb.clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    cv2.imencode(".png", res)[1].tofile(out)
    print(f"preparada {size[0]}x{size[1]} -> {out}")
    for measured, canon in MAP:
        d = np.linalg.norm(rgb - np.array(canon, np.float32), axis=2)
        print(f"  #{canon[0]:02X}{canon[1]:02X}{canon[2]:02X}: {100 * (d < 6).mean():.1f}% de la imagen a menos de 6 niveles")


if __name__ == "__main__":
    main()
