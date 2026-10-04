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
    const res = await fetch("data/modules.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    ALL = Array.isArray(data.modules) ? data.modules : [];
  } catch (e) {
    container.innerHTML =
      '<p class="empty">数据加载失败：' + esc(e.message) +
      "。请通过本地服务器预览（python3 -m http.server），不要直接以 file:// 打开。</p>";
    return;
  }
  renderStats();
  populateFilters();
  bindControls();
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
      document.querySelector(".controls").classList.toggle("view-platforms", currentView === "platforms");
      render();
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

init();
