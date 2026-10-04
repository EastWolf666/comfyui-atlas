"use strict";

/* ========= 配置 ========= */
const SORT_FIELD = {
  uses: "uses",
  downloads: "downloads",
  likes: "likes",
  collects: "collects",
  latest: "publishedAt",
};
const PAGE_SIZE = 48; // 每次渲染的卡片数（增量渲染，避免一次塞爆 DOM）

const state = {
  q: "",
  sort: "uses",
  tag: "",
};

let DATA = [];
let META = {};
let filtered = []; // 当前筛选+排序后的完整列表
let rendered = 0;  // 已渲染到 DOM 的数量

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

/* ========= 数据加载（gzip 优先 + 原生解压） ========= */
async function gunzipIfNeeded(buf) {
  // 兼容两种情况：服务器直接给 gzip 字节（0x1f8b），或已自动解压
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

async function fetchData() {
  // 优先请求 .gz（体积约为原始 1/4），失败或不支持则回退普通 JSON
  if (typeof DecompressionStream === "function") {
    try {
      const gzRes = await fetch("data/workflows.json.gz", { cache: "no-store" });
      if (gzRes.ok) {
        const buf = await gzRes.arrayBuffer();
        return JSON.parse(await gunzipIfNeeded(buf));
      }
    } catch (e) {
      console.warn("gz 加载失败，回退普通 JSON：", e);
    }
  }
  const res = await fetch("data/workflows.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function load() {
  try {
    const json = await fetchData();
    DATA = Array.isArray(json.items) ? json.items : [];
    META = json;
    renderHeader();
    buildTagOptions();
    applyFilter();
  } catch (err) {
    document.getElementById("grid").innerHTML =
      '<div class="loading-wrap"><p>加载数据失败：' +
      esc(err.message) +
      "。请通过本地服务器预览，不要以 file:// 打开。</p></div>";
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

  const pct = total && indexed ? ((indexed / total) * 100).toFixed(1) : null;
  document.getElementById("note").innerHTML =
    "数据更新于 " +
    esc(fmtDate(META.updatedAt)) +
    (pct ? "，已收录约 " + pct + "% 的平台工作流" : "") +
    '。来源平台：<a href="' +
    esc(META.sourceUrl || "#") +
    '" target="_blank" rel="noopener">' +
    esc(META.source || "RunningHub") +
    "</a>（数据已 gzip 压缩传输，页面采用增量渲染以加快加载）。";
}

function buildTagOptions() {
  const counts = new Map();
  for (const item of DATA) {
    for (const t of item.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const sorted = [...counts.entries()]
    .filter(([, c]) => c >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([t]) => t);
  const sel = document.getElementById("filter-tag");
  sel.innerHTML =
    '<option value="">全部标签</option>' +
    sorted.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
}

/* ========= 筛选与排序 ========= */
function matches(item) {
  if (state.tag) {
    const tags = item.tags || [];
    if (!tags.includes(state.tag)) return false;
  }
  if (state.q) {
    const hay = [item.name, item.author, item.description, (item.tags || []).join(" ")]
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
    copy.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  } else {
    copy.sort((a, b) => getStat(b, field) - getStat(a, field));
  }
  return copy;
}

/* ========= 渲染（增量） ========= */
function cardHTML(item) {
  const s = item.stats || {};
  const img = item.image
    ? `<a class="thumb-link" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">
         <img class="thumb" src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" decoding="async"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="thumb-fallback" style="display:none">🖼️ 暂无预览图</div>
       </a>`
    : `<div class="thumb-fallback">🖼️ 暂无预览图</div>`;

  const author = item.author
    ? `<div class="author">${
        item.authorAvatar
          ? `<img src="${esc(item.authorAvatar)}" alt="" loading="lazy" decoding="async"
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
    .map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`)
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

function bindChips(scope) {
  scope.querySelectorAll(".tags .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const t = chip.getAttribute("data-tag");
      state.tag = t;
      document.getElementById("filter-tag").value = t;
      applyFilter();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function updateCount() {
  document.getElementById("count").textContent =
    filtered.length === 0
      ? "共 0 个"
      : `已显示 ${rendered} / 共 ${filtered.length.toLocaleString("zh-CN")} 个`;
}

function updateLoadMore() {
  const btn = document.getElementById("loadmore");
  const info = document.getElementById("loadmore-info");
  const more = rendered < filtered.length;
  btn.hidden = !more;
  if (more) {
    info.textContent = `还有 ${(filtered.length - rendered).toLocaleString("zh-CN")} 个未显示`;
  } else {
    info.textContent = filtered.length ? "已显示全部" : "";
  }
}

function renderMore() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.hidden = false;
    updateCount();
    updateLoadMore();
    return;
  }
  empty.hidden = true;
  const slice = filtered.slice(rendered, rendered + PAGE_SIZE);
  const html = slice.map(cardHTML).join("");
  if (rendered === 0) {
    grid.innerHTML = html; // 首批：覆盖掉加载 spinner
  } else {
    grid.insertAdjacentHTML("beforeend", html); // 后续：仅追加新卡片
  }
  rendered += slice.length;
  bindChips(grid);
  updateCount();
  updateLoadMore();
}

function applyFilter() {
  filtered = sortItems(DATA.filter(matches));
  rendered = 0;
  document.getElementById("grid").innerHTML = "";
  renderMore();
}

/* ========= 事件 ========= */
let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    if (rendered < filtered.length) {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
      if (nearBottom) renderMore();
    }
  });
}

function bindEvents() {
  let timer = null;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => {
      state.q = v;
      applyFilter();
    }, 180);
  });

  document.getElementById("filter-tag").addEventListener("change", (e) => {
    state.tag = e.target.value;
    applyFilter();
  });

  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFilter();
  });

  document.getElementById("loadmore").addEventListener("click", renderMore);
  window.addEventListener("scroll", onScroll, { passive: true });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  load();
});
