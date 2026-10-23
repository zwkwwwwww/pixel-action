#!/usr/bin/env bash
# 敌人/Boss 精灵表：压网格 → 一致性闸门 → 打包（每个角色独立缩放参考）。
set -euo pipefail
cd "$(dirname "$0")/.."

for K in grunt brute ranger boss; do
  SKIP=""
  case "$K" in
    boss) HEIGHT=112; CELL=160x160; ANCHOR=80,144 ;;
    grunt) HEIGHT=46; CELL=96x96; ANCHOR=48,88; SKIP="--skip walk=3|10" ;;
    brute) HEIGHT=52; CELL=96x96; ANCHOR=48,88 ;;
    ranger) HEIGHT=48; CELL=96x96; ANCHOR=48,88; SKIP="--skip walk=3|10" ;;
  esac
  # 弓手多一套「拉弓」剪辑
  if [ "$K" = ranger ]; then
    CLIPS="idle,walk,attack1,aim,shoot,hurt,death"
    FPS="idle=16,walk=16,attack1=21,aim=6,shoot=17,hurt=21,death=10"
  else
    CLIPS="idle,walk,attack1,hurt,death"
    FPS="idle=16,walk=16,attack1=21,hurt=21,death=10"
  fi
  echo "== $K: compose / diff / pivot / pack"
  rm -rf "tmp/final-enemies/$K"
  if [ -f art-source/palette.png ]; then
    PAL_ARGS="--palette art-source/palette.png"
  else
    PAL_ARGS="--colors 32"
  fi
  python tools/compose_final.py \
    --restyled "tmp/restyle-enemies/$K" --alpha "art-source/blender/enemies/$K" \
    --out "tmp/final-enemies/$K" --height "$HEIGHT" --cell "$CELL" --anchor "$ANCHOR" \
    $PAL_ARGS --ref "art-source/blender/enemies/$K/idle/idle_00.png"
  python tools/frame_diff.py --in "tmp/final-enemies/$K" \
    --json-out "art-source/reports/frame-diff-$K.json" \
    --threshold 0.25 --loop-threshold 0.20 --loop-clips idle,walk
  python tools/pivot_drift.py --in "tmp/final-enemies/$K" \
    --json-out "art-source/reports/pivot-drift-$K.json"
  python tools/pack_sprites.py --in "tmp/final-enemies/$K" --out assets/sprites --name "$K" \
    --cell "$CELL" --anchor "$ANCHOR" --clips "$CLIPS" \
    --fps-map "$FPS" $SKIP
  python tools/walk_gate.py --sheet "assets/sprites/$K.json" \
    --json-out "art-source/reports/walk-gate-$K.json"
done
echo "✓ 敌人精灵表完成"
