#!/usr/bin/env python3
"""部署前校验 data/modules.json 的结构与必填字段。

用法: python3 scripts/validate.py data/modules.json
退出码: 0 = 通过, 1 = 校验失败
"""
import json
import sys
from pathlib import Path

REQUIRED_MODULE_FIELDS = {"id", "name", "repo", "category", "models"}
REQUIRED_MODEL_FIELDS = {"name", "type", "sources"}
REQUIRED_SOURCE_FIELDS = {"platform", "url"}

VALID_PLATFORMS = {
    "huggingface", "modelscope", "civitai", "hf-mirror",
    "liblibai", "tensorart", "seaart", "replicate",
    "github-release", "kaggle", "other",
}
VALID_CATEGORIES = {
    "基础模型", "控制网络", "风格控制", "动画", "人脸",
    "放大修复", "工作流增强", "视频", "其他", "通用底模",
    "二次元/动漫", "电商/试衣", "LoRA 精选",
    "扩充收录",  # scrape_models.py 自动抓取条目所用分类
}


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    modules = data.get("modules")
    if not isinstance(modules, list):
        return ["顶层字段 'modules' 必须是数组"]

    seen_ids = set()
    for i, m in enumerate(modules):
        loc = f"modules[{i}]"
        if not isinstance(m, dict):
            errors.append(f"{loc}: 必须是对象")
            continue

        missing = REQUIRED_MODULE_FIELDS - m.keys()
        if missing:
            errors.append(f"{loc} ({m.get('id', '?')}): 缺少必填字段 {sorted(missing)}")

        mid = m.get("id")
        if mid:
            if mid in seen_ids:
                errors.append(f"{loc}: id 重复 '{mid}'")
            seen_ids.add(mid)

        if m.get("category") and m["category"] not in VALID_CATEGORIES:
            errors.append(f"{loc}: 未知分类 '{m['category']}' (应属 {sorted(VALID_CATEGORIES)})")

        models = m.get("models")
        if not isinstance(models, list):
            errors.append(f"{loc}: 'models' 必须是数组")
            continue

        for j, mo in enumerate(models):
            mloc = f"{loc}.models[{j}]"
            if not isinstance(mo, dict):
                errors.append(f"{mloc}: 必须是对象")
                continue
            mmissing = REQUIRED_MODEL_FIELDS - mo.keys()
            if mmissing:
                errors.append(f"{mloc}: 缺少必填字段 {sorted(mmissing)}")
            if mo.get("type") == "other":
                pass  # 允许 other
            sources = mo.get("sources")
            if not isinstance(sources, list) or not sources:
                errors.append(f"{mloc}: 'sources' 至少需 1 条")
                continue
            for k, s in enumerate(sources):
                sloc = f"{mloc}.sources[{k}]"
                smissing = REQUIRED_SOURCE_FIELDS - s.keys()
                if smissing:
                    errors.append(f"{sloc}: 缺少必填字段 {sorted(smissing)}")
                if s.get("platform") and s["platform"] not in VALID_PLATFORMS:
                    errors.append(f"{sloc}: 未知平台 '{s['platform']}'")
                if s.get("url") and not str(s["url"]).startswith("http"):
                    errors.append(f"{sloc}: url 应以 http(s) 开头")
    return errors


def main(path: str) -> int:
    p = Path(path)
    if not p.exists():
        print(f"❌ 文件不存在: {path}")
        return 1
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失败: {e}")
        return 1

    errors = validate(data)
    modules = data.get("modules", [])
    model_count = sum(len(m.get("models", [])) for m in modules)
    platforms = {s["platform"] for m in modules for mo in m.get("models", []) for s in mo.get("sources", [])}

    print(f"📦 节点数: {len(modules)}")
    print(f"🧩 模型条目数: {model_count}")
    print(f"🌐 覆盖平台: {', '.join(sorted(platforms))}")

    if errors:
        print("\n❌ 校验失败，以下问题需修复:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("\n✅ 校验通过")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "data/modules.json"
    sys.exit(main(target))
