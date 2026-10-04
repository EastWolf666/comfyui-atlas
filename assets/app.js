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

let ALL = [];
let NODE_MAP = { coreNodes: [], customNodes: [] };
let currentView = "nodes";
const filters = { text: "", category: "", platform: "", status: "" };

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      const isBrowse = currentView === "nodes" || currentView === "platforms";
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

function cardHTML(m) {
  const status = m.maintenance || "unknown";
  const tags = (m.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join("");
  const models = (m.models || []).map((mo) => {
    const sources = (mo.sources || []).map((s) => {
      const label = PLATFORM_LABELS[s.platform] || s.platform;
      const cls = "p-" + String(s.platform).replace(/[^a-z-]/g, "");
      const size = s.size ? `<span class="sz">${esc(s.size)}</span>` : "";
      return `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="p ${cls}">${esc(label)}</span>${size}</a>`;
    }).join("");
    return `<div class="model">
        <div><span class="mname">${esc(mo.name)}</span><span class="mtype">${esc(mo.type)}</span></div>
        <div class="sources">${sources}</div>
      </div>`;
  }).join("");

  const modelBlock = (m.models && m.models.length)
    ? `<div class="models"><h3>所需模型 (${m.models.length})</h3>${models}</div>`
    : `<div class="models empty-models">纯逻辑节点，无需额外模型文件</div>`;

  return `<article class="card">
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
    ${modelBlock}
  </article>`;
}

function render() {
  if (currentView === "platforms") { renderPlatforms(); return; }
  renderNodes();
}

function renderNodes() {
  const list = ALL.filter(matches);
  const container = document.getElementById("modules");
  const empty = document.getElementById("empty");
  container.innerHTML = list.map(cardHTML).join("");
  empty.hidden = list.length !== 0;
  document.getElementById("count").textContent = `显示 ${list.length} / ${ALL.length} 个节点`;
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
          url: s.url, size: s.size, note: s.note,
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
      return `<li class="pm">
        <div class="pm-head"><a class="pm-name" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.modelName)}</a>${size}</div>
        <div class="pm-meta"><span class="mtype">${esc(it.modelType)}</span> · 来自 <span class="node">${esc(it.nodeName)}</span>${note}</div>
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

function extractNodeTypes(text) {
  const data = JSON.parse(text);
  const types = new Set();
  const pushType = (v) => { if (v) types.add(v); };
  // UI 默认保存格式：nodes 为数组，含 type 字段
  if (data.nodes && Array.isArray(data.nodes)) {
    for (const n of data.nodes) if (n && n.type) pushType(n.type);
  } else if (data.nodes && typeof data.nodes === "object") {
    // API 格式：nodes 为对象 map，含 class_type 字段
    for (const k of Object.keys(data.nodes)) {
      const n = data.nodes[k];
      if (n && n.class_type) pushType(n.class_type);
    }
  }
  // 老 API 格式：prompt 为对象 map，含 class_type
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
  let coreCount = 0;
  for (const t of types) {
    const r = findModuleForType(t);
    if (r === null) coreCount++;
    else if (r === "__unknown__") unknownTypes.push(t);
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
          });
        }
      }
    }
  }
  return { total: types.length, hit: modulesHit, unknownTypes, coreCount, models: [...modelMap.values()] };
}

function renderWorkflow(r) {
  const resultEl = document.getElementById("wf-result");
  if (!r.total) {
    resultEl.innerHTML = '<p class="empty">未从该 JSON 中识别到任何节点。请确认文件是 ComfyUI 工作流（顶层含 nodes / prompt）。</p>';
    return;
  }

  const hitCards = r.hit.map((m) => {
    const models = (m.models || []).map((mo) => {
      const sources = (mo.sources || []).map((s) => {
        const label = PLATFORM_LABELS[s.platform] || s.platform;
        const cls = "p-" + String(s.platform).replace(/[^a-z-]/g, "");
        const size = s.size ? `<span class="sz">${esc(s.size)}</span>` : "";
        return `<a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="p ${cls}">${esc(label)}</span>${size}</a>`;
      }).join("");
      return `<div class="model"><div><span class="mname">${esc(mo.name)}</span><span class="mtype">${esc(mo.type)}</span></div><div class="sources">${sources}</div></div>`;
    }).join("");
    const modelBlock = (m.models && m.models.length)
      ? `<div class="wf-models">${models}</div>`
      : `<div class="wf-models wf-empty-models">纯逻辑节点，无需额外模型</div>`;
    const dir = repoDir(m.repo);
    const cloneCmd = `git clone ${m.repo} ComfyUI/custom_nodes/${dir}`;
    const cmCmd = `cm-cli install ${m.repo}`;
    return `<article class="card wf-card">
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

  const unknownHtml = r.unknownTypes.length
    ? `<details class="wf-unknown" open>
        <summary>⚠️ ${r.unknownTypes.length} 个未收录的自定义节点（点击节点名可在 GitHub 搜索安装）</summary>
        <p class="wf-tip">这些节点类名不在本站收录库中。点击下方任一节点名即可在 GitHub 按该 ComfyUI 自定义节点名搜索仓库并安装；也可用上方输入框在列表中快速筛选。</p>
        <input type="search" id="wf-unknown-search" class="wf-unknown-search" placeholder="在本列表中按节点名筛选…" autocomplete="off" />
        <ul class="wf-unknown-list" id="wf-unknown-list">${r.unknownTypes.map((t) => {
          const gh = "https://github.com/search?q=" + encodeURIComponent(t + " ComfyUI") + "&type=repositories";
          const inManager = "https://www.google.com/search?q=" + encodeURIComponent("ComfyUI " + t + " custom node manager");
          return `<li><a class="wf-unknown-link" href="${gh}" target="_blank" rel="noopener"><code>${esc(t)}</code><span class="ext">↗ GitHub</span></a><a class="wf-unknown-alt" href="${inManager}" target="_blank" rel="noopener" title="备用：Google 搜索">🌐</a></li>`;
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
          return `<li class="pm"><div class="pm-head"><a class="pm-name" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.modelName)}</a>${size}</div><div class="pm-meta"><span class="p ${cls}">${esc(label)}</span> · 类型 <span class="mtype">${esc(it.modelType)}</span> · 来自 <span class="node">${esc(it.nodeName)}</span>${note}</div></li>`;
        }).join("")}</ul>
      </section>`
    : "";

  resultEl.innerHTML = `
    <div class="wf-summary">
      <div class="stat"><span class="num">${r.total}</span><span class="lbl">节点总数</span></div>
      <div class="stat"><span class="num">${r.hit.length}</span><span class="lbl">命中本站节点</span></div>
      <div class="stat"><span class="num">${r.unknownTypes.length}</span><span class="lbl">未收录自定义</span></div>
      <div class="stat"><span class="num">${r.coreCount}</span><span class="lbl">核心原生节点</span></div>
    </div>
    ${r.hit.length
      ? `<h3 class="wf-hit-title">✅ 需安装 / 已收录的自定义节点（${r.hit.length}）</h3><div class="wf-cards">${hitCards}</div>`
      : `<p class="empty">未识别到已收录的自定义节点。可能该工作流仅使用 ComfyUI 原生节点。</p>`}
    ${modelsHtml}
    ${unknownHtml}
    <p class="wf-note">💡 工作流通常还需<strong>基础底模</strong>（SDXL / FLUX / SD1.5 等）与可能的 <strong>LoRA / 放大模型</strong>，请到「按节点」视图的「基础模型 / 放大修复 / LoRA 精选」分类下载并放入 ComfyUI 对应 <code>models/</code> 目录。</p>
  `;
  bindUnknownFilter();
  bindCopyButtons();
}

function bindUnknownFilter() {
  const input = document.getElementById("wf-unknown-search");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll("#wf-unknown-list li").forEach((li) => {
      const name = (li.textContent || "").toLowerCase();
      li.hidden = !!q && !name.includes(q);
    });
    const visible = [...document.querySelectorAll("#wf-unknown-list li")].filter((li) => !li.hidden).length;
    const counter = document.getElementById("wf-unknown-count");
    if (counter) counter.textContent = q ? `（匹配 ${visible} 个）` : "";
  });
  // 显示匹配计数
  const summary = document.querySelector(".wf-unknown > summary");
  if (summary && !document.getElementById("wf-unknown-count")) {
    const span = document.createElement("span");
    span.id = "wf-unknown-count";
    span.className = "wf-unknown-count";
    summary.appendChild(span);
  }
}

function bindCopyButtons() {
  document.querySelectorAll("#wf-result .copy").forEach((btn) => {
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

  analyzeBtn.addEventListener("click", () => {
    const text = textArea.value.trim();
    errEl.hidden = true;
    if (!text) {
      errEl.hidden = false;
      errEl.textContent = "请先选择或粘贴一个工作流 .json 文件。";
      return;
    }
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
