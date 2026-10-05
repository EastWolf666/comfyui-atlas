#!/usr/bin/env python3
"""
RunningHub 工作流抓取脚本
========================
从 RunningHub（国内最大的 ComfyUI 云端平台，约 8.8 万条工作流）的公开搜索接口
拉取工作流元数据，生成 data/workflows.json，供「ComfyUI Atlas · 工作流库」页面使用。

接口：POST https://www.runninghub.cn/api/search/workflow
返回：{ code, data:{ records, total, pages, current, size, hasNext } }
说明：
  - 该接口仅接受 current(页码) / size(每页条数, 最大 50) 两个参数用于翻页；
    orderBy / keyword 等参数服务端忽略，永远按“发布时间倒序”返回。
  - 因此“按热度/下载/点赞排序”由前端在本地完成（见站点首页 index.html）。
  - 接口无需鉴权，公开可访问。

用法：
  python3 scripts/scrape_runninghub.py                 # 默认拉 40 页 × 50 = 2000 条
  python3 scripts/scrape_runninghub.py --pages 20      # 拉 20 页
  python3 scripts/scrape_runninghub.py --page-size 50 --pages 10
  python3 scripts/scrape_runninghub.py --append --start-page 1 --pages 120
        # 续采：读取已有 data/workflows.json，按 id 去重，从第 1 页继续抓 120 页
        #（会从第 1 页重新扫以补上间隔期新发布的工作流，再向后翻页扩充总量）
"""
import argparse
import gzip
import json
import os
import shutil
import sys
import time
import urllib.request
import urllib.error

API = "https://www.runninghub.cn/api/search/workflow"
UA = "Mozilla/5.0 (compatible; ComfyUI-Atlas/1.0; +https://github.com/EastWolf666/comfyui-atlas)"

# 字段白名单：只保留页面需要的字段，避免文件过大
KEEP_TAGS = True


def fetch_page(page_num, page_size, keyword):
    body = json.dumps({
        "current": page_num,
        "size": page_size,
        "keyword": keyword or "",
    }).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": UA,
            "Origin": "https://www.runninghub.cn",
            "Referer": "https://www.runninghub.cn/explore",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def map_record(r):
    owner = r.get("owner") or {}
    stats = r.get("statisticsInfo") or {}
    covers = r.get("covers") or []
    cover = covers[0] if covers else None
    tags = r.get("tags") or []
    tag_names = [t.get("name") for t in tags if t.get("name")]
    name = (r.get("name") or "").strip()
    desc = " ".join((r.get("desc") or "").split())
    # 描述仅用于搜索命中，卡片不渲染，截断到 100 字符以减小体积
    if len(desc) > 100:
        desc = desc[:100] + "…"
    image = None
    if cover:
        image = cover.get("thumbnailUri") or cover.get("url")
    return {
        "id": r.get("id"),
        "name": name,
        "platform": "RunningHub",
        "description": desc,
        "author": owner.get("name"),
        "authorAvatar": owner.get("avatar"),
        "authorId": owner.get("id"),
        "image": image,
        "sourceUrl": "https://www.runninghub.cn/post/" + str(r.get("id")),
        "publishedAt": r.get("publishTime"),
        "stats": {
            "likes": to_int(stats.get("likeCount")),
            "downloads": to_int(stats.get("downloadCount")),
            "uses": to_int(stats.get("useCount")),
            "collects": to_int(stats.get("collectCount")),
            "views": to_int(stats.get("pv")),
        },
        "tags": tag_names,
        "system": bool(r.get("systemWorkflow")),
    }


def main():
    ap = argparse.ArgumentParser(description="抓取 RunningHub ComfyUI 工作流")
    ap.add_argument("--pages", type=int, default=40, help="抓取页数（默认 40，按最新倒序）")
    ap.add_argument("--page-size", type=int, default=50, help="每页条数（默认 50，接口最大 50）")
    ap.add_argument("--keyword", default="", help="关键词（注意：服务端忽略，仅作记录）")
    ap.add_argument("--delay", type=float, default=0.5, help="每页之间延迟秒数")
    ap.add_argument("--out", default="data/workflows.json", help="输出 JSON 路径")
    ap.add_argument("--start-page", type=int, default=1, help="起始页码（默认 1；续采时设为上次结束页之后）")
    ap.add_argument("--append", action="store_true", help="追加模式：读取已有输出文件，按 id 去重后继续向后翻页")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    items = {}
    total = None
    # 追加模式：先把已有数据按 id 载入，避免重复
    if args.append and os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                prev = json.load(f)
            for it in prev.get("items", []):
                if it.get("id"):
                    items[it["id"]] = it
            if prev.get("platformTotal") is not None:
                total = prev.get("platformTotal")
            print(f"  [续采] 已载入已有 {len(items)} 条，将从第 {args.start_page} 页继续…")
        except Exception as e:
            print(f"  [续采] 读取旧文件失败：{e}，将重新采集", file=sys.stderr)

    seen = 0
    for p in range(args.start_page, args.start_page + args.pages):
        try:
            data = fetch_page(p, args.page_size, args.keyword)
        except urllib.error.HTTPError as e:
            print(f"  [页 {p}] HTTP 错误 {e.code}，重试一次", file=sys.stderr)
            time.sleep(args.delay * 2)
            continue
        except Exception as e:
            print(f"  [页 {p}] 请求失败：{e}，重试一次", file=sys.stderr)
            time.sleep(args.delay * 2)
            continue

        if data.get("code") != 0:
            print(f"  [页 {p}] 接口返回 code={data.get('code')} msg={data.get('msg')}", file=sys.stderr)
            break

        payload = data.get("data") or {}
        if total is None:
            try:
                total = int(payload.get("total"))
            except (TypeError, ValueError):
                total = payload.get("total")
        records = payload.get("records") or []
        if not records:
            print(f"  [页 {p}] 无记录，停止翻页", file=sys.stderr)
            break

        added = 0
        for r in records:
            rid = r.get("id")
            if not rid or rid in items:
                continue
            items[rid] = map_record(r)
            added += 1
        seen += added
        print(f"  [页 {p}] 本页新增 {added} 条，累计 {len(items)} 条"
              + (f"（全平台总数 {total}）" if total else ""))
        time.sleep(args.delay)

    out = {
        "source": "RunningHub",
        "sourceUrl": "https://www.runninghub.cn/explore",
        "keyword": args.keyword,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platformTotal": total,
        "count": len(items),
        "items": list(items.values()),
    }
    # 紧凑输出（无缩进），显著减小体积、加快前端加载
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    # 同时生成 gzip，供前端 DecompressionStream 原生解压加载
    gz_path = args.out + ".gz"
    with open(args.out, "rb") as fin, gzip.open(gz_path, "wb", compresslevel=9) as fout:
        shutil.copyfileobj(fin, fout)

    jb = os.path.getsize(args.out)
    gb = os.path.getsize(gz_path)
    print(f"\n✅ 已写入 {args.out}：共 {len(items)} 条工作流"
          + (f"（全平台约 {total} 条，本次索引 {round(100*len(items)/total)}%）" if isinstance(total, int) and total else ""))
    print(f"   紧凑 JSON {jb/1024:.0f} KB ｜ gzip {gb/1024:.0f} KB（{100*gb/jb:.0f}%，前端加载走 gzip）")


if __name__ == "__main__":
    main()
