"use strict";

/* ========= 分片加载配置 ========= */
const PAGE_SIZE = 48; // 每次追加渲染的卡片数

const state = { q: "", sort: "uses", tag: "" };

let MANIFEST = null;
let POOL = [];      // 已加载到内存的工作流（分片按热度排序，故天然有序）
let nextShard = 0;  // 下一个待加载分片下标
let allLoaded = false;
let filtered = [];  // 当前筛选+排序后的视图
let rendered = 0;   // 已渲染到 DOM 的数量

/* ========= 工具 ========= */
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function sourceUrlOf(it) {
  return (MANIFEST && MANIFEST.postBase ? MANIFEST.postBase : "https://www.runninghub.cn/post/") + it.i;
}

/* ========= gzip 解压 ========= */
async function gunzipText(buf) {
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(bytes);
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

/* ========= 忙碌指示 ========= */
function setBusy(on, text) {
  const b = document.getElementById("busy");
  if (!b) return;
  b.hidden = !on;
  if (text) document.getElementById("busy-text").textContent = text;
}

/* ========= 数据加载（分片） ========= */
async function loadManifest() {
  const res = await fetch("data/wf-manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error("清单加载失败 HTTP " + res.status);
  return res.json();
}

async function loadShard(name) {
  const res = await fetch("data/" + name, { cache: "no-store" });
  if (!res.ok) throw new Error("分片 " + name + " 加载失败 HTTP " + res.status);
  const buf = await res.arrayBuffer();
  const arr = JSON.parse(await gunzipText(buf));
  POOL.push(...arr);
  nextShard++;
}

async function ensureAllLoaded() {
  if (allLoaded || !MANIFEST) return;
  const total = MANIFEST.shards.length;
  while (nextShard < total) {
    setBusy(true, `正在加载全部数据（${nextShard + 1}/${total}）以支持搜索 / 排序…`);
    await loadShard(MANIFEST.shards[nextShard]);
  }
  allLoaded = true;
  setBusy(false);
}

/* ========= 是否需要全量数据 ========= */
function needsAllData() {
  return !!(state.q || state.tag || state.sort !== "uses");
}

/* ========= 筛选与排序（短键） ========= */
function matches(it) {
  if (state.tag && !(it.g || []).includes(state.tag)) return false;
  if (state.q) {
    const hay = [it.n, it.a, it.d, (it.g || []).join(" ")].join(" ").toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}
function sortItems(list) {
  const copy = list.slice();
  const s = state.sort;
  if (s === "latest") copy.sort((a, b) => new Date(b.t || 0) - new Date(a.t || 0));
  else {
    const k = { uses: "u", downloads: "d", likes: "l", collects: "c" }[s] || "u";
    copy.sort((a, b) => ((b.s || {})[k] || 0) - ((a.s || {})[k] || 0));
  }
  return copy;
}
function recomputeFiltered() {
  filtered = sortItems(POOL.filter(matches));
}

/* ========= 渲染 ========= */
function avatarHTML(name) {
  const ch = (name || "?").trim().charAt(0) || "?";
  const hue = hashCode(name || "?") % 360;
  return `<span class="avatar-init" style="background:hsl(${hue} 42% 30%);color:hsl(${hue} 85% 80%)">${esc(ch)}</span>`;
}

function cardHTML(it) {
  const src = sourceUrlOf(it);
  const img = it.im
    ? `<a class="thumb-link" href="${esc(src)}" target="_blank" rel="noopener">
         <img class="thumb" src="${esc(it.im)}" alt="${esc(it.n)}" loading="lazy" decoding="async"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="thumb-fallback" style="display:none">🖼️ 暂无预览图</div>
       </a>`
    : `<div class="thumb-fallback">🖼️ 暂无预览图</div>`;

  const author = it.a ? `<div class="author">${avatarHTML(it.a)}<span>${esc(it.a)}</span></div>` : "";
  const s = it.s || {};
  const badges = [
    `<span class="badge">使用 <b>${fmtNum(s.u)}</b></span>`,
    `<span class="badge">下载 <b>${fmtNum(s.d)}</b></span>`,
    `<span class="badge">赞 <b>${fmtNum(s.l)}</b></span>`,
    `<span class="badge">收藏 <b>${fmtNum(s.c)}</b></span>`,
  ].join("");
  const tags = (it.g || []).slice(0, 6).map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("");

  return `
    <article class="wf-card">
      ${img}
      <div class="body">
        <h2>${esc(it.n)}</h2>
        ${author}
        <div class="badges">${badges}</div>
        <div class="date">发布于 ${esc(fmtDate(it.t))}</div>
        <div class="tags">${tags}</div>
        <a class="open" href="${esc(src)}" target="_blank" rel="noopener">打开来源 →</a>
      </div>
    </article>`;
}

function bindChips(scope) {
  scope.querySelectorAll(".tags .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.tag = chip.getAttribute("data-tag");
      document.getElementById("filter-tag").value = state.tag;
      refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function updateCount() {
  const total = (MANIFEST && MANIFEST.count) || POOL.length;
  document.getElementById("count").textContent = `已显示 ${rendered} / 共 ${total.toLocaleString("zh-CN")} 个`;
}

function updateLoadMore() {
  const btn = document.getElementById("loadmore");
  const info = document.getElementById("loadmore-info");
  const total = (MANIFEST && MANIFEST.count) || 0;
  const loaded = POOL.length;
  const canLoadMoreShard = !allLoaded && nextShard < (MANIFEST ? MANIFEST.shards.length : 0);
  const hasMoreToRender = rendered < filtered.length;
  const show = hasMoreToRender || canLoadMoreShard;
  btn.hidden = !show;
  if (show) {
    const inPool = Math.max(0, filtered.length - rendered);
    info.textContent = canLoadMoreShard
      ? `已加载 ${loaded.toLocaleString("zh-CN")}/${total.toLocaleString("zh-CN")} 条，滚动继续加载`
      : `还有 ${inPool.toLocaleString("zh-CN")} 个未显示`;
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
  if (rendered === 0) grid.innerHTML = html;
  else grid.insertAdjacentHTML("beforeend", html);
  rendered += slice.length;
  bindChips(grid);
  updateCount();
  updateLoadMore();
}

function applyFilter() {
  recomputeFiltered();
  rendered = 0;
  document.getElementById("grid").innerHTML = "";
  renderMore();
}

/* 刷新入口：需要全量数据时先加载全部分片 */
async function refresh() {
  if (needsAllData() && !allLoaded) {
    await ensureAllLoaded();
  }
  applyFilter();
}

/* 加载更多：先渲染已加载池，池耗尽再拉下一分片 */
let shardLoading = false;
async function loadMore() {
  if (rendered < filtered.length) {
    renderMore();
    return;
  }
  if (shardLoading || allLoaded || nextShard >= MANIFEST.shards.length) return;
  shardLoading = true;
  setBusy(true, `正在加载更多数据（${nextShard + 1}/${MANIFEST.shards.length}）…`);
  try {
    await loadShard(MANIFEST.shards[nextShard]);
  } catch (e) {
    setBusy(false);
    alert("加载失败：" + e.message);
    shardLoading = false;
    return;
  }
  setBusy(false);
  shardLoading = false;
  recomputeFiltered();
  renderMore();
}

/* ========= 头部 ========= */
function renderHeader() {
  const total = Number(MANIFEST.platformTotal) || 0;
  const indexed = Number(MANIFEST.count) || 0;
  document.getElementById("stat-total").textContent = total ? total.toLocaleString("zh-CN") : "–";
  document.getElementById("stat-indexed").textContent = indexed ? indexed.toLocaleString("zh-CN") : "–";
  document.getElementById("stat-source").textContent = MANIFEST.source || "–";
  const pct = total && indexed ? ((indexed / total) * 100).toFixed(1) : null;
  document.getElementById("note").innerHTML =
    "数据更新于 " + esc(fmtDate(MANIFEST.updatedAt)) +
    (pct ? "，已收录约 " + pct + "% 的平台工作流" : "") +
    '。来源：<a href="' + esc(MANIFEST.sourceUrl || "#") + '" target="_blank" rel="noopener">' + esc(MANIFEST.source || "") + "</a>" +
    "。已按热度分片、gzip 传输，首屏仅加载最热一片，滚动/搜索时按需加载。";
}

function buildTagOptions() {
  // 标签统计需全量数据，这里从已加载的池累积（首片已含绝大多数高频标签）
  const counts = new Map();
  for (const it of POOL) for (const t of it.g || []) counts.set(t, (counts.get(t) || 0) + 1);
  const sel = document.getElementById("filter-tag");
  const prev = sel.value;
  const top = [...counts.entries()].filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t]) => t);
  sel.innerHTML = '<option value="">全部标签</option>' + top.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  sel.value = prev;
}

/* ========= 启动 ========= */
async function init() {
  try {
    MANIFEST = await loadManifest();
    renderHeader();
    // 首屏只加载最热的一片
    await loadShard(MANIFEST.shards[0]);
    buildTagOptions();
    applyFilter();
  } catch (err) {
    document.getElementById("grid").innerHTML =
      '<div class="loading-wrap"><p>加载失败：' + esc(err.message) + "</p></div>";
    console.error(err);
  }
}

/* ========= 事件 ========= */
let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 800;
    if (!nearBottom) return;
    // 先渲染已加载池的剩余，池耗尽再自动拉取下一分片
    if (rendered < filtered.length) renderMore();
    else loadMore();
  });
}

function bindEvents() {
  let timer = null;
  document.getElementById("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim().toLowerCase();
    timer = setTimeout(() => {
      state.q = v;
      refresh();
    }, 250);
  });
  document.getElementById("filter-tag").addEventListener("change", (e) => {
    state.tag = e.target.value;
    refresh();
  });
  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    refresh();
  });
  document.getElementById("loadmore").addEventListener("click", loadMore);
  window.addEventListener("scroll", onScroll, { passive: true });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  init();
});
