#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ComfyUI Atlas —— GitHub 置信度解析器（离线预置）
================================================
把「节点 class_type（类名）」通过 GitHub 搜索 API 解析为最可能的仓库，
并按「仓库名 / 描述 / 话题 与类名 的重合度」给出置信度评分，输出
data/github-extra.json，供前端作为「第 4 级匹配」直接使用（无需运行时调接口）。

适用场景：
  - 工作流分析器里仍有少量「未找到仓库」的节点，可把这些类名收集起来离线解析，
    生成 github-extra.json 提交进仓库，之后所有访客都能即时命中。
  - 比浏览器临时搜索更稳：不受 10 次/分钟 限流影响，且结果可人工复核。

用法：
  # 从文件读取节点类型（每行一个，# 开头为注释）
  python3 scripts/github_resolve.py nodes_to_resolve.txt

  # 或直接在命令行给
  python3 scripts/github_resolve.py --types "SeargeSDXL,CR Color Tint,EasyUse XYZ"

  # 提额：设置环境变量 GH_TOKEN（GitHub Personal Access Token，无需任何 scope）
  GH_TOKEN=ghp_xxx python3 scripts/github_resolve.py nodes.txt

评分规则（取候选仓库中的最高分）：
  仓库名(去掉 comfyui/nodes 后) 与类名完全一致 / 包含         → 0.90~0.95（高置信，可直接安装）
  类名 出现在 仓库描述 或 topics 中                           → 0.60（中置信，需人工确认）
  仓库 full_name 含 comfyui                                   → 0.50（弱信号，建议人工确认）
  低于 --min-confidence(默认 0.6) 的不会写入结果。
"""
import argparse
import json
import os
import re
import sys
import time

import requests

API = "https://api.github.com/search/repositories"
UA = "ComfyUIAtlasResolver/1.0"
TOKEN = os.environ.get("GH_TOKEN")


def search(typeq):
    q = f"{typeq} ComfyUI"
    h = {"User-Agent": UA, "Accept": "application/vnd.github+json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    try:
        r = requests.get(
            API,
            params={"q": q, "sort": "stars", "order": "desc", "per_page": 10},
            headers=h,
            timeout=20,
        )
        if r.status_code == 403 and "rate" in r.text.lower():
            return None, "rate-limited"
        r.raise_for_status()
        return r.json().get("items", []), None
    except Exception as e:
        return None, str(e)[:120]


def score(type, items):
    t = type.lower()
    tc = re.sub(r"[^a-z0-9]", "", t)
    best = None
    for it in items or []:
        full = (it.get("full_name") or "").lower()
        name = (it.get("name") or "").lower()
        rn = re.sub(r"[^a-z0-9]", "", name.replace("comfyui", "").replace("nodes", "").replace("node", ""))
        desc = (it.get("description") or "").lower()
        topics = " ".join(it.get("topics") or []).lower()
        conf = 0.0
        reason = ""
        if tc and rn and (rn == tc or rn.startswith(tc) or tc.startswith(rn)
                          or (len(tc) >= 5 and tc in rn) or (len(rn) >= 5 and rn in tc)):
            conf = 0.95 if rn == tc else 0.90
            reason = "仓库名与节点类名高度吻合"
        elif tc and (tc in desc or tc in topics):
            conf = 0.60
            reason = "仓库描述/话题提及该节点"
        elif "comfyui" in full:
            conf = 0.50
            reason = "ComfyUI 相关仓库（需人工确认）"
        if conf and (best is None or conf > best["confidence"]):
            best = {
                "repo": it.get("html_url"),
                "full_name": it.get("full_name"),
                "stars": it.get("stargazers_count"),
                "confidence": conf,
                "reason": reason,
            }
    return best


def main():
    ap = argparse.ArgumentParser(description="GitHub 置信度解析器（生成 github-extra.json）")
    ap.add_argument("infile", nargs="?", help="节点类型列表文件（每行一个，# 开头为注释）")
    ap.add_argument("--types", help="逗号分隔的节点类型")
    ap.add_argument("--out", default="data/github-extra.json")
    ap.add_argument("--min-confidence", type=float, default=0.6)
    args = ap.parse_args()

    types = []
    if args.types:
        types += [t.strip() for t in args.types.split(",") if t.strip()]
    if args.infile:
        try:
            types += [l.strip() for l in open(args.infile, encoding="utf-8")
                      if l.strip() and not l.startswith("#")]
        except Exception as e:
            print(f"[warn] 读取 {args.infile} 失败: {e}", file=sys.stderr)
    types = list(dict.fromkeys(types))  # 去重保序
    if not types:
        print("没有提供节点类型。示例：python3 scripts/github_resolve.py --types \"SeargeSDXL,CR Color Tint\"")
        sys.exit(1)

    print(f"开始解析 {len(types)} 个节点类型…（{'已设 GH_TOKEN，限流宽松' if TOKEN else '未登录，10 次/分钟，自动节流'}）\n")
    out = {}
    for i, t in enumerate(types):
        items, err = search(t)
        if items is None:
            print(f"  [跳过] {t}: {err}")
            if err == "rate-limited":
                print("        触发限流，请设置 GH_TOKEN 或稍后重试。")
            time.sleep(6)
            continue
        b = score(t, items)
        if b and b["confidence"] >= args.min_confidence:
            out[t.lower()] = {
                "repo": b["repo"],
                "confidence": b["confidence"],
                "reason": b["reason"],
                "stars": b["stars"],
            }
            print(f"  ✓ {t} -> {b['full_name']}  置信 {b['confidence']:.0%}  ({b['reason']})")
        else:
            print(f"  · {t}: 无高置信匹配")
        # 节流：未登录严格 10/min；已登录稍歇即可
        time.sleep(0 if TOKEN else 6.5)

    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n写入 {args.out}，共 {len(out)} 条高置信映射。")


if __name__ == "__main__":
    main()
