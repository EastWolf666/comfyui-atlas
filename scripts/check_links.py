#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ComfyUI Atlas —— 链接健康检查器
================================
扫描数据文件里的所有「访问链接」（节点 GitHub 仓库、各平台模型下载直链），
并发发起 HTTP 请求，按状态分类，快速揪出 404 / 失效 / 被反爬拦截的链接。

分类规则：
  OK      2xx / 3xx（最终可达）
  DEAD    404 / 410（基本可判定为已删除/失效）—— 需要修复
  BLOCKED 401 / 403 / 429（多半是站点反爬把脚本挡了，浏览器里可能正常）—— 需人工确认
  ERROR   连接失败 / 超时 / DNS / SSL 等网络层错误 —— 需人工确认或重试

用法：
  # 检查本站精选数据（modules.json 的 repo + 模型 source）
  python3 scripts/check_links.py

  # 同时抽查注册表仓库（默认随机抽 300 个，避免一次性打 5000+ 请求）
  python3 scripts/check_links.py --registry --sample 300

  # 严格模式：只要出现 DEAD 就以非零退出码结束（适合 CI 卡点）
  python3 scripts/check_links.py --strict

  # 自定义并发与超时
  python3 scripts/check_links.py --workers 12 --timeout 15

  # 输出 JSON 报告
  python3 scripts/check_links.py --json report.json
"""
import argparse
import concurrent.futures as cf
import json
import random
import sys
import time
from collections import defaultdict
from urllib.parse import urlparse

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
DEAD = {404, 410}
BLOCKED = {401, 403, 429}


def classify(status, err):
    if err:
        return "ERROR", err
    if status in DEAD:
        return "DEAD", f"HTTP {status}"
    if status in BLOCKED:
        return "BLOCKED", f"HTTP {status}（反爬/限流，需人工确认）"
    if 200 <= status < 400:
        return "OK", f"HTTP {status}"
    return "ERROR", f"HTTP {status}"


def check(url, timeout, retries=3):
    """对单个 URL 做可达性探测。返回 (status, error_or_None)。

    网络层错误（连接失败/超时/SSL）与 429 限流会按指数退避重试，
    避免把「瞬时限流/并发抖动」误判为失效链接。
    """
    last = None
    sess = requests.Session()
    for attempt in range(retries + 1):
        try:
            r = sess.get(
                url,
                headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"},
                timeout=timeout,
                allow_redirects=True,
                stream=True,
            )
            status = r.status_code
            # 只读一点点就关闭，避免下载大文件
            try:
                next(r.iter_content(2048), None)
            except Exception:
                pass
            r.close()
            if status == 429 and attempt < retries:  # 限流，退避后重试
                time.sleep(2 * (attempt + 1))
                continue
            return status, None
        except (
            requests.exceptions.SSLError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ) as e:
            last = "连接失败: " + str(e)[:80]
            if attempt < retries:
                time.sleep(min(2 * (attempt + 1), 8))
                continue
            return None, last
        except requests.exceptions.TooManyRedirects:
            return None, "重定向过多"
        except Exception as e:
            return None, str(e)[:120]
    return None, last or "未知错误"


def collect_urls(modules_path, registry_path, sample):
    """返回 [(label, url), ...] 以及来源说明。"""
    pairs = []
    try:
        data = json.load(open(modules_path, encoding="utf-8"))
        for m in data.get("modules", []):
            if m.get("repo"):
                pairs.append((f"节点仓库 · {m.get('name','?')}", m["repo"]))
            for mo in m.get("models", []) or []:
                for s in mo.get("sources", []) or []:
                    if s.get("url"):
                        pairs.append(
                            (f"模型 · {mo.get('name','?')} · {s.get('platform','?')}", s["url"])
                        )
    except Exception as e:
        print(f"[warn] 读取 {modules_path} 失败: {e}", file=sys.stderr)

    if registry_path:
        try:
            reg = json.load(open(registry_path, encoding="utf-8"))
            repos = reg.get("repos", []) or []
            if sample and sample < len(repos):
                repos = random.sample(repos, sample)
            for repo in repos:
                if repo:
                    pairs.append(("注册表仓库(抽样)", repo))
        except Exception as e:
            print(f"[warn] 读取 {registry_path} 失败: {e}", file=sys.stderr)

    return pairs


def main():
    ap = argparse.ArgumentParser(description="ComfyUI Atlas 链接健康检查器")
    ap.add_argument("--data", default="data/modules.json")
    ap.add_argument("--registry", default="data/registry-nodes.json",
                    help="传入路径即同时检查注册表仓库；设为空字符串可关闭")
    ap.add_argument("--sample", type=int, default=300,
                    help="注册表仓库抽样数量（0 表示全量）")
    ap.add_argument("--workers", type=int, default=6,
                    help="并发数（GitHub 等对沙箱 IP 限流较严，建议 4~8）")
    ap.add_argument("--timeout", type=int, default=15)
    ap.add_argument("--strict", action="store_true", help="出现 DEAD 时退出码非 0")
    ap.add_argument("--json", default=None, help="将报告写入该 JSON 文件")
    args = ap.parse_args()

    if args.registry:
        pairs = collect_urls(args.data, args.registry, args.sample)
    else:
        pairs = collect_urls(args.data, None, 0)

    if not pairs:
        print("没有可检查的链接。")
        return

    print(f"开始检查 {len(pairs)} 个链接（并发 {args.workers}，超时 {args.timeout}s）…\n")

    results = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        fut_map = {ex.submit(check, url, args.timeout): (label, url) for label, url in pairs}
        done = 0
        for fut in cf.as_completed(fut_map):
            label, url = fut_map[fut]
            status, err = fut.result()
            cat, detail = classify(status, err)
            results.append({"label": label, "url": url, "category": cat,
                            "status": status, "detail": detail})
            done += 1
            if done % 25 == 0 or done == len(pairs):
                print(f"  进度 {done}/{len(pairs)}")

    # 汇总
    by_cat = defaultdict(list)
    for r in results:
        by_cat[r["category"]].append(r)

    print("\n================ 检查结果 ================")
    for cat in ("DEAD", "BLOCKED", "ERROR", "OK"):
        items = by_cat.get(cat, [])
        print(f"\n[{cat}] {len(items)} 个")
        if cat in ("DEAD", "BLOCKED", "ERROR"):
            for r in items:
                print(f"  - {r['label']}")
                print(f"      {r['url']}")
                print(f"      -> {r['detail']}")

    print(f"\n总计: OK={len(by_cat.get('OK',[]))}  DEAD={len(by_cat.get('DEAD',[]))}  "
          f"BLOCKED={len(by_cat.get('BLOCKED',[]))}  ERROR={len(by_cat.get('ERROR',[]))}")

    if args.json:
        json.dump({"summary": {k: len(v) for k, v in by_cat.items()}, "results": results},
                  open(args.json, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(f"\n报告已写入 {args.json}")

    if args.strict and by_cat.get("DEAD"):
        sys.exit(1)


if __name__ == "__main__":
    main()
