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

/* ========= 筛选状态反馈 ========= */
/* 三层提示，解决"点了筛选不知道有没有反应"：
   1) 搜索框内嵌转圈        —— 输入/下拉改变后立即出现，即时反馈
   2) 筛选状态条            —— 明确说明"正在筛选"以及为什么（要加载数据）
   3) 结果计数的高亮忙碌态  —— 提示计数正在重算，而非停留在旧值
   筛选完成后三者一起消失。 */
let filterToken = 0; // 令牌：丢弃过期筛选的收尾回调，避免快速输入时状态错乱

function setFilterUI(on, text) {
  const spin = document.getElementById("search-spin");
  const bar = document.getElementById("filter-status");
  const txt = document.getElementById("filter-status-text");
  const cnt = document.getElementById("count");
  const wrap = document.querySelector(".ctl-search");
  if (spin) spin.hidden = !on;
  // is-busy：筛选中隐藏原生"清除 ×"，避免与转圈重叠（空闲时恢复，保留快速清空）
  if (wrap) wrap.classList.toggle("is-busy", !!on);
  if (bar) {
    bar.hidden = !on;
    if (!bar.hidden && text) txt.textContent = text;
  }
  if (cnt) cnt.classList.toggle("is-busy", !!on);
}

/* 分片加载阶段：把状态条文案换成实时进度（比静态"首次约需数秒"更有用，
   让用户知道还剩多少、是不是卡住了）。 */
function setFilterProgress(text) {
  const bar = document.getElementById("filter-status");
  const spin = document.getElementById("search-spin");
  const cnt = document.getElementById("count");
  if (bar) bar.hidden = false;
  if (spin) spin.hidden = false;
  if (cnt) cnt.classList.add("is-busy");
  const txt = document.getElementById("filter-status-text");
  if (txt && text) txt.textContent = text;
}

/* 正在筛选的文案：有搜索词/标签时说清在筛什么，需要加载数据时说明原因。
   窄屏（≤560px）改用精简版：完整说明太长会挤成两行还带省略号，
   反而把关键信息藏起来。 */
function filterStatusText(loading) {
  const parts = [];
  // 关键词可能很长，超长会撑爆状态条，截断并加省略号
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  if (state.q) parts.push(`关键词「${clip(state.q, 24)}」`);
  if (state.tag) parts.push(`标签「${clip(state.tag, 12)}」`);
  const scope = parts.length ? parts.join(" + ") : "全部数据";
  const narrow = window.matchMedia("(max-width: 560px)").matches;
  if (loading) {
    return narrow
      ? `正在筛选 ${scope}…（需加载全部数据）`
      : `正在筛选 ${scope} — 需加载全部 ${MANIFEST ? MANIFEST.shards.length : "?"} 个数据分片，首次筛选约需数秒…`;
  }
  return `正在筛选 ${scope}…`;
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
    /* 并发批量加载：原先逐片 await 串行，线上实测 300 秒只加载到 19/29 片
       （约 7~8 分钟才能筛完，用户等不起）。HTTP/1.1 下同源并发 4 路可显著
       提速，又不会像几十路并发那样被 CDN 限流或挤爆连接。
       注意：只并发"取字节"这一步，解压/入池/计数仍复用 loadShard 串行执行，
       以严格保持其副作用（preview 去重切片、nextShard 推进）不被破坏。 */
    const CONC = 4;
    while (nextShard < total) {
      const names = [];
      for (let i = 0; i < CONC && nextShard + i < total; i++) {
        names.push(MANIFEST.shards[nextShard + i]);
      }
      setBusy(true, `正在加载全部数据（${nextShard + 1}/${total}）以支持搜索 / 排序…`);
      setFilterProgress(`正在加载数据（${nextShard + 1}/${total} 个分片）以完成筛选…`);
      // 单片失败不应中断整体：记录后继续，保证尽可能多数据可用
      const bufs = await Promise.allSettled(
        names.map((n) => fetchBytes("data/" + n, 30000)));
      for (let i = 0; i < bufs.length; i++) {
        if (bufs[i].status === "rejected") {
          console.warn("分片加载失败", names[i], bufs[i].reason);
          // 失败也要推进，避免在同一片上无限重试；代价是永久缺失该片，
          // 但这比整条筛选路径卡死要好（且下次刷新页面会重新尝试）
          nextShard++;
          continue;
        }
        try {
          let arr = JSON.parse(await gunzipText(bufs[i].value));
          // 首片前 pv.length 条与内联 preview 重复（init 已用 skip 加载过首片，
          // 走到这里的分片都无需再跳）
          POOL.push(...arr);
          nextShard++;
        } catch (e) {
          console.warn("分片解析失败", names[i], e);
          nextShard++;
        }
      }
    }
    allLoaded = true;
  } catch (e) {
    setLoadError(e);
  } finally {
    setBusy(false);
    setFilterUI(false);
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
  const cnt = document.getElementById("count");
  if (!cnt) return;
  const total = (MANIFEST && MANIFEST.count) || POOL.length;
  const filtering = !!(state.q || state.tag);
  // 筛选态下分母应是"匹配数"而不是全库总数：
  // 筛选后仍显示"共 85,871 个"会让人以为筛选没生效。
  if (filtering) {
    const hit = filtered.length;
    cnt.textContent = allLoaded
      ? `匹配 ${hit.toLocaleString("zh-CN")} 个（已显示 ${rendered}）`
      : `匹配 ${hit.toLocaleString("zh-CN")} 个 · 筛选中…`;
    return;
  }
  // 非筛选态：分母随数据加载进度递增，并区分"库内已有"与"全库总量"
  cnt.textContent = allLoaded
    ? `共 ${total.toLocaleString("zh-CN")} 个（已显示 ${rendered}）`
    : `已显示 ${rendered} / ${POOL.length.toLocaleString("zh-CN")}（已加载）`;
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
    // 无结果文案带上当前条件，让用户知道"筛过了、确实没有"而不是页面坏了。
    // allLoaded 为 false 时说明数据还没加载完，文案要相应区分。
    const cond = [];
    if (state.q) cond.push(`关键词「${state.q}」`);
    if (state.tag) cond.push(`标签「${state.tag}」`);
    const scope = cond.length ? cond.join(" + ") : "当前条件";
    empty.textContent = allLoaded
      ? (cond.length
          ? `没有匹配${cond.join(" + ")}的工作流，试试调整搜索或筛选条件。`
          : "没有匹配的工作流，试试调整筛选条件。")
      : `正在在已加载的数据中查找 ${scope}…`;
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
  const my = ++filterToken; // 本次筛选的令牌
  const needAll = needsAllData() && !allLoaded;
  setFilterUI(true, filterStatusText(needAll));
  // 超时兜底：加载异常缓慢时不能让状态条永远转下去。
  // 到点后提示"仍在加载"，但不清除指示（数据到位后仍会自动刷新），
  // 这样用户知道是"慢"而不是"坏了"。
  let slowTimer = null;
  if (needAll) {
    slowTimer = setTimeout(() => {
      if (my !== filterToken) return;
      const txt = document.getElementById("filter-status-text");
      const done = document.getElementById("search-spin");
      if (done) done.hidden = true; // 停止转圈，改为静态提示
      if (txt) {
        const loaded = typeof nextShard !== "undefined" ? nextShard : 0;
        const total = MANIFEST ? MANIFEST.shards.length : "?";
        txt.textContent = `网络较慢，仍在加载数据（已加载 ${loaded}/${total} 个分片）…筛选会在完成后自动出结果`;
      }
    }, 12000);
  }
  try {
    if (needsAllData() && !allLoaded) {
      await ensureAllLoaded();
      // 等待期间用户可能又改了条件：这次的结果作废，由新一次 refresh 接手
      if (my !== filterToken) return;
      applyFilter();
      return;
    }
    // 有内联榜单：立即出结果，全量数据后台补齐后自动刷新
    applyFilter();
    if (!allLoaded) backgroundFill();
  } finally {
    clearTimeout(slowTimer);
    if (my === filterToken) setFilterUI(false);
  }
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
  const search = document.getElementById("search");
  search.addEventListener("input", (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim().toLowerCase();
    // 输入瞬间就亮起筛选状态（不等 250ms 防抖），消除"打了字没反应"的空白期
    setFilterUI(true, v ? `正在筛选 关键词「${v}」…` : "正在清除筛选…");
    timer = setTimeout(() => {
      state.q = v;
      refresh();
    }, 250);
  });
  // 失焦时若还有挂起的防抖任务，立即结算，避免状态条停留过久
  search.addEventListener("blur", () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      state.q = search.value.trim().toLowerCase();
      refresh();
    }
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
