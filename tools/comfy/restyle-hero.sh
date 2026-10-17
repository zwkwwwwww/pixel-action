#!/usr/bin/env bash
# 全量像素化重塑：英雄 9 个剪辑。可断点续跑（已存在的帧自动跳过）。
set -euo pipefail
cd "$(dirname "$0")/../.."
node tools/comfy/restyle.mjs \
  --in art-source/blender/hero \
  --out tmp/restyle-hero \
  --strength 0.9 \
  --denoise 0.5 \
  --prompt "detailed pixel art game sprite, female swordswoman, blue long coat, long red hair, steel sword, limited 32 color palette, crisp hard pixel edges, hand-painted pixel shading, dark fantasy, side view, plain background" \
  --negative "green skin, weird colors, blurry, photo, 3d render, anti-aliasing, gradient, text, watermark"
