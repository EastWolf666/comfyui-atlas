#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模块模型自动扩充爬虫（v2：按类型配额 + 新模型精选）
==================================================
从 Hugging Face / Civitai / ModelScope 拉取热门模型，按「类型配额」补齐缺口：
每个模型类型（checkpoint/lora/vae/controlnet/embedding/ipadapter/insightface/
upscale/diffusion_model/video）目标条目数默认 50（按平台源计，与站点平台视图口径一致），
不足则自动抓取补齐。内置 CURATED_RECENT 最新模型精选（Qwen-Image、MiniMax H3、
Wan2.2、FLUX.1-Kontext 等），优先收录。

设计要点
--------
- 纯标准库（urllib + json），GitHub Actions 可直接运行，无需安装依赖。
- 幂等：以「归一化后的 source URL」为去重键，重复运行不会重复添加。
- 安全：仅追加、--max 封顶、单平台失败降级、不 force push（提交由 workflow 负责）。
- 沙箱出网受限，无法实跑真实抓取；用 --self-test 校验「配额→去重→合并→schema」逻辑。

用法
----
  python3 scripts/scrape_models.py --self-test
  python3 scripts/scrape_models.py --dry-run                 # 不写文件，只打印将新增的条目
  python3 scripts/scrape_models.py --target-per-type 50 --max 300
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

DEFAULT_MAX = 300
DEFAULT_TARGET = 50
DEFAULT_PLATFORMS = "hf,civitai,modelscope"
DATA_PATH = "data/modules.json"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
TIMEOUT = 25

ALL_TYPES = [
    "checkpoint", "lora", "vae", "controlnet", "embedding",
    "ipadapter", "insightface", "upscale", "diffusion_model", "video", "other",
]

# HF 检索关键词 -> 类型（每个关键词取下载量 Top，配额制按类型填充）
HF_KEYWORDS_BY_TYPE = {
    "lora": ["lora"],
    "vae": ["vae"],
    "controlnet": ["controlnet"],
    "embedding": ["embedding", "textual inversion"],
    "ipadapter": ["ip-adapter", "ipadapter", "instantid"],
    "insightface": ["insightface", "inswapper", "pulid", "face swap"],
    "upscale": ["upscaler", "esrgan", "swinir", "super-resolution"],
    "checkpoint": ["stable-diffusion", "sdxl", "flux"],
    "diffusion_model": ["qwen-image", "diT image"],
    "video": ["wan", "hunyuanvideo", "text-to-video", "ltxv", "minimax"],
}
# ModelScope 关键词 -> 类型
MS_KEYWORDS_BY_TYPE = {
    "lora": ["lora"],
    "vae": ["vae"],
    "controlnet": ["controlnet"],
    "embedding": ["embedding"],
    "ipadapter": ["ip-adapter"],
    "insightface": ["insightface"],
    "upscale": ["real-esrgan", "upscaler"],
    "checkpoint": ["stable-diffusion", "sdxl", "flux"],
    "diffusion_model": ["qwen-image"],
    "video": ["wan2.2", "hunyuanvideo", "text-to-video"],
}
# Civitai 类型 -> 我们的类型（单类型请求；组合请求易 400）
CIVITAI_TYPE_MAP = {
    "Checkpoint": "checkpoint", "LORA": "lora", "LoCon": "lora",
    "LoHa": "lora", "LoKr": "lora",
    "TextualInversion": "embedding", "Hypernetwork": "hypernetwork",
    "Controlnet": "controlnet", "VAE": "vae", "AestheticGradient": "embedding",
    "MotionModule": "motion", "Poses": "pose", "Wildcards": "wildcard",
    "Upscale": "upscale",
}
CIVITAI_FETCH = {
    "lora": ["LORA"],
    "vae": ["VAE"],
    "controlnet": ["Controlnet"],
    "embedding": ["TextualInversion"],
    "upscale": ["Upscale"],
}
# 明显不属于图像生成域的 HF 仓库名子串（search 按 downloads 排序会混入语音/文本等）
DENY_SUBSTR = [
    "rvc", "whisper", "tts", "asr", "bert", "gpt", "llama", "qwen2", "qwen3",
    "musicgen", "audiocraft", "bark", "speech", "voice", "wav2vec", "hubert",
    "xlm", "mt5", "clip-vit", "dinov", "segment-anything", "yolo", "wav",
]

# 最新模型精选（用户点名 + 2025~2026 高热度新模型）。HF 条目自动补 hf-mirror；
# 可选 ms_url 直接补 ModelScope 源。type 决定归类与 ComfyUI 放置目录。
CURATED_RECENT = [
    # ---- 图像扩散底模 / 编辑模型 ----
    {"platform": "huggingface", "url": "https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI",
     "name": "Qwen-Image (千问图像) ComfyUI 单文件", "type": "diffusion_model",
     "author": "Comfy-Org", "description": "阿里千问 Qwen-Image 20B 文生图模型，ComfyUI 官方 repack 单文件（含 VAE/文本编码器）。",
     "ms_url": "https://modelscope.cn/models/Qwen/Qwen-Image"},
    {"platform": "huggingface", "url": "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI",
     "name": "Qwen-Image-Edit 2511 ComfyUI 单文件", "type": "diffusion_model",
     "author": "Comfy-Org", "description": "千问图像编辑模型（2511 版），多图融合/换材质/重打光，ComfyUI 官方 repack（bf16/fp8/int8）。",
     "ms_url": "https://modelscope.cn/models/Qwen/Qwen-Image-Edit"},
    {"platform": "huggingface", "url": "https://huggingface.co/Qwen/Qwen-Image",
     "name": "Qwen-Image 官方权重", "type": "diffusion_model",
     "author": "Qwen", "description": "千问 Qwen-Image 官方 diffusers 权重仓库（文生图，中文文字渲染强）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/black-forest-labs/FLUX.1-Kontext-dev",
     "name": "FLUX.1 Kontext [dev]", "type": "diffusion_model",
     "author": "black-forest-labs", "description": "FLUX.1 Kontext 图像编辑/上下文生成模型（dev 权重）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/black-forest-labs/FLUX.1-Krea-dev",
     "name": "FLUX.1 Krea [dev]", "type": "diffusion_model",
     "author": "black-forest-labs", "description": "FLUX.1 Krea dev：Krea 与 BFL 合作的真实感文生图模型。"},
    {"platform": "huggingface", "url": "https://huggingface.co/HiDream-ai/HiDream-I1-Dev",
     "name": "HiDream-I1 Dev", "type": "diffusion_model",
     "author": "HiDream-ai", "description": "HiDream-I1 17B 开源图像模型（Dev 版），ComfyUI 原生支持。"},
    {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/stable-diffusion-3.5-large",
     "name": "Stable Diffusion 3.5 Large", "type": "diffusion_model",
     "author": "stabilityai", "description": "SD3.5 Large 8B MMDiT 文生图模型（含 ControlNet 生态）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/Alpha-VLLM/Lumina-Image-2.0",
     "name": "Lumina-Image 2.0", "type": "diffusion_model",
     "author": "Alpha-VLLM", "description": "Lumina-Image 2.0 2.6B DiT 文生图模型，ComfyUI 原生支持。"},
    # ---- 视频生成（含 MiniMax H3）----
    {"platform": "huggingface", "url": "https://huggingface.co/Comfy-Org/MiniMax-H3",
     "name": "MiniMax H3 ComfyUI 单文件", "type": "video",
     "author": "Comfy-Org", "description": "MiniMax H3 33B 视频+音频联合生成模型（最长 15 秒带立体声），ComfyUI 官方 repack 量化单文件（INT8 pruned 约 42.5GB）。",
     "size": "约 42.5 GB（量化单文件）"},
    {"platform": "huggingface", "url": "https://huggingface.co/MiniMaxAI/MiniMax-H3",
     "name": "MiniMax H3 官方权重", "type": "video",
     "author": "MiniMaxAI", "description": "MiniMax H3 官方开源权重（diffusers 全量约 498GB），文本编码器 Qwen3-VL-32B。"},
    {"platform": "huggingface", "url": "https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B",
     "name": "Wan2.2 TI2V 5B (万相2.2)", "type": "video",
     "author": "Wan-AI", "description": "万相 2.2 5B 图文生视频一体模型，消费级显卡可跑，ComfyUI 原生支持。",
     "ms_url": "https://modelscope.cn/models/Wan-AI/Wan2.2-TI2V-5B"},
    {"platform": "huggingface", "url": "https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B",
     "name": "Wan2.2 T2V A14B (万相2.2)", "type": "video",
     "author": "Wan-AI", "description": "万相 2.2 14B 文生视频（MoE 双专家架构），电影级镜头控制。",
     "ms_url": "https://modelscope.cn/models/Wan-AI/Wan2.2-T2V-A14B"},
    {"platform": "huggingface", "url": "https://huggingface.co/tencent/HunyuanVideo",
     "name": "HunyuanVideo (混元视频)", "type": "video",
     "author": "tencent", "description": "腾讯混元视频开源 13B 文生视频模型，ComfyUI 原生支持。"},
    {"platform": "huggingface", "url": "https://huggingface.co/Lightricks/LTX-Video",
     "name": "LTX-Video", "type": "video",
     "author": "Lightricks", "description": "LTX-Video 实时级视频生成模型（DiT，2B），速度优先。"},
    # ---- 加速 LoRA（新模型配套）----
    {"platform": "huggingface", "url": "https://huggingface.co/lightx2v/Qwen-Image-Lightning",
     "name": "Qwen-Image Lightning 8 步加速", "type": "lora",
     "author": "lightx2v", "description": "千问 Qwen-Image 蒸馏加速 LoRA（8 步 / CFG 1~2.5）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning",
     "name": "Qwen-Image-Edit 2511 Lightning 4 步", "type": "lora",
     "author": "lightx2v", "description": "千问图像编辑 2511 版 4 步加速 LoRA（bf16）。"},
    # ---- VAE 常用补齐 ----
    {"platform": "huggingface", "url": "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix",
     "name": "SDXL VAE fp16-fix", "type": "vae",
     "author": "madebyollin", "description": "SDXL VAE 的 fp16 数值修复版，SDXL 出 NaN 必备。"},
    {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/sd-vae-ft-mse",
     "name": "SD1.5 VAE ft-MSE", "type": "vae",
     "author": "stabilityai", "description": "SD1.5 官方精调 VAE（MSE 版），替代原版减少面部/眼睛模糊。"},
    {"platform": "huggingface", "url": "https://huggingface.co/madebyollin/taesd",
     "name": "TAESD (SD1.5 预览 VAE)", "type": "vae",
     "author": "madebyollin", "description": "极小快速编码/解码 VAE，ComfyUI 实时预览用。"},
    {"platform": "huggingface", "url": "https://huggingface.co/madebyollin/taesdxl",
     "name": "TAESDXL (SDXL 预览 VAE)", "type": "vae",
     "author": "madebyollin", "description": "SDXL 版轻量预览 VAE（taesd 家族）。"},
    # ---- IPAdapter / InsightFace 高置信补齐 ----
    {"platform": "huggingface", "url": "https://huggingface.co/h94/IP-Adapter",
     "name": "IP-Adapter 官方全家桶", "type": "ipadapter",
     "author": "h94", "description": "IP-Adapter 官方权重合集（SD1.5/SDXL/FaceID/Plus 全系列）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/InstantX/FLUX.1-dev-IP-Adapter",
     "name": "FLUX.1-dev IP-Adapter", "type": "ipadapter",
     "author": "InstantX", "description": "FLUX.1-dev 的 InstantX IP-Adapter 权重。"},
    {"platform": "huggingface", "url": "https://huggingface.co/XLabs-AI/flux-ip-adapter",
     "name": "FLUX IP-Adapter (XLabs)", "type": "ipadapter",
     "author": "XLabs-AI", "description": "XLabs 出品的 FLUX IP-Adapter v2 权重。"},
    {"platform": "huggingface", "url": "https://huggingface.co/ToTheBeginning/PuLID",
     "name": "PuLID (SDXL 人脸一致)", "type": "insightface",
     "author": "ToTheBeginning", "description": "PuLID SDXL 人脸一致性模型（依赖 insightface 编码）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/yanze/PuLID-FLUX",
     "name": "PuLID for FLUX", "type": "insightface",
     "author": "yanze", "description": "PuLID 的 FLUX 版本权重（人脸一致性注入）。"},
    # ---- 功能模型（other：分割/修复/抠图/深度/打标等）----
    {"platform": "huggingface", "url": "https://huggingface.co/facebook/sam2-hiera-large",
     "name": "SAM 2.1 Hiera Large (图像分割)", "type": "other",
     "author": "facebook", "description": "Meta SAM2 大模型，ComfyUI-SAM2 节点用，点选/自动分割。"},
    {"platform": "huggingface", "url": "https://huggingface.co/facebook/sam2-hiera-small",
     "name": "SAM 2.1 Hiera Small (图像分割)", "type": "other",
     "author": "facebook", "description": "SAM2 小模型，速度与精度均衡。"},
    {"platform": "huggingface", "url": "https://huggingface.co/facebook/sam2-hiera-tiny",
     "name": "SAM 2.1 Hiera Tiny (图像分割)", "type": "other",
     "author": "facebook", "description": "SAM2 极小模型，低显存分割。"},
    {"platform": "huggingface", "url": "https://huggingface.co/facebook/sam2-hiera-base-plus",
     "name": "SAM 2.1 Hiera Base+ (图像分割)", "type": "other",
     "author": "facebook", "description": "SAM2 Base+ 档位。"},
    {"platform": "huggingface", "url": "https://huggingface.co/sczhou/CodeFormer",
     "name": "CodeFormer (人脸修复)", "type": "other",
     "author": "sczhou", "description": "盲人脸修复模型（CodeFormer.pth），ComfyUI-CodeFormer 使用。"},
    {"platform": "huggingface", "url": "https://huggingface.co/TencentARC/GFPGAN",
     "name": "GFPGAN v1.4 (人脸修复)", "type": "other",
     "author": "TencentARC", "description": "腾讯 GFPGAN 人脸修复权重（GFPGANv1.4.pth）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/briaai/RMBG-1.4",
     "name": "RMBG-1.4 (背景移除)", "type": "other",
     "author": "briaai", "description": "高质量背景移除模型，ComfyUI-BiRefNet/RMBG 节点可用。"},
    {"platform": "huggingface", "url": "https://huggingface.co/LiheYoung/depth-anything-small-hf",
     "name": "Depth Anything Small (深度估计)", "type": "other",
     "author": "LiheYoung", "description": "深度估计模型，可用于 ControlNet 预处理。"},
    {"platform": "huggingface", "url": "https://huggingface.co/microsoft/Florence-2-large",
     "name": "Florence-2 Large (图像打标)", "type": "other",
     "author": "microsoft", "description": "图像理解/描述/检测多任务模型，ComfyUI-Florence2 打标用。"},
    {"platform": "huggingface", "url": "https://huggingface.co/guoyww/animatediff",
     "name": "AnimateDiff 官方 Motion Modules", "type": "other",
     "author": "guoyww", "description": "AnimateDiff 官方运动模块仓库（mm_sd_v15_v2 等），ComfyUI-AnimateDiff-Evolved 使用。"},
    {"platform": "huggingface", "url": "https://huggingface.co/openai/shap-e",
     "name": "Shap-E (3D 生成)", "type": "other",
     "author": "openai", "description": "OpenAI 文本/图生成 3D 资产模型，ComfyUI 原生节点支持。"},
    {"platform": "huggingface", "url": "https://huggingface.co/lllyasviel/Annotators",
     "name": "ControlNet 预处理器合集", "type": "other",
     "author": "lllyasviel", "description": "ControlNet 官方预处理器权重合集（线稿/深度/法线/姿态等）。"},
    {"platform": "huggingface", "url": "https://huggingface.co/openai/clip-vit-large-patch14",
     "name": "CLIP Vision Large (IP-Adapter 图像编码)", "type": "other",
     "author": "openai", "description": "CLIP-Vision-H 图像编码器，IP-Adapter / InstantID 工作流依赖。"},
]


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


def hf_repo_ok(mid):
    low = mid.lower()
    return not any(d in low for d in DENY_SUBSTR)


def cand(platform, url, name, ctype, author="", description="", size=None, **extra):
    d = {"platform": platform, "url": url, "name": name, "type": ctype,
         "author": author, "description": (description or "")[:160], "size": size}
    d.update(extra)
    return d


# ----------------------------- 平台 fetcher（按类型） -----------------------------
def fetch_hf(per_kw=100, pages=1):
    """HF 无总量接口：按关键词各取下载量 Top per_kw（API 单次上限 100）。"""
    out = []
    for ctype, keywords in HF_KEYWORDS_BY_TYPE.items():
        for kw in keywords:
            data = http_get("https://huggingface.co/api/models", {
                "search": kw, "sort": "downloads", "direction": "-1",
                "limit": per_kw, "full": "false",
            })
            if not isinstance(data, list):
                continue
            for it in data:
                mid = it.get("id") or ""
                if "/" not in mid or not hf_repo_ok(mid):
                    continue
                author = mid.split("/")[0]
                name = mid.split("/")[-1]
                out.append(cand(
                    "huggingface", "https://huggingface.co/" + mid, name, ctype,
                    author=it.get("author") or author,
                    description=(it.get("description") or "")))
            time.sleep(0.4)
    print(f"  [info] HF 候选共 {len(out)} 条（无总量接口，此为各关键词 Top 下载量去重前并集）")
    return out


def fetch_civitai(limit=100, pages=3):
    """按类型分别请求（types 单值可用），翻 pages 页；日志打印各类型库内总量。"""
    out = []
    totals = {}
    for ctype, civ_types in CIVITAI_FETCH.items():
        for page in range(1, pages + 1):
            data = http_get("https://civitai.com/api/v1/models", {
                "limit": limit, "sort": "Most Downloaded",
                "types": ",".join(civ_types), "nsfw": "false", "page": page,
            })
            if not isinstance(data, dict):
                break
            meta = data.get("metadata") or {}
            if page == 1 and meta.get("totalItems"):
                totals[ctype] = meta["totalItems"]
            items = data.get("items") or []
            for it in items:
                mapped = CIVITAI_TYPE_MAP.get(it.get("type") or "", ctype)
                mid = it.get("id")
                if not mid:
                    continue
                out.append(cand(
                    "civitai", "https://civitai.com/models/" + str(mid),
                    it.get("name") or str(mid), mapped,
                    author=(it.get("creator") or {}).get("username") or "",
                    description=re.sub(r"<[^>]+>", " ", it.get("description") or "")))
            if page >= (meta.get("totalPages") or 0):
                break
            time.sleep(0.4)
    if totals:
        print("  [info] Civitai 库内总量(按类型): " +
              "  ".join(f"{k}:{v}" for k, v in totals.items()))
    if not out:  # 全部类型请求失败 -> 回退热门页客户端过滤
        data = http_get("https://civitai.com/api/v1/models", {
            "limit": limit, "sort": "Most Downloaded"})
        for it in (data or {}).get("items") or []:
            mapped = CIVITAI_TYPE_MAP.get(it.get("type") or "")
            mid = it.get("id")
            if not mapped or not mid:
                continue
            out.append(cand(
                "civitai", "https://civitai.com/models/" + str(mid),
                it.get("name") or str(mid), mapped,
                author=(it.get("creator") or {}).get("username") or "",
                description=re.sub(r"<[^>]+>", " ", it.get("description") or "")))
    return out


def fetch_modelscope(page_size=50, pages=1):
    out = []
    for ctype, keywords in MS_KEYWORDS_BY_TYPE.items():
        for kw in keywords:
            for page in range(1, pages + 1):
                data = http_get("https://modelscope.cn/openapi/v1/models", {
                    "search": kw, "sort": "downloads",
                    "page_size": page_size, "page": page,
                })
                models = []
                if isinstance(data, dict):
                    d = data.get("data") or {}
                    models = d.get("models") or []
                    if page == 1 and d.get("total"):
                        print(f"  [info] ModelScope '{kw}' 库内总量: {d['total']}")
                for it in models:
                    mid = it.get("id") or it.get("model_id") or ""
                    if not mid or "/" not in mid:
                        continue
                    author = mid.split("/")[0]
                    name = mid.split("/")[-1]
                    out.append(cand(
                        "modelscope", "https://modelscope.cn/models/" + mid, name, ctype,
                        author=it.get("author") or author,
                        description=(it.get("summary") or it.get("description") or "")))
                if len(models) < page_size:
                    break
                time.sleep(0.4)
    return out


FETCHERS = {
    "hf": fetch_hf,
    "civitai": fetch_civitai,
    "modelscope": fetch_modelscope,
}


# ----------------------------- 转换为模块条目 -----------------------------
def build_module(cand_, existing_ids):
    platform = cand_["platform"]
    url = cand_["url"]
    slug = slugify(cand_.get("name") or url)
    base_id = f"auto-{platform}-{slug}"
    mid = base_id
    i = 1
    while mid in existing_ids:
        i += 1
        mid = f"{base_id}-{i}"

    sources = [{"platform": platform, "url": url}]
    if cand_.get("size"):
        sources[0]["size"] = cand_["size"]
    # HF 条目顺手补一个国内镜像源
    if platform == "huggingface":
        mirror = "https://hf-mirror.com/" + url.split("huggingface.co/", 1)[-1].strip("/")
        sources.append({"platform": "hf-mirror", "url": mirror})
    # 精选条目可显式补 ModelScope 源
    if cand_.get("ms_url"):
        sources.append({"platform": "modelscope", "url": cand_["ms_url"]})

    mtype = cand_.get("type") or "model"
    name = cand_.get("name") or slug
    return {
        "id": mid,
        "name": name,
        "repo": url,
        "category": "扩充收录",
        "author": cand_.get("author") or "",
        "official": False,
        "maintenance": "active",
        "description": (cand_.get("description") or "").strip(),
        "tags": ["auto", platform, mtype],
        "models": [{"name": name, "type": mtype, "sources": sources}],
    }, mid


def count_by_type(modules):
    """按平台源数统计各类型条目（与站点平台视图口径一致）。"""
    cnt = {t: 0 for t in ALL_TYPES}
    for m in modules:
        for mo in (m.get("models") or []):
            t = (mo.get("type") or "other").lower()
            cnt[t] = cnt.get(t, 0) + len(mo.get("sources") or [])
    return cnt


def run(platforms, max_n, data_path, dry_run, target, pages=1):
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

    counts = count_by_type(modules)
    gaps = {t: max(0, target - counts.get(t, 0)) for t in ALL_TYPES}
    print("[info] 各类型现有/目标(按平台源计):")
    for t in ALL_TYPES:
        print(f"  {t:15} {counts.get(t, 0):4} / {target}" + (f"  缺口 {gaps[t]}" if gaps[t] else ""))

    # 1) 精选列表优先（按类型分桶）
    pool = {t: [] for t in ALL_TYPES}
    for c in CURATED_RECENT:
        pool.setdefault(c["type"], []).append(c)

    # 2) 各平台抓取候选（失败降级）
    for p in platforms:
        fetcher = FETCHERS.get(p)
        if not fetcher:
            print(f"[skip] 未知平台: {p}", file=sys.stderr)
            continue
        print(f"[info] 抓取平台 {p} ...")
        try:
            fetched = fetcher(pages=pages)
        except Exception as e:
            print(f"  [warn] 平台 {p} 抓取异常：{e}", file=sys.stderr)
            fetched = []
        for c in fetched:
            pool.setdefault(c.get("type") or "other", []).append(c)

    # 3) 按缺口从大到小填充；同类型内平台轮询，去重后入库
    order = sorted([t for t in ALL_TYPES if gaps[t] > 0], key=lambda t: -gaps[t])
    new_modules = []
    seen = set()
    total_gap = sum(gaps.values())
    print(f"[info] 总缺口 {total_gap}，本次上限 {max_n}")

    for t in order:
        if gaps[t] <= 0 or len(new_modules) >= max_n:
            break
        idx = 0
        progressed = True
        while gaps[t] > 0 and len(new_modules) < max_n and progressed:
            progressed = False
            for p in platforms:
                if gaps[t] <= 0 or len(new_modules) >= max_n:
                    break
                # 从该类型的池子里找下一个属于平台 p 的候选
                while idx < len(pool[t]):
                    c = pool[t][idx]
                    idx += 1
                    progressed = True
                    nu = norm_url(c["url"])
                    if not nu or nu in existing_urls or nu in seen:
                        continue
                    seen.add(nu)
                    mod, mid = build_module(c, existing_ids)
                    existing_ids.add(mid)
                    new_modules.append(mod)
                    gaps[t] -= len(mod["models"][0]["sources"])
                    break
        print(f"  [fill] {t}: 剩余缺口 {max(0, gaps[t])}")

    if not new_modules:
        print("[done] 各类型均已达标或无可用新数据，未新增。")
        return 0

    if dry_run:
        print(f"[dry-run] 将新增 {len(new_modules)} 条（不写文件）：")
        for m in new_modules:
            plats = sorted({s["platform"] for mo in m["models"] for s in mo["sources"]})
            print(f"  - [{m['models'][0]['type']}] {m['name']}  ({','.join(plats)})  {m['repo']}")
        return 0

    modules.extend(new_modules)
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    after = count_by_type(modules)
    print(f"[done] 已追加 {len(new_modules)} 条到 {data_path}。")
    print("[info] 追加后各类型（按平台源计）:")
    for t in ALL_TYPES:
        print(f"  {t:15} {after.get(t, 0)}")
    return 0


# ----------------------------- 自测 -----------------------------
def self_test():
    print("[self-test] 开始校验配额/去重/合并/schema ...")
    # 构造：lora 已有 48 个平台源（应只差 2），vae 已有 0（缺口 50）
    lora_urls = [f"https://huggingface.co/seed/lora-{i}" for i in range(48)]
    data = {"meta": {"note": "test"}, "modules": [
        {"id": "seed-lora", "name": "seed", "repo": "https://huggingface.co/seed",
         "category": "LoRA 精选", "author": "x", "official": False,
         "maintenance": "active", "description": "d", "tags": [],
         "models": [{"name": "seed", "type": "lora",
                     "sources": [{"platform": "huggingface", "url": u} for u in lora_urls]}]},
    ]}
    modules = data["modules"]
    existing_urls = set()
    existing_ids = set()
    for m in modules:
        existing_ids.add(m["id"])
        for mo in m["models"]:
            for s in mo["sources"]:
                existing_urls.add(norm_url(s["url"]))

    counts = count_by_type(modules)
    assert counts["lora"] == 48, f"lora 计数错误 {counts['lora']}"
    gaps = {t: max(0, 50 - counts.get(t, 0)) for t in ALL_TYPES}
    assert gaps["lora"] == 2 and gaps["vae"] == 50, f"缺口计算错误 {gaps}"

    # 模拟填充：lora 候选 3 条（每条 HF=2 源）+ 去重命中 1 条
    cands_lora = [
        {"platform": "huggingface", "url": "https://huggingface.co/new/lora-a", "name": "A",
         "type": "lora", "author": "a", "description": "", "size": None},
        {"platform": "huggingface", "url": "https://huggingface.co/new/lora-b", "name": "B",
         "type": "lora", "author": "b", "description": "", "size": None},
        {"platform": "huggingface", "url": lora_urls[0], "name": "dup",
         "type": "lora", "author": "s", "description": "", "size": None},
    ]
    added = 0
    seen = set()
    for c in cands_lora:
        if gaps["lora"] <= 0:
            break
        nu = norm_url(c["url"])
        if nu in existing_urls or nu in seen:
            continue
        seen.add(nu)
        mod, mid = build_module(c, existing_ids)
        existing_ids.add(mid)
        modules.append(mod)
        gaps["lora"] -= len(mod["models"][0]["sources"])
        added += 1
    assert added == 1 and gaps["lora"] == 0, f"配额填充错误 added={added} gap={gaps['lora']}"

    # curated 精选条目：HF 自动补镜像 + ms_url 补魔搭
    c = next(x for x in CURATED_RECENT if x["name"].startswith("Qwen-Image ("))
    mod, mid = build_module(c, {"auto-huggingface-x"})
    plats = {s["platform"] for s in mod["models"][0]["sources"]}
    assert {"huggingface", "hf-mirror", "modelscope"} <= plats, f"精选多源缺失 {plats}"
    assert mod["models"][0]["type"] == "diffusion_model"
    assert mod["models"][0]["sources"][0].get("size") is None

    # H3 条目 size 透传
    c3 = next(x for x in CURATED_RECENT if "MiniMax H3 ComfyUI" in x["name"])
    mod3, _ = build_module(c3, set())
    assert mod3["models"][0]["sources"][0]["size"] == "约 42.5 GB（量化单文件）"

    # schema 完整 + 可序列化
    req = {"id", "name", "repo", "category", "author", "official",
           "maintenance", "description", "tags", "models"}
    for m in modules:
        assert req <= set(m), f"模块字段缺失：{set(m)}"
        for mo in m["models"]:
            assert {"name", "type", "sources"} <= set(mo)
            for s in mo["sources"]:
                assert {"platform", "url"} <= set(s)
    json.dumps(modules, ensure_ascii=False)
    print("[self-test] ✅ 通过：类型计数、配额填充、去重、精选多源、size 透传、schema 均正确。")
    return 0


def main():
    ap = argparse.ArgumentParser(description="ComfyUI Atlas 模块模型自动扩充（按类型配额）")
    ap.add_argument("--data", default=DATA_PATH, help="data/modules.json 路径")
    ap.add_argument("--max", type=int, default=DEFAULT_MAX, help="本次新增条目上限")
    ap.add_argument("--target-per-type", type=int, default=DEFAULT_TARGET,
                    help="每个类型的目标条目数（按平台源计）")
    ap.add_argument("--platforms", default=DEFAULT_PLATFORMS, help="逗号分隔：hf,civitai,modelscope")
    ap.add_argument("--pages", type=int, default=1,
                    help="Civitai/ModelScope 每类型翻页数（全量抓取时调大）")
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
    return run(platforms, args.max, args.data, args.dry_run, args.target_per_type, args.pages)


if __name__ == "__main__":
    sys.exit(main())
