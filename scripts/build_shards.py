#!/usr/bin/env python3
"""
工作流分片构建脚本
==================
把 data/workflows.json 切成多个 gzip 分片，供前端「按需加载」，避免首屏
一次性下载全部数据。

产物（写入 data/）：
  - wf-manifest.json        清单：来源/总数/分片文件名列表/字段schema
  - wf-shard-000.json.gz    分片 0（按热度排序的前 N 条）
  - wf-shard-001.json.gz    分片 1
  - ...

设计要点：
  - 分片按「使用量(uses)降序」切分，所以分片 0 就是最热的一批，首屏只拉它。
  - 字段用短键 + 去掉冗余（authorAvatar/sourceUrl 均可派生/移除），进一步减小体积。
    短键含义见 manifest.schema。
  - 每个分片独立 gzip，前端用 DecompressionStream 原生解压。

用法：
  python3 scripts/build_shards.py                        # 默认 3000 条/片
  python3 scripts/build_shards.py --shard-size 2000
"""
import argparse
import gzip
import json
import os

POST_BASE = "https://www.runninghub.cn/post/"

# 七牛云缩略参数：原图平均 ~600KB，加载 48 张就是 ~12MB（真正的加载瓶颈）。
# 统一改写为 480x300 缩略图，体积可降 80~90%。卡片 CSS 为 aspect-ratio 16/10。
THUMB_QUERY = "?imageView2/2/w/480/h/300/format/jpg"


def thumb(url):
    """把原图 URL 改写为缩略图 URL（剥掉原查询串，换成缩略参数）。"""
    if not url:
        return None
    return url.split("?")[0] + THUMB_QUERY


def lean(it):
    """压缩为渲染所需的最小字段（短键）。"""
    s = it.get("stats") or {}
    d = it.get("description") or ""
    return {
        "i": it.get("id"),
        "n": it.get("name") or "",
        "a": it.get("author") or "",
        "im": thumb(it.get("image")),
        "t": it.get("publishedAt") or "",
        "s": {
            "u": int(s.get("uses") or 0),
            "d": int(s.get("downloads") or 0),
            "l": int(s.get("likes") or 0),
            "c": int(s.get("collects") or 0),
        },
        "g": it.get("tags") or [],
        "d": d[:100],
    }


def main():
    ap = argparse.ArgumentParser(description="把工作流数据切成 gzip 分片")
    ap.add_argument("--src", default="data/workflows.json", help="源 JSON（完整数据）")
    ap.add_argument("--outdir", default="data", help="产物输出目录")
    ap.add_argument("--shard-size", type=int, default=3000, help="每片条数（默认 3000）")
    args = ap.parse_args()

    with open(args.src, encoding="utf-8") as f:
        data = json.load(f)

    items = [lean(it) for it in data.get("items", [])]
    # 按使用量降序：保证分片 0 是最热的一批
    items.sort(key=lambda x: x["s"]["u"], reverse=True)
    total = len(items)

    os.makedirs(args.outdir, exist_ok=True)
    # 清理旧分片
    for fn in os.listdir(args.outdir):
        if fn.startswith("wf-shard-") and fn.endswith(".json.gz"):
            os.remove(os.path.join(args.outdir, fn))

    shards = []
    for idx in range(0, total, args.shard_size):
        chunk = items[idx : idx + args.shard_size]
        name = f"wf-shard-{idx // args.shard_size:03d}.json.gz"
        path = os.path.join(args.outdir, name)
        payload = json.dumps(chunk, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with gzip.open(path, "wb", compresslevel=9) as f:
            f.write(payload)
        shards.append(name)

    manifest = {
        "source": data.get("source"),
        "sourceUrl": data.get("sourceUrl"),
        "postBase": POST_BASE,  # 前端用它拼 sourceUrl = postBase + id
        "updatedAt": data.get("updatedAt"),
        "platformTotal": data.get("platformTotal"),
        "count": total,
        "shardSize": args.shard_size,
        "schema": {
            "i": "id", "n": "name", "a": "author", "im": "image",
            "t": "publishedAt", "s": "stats{u,d,l,c}=使用/下载/点赞/收藏",
            "g": "tags", "d": "description",
        },
        "shards": shards,
    }
    mpath = os.path.join(args.outdir, "wf-manifest.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    gz_total = sum(os.path.getsize(os.path.join(args.outdir, s)) for s in shards)
    first = os.path.getsize(os.path.join(args.outdir, shards[0])) if shards else 0
    print(f"✅ 分片构建完成 → {args.outdir}")
    print(f"   总条目   : {total}（分 {len(shards)} 片，每片 {args.shard_size}）")
    print(f"   首片(最热): {shards[0]}  {first/1024:.0f} KB  ← 首屏只拉这个")
    print(f"   全部分片 : {gz_total/1024:.0f} KB")
    print(f"   清单     : {mpath}")


if __name__ == "__main__":
    main()
