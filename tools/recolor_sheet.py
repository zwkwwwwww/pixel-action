"""给 Boss 换配色：直接从现有精灵表做 HSV 色相偏移，生成新的 Boss 素材。

为什么这样做：完整新建模型要走 Blender→渲染→ComfyUI 重塑（每个 20~30 分钟）。
先用确定性的换色把"视觉不同"落地，动作/机制已经不同了。

用法: python tools/recolor_sheet.py --src boss --out boss_warden --hue 110 --sat 1.05
"""
from __future__ import annotations

import argparse
import colorsys
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--hue', type=float, default=0.0, help='色相偏移（度）')
    ap.add_argument('--sat', type=float, default=1.0, help='饱和度倍率')
    ap.add_argument('--val', type=float, default=1.0, help='明度倍率')
    args = ap.parse_args()

    src_png = ROOT / 'assets' / 'sprites' / f'{args.src}.png'
    src_json = ROOT / 'assets' / 'sprites' / f'{args.src}.json'
    meta = json.loads(src_json.read_text(encoding='utf-8'))
    img = Image.open(src_png).convert('RGBA')
    px = img.load()

    dh = args.hue / 360.0
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            h = (h + dh) % 1.0
            s = min(1.0, s * args.sat)
            v = min(1.0, v * args.val)
            r2, g2, b2 = colorsys.hsv_to_rgb(h, s, v)
            px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)

    out_png = ROOT / 'assets' / 'sprites' / f'{args.out}.png'
    out_json = ROOT / 'assets' / 'sprites' / f'{args.out}.json'
    img.save(out_png)
    meta['image'] = f'{args.out}.png'
    out_json.write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(json.dumps({'out': str(out_png), 'json': str(out_json), 'hue': args.hue}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
