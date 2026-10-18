# 美术管线：Blender × ComfyUI

> 一句话：**Blender 决定「是什么、怎么动」，ComfyUI 决定「像素细节长什么样」，Python 负责把两者钉在同一张像素网格上。**

## 为什么必须分工

| 只用一个工具 | 问题 |
| --- | --- |
| 只用 ComfyUI | 逐帧生成动作不连贯，腿会漂移、武器会变形，做不了动作游戏 |
| 只用 Blender | 低模渲染缩小后是「色块人」，没有像素画的手绘质感与光影细节 |
| 两者结合 | Blender 提供**结构锁**（轮廓/姿势/遮挡），ComfyUI 只补材质与光影 |

## 流程（每个角色一条命令）

```
art-source/blender/<name>.blend            # 低模 + 骨骼 + 9 组 action
        │  blender -b ... -P tools/blender/render_clips.py
        ▼
art-source/blender/<name>/<clip>/*.png     # 384×384 RGBA，正交 3/4 侧视，透明底
        │  node tools/comfy/restyle.mjs     # Z-Image-Turbo + Fun-ControlNet(Union)
        ▼
tmp/restyle-<name>/<clip>/*.png            # 384×384 RGB（结构不变，补细节）
        │  python tools/compose_final.py    # 固定缩放 + LANCZOS 降采样 + 32 色量化 + 贴回 alpha
        ▼
tmp/final-<name>/<clip>/*.png              # 96×96 硬像素帧（Boss 160×160）
        │  python tools/pack_sprites.py
        ▼
assets/sprites/<name>.png + .json          # 游戏直接加载
```

一条命令：`bash tools/build-sprites.sh hero`、`bash tools/build-enemy-sprites.sh`。

## 关键参数与理由

| 参数 | 值 | 为什么 |
| --- | --- | --- |
| ControlNet | Fun-ControlNet-Union 2.1-lite (8 steps) | 结构锁：只允许改材质，不允许重画轮廓 |
| strength | 0.9 | 太低会重画姿势，太高会完全忽略提示词 |
| denoise | 0.5 | 0.5 时 Z-Image 还能补细节，0.7 开始帧间漂移 |
| 采样 | 8 步 / cfg 1 / euler+simple | turbo 蒸馏模型的唯一正确用法（cfg 1 时负向词无效） |
| 种子 | 同一角色固定 | 噪声相关 → 相邻帧风格一致 |
| 缩放 | 站姿参考帧定死 | 逐帧按包围盒缩放会让倒地帧突然放大 3 倍（实测撑爆 cell） |
| 降采样 | LANCZOS + 32 色量化 | 从「高分辨率插画」降到像素网格，面积平均保细节，量化把渐变压成硬色块 |
| alpha | 取 Blender 原始渲染 | AI 输出的边缘不可信，轮廓必须由 3D 渲染保证 |

## 质量闸门

1. **帧间一致性** `tools/frame_diff.py`：相邻帧归一化像素差 ≤ 0.22。
   实测 hero 9 个剪辑最大 0.046，全部通过。
2. **帧数完整性** `pack_sprites.py`：缺帧/帧号不连续直接报错，不产半成品。
3. **cell 尺寸**：缩放后宽度超过 cell 立刻报错（不会静默裁掉武器）。
4. **目视**：contact sheet + 游戏内截图，人眼判断剪影可读性。

## 动画加帧（v2）

原始动作是 4~6 帧的稀疏 pose（一帧一个姿势），60fps 下会明显一顿一顿。
`tools/blender/build_hero.py` 与 `tools/blender/enemies/build_enemies.py` 现在会在相邻 pose 之间做
**线性重采样**（循环剪辑用环绕插值 `u = i*n/target`，非循环用 `u = i*(n-1)/(target-1)` 保证首尾姿势不变），
fps 按 `round(fps * newN/oldN)` 抬高 —— 动作总时长不变，采样密度翻倍。

| 角色 | 帧数变化 |
| --- | --- |
| hero | 41 → 66（idle 4→8, walk 6→12, attack1/2 4→6, attack3 5→7, dodge 4→6, hurt 2→3, death 6→9, special 6→9） |
| grunt/brute/ranger/boss | 41 → 54（只加 idle/walk/attack1/hurt，其余剪辑敌人不用，省重塑时间） |

加帧只重跑「帧数变过」的剪辑（`tools/comfy/restyle-denser.sh` 先删对应目录再增量重塑）。

## 背景与音频

- 背景：`node tools/comfy/backgrounds.mjs` → Z-Image-Turbo 1280×720 → 960×270、48 色量化。
- **短音效：DSP 合成** `python tools/sfx-synth.py`。
  为什么不用 ACE-Step 生成音效：它是音乐模型，输出天然带音高/调性/混响；实测旧版 `sfx_hit` 的起音时间是
  666ms、`sfx_death` 峰值只有 0.011（几乎听不见）。动作游戏需要 80~250ms、attack < 5ms、干声、频段明确的声音，
  用噪声整形 + 扫频 + 指数衰减包络合成，完全可复现且零生成耗时。
- BGM：`node tools/comfy/audio-batch.mjs` → ACE-Step 1.5 turbo（8 步 / cfg 1）→ mp3。
- 清单：`python tools/audio-manifest.py`；体检：`python tools/audio-analyze.py`（起音/质心/时长对比）。

## 已知限制

- 腿部只有刚性骨（无膝关节），走/跑靠摆胯 + 手臂；死亡是整体倒地而非 ragdoll。
- 敌人为控制时间只重塑了 idle/walk/attack1/hurt/death 5 个剪辑，attack2/3 在播放时回退到 attack1。
- 面部在 56px 下只有色块级细节（这是像素规格决定的，不是渲染缺陷）。
