#!/usr/bin/env bash
# 敌人与 Boss 的像素化重塑（只处理游戏真正会用到的剪辑，控制时间预算）。
# 用法: bash tools/comfy/restyle-enemies.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

node tools/comfy/restyle.mjs \
  --in art-source/blender/enemies \
  --out tmp/restyle-enemies \
  --only idle,walk,attack1,hurt,death \
  --strength 0.9 --denoise 0.5 \
  --prompt "detailed pixel art game sprite, dark fantasy monster, limited 32 color palette, crisp hard pixel edges, hand-painted pixel shading, side view, plain background" \
  --negative "green skin, weird colors, blurry, photo, 3d render, anti-aliasing, gradient, text, watermark"
