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

/* ---- 搜索索引（wf-index.json.gz）----
   只含 名称/作者/标签，体积约为全部分片的三成。搜索先用它算出命中集合，
   无需等 29 个分片（11MB）下载完，因此能做到"秒出"。
   索引里的 order 字段保存各热度维度的行号顺序，命中后可直接排序，
   不必等全量数据到位。 */
let INDEX = null;        // 解析后的索引
let indexLoading = null; // 加载中的 Promise（避免重复请求）
let idIndex = null;      // id -> POOL 下标，用于把索引命中的 id 映射回展示字段

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
function filterStatusText(loading, viaIndex, prog) {
  const parts = [];
  // 关键词可能很长，超长会撑爆状态条，截断并加省略号
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + "…" : s);
  if (state.q) parts.push(`关键词「${clip(state.q, 24)}」`);
  if (state.tag) parts.push(`标签「${clip(state.tag, 12)}」`);
  const scope = parts.length ? parts.join(" + ") : "全部数据";
  const narrow = window.matchMedia("(max-width: 560px)").matches;
  if (viaIndex) {
    const mb = MANIFEST && MANIFEST.indexSize
      ? (MANIFEST.indexSize / 1024 / 1024).toFixed(1) : "3.7";
    // 有下载进度时显示 百分比 + 预计剩余，窄屏只留百分比
    if (prog) {
      const pct = Math.min(99, Math.floor((prog.got / prog.total) * 100));
      return narrow
        ? `正在筛选 ${scope}… ${pct}%`
        : `正在筛选 ${scope} — 搜索索引下载 ${pct}%`
          + `（${(prog.got / 1048576).toFixed(1)}/${mb}MB`
          + (prog.left > 1 && prog.left < 120 ? `，约剩 ${Math.ceil(prog.left)} 秒` : "")
          + "）";
    }
    return narrow
      ? `正在筛选 ${scope}…`
      : `正在筛选 ${scope} — 正在加载 ${mb}MB 搜索索引…`;
  }
  if (loading) {
    return narrow
      ? `正在筛选 ${scope}…（需加载全部数据）`
      : `正在筛选 ${scope} — 需加载全部 ${MANIFEST ? MANIFEST.shards.length : "?"} 个数据分片，首次筛选约需数秒…`;
  }
  return `正在筛选 ${scope}…`;
}

/* ========= 搜索索引 ========= */
/* 索引只含 名称/作者/标签，体积约为全部分片的三成（实测 3.7MB vs 11MB）。
   搜索先用它算出命中集合并渲染，卡片缺的展示字段（图片/热度）由
   indexEnrich() 从已加载分片补齐；尚未加载的分片则显示占位骨架。 */

/* 索引体积较大（实测 GitHub Pages 上 3.6MB 要 ~76 秒），下载期间必须给出
   真实进度，否则用户面对一个不动的转圈无从判断是卡了还是在等。
   这里用 fetch + ReadableStream 边读边报进度（不走 fetchBytes，
   因为它只在整体完成后才 resolve，拿不到中间进度）。 */
function fetchIndexWithProgress(url, total, onProgress) {
  const ctl = new AbortController();
  // 整体超时按体积推导：实测吞吐约 50KB/s，给 3 倍余量，下限 30 秒
  const budget = Math.max(30000, Math.ceil((total / 1024) / 50 * 3));
  const t = setTimeout(() => ctl.abort(), budget);
  const t0 = performance.now();
  const chunks = [];
  let got = 0;   // 已收到的字节（重试时作为 Range 断点）
  const STALL = 15000; // 连续多少毫秒没有新数据就判定连接卡死

  // 单次尝试：从 from 处开始流式读取，直到读完或 stall。
  // 用独立 controller，这样 stall 时能只中断这一次而不影响整体。
  async function once(from) {
    const ac = new AbortController();
    const onOuter = () => ac.abort();
    ctl.signal.addEventListener("abort", onOuter, { once: true });
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: from > 0 ? { Range: `bytes=${from}-` } : undefined,
      });
      // 206 = 断点续传成功，直接追加；200 = 服务端忽略了 Range，只能从头收
      if (res.status === 200 && from > 0) { chunks.length = 0; got = 0; }
      else if (!res.ok && res.status !== 206) throw new Error("HTTP " + res.status);

      const reader = res.body.getReader();
      let finished = false;
      try {
        for (;;) {
          // stall 守卫：本次 read 若超时抛错，外层带着断点重试。
          // 竞速用的是一个每次都重建的 timer，避免上一次 read 的计时器
          // 泄漏到下一次（否则慢速下载时会误报 stall）。
          let timer = null;
          const chunk = await Promise.race([
            reader.read(),
            new Promise((_, rej) => {
              timer = setTimeout(() => rej(new Error("stall")), STALL);
            }),
          ]).finally(() => clearTimeout(timer));
          if (chunk.done) { finished = true; return true; }
          chunks.push(chunk.value);
          got += chunk.value.length;
          if (onProgress && performance.now() - t0 > 120) onProgress(got, total, t0);
        }
      } finally {
        // 只在**没读完**的中断路径上 abort（比如 stall 抛错）。
        // 正常读完时绝不能 abort：reader 的 body 还有在途的微任务，
        // 此时 abort 会让浏览器抛 "BodyStreamBuffer was aborted"，
        // 把一次成功的下载变成失败（线上曾因此让首片与索引双双报错）。
        if (!finished) { try { ac.abort(); } catch (e) {} }
        ctl.signal.removeEventListener("abort", onOuter);
      }
    } catch (err) {
      try { ac.abort(); } catch (e) {}
      ctl.signal.removeEventListener("abort", onOuter);
      throw err;
    }
  }

  // 最多试 5 次：每次 stall 都从断点续传，不浪费已下载的字节
  const run = (async () => {
    for (let i = 0; ; i++) {
      try {
        return await once(got);
      } catch (e) {
        if (ctl.signal.aborted) throw e; // 整体超时，不再重试
        if (i >= 4) throw e;              // 重试耗尽
        if (onProgress) onProgress(got, total, t0); // 让 UI 显示"重连中"
      }
    }
  })();

  return run.then(() => {
    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out.buffer;
  }).finally(() => clearTimeout(t));
}

let indexProgress = null; // 当前索引下载进度（供状态条刷新）
let indexWanted = false;  // 用户是否正在等索引（区分「主动搜索」与「后台预热」）

function ensureIndex() {
  if (INDEX) return Promise.resolve(INDEX);
  if (indexLoading) return indexLoading;
  if (!MANIFEST || !MANIFEST.indexFile) {
    // 清单未声明索引（理论上不会发生）→ 退回原有全量加载路径
    return Promise.resolve(null);
  }
  const total = Number(MANIFEST.indexSize) || 3700000;
  indexLoading = fetchIndexWithProgress("data/" + MANIFEST.indexFile, total,
      (got, all, t0) => {
        const secs = (performance.now() - t0) / 1000;
        const bps = got / Math.max(secs, 0.3);
        indexProgress = { got, total, bps, left: (all - got) / Math.max(bps, 1024) };
        // 节流刷新状态条，避免高频 DOM 操作。
        // 只在**用户主动搜索**时才亮状态条：后台预热不该弹"正在筛选"，
        // 否则用户刚打开页面就看到一条筛选提示，会误以为已经在筛选了。
        if (!indexWanted) return;
        if (!ensureIndex._t || performance.now() - ensureIndex._t > 400) {
          ensureIndex._t = performance.now();
          setFilterUI(true, filterStatusText(false, true, indexProgress));
        }
      })
    .then(gunzipText)
    .then((txt) => {
      INDEX = JSON.parse(txt);
      // 预建 id -> 行号 映射，搜索后按 id 取展示字段
      indexLoading = null;
      indexProgress = null;
      return INDEX;
    })
    .catch((e) => {
      indexLoading = null;
      indexProgress = null;
      console.warn("搜索索引加载失败，回退全量加载", e);
      return null;
    });
  return indexLoading;
}

/* 用索引做匹配：返回命中行号数组（升序，与 ids 顺序一致） */
function indexMatch(q, tag) {
  if (!INDEX) return null;
  const rows = INDEX.rows, tags = INDEX.tags;
  const qn = q || "";
  const hit = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (tag) {
      // 标签是字典 id 列表，转成字符串比较
      let ok = false;
      for (const t of r[2]) if (tags[t] === tag) { ok = true; break; }
      if (!ok) continue;
    }
    if (qn) {
      // 与 matches() 保持同一匹配面：名称 + 作者 + 标签
      // 说明：描述 d 不在索引里，搜描述会漏。为避免"搜到一半"的困惑，
      // 索引路径下搜索范围为名称/作者/标签，描述仍需全量加载后才可搜。
      let hay = r[0] + " " + r[1];
      if (!tag) {
        for (const t of r[2]) hay += " " + tags[t];
      }
      if (hay.toLowerCase().indexOf(qn) < 0) continue;
    }
    hit.push(i);
  }
  return hit;
}

/* 把索引命中的行号转成可渲染的条目。
   展示字段优先取自已加载的 POOL（数据最新），否则用索引里的名称/作者/标签
   组装占位条目 —— 卡片能立刻出现，图片与热度在分片到位后自动补齐。 */
function indexItems(hitRows) {
  const ids = INDEX.ids, rows = INDEX.rows, tags = INDEX.tags, ord = INDEX.order;
  // id -> POOL 下标（分片加载后惰性建立）
  if (!idIndex) {
    idIndex = new Map();
    for (let i = 0; i < POOL.length; i++) idIndex.set(POOL[i].i, i);
  }
  const out = [];
  for (const r of hitRows) {
    const id = ids[r];
    const at = idIndex.get(id);
    if (at !== undefined && POOL[at]) {
      out.push(POOL[at]); // 已有完整数据，直接用
      continue;
    }
    // 占位：先给名称/作者/标签，图片与热度留空（分片加载后由 enrich 补齐）
    out.push({
      i: id,
      n: rows[r][0],
      a: rows[r][1],
      im: null,
      t: null,
      s: null,
      g: (rows[r][2] || []).map((t) => tags[t]).filter(Boolean),
      _pending: true, // 标记"展示字段待补齐"
    });
  }
  return out;
}

/* 索引排序：按当前维度对命中项排序。order 里是行号顺序，
   取出行号在 order 中的排名作为排序键 —— 无需比较字段值。 */
function indexSort(list, rowsArr) {
  // 注意：索引里的 order 用的是**短键**（u/l/c/latest），
  // 而 state.sort 是下拉框的**长键**（uses/likes/collects/latest），
  // 早期直接用 state.sort 取会拿到 undefined 而静默回退到 order.u，
  // 导致"切排序没反应"（实测三种热度维度顺序完全相同）。必须先过 RANK_DIM。
  const dim = RANK_DIM[state.sort] || "u";
  const ord = INDEX.order[dim];
  if (!ord) return list;
  // 按维度分别缓存"行号 -> 排名"，避免切换维度时复用错误的映射
  if (!indexOrderRank) indexOrderRank = new Map();
  let rank = indexOrderRank.get(dim);
  if (!rank) {
    rank = new Map();
    for (let r = 0; r < ord.length; r++) rank.set(ord[r], r);
    indexOrderRank.set(dim, rank);
  }
  if (!indexIdToRow) buildIdToRow();
  const key = new Map();
  for (const it of list) {
    const row = indexIdToRow.get(it.i);
    key.set(it.i, row === undefined ? 1e9 : (rank.has(row) ? rank.get(row) : 1e9));
  }
  return list.slice().sort((a, b) => key.get(a.i) - key.get(b.i));
}
/* key: 排序维度 -> Map(行号, 排名) */
let indexOrderRank = null;

/* 一次性建立 id -> 行号 的反查表 */
function buildIdToRow() {
  indexIdToRow = new Map();
  const ids = INDEX.ids;
  for (let i = 0; i < ids.length; i++) indexIdToRow.set(ids[i], i);
}

/* id -> 行号 */
function indexRowOfId(id) {
  if (!indexIdToRow) buildIdToRow();
  return indexIdToRow.get(id);
}
let indexIdToRow = null;

/* 分片陆续到位后，用真实字段替换占位条目（原地更新，保持顺序不变） */
function enrichPending(list) {
  if (!idIndex) return 0;
  let n = 0;
  for (const it of list) {
    if (!it._pending) continue;
    const at = idIndex.get(it.i);
    if (at !== undefined && POOL[at]) {
      const real = POOL[at];
      it.im = real.im; it.t = real.t; it.s = real.s;
      delete it._pending;
      n++;
    }
  }
  return n;
}

/* 占位条目补齐后重绘：只重画仍在 DOM 中的占位卡片，
   已渲染的不动，避免打断用户滚动与视觉连续性。 */
function repaintPending() {
  if (!filtered.some((x) => x._pending)) return;
  const n = enrichPending(filtered);
  if (!n) return;
  // 仍有未补齐的（分片未到位）→ 不整体重绘，等下一批
  if (filtered.some((x) => x._pending)) {
    // 用轻量方式：只更新已补齐的那批
    updatePendingCards();
  } else {
    // 全部补齐 → 整块重绘
    rendered = 0;
    document.getElementById("grid").innerHTML = "";
    renderMore();
  }
}

/* 轻量更新：把已补齐的占位卡片替换为完整卡片（不滚动、不闪烁） */
function updatePendingCards() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  const cards = grid.querySelectorAll(".wf-card.is-pending");
  cards.forEach((el) => {
    const idx = Array.prototype.indexOf.call(el.parentNode.children, el);
    const it = filtered[idx];
    if (!it || it._pending) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = cardHTML(it);
    const fresh = tmp.firstElementChild;
    if (fresh) el.replaceWith(fresh);
  });
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
    .then(async (res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      // 逐块读进数组再合并，而不是 res.arrayBuffer()：
      // 后者在「响应头已到、body 仍在传输」阶段不受 abort 保护，
      // 若连接半死不活，clearTimeout 已执行、abort 又打不到它，
      // Promise 会永远挂起（UI 表现为一直转圈）。
      // 流式读取则全程受 signal 约束，超时必定落定。
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      return out.buffer;
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
    idIndex = null;
  } catch (e) {
    setLoadError(e);
  } finally {
    setBusy(false);
    setFilterUI(false);
    loadingShard = false;
  }
}

/* ========= 全量数据 vs 搜索索引 ========= */
/* 点赞 / 收藏 / 最新 有内联榜单（manifest.rank），无需等全部分片。
   搜索 / 标签筛选走「搜索索引」（3.7MB，秒出）。
   唯一需要全量分片的情况：搜索命中数为 0 —— 此时无法区分
   "库里确实没有"与"匹配的是描述(不在索引里)"，为不漏结果退回全量复查。 */
const RANK_DIM = { uses: "u", likes: "l", collects: "c", latest: "latest" };

/* 有搜索词或标签 → 走索引路径 */
function needsIndex() {
  return !!(state.q || state.tag);
}

/* 决定是否要等全部分片：
   - 无搜索词：仅当排序维度没有内联榜单时需要（当前四个维度都有，故永假）
   - 有搜索词/标签：索引命中为 0 时需要复查，其余不需要 */
function needsAllData() {
  if (needsIndex()) return false; // 由 refresh() 依据命中数再决定是否复查
  return !RANK_DIM[state.sort];
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

/* 当前视图是否由「搜索索引」驱动。
   索引命中集合与 POOL 无关（POOL 只是分片按需加载的子集），若让
   recomputeFiltered 用 POOL.filter(matches) 覆盖，会把索引命中的条目
   砍到只剩已加载那部分——实测 9642 条被砍成 3744 条。 */
let INDEX_MODE = false;

function recomputeFiltered() {
  // 索引模式：始终按索引重算，不能退回 POOL 过滤
  if (INDEX_MODE && INDEX) {
    const hit = indexMatch(state.q, state.tag);
    if (hit) {
      const list = indexItems(hit);
      filtered = indexSort(list, hit);
      // 已加载的条目用池内版本覆盖（统计值更新、图片与日期补齐）
      for (const it of filtered) {
        const at = idIndex && idIndex.get(it.i);
        if (at !== undefined && POOL[at]) {
          const real = POOL[at];
          it.im = real.im || it.im; it.t = real.t || it.t; it.s = real.s || it.s;
          delete it._pending;
        }
      }
      return;
    }
  }
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
  const tags = (it.g || []).slice(0, 6).map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}</span>`).join("");

  // 占位条目（搜索索引命中但展示字段尚未从分片补齐）：
  // 图片与热度标记为"加载中"而不是"暂无/0"，避免被误读成真实数据。
  const pending = !!it._pending;
  const badges = pending
    ? `<span class="badge pending">使用 <b>…</b></span>
       <span class="badge pending">点赞 <b>…</b></span>
       <span class="badge pending">收藏 <b>…</b></span>`
    : [
        `<span class="badge">使用 <b>${fmtNum(s.u)}</b></span>`,
        `<span class="badge">点赞 <b>${fmtNum(s.l)}</b></span>`,
        `<span class="badge">收藏 <b>${fmtNum(s.c)}</b></span>`,
      ].join("");

  return `
    <article class="wf-card${pending ? " is-pending" : ""}">
      ${img}
      <div class="body">
        <h2>${esc(it.n)}</h2>
        ${author}
        <div class="badges">${badges}</div>
        <div class="date">${pending ? "数据加载中…" : `发布于 ${esc(fmtDate(it.t))}`}</div>
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
  INDEX_MODE = false; // 回到全量池模式
  recomputeFiltered();
  rendered = 0;
  document.getElementById("grid").innerHTML = "";
  renderMore();
}

/* 刷新入口：
   1) 有搜索词/标签时走「搜索索引」路径 —— 3.7MB 索引秒出，命中即可渲染，
      展示字段由已加载分片补齐，未加载的先占位；
   2) 仅排序时优先用清单内联的 Top-600 榜单（0.01~0.03 秒），后台补全；
   3) 索引不可用时回退到「等全部分片」的老路径（保证功能不挂）。 */
async function refresh() {
  const my = ++filterToken;
  const needIndex = needsIndex();
  if (needIndex) {
    indexWanted = true; // 标记"用户在等索引"，进度提示才允许亮出来
    setFilterUI(true, filterStatusText(false, true, indexProgress));
    const idx = await ensureIndex();
    if (my !== filterToken) return;
    indexWanted = false;
    if (idx) {
      applyIndexFilter();
      // 索引已出结果；分片在后台继续加载，逐片补齐图片/热度等展示字段。
      // 注意：不要在这里等 ensureAllLoaded()，那会把"秒出"打回原形。
      if (!allLoaded) backgroundFill();
      setFilterUI(false);
      return;
    }
    // 索引不可用 → 回退全量加载
    setFilterUI(true, filterStatusText(true));
    await ensureAllLoaded();
    if (my !== filterToken) return;
    applyFilter();
    setFilterUI(false);
    return;
  }
  indexWanted = false;
  // 无搜索词：榜单内联立即出结果
  applyFilter();
  if (!allLoaded) backgroundFill();
}

/* 索引路径的筛选：命中 → 组装 → 排序 → 渲染 */
function applyIndexFilter() {
  const hit = indexMatch(state.q, state.tag);
  if (!hit) return applyFilter();
  // 零命中时退回全量复查：索引不含描述( d )字段，
  // 用户可能搜的是描述里的词，此时不能直接报"无结果"。
  if (hit.length === 0 && !allLoaded) {
    fallbackFullScan();
    return;
  }
  INDEX_MODE = true;
  const list = indexItems(hit);
  filtered = indexSort(list, hit);
  rendered = 0;
  document.getElementById("grid").innerHTML = "";
  renderMore();
}

/* 零命中兜底：加载全部分片后用完整字段（含描述）重查一次。
   这是"搜描述"的唯一路径——索引里刻意不放 d 字段以控制体积。 */
async function fallbackFullScan() {
  const my = ++filterToken;
  indexWanted = false; // 索引阶段结束，后续进度提示不再由索引驱动
  setFilterUI(true, "索引无结果，正在用完整数据复查…");
  await ensureAllLoaded();
  if (my !== filterToken) return;
  applyFilter();
  setFilterUI(false);
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
      idIndex = null; // POOL 变了，行号映射失效
      recomputeFiltered();
      repaintPending();   // 分片到位后补齐搜索结果的占位卡片
      renderMore(); // 逐步追加，滚动位置不跳
    }
    allLoaded = true;
    idIndex = null;
    recomputeFiltered();
    repaintPending();
    // 补齐后重排（排序完全准确）。索引模式下必须继续用索引路径，
    // 否则 applyFilter 会把视图切回全量池，砍掉"未加载"的那部分命中。
    if (INDEX_MODE) applyIndexFilter();
    else applyFilter();
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

    // 3) 空闲时预热搜索索引（3.6MB，实测线上约 76 秒）。
    //    不预热的话，用户从打开页面到输第一个关键词只要几秒，
    //    却要干等整份索引下载完——预热能把这段等待挪到用户还没搜索的时候。
    //    requestIdleCallback 保证不与首屏/滚动争抢主线程与带宽。
    const warm = () => { ensureIndex().catch(() => {}); };
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2500);
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
