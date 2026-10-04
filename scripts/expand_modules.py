#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性脚本：向 data/modules.json 批量追加高频 ComfyUI 节点与模型。"""
import json
from pathlib import Path

P = Path("data/modules.json")
data = json.loads(P.read_text(encoding="utf-8"))
existing = {m["id"] for m in data["modules"]}

NEW = [
    # ---------------- 基础模型 ----------------
    {
        "id": "sd21", "name": "SD 2.1 (核心)", "repo": "https://github.com/comfyanonymous/ComfyUI",
        "category": "基础模型", "author": "Stability AI / ComfyUI", "official": True, "maintenance": "active",
        "description": "Stable Diffusion 2.1 基础模型，带深度/升级采样等原生能力。",
        "tags": ["sd21", "checkpoint", "基础模型"],
        "models": [{"name": "stable-diffusion-2-1", "type": "checkpoint", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/stable-diffusion-2-1/tree/main", "size": "5.2 GB"},
            {"platform": "hf-mirror", "url": "https://hf-mirror.com/stabilityai/stable-diffusion-2-1/tree/main", "size": "5.2 GB"}]}],
    },
    {
        "id": "sdxl-turbo", "name": "SDXL Turbo (极速)", "repo": "https://github.com/comfyanonymous/ComfyUI",
        "category": "基础模型", "author": "Stability AI / ComfyUI", "official": True, "maintenance": "active",
        "description": "单步出图的 Turbo 模型，适合实时预览/草图，画质低于常规 SDXL。",
        "tags": ["sdxl", "turbo", "极速", "基础模型"],
        "models": [{"name": "sdxl-turbo", "type": "checkpoint", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/sdxl-turbo/tree/main", "size": "6.9 GB"},
            {"platform": "hf-mirror", "url": "https://hf-mirror.com/stabilityai/sdxl-turbo/tree/main", "size": "6.9 GB"}]}],
    },
    {
        "id": "sd-turbo", "name": "SD Turbo (极速)", "repo": "https://github.com/comfyanonymous/ComfyUI",
        "category": "基础模型", "author": "Stability AI / ComfyUI", "official": True, "maintenance": "active",
        "description": "SD1.5 的 Turbo 单步版本，极快草图生成。",
        "tags": ["sd15", "turbo", "极速", "基础模型"],
        "models": [{"name": "sd-turbo", "type": "checkpoint", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/sd-turbo/tree/main", "size": "4.3 GB"},
            {"platform": "hf-mirror", "url": "https://hf-mirror.com/stabilityai/sd-turbo/tree/main", "size": "4.3 GB"}]}],
    },
    {
        "id": "playground-v25", "name": "Playground v2.5", "repo": "https://huggingface.co/playgroundai/playground-v2.5-1024px-aesthetic",
        "category": "基础模型", "author": "Playground AI", "official": False, "maintenance": "active",
        "description": "美学取向强的 SDXL 微调底模，色彩与构图讨喜。",
        "tags": ["playground", "sdxl", "美学", "基础模型"],
        "models": [{"name": "playground-v2.5-1024px-aesthetic", "type": "checkpoint", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/playgroundai/playground-v2.5-1024px-aesthetic/tree/main", "size": "6.9 GB"}]}],
    },
    {
        "id": "qwen-image", "name": "Qwen-Image", "repo": "https://huggingface.co/Qwen/Qwen-Image",
        "category": "基础模型", "author": "阿里 Qwen", "official": True, "maintenance": "active",
        "description": "通义千问图像生成大模型（中英双语、复杂语义强），需较大显存或量化。",
        "tags": ["qwen", "中文", "基础模型", "大模型"],
        "models": [{"name": "Qwen-Image", "type": "checkpoint", "sources": [
            {"platform": "modelscope", "url": "https://modelscope.cn/models/Qwen/Qwen-Image", "size": "约 25 GB（可量化）", "note": "国内直连"},
            {"platform": "huggingface", "url": "https://huggingface.co/Qwen/Qwen-Image/tree/main", "size": "约 25 GB"}]}],
    },
    {
        "id": "janus-pro", "name": "Janus-Pro (多模态)", "repo": "https://huggingface.co/deepseek-ai/Janus-Pro",
        "category": "基础模型", "author": "DeepSeek", "official": False, "maintenance": "active",
        "description": "DeepSeek 统一多模态模型，支持文生图与图像理解，可用于打标/反推。",
        "tags": ["janus", "deepseek", "多模态", "vlm"],
        "models": [{"name": "Janus-Pro-7B", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/deepseek-ai/Janus-Pro/tree/main", "size": "15 GB"},
            {"platform": "modelscope", "url": "https://modelscope.cn/models/deepseek-ai/Janus-Pro", "size": "15 GB", "note": "国内直连"}]}],
    },

    # ---------------- 通用底模（Civitai 等社区） ----------------
    {
        "id": "dreamshaper-xl", "name": "DreamShaper XL", "repo": "https://civitai.com/models/112902",
        "category": "通用底模", "author": "Lykon", "official": False, "maintenance": "active",
        "description": "全能型 SDXL 底模，写实/二次元/概念图都好用，社区装机量极高。",
        "tags": ["通用", "sdxl", "checkpoint", "dreamshaper"],
        "models": [{"name": "DreamShaper XL", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/112902", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "juggernaut-xl", "name": "Juggernaut XL", "repo": "https://civitai.com/models/133005",
        "category": "通用底模", "author": "RunDiffusion", "official": False, "maintenance": "active",
        "description": "高质感写实 SDXL 底模，光影与细节出色。",
        "tags": ["通用", "sdxl", "写实", "checkpoint"],
        "models": [{"name": "Juggernaut XL v9", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/133005", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "realistic-vision", "name": "Realistic Vision V6.0 B1", "repo": "https://civitai.com/models/4201",
        "category": "通用底模", "author": "SG_161222", "official": False, "maintenance": "active",
        "description": "经典写实 SD1.5 底模，照片级人像/风景首选。",
        "tags": ["写实", "sd15", "checkpoint"],
        "models": [{"name": "Realistic_Vision_V6.0_B1", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/4201", "size": "4 GB", "note": "C 站"}]}],
    },
    {
        "id": "proteus", "name": "Proteus v0.4", "repo": "https://civitai.com/models/122357",
        "category": "通用底模", "author": "DreamTuner", "official": False, "maintenance": "active",
        "description": "偏写实且易出的 SDXL 底模，常被用作默认底模。",
        "tags": ["通用", "sdxl", "checkpoint"],
        "models": [{"name": "Proteus v0.4", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/122357", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "counterfeit-xl", "name": "Counterfeit XL", "repo": "https://civitai.com/models/118985",
        "category": "通用底模", "author": "counterfeit", "official": False, "maintenance": "active",
        "description": "介于写实与二次元之间的 SDXL 底模，风格柔和。",
        "tags": ["通用", "sdxl", "checkpoint"],
        "models": [{"name": "Counterfeit XL", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/118985", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "revanimated", "name": "RevAnimated", "repo": "https://civitai.com/models/7371",
        "category": "通用底模", "author": "revanimated", "official": False, "maintenance": "active",
        "description": "半写实半动漫的 SD1.5 底模，兼容大量 LoRA。",
        "tags": ["通用", "sd15", "checkpoint"],
        "models": [{"name": "revAnimated", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/7371", "size": "4 GB", "note": "C 站"}]}],
    },
    {
        "id": "toonyou", "name": "ToonYou", "repo": "https://civitai.com/models/30240",
        "category": "通用底模", "author": "nguyenbainga", "official": False, "maintenance": "active",
        "description": "迪士尼/动画风格 SD1.5 底模，做卡通人物很方便。",
        "tags": ["卡通", "sd15", "checkpoint"],
        "models": [{"name": "ToonYou", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/30240", "size": "4 GB", "note": "C 站"}]}],
    },
    {
        "id": "epicrealism", "name": "EpicRealism (合集搜索)", "repo": "https://civitai.com/models?query=EpicRealism",
        "category": "通用底模", "author": "epicrealism", "official": False, "maintenance": "active",
        "description": "写实系热门底模系列（EpicRealism Pure / Natural 等），按需挑选。",
        "tags": ["写实", "checkpoint", "合集"],
        "models": [{"name": "EpicRealism 系列", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models?query=EpicRealism", "note": "C 站搜索"}]}],
    },

    # ---------------- 二次元/动漫 ----------------
    {
        "id": "bluepencil-xl", "name": "BluePencil XL", "repo": "https://civitai.com/models/143597",
        "category": "二次元/动漫", "author": "bluepencil", "official": False, "maintenance": "active",
        "description": "日系二次元 SDXL 底模，线条干净、上色讨喜。",
        "tags": ["二次元", "动漫", "sdxl", "checkpoint"],
        "models": [{"name": "BluePencil XL", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/143597", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "cetus-mix", "name": "Cetus-Mix", "repo": "https://civitai.com/models/72887",
        "category": "二次元/动漫", "author": "cetus", "official": False, "maintenance": "active",
        "description": "强二次元 SDXL 底模，画风鲜艳、细节丰富。",
        "tags": ["二次元", "动漫", "sdxl", "checkpoint"],
        "models": [{"name": "Cetus-Mix", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/72887", "size": "6.6 GB", "note": "C 站"}]}],
    },
    {
        "id": "counterfeit-v3", "name": "Counterfeit V3.0", "repo": "https://civitai.com/models/35520",
        "category": "二次元/动漫", "author": "counterfeit", "official": False, "maintenance": "active",
        "description": "经典二次元 SD1.5 底模，老牌动漫党最爱之一。",
        "tags": ["二次元", "动漫", "sd15", "checkpoint"],
        "models": [{"name": "Counterfeit-V3.0", "type": "checkpoint", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models/35520", "size": "4 GB", "note": "C 站"}]}],
    },

    # ---------------- LoRA 精选（极速出图/质感） ----------------
    {
        "id": "sdxl-lightning", "name": "SDXL Lightning (极速出图)", "repo": "https://huggingface.co/ByteDance/SDXL-Lightning",
        "category": "LoRA 精选", "author": "ByteDance", "official": False, "maintenance": "active",
        "description": "4/8 步即可出图的蒸馏 LoRA，配合基础底模大幅提速。",
        "tags": ["lora", "极速", "lightning", "sdxl"],
        "models": [{"name": "sdxl_lightning_4step / 8step", "type": "lora", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/ByteDance/SDXL-Lightning/tree/main", "size": "0.4 GB", "note": "按步数选 lora"}]}],
    },
    {
        "id": "hyper-sd", "name": "Hyper-SD (极速出图)", "repo": "https://huggingface.co/TencentARC/Hyper-SD",
        "category": "LoRA 精选", "author": "TencentARC", "official": False, "maintenance": "active",
        "description": "1~8 步极致加速 LoRA，支持 SD1.5/SDXL，兼顾画质与速度。",
        "tags": ["lora", "极速", "hyper", "sdxl", "sd15"],
        "models": [{"name": "Hyper-SD 1step~8step", "type": "lora", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/TencentARC/Hyper-SD/tree/main", "size": "0.4 GB"}]}],
    },
    {
        "id": "lcm-lora", "name": "LCM LoRA (潜在一致性)", "repo": "https://huggingface.co/latent-consistency/lcm-lora-sdxl",
        "category": "LoRA 精选", "author": "Latent Consistency", "official": False, "maintenance": "active",
        "description": "潜在一致性蒸馏 LoRA，4 步内出图，可与多数底模叠加。",
        "tags": ["lora", "极速", "lcm", "sdxl", "sd15"],
        "models": [{"name": "lcm-lora-sdxl / lcm-lora-sdv1-5", "type": "lora", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/latent-consistency/lcm-lora-sdxl/tree/main", "size": "0.4 GB", "note": "SD1.5 版在同组织下"},
            {"platform": "hf-mirror", "url": "https://hf-mirror.com/latent-consistency/lcm-lora-sdxl/tree/main", "size": "0.4 GB"}]}],
    },
    {
        "id": "film-grain-lora", "name": "FilmGrain LoRA (电影质感)", "repo": "https://civitai.com/models?query=film%20grain%20lora",
        "category": "LoRA 精选", "author": "社区", "official": False, "maintenance": "active",
        "description": "为图像添加胶片颗粒/电影感的常用 LoRA，提升质感。",
        "tags": ["lora", "胶片", "电影感", "质感"],
        "models": [{"name": "各类 FilmGrain LoRA", "type": "lora", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models?query=film%20grain%20lora", "note": "C 站搜索"},
            {"platform": "liblibai", "url": "https://www.liblib.art/search?searchText=film%20grain%20lora", "note": "哩布搜索"}]}],
    },

    # ---------------- 控制网络 ----------------
    {
        "id": "controlnet-union", "name": "ControlNet Union (SDXL 全能)", "repo": "https://huggingface.co/xinsir/controlnet-union-sdxl-1.0",
        "category": "控制网络", "author": "xinsir", "official": False, "maintenance": "active",
        "description": "单一模型支持多种控制条件（canny/depth/pose 等）的 SDXL 全能 ControlNet。",
        "tags": ["controlnet", "全能", "sdxl", "union"],
        "models": [{"name": "controlnet-union-sdxl-1.0", "type": "controlnet", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/tree/main", "size": "6.9 GB"}]}],
    },
    {
        "id": "mistoline", "name": "MistoLine (线稿控制)", "repo": "https://huggingface.co/TheMistoAI/MistoLine",
        "category": "控制网络", "author": "TheMistoAI", "official": False, "maintenance": "active",
        "description": "专精线稿/草图控制的 ControlNet 模型，配合 ControlNet Aux 的 Lineart 预处理使用。",
        "tags": ["controlnet", "线稿", "lineart", "草图"],
        "models": [{"name": "mistoline_sd15 / mistoline_sdxl", "type": "controlnet", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/TheMistoAI/MistoLine/tree/main", "size": "约 3 GB"}]}],
    },

    # ---------------- 风格控制 ----------------
    {
        "id": "ip-adapter-faceid", "name": "IP-Adapter FaceID", "repo": "https://huggingface.co/h94/IP-Adapter-FaceID",
        "category": "风格控制", "author": "h94", "official": False, "maintenance": "active",
        "description": "基于人脸特征的高保真身份控制，比普通 IP-Adapter 更锁脸，需 insightface。",
        "tags": ["ip-adapter", "faceid", "人脸", "身份"],
        "models": [
            {"name": "ip-adapter-faceid-plusv2_sdxl", "type": "ipadapter", "sources": [
                {"platform": "huggingface", "url": "https://huggingface.co/h94/IP-Adapter-FaceID/tree/main/models", "size": "1.2 GB", "note": "SDXL 版"},
                {"platform": "huggingface", "url": "https://huggingface.co/h94/IP-Adapter-FaceID/tree/main/sdxl_models", "size": "1.0 GB"}]},
            {"name": "insightface buffalo_l", "type": "insightface", "sources": [
                {"platform": "huggingface", "url": "https://huggingface.co/MonsterMMORPG/tools/tree/main", "size": "0.3 GB"}]}],
    },

    # ---------------- 视频 ----------------
    {
        "id": "svd", "name": "Stable Video Diffusion (图生视频)", "repo": "https://github.com/comfyanonymous/ComfyUI",
        "category": "视频", "author": "Stability AI / ComfyUI", "official": True, "maintenance": "active",
        "description": "由单张图生成短视频（SVD / SVD-XT），由 ComfyUI 核心 Video 节点加载。",
        "tags": ["svd", "图生视频", "视频", "i2v"],
        "models": [{"name": "stable-video-diffusion-img2vid-xt", "type": "checkpoint", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/stabilityai/stable-video-diffusion/tree/main", "size": "14 GB"}]}],
    },
    {
        "id": "framepack", "name": "ComfyUI-FramePack (图生视频)", "repo": "https://github.com/cumulo-autumnus/FramePack-ComfyUI",
        "category": "视频", "author": "cumulo-autumnus / lllyasviel", "official": False, "maintenance": "active",
        "description": "下一代图生视频方案，显存占用低、可生成长视频，效果接近商用。",
        "tags": ["framepack", "图生视频", "视频", "i2v"],
        "models": [{"name": "FramePack 权重", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/lllyasviel/framepack/tree/main", "size": "约 12 GB"}]}],
    },
    {
        "id": "vace", "name": "ComfyUI-VACE (视频创作)", "repo": "https://github.com/ali-vilab/VACE",
        "category": "视频", "author": "阿里 VACE", "official": False, "maintenance": "active",
        "description": "统一的视频创作/编辑模型（生成、涂抹重绘、参考、帧扩展等），国产、魔搭直连。",
        "tags": ["vace", "视频", "视频编辑", "视频生成"],
        "models": [{"name": "VACE 14B / 1.3B", "type": "checkpoint", "sources": [
            {"platform": "modelscope", "url": "https://modelscope.cn/models/VAST-AI/VACE", "size": "14 GB / 1.3 GB", "note": "国内直连"},
            {"platform": "huggingface", "url": "https://huggingface.co/VAST-AI/VACE/tree/main", "size": "14 GB"}]}],
    },

    # ---------------- 人脸 ----------------
    {
        "id": "ecomid", "name": "ComfyUI-EcomID (易用 ID)", "repo": "https://github.com/sky24h/ComfyUI-EcomID",
        "category": "人脸", "author": "sky24h", "official": False, "maintenance": "active",
        "description": "比 InstantID 更易用的高保真人脸 ID 方案，单人/多人一致，需 insightface。",
        "tags": ["ecomid", "人脸", "身份", "id"],
        "models": [
            {"name": "EcomID", "type": "ipadapter", "sources": [
                {"platform": "huggingface", "url": "https://huggingface.co/Human-Machine-Symbiosis-Lab/EcomID/tree/main", "size": "1.3 GB"}]},
            {"name": "insightface buffalo_l", "type": "insightface", "sources": [
                {"platform": "huggingface", "url": "https://huggingface.co/MonsterMMORPG/tools/tree/main", "size": "0.3 GB"}]}],
    },
    {
        "id": "advanced-liveportrait", "name": "ComfyUI-AdvancedLivePortrait", "repo": "https://github.com/kwaroran/ComfyUI-AdvancedLivePortrait",
        "category": "人脸", "author": "kwaroran", "official": False, "maintenance": "active",
        "description": "在 LivePortrait 基础上增强的人脸驱动节点，支持更细的表情/头部控制。",
        "tags": ["liveportrait", "人脸驱动", "表情", "视频"],
        "models": [{"name": "LivePortrait 权重", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/KwaiVGI/LivePortrait/tree/main", "size": "1.4 GB"}]}],
    },

    # ---------------- 放大修复 ----------------
    {
        "id": "apisr", "name": "APISR (二次元放大)", "repo": "https://huggingface.co/Chu-tianli/APISR",
        "category": "放大修复", "author": "Chu-tianli", "official": False, "maintenance": "active",
        "description": "专为动漫/二次元图设计的高质量 ESRGAN 放大模型，线条与纹理更干净。",
        "tags": ["anime", "放大", "upscale", "esrgan", "二次元"],
        "models": [{"name": "APISR 4x / 2x", "type": "upscale", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/Chu-tianli/APISR/tree/main", "size": "0.07 GB"}]}],
    },
    {
        "id": "realesrgan-x4", "name": "RealESRGAN x4plus (通用放大)", "repo": "https://huggingface.co/xinntao/Real-ESRGAN",
        "category": "放大修复", "author": "xinntao", "official": False, "maintenance": "active",
        "description": "经典通用 ESRGAN 放大模型，照片/插画均可用，配合 UltimateSDUpscale 分块放大。",
        "tags": ["放大", "upscale", "通用", "esrgan"],
        "models": [{"name": "RealESRGAN_x4plus.pth", "type": "upscale", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/xinntao/Real-ESRGAN/tree/main", "size": "0.07 GB"}]}],
    },
    {
        "id": "ddcolor", "name": "DDColor (黑白上色)", "repo": "https://huggingface.co/InterDigital/ddcolor",
        "category": "放大修复", "author": "InterDigital", "official": False, "maintenance": "active",
        "description": "基于双解码器的黑白照片自动上色模型，人像/自然场景效果好。",
        "tags": ["上色", "黑白", "修复", "colorization"],
        "models": [{"name": "ddcolor 人像/视频/美术模型", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/InterDigital/ddcolor/tree/main", "size": "0.2 GB"}]}],
    },
    {
        "id": "4x-nmkd-siax", "name": "4x_NMKD-Siax (通用放大)", "repo": "https://civitai.com/models?query=NMKD%20Siax",
        "category": "放大修复", "author": "NMKD", "official": False, "maintenance": "active",
        "description": "通用 ESRGAN 放大模型，锐化与细节兼顾，常用于照片放大。",
        "tags": ["放大", "upscale", "通用"],
        "models": [{"name": "4x_NMKD-Siax_200k", "type": "upscale", "sources": [
            {"platform": "civitai", "url": "https://civitai.com/models?query=NMKD%20Siax", "note": "C 站搜索"},
            {"platform": "liblibai", "url": "https://www.liblib.art/search?searchText=NMKD%20Siax", "note": "哩布搜索"}]}],
    },

    # ---------------- 其他（感知/理解/打标） ----------------
    {
        "id": "grounding-dino", "name": "GroundingDINO (检测/框选)", "repo": "https://github.com/IDEA-Research/GroundingDINO",
        "category": "其他", "author": "IDEA-Research", "official": False, "maintenance": "active",
        "description": "开放词汇目标检测，可用文字描述定位图中物体，常与 SAM 组合做精准分割。",
        "tags": ["grounding", "检测", "sam", "感知"],
        "models": [{"name": "grounding-dino-base / swin-t", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/IDEA-Research/grounding-dino-base/tree/main", "size": "0.7 GB"}]}],
    },
    {
        "id": "clip-interrogator", "name": "CLIP Interrogator (反推提示词)", "repo": "https://huggingface.co/pharmapsychotic/clip-interrogator",
        "category": "其他", "author": "pharmapsychotic", "official": False, "maintenance": "active",
        "description": "上传图反向推测出可用提示词，辅助复刻风格/构图。",
        "tags": ["interrogator", "反推", "提示词", "打标"],
        "models": [{"name": "CLIP-Interrogator 模型", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/pharmapsychotic/clip-interrogator/tree/main", "size": "3 GB", "note": "含 BLIP/CLIP 权重"}]}],
    },
    {
        "id": "joycaption", "name": "JoyCaption (图像描述)", "repo": "https://huggingface.co/John6666/Joy-Caption-Alpha-Two",
        "category": "其他", "author": "John6666", "official": False, "maintenance": "active",
        "description": "高质量图像描述/打标模型，配合 caption 节点批量生成训练用 caption。",
        "tags": ["joycaption", "打标", "caption", "描述"],
        "models": [{"name": "Joy-Caption-Alpha-Two", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/John6666/Joy-Caption-Alpha-Two/tree/main", "size": "12 GB"}]}],
    },
    {
        "id": "moondream", "name": "Moondream (轻量 VLM)", "repo": "https://huggingface.co/vikhyat/moondream",
        "category": "其他", "author": "vikhyat", "official": False, "maintenance": "active",
        "description": "极小体积的多模态视觉语言模型，可做图像问答/描述，本地极快。",
        "tags": ["moondream", "vlm", "问答", "描述"],
        "models": [{"name": "moondream2", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/vikhyat/moondream2/tree/main", "size": "2.2 GB"}]}],
    },
    {
        "id": "qwen2-vl", "name": "Qwen2-VL (视觉理解)", "repo": "https://huggingface.co/Qwen/Qwen2-VL",
        "category": "其他", "author": "阿里 Qwen", "official": False, "maintenance": "active",
        "description": "通义千问视觉语言模型，支持图像/视频理解、OCR、打标与问答。",
        "tags": ["qwen", "vlm", "视觉理解", "ocr"],
        "models": [{"name": "Qwen2-VL-7B-Instruct", "type": "other", "sources": [
            {"platform": "huggingface", "url": "https://huggingface.co/Qwen/Qwen2-VL-7B-Instruct/tree/main", "size": "15 GB"},
            {"platform": "modelscope", "url": "https://modelscope.cn/models/Qwen/Qwen2-VL-7B-Instruct", "size": "15 GB", "note": "国内直连"}]}],
    },

    # ---------------- 工作流增强 ----------------
    {
        "id": "comfyui-gguf", "name": "ComfyUI-GGUF", "repo": "https://github.com/city96/ComfyUI-GGUF",
        "category": "工作流增强", "author": "city96", "official": False, "maintenance": "active",
        "description": "在 ComfyUI 中加载 GGUF 量化模型（FLUX/大模型/LLM），大幅降低显存占用。纯逻辑节点。",
        "tags": ["gguf", "量化", "flux", "工具"],
        "models": [],
    },
    {
        "id": "comfyui-dynamic-prompts", "name": "ComfyUI_DynamicPrompts", "repo": "https://github.com/wcoyets/ComfyUI_DynamicPrompts",
        "category": "工作流增强", "author": "wcoyets", "official": False, "maintenance": "active",
        "description": "动态提示词节点：支持通配符、魔法提示、组合变异，批量出图变化更丰富。",
        "tags": ["prompt", "动态", "通配符", "工具"],
        "models": [],
    },
    {
        "id": "comfyui-image-saver", "name": "ComfyUI-Image-Saver", "repo": "https://github.com/spacepxl/ComfyUI-Image-Saver",
        "category": "工作流增强", "author": "spacepxl", "official": False, "maintenance": "active",
        "description": "高级图像保存：自定义命名/目录、嵌入工作流元数据、批量与多格式输出。",
        "tags": ["保存", "导出", "元数据", "工具"],
        "models": [],
    },
    {
        "id": "comfyui-qol", "name": "ComfyUI-QualityOfLifeSuit_Omar92", "repo": "https://github.com/Omar92/ComfyUI-QualityOfLifeSuit_Omar92",
        "category": "工作流增强", "author": "Omar92", "official": False, "maintenance": "active",
        "description": "易用性增强套件：节点组预览、批量队列、快捷操作等，提升日常体验。",
        "tags": ["qol", "易用性", "工具", "增强"],
        "models": [],
    },
]

# 校验 id 不重复
dups = [m["id"] for m in NEW if m["id"] in existing]
if dups:
    raise SystemExit("发现重复 id: " + ", ".join(dups))

data["modules"].extend(NEW)
P.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"追加完成：新增 {len(NEW)} 个模块，当前总计 {len(data['modules'])} 个。")
