"use strict";

/* ========= 配置 ========= */
const SORT_FIELD = {
  uses: "uses",
  downloads: "downloads",
  likes: "likes",
  collects: "collects",
  latest: "publishedAt",
};

const state = {
  q: "",
  sort: "uses",
  tag: "",
};

let DATA = [];
let META = {};

/* ========= 工具函数 ========= */
function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "w";
  return n.toLocaleString("zh-CN");
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getStat(item, field) {
  if (field === "publishedAt") return item.publishedAt || "";
  const s = item.stats || {};
  return Number(s[field]) || 0;
}

/* ========= 数据加载 ========= */
async function load() {
  try {
    const res = await fetch("data/workflows.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    DATA = Array.isArray(json.items) ? json.items : [];
    META = json;
    renderHeader();
    buildTagOptions();
    render();
  } catch (err) {
    document.getElementById("grid").innerHTML =
      '<p class="empty">加载数据失败：' + esc(err.message) + "</p>";
    console.error(err);
  }
}

function renderHeader() {
  const total = Number(META.platformTotal) || 0;
  const indexed = Number(META.count) || DATA.length;
  document.getElementById("stat-total").textContent = total
    ? total.toLocaleString("zh-CN")
    : "–";
  document.getElementById("stat-indexed").textContent = indexed
    ? indexed.toLocaleString("zh-CN")
    : "–";
  document.getElementById("stat-source").textContent = META.source || "–";

  const pct =
    total && indexed ? ((indexed / total) * 100).toFixed(1) : null;
  document.getElementById("note").innerHTML =
    "数据更新于 " +
    esc(fmtDate(META.updatedAt)) +
    (pct ? "，已收录约 " + pct + "% 的平台工作流" : "") +
    '。来源平台：<a href="' +
    esc(META.sourceUrl || "#") +
    '" target="_blank" rel="noopener">' +
    esc(META.source || "RunningHub") +
    "</a>（因网络限制，当前仅索引该平台公开工作流）。";
}

function buildTagOptions() {
  const counts = new Map();
  for (const item of DATA) {
    const tags = item.tags || [];
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .filter(([, c]) => c >= 5) // 至少出现 5 次才进入筛选
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([t]) => t);

  const sel = document.getElementById("filter-tag");
  const opts = ['<option value="">全部标签</option>'];
  for (const t of sorted) {
    opts.push(`<option value="${esc(t)}">${esc(t)}</option>`);
  }
  sel.innerHTML = opts.join("");
}

/* ========= 渲染 ========= */
function matches(item) {
  if (state.tag) {
    const tags = item.tags || [];
    if (!tags.includes(state.tag)) return false;
  }
  if (state.q) {
    const hay = [
      item.name,
      item.author,
      item.description,
      (item.tags || []).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function sortItems(list) {
  const field = SORT_FIELD[state.sort] || "uses";
  const copy = list.slice();
  if (field === "publishedAt") {
    copy.sort(
      (a, b) =>
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
    );
  } else {
    copy.sort((a, b) => getStat(b, field) - getStat(a, field));
  }
  return copy;
}

function cardHTML(item) {
  const s = item.stats || {};
  const img = item.image
    ? `<a class="thumb-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">
         <img class="thumb" src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="thumb-fallback" style="display:none">🖼️ 暂无预览图</div>
       </a>`
    : `<div class="thumb-fallback">🖼️ 暂无预览图</div>`;

  const author = item.author
    ? `<div class="author">${
        item.authorAvatar
          ? `<img src="${esc(item.authorAvatar)}" alt="" loading="lazy"
                onerror="this.style.display='none';" />`
          : ""
      }<span>${esc(item.author)}</span></div>`
    : "";

  const badges = [
    `<span class="badge">使用 <b>${fmtNum(s.uses)}</b></span>`,
    `<span class="badge">下载 <b>${fmtNum(s.downloads)}</b></span>`,
    `<span class="badge">赞 <b>${fmtNum(s.likes)}</b></span>`,
    `<span class="badge">收藏 <b>${fmtNum(s.collects)}</b></span>`,
  ].join("");

  const tags = (item.tags || [])
    .slice(0, 6)
    .map(
      (t) =>
        `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`
    )
    .join("");

  return `
    <article class="wf-card">
      ${img}
      <div class="body">
        <h2>${esc(item.name)}</h2>
        ${author}
        <div class="badges">${badges}</div>
        <div class="date">发布于 ${esc(fmtDate(item.publishedAt))}</div>
        <div class="tags">${tags}</div>
        <a class="open" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">打开来源 →</a>
      </div>
    </article>`;
}

function render() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const countEl = document.getElementById("count");

  let list = DATA.filter(matches);
  list = sortItems(list);

  countEl.textContent = `共 ${list.length.toLocaleString("zh-CN")} 个`;

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = list.map(cardHTML).join("");

  // 标签点击 → 联动筛选
  grid.querySelectorAll(".tags .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const t = chip.getAttribute("data-tag");
      state.tag = t;
      document.getElementById("filter-tag").value = t;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ========= 事件 ========= */
function bindEvents() {
  let timer = null;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => {
      state.q = v;
      render();
    }, 180);
  });

  document.getElementById("filter-tag").addEventListener("change", (e) => {
    state.tag = e.target.value;
    render();
  });

  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  window.addEventListener("scroll", () => {}, { passive: true });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  load();
});
