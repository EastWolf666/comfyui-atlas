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
const filters = { text: "", category: "", platform: "", status: "" };
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
  const platSel = document.getElementById("filter-platform");
  const plats = uniqueValues((m) => (m.models || []).flatMap((mo) => (mo.sources || []).map((s) => s.platform)));
  for (const p of plats) {
    platSel.add(new Option(PLATFORM_LABELS[p] || p, p));
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
  document.getElementById("filter-platform").addEventListener("change", (e) => {
    filters.platform = e.target.value; render();
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
        render();
      }
    });
  });
}

function matches(m) {
  if (filters.category && m.category !== filters.category) return false;
  if (filters.status && (m.maintenance || "unknown") !== filters.status) return false;
  if (filters.platform) {
    const has = (m.models || []).some((mo) =>
      (mo.sources || []).some((s) => s.platform === filters.platform)
    );
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

function renderPlatforms() {
  const container = document.getElementById("modules");
  const empty = document.getElementById("empty");
  const groups = {};
  for (const m of ALL) {
    for (const mo of m.models || []) {
      for (const s of mo.sources || []) {
        if (filters.platform && s.platform !== filters.platform) continue;
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
    return `<section class="platform-group">
      <h2 class="pg-title"><span class="p ${cls}">${esc(label)}</span><span class="pg-count">${groups[p].length} 个模型</span></h2>
      <ul class="pm-list">${items}</ul>
    </section>`;
  }).join("");
  container.innerHTML = html;
  document.getElementById("count").textContent = `按平台共 ${total} 个模型条目`;
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
function ensureRegistry() {
  if (REGISTRY) return Promise.resolve(REGISTRY);
  if (REGISTRY_PROMISE) return REGISTRY_PROMISE;
  REGISTRY_PROMISE = fetch("data/registry-nodes.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { REGISTRY = d; return d; })
    .catch(() => null);
  return REGISTRY_PROMISE;
}
// 在官方注册表里按 class_type(小写) 精确命中仓库；命中 ComfyUI 主仓库的视为核心节点
function findRegistry(type) {
  if (!REGISTRY || !REGISTRY.map) return null;
  const t = String(type || "").toLowerCase().trim();
  const hit = REGISTRY.map[t];
  if (!hit) return null;
  const repo = REGISTRY.repos[hit[0]];
  const title = REGISTRY.titles[hit[1]] || repo;
  if (/comfyanonymous\/ComfyUI(\b|\/|$)/i.test(repo)) return null;
  return { repo, title };
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
  const coreTypes = [];
  let coreCount = 0;
  for (const t of types) {
    const r = findModuleForType(t);
    if (r === null) { coreCount++; coreTypes.push(t); }
    else if (r === "__unknown__") {
      const reg = findRegistry(t);
      if (reg) registryMatched.push({ type: t, repo: reg.repo, title: reg.title });
      else unknownTypes.push(t);
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
  return { total: types.length, hit: modulesHit, unknownTypes, registryMatched, coreCount, coreTypes, models: [...modelMap.values()] };
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
        <summary>🔎 ${r.registryMatched.length} 个节点已定位到官方仓库（ComfyUI-Manager 收录，本站未收录模型信息）</summary>
        <p class="wf-tip">这些自定义节点已通过 ComfyUI-Manager 官方注册表精确匹配到 GitHub 仓库，可点击直达安装；但由于本站尚未收录其模型信息，相关模型请到「按节点 / 基础模型」等分类补充下载。顶部输入框可按节点名筛选。</p>
        <input type="search" id="wf-registry-search" class="wf-unknown-search" placeholder="在本列表中按节点名筛选…" autocomplete="off" />
        <ul class="wf-unknown-list" id="wf-registry-list">${r.registryMatched.map((x) => {
          const isRepo = /^https?:\/\/github\.com\/[^\/]+\/[^\/#?]+$/i.test(x.repo);
          const dir = isRepo ? repoDir(x.repo) : "";
          const clone = isRepo ? `git clone ${x.repo} ComfyUI/custom_nodes/${dir}` : "";
          const cloneBtn = isRepo ? `<button class="copy" data-copy="${esc(clone)}">复制 clone</button>` : `<span class="wf-file-only" title="单文件/非标准仓库，请直接打开查看">📄 文件</span>`;
          return `<li><span class="wf-reg-type"><code>${esc(x.type)}</code></span><a class="wf-unknown-link" href="${esc(x.repo)}" target="_blank" rel="noopener"><span class="ext">↗ 打开</span></a>${cloneBtn}</li>`;
        }).join("")}</ul>
      </details>`
    : "";

  const unknownHtml = r.unknownTypes.length
    ? `<details class="wf-unknown" open>
        <summary>⚠️ ${r.unknownTypes.length} 个节点未找到对应仓库（建议在 GitHub 搜索安装）</summary>
        <p class="wf-tip">这些节点类名既不在本站收录库，也不在 ComfyUI-Manager 官方注册表中（可能是非常见/本地/已废弃节点）。点击下方任一节点名即可在 GitHub 按该 ComfyUI 自定义节点名搜索仓库并安装；顶部输入框可按节点名筛选。</p>
        <input type="search" id="wf-unknown-search" class="wf-unknown-search" placeholder="在本列表中按节点名筛选…" autocomplete="off" />
        <ul class="wf-unknown-list" id="wf-unknown-list">${r.unknownTypes.map((t) => {
          const gh = "https://github.com/search?q=" + encodeURIComponent(t + " ComfyUI") + "&type=repositories";
          const inManager = "https://www.google.com/search?q=" + encodeURIComponent("ComfyUI " + t + " custom node manager");
          return `<li><a class="wf-unknown-link" href="${gh}" target="_blank" rel="noopener"><code>${esc(t)}</code><span class="ext">↗ GitHub</span></a><a class="wf-unknown-alt" href="${inManager}" target="_blank" rel="noopener" title="备用：Google 搜索">🌐</a></li>`;
        }).join("")}</ul>
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
    ${unknownHtml}
    <p class="wf-note">💡 工作流通常还需<strong>基础底模</strong>（SDXL / FLUX / SD1.5 等）与可能的 <strong>LoRA / 放大模型</strong>，请到「按节点」视图的「基础模型 / 放大修复 / LoRA 精选」分类下载并放入 ComfyUI 对应 <code>models/</code> 目录。</p>
  `;
  bindTypeListFilter("wf-registry-search", "wf-registry-list");
  bindTypeListFilter("wf-unknown-search", "wf-unknown-list");
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
    try { await ensureRegistry(); } catch (_) {}
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
  });

  clearBtn.addEventListener("click", () => {
    fileInput.value = "";
    textArea.value = "";
    errEl.hidden = true;
    document.getElementById("wf-result").innerHTML = "";
  });
}

init();
