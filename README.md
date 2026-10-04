# ComfyUI 模块—模型索引站（Atlas）

一个由社区维护、**GitHub Action 自动部署**到 GitHub Pages 的静态索引站：集中展示 **ComfyUI 自定义节点（modules）** 以及它们运行所需的**模型在各平台（Hugging Face / 魔搭 ModelScope / Civitai 等）的下载地址**。

> 本项目不托管任何模型文件，只收录公开下载地址直链，降低复现 ComfyUI 工作流的门槛。

---

## ✨ 特性

- 🔍 **搜索**：按节点名 / 模型名 / 标签检索
- 🏷️ **筛选**：按分类、平台、维护状态快速定位
- 🌐 **多平台覆盖**：HF、魔搭、Civitai、hf-mirror、哩布、Tensor.Art 等
- 🧩 **工作流分析器**：上传 / 粘贴 ComfyUI 工作流 `.json`，自动识别其中的自定义节点 → 给出 `git clone` / `cm-cli` 安装命令与缺失模型下载地址（复现工作流神器）
- 🤝 **PR 协作**：节点数据用 `data/modules.json`、节点映射用 `data/node-map.json` 维护，欢迎提 PR
- ⚙️ **自动部署**：push 到 `main` 即触发校验 + 部署到 GitHub Pages

---

## 📁 目录结构

```
.
├─ data/modules.json              # 数据源：节点与所需模型（核心，PR 维护）
├─ data/node-map.json             # 节点类名 → 模块 映射（工作流分析器用，PR 维护）
├─ index.html                     # 站点入口
├─ assets/
│   ├─ styles.css                 # 样式
│   └─ app.js                     # 读取 JSON → 渲染/搜索/筛选
├─ scripts/validate.py            # 部署前 JSON 结构与必填项校验
├─ .github/workflows/deploy.yml   # GitHub Action：校验 → 部署 Pages
└─ docs/需求文档.md               # 需求文档（PRD）
```

---

## 🚀 本地预览

```bash
# 在项目根目录起一个静态服务器（不要用 file:// 直接打开，fetch 会被 CORS 拦截）
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

---

## 🤝 如何贡献一个节点

编辑 `data/modules.json`，在 `modules` 数组里新增一项。**必填字段**（缺一项校验会失败）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 🔴 | 全局唯一 slug，如 `comfyui-ipadapter` |
| `name` | 🔴 | 显示名 |
| `repo` | 🔴 | GitHub 仓库地址 |
| `category` | 🔴 | 分类（见下） |
| `models[].name` | 🔴 | 模型文件名/标识 |
| `models[].type` | 🔴 | 模型类型（见下） |
| `models[].sources[].platform` + `url` | 🔴 | 至少一个下载来源 |

可选字段：`author` `official` `maintenance`(`active`/`archived`/`unknown`) `description` `tags` `size` `version` `note`。

**分类枚举**：基础模型 · 控制网络 · 风格控制 · 动画 · 人脸 · 放大修复 · 工作流增强 · 视频 · 其他
**模型类型枚举**：checkpoint · lora · vae · controlnet · ipadapter · clip · unet · embeddings · upscale · insightface · other
**平台枚举**：huggingface · modelscope · civitai · hf-mirror · liblibai · tensorart · seaart · replicate · github-release · kaggle · other

**维护节点映射（工作流分析器用）**：`data/node-map.json` 把 ComfyUI 节点的 `class_type`（不区分大小写的子串匹配）映射到本站 `moduleId`，并在 `coreNodes` 中列出 ComfyUI 原生节点（避免误报为「需要安装」）。新增自定义节点包时，请在 `customNodes` 里补充其典型 `class_type` 关键词，否则工作流分析器无法识别它。

提交 PR 后，GitHub Action 会自动校验格式并（合并后）部署。

---

## ⚙️ 部署（GitHub Pages）

1. 将仓库推到 GitHub，开启 **Settings → Pages → Source: GitHub Actions**。
2. push 到 `main` 分支，[`deploy.yml`](.github/workflows/deploy.yml) 会：
   - 用 `scripts/validate.py` 校验数据；
   - 通过 `upload-pages-artifact` + `deploy-pages` 发布到 `https://<user>.github.io/<repo>/`。

---

## 📌 平台覆盖建议

优先覆盖 **Hugging Face + 魔搭 ModelScope + Civitai + hf-mirror + 哩布哩布**，这五个解决约 90% 的 ComfyUI 模型获取需求。详见 [`docs/需求文档.md`](docs/需求文档.md) 的第 5 节平台对比。
