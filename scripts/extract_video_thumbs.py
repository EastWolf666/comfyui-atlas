#!/usr/bin/env python3
"""为视频类工作流抽取一帧作为预览图。

背景：平台约 20% 的工作流（实测 17670/85894）封面是 .mp4，
而七牛这个空间**未启用视频处理**（imageView2/vframe 等参数一律
返回 InvalidImageFormat 或原样返回视频），所以这些卡片此前一直是空的。

做法：本地用 ffmpeg 抽帧 → 缩到 320px 宽的 JPEG（实测 8~17KB）
→ 存到 data/thumbs/并提交进 Git仓库，随 Pages 一起分发。
幂等：已存在且非空的缩略图会跳过，中断后重跑可续。

用法：
  python3 scripts/extract_video_thumbs.py --limit 6000
  python3 scripts/extract_video_thumbs.py --limit 6000 --workers 8
  python3 scripts/extract_video_thumbs.py --report-only      # 只看统计不抽帧
"""
import argparse
import concurrent.futures as cf
import gzip
import glob
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

SHARD_RE = "wf-shard-*.json.gz"
# 抽帧后统一缩到这个宽度（实测 320px 宽约 8~17KB，兼顾清晰度与体积）
THUMB_W = 320
JPEG_Q = 6
# 只处理这些视频扩展名（gif 由浏览器直接显示，无需抽帧）
VIDEO_EXT = (".mp4", ".webm", ".mov")

_lock = threading.Lock()


def out_dir() -> str:
    return "data/thumbs"


def iter_items():
    """从已入库分片还原短键条目（只取需要的字段，避免还原 10MB JSON）。"""
    for path in sorted(glob.glob(os.path.join("data", SHARD_RE))):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for it in json.load(f):
                yield it


def is_video(url: str) -> bool:
    return (url or "").lower().split("?")[0].endswith(VIDEO_EXT)


def unthumb(url: str) -> str:
    """去掉七牛缩略参数，回到原视频 URL。"""
    return (url or "").split("?")[0]


def pick_frame_offset(duration: float) -> float:
    """选抽帧时间点。

    不用第 0 秒：不少生成视频开头是黑场/淡入，抽出来是纯黑图。
    取时长的 30%（上限 1.5 秒）通常落在内容已开始、又较稳定的位置。
    """
    if duration <= 0:
        return 0.5
    return min(1.5, max(0.2, duration * 0.3))


def extract_one(task):
    """下载 → 抽帧 → 落盘。返回 (状态, 详情)。"""
    wid, url, dur_hint = task
    name = f"{wid}.jpg"
    dest = os.path.join(out_dir(), name)
    if os.path.exists(dest) and os.path.getsize(dest) > 512:
        return ("skip", f"{wid} 已存在")

    src = unthumb(url)
    fd, tmp_vid = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    fd, tmp_jpg = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    try:
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp_vid, "wb") as f:
            f.write(r.read())
        # 优先用容器里的真实时长；探测失败就用调用方给的
        duration = dur_hint
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", tmp_vid], capture_output=True, text=True, timeout=30)
        try:
            v = float((probe.stdout or "").strip())
            if v > 0:
                duration = v
        except ValueError:
            pass
        ss = pick_frame_offset(duration)
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{ss:.2f}", "-i", tmp_vid,
             "-frames:v", "1", "-vf", f"scale={THUMB_W}:-2", "-q:v", str(JPEG_Q),
             "-f", "mjpeg", "-y", tmp_jpg],
            capture_output=True, timeout=60)
        if not os.path.exists(tmp_jpg) or os.path.getsize(tmp_jpg) <= 512:
            # 首帧失败（黑场/损坏）时退回第 0 秒再试一次
            subprocess.run(
                ["ffmpeg", "-v", "error", "-i", tmp_vid, "-frames:v", "1",
                 "-vf", f"scale={THUMB_W}:-2", "-q:v", str(JPEG_Q),
                 "-f", "mjpeg", "-y", tmp_jpg],
                capture_output=True, timeout=60)
        if not os.path.exists(tmp_jpg) or os.path.getsize(tmp_jpg) <= 512:
            return ("fail", f"{wid} 抽帧失败（{duration:.1f}s）")
        os.replace(tmp_jpg, dest)  # 原子落盘，中断不会留半张图
        return ("ok", f"{wid} {os.path.getsize(dest)/1024:.1f}KB @{ss:.2f}s")
    except Exception as e:
        return ("fail", f"{wid} {type(e).__name__}: {str(e)[:50]}")
    finally:
        for p in (tmp_vid, tmp_jpg):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


def main():
    ap = argparse.ArgumentParser(description="为视频工作流抽取预览图")
    ap.add_argument("--limit", type=int, default=6000,
                    help="最多处理多少条（按使用量降序，0 = 全部）")
    ap.add_argument("--workers", type=int, default=8, help="并发数")
    ap.add_argument("--report-only", action="store_true", help="只统计不抽帧")
    ap.add_argument("--stats-out", default="data/thumbs/manifest.json",
                    help="抽帧清单（id → 文件名）输出路径")
    args = ap.parse_args()

    os.makedirs(out_dir(), exist_ok=True)

    # 分片已按使用量降序，切片即天然是"热门优先"
    videos = []
    for it in iter_items():
        url = it.get("im") or ""
        if is_video(url):
            videos.append((it.get("i"), url, 0.0))
    print(f"📼 视频类条目：{len(videos)} 条"
          + (f"，本次处理前 {args.limit} 条" if args.limit else "，全部处理"))
    if args.report_only:
        return

    targets = videos[:args.limit] if args.limit else videos
    # 续跑：已有缩略图直接跳过，不重复下载
    todo = [t for t in targets
            if not (os.path.exists(os.path.join(out_dir(), f"{t[0]}.jpg"))
                    and os.path.getsize(os.path.join(out_dir(), f"{t[0]}.jpg")) > 512)]
    print(f"⏭  跳过已完成 {len(targets)-len(todo)} 条，待处理 {len(todo)} 条"
          f"（并发 {args.workers}）")

    stats = {"ok": 0, "skip": 0, "fail": 0}
    fails = []
    done = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(args.workers) as ex:
        for status, msg in ex.map(extract_one, todo):
            stats[status] += 1
            done += 1
            if status == "fail":
                fails.append(msg)
            if done % 200 == 0 or status == "fail":
                el = time.time() - t0
                rate = done / max(el, 0.1)
                eta = (len(todo) - done) / max(rate, 0.01)
                print(f"  [{done}/{len(todo)}] ✅{stats['ok']} ⏭{stats['skip']} "
                      f"❌{stats['fail']} | {rate:.1f}/s | 预计剩余 {eta/60:.1f} 分钟",
                      flush=True)

    total = sum(os.path.getsize(os.path.join(out_dir(), f)) for f in os.listdir(out_dir())
                if f.endswith(".jpg"))
    print(f"\n✅ 完成：新增 {stats['ok']} 张，跳过 {stats['skip']}，失败 {stats['fail']}")
    print(f"📦 缩略图总量 {len(os.listdir(out_dir()))} 张 / {total/1048576:.1f}MB"
          f"（平均 {total/max(len(os.listdir(out_dir())),1)/1024:.1f}KB）")
    if fails:
        print(f"⚠️  失败样例：{'; '.join(fails[:5])}", file=sys.stderr)
    return 0 if stats["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
