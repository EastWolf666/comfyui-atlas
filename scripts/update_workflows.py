#!/usr/bin/env python3
"""
工作流增量更新（供 CI 定时任务调用）
====================================
背景：完整数据 data/workflows.json 已 gitignore（不入库），所以 CI 里没有历史
数据就无法去重。但**分片是入库的**，且分片里保存了渲染所需的全部字段，因此可以：

  1. 从 data/wf-shard-*.json.gz 反解出完整数据（还原stats/标签/描述等）
  2. 只抓取「最新发布」的前若干页（RunningHub 接口按发布时间倒序，新工作流一定在前）
  3. 按 id 合并，**已存在的 id 只更新热度统计、不重复追加**（热度会随时间增长）
  4. 重建分片 + 清单

这样每次增量只需请求几百条，而不是重抓 8.6 万条。

用法：
  python3 scripts/update_workflows.py                    # 默认扫 40 页（2000 条）
  python3 scripts/update_workflows.py --pages 80# 扫 80 页
  python3 scripts/update_workflows.py --full-rescan      # 重新扫全平台（补漏，很慢）
"""
import argparse
import glob
import gzip
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scrape_runninghub import fetch_page, map_record, to_int  # noqa: E402

SHARD_RE = re.compile(r"wf-shard-(\d+)\.json\.gz$")
THUMB_QUERY = "?imageView2/2/w/480/h/300/format/jpg"


def unthumb(url):
    """把缩略图 URL 还原成原图（交给 lean() 再统一缩放，避免重复叠加参数）。"""
    if not url:
        return None
    return url.split("?")[0]


def sharded_to_raw(lean_it, raw):
    """用分片里的最新数据回填 raw 记录（热度可能已更新）。"""
    s = lean_it.get("s") or {}
    raw["stats"] = {
        "likes": int(s.get("l") or 0),
        "downloads": int(s.get("d") or 0),
        "uses": int(s.get("u") or 0),
        "collects": int(s.get("c") or 0),
    }
    # 分片里没存的字段（authorAvatar / authorId / system 等）保持原样
    return raw


def lean_to_raw(lean_it):
    """把分片里的短键记录还原成 build_shards.lean() 期望的长键格式。

    关键：必须还原成 **长键**（id/name/stats.uses…），否则 build_shards.lean()
    读不到字段，会把所有条目压成空记录（实测会丢掉全部分片数据）。
    """
    s = lean_it.get("s") or {}
    return {
        "id": lean_it.get("i"),
        "name": lean_it.get("n") or "",
        "platform": "RunningHub",
        "description": lean_it.get("d") or "",
        "author": lean_it.get("a") or "",
        "authorAvatar": None,
        "authorId": None,
        # 交回原图（去掉缩略参数），由 build_shards.lean() 统一缩放
        "image": unthumb(lean_it.get("im")),
        "sourceUrl": "https://www.runninghub.cn/post/" + str(lean_it.get("i")),
        "publishedAt": lean_it.get("t") or "",
        "stats": {
            "uses": int(s.get("u") or 0),
            "downloads": int(s.get("d") or 0),
            "likes": int(s.get("l") or 0),
            "collects": int(s.get("c") or 0),
        },
        "tags": lean_it.get("g") or [],
        "system": False,
    }


def load_existing(data_dir):
    """从分片反解出 {id: 长键记录}，以及清单里的 platformTotal/updatedAt。

    返回的记录已是 build_shards.lean() 能识别的长键格式，可直接与新抓取的数据合并。
    """
    items = {}
    for path in sorted(glob.glob(os.path.join(data_dir, "wf-shard-*.json.gz"))):
        if not SHARD_RE.search(os.path.basename(path)):
            continue
        try:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                for it in json.load(f):
                    if it.get("i"):
                        items[it["i"]] = lean_to_raw(it)
        except Exception as e:
            print(f"⚠️ 读取分片失败 {os.path.basename(path)}：{e}", file=sys.stderr)
    meta = {}
    mpath = os.path.join(data_dir, "wf-manifest.json")
    if os.path.exists(mpath):
        try:
            with open(mpath, encoding="utf-8") as f:
                m = json.load(f)
            meta = {
                "source": m.get("source"),
                "sourceUrl": m.get("sourceUrl"),
                "platformTotal": m.get("platformTotal"),
                "updatedAt": m.get("updatedAt"),
            }
        except Exception as e:
            print(f"⚠️ 读取清单失败：{e}", file=sys.stderr)
    return items, meta


def main():
    ap = argparse.ArgumentParser(description="增量更新工作流数据（CI 定时任务用）")
    ap.add_argument("--data-dir", default="data", help="数据目录（含分片与清单）")
    ap.add_argument("--pages", type=int, default=40,
                    help="扫描最新页数（每页 50 条，默认 40 = 2000 条）")
    ap.add_argument("--delay", type=float, default=0.4, help="每页延迟秒数")
    ap.add_argument("--full-rescan", action="store_true",
                    help="从第 1 页重新扫到底（补漏用，很慢；平台约 1770 页）")
    ap.add_argument("--shard-size", type=int, default=3000, help="每片条数（默认 3000）")
    ap.add_argument("--rank-top", type=int, default=600,
                    help="每个排序维度内联的榜单条数（默认 600，与手动构建一致）")
    ap.add_argument("--dry-run", action="store_true", help="只抓取与统计，不写文件")
    args = ap.parse_args()

    items, meta = load_existing(args.data_dir)
    known = set(items)
    print(f"📦 从分片载入历史数据 {len(items)} 条"
          + (f"（上次更新 {meta.get('updatedAt')}）" if meta.get("updatedAt") else ""))

    total = meta.get("platformTotal")
    start_page = 1
    if args.full_rescan:
        # 全量重扫：从第 1 页翻到没有记录为止
        page, added_total = 1, 0
        while True:
            try:
                data = fetch_page(page, 50, "")
            except Exception as e:
                print(f"  [页 {page}] 请求失败：{e}，跳过", file=sys.stderr)
                page += 1
                if page > 2000:
                    break
                continue
            payload = data.get("data") or {}
            records = payload.get("records") or []
            if not records:
                break
            if total is None:
                try:
                    total = int(payload.get("total"))
                except (TypeError, ValueError):
                    pass
            added = 0
            for r in records:
                rid = r.get("id")
                if not rid:
                    continue
                rec = map_record(r)
                rec["image"] = unthumb(rec.get("image"))
                if rid in known:
                    sharded_to_raw(items[rid], rec)  # 只更新热度
                else:
                    items[rid] = rec
                    known.add(rid)
                    added += 1
            added_total += added
            print(f"  [页 {page}] 新增 {added} 条，累计 {len(items)} 条")
            page += 1
            time.sleep(args.delay)
        print(f"✅ 全量重扫完成：新增 {added_total} 条，共 {len(items)} 条")
    else:
        # 增量模式：只扫最新若干页（接口按发布时间倒序 → 新数据一定在前面）
        for p in range(start_page, start_page + args.pages):
            try:
                data = fetch_page(p, 50, "")
            except Exception as e:
                print(f"  [页 {p}] 请求失败：{e}，重试一次", file=sys.stderr)
                time.sleep(args.delay * 2)
                try:
                    data = fetch_page(p, 50, "")
                except Exception:
                    continue
            if data.get("code") != 0:
                print(f"  [页 {p}] 接口返回 code={data.get('code')}，停止", file=sys.stderr)
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
                if not rid:
                    continue
                rec = map_record(r)
                rec["image"] = unthumb(rec.get("image"))
                if rid in known:
                    sharded_to_raw(items[rid], rec)  # 已存在：只更新热度
                else:
                    items[rid] = rec
                    known.add(rid)
                    added += 1
            print(f"  [页 {p}] 新增 {added} 条，累计 {len(items)} 条"
                  + (f"（全平台 {total}）" if total else ""))
            time.sleep(args.delay)

    pct = f"{round(100 * len(items) / total)}%" if isinstance(total, int) and total else "?"
    print(f"\n📊 抓取完成：共 {len(items)} 条（平台约 {total} 条，覆盖 {pct}）")

    if args.dry_run:
        print("🧪 dry-run，未写文件")
        return

    # 快照旧产物字节，用于判断"是否真的变了"（避免仅时间戳变动就触发提交+部署）
    def snapshot():
        snap = {}
        for fn in sorted(glob.glob(os.path.join(args.data_dir, "wf-shard-*.json.gz"))) + \
                 [os.path.join(args.data_dir, "wf-manifest.json")]:
            if os.path.exists(fn):
                with open(fn, "rb") as f:
                    snap[os.path.basename(fn)] = f.read()
        return snap

    before = snapshot()

    # 写出完整数据（临时产物，不入库），供 build_shards.py 使用
    out = {
        "source": meta.get("source") or "RunningHub",
        "sourceUrl": meta.get("sourceUrl") or "https://www.runninghub.cn/explore",
        "keyword": "",
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platformTotal": total,
        "count": len(items),
        "items": list(items.values()),
    }
    # 安全阀：条目必须有名字与 id，否则说明还原/合并出错，宁可不写
    bad = sum(1 for it in out["items"] if not it.get("id") or not it.get("name"))
    if bad > len(out["items"]) * 0.01:
        print(f"❌ 安全阀触发：{bad}/{len(out['items'])} 条缺少 id/name，"
              f"疑似还原格式错误，中止写入（保护现有分片）", file=sys.stderr)
        sys.exit(1)
    with_img = sum(1 for it in out["items"] if it.get("image"))
    print(f"✅ 校验通过：{len(out['items'])} 条，其中 {with_img} 条有预览图")

    # 先判断内容（忽略 updatedAt）是否真的变了，避免"只动时间戳"的无意义提交。
    # 判定标准：条目数、平台总数、分片数、以及前 600 条的"id+热度"摘要
    # （热度会随时间增长，摘要不同即视为有更新）
    old_m = None
    omp = os.path.join(args.data_dir, "wf-manifest.json")
    if os.path.exists(omp):
        try:
            with open(omp, encoding="utf-8") as f:
                old_m = json.load(f)
        except Exception:
            old_m = None
    if old_m:
        try:
            with gzip.open(os.path.join(args.data_dir, "wf-shard-000.json.gz"), "rt",
                           encoding="utf-8") as f:
                old_s0 = json.load(f)
        except Exception:
            old_s0 = []

        def digest(rows):
            """确定性摘要（不能用内置 hash()，它对 str 加盐、每次进程结果不同）。"""
            h = 0
            for it in rows:
                s = it.get("s") or {}
                key = f"{it.get('i')}|{s.get('u')}|{s.get('l')}|{s.get('c')}"
                for ch in key:
                    h = (h * 31 + ord(ch)) & 0xFFFFFFFF
            return h

        # 新数据按使用量降序（与 build_shards 一致），取与旧首片等长的前缀比较
        by_uses = sorted(out["items"], key=lambda x: -((x.get("stats") or {}).get("uses") or 0))
        cmp_len = min(len(old_s0), 3000)
        new_head = [{"i": it.get("id"),
                     "s": {"u": (it.get("stats") or {}).get("uses"),
                           "l": (it.get("stats") or {}).get("likes"),
                           "c": (it.get("stats") or {}).get("collects")}}
                    for it in by_uses[:cmp_len]]
        same = (
            old_m.get("count") == len(out["items"])
            and old_m.get("platformTotal") == total
            and len(old_m.get("shards") or []) == -(-len(out["items"]) // args.shard_size)
            and cmp_len > 0
            and digest(old_s0[:cmp_len]) == digest(new_head)
        )
        if same:
            out["updatedAt"] = old_m.get("updatedAt")  # 沿用旧时间戳，保持产物字节一致
            print("ℹ️  数据内容无变化（条目/热度摘要一致），沿用旧 updatedAt")

    tmp = os.path.join(args.data_dir, "workflows.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"💾 已写出 {tmp}")

    # 重建分片与清单
    print("🔨 重建分片…")
    r = subprocess.run(
        [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_shards.py"),
         "--src", tmp, "--outdir", args.data_dir,
         "--shard-size", str(args.shard_size),
         "--rank-top", str(args.rank_top)],
        check=False,
    )
    if r.returncode != 0:
        print("❌ 分片构建失败", file=sys.stderr)
        sys.exit(r.returncode)

    # 校验产物：条目数必须与源数据一致，且首片不能是空壳
    with open(os.path.join(args.data_dir, "wf-manifest.json"), encoding="utf-8") as f:
        m2 = json.load(f)
    if m2.get("count") != len(out["items"]):
        print(f"❌ 产物条目数不符：清单 {m2.get('count')} != 源 {len(out['items'])}，"
              f"已保留旧分片，请检查", file=sys.stderr)
        sys.exit(1)
    s0 = os.path.getsize(os.path.join(args.data_dir, m2["shards"][0]))
    if len(out["items"]) > 1000 and s0 < 50_000:
        print(f"❌ 首片仅 {s0} 字节，疑似空壳数据，已中止", file=sys.stderr)
        sys.exit(1)

    # 清理临时产物（不入库，.gitignore 已覆盖）
    for p in (tmp, tmp + ".gz"):
        if os.path.exists(p):
            os.remove(p)

    # 字节级对比：确认"没变化时产物真的完全一致"（含 gzip 头，已用 mtime=0 固定）。
    # 这比上面的 digest 判定更严格，是幂等性的最终保证。
    after = snapshot()
    changed = [k for k in sorted(set(before) | set(after)) if before.get(k) != after.get(k)]
    if changed:
        print(f"🔄 产物有变化（{len(changed)} 个文件）：{', '.join(changed[:3])}"
              f"{' …' if len(changed) > 3 else ''}")
    else:
        print("✅ 幂等：产物字节与运行前完全一致，无需提交")
    print("✅ 全部完成：新清单 "
          f"{m2['count']} 条 / {len(m2['shards'])} 片")


if __name__ == "__main__":
    main()