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
let loadingShard = false; // 任一分片正在加载中（并发守卫）

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

function setLoadError(err) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML =
    '<div class="loading-wrap"><p>😢 加载失败：' + esc(err.message) + "</p>" +
    '<p class="sub">请检查网络后重试，或下拉刷新页面</p></div>';
  console.error(err);
}

/* ========= 数据加载（分片 + 超时重试） ========= */
/* 注意：超时必须覆盖「读取响应体」全过程。
   AbortController 只在 fetch 未完成时有效；一旦响应头到达，fetch() 即 resolve，
   后续 arrayBuffer() 的慢速读取不受 abort 保护，会造成 Promise 永久悬挂。 */
function fetchBytes(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 20000);
  return fetch(url, { signal: ctl.signal })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer(); // 仍在 abort 保护范围内
    })
    .finally(() => clearTimeout(t));
}

async function loadManifest() {
  let lastErr;
  // 优先读预压缩的清单（榜单内联后清单较大，gzip 可省 80%）
  const urls = ["data/wf-manifest.json.gz", "data/wf-manifest.json"];
  for (let i = 0; i < 2; i++) {
    for (const url of urls) {
      try {
        const buf = await fetchBytes(url, 20000);
        return JSON.parse(await gunzipText(buf));
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw lastErr;
}

async function loadShard(name, skip) {
  const buf = await fetchBytes("data/" + name, 30000);
  let arr = JSON.parse(await gunzipText(buf));
  if (skip > 0) arr = arr.slice(skip); // 去掉与内联预览重复的条目
  POOL.push(...arr);
  nextShard++;
}

/* 首片加载失败时的降级：预览条目仍可用，只是不能继续向下翻页 */
function degradeGracefully(err) {
  console.warn("首片加载失败，已降级为仅预览模式：", err);
  const info = document.getElementById("loadmore-info");
  if (!info) return;
  const btn = document.getElementById("loadmore");
  if (btn) btn.hidden = true; // 避免"加载更多"反复失败
  info.classList.add("is-degraded");
  info.innerHTML =
    "预览已加载，但完整数据拉取失败（网络较慢）。" +
    '<button id="loadmore-retry" class="btn-mini" type="button">重试</button>';
  const retry = document.getElementById("loadmore-retry");
  if (retry) {
    retry.addEventListener("click", () => {
      nextShard = 0;
      loadingShard = false;
      info.classList.remove("is-degraded");
      info.textContent = "";
      init();
    });
  }
}

async function ensureAllLoaded() {
  if (allLoaded || !MANIFEST) return;
  // 等当前分片加载完，避免并发（设上限防死等）
  let waited = 0;
  while (loadingShard && waited < 35000) {
    await new Promise((r) => setTimeout(r, 100));
    waited += 100;
  }
  const total = MANIFEST.shards.length;
  loadingShard = true;
  try {
    while (nextShard < total) {
      setBusy(true, `正在加载全部数据（${nextShard + 1}/${total}）以支持搜索 / 排序…`);
      await loadShard(MANIFEST.shards[nextShard]);
    }
    allLoaded = true;
  } catch (e) {
    setLoadError(e);
  } finally {
    setBusy(false);
    loadingShard = false;
  }
}

/* ========= 是否需要全量数据 ========= */
/* 仅"搜索 / 标签筛选 / 下载量"需要全量数据。
   点赞 / 收藏 / 最新 有内联榜单（manifest.rank），无需等全部分片。 */
const RANK_DIM = { uses: "u", likes: "l", collects: "c", latest: "latest" };
function needsAllData() {
  return !!(state.q || state.tag || !RANK_DIM[state.sort]);
}
function hasRank(srt) {
  const dim = RANK_DIM[srt];
  return !!(dim && MANIFEST && MANIFEST.rank && (MANIFEST.rank[dim] || []).length);
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
  if (s === "latest") copy.sort((a, b) => String(b.t || "").localeCompare(String(a.t || "")));
  else {
    const k = { uses: "u", downloads: "d", likes: "l", collects: "c" }[s] || "u";
    copy.sort((a, b) => ((b.s || {})[k] || 0) - ((a.s || {})[k] || 0));
  }
  return copy;
}

/* 用清单内联榜单即时排序：无需等待全部分片加载完毕。
   榜单之外的条目在数据池里出现后，会由 recomputeFiltered() 归并补入。 */
function rankQuickView() {
  const dim = RANK_DIM[state.sort];
  if (!dim || !MANIFEST || !MANIFEST.rankItems) return null;
  const byId = new Map();
  for (const it of MANIFEST.rankItems) byId.set(it.i, it);
  const ordered = [];
  for (const id of MANIFEST.rank[dim] || []) {
    const it = byId.get(id);
    if (it && matches(it)) ordered.push(it);
  }
  return ordered;
}

function recomputeFiltered() {
  const inPool = sortItems(POOL.filter(matches));
  const dim = RANK_DIM[state.sort];
  if (!allLoaded && dim && MANIFEST && MANIFEST.rank && (MANIFEST.rank[dim] || []).length) {
    // 未加载完：以内联榜单打底，池内其余条目按序追加其后
    const quick = rankQuickView();
    if (quick && quick.length) {
      const rankIds = new Set(quick.map((x) => x.i));
      const poolById = new Map(POOL.map((it) => [it.i, it]));
      // 榜单条目优先用池内版本（统计值可能比构建时更新）
      const head = quick.map((it) => poolById.get(it.i) || it);
      // 池内不在榜单里的条目，按当前排序补到后面
      const tail = inPool.filter((it) => !rankIds.has(it.i));
      filtered = sortItems(head.concat(tail));
      return;
    }
  }
  filtered = inPool;
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
  // 注：平台 downloadCount / pv 恒返回 0，不展示，避免"下载 0"误导
  const badges = [
    `<span class="badge">使用 <b>${fmtNum(s.u)}</b></span>`,
    `<span class="badge">点赞 <b>${fmtNum(s.l)}</b></span>`,
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
    applyFilter();
    return;
  }
  // 有内联榜单：立即出结果，全量数据后台补齐后自动刷新
  applyFilter();
  if (!allLoaded) backgroundFill();
}

/* 后台补齐全部分片（不阻塞交互）。数据到位后按当前视图重新排序渲染。 */
let filling = false;
async function backgroundFill() {
  if (filling || allLoaded) return;
  filling = true;
  setBusy(true, `正在补全剩余数据（${nextShard + 1}/${MANIFEST.shards.length}）…`);
  try {
    while (nextShard < MANIFEST.shards.length) {
      await loadShard(MANIFEST.shards[nextShard]);
      recomputeFiltered();
      renderMore(); // 逐步追加，滚动位置不跳
    }
    allLoaded = true;
    recomputeFiltered();
    applyFilter(); // 补齐后按全局重排，保证排序完全准确
  } catch (e) {
    setLoadError(e);
  } finally {
    setBusy(false);
    filling = false;
  }
}

/* 加载更多：先渲染已加载池，池耗尽再拉下一分片 */
async function loadMore() {
  if (loadingShard || allLoaded || nextShard >= MANIFEST.shards.length) return;
  if (rendered < filtered.length) {
    renderMore();
    return;
  }
  loadingShard = true;
  setBusy(true, `正在加载更多数据（${nextShard + 1}/${MANIFEST.shards.length}）…`);
  try {
    await loadShard(MANIFEST.shards[nextShard]);
    recomputeFiltered();
    renderMore();
  } catch (e) {
    setLoadError(e);
  } finally {
    setBusy(false);
    loadingShard = false;
  }
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
  loadingShard = true; // 屏蔽并发：首片加载完成前不响应滚动/加载更多
  try {
    MANIFEST = await loadManifest();
    renderHeader();

    // 1) 先用清单内联的预览条目立即渲染首屏（无需等分片）
    const pv = MANIFEST.preview || [];
    if (pv.length) {
      POOL = pv.slice();
      buildTagOptions();
      applyFilter();
    }

    // 2) 后台补全首片（跳过已在预览里的条目），供滚动继续加载
    let degraded = false;
    try {
      await loadShard(MANIFEST.shards[0], pv.length);
    } catch (e) {
      degraded = true; // 首片失败不阻断已渲染的预览
      degradeGracefully(e);
    }
    buildTagOptions();
    if (rendered === 0) applyFilter();
    else if (!degraded) { recomputeFiltered(); renderMore(); } // 降级时勿覆盖提示文案
  } catch (err) {
    setLoadError(err);
  } finally {
    loadingShard = false;
  }
}

/* ========= 事件 ========= */
let scrollTicking = false;
function onScroll() {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    scrollTicking = false;
    if (loadingShard || allLoaded) return; // 正在加载时不再触发，避免并发
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
