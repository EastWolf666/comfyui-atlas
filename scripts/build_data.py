#!/usr/bin/env python3
"""
数据优化脚本
============
对 data/workflows.json 做后处理，生成前端加载更快的版本：

1. 精简 description（截断到 --desc-len，默认 100 字符，仅用于搜索命中；
   卡片本身不渲染描述，避免传输无用的大字段）。
2. 以紧凑 JSON（无缩进）重写 data/workflows.json，减小体积。
3. 额外生成 data/workflows.json.gz（gzip，最高压缩级别），前端用
   DecompressionStream 原生解压后解析，传输量约为原始的 1/4。

用法：
  python3 scripts/build_data.py                       # 处理默认路径
  python3 scripts/build_data.py --desc-len 120        # 自定义描述截断长度
"""
import argparse
import gzip
import json
import os
import shutil


def main():
    ap = argparse.ArgumentParser(description="优化 workflows 数据并生成 gzip")
    ap.add_argument("--src", default="data/workflows.json", help="源 JSON（会被原地精简重写）")
    ap.add_argument("--desc-len", type=int, default=100, help="description 截断长度（默认 100）")
    args = ap.parse_args()

    if not os.path.exists(args.src):
        raise SystemExit(f"找不到 {args.src}")

    with open(args.src, encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("items", [])
    before = os.path.getsize(args.src)

    # 1) 精简 description
    trimmed = 0
    for it in items:
        d = it.get("description") or ""
        if len(d) > args.desc_len:
            it["description"] = d[: args.desc_len] + "…"
            trimmed += 1

    # 2) 紧凑重写
    tmp = args.src + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    shutil.move(tmp, args.src)
    mid = os.path.getsize(args.src)

    # 3) 生成 gzip
    gz_path = args.src + ".gz"
    with open(args.src, "rb") as fin, gzip.open(gz_path, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout)
    gz = os.path.getsize(gz_path)

    print(f"✅ 处理完成：{args.src}")
    print(f"   条目数        : {len(items)}（精简描述 {trimmed} 条）")
    print(f"   原始体积      : {before/1024:.0f} KB")
    print(f"   紧凑 JSON     : {mid/1024:.0f} KB")
    print(f"   gzip          : {gz/1024:.0f} KB（传输约为紧凑版的 {100*gz/mid:.0f}%，原始的 {100*gz/before:.0f}%）")
    print(f"   已生成        : {gz_path}")


if __name__ == "__main__":
    main()
