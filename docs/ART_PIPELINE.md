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

## 背景与音频

- 背景：`node tools/comfy/backgrounds.mjs` → Z-Image-Turbo 1280×720 → 960×270、48 色量化。
- 音频：`node tools/comfy/audio-batch.mjs` → ACE-Step 1.5 turbo（8 步 / cfg 1）→ mp3 + manifest。

## 已知限制

- 腿部只有刚性骨（无膝关节），走/跑靠摆胯 + 手臂；死亡是整体倒地而非 ragdoll。
- 敌人为控制时间只重塑了 idle/walk/attack1/hurt/death 5 个剪辑，attack2/3 在播放时回退到 attack1。
- 面部在 56px 下只有色块级细节（这是像素规格决定的，不是渲染缺陷）。
