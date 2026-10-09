"use strict";

const PLATFORM_LABELS = {
  huggingface: "Hugging Face",
  modelscope: "魔搭 ModelScope",
  civitai: "Civitai",
  "hf-mirror": "hf-mirror",
  liblibai: "哩布 LiblibAI",
  tensorart: "Tensor.Art",
  seaart: "SeaArt",
  replicate: "Replicate",
  "github-release": "GitHub Release",
  kaggle: "Kaggle",
  other: "其他",
};

const STATUS_LABELS = { active: "维护中", archived: "已归档", unknown: "未知" };

// 模型类型 -> 下拉框展示名
const TYPE_LABELS = {
  checkpoint: "Checkpoint 底模",
  lora: "LoRA",
  locon: "LoCon",
  lycoris: "LyCORIS",
  vae: "VAE",
  controlnet: "ControlNet",
  controlnetaux: "ControlNet 辅助",
  ipadapter: "IP-Adapter",
  upscale: "放大模型",
  insightface: "InsightFace 人脸",
  clip: "CLIP",
  unet: "UNet",
  embedding: "Embedding 嵌入",
  embeddings: "Embeddings 嵌入",
  diffusion_model: "Diffusion 扩散模型",
  video: "视频生成模型",
  llm: "LLM 文本模型",
  vae_approx: "VAE-approx",
  recognition: "识别模型",
  other: "其他",
};

// 模型类型 -> ComfyUI 放置目录（models/ 下）。数据缺省按类型推断，可在数据里用 targetDir 覆盖。
const MODEL_DIR_BY_TYPE = {
  checkpoint: "models/checkpoints",
  lora: "models/loras",
  locon: "models/loras",
  lycoris: "models/loras",
  vae: "models/vae",
  controlnet: "models/controlnet",
  controlnetaux: "models/controlnet",
  ipadapter: "models/ipadapter",
  upscale: "models/upscale_models",
  insightface: "models/insightface",
  clip: "models/clip",
  unet: "models/unet",
  embeddings: "models/embeddings",
  diffusion_model: "models/diffusion_models",
  video: "models/diffusion_models",
  llm: "models/LLM",
  vae_approx: "models/vae_approx",
  recognition: "models/recognization",
};

function modelTargetDir(mo) {
  if (mo && mo.targetDir) return mo.targetDir;
  const t = String((mo && mo.type) || "").toLowerCase().replace(/\s+/g, "");
  return MODEL_DIR_BY_TYPE[t] || "models/" + (t || "others");
}

// 把 HF 链接转换为 hf-mirror 国内镜像链接
function hfMirror(url) {
  const u = String(url || "");
  if (/huggingface\.co\//i.test(u)) return u.replace(/huggingface\.co\//i, "hf-mirror.com/");
  return null;
}

let ALL = [];
let NODE_MAP = { coreNodes: [], customNodes: [] };
let currentView = "nodes";
const filters = { text: "", category: "", type: "", status: "" };
let FAVS = loadFavs();

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ============ 收藏（localStorage） ============ */
function loadFavs() {
  try {
    const raw = localStorage.getItem("comfyui-atlas-favs");
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) { return new Set(); }
}
function saveFavs() {
  try { localStorage.setItem("comfyui-atlas-favs", JSON.stringify([...FAVS])); } catch (_) {}
}
function isFav(id) { return FAVS.has(id); }
function toggleFav(id) {
  if (FAVS.has(id)) FAVS.delete(id); else FAVS.add(id);
  saveFavs();
}

async function init() {
  const container = document.getElementById("modules");
  try {
    const [res, mapRes] = await Promise.all([
      fetch("data/modules.json", { cache: "no-store" }),
      fetch("data/node-map.json", { cache: "no-store" }),
    ]);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    ALL = Array.isArray(data.modules) ? data.modules : [];
    if (mapRes.ok) {
      try { NODE_MAP = await mapRes.json(); } catch (_) {}
    }
  } catch (e) {
    container.innerHTML =
      '<p class="empty">数据加载失败：' + esc(e.message) +
      "。请通过本地服务器预览（python3 -m http.server），不要直接以 file:// 打开。</p>";
    return;
  }
  renderStats();
  populateFilters();
  bindControls();
  bindWorkflowUI();
  render();
}

function renderStats() {
  const modules = ALL.length;
  let modelCount = 0;
  const platforms = new Set();
  for (const m of ALL) {
    for (const mo of m.models || []) {
      modelCount++;
      for (const s of mo.sources || []) platforms.add(s.platform);
    }
  }
  document.getElementById("stat-modules").textContent = modules;
  document.getElementById("stat-models").textContent = modelCount;
  document.getElementById("stat-platforms").textContent = platforms.size;
}

function uniqueValues(keyFn) {
  const set = new Set();
  for (const m of ALL) for (const v of keyFn(m)) if (v) set.add(v);
  return [...set].sort();
}

function populateFilters() {
  const catSel = document.getElementById("filter-category");
  for (const c of uniqueValues((m) => [m.category])) {
    catSel.add(new Option(c, c));
  }
  const typeSel = document.getElementById("filter-type");
  const types = uniqueValues((m) => (m.models || []).map((mo) => String(mo.type || "").toLowerCase()));
  for (const t of types) {
    typeSel.add(new Option(TYPE_LABELS[t] || t, t));
  }
  const stSel = document.getElementById("filter-status");
  for (const s of uniqueValues((m) => [m.maintenance])) {
    stSel.add(new Option(STATUS_LABELS[s] || s, s));
  }
}

function bindControls() {
  document.getElementById("search").addEventListener("input", (e) => {
    filters.text = e.target.value.trim().toLowerCase();
    render();
  });
  document.getElementById("filter-category").addEventListener("change", (e) => {
    filters.category = e.target.value; render();
  });
  document.getElementById("filter-type").addEventListener("change", (e) => {
    filters.type = e.target.value; render();
  });
  document.getElementById("filter-status").addEventListener("change", (e) => {
    filters.status = e.target.value; render();
  });
  document.querySelectorAll(".view-tabs .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-tabs .tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentView = btn.dataset.view;
      const isBrowse = currentView === "nodes" || currentView === "platforms" || currentView === "fav";
      document.getElementById("browse-view").hidden = !isBrowse;
      document.getElementById("workflow-view").hidden = isBrowse;
      if (isBrowse) {
        document.querySelector(".controls").classList.toggle("view-platforms", currentView === "platforms");
        document.getElementById("modules").classList.toggle("view-platforms", currentView === "platforms");
        render();
      }
    });
  });
}

function matches(m) {
  if (filters.category && m.category !== filters.category) return false;
  if (filters.status && (m.maintenance || "unknown") !== filters.status) return false;
  if (filters.type) {
    const has = (m.models || []).some((mo) => String(mo.type || "").toLowerCase() === filters.type);
    if (!has) return false;
  }
  if (filters.text) {
    const hay = [
      m.name, m.description, m.author, m.category,
      (m.tags || []).join(" "),
      ...(m.models || []).flatMap((mo) => [mo.name, mo.type, ...(mo.sources || []).map((s) => s.url)]),
    ].join(" ").toLowerCase();
    if (!hay.includes(filters.text)) return false;
  }
  return true;
}

function installBlock(m) {
  const dir = repoDir(m.repo);
  const cloneCmd = `git clone ${m.repo} ComfyUI/custom_nodes/${dir}`;
  const cmCmd = `cm-cli install ${m.repo}`;
  return `<details class="card-install">
    <summary>🔧 安装命令</summary>
    <div class="wf-install">
      <div class="wf-cmd"><code>${esc(cloneCmd)}</code><button class="copy" data-copy="${esc(cloneCmd)}">复制</button></div>
      <div class="wf-cmd"><code>${esc(cmCmd)}</code><button class="copy" data-copy="${esc(cmCmd)}">复制</button></div>
    </div>
    <p class="wf-tip">把节点克隆到 ComfyUI 的 <code>custom_nodes/</code> 目录；或用 ComfyUI-Manager 的 <code>cm-cli</code> 安装。</p>
  </details>`;
}

function favStar(m) {
  const starred = isFav(m.id);
  return `<button class="fav-star ${starred ? "on" : ""}" data-id="${esc(m.id)}" data-name="${esc(m.name)}" title="${starred ? "取消收藏" : "收藏"}" aria-label="收藏">${starred ? "★" : "☆"}</button>`;
}

function modelSourcesHTML(mo) {
  const sources = (mo.sources || []).map((s) => {
    const label = PLATFORM_LABELS[s.platform] || s.platform;
    const cls = "p-" + String(s.platform).replace(/[^a-z-]/g, "");
    const size = s.size ? `<span class="sz">${esc(s.size)}</span>` : "";
    const mirror = s.platform === "huggingface" ? hfMirror(s.url) : null;
    const mirrorLink = mirror
      ? `<a class="src mirror" href="${esc(mirror)}" target="_blank" rel="noopener" title="国内镜像下载">🔁 镜像</a>`
      : "";
    return `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="p ${cls}">${esc(label)}</span>${size}</a>${mirrorLink}`;
  }).join("");
  const dir = modelTargetDir(mo);
  return `<div class="model">
      <div><span class="mname">${esc(mo.name)}</span><span class="mtype">${esc(mo.type)}</span><span class="mdir">📁 ${esc(dir)}</span></div>
      <div class="sources">${sources}</div>
    </div>`;
}

function cardHTML(m) {
  const status = m.maintenance || "unknown";
  const tags = (m.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join("");
  const models = (m.models || []).map(modelSourcesHTML).join("");

  const modelBlock = (m.models && m.models.length)
    ? `<div class="models"><h3>所需模型 (${m.models.length})</h3>${models}</div>`
    : `<div class="models empty-models">纯逻辑节点，无需额外模型文件</div>`;

  return `<article class="card">
    ${favStar(m)}
    <h2>${esc(m.name)}</h2>
    <div class="meta-row">
      <span class="chip cat">${esc(m.category || "其他")}</span>
      <span class="chip status-${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>
      ${m.official ? '<span class="chip">官方</span>' : ""}
      ${m.author ? `<span class="chip">@${esc(m.author)}</span>` : ""}
      ${tags}
    </div>
    ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ""}
    <div class="repo"><a href="${esc(m.repo)}" target="_blank" rel="noopener">${esc(m.repo)}</a></div>
    ${installBlock(m)}
    ${modelBlock}
  </article>`;
}

function render() {
  if (currentView === "platforms") { renderPlatforms(); return; }
  if (currentView === "fav") { renderFav(); return; }
  renderNodes();
}

function renderNodes() {
  const list = ALL.filter(matches);
  const container = document.getElementById("modules");
  const empty = document.getElementById("empty");
  container.innerHTML = list.map(cardHTML).join("");
  empty.hidden = list.length !== 0;
  document.getElementById("count").textContent = `显示 ${list.length} / ${ALL.length} 个节点`;
  bindCopyButtons();
  bindFavButtons();
}

function renderFav() {
  const container = document.getElementById("modules");
  const empty = document.getElementById("empty");
  const list = ALL.filter((m) => isFav(m.id) && matches(m));
  if (!list.length) {
    container.innerHTML = "";
    empty.hidden = false;
    empty.textContent = FAVS.size ? "没有匹配的收藏节点，试试调整筛选条件。" : "还没有收藏任何节点。点击卡片右上角的 ☆ 即可收藏，方便日后快速下载与复现。";
    document.getElementById("count").textContent = "";
    return;
  }
  empty.hidden = true;
  const cards = list.map(cardHTML).join("");

  // 聚合收藏节点的模型下载清单
  const modelMap = new Map();
  for (const m of list) {
    for (const mo of m.models || []) {
      for (const s of mo.sources || []) {
        const key = mo.name + "|" + s.url;
        if (!modelMap.has(key)) {
          modelMap.set(key, {
            modelName: mo.name, modelType: mo.type, nodeName: m.name,
            url: s.url, platform: s.platform, size: s.size, note: s.note,
            dir: modelTargetDir(mo),
          });
        }
      }
    }
  }
  const favModels = [...modelMap.values()];
  const listHtml = favModels.map((it) => {
    const label = PLATFORM_LABELS[it.platform] || it.platform;
    const cls = "p-" + String(it.platform).replace(/[^a-z-]/g, "");
    const size = it.size ? `<span class="sz">${esc(it.size)}</span>` : "";
    const mirror = it.platform === "huggingface" ? hfMirror(it.url) : null;
    const mirrorLink = mirror ? `<a class="pm-mirror" href="${esc(mirror)}" target="_blank" rel="noopener">🔁 镜像</a>` : "";
    return `<li class="pm"><div class="pm-head"><a class="pm-name" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.modelName)}</a>${size}</div><div class="pm-meta"><span class="p ${cls}">${esc(label)}</span> · 类型 <span class="mtype">${esc(it.modelType)}</span> · 放置 <code>${esc(it.dir)}</code> · 来自 <span class="node">${esc(it.nodeName)}</span>${mirrorLink}${it.note ? `<span class="note">${esc(it.note)}</span>` : ""}</div></li>`;
  }).join("");

  container.innerHTML = `
    <section class="fav-summary">
      <div class="fav-actions">
        <button id="fav-export" class="btn-ghost">📤 导出我的清单</button>
        <button id="fav-clear" class="btn-ghost">🗑 清空收藏</button>
      </div>
      <div class="fav-cards">${cards}</div>
      <section class="wf-models-summary">
        <h3>📥 我的模型下载清单（${favModels.length} 个）</h3>
        <ul class="pm-list">${listHtml}</ul>
      </section>
    </section>`;
  document.getElementById("count").textContent = `⭐ 收藏 ${list.length} / ${ALL.length} 个节点`;
  bindCopyButtons();
  bindFavButtons();
  bindFavView();
}

function bindFavView() {
  const exportBtn = document.getElementById("fav-export");
  if (exportBtn) exportBtn.addEventListener("click", exportFav);
  const clearBtn = document.getElementById("fav-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (confirm("确定清空全部收藏？")) {
      FAVS.clear(); saveFavs(); render();
    }
  });
}

function exportFav() {
  const list = ALL.filter((m) => isFav(m.id));
  let txt = "ComfyUI Atlas - 我的收藏清单\n生成时间: " + new Date().toLocaleString() + "\n\n";
  txt += "== 节点（含安装命令）==\n";
  for (const m of list) {
    txt += `- ${m.name}\n  repo: ${m.repo}\n  git clone ${m.repo} ComfyUI/custom_nodes/${repoDir(m.repo)}\n`;
  }
  txt += "\n== 模型下载 ==\n";
  const modelMap = new Map();
  for (const m of list) {
    for (const mo of m.models || []) {
      for (const s of mo.sources || []) {
        const key = mo.name + "|" + s.url;
        if (!modelMap.has(key)) modelMap.set(key, { name: mo.name, type: mo.type, dir: modelTargetDir(mo), url: s.url, platform: s.platform, node: m.name, mirror: s.platform === "huggingface" ? hfMirror(s.url) : null });
      }
    }
  }
  for (const it of modelMap.values()) {
    txt += `- ${it.name} [${it.type}] 放置 ${it.dir}\n  平台: ${PLATFORM_LABELS[it.platform] || it.platform}\n  下载: ${it.url}\n`;
    if (it.mirror) txt += `  镜像: ${it.mirror}\n`;
  }
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "comfyui-atlas-favorites.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

const PLATFORM_VISIBLE = 10; // 按平台视图每列默认展示条数，其余滚动查看

function renderPlatforms() {
  const container = document.getElementById("modules");
  const empty = document.getElementById("empty");
  const groups = {};
  for (const m of ALL) {
    for (const mo of m.models || []) {
      if (filters.type && String(mo.type || "").toLowerCase() !== filters.type) continue;
      for (const s of mo.sources || []) {
        if (filters.text) {
          const hay = [mo.name, mo.type, m.name, s.url].join(" ").toLowerCase();
          if (!hay.includes(filters.text)) continue;
        }
        (groups[s.platform] = groups[s.platform] || []).push({
          modelName: mo.name, modelType: mo.type, nodeName: m.name,
          url: s.url, size: s.size, note: s.note, dir: modelTargetDir(mo),
        });
      }
    }
  }
  const platforms = Object.keys(groups).sort();
  if (!platforms.length) {
    container.innerHTML = "";
    empty.hidden = false;
    document.getElementById("count").textContent = "";
    return;
  }
  empty.hidden = true;
  let total = 0;
  const html = platforms.map((p) => {
    const label = PLATFORM_LABELS[p] || p;
    const cls = "p-" + String(p).replace(/[^a-z-]/g, "");
    const items = groups[p].map((it) => {
      total++;
      const size = it.size ? `<span class="sz">${esc(it.size)}</span>` : "";
      const note = it.note ? `<span class="note">${esc(it.note)}</span>` : "";
      const mirror = p === "huggingface" ? hfMirror(it.url) : null;
      const mirrorLink = mirror ? `<a class="pm-mirror" href="${esc(mirror)}" target="_blank" rel="noopener">🔁 镜像</a>` : "";
      return `<li class="pm">
        <div class="pm-head"><a class="pm-name" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.modelName)}</a>${size}</div>
        <div class="pm-meta"><span class="mtype">${esc(it.modelType)}</span> · 放置 <code>${esc(it.dir)}</code> · 来自 <span class="node">${esc(it.nodeName)}</span>${mirrorLink}${note}</div>
      </li>`;
    }).join("");
    const cnt = groups[p].length;
    const cntTip = cnt > PLATFORM_VISIBLE ? ` · 滚动查看全部` : "";
    return `<section class="platform-group">
      <h2 class="pg-title"><span class="p ${cls}">${esc(label)}</span><span class="pg-count">${cnt} 个模型${cntTip}</span></h2>
      <ul class="pm-list platform-list">${items}</ul>
    </section>`;
  }).join("");
  container.innerHTML = html;
  const typeTip = filters.type ? ` · 类型：${TYPE_LABELS[filters.type] || filters.type}` : "";
  document.getElementById("count").textContent = `按平台共 ${total} 个模型条目${typeTip}`;
  equalizePlatformLists(PLATFORM_VISIBLE);
}

// 五个平台列统一等高：统一 height = 各列「前 cap 条高度」的最大值，内容超出在列内滚动，不足则留白撑满
function equalizePlatformLists(cap) {
  const lists = [...document.querySelectorAll(".platform-group .platform-list")];
  if (!lists.length) return;
  let capH = 0;
  for (const list of lists) {
    const items = list.children;
    if (!items.length) continue;
    if (items.length <= cap) {
      capH = Math.max(capH, list.scrollHeight);
    } else {
      const firstTop = items[0].getBoundingClientRect().top;
      const nthBottom = items[cap - 1].getBoundingClientRect().bottom;
      capH = Math.max(capH, nthBottom - firstTop);
    }
  }
  if (!capH) return;
  capH += 8; // 余量：滚动条出现后内容区变窄可能引起个别条目换行
  for (const list of lists) {
    list.style.height = capH + "px"; // 固定高度：不足撑满留白、超出滚动，保证五列严格等高
    if (list.scrollHeight > capH + 1) list.classList.add("is-scroll");
  }
}

/* ============ 工作流分析器 ============ */

function repoDir(repo) {
  const m = String(repo || "").match(/github\.com\/[^/]+\/([^/#?]+)/i);
  return m ? m[1].replace(/\.git$/i, "") : "custom_nodes";
}

function findModuleForType(type) {
  const t = String(type || "").toLowerCase();
  if (!t) return null;
  if (NODE_MAP.coreNodes && NODE_MAP.coreNodes.some((c) => c.toLowerCase() === t)) return null;
  const custom = NODE_MAP.customNodes || [];
  for (const entry of custom) {
    if ((entry.match || []).some((m) => t.includes(m.toLowerCase()))) {
      return entry.moduleId;
    }
  }
  return "__unknown__";
}

// 官方注册表（ComfyUI-Manager 收录的全部自定义节点 -> 精确仓库），按需懒加载，避免拖累首屏
let REGISTRY = null;
let REGISTRY_PROMISE = null;
// 官方注册表加载后，构建「已知 ComfyUI 扩展仓库」集合（统一为 owner/repo 小写），用于反查核实 GitHub 搜索结果
let REGISTRY_REPO_SET = null;
function registryRepoSet() {
  if (REGISTRY_REPO_SET && REGISTRY_REPO_SET.size) return REGISTRY_REPO_SET;
  if (!REGISTRY || !REGISTRY.repos) return REGISTRY_REPO_SET || (REGISTRY_REPO_SET = new Set());
  REGISTRY_REPO_SET = new Set();
  for (const r of (REGISTRY.repos || [])) {
    const m = String(r).match(/github\.com\/([^\/#?]+)/i);
    if (m) REGISTRY_REPO_SET.add(m[1].toLowerCase().replace(/\.git$/i, ""));
  }
  return REGISTRY_REPO_SET;
}
function ensureRegistry() {
  if (REGISTRY) return Promise.resolve(REGISTRY);
  if (REGISTRY_PROMISE) return REGISTRY_PROMISE;
  REGISTRY_PROMISE = fetch("data/registry-nodes.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { REGISTRY = d; if (d) registryRepoSet(); return d; })
    .catch(() => null);
  return REGISTRY_PROMISE;
}
// 在官方注册表里按 class_type(小写) 精确命中仓库；命中 ComfyUI 主仓库的视为核心节点
// 返回 nodeCount：该仓库（父插件）共含多少个子节点，用于向用户说明“这是一个大插件里的子模块”
function findRegistry(type) {
  if (!REGISTRY || !REGISTRY.map) return null;
  const t = String(type || "").toLowerCase().trim();
  const hit = REGISTRY.map[t];
  if (!hit) return null;
  const repo = REGISTRY.repos[hit[0]];
  const title = REGISTRY.titles[hit[1]] || repo;
  if (/comfyanonymous\/ComfyUI(\b|\/|$)/i.test(repo)) return null;
  const nodeCount = (REGISTRY.repoNodeCount && REGISTRY.repoNodeCount[hit[0]]) || 0;
  return { repo, title, nodeCount };
}

// 第 4 级匹配：预置的 GitHub 高置信映射（离线脚本 scripts/github_resolve.py 生成）
let GH_EXTRA = null;
let GH_EXTRA_PROMISE = null;
function ensureGithubExtra() {
  if (GH_EXTRA) return Promise.resolve(GH_EXTRA);
  if (GH_EXTRA_PROMISE) return GH_EXTRA_PROMISE;
  GH_EXTRA_PROMISE = fetch("data/github-extra.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => { GH_EXTRA = d || {}; return GH_EXTRA; })
    .catch(() => { GH_EXTRA = {}; return GH_EXTRA; });
  return GH_EXTRA_PROMISE;
}

function extractNodeTypes(text) {
  const data = JSON.parse(text);
  const types = new Set();
  const pushType = (v) => { if (v) types.add(v); };
  if (data.nodes && Array.isArray(data.nodes)) {
    for (const n of data.nodes) if (n && n.type) pushType(n.type);
  } else if (data.nodes && typeof data.nodes === "object") {
    for (const k of Object.keys(data.nodes)) {
      const n = data.nodes[k];
      if (n && n.class_type) pushType(n.class_type);
    }
  }
  if (data.prompt && typeof data.prompt === "object") {
    for (const k of Object.keys(data.prompt)) {
      const n = data.prompt[k];
      if (n && n.class_type) pushType(n.class_type);
    }
  }
  return [...types];
}

function analyzeWorkflow(text) {
  const types = extractNodeTypes(text);
  const moduleIds = new Set();
  const unknownTypes = [];
  const registryMatched = [];
  const ghExtra = [];
  const coreTypes = [];
  let coreCount = 0;
  for (const t of types) {
    const r = findModuleForType(t);
    if (r === null) { coreCount++; coreTypes.push(t); }
    else if (r === "__unknown__") {
      const reg = findRegistry(t);
      if (reg) registryMatched.push({ type: t, repo: reg.repo, title: reg.title, nodeCount: reg.nodeCount });
      else {
        const ex = GH_EXTRA && GH_EXTRA[String(t).toLowerCase()];
        if (ex) ghExtra.push({ type: t, repo: ex.repo, confidence: ex.confidence, reason: ex.reason, stars: ex.stars });
        else unknownTypes.push(t);
      }
    }
    else moduleIds.add(r);
  }
  const modulesHit = [...moduleIds].map((id) => ALL.find((m) => m.id === id)).filter(Boolean);
  const modelMap = new Map();
  for (const m of modulesHit) {
    for (const mo of m.models || []) {
      for (const s of mo.sources || []) {
        const key = mo.name + "|" + s.url;
        if (!modelMap.has(key)) {
          modelMap.set(key, {
            modelName: mo.name, modelType: mo.type, nodeName: m.name,
            url: s.url, platform: s.platform, size: s.size, note: s.note,
            dir: modelTargetDir(mo),
          });
        }
      }
    }
  }
  return { total: types.length, hit: modulesHit, unknownTypes, registryMatched, ghExtra, coreCount, coreTypes, models: [...modelMap.values()] };
}

function renderWorkflow(r) {
  const resultEl = document.getElementById("wf-result");
  if (!r.total) {
    resultEl.innerHTML = '<p class="empty">未从该 JSON 中识别到任何节点。请确认文件是 ComfyUI 工作流（顶层含 nodes / prompt）。</p>';
    return;
  }

  const hitCards = r.hit.map((m) => {
    const models = (m.models || []).map(modelSourcesHTML).join("");
    const modelBlock = (m.models && m.models.length)
      ? `<div class="wf-models">${models}</div>`
      : `<div class="wf-models wf-empty-models">纯逻辑节点，无需额外模型</div>`;
    const dir = repoDir(m.repo);
    const cloneCmd = `git clone ${m.repo} ComfyUI/custom_nodes/${dir}`;
    const cmCmd = `cm-cli install ${m.repo}`;
    return `<article class="card wf-card">
      ${favStar(m)}
      <h3>${esc(m.name)}</h3>
      <div class="meta-row"><span class="chip cat">${esc(m.category || "其他")}</span>${m.official ? '<span class="chip">官方</span>' : ""}${m.author ? `<span class="chip">@${esc(m.author)}</span>` : ""}</div>
      <div class="wf-install">
        <div class="wf-cmd"><code>${esc(cloneCmd)}</code><button class="copy" data-copy="${esc(cloneCmd)}">复制</button></div>
        <div class="wf-cmd"><code>${esc(cmCmd)}</code><button class="copy" data-copy="${esc(cmCmd)}">复制</button></div>
      </div>
      <div class="repo"><a href="${esc(m.repo)}" target="_blank" rel="noopener">${esc(m.repo)}</a></div>
      ${modelBlock}
    </article>`;
  }).join("");

  const registryHtml = r.registryMatched.length
    ? `<details class="wf-registry" open>
        <summary>🔎 ${r.registryMatched.length} 个节点已定位到官方仓库（ComfyUI-Manager 收录，精确匹配）</summary>
        <p class="wf-tip">⚠️ 注意：ComfyUI 的很多「节点」其实只是某个<strong>大插件里的一个子模块</strong>。下方仓库是官方注册表按节点类名<strong>精确对应</strong>的「父插件」——你只要<strong>安装整个父插件</strong>（点「复制 clone」或打开仓库），该节点自然就包含在内，<strong>不要</strong>去搜一个以该子节点命名的独立仓库（多半不存在或不是真源）。含节点数较多的仓库即为典型的大插件。顶部输入框可按节点名筛选。</p>
        <input type="search" id="wf-registry-search" class="wf-unknown-search" placeholder="在本列表中按节点名筛选…" autocomplete="off" />
        <ul class="wf-unknown-list" id="wf-registry-list">${r.registryMatched.map((x) => {
          const isRepo = /^https?:\/\/github\.com\/[^\/]+\/[^\/#?]+$/i.test(x.repo);
          const dir = isRepo ? repoDir(x.repo) : "";
          const clone = isRepo ? `git clone ${x.repo} ComfyUI/custom_nodes/${dir}` : "";
          const cloneBtn = isRepo ? `<button class="copy" data-copy="${esc(clone)}">复制 clone</button>` : `<span class="wf-file-only" title="单文件/非标准仓库，请直接打开查看">📄 文件</span>`;
          const parentBadge = x.nodeCount >= 20
            ? `<span class="conf parent" title="这是一个大插件，本节点只是其中 ${x.nodeCount} 个子节点之一">🧩 父插件·含 ${x.nodeCount} 节点</span>`
            : `<span class="conf ok" title="已在官方注册表精确命中">✅ 精确</span>`;
          return `<li><span class="wf-reg-type"><code>${esc(x.type)}</code></span>${parentBadge}<a class="wf-unknown-link" href="${esc(x.repo)}" target="_blank" rel="noopener"><span class="ext">↗ 打开</span></a>${cloneBtn}</li>`;
        }).join("")}</ul>
      </details>`
    : "";

  const ghHtml = (r.ghExtra && r.ghExtra.length)
    ? `<details class="wf-gh" open>
        <summary>🔎 ${r.ghExtra.length} 个节点通过 GitHub 匹配到仓库（建议核实后安装）</summary>
        <p class="wf-tip">这些节点在本站与官方注册表中都未收录，已通过 GitHub 仓库名/描述与节点类名的重合度匹配到可能仓库。🔒 <strong>可信</strong>＝已在官方 ComfyUI-Manager 注册表核实，可直接安装；🤔 <strong>推测</strong>＝仅按名模糊匹配、未在官方注册表核实，可能只是同名/相关仓库（很多节点其实是大插件的子模块，请先打开仓库确认是否含该节点，再决定是否安装整个父插件）。</p>
        <ul class="wf-unknown-list">${r.ghExtra.map((x) => {
          const isRepo = /^https?:\/\/github\.com\/[^\/]+\/[^\/#?]+$/i.test(x.repo);
          const dir = isRepo ? repoDir(x.repo) : "";
          const clone = isRepo ? `git clone ${x.repo} ComfyUI/custom_nodes/${dir}` : "";
          const badge = ghConfBadge(x);
          const cloneBtn = isRepo
            ? `<button class="copy" data-copy="${esc(clone)}">复制 clone</button>`
            : `<span class="wf-file-only" title="单文件/非标准仓库，请直接打开查看">📄 文件</span>`;
          return `<li><code>${esc(x.type)}</code> ${badge} <a class="wf-unknown-link" href="${esc(x.repo)}" target="_blank" rel="noopener"><span class="ext">↗ 打开</span></a>${cloneBtn}<div class="wf-reason">${esc(x.reason || "")}${x.stars != null ? " · ⭐" + x.stars : ""}</div></li>`;
        }).join("")}</ul>
      </details>`
    : "";

  const unknownHtml = r.unknownTypes.length
    ? `<details class="wf-unknown" open>
        <summary>⚠️ ${r.unknownTypes.length} 个节点未找到对应仓库（可调用 GitHub API 自动补全）</summary>
        <p class="wf-tip">这些节点类名既不在本站收录库，也不在 ComfyUI-Manager 官方注册表中（可能是非常见/本地/已废弃节点）。点击下方「用 GitHub API 补全」按钮，会自动按节点名在 GitHub 搜索并给出置信度；也可直接点节点名手动搜索。<strong>提示：很多节点只是大插件的子模块，若 GitHub 给出的是「推测」结果，请先打开仓库确认是否真的包含该节点，再安装整个父插件。</strong></p>
        <input type="search" id="wf-unknown-search" class="wf-unknown-search" placeholder="在本列表中按节点名筛选…" autocomplete="off" />
        <ul class="wf-unknown-list" id="wf-unknown-list">${r.unknownTypes.map((t) => {
          const gh = "https://github.com/search?q=" + encodeURIComponent(t + " ComfyUI") + "&type=repositories";
          const inManager = "https://www.google.com/search?q=" + encodeURIComponent("ComfyUI " + t + " custom node manager");
          return `<li data-type="${esc(t)}"><a class="wf-unknown-link" href="${gh}" target="_blank" rel="noopener"><code>${esc(t)}</code><span class="ext">↗ GitHub</span></a><a class="wf-unknown-alt" href="${inManager}" target="_blank" rel="noopener" title="备用：Google 搜索">🌐</a></li>`;
        }).join("")}</ul>
        <button id="wf-gh-autofill" class="btn-ghost wf-autofill">🔍 用 GitHub API 自动补全剩余 ${r.unknownTypes.length} 个（按置信度）</button>
      </details>`
    : "";

  const coreHtml = (r.coreTypes && r.coreTypes.length)
    ? `<details class="wf-core">
        <summary>🧱 ${r.coreTypes.length} 个 ComfyUI 核心原生节点（已内置，无需安装）</summary>
        <p class="wf-tip">以下节点属于 ComfyUI 自带功能，安装 ComfyUI 即具备，<strong>不需要</strong>额外下载节点包。展开可核对具体类名。</p>
        <ul class="wf-unknown-list">${r.coreTypes.map((t) => `<li><code>${esc(t)}</code></li>`).join("")}</ul>
      </details>`
    : "";

  // 国内镜像下载指引（仅 HF 源）
  const mirrorModels = r.models.filter((it) => it.platform === "huggingface" && it.url);
  const mirrorHtml = mirrorModels.length
    ? `<details class="wf-mirror-guide">
        <summary>📥 国内镜像下载（hf-mirror，共 ${mirrorModels.length} 个 HF 模型）</summary>
        <p class="wf-tip">下方为对应 hf-mirror.com 镜像链接，国内访问更快。把模型下载后放入对应 <code>models/</code> 目录即可。</p>
        <ul class="pm-list">${mirrorModels.map((it) => {
          const m = hfMirror(it.url);
          return `<li class="pm"><div class="pm-head"><a class="pm-name" href="${esc(m)}" target="_blank" rel="noopener">${esc(it.modelName)}</a></div><div class="pm-meta">放置 <code>${esc(it.dir)}</code> · <a href="${esc(m)}" target="_blank" rel="noopener">🔁 hf-mirror 镜像</a></div></li>`;
        }).join("")}</ul>
      </details>`
    : "";

  const modelsHtml = r.models.length
    ? `<section class="wf-models-summary">
        <h3>📦 所需模型汇总（${r.models.length} 个，已去重）</h3>
        <ul class="pm-list">${r.models.map((it) => {
          const label = PLATFORM_LABELS[it.platform] || it.platform;
          const cls = "p-" + String(it.platform).replace(/[^a-z-]/g, "");
          const size = it.size ? `<span class="sz">${esc(it.size)}</span>` : "";
          const note = it.note ? `<span class="note">${esc(it.note)}</span>` : "";
          const mirror = it.platform === "huggingface" ? hfMirror(it.url) : null;
          const mirrorLink = mirror ? `<a class="pm-mirror" href="${esc(mirror)}" target="_blank" rel="noopener">🔁 镜像</a>` : "";
          return `<li class="pm"><div class="pm-head"><a class="pm-name" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.modelName)}</a>${size}</div><div class="pm-meta"><span class="p ${cls}">${esc(label)}</span> · 类型 <span class="mtype">${esc(it.modelType)}</span> · 放置 <code>${esc(it.dir)}</code> · 来自 <span class="node">${esc(it.nodeName)}</span>${mirrorLink}${note}</div></li>`;
        }).join("")}</ul>
      </section>`
    : "";

  resultEl.innerHTML = `
    <div class="wf-summary">
      <div class="stat"><span class="num">${r.total}</span><span class="lbl">节点总数</span></div>
      <div class="stat"><span class="num">${r.hit.length}</span><span class="lbl">命中本站节点</span></div>
      <div class="stat"><span class="num">${r.registryMatched.length}</span><span class="lbl">已定位仓库</span></div>
      <div class="stat"><span class="num">${r.unknownTypes.length}</span><span class="lbl">未找到仓库</span></div>
      <div class="stat"><span class="num">${r.coreCount}</span><span class="lbl">核心原生节点</span></div>
    </div>
    ${r.hit.length
      ? `<h3 class="wf-hit-title">✅ 需安装 / 已收录的自定义节点（${r.hit.length}）</h3><div class="wf-cards">${hitCards}</div>`
      : `<p class="empty">未识别到已收录的自定义节点。可能该工作流仅使用 ComfyUI 原生节点。</p>`}
    ${modelsHtml}
    ${mirrorHtml}
    ${coreHtml}
    ${registryHtml}
    ${ghHtml}
    ${unknownHtml}
    <p class="wf-note">💡 工作流通常还需<strong>基础底模</strong>（SDXL / FLUX / SD1.5 等）与可能的 <strong>LoRA / 放大模型</strong>，请到「按节点」视图的「基础模型 / 放大修复 / LoRA 精选」分类下载并放入 ComfyUI 对应 <code>models/</code> 目录。</p>
  `;
  bindTypeListFilter("wf-registry-search", "wf-registry-list");
  bindTypeListFilter("wf-unknown-search", "wf-unknown-list");
  bindGithubAutofill(r);
  bindCopyButtons();
  bindFavButtons();
}

function bindFavButtons() {
  document.querySelectorAll(".fav-star").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      toggleFav(id);
      btn.classList.toggle("on", isFav(id));
      btn.textContent = isFav(id) ? "★" : "☆";
      btn.title = isFav(id) ? "取消收藏" : "收藏";
      if (currentView === "fav") render();
    });
  });
}

function bindTypeListFilter(searchId, listId) {
  const input = document.getElementById(searchId);
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll("#" + listId + " li").forEach((li) => {
      const name = (li.textContent || "").toLowerCase();
      li.hidden = !!q && !name.includes(q);
    });
    const visible = [...document.querySelectorAll("#" + listId + " li")].filter((li) => !li.hidden).length;
    const summary = input.closest("details") && input.closest("details").querySelector("summary");
    let counter = document.getElementById(searchId + "-count");
    if (!counter && summary) {
      counter = document.createElement("span");
      counter.id = searchId + "-count";
      counter.className = "wf-unknown-count";
      summary.appendChild(counter);
    }
    if (counter) counter.textContent = q ? `（匹配 ${visible} 个）` : "";
  });
}

/* ============ 第 4 级：运行时按需调用 GitHub 搜索补全未知节点 ============ */

function ghCache() {
  try { return JSON.parse(localStorage.getItem("comfyui-atlas-ghsearch") || "{}"); }
  catch (_) { return {}; }
}
function ghCacheSet(type, val) {
  const c = ghCache(); c[type] = val;
  try { localStorage.setItem("comfyui-atlas-ghsearch", JSON.stringify(c)); } catch (_) {}
}

// 按「仓库名/描述/话题 与节点类名的重合度」给候选仓库打分
function scoreGithub(type, items) {
  const t = String(type || "").toLowerCase();
  const tc = t.replace(/[^a-z0-9]/g, "");
  const known = registryRepoSet();
  let best = null;
  for (const it of (items || [])) {
    const full = (it.full_name || "").toLowerCase().replace(/\.git$/i, "");
    const name = (it.name || "").toLowerCase();
    // 去除常见前缀/后缀，便于“仓库名 vs 节点类名”比对
    const rn = name.replace(/comfyui/g, "").replace(/nodes?/g, "").replace(/[^a-z0-9]/g, "");
    const desc = (it.description || "").toLowerCase();
    const topics = ((it.topics || []).join(" ")).toLowerCase();
    let conf = 0, reason = "", speculative = true;
    if (tc && rn && (rn === tc || rn.startsWith(tc) || tc.startsWith(rn)
        || (tc.length >= 5 && tc.includes(rn)) || (rn.length >= 5 && rn.includes(tc)))) {
      conf = rn === tc ? 0.95 : 0.90;
      reason = "仓库名与节点类名高度吻合";
    } else if (tc && (desc.includes(tc) || topics.includes(tc))) {
      conf = 0.60; reason = "仓库描述/话题提及该节点";
    } else if (full.includes("comfyui")) {
      conf = 0.50; reason = "ComfyUI 相关仓库（需人工确认）";
    }
    if (conf) {
      // 反查官方注册表：命中已知扩展则提升为“可信”，否则视匹配强度标“推测”
      if (known.has(full)) {
        speculative = false;
        conf = Math.max(conf, 0.82);
        reason = "已收录于官方 ComfyUI-Manager 注册表，可信";
      } else if (conf < 0.60) {
        reason += "（未在官方注册表核实，可能只是同名/相关仓库，请人工确认）";
      }
      if (!best || conf > best.confidence) {
        best = { repo: it.html_url, full_name: it.full_name, stars: it.stargazers_count, confidence: conf, reason, speculative };
      }
    }
  }
  return best;
}

// 统一置信度徽章：可信（注册表核实/高置信）/ 中置信 / 推测（未核实）
function ghConfBadge(x) {
  if (x.speculative) {
    return `<span class="conf spec">🤔 ${Math.round((x.confidence || 0) * 100)}% 推测</span>`;
  }
  if (x.confidence >= 0.85) {
    return `<span class="conf high">🔒 ${Math.round(x.confidence * 100)}% 可信</span>`;
  }
  return `<span class="conf mid">⚠️ ${Math.round(x.confidence * 100)}%</span>`;
}

async function githubSearchType(type) {
  const c = ghCache();
  if (c[type]) return c[type];
  const url = "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(type + " ComfyUI") + "&sort=stars&order=desc&per_page=5";
  let res;
  try {
    const r = await fetch(url, { headers: { "Accept": "application/vnd.github+json" } });
    if (!r.ok) res = { type, status: r.status };
    else {
      const d = await r.json();
      const b = scoreGithub(type, d.items || []);
      res = b ? { type, ...b } : { type, none: true };
    }
  } catch (e) {
    res = { type, error: String(e) };
  }
  ghCacheSet(type, res);
  return res;
}

function updateUnknownLi(type, res) {
  let li = null;
  document.querySelectorAll("#wf-unknown-list li").forEach((el) => { if (el.dataset.type === type) li = el; });
  if (!li) return;
  if (res.none || !res.repo) {
    li.innerHTML = `<code>${esc(type)}</code> <span class="conf low">无高置信仓库</span> ` +
      `<a class="wf-unknown-link" href="https://github.com/search?q=${encodeURIComponent(type + " ComfyUI")}&type=repositories" target="_blank" rel="noopener"><span class="ext">↗ 手动搜</span></a>`;
    li.classList.add("resolved");
    return;
  }
  const isRepo = /^https?:\/\/github\.com\/[^\/]+\/[^\/#?]+$/i.test(res.repo);
  const dir = isRepo ? repoDir(res.repo) : "";
  const clone = isRepo ? `git clone ${res.repo} ComfyUI/custom_nodes/${dir}` : "";
  const badge = ghConfBadge(res);
  const cloneBtn = isRepo
    ? `<button class="copy" data-copy="${esc(clone)}">复制 clone</button>`
    : `<span class="wf-file-only">📄 文件</span>`;
  li.innerHTML = `<code>${esc(type)}</code> ${badge} ` +
    `<a class="wf-unknown-link" href="${esc(res.repo)}" target="_blank" rel="noopener"><span class="ext">↗ 打开</span></a>${cloneBtn}` +
    `<div class="wf-reason">${esc(res.reason || "")}${res.stars != null ? " · ⭐" + res.stars : ""}</div>`;
  li.classList.add("resolved");
  bindCopyButtons();
}

function bindGithubAutofill(result) {
  const btn = document.getElementById("wf-gh-autofill");
  if (!btn) return;
  // 先把本地已有的查询结果（上次搜索/预置缓存）直接反映到列表
  const cache = ghCache();
  for (const t of (result.unknownTypes || [])) {
    if (cache[t]) updateUnknownLi(t, cache[t]);
  }
  btn.addEventListener("click", async () => {
    const types = (result.unknownTypes || []).filter((t) => !ghCache()[t]);
    const total = types.length;
    if (!total) { btn.textContent = "已全部查询过 ✓"; return; }
    btn.disabled = true;
    let done = 0;
    for (const t of types) {
      btn.textContent = `正在查询 GitHub… ${done}/${total}（${t}）`;
      const res = await githubSearchType(t);
      updateUnknownLi(t, res);
      done++;
      if (done < total) await new Promise((r) => setTimeout(r, 6500)); // 未登录 10/min 节流
    }
    btn.textContent = `✅ 已补全 ${total} 个（无高置信的请手动搜索）`;
    btn.disabled = false;
  });
}

function bindCopyButtons() {
  document.querySelectorAll(".copy").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const text = btn.dataset.copy || "";
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (_) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
        document.body.removeChild(ta);
      }
      const old = btn.textContent;
      btn.textContent = ok ? "已复制 ✓" : "复制失败";
      btn.classList.toggle("copied", ok);
      setTimeout(() => { btn.textContent = old; btn.classList.remove("copied"); }, 1300);
    });
  });
}

function bindWorkflowUI() {
  const fileInput = document.getElementById("wf-file");
  const textArea = document.getElementById("wf-text");
  const analyzeBtn = document.getElementById("wf-analyze");
  const clearBtn = document.getElementById("wf-clear");
  const errEl = document.getElementById("wf-error");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      textArea.value = text;
      errEl.hidden = true;
    } catch (e) {
      errEl.hidden = false;
      errEl.textContent = "读取文件失败：" + e.message;
    }
  });

  analyzeBtn.addEventListener("click", async () => {
    const text = textArea.value.trim();
    errEl.hidden = true;
    if (!text) {
      errEl.hidden = false;
      errEl.textContent = "请先选择或粘贴一个工作流 .json 文件。";
      return;
    }
    const btn = analyzeBtn;
    const original = btn.innerHTML;
    btn.classList.add("is-loading");
    btn.disabled = true;
    btn.innerHTML = "分析中…";
    try {
      // 先让浏览器渲染出旋转状态，再开始加载大文件/解析
      await new Promise((r) => setTimeout(r, 30));
      try { await ensureRegistry(); } catch (_) {}
      try { await ensureGithubExtra(); } catch (_) {}
      let result;
      try {
        result = analyzeWorkflow(text);
      } catch (e) {
        errEl.hidden = false;
        errEl.textContent = "JSON 解析失败：" + e.message + "。请确认内容是正确的 ComfyUI 工作流 JSON。";
        document.getElementById("wf-result").innerHTML = "";
        return;
      }
      renderWorkflow(result);
    } finally {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    textArea.value = "";
    errEl.hidden = true;
    document.getElementById("wf-result").innerHTML = "";
  });
}

init();
