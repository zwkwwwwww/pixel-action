#!/usr/bin/env bash
# 加帧后的增量重塑：只重做「帧数变过」的剪辑，未变的剪辑保留已有产物。
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== 清掉英雄全部重塑（9 个剪辑帧数都变了）"
rm -rf tmp/restyle-hero

echo "== 清掉敌人帧数变过的剪辑（idle/walk/attack1/hurt）"
for K in grunt brute ranger boss; do
  rm -rf "tmp/restyle-enemies/$K/idle" "tmp/restyle-enemies/$K/walk" \
         "tmp/restyle-enemies/$K/attack1" "tmp/restyle-enemies/$K/hurt"
done

echo "== 英雄重塑（66 帧）"
bash tools/comfy/restyle-hero.sh

echo "== 敌人重塑（idle/walk/attack1/hurt）"
bash tools/comfy/restyle-enemies.sh

echo "✓ 增量重塑完成"
