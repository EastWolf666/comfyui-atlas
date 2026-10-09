#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模块模型自动扩充爬虫
====================
从 Hugging Face / Civitai / ModelScope 拉取热门「图像生成」模型，按下载地址幂等去重后，
追加为 data/modules.json 中的标准模块条目（category="扩充收录"）。

设计要点
--------
- 纯标准库（urllib + json），GitHub Actions 可直接运行，无需安装依赖。
- 幂等：以「归一化后的 source URL」为去重键，重复运行不会重复添加。
- 安全：仅追加、--max 封顶、单平台失败降级、不 force push（提交由 workflow 负责）。
- 沙箱出网受限，无法实跑真实抓取；用 --self-test 校验「抓取→去重→合并→schema」逻辑。

用法
----
  python3 scripts/scrape_models.py --self-test
  python3 scripts/scrape_models.py --dry-run                 # 不写文件，只打印将新增的条目
  python3 scripts/scrape_models.py --max 50 --platforms hf,civitai,modelscope
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_MAX = 50
DEFAULT_PLATFORMS = "hf,civitai,modelscope"
DATA_PATH = "data/modules.json"
UA = "comfyui-atlas-scraper/1.0 (+https://github.com/EastWolf666/comfyui-atlas)"
TIMEOUT = 25

# HF 检索关键词 -> 推断的模型类型（同时充当相关性过滤）
HF_KEYWORDS = {
    "lora": "lora",
    "sdxl": "checkpoint",
    "flux": "checkpoint",
    "controlnet": "controlnet",
    "embedding": "embedding",
    "upscaler": "upscale",
    "anime": "checkpoint",
    "vae": "vae",
    "hypernetwork": "hypernetwork",
    "diffusion": "checkpoint",
}
# HF pipeline_tag 中属于「图像生成」域的白名单
HF_IMAGE_TAGS = {
    "text-to-image", "image-to-image", "stable-diffusion", "image-upscaling",
    "unconditional-image-generation", "controlnet", "lora", "textual-inversion",
    "super-resolution", "image-to-video", "image-classification",
}
# Civitai 类型 -> 我们使用的类型名
CIVITAI_TYPE_MAP = {
    "Checkpoint": "checkpoint", "LORA": "lora", "LoCon": "lora",
    "TextualInversion": "embedding", "Hypernetwork": "hypernetwork",
    "Controlnet": "controlnet", "VAE": "vae", "AestheticGradient": "embedding",
    "MotionModule": "motion", "Poses": "pose", "Wildcards": "wildcard",
}


def http_get(url, params=None, retries=2):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last_err = None
    for _ in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as e:
            last_err = e
            time.sleep(2)
    print(f"  [warn] 请求失败 {url} -> {last_err}", file=sys.stderr)
    return None


def norm_url(u):
    """归一化 URL 用于去重：去 scheme、去尾斜杠、小写 host。"""
    if not u:
        return ""
    p = urllib.parse.urlparse(u.strip())
    host = p.netloc.lower()
    path = p.path.rstrip("/")
    return host + path


def slugify(s):
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "model"


# ----------------------------- 平台 fetcher -----------------------------
def fetch_hf(per_kw=15):
    out = []
    for kw, guessed in HF_KEYWORDS.items():
        data = http_get("https://huggingface.co/api/models", {
            "search": kw, "sort": "downloads", "direction": "-1",
            "limit": per_kw, "full": "false",
        })
        if not isinstance(data, list):
            continue
        for it in data:
            mid = it.get("id") or ""
            if "/" not in mid:
                continue
            tag = (it.get("pipeline_tag") or "").lower()
            # 相关性：pipeline_tag 在白名单，或关键词本身属于图像域
            if tag and tag not in HF_IMAGE_TAGS and kw not in HF_KEYWORDS:
                continue
            author = mid.split("/")[0]
            name = mid.split("/")[-1]
            url = "https://huggingface.co/" + mid
            out.append({
                "platform": "huggingface",
                "url": url,
                "name": name,
                "type": guessed,
                "author": it.get("author") or author,
                "description": (it.get("description") or "")[:120],
                "size": None,
            })
        time.sleep(0.5)
    return out


def fetch_civitai(limit=60):
    out = []
    data = http_get("https://civitai.com/api/v1/models", {
        "limit": limit, "sort": "MostDownloaded",
        "types": "Checkpoint,LORA,TextualInversion,VAE,Hypernetwork,Controlnet",
    })
    items = (data or {}).get("items") or []
    for it in items:
        mid = it.get("id")
        if not mid:
            continue
        name = it.get("name") or str(mid)
        url = "https://civitai.com/models/" + str(mid)
        ctype = CIVITAI_TYPE_MAP.get(it.get("type") or "", "checkpoint")
        out.append({
            "platform": "civitai",
            "url": url,
            "name": name,
            "type": ctype,
            "author": (it.get("creator") or {}).get("username") or "",
            "description": re.sub(r"<[^>]+>", " ", it.get("description") or "")[:120],
            "size": None,
        })
    return out


def fetch_modelscope(page_size=50):
    out = []
    # 优先主接口，404 再试 search 接口（best-effort）
    data = http_get("https://modelscope.cn/api/v1/models", {
        "PageSize": page_size, "SortBy": "Downloads", "Direction": "Desc",
    })
    models = []
    if isinstance(data, dict):
        models = (data.get("Data") or {}).get("Models") or []
    if not models:
        data = http_get("https://modelscope.cn/api/v1/models/search", {
            "PageSize": page_size, "SortBy": "Downloads", "Direction": "Desc",
        })
        if isinstance(data, dict):
            models = (data.get("Data") or {}).get("Models") or []
    for it in models:
        mid = it.get("ModelId") or it.get("modelId") or ""
        if not mid or "/" not in mid:
            continue
        author = mid.split("/")[0]
        name = mid.split("/")[-1]
        url = "https://modelscope.cn/models/" + mid
        out.append({
            "platform": "modelscope",
            "url": url,
            "name": name,
            "type": "checkpoint",
            "author": it.get("Author") or it.get("author") or author,
            "description": (it.get("Summary") or it.get("summary") or "")[:120],
            "size": None,
        })
    return out


FETCHERS = {
    "hf": fetch_hf,
    "civitai": fetch_civitai,
    "modelscope": fetch_modelscope,
}


# ----------------------------- 转换为模块条目 -----------------------------
def build_module(cand, existing_ids):
    platform = cand["platform"]
    url = cand["url"]
    slug = slugify(cand.get("name") or url)
    base_id = f"auto-{platform}-{slug}"
    mid = base_id
    i = 1
    while mid in existing_ids:
        i += 1
        mid = f"{base_id}-{i}"

    sources = [{"platform": platform, "url": url}]
    if cand.get("size"):
        sources[0]["size"] = cand["size"]
    # HF 条目顺手补一个国内镜像源
    if platform == "huggingface":
        mirror = "https://hf-mirror.com/" + url.split("huggingface.co/", 1)[-1].strip("/")
        sources.append({"platform": "hf-mirror", "url": mirror})

    mtype = cand.get("type") or "model"
    name = cand.get("name") or slug
    return {
        "id": mid,
        "name": name,
        "repo": url,
        "category": "扩充收录",
        "author": cand.get("author") or "",
        "official": False,
        "maintenance": "active",
        "description": (cand.get("description") or "").strip(),
        "tags": ["auto", platform, mtype],
        "models": [{"name": name, "type": mtype, "sources": sources}],
    }, mid


def run(platforms, max_n, data_path, dry_run):
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    modules = data.setdefault("modules", [])

    existing_urls = set()
    existing_ids = set()
    for m in modules:
        existing_ids.add(m.get("id"))
        for mo in (m.get("models") or []):
            for s in (mo.get("sources") or []):
                if s.get("url"):
                    existing_urls.add(norm_url(s["url"]))

    new_modules = []
    seen = set()
    for p in platforms:
        fetcher = FETCHERS.get(p)
        if not fetcher:
            print(f"[skip] 未知平台: {p}", file=sys.stderr)
            continue
        print(f"[info] 抓取平台 {p} ...")
        for cand in fetcher():
            nu = norm_url(cand["url"])
            if not nu or nu in existing_urls or nu in seen:
                continue
            seen.add(nu)
            mod, mid = build_module(cand, existing_ids)
            existing_ids.add(mid)
            new_modules.append(mod)
            if len(new_modules) >= max_n:
                break
        if len(new_modules) >= max_n:
            break

    if not new_modules:
        print("[done] 没有需要新增的模型条目（均已收录或本次无新数据）。")
        return 0

    new_modules = new_modules[:max_n]
    if dry_run:
        print(f"[dry-run] 将新增 {len(new_modules)} 条（不写文件）：")
        for m in new_modules:
            plats = sorted({s["platform"] for mo in m["models"] for s in mo["sources"]})
            print(f"  - {m['name']}  [{','.join(plats)}]  {m['repo']}")
        return len(new_modules)

    modules.extend(new_modules)
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[done] 已追加 {len(new_modules)} 条到 {data_path}。")
    return len(new_modules)


# ----------------------------- 自测 -----------------------------
def self_test():
    print("[self-test] 开始校验转换/去重/合并/schema ...")
    # 伪造一份现有数据：包含一个会命中去重的 HF 条目
    dup_url = "https://huggingface.co/already/exists"
    data = {
        "meta": {"note": "test"},
        "modules": [
            {"id": "seed-1", "name": "seed", "repo": dup_url, "category": "基础模型",
             "author": "x", "official": False, "maintenance": "active",
             "description": "d", "tags": [], "models": [
                 {"name": "seed", "type": "checkpoint", "sources": [
                     {"platform": "huggingface", "url": dup_url}]}]},
        ],
    }
    existing_urls = set()
    existing_ids = set()
    for m in data["modules"]:
        existing_ids.add(m["id"])
        for mo in m["models"]:
            for s in mo["sources"]:
                existing_urls.add(norm_url(s["url"]))

    samples = [
        # 应与 seed-1 命中 dup_url -> 被去重
        {"platform": "huggingface", "url": dup_url, "name": "exists",
         "type": "checkpoint", "author": "already", "description": "d", "size": None},
        # 新条目，应保留；HF 应额外带 hf-mirror 源
        {"platform": "huggingface", "url": "https://huggingface.co/foo/bar-lora",
         "name": "Bar LoRA", "type": "lora", "author": "foo", "description": "a lora", "size": "0.2 GB"},
        {"platform": "civitai", "url": "https://civitai.com/models/123456",
         "name": "Civ Model", "type": "checkpoint", "author": "someone", "description": "civ", "size": None},
    ]
    new_modules = []
    seen = set()
    for cand in samples:
        nu = norm_url(cand["url"])
        if nu in existing_urls or nu in seen:
            continue
        seen.add(nu)
        mod, mid = build_module(cand, existing_ids)
        existing_ids.add(mid)
        new_modules.append(mod)

    # 断言
    assert len(new_modules) == 2, f"去重失败：期望 2 条，实际 {len(new_modules)}"
    hf_mod = next(m for m in new_modules if m["id"] == "auto-huggingface-bar-lora")
    plats = {s["platform"] for mo in hf_mod["models"] for s in mo["sources"]}
    assert {"huggingface", "hf-mirror"} <= plats, f"HF 镜像源缺失：{plats}"
    sz = next(s["size"] for mo in hf_mod["models"] for s in mo["sources"]
              if s["platform"] == "huggingface")
    assert sz == "0.2 GB", "size 未透传"
    # schema 字段齐全
    req = {"id", "name", "repo", "category", "author", "official",
           "maintenance", "description", "tags", "models"}
    for m in new_modules:
        assert req <= set(m), f"模块字段缺失：{set(m)}"
        for mo in m["models"]:
            assert {"name", "type", "sources"} <= set(mo)
            for s in mo["sources"]:
                assert {"platform", "url"} <= set(s)
    # 可被 json 序列化
    json.dumps(new_modules, ensure_ascii=False)
    print("[self-test] ✅ 通过：去重、HF 镜像源、size 透传、schema 合法性均正确。")
    return 0


def main():
    ap = argparse.ArgumentParser(description="ComfyUI Atlas 模块模型自动扩充")
    ap.add_argument("--data", default=DATA_PATH, help="data/modules.json 路径")
    ap.add_argument("--max", type=int, default=DEFAULT_MAX, help="本次新增上限")
    ap.add_argument("--platforms", default=DEFAULT_PLATFORMS, help="逗号分隔：hf,civitai,modelscope")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    ap.add_argument("--self-test", action="store_true", help="用内置样本校验逻辑（不联网）")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    platforms = [p.strip().lower() for p in args.platforms.split(",") if p.strip()]
    if not platforms:
        print("未指定任何平台。", file=sys.stderr)
        return 2
    if not os.path.exists(args.data):
        print(f"找不到数据文件：{args.data}", file=sys.stderr)
        return 2
    return run(platforms, args.max, args.data, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
