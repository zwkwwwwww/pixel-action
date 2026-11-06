#!/usr/bin/env python3
"""重建 assets/audio/manifest.json：按实际存在的文件登记（合成音效优先 wav，BGM/ACE 音效是 mp3）。

用法: python tools/audio-manifest.py
"""
from __future__ import annotations

import hashlib
import json
import re
import wave
from pathlib import Path

AUDIO_DIR = Path("assets/audio")
# 顺序即加载顺序；游戏侧不依赖顺序
IDS = [
    "sfx_hit", "sfx_hit_heavy", "sfx_hurt",
    "sfx_bow", "sfx_dodge", "sfx_death", "sfx_special", "sfx_victory",
    "sfx_jump", "sfx_knife", "sfx_pickup",
    "bgm_battle", "bgm_boss",
]


FFMPEG = Path(r"D:\Program Files (x86)\FormatFactory\ffmpeg.exe")


def duration(path: Path) -> float | None:
    """音频时长：wav 直接读头，mp3 用 ffmpeg 输出的 Duration 行。

    早先只对 wav 返回时长，导致 BGM（mp3）在清单里没有 seconds 字段，
    测试无法守护"BGM 不能太短"。这里补齐。
    （本机只有 ffmpeg.exe，没有 ffprobe.exe，所以解析 stderr 而不是用 -show_entries。）
    """
    if path.suffix == ".wav":
        try:
            with wave.open(str(path), "rb") as w:
                return round(w.getnframes() / w.getframerate(), 3)
        except Exception:
            return None

    if not FFMPEG.exists():
        return None
    try:
        import subprocess
        out = subprocess.run(
            [str(FFMPEG), "-hide_banner", "-i", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", out.stderr)
        if not m:
            return None
        hh, mm, ss = int(m.group(1)), int(m.group(2)), float(m.group(3))
        return round(hh * 3600 + mm * 60 + ss, 3)
    except Exception:
        return None


def main() -> int:
    entries = []
    missing = []
    for audio_id in IDS:
        wav = AUDIO_DIR / f"{audio_id}.wav"
        mp3 = AUDIO_DIR / f"{audio_id}.mp3"
        # 合成音效同时有 wav/mp3 时用 wav（无损、浏览器解码无额外延迟）
        chosen = wav if wav.exists() else (mp3 if mp3.exists() else None)
        if chosen is None:
            missing.append(audio_id)
            continue
        item = {"id": audio_id, "file": chosen.name}
        # 内容版本号：音频重新生成后 URL 变化，浏览器不会继续用旧文件
        item["version"] = hashlib.sha256(chosen.read_bytes()).hexdigest()[:12]
        d = duration(chosen)
        if d is not None:
            item["seconds"] = d
        entries.append(item)

    manifest = AUDIO_DIR / "manifest.json"
    manifest.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    print(json.dumps({
        "manifest": str(manifest),
        "entries": len(entries),
        "missing": missing,
        "files": [e["file"] for e in entries],
    }, ensure_ascii=False))
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
