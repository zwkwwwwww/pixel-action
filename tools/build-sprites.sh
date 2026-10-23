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

echo "== 1/5 ComfyUI 像素化重塑（可断点续跑）: $SRC -> $RAW"
node tools/comfy/restyle.mjs --in "$SRC" --out "$RAW" \
  --strength 0.9 --denoise 0.5 \
  --prompt "detailed pixel art game sprite, limited 32 color palette, crisp hard pixel edges, hand-painted pixel shading, dark fantasy, side view, plain background" \
  --negative "green skin, weird colors, blurry, photo, 3d render, anti-aliasing, gradient, text, watermark"

echo "== 2/5 压回像素网格 + 贴回 Blender alpha: $FINAL"
rm -rf "$FINAL"
# 有全局调色板就统一用它（跨 sprite 颜色一致）；没有则退回逐帧 32 色
if [ -f art-source/palette.png ]; then
  PAL_ARGS="--palette art-source/palette.png"
else
  PAL_ARGS="--colors 32"
fi
python tools/compose_final.py --restyled "$RAW" --alpha "$SRC" --out "$FINAL" \
  --height "$HEIGHT" --cell "$CELL" --anchor "$ANCHOR" $PAL_ARGS --ref "$SRC/idle/idle_00.png"

echo "== 3/5 帧间一致性闸门（剪影交集 + 循环缝合判定）"
python tools/frame_diff.py --in "$FINAL" --json-out "art-source/reports/frame-diff-${NAME}.json" \
  --threshold 0.25 --loop-threshold 0.20 --loop-clips idle,walk

echo "== 4/5 pivot 刚性闸门（后处理变换必须逐帧唯一）"
python tools/pivot_drift.py --in "$FINAL" --json-out "art-source/reports/pivot-drift-${NAME}.json"

echo "== 5/5 打包精灵表"
# --skip walk=10：hero 的 09/10 两帧几乎是同一个双腿直立姿势，连续两帧 = 125ms 的"站立保持"，
# 会造成视觉暂留（看起来像有个站直的人叠在上面）。丢掉 10，只保留一个过渡帧。
python tools/pack_sprites.py --in "$FINAL" --out assets/sprites --name "$NAME" \
  --cell "$CELL" --anchor "$ANCHOR" \
  --clips idle,walk,attack1,attack2,attack3,dodge,hurt,death,special \
  --fps-map idle=16,walk=16,attack1=21,attack2=21,attack3=17,dodge=24,hurt=21,death=15,special=18 \
  --skip walk=10

echo "✓ 完成: assets/sprites/${NAME}.png"
python tools/walk_gate.py --sheet "assets/sprites/${NAME}.json" \
  --json-out "art-source/reports/walk-gate-${NAME}.json"
