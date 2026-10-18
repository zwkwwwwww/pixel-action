#!/usr/bin/env bash
# 一条命令重跑「像素化 → 贴 alpha → 帧间一致性闸门 → 打包精灵表」。
#
#   bash tools/build-sprites.sh hero
#   bash tools/build-sprites.sh grunt
#
# 前提：Blender 帧已渲染在 art-source/blender/<name>/<clip>/*.png
# 产物：assets/sprites/<name>.png + .json（游戏直接加载）
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:?用法: build-sprites.sh <hero|grunt|brute|ranger|boss>}"
SRC="art-source/blender/${NAME}"
RAW="tmp/restyle-${NAME}"
FINAL="tmp/final-${NAME}"

case "$NAME" in
  hero) HEIGHT=56; CELL=96x96; ANCHOR=48,88 ;;
  boss) HEIGHT=112; CELL=160x160; ANCHOR=80,144 ;;
  *)    HEIGHT=48;  CELL=96x96; ANCHOR=48,88 ;;
esac

echo "== 1/4 ComfyUI 像素化重塑（可断点续跑）: $SRC -> $RAW"
node tools/comfy/restyle.mjs --in "$SRC" --out "$RAW" \
  --strength 0.9 --denoise 0.5 \
  --prompt "detailed pixel art game sprite, limited 32 color palette, crisp hard pixel edges, hand-painted pixel shading, dark fantasy, side view, plain background" \
  --negative "green skin, weird colors, blurry, photo, 3d render, anti-aliasing, gradient, text, watermark"

echo "== 2/4 压回像素网格 + 贴回 Blender alpha: $FINAL"
rm -rf "$FINAL"
python tools/compose_final.py --restyled "$RAW" --alpha "$SRC" --out "$FINAL" \
  --height "$HEIGHT" --cell "$CELL" --anchor "$ANCHOR" --colors 32 --ref "$SRC/idle/idle_00.png"

echo "== 3/4 帧间一致性闸门"
python tools/frame_diff.py --in "$FINAL" --json-out "art-source/reports/frame-diff-${NAME}.json" --threshold 0.22

echo "== 4/4 打包精灵表"
python tools/pack_sprites.py --in "$FINAL" --out assets/sprites --name "$NAME" \
  --cell "$CELL" --anchor "$ANCHOR" \
  --clips idle,walk,attack1,attack2,attack3,dodge,hurt,death,special \
  --fps-map idle=16,walk=24,attack1=21,attack2=21,attack3=17,dodge=24,hurt=21,death=15,special=18

echo "✓ 完成: assets/sprites/${NAME}.png"
