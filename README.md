# ComfyUI 模块—模型索引站（Atlas）

一个由社区维护、**GitHub Action 自动部署**到 GitHub Pages 的静态索引站：集中展示 **ComfyUI 自定义节点（modules）** 以及它们运行所需的**模型在各平台（Hugging Face / 魔搭 ModelScope / Civitai 等）的下载地址**。

> 本项目不托管任何模型文件，只收录公开下载地址直链，降低复现 ComfyUI 工作流的门槛。

---

## ✨ 特性

- 🗂️ **工作流库**（`index.html`，**站点首页**）：汇集 RunningHub 公开的可运行 ComfyUI 工作流，每条含**预览图**、作者、使用/点赞/收藏热度、发布时间与标签；支持**搜索、标签筛选、按热度/最新/点赞/收藏排序**，一键跳转来源在线运行
  - 加载性能：**分片按需加载**（首屏只拉最热一片，滚动自动续片）+ 每片 gzip + 浏览器 `DecompressionStream` 原生解压 + 增量渲染，万级数据也流畅
  - 切换排序**即时生效**：各维度Top-480 榜单内联在清单里（清单本身也预压缩），弱网下切换仅需 0.01~0.03 秒，无需等全部分片
  - 搜索**秒出**：额外产出一份 3.6MB 的搜索索引（仅含名称/作者/标签），首屏空闲时后台预热，命中后无需等29 个分片下载完——实测预热命中时 **0.7 秒**出结果（原需19~32 秒）
  - **每 3 天自动增量更新**（GitHub Actions）：从分片还原历史数据 + 只抓最新 60 页，按 `id` 合并去重（已存在的仅刷新热度，不重复追加），自动提交并触发部署
  - 数据来源与扩充见下方「工作流数据管线」
- 🔍 **模块—模型索引**（`modules.html`）：按节点名 / 模型名 / 标签检索，按分类、平台、维护状态快速定位，覆盖 HF、魔搭、Civitai、hf-mirror、哩布、Tensor.Art 等平台
- 🧩 **工作流分析器**：上传 / 粘贴 ComfyUI 工作流 `.json`，自动识别其中的自定义节点 → 给出 `git clone` / `cm-cli` 安装命令与缺失模型下载地址（复现工作流神器）
  - **四级匹配**：① 本站精选节点（带模型信息）② **预置 `github-extra.json` 高置信仓库映射**③ **ComfyUI-Manager 官方注册表精确命中**（覆盖全网 ~5900 个自定义节点，精确对应到「父插件」仓库）④ **运行时按需调用 GitHub 搜索 API**（仅对注册表都没收录的节点启用，结果会**反查官方注册表核实**：命中已知扩展标「🔒 可信」，否则标「🤔 推测」请人工确认——很多节点只是大插件的子模块）
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
├─ data/workflows.json            # 完整工作流元信息（本地构建输入，已 gitignore，不上线）
├─ data/wf-manifest.json          # 工作流分片清单（来源/总数/分片列表/榜单/索引声明）← 前端加载这个
├─ data/wf-index.json.gz          # 搜索索引（3.6MB：ids/tags/rows/order，让搜索秒出）
├─ data/wf-shard-*.json.gz        # 工作流 gzip 分片（按热度切分，前端按需加载）
├─ data/thumbs/<id>.jpg           # 视频封面工作流抽出的预览帧（320px，约 8~20KB/张）
├─ index.html                     # 站点入口（工作流库，首页）
├─ modules.html                   # 模块—模型索引页
├─ workflows.html                 # 旧链接的跳转页（→ index.html，保住已分享的 URL）
├─ assets/
│   ├─ styles.css                 # 样式
│   ├─ app.js                     # 模块索引：读取 JSON → 渲染/搜索/筛选/工作流分析
│   └─ workflows.js               # 工作流库：分片按需加载 + gzip 解压 + 增量渲染 + 排序/筛选
├─ scripts/
│   ├─ validate.py                # 部署前 JSON 结构与必填项校验
│   ├─ check_links.py             # 链接健康检查（404/失效/反爬拦截排查）
│   ├─ github_resolve.py          # 离线：用 GitHub 搜索 API 生成 github-extra.json
│   ├─ expand_modules.py          # 扩充 modules.json（节点与模型条目）
│   ├─ scrape_runninghub.py       # 抓取 RunningHub 工作流 → data/workflows.json
│   ├─ build_data.py              # 优化完整数据：精简描述 + 紧凑化（中间产物）
│   ├─ build_shards.py            # 把完整数据切成 gzip 分片 +榜单 + 搜索索引
│   └─ extract_video_thumbs.py    # 为视频封面工作流抽预览帧 → data/thumbs/
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

1. **运行时一键补全（前端）**：在工作流分析结果里，未知节点区点击「🔍 用 GitHub API 自动补全」，会自动按节点名调用 GitHub 搜索 API，给出最可能的仓库与**置信度徽章**，并附带 `git clone` 命令；结果按浏览器本地缓存，重复分析不再重复请求。（未登录限速 10 次/分钟，脚本已自动节流。）
2. **离线预置（推荐批量）**：把常见未知节点类名收集起来，用脚本解析为 `data/github-extra.json`，提交后**所有访客即时命中、无需运行时调接口**：

```bash
# 从文件读取（每行一个类名，# 开头为注释），或 --types "A,B,C"
python3 scripts/github_resolve.py nodes_to_resolve.txt
# 提额：设置 GH_TOKEN（无需任何 scope）可突破未登录 10 次/分钟限速
GH_TOKEN=ghp_xxx python3 scripts/github_resolve.py nodes_to_resolve.txt
```

> ⚠️ **关于「子模块」与「置信度」的重要说明**：ComfyUI 的很多「节点」其实只是某个**大插件里的一个子模块**（例如某些工具节点只是 `ComfyUI-Impact-Pack`、`ComfyUI-Manager` 等大型插件的一部分）。本项目据此做了两层处理，避免给你指错仓库：
> - **精确匹配（第 3 级 · 官方注册表）**：`ComfyUI-Manager` 官方注册表把每个 `class_type` **精确映射**到它所属的「父插件」仓库。命中后 UI 会明确标注「🧩 父插件·含 N 个节点」，提示你**安装整个父插件**即可，而非去搜一个以子节点命名的独立仓库（多半不存在或不是真源）。
> - **GitHub 搜索补全（第 4 级）**：仅对注册表都没收录的罕见节点启用，且结果会**反查官方注册表核实**——命中已知扩展标「🔒 可信」，否则标「🤔 推测」并注明「未在官方注册表核实，可能只是同名/相关仓库，请打开仓库确认是否真的含该节点」。请优先信任第 3 级的「精确」结果。

评分规则（取候选仓库最高分）：仓库名与类名高度吻合 → 0.90~0.95；描述/话题提及 → 0.60；仅含 comfyui → 0.50；低于 0.6 不写入。

---

## 🗂️ 工作流数据管线（工作流库）

工作流库的每条数据都带**预览图、作者、热度统计、发布时间、标签**，并可跳转来源在线运行。当前数据源为 **RunningHub**（国内最大的 ComfyUI 云端平台，约 8.8 万条公开工作流）。

### 抓取 / 扩充

```bash
# 首次抓取（默认 40 页 × 50 = 2000 条）
python3 scripts/scrape_runninghub.py

# 续采：从第 N 页继续往后翻，按 id 去重合并进现有 data/workflows.json
python3 scripts/scrape_runninghub.py --append --start-page 321 --pages 200

# 指定关键词（注意：接口服务端会忽略 keyword，仅按最新倒序返回）
python3 scripts/scrape_runninghub.py --keyword "视频" --pages 50
```

> **接口说明**：`POST https://www.runninghub.cn/api/search/workflow` 仅接受 `current`(页码) / `size`(每页条数，最大 50) 用于翻页；`orderBy` / `keyword` 服务端忽略，**永远按发布时间倒序**返回。因此「按热度/下载/点赞排序」由前端在本地完成。

### 加载性能优化（分片 + gzip + 增量渲染）

数据量增大后，一次性把上万张卡片塞进 DOM 会明显卡顿，且 GitHub Pages **不会自动 gzip**（实测响应无 `content-encoding`）。本项目采用组合优化：

| 优化 | 做法 | 效果 |
|------|------|------|
| **分片按需加载** | 构建时按热度排序切成多个 gzip 分片（默认 3000 条/片）。**首屏只拉第 0 片**，滚动到底自动续下一片；只有「搜索 / 标签筛选」需要全局数据时，才一次性加载全部分片 | 首屏下载量降至约 **1/29** |
| **全量加载并发** | 「搜索 / 标签筛选」触发的全部分片加载走 **4 路并发**（HTTP/1.1 同源并发上限），只并发取字节这一步，解压/入池仍串行以保 `loadShard` 语义 | 全量加载 **7~8 分钟 → 19 秒**（3Mbps 慢网下 32 秒） |
| **内联预览** | 清单里直接内联最热 120 条（`preview`），首屏**不等分片**即可渲染卡片 | 首屏「白屏等待」时间降为 0 |
| **排序榜单内联** | 各维度 Top-480 榜单（`rank` + `rankItems`）内联在清单中；切换排序先用榜单立即渲染，剩余数据在后台补齐后再全局重排 | 切换排序从「数分钟」降到 **0.01~0.03 秒** |
| **清单预压缩** | 清单同样产出 `.gz`，前端优先加载 `.gz`、失败才回退 `.json` | 榜单内联后清单 703KB → **193KB** |
| **传输压缩** | 每个分片独立 gzip，前端用浏览器原生 `DecompressionStream('gzip')` 解压（带魔数兜底 + 不支持时回退） | 传输量约为原始 **15%** |
| **精简载荷** | 字段用短键（`i/n/a/im/t/s/g/d`），去掉可派生的 `sourceUrl`、改用首字头像替代远程头像 | 减小体积、免去海量头像请求 |
| **预览图缩略** | 图片 URL 统一改写为七牛缩略参数 `?imageView2/2/w/480/h/300/format/jpg`（匹配卡片 16:10），避免拉原图；**视频封面不加此参数**，改走本地抽帧（见下） | 图片体积降 **80~97%**（原图平均 ~600KB/张） |
| **视频封面抽帧** | 约 20% 的工作流封面是 `.mp4`（实测 17677/85894），图片 CDN 未启用视频处理、无法服务端抽帧，故构建时用 ffmpeg 本地抽一帧存 `data/thumbs/<id>.jpg`，卡片加「▶ 视频」角标 | 修复 **1.7 万条空白卡片**；每张 8~20KB，实测 16.7KB |
| **增量渲染** | 每批只渲染 48 张，滚动自动追加（仅插入新卡片，不重绘） | 万级数据也流畅 |
| **搜索索引** | 额外产出 `wf-index.json.gz`（**3.6MB**，仅为搜索所需字段），搜索先用它算出命中集合并渲染，缺的热度/图片字段再由分片补齐；首屏空闲时后台预热 | 搜索 **19~32 秒 → 0.7 秒**（预热命中时） |
| **筛选状态反馈** | 输入瞬间亮起搜索框内嵌转圈 + 状态条（不等 250ms 防抖）；状态条文案说明"为什么慢"，加载期换成`正在加载数据（14/29 个分片）` 实时进度；12 秒后转静态提示防"永远在转" | 不再"不知道是不是正在筛" |
| **匹配数计数** | 筛选态下分母是**匹配数**而非全库总数（`匹配 10,039 个`），并区分筛选中/已完成；空状态文案带上筛选条件 | 一眼看出筛选是否生效 |
| **断点续传** | 索引/分片下载带 `Range` 断点重连；**stall 守卫**（连续 20 秒零字节才判卡死）替代整体超时 | 慢网络不再被腰斩，弱网可用 |
| **健壮降级** | 首片失败时保留预览并给「重试」按钮，`loadingShard` 标志必被释放 | 弱网下不再卡死 |

> **平台数据缺口**：RunningHub 接口的 `downloadCount` 与 `pv`（浏览量）**恒返回 0**（实测全库 85689 条无一非零），因此「下载量排序」无实际意义，已从排序选项移除，卡片上的「下载 0」徽章也一并去掉，避免误导。可用的热度维度为**使用量 / 点赞 / 收藏 / 最新**。

> **为什么以前切换排序"看起来不可用"**：早期实现里，任何非默认排序都要等**全部分片**（当时 17 片 / 6.3MB，现为 29 片 / 11MB）加载完成才能重排，弱网下要等数分钟。现已改为榜单内联 + 后台补全，切换瞬间出结果。

> **超时该用"整体超时"还是"卡死守卫"？**（踩坑记录，血泪教训）本题先后踩了三个坑，最终结论是**后者**：
>
> 1. `AbortController` 只在 `fetch()` 未完成时有效。响应头一到`fetch` 就 resolve，后续 `res.arrayBuffer()` 完全不受保护——慢网下会 Promise 永久悬挂（曾实测读 438KB 分片耗 27s卡死）。→ 改用流式读取（`res.body.getReader()`）让 `signal` 全程生效。
> 2. 读完时**绝不能** `abort()`。body 仍有在途微任务，此时 abort 会让浏览器抛 `AbortError: BodyStreamBuffer was aborted`，把**已读完的成功下载**变成失败（曾导致首片与索引双双报错、并被误判为"超时不够"）。
> 3. **整体超时本身是错的设计**。实测 GitHub Pages 到部分地区吞吐低至 **6KB/s**（3.6MB 要十几分钟），任何按"体积 ÷ 经验速度"算出的总预算都会把**慢但正常**的连接腰斩。最终改为纯 stall 守卫：只要还在持续收到数据就一直等，连续 20 秒零字节才判卡死并带 `Range` 断点重连。
>
> ```js
> // 正确姿势：流式读取 + stall 守卫 + 只在中断路径 abort
> const reader = res.body.getReader();
> let finished = false;
> try {
>   for (;;) {
>     let timer = null;
>     const chunk = await Promise.race([
>       reader.read(),
>       new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("stall")), STALL); }),
>     ]).finally(() => clearTimeout(timer));
>     if (chunk.done) { finished = true; break; }
>     // ...累积 chunk
>   }
> } finally {
>   if (!finished) ac.abort(); // 读完时绝不 abort
> }
> ```
>
> 另：不要用 `cache: "no-store"`，它会绕过 CDN 导致每次回源（GitHub Pages 响应本身带 `max-age=600`）。

### 🎬 视频封面抽帧（`data/thumbs/`）

平台约 **20% 的工作流（17677/85894）封面是 `.mp4`**，这些卡片此前一直是「暂无预览图」。

**为什么不能直接 `<img src="...mp4">`**，也不能让 CDN 帮忙处理：

| 尝试 | 结果 |
|------|------|
| `<img src="xxx.mp4">` | 浏览器把视频当图片解析，必然失败 |
| 七牛 `?imageView2/2/w/480/h/300/format/jpg` | HTTP 400 `InvalidImageFormat` |
| 七牛 `?vframe/jpg/offset/1/w/480/h/300` | 参数被忽略，**原样返回 mp4**（魔数仍是 `ftypisom`） |
| Range 只取前 2MB 再抽帧 | 失败，mp4 的 `moov` 索引表在文件尾部 |

结论是这个七牛空间**未启用视频处理**，只能本地抽帧：

```bash
python3 scripts/extract_video_thumbs.py --limit 6000 --workers 8
```

- 并发下载 → ffmpeg 抽一帧 → 缩到 **320px 宽** JPEG（实测 8~20KB）→ `data/thumbs/<id>.jpg`
- **抽帧时间点取时长的 30%**（上限 1.5 秒）：不少生成视频开头是黑场/淡入，抽第 0 秒会得到纯黑图；失败再退回第 0 秒
- `os.replace` 原子落盘，中断不留半张图；已存在且 >512B 的跳过，**中断后重跑可续**
- 编码兼容性已验证：样本含 **hevc** 与 h264、分辨率 720x1280 ~ 1248x720，时长 3.7~32 秒，均抽取成功
- 卡片上标「▶ 视频」，让用户知道原内容是视频（点进去在平台可播放）

> **踩坑：视频 URL 被图片参数污染**。原先 `thumb()` 无差别拼接 `?imageView2/...`，于是数据里存的是 `xxx.mp4?imageView2/2/w/480/h/...`。这既让前端的 `isVideoCover()` 匹配不到（正则要求扩展名紧跟 `?` 或结尾），也保证了 `<img>` 必然加载失败——**两个症状同源**。现在 `thumb()` 遇到视频会原样返回，由前端按`data/thumbs/<id>.jpg` 取图。

> **为什么抽出的帧直接入库**：纯静态站没有后端可存图。存进 Git 仓库后与现有分片一样走 Pages CDN，零外部依赖、也不受第三方图床存活影响。代价是仓库体积——全量 1.7 万条约 230MB，因此首轮只做**按使用量降序的前 6000 条**（覆盖绝大多数用户会看的内容，60 万次曝光里绝大多数命中）。定时任务里每次顺带补抽 300 条，新工作流不会再留空白。

> **踩坑：6000 张缩略图推不上去**。最初用 Git Data API（blobs → tree → commit → PATCH ref）逐个上传，`POST /git/trees` 持续返回 **HTTP 504**——单次 3000 个 blob 的树创建超出 GitHub 承受范围，缩到几百个又太慢。**正解是别用 API，直接 `git push`**：144MB / 6147 个对象 21 秒传完。
>
> 附带两个衍生问题：
> 1. **`could not read Username for 'https://github.com'`**——非交互环境没有凭据。用 `GIT_ASKPASS` 脚本注入（不要把 token 写进 remote URL，会留在 `.git/config` 里）。
> 2. **`refusing to merge unrelated histories`**——远端提交是 API 建的（内容等价但 SHA 不同），直接 push 非快进。用 `git merge -s ours origin/main --allow-unrelated-histories` 把远端 tip 接为祖先，即可正常快进推送，**不必 force push**。
>
> 验证时另有一个**假阴性**值得注意：脚本统计 `img.naturalWidth > 0` 判定缩略图是否加载成功，但 `loading="lazy"` 的图未进入视口时该值恒为 0（甚至根本没发请求），会被误判为加载失败。正确做法是监听 `response` 事件看真实 HTTP 状态，或在页面内直接 `fetch` + `createImageBitmap` 解码。本站线上实测：抽样 30 张直连全部 200 且字节数与本地一致，页面内批量解码 60/60 成功。

### 🔍 搜索索引（`wf-index.json.gz`）

搜索要匹配 名称 / 作者 / 描述 / 标签，但这些字段散落在 29 个分片里。若等分片全部下载完才能筛，弱网下要数十秒。索引把这些字段单独抽成一份：

```
wf-index.json.gz 结构（3.6MB / 3815947 字节，约为全部分片的 33%）：
{
  "ids":   ["1991530280437628929", ...],          // id，顺序与分片一致
  "tags":  ["3D卡通", "AI漫剧", ...],              // 标签字典（实测仅 143 种）
  "rows":  [["名称", "作者", [标签id, ...]], ...],  // 逐条的可搜索字段
  "order": { "u": [行号...], "l": [...], "c": [...], "latest": [...] }
}
```

两个关键设计：

- **`order` 存「行号」而非 id**：行号是 <9 万的小整数，比 19 位 id 字符串省 3 倍以上。踩坑：曾直接存 4 份完整 id 列表，索引膨胀到 5.9MB，几乎等于全部分片，索引就失去意义了。
- **`order` 内联各热度维度顺序**：让搜索结果**无需等分片即可排序**。否则命中后仍要等全量加载才能重排，等于没优化。

配套的取舍与兜底：

| 点 | 说明 |
|------|------|
| **不含描述（`d`）** | 描述平均较长，放进索引会明显增大体积。因此搜描述时索引会**零命中**，此时自动退回「加载全部分片 + 用完整字段重查」，避免漏结果。 |
| **占位卡片渐进补齐** | 命中的条目若所属分片尚未加载，先渲染占位骨架（虚线边框 + "图片加载中…"），分片到位后自动替换为完整卡片。 |
| **首屏预热** | 索引 3.6MB 在线上可能要几十秒，所以首屏空闲时（`requestIdleCallback`）就后台下载；用户输关键词时通常已就绪。预热是静默的，不显示筛选状态条。 |
| **排序维度映射** | 索引 `order` 用短键（`u/l/c`），下拉框 `state.sort` 是长键（`uses/likes/collects`），必须先过 `RANK_DIM` 映射。踩坑：直接取会拿到 `undefined` 并静默回退到 `order.u`，表现为"切排序没反应"。 |
| **`INDEX_MODE` 标志** | 后台分片加载完后若用 `POOL.filter()` 重算，会把索引命中集合（与 `POOL` 无关）覆盖掉。需按模式分支。 |

数据产物：

```
data/wf-manifest.json.gz    # 清单（前端优先加载这个）：总数/分片列表/字段schema
                             #   + preview(120) 首屏预览 + rank/rankItems 各维度 Top-480 榜单
                             #   + indexFile / indexSize 声明搜索索引
data/wf-index.json.gz       # 搜索索引（3.6MB）：ids / tags / rows / order
data/wf-shard-000.json.gz   # 第 0 片（最热 3000 条）← 首屏只拉这个
data/wf-shard-001.json.gz   # 后续分片，滚动/搜索时按需拉取
...
```

> 索引的未压缩版（10MB）**不入库**，压完即删——与分片一致，客户端只用 `.gz`。

重新抓取 / 构建 / 分片：

```bash
# 【推荐】增量更新：从分片还原历史数据 + 只抓最新若干页 + 重建分片（幂等，可反复跑）
python3 scripts/update_workflows.py --pages 60
# 底层命令（一般不用手写）
python3 scripts/scrape_runninghub.py --append --start-page 1716 --pages 300 # 全量续采
python3 scripts/build_shards.py --shard-size 3000 --rank-top 480        # 切分+榜单+搜索索引（--no-index 可跳过索引）
python3 scripts/extract_video_thumbs.py --limit 6000 --workers 8       # 视频封面抽帧（幂等，可反复跑）
python3 scripts/extract_video_thumbs.py --limit 0 --workers 10        # --limit 0 = 全量补齐所有视频条目
```

> 完整数据 `data/workflows.json` 仅作为抓取/分片构建的中间产物（已 gitignore），不入库；线上只部署分片。

### 🔄 定时增量更新（GitHub Actions）

工作流 [`.github/workflows/update-workflows.yml`](.github/workflows/update-workflows.yml) **每 3 天自动跑一次**：

| 项 | 值 |
|---|---|
| 触发时间 | `cron: '10 3 */3 * *'`（UTC，约北京时间上午 11:10） |
| 扫描范围 | 最新 60 页 × 50 = 3000 条（平台按发布时间倒序，新数据必在前） |
| 深页回补 | 第 610–699 页（90 页），捞回"批量上架漏采"条目 |
| 耗时 | 约 3~5 分钟（含回补） |
| 权限 | `contents: write`（自动提交后触发 Pages 部署） |

**去重机制**（关键）：完整数据没入库，所以脚本先**从 29 个分片反解出全部历史条目**作为基线，再抓取最新页并按 `id` 合并：

- `id` 已存在 → **只更新热度统计**（使用量/点赞/收藏会随时间增长），不追加
- `id` 不存在 → 新增

因此**重复运行不会产生重复数据**。实测：扫 300 条中 93 条已存在（仅更新热度）、0 条重复追加；紧接着第二次运行新增 0 条。

内置双重安全阀，防止把损坏数据写进仓库：
1. 写入前校验 `id`/`name` 缺失率 > 1% 则中止
2. 构建后校验清单条目数与源数据一致、首片不是空壳（< 50KB）

> ⚠️ 踩坑记录：早期版本直接输出分片里的**短键**格式（`i/n/s`），而 `build_shards.py` 读的是**长键**（`id/name/stats`），导致所有字段读空、分片全部损坏（首片仅 5KB）。现在 `lean_to_raw()` 负责还原成长键，并加了上述安全阀。

手动触发：Actions 页面 → *Update workflow data* → *Run workflow*，可自定义 `pages` / `backfill_from` / `backfill_pages`。

### 🕳️ 深页回补（批量上架漏采）

「只扫最新页」有个结构性盲区：接口按**发布时间倒序**返回，所以平台某次**短时间批量上架**时，这批条目会整体落在中段深页。早期按序扫描若正好跳过那几页，之后只扫最新页就**永远发现不了**。

实测定位：全库深扫到 1000 页，缺口集中在第 **613 / 617 / 646** 页，其中第 617 页一次性漏掉 48 条（同一天集中上架）。已通过回补补回，数据从 85782 → **85832 条**。

因此 CI 每次运行除最新页外，固定回补**第 610–699 页**：

```bash
# 手动回补任意深页区间
python3 scripts/update_workflows.py \
  --pages 10 --backfill-from 610 --backfill-pages 90
```

回补复用同一套 `map_record` 映射与幂等合并逻辑（已存在的只刷热度，不存在的才新增），并受同样的双重安全阀保护。

> 💡 门槛提示：`--backfill-from` 必须显式给值。若省略或填 0，脚本会打印提示并跳过回补 —— 因为"紧接最新页的区间早已全收录"，把 `--pages` 当回补起点是无效的。

### 🔍 一次性全库重扫

补漏用全量重扫（平台约 1770 页，很慢，约 40 分钟）：

```bash
python3 scripts/update_workflows.py --full-rescan          # 写盘
python3 scripts/update_workflows.py --full-rescan --dry-run # 只统计不写盘
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
