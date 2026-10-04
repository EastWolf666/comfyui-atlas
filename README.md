# ComfyUI 模块—模型索引站（Atlas）

一个由社区维护、**GitHub Action 自动部署**到 GitHub Pages 的静态索引站：集中展示 **ComfyUI 自定义节点（modules）** 以及它们运行所需的**模型在各平台（Hugging Face / 魔搭 ModelScope / Civitai 等）的下载地址**。

> 本项目不托管任何模型文件，只收录公开下载地址直链，降低复现 ComfyUI 工作流的门槛。

---

## ✨ 特性

- 🔍 **搜索**：按节点名 / 模型名 / 标签检索
- 🏷️ **筛选**：按分类、平台、维护状态快速定位
- 🌐 **多平台覆盖**：HF、魔搭、Civitai、hf-mirror、哩布、Tensor.Art 等
- 🧩 **工作流分析器**：上传 / 粘贴 ComfyUI 工作流 `.json`，自动识别其中的自定义节点 → 给出 `git clone` / `cm-cli` 安装命令与缺失模型下载地址（复现工作流神器）
  - **四级匹配**：① 本站精选节点（带模型信息）② **预置 `github-extra.json` 高置信仓库映射**③ **ComfyUI-Manager 官方注册表精确命中**（覆盖全网 ~5900 个自定义节点）④ **运行时按需调用 GitHub 搜索 API**（对仍找不到的节点按「仓库名/描述与类名的重合度」给出置信度，🔒≥85% 高置信可直接安装，⚠️ 中置信需人工确认）
  - 内置节点、已定位仓库、GitHub 匹配、未找到仓库四类分类展示，列表内均支持按节点名实时筛选；未知节点区可一键「用 GitHub API 自动补全」
- 🤝 **PR 协作**：节点数据用 `data/modules.json`、节点映射用 `data/node-map.json` 维护，欢迎提 PR
- ⚙️ **自动部署**：push 到 `main` 即触发校验 + 部署到 GitHub Pages

---

## 📁 目录结构

```
.
├─ data/modules.json              # 数据源：节点与所需模型（核心，PR 维护）
├─ data/node-map.json             # 节点类名 → 模块 映射（工作流分析器用，PR 维护）
├─ data/registry-nodes.json       # ComfyUI-Manager 官方注册表（节点类名→仓库，~5900 仓库）
├─ data/github-extra.json         # 离线解析出的「未知节点→GitHub 高置信仓库」映射（第 4 级）
├─ index.html                     # 站点入口
├─ assets/
│   ├─ styles.css                 # 样式
│   └─ app.js                     # 读取 JSON → 渲染/搜索/筛选/工作流分析
├─ scripts/
│   ├─ validate.py                # 部署前 JSON 结构与必填项校验
│   ├─ check_links.py             # 链接健康检查（404/失效/反爬拦截排查）
│   └─ github_resolve.py          # 离线：用 GitHub 搜索 API 生成 github-extra.json
├─ .github/workflows/
│   ├─ deploy.yml                 # GitHub Action：校验 → 部署 Pages
│   └─ link-check.yml             # 定时/手动 链接健康检查，报告上传为 Artifact
└─ docs/需求文档.md               # 需求文档（PRD）
```

---

## 🔗 链接健康检查（失效链接快速排查）

站点里很多访问链接（节点 GitHub 仓库、各平台模型直链）长期可能失效。提供脚本一键排查：

```bash
# 检查本站精选数据（modules.json 的 repo + 模型 source），并发探测、自动重试
python3 scripts/check_links.py

# 同时抽查官方注册表仓库（默认随机 300 个，避免一次性打 5000+ 请求）
python3 scripts/check_links.py --registry --sample 300

# 严格模式：只要出现 404/410 就以非零退出码结束（适合 CI 卡点）
python3 scripts/check_links.py --strict

# 输出 JSON 报告
python3 scripts/check_links.py --json report.json
```

分类说明：`OK` 可达；`DEAD`（404/410）基本可判定失效，需修复；`BLOCKED`（401/403/429）多为站点反爬拦截，需人工在浏览器确认；`ERROR` 连接/超时类网络错误，建议重试。
> HF / Civitai 等站点对脚本常返回 403/超时，这类属于「反爬拦截」而非失效，请在本地浏览器或服务器环境运行本脚本以获得准确结果。

## 🤖 未知节点 · GitHub 置信度补全

工作流分析器对「仍未匹配」的自定义节点，支持两种方式的 GitHub 补全：

1. **运行时一键补全（前端）**：在工作流分析结果里，未知节点区点击「🔍 用 GitHub API 自动补全」，会自动按节点名调用 GitHub 搜索 API，给出最可能的仓库与**置信度徽章**（🔒≥85% / ⚠️ 中置信），并附带 `git clone` 命令；结果按浏览器本地缓存，重复分析不再重复请求。（未登录限速 10 次/分钟，脚本已自动节流。）
2. **离线预置（推荐批量）**：把常见未知节点类名收集起来，用脚本解析为 `data/github-extra.json`，提交后**所有访客即时命中、无需运行时调接口**：

```bash
# 从文件读取（每行一个类名，# 开头为注释），或 --types "A,B,C"
python3 scripts/github_resolve.py nodes_to_resolve.txt
# 提额：设置 GH_TOKEN（无需任何 scope）可突破未登录 10 次/分钟限速
GH_TOKEN=ghp_xxx python3 scripts/github_resolve.py nodes_to_resolve.txt
```

评分规则（取候选仓库最高分）：仓库名与类名高度吻合 → 0.90~0.95；描述/话题提及 → 0.60；仅含 comfyui → 0.50；低于 0.6 不写入。

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
