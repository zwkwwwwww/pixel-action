#!/usr/bin/env bash
# 固化全局调色板：先「无量化」重合成一遍（只为采样真实色彩分布），
# 再用 tools/palette.py 做一次 median-cut，产出 art-source/palette.{png,json}。
#
# 为什么需要两遍：compose 若先逐帧量化，采到的就是"量化后的颜色"，
# 全局表会继承第一遍的偏差。所以采样必须用未量化的合成结果。
#
#   bash tools/build-palette.sh            # 默认 48 色
#   COLORS=32 bash tools/build-palette.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COLORS="${COLORS:-48}"
SRC="tmp/palette-src"
rm -rf "$SRC"
mkdir -p "$SRC"

compose_raw() { # name height cell anchor
  local name="$1" h="$2" cell="$3" anchor="$4"
  if [ "$name" = "hero" ]; then
    python tools/compose_final.py --restyled "tmp/restyle-hero" --alpha "art-source/blender/hero" \
      --out "$SRC/hero" --height "$h" --cell "$cell" --anchor "$anchor" --colors 0 \
      --ref "art-source/blender/hero/idle/idle_00.png" > /dev/null
  else
    python tools/compose_final.py --restyled "tmp/restyle-enemies/$name" \
      --alpha "art-source/blender/enemies/$name" --out "$SRC/enemies/$name" \
      --height "$h" --cell "$cell" --anchor "$anchor" --colors 0 \
      --ref "art-source/blender/enemies/$name/idle/idle_00.png" > /dev/null
  fi
}

echo "== 1/2 无量化采样合成 → $SRC"
compose_raw hero 56 96x96 48,88
for spec in "grunt 46 96x96 48,88" "brute 52 96x96 48,88" "ranger 48 96x96 48,88" "boss 112 160x160 80,144"; do
  set -- $spec
  compose_raw "$1" "$2" "$3" "$4"
done

echo "== 2/2 固化 ${COLORS} 色全局调色板"
python tools/palette.py --in "$SRC/hero" "$SRC/enemies" --out art-source/palette.png --colors "$COLORS"

echo "✓ 完成: art-source/palette.png + .json"
echo "  之后 build-sprites.sh / build-enemy-sprites.sh 会自动引用它"
