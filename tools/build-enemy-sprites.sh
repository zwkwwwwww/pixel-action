#!/usr/bin/env bash
# 敌人/Boss 精灵表：压网格 → 一致性闸门 → 打包（每个角色独立缩放参考）。
set -euo pipefail
cd "$(dirname "$0")/.."

for K in grunt brute ranger boss; do
  case "$K" in
    boss) HEIGHT=112; CELL=160x160; ANCHOR=80,144 ;;
    grunt) HEIGHT=46; CELL=96x96; ANCHOR=48,88 ;;
    brute) HEIGHT=52; CELL=96x96; ANCHOR=48,88 ;;
    ranger) HEIGHT=48; CELL=96x96; ANCHOR=48,88 ;;
  esac
  echo "== $K: compose / diff / pack"
  rm -rf "tmp/final-enemies/$K"
  python tools/compose_final.py \
    --restyled "tmp/restyle-enemies/$K" --alpha "art-source/blender/enemies/$K" \
    --out "tmp/final-enemies/$K" --height "$HEIGHT" --cell "$CELL" --anchor "$ANCHOR" \
    --colors 32 --ref "art-source/blender/enemies/$K/idle/idle_00.png"
  python tools/frame_diff.py --in "tmp/final-enemies/$K" \
    --json-out "art-source/reports/frame-diff-$K.json" --threshold 0.22 || echo "!! $K 帧间差超阈值（见报告）"
  python tools/pack_sprites.py --in "tmp/final-enemies/$K" --out assets/sprites --name "$K" \
    --cell "$CELL" --anchor "$ANCHOR" --clips idle,walk,attack1,hurt,death
done
echo "✓ 敌人精灵表完成"
