// ============================================================
//  全景VR展示平台 - 数据层 (data.js)
//  支持多场景、动态分类
// ============================================================

// ── 默认分类（用户可增删改）─────────────────────────────────
const DEFAULT_CATEGORIES = [
  { id: 'indoor', name: '室内空间', icon: '🏠', order: 0 },
  { id: 'outdoor', name: '风景航拍', icon: '🏔️', order: 1 },
  { id: 'exhibition', name: '展览展厅', icon: '🎨', order: 2 },
  { id: 'tourism', name: '旅游景点', icon: '🏝️', order: 3 },
  { id: 'commercial', name: '商业空间', icon: '🏬', order: 4 },
  { id: 'architecture', name: '建筑工程', icon: '🏗️', order: 5 },
];

// ── 示例数据（多场景）─────────────────────────────────────
const WORKS_DATA = []; // 默认示例作品已移除，仅展示用户上传内容
;

// ── 作品封面工具（访客页 / 管理后台通用）────────────────────
// 有效作者名：空值、以及历史数据里存过的「匿名」等占位值，一律视为「没有作者」。
// （早期版本上传时会兜底写入「匿名」，展示时不应把它当真实作者名显示出来）
const PLACEHOLDER_AUTHORS = ['匿名', '匿名访客', '无名', '未知', 'anonymous', 'unknown'];
// 是否「公开」作品（访客端只展示公开作品）。
// 历史数据没有 privacy 字段 → 视为公开，避免老作品集体消失。
// privacy 取值：'public' 公开 / 'link' 链接访问 / 'private' 私密。
function isPublicWork(work) {
  if (!work) return false;
  const p = work.privacy == null ? 'public' : String(work.privacy).trim();
  return p === '' || p === 'public';
}

function getWorkAuthor(work) {
  if (!work) return '';
  // 兼容两种入参：作品对象本身，或查看器用的 { title, author, work } 包装对象
  let raw = work.author;
  if ((raw == null || String(raw).trim() === '') && work.work) raw = work.work.author;
  const a = String(raw == null ? '' : raw).trim();
  if (!a) return '';
  return PLACEHOLDER_AUTHORS.indexOf(a.toLowerCase()) !== -1 ? '' : a;
}

// 返回展示用封面（低清，先用它占位，再用 generateCoverThumb 提升清晰度）
function getWorkCoverUrl(work) {
  if (!work) return '';
  if (work.thumb) return work.thumb;
  const sc = (work.scenes && work.scenes[0]) || null;
  if (sc) return sc.thumb || sc.panorama || '';
  return work.panorama || '';
}
// 返回用于生成缩略图的高清源（优先首场景全景大图）
function getWorkCoverSource(work) {
  if (!work) return '';
  if (work.panorama) return work.panorama;
  if (work.coverSource) return work.coverSource;
  const sc = (work.scenes && work.scenes[0]) || null;
  if (sc) return sc.panorama || sc.thumb || '';
  return work.thumb || '';
}
// 从全景（equirectangular）图生成「居中裁剪」封面缩略图，效果更接近主流VR站
// ⚠️ 注意：生成缩略图需要先下载「全景原图」（通常几 MB）。
// 因此必须「限制并发」+「只在进入视口时才做」——否则首页会一次性并发下载
// 所有作品的全景大图，把手机带宽占满，导致用户点进作品时全景图加载极慢。
const _coverThumbCache = {};
const COVER_MAX_CONCURRENT = 2;
const _coverQueue = [];
let _coverActive = 0;

function drainCoverQueue() {
  while (_coverActive < COVER_MAX_CONCURRENT && _coverQueue.length) {
    const run = _coverQueue.shift();
    _coverActive++;
    try { run(); } catch (e) { _coverActive--; }
  }
}

function generateCoverThumbFromUrl(url, cb) {
  if (!url) { cb(''); return; }
  if (_coverThumbCache[url]) { cb(_coverThumbCache[url]); return; }

  const run = () => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 尝试跨域读取，失败则回退
    const finish = (v) => { _coverActive--; try { cb(v); } catch (e) {} drainCoverQueue(); };
    img.onload = () => {
      try {
        const cw = 640, ch = 360;
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const ctx = c.getContext('2d');
        // 取全景中段（约 28%~72%），即正前方的「主场景」
        const sx = Math.floor(img.width * 0.28);
        const sw = Math.floor(img.width * 0.44);
        ctx.drawImage(img, sx, 0, sw, img.height, 0, 0, cw, ch);
        const data = c.toDataURL('image/jpeg', 0.82);
        _coverThumbCache[url] = data;
        finish(data);
      } catch (e) {
        // 画布被跨域污染：回退到原图（由 CSS object-fit 裁切）
        _coverThumbCache[url] = url;
        finish(url);
      }
    };
    img.onerror = () => {
      // 跨域匿名加载失败时，去掉 crossOrigin 直接显示原图
      const fallback = new Image();
      const done = () => { _coverThumbCache[url] = url; finish(url); };
      fallback.onload = done;
      fallback.onerror = done;
      fallback.src = url;
    };
    img.src = url;
  };

  _coverQueue.push(run);
  drainCoverQueue();
}

// 批量提升 root 内所有带 data-pano 属性的封面图清晰度
// 只处理「即将进入视口」的卡片，并限制并发，避免抢占带宽
let _coverObserver = null;

function _applyCoverThumb(img) {
  const url = img.getAttribute('data-pano');
  if (!url) return;
  img.removeAttribute('data-pano'); // 标记已处理，避免“加载更多”时重复扫描/重复观察
  generateCoverThumbFromUrl(url, (thumb) => {
    if (thumb && img.getAttribute('src') !== thumb) img.src = thumb;
  });
}

function _getCoverObserver() {
  if (_coverObserver) return _coverObserver;
  _coverObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      obs.unobserve(en.target);
      _applyCoverThumb(en.target);
    });
  }, { rootMargin: '120px 0px' }); // 提前 120px 预取，兼顾顺滑与省流
  return _coverObserver;
}

function enhanceCoverImages(root) {
  if (!root) return;
  const imgs = root.querySelectorAll('img[data-pano]');
  if (!imgs.length) return;

  // 不支持 IntersectionObserver 的旧环境：退回逐个处理（仍受并发限制）
  if (typeof IntersectionObserver === 'undefined') {
    Array.prototype.forEach.call(imgs, _applyCoverThumb);
    return;
  }

  const io = _getCoverObserver();
  Array.prototype.forEach.call(imgs, (img) => io.observe(img));
}

// ══════════════════════════════════════════════════════════
//  作品数据跨设备同步（访客端 app.js 与 管理后台 admin.js 共用）
//  IndexedDB 按浏览器隔离：换一台电脑本机库是空的，
//  作品广场没内容、后台也看不到已上传作品。
//  所以把「完整作品 + 分类」存到远端共享键，任何设备打开都能拿到。
//  ⚠️ textdb.online 的值有大小上限：实测 160KB 可存、200KB 会被
//     **静默丢弃**（写入返回 200 但读回 0 字节）→ 发送前做体积检查。
// ══════════════════════════════════════════════════════════
const WORKS_DATA_SYNC_KEY = 'vrpv_worksdata_r010wzn15xru94ijuk4i61zp';
const WORKS_DATA_SYNC_BASE = 'https://textdb.online';
const WORKS_DATA_MAX_BYTES = 150000;
const WORKS_DELETED_LS = 'vr_deleted_work_ids';   // 删除墓碑（本地），防止远端把已删作品「复活」
const WORKS_PUSHED_SIG_LS = 'vr_works_pushed_sig'; // 上次推送成功的签名，避免重复推送

function readDeletedWorkIds() {
  try {
    const a = JSON.parse(localStorage.getItem(WORKS_DELETED_LS) || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch (e) { return []; }
}

function addDeletedWorkId(id) {
  try {
    const a = readDeletedWorkIds();
    const s = String(id);
    if (a.indexOf(s) === -1) a.push(s);
    localStorage.setItem(WORKS_DELETED_LS, JSON.stringify(a.slice(-300)));
  } catch (e) { /* ignore */ }
}

// 上传时间：新数据用 uploadedAt；旧数据退到 id 内嵌的毫秒时间戳，再退到 date（只到天）
function getWorkSyncTime(work) {
  if (!work) return 0;
  if (work.uploadedAt) { const t = Number(work.uploadedAt); if (t) return t; }
  const n = parseInt(work.id, 10);
  if (!isNaN(n) && n > 1e12) return n;
  if (work.date) { const t = Date.parse(work.date); if (!isNaN(t)) return t; }
  return 0;
}

// 廉价签名：作品数 + 最新上传时间。用来判断「远端是否已经是最新」
function worksSyncSignature(works) {
  const list = works || [];
  let maxAt = 0;
  list.forEach(w => { const t = getWorkSyncTime(w); if (t > maxAt) maxAt = t; });
  return list.length + ':' + maxAt;
}

// 读远端；返回 null 表示**网络失败/超时**（与「远端为空」区分开，失败时绝不能盲推）
async function fetchWorksDataRemote(timeoutMs) {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 6000) : null;
    const res = await fetch(WORKS_DATA_SYNC_BASE + '/' + WORKS_DATA_SYNC_KEY + '?_=' + Date.now(),
      { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const txt = (await res.text()).trim();
    if (!txt) return { works: [], cats: [], deleted: [] };
    const d = JSON.parse(txt);
    if (Array.isArray(d)) return { works: d, cats: [], deleted: [] }; // 兼容纯数组
    return {
      works: Array.isArray(d.works) ? d.works : [],
      cats: Array.isArray(d.cats) ? d.cats : [],
      deleted: Array.isArray(d.deleted) ? d.deleted.map(String) : [],
    };
  } catch (e) { return null; }
}

// 先读后写合并（本地优先）→ 推送。返回 { ok, reason, count, bytes }
async function pushWorksDataRemote(localWorks, localCats, opts) {
  opts = opts || {};
  const remote = await fetchWorksDataRemote(opts.timeoutMs || 6000);
  if (remote === null) return { ok: false, reason: 'offline' };

  const dead = {};
  readDeletedWorkIds().forEach(id => { dead[id] = 1; });
  (remote.deleted || []).forEach(id => { dead[String(id)] = 1; });
  const deadIds = Object.keys(dead);

  const byId = {};
  (remote.works || []).forEach(w => { if (w && w.id != null) byId[String(w.id)] = w; });
  (localWorks || []).forEach(w => { if (w && w.id != null) byId[String(w.id)] = w; });
  const works = Object.keys(byId).map(k => byId[k]).filter(w => !dead[String(w.id)]);

  if (!works.length) {
    // 本地一个作品都没有：只有「确实删过东西」时才允许推送，
    // 否则拒绝，避免空设备把远端数据清空（真实发生过）
    if (!deadIds.length) return { ok: false, reason: 'nothing-to-push' };
    if ((remote.works || []).length) return { ok: false, reason: 'would-wipe' };
  }

  const payload = { v: 1, works: works, cats: localCats || [], deleted: deadIds };
  const value = JSON.stringify(payload);
  if (value.length > WORKS_DATA_MAX_BYTES) {
    return { ok: false, reason: 'too-big', bytes: value.length, count: works.length };
  }

  const body = new URLSearchParams();
  body.set('key', WORKS_DATA_SYNC_KEY);
  body.set('value', value);
  await fetch(WORKS_DATA_SYNC_BASE + '/update', { method: 'POST', body });

  try { localStorage.setItem(WORKS_PUSHED_SIG_LS, worksSyncSignature(works)); } catch (e) { /* ignore */ }
  return { ok: true, count: works.length, bytes: value.length };
}

// ── 首页 banner 用的「作品索引」─────────────────────────────
// 只含标题与各场景全景图，供主站首屏轮播；比全量数据小得多。
const WORKS_INDEX_SYNC_KEY = 'vrpv_works_qhhxo4k6lyr6ehcbjqt4gphx';
const WORKS_INDEX_MAX = 8;

function buildWorksIndexPayload(works) {
  const list = (works || [])
    .filter(w => w && w.status !== 'draft' && isPublicWork(w)) // 公开门面：草稿与私密作品不上
    .map(w => {
      const sc = (w.scenes || [])
        .map(s => ({ p: (s && s.panorama) || '', t: (s && s.title) || '' }))
        .filter(s => !!s.p);
      return {
        id: w.id,
        t: w.title || '',
        at: getWorkSyncTime(w),
        n: sc.length,
        sc: sc,
        pano: sc.length ? sc[0].p : (w.panorama || ''), // 兼容旧版首页
      };
    })
    .filter(x => x.n > 0);

  list.sort((a, b) => b.at - a.at); // 上传时间从近到远
  return list.slice(0, WORKS_INDEX_MAX);
}

async function pushWorksIndexRemote(works) {
  try {
    const body = new URLSearchParams();
    body.set('key', WORKS_INDEX_SYNC_KEY);
    body.set('value', JSON.stringify(buildWorksIndexPayload(works)));
    await fetch(WORKS_DATA_SYNC_BASE + '/update', { method: 'POST', body });
    return true;
  } catch (e) { return false; }
}

// ══════════════════════════════════════════════════════════
//  分享作品卡片 / 分享海报
//  访客端（index.html）与管理后台（admin.html）共用同一套。
//  ⚠ 这里只保留「一份」实现：此前 app.js 与 admin.js 各写了一份海报绘制，
//    改一处忘一处两边就会长得不一样。以后调整视觉请只改本区块。
//  配色跟随站点当前主题：浅底 + 深墨字 + 品牌蓝；LOGO 是红字标（只在浅底上清晰）。
// ══════════════════════════════════════════════════════════

const SHARE_FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';
const SHARE_INK = '#16202b', SHARE_INK2 = '#46586b', SHARE_MUTED = '#6b7b8c';
const SHARE_BRAND = '#1e88e5', SHARE_BRAND_T = '#1565c0', SHARE_LINE = '#e3e8ee';

// 站点根相对路径 → 实际 URL。
// 页面可能在站点根（/index.html、/admin.html），也可能在 /vr/ 子目录下，
// 而 data.js 被这两处共用，所以要按当前页面深度补 '../'。
function resolveSitePath(rel) {
  const p = String((typeof location !== 'undefined' && location.pathname) || '/').replace(/\\/g, '/');
  return (/\/vr(\/|$)/.test(p) ? '../' : '') + rel;
}
function getShareLogoUrl() { return resolveSitePath('images/logo.png'); }

// 作品发布日期。历史数据存的是 'YYYY-MM-DD'，取前 10 位即可。
function getWorkDateText(work) {
  if (!work) return '';
  const d = String(work.date || work.createdAt || '').trim();
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : d.slice(0, 10);
}

function getWorkTypeLabel(work) {
  const t = work && work.type;
  return t === 'image' ? '图片' : t === 'video' ? '视频' : t === 'article' ? '图文' : 'VR';
}

// ⚠ 必须转义：作品可以被「?data=」分享链接带进来（decodeShareData 直接采用
// 链接里的标题/作者/简介），不转义就等于让外部链接往页面里注入 HTML。
function escShareText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 分享弹层里的作品卡片（HTML 字符串）。
// 版面照参考稿：作品名居中 → 一条细线夹一枚「小」LOGO 点缀 → 缩略图 → 底部左边作者/日期、右边二维码。
// ⚠ LOGO 只是点缀：别再放大成一条整宽的 logo 页脚（之前 24px 高的整条页脚显得又笨又抢戏）。
// 作者 / 日期 / 分类缺失时自动省略对应片段。
function buildShareCardHtml(work) {
  if (!work) return '';
  const cover = getWorkCoverUrl(work);
  const author = getWorkAuthor(work);
  const date = getWorkDateText(work);
  const sceneCount = (work.scenes && work.scenes.length) || 1;
  const catName = (typeof getCatName === 'function') ? getCatName(work.category) : '';

  // 缩略图上的角标
  let chips = '<span class="swc-chip vr">' + escShareText(getWorkTypeLabel(work)) + '</span>';
  if (sceneCount > 1) chips += '<span class="swc-chip scenes">' + sceneCount + ' 场景</span>';

  // 底部左侧：作者 · 日期 + 分类
  let meta = '';
  if (author) {
    meta += '<span class="swc-avatar">' + escShareText(String(author)[0].toUpperCase()) + '</span>' +
            '<span class="swc-author" title="' + escShareText(author) + '">' + escShareText(author) + '</span>';
  }
  if (date) {
    if (author) meta += '<span class="swc-dot">·</span>';
    meta += '<span class="swc-date">' + escShareText(date) + '</span>';
  }
  if (catName) meta += '<span class="swc-cat">' + escShareText(catName) + '</span>';

  return '<div class="swc-head">' +
      '<div class="swc-title" title="' + escShareText(work.title || '') + '">' +
        escShareText(work.title || '（未命名作品）') + '</div>' +
      '<div class="swc-rule"><i></i>' +
        '<img class="swc-mark" src="' + escShareText(getShareLogoUrl()) + '" alt="今视广告">' +
      '<i></i></div>' +
    '</div>' +
    '<div class="swc-thumb">' +
      (cover ? '<img src="' + escShareText(cover) + '" alt="' + escShareText(work.title || '') +
               '" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
      chips +
    '</div>' +
    '<div class="swc-foot">' +
      '<div class="swc-foot-left">' +
        '<div class="swc-meta">' + meta + '</div>' +
        '<div class="swc-tag">今视广告 · 全景展馆</div>' +
      '</div>' +
      '<div class="swc-qrbox">' +
        '<div class="swc-qr" id="shareWorkQr"></div>' +
        '<div class="swc-qrcap">扫码看全景</div>' +
      '</div>' +
    '</div>';
}

// 把卡片渲染进分享弹层。容器不存在时静默跳过（老页面不报错）。
function renderShareCard(work) {
  const box = document.getElementById('shareWorkCard');
  if (!box) return;
  box.innerHTML = buildShareCardHtml(work);
  box.style.display = work ? '' : 'none';
}

// ── 画布绘图辅助（私有前缀 sp，避免与 app.js / admin.js 里的同名函数打架）──
function spRound(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
// 带阴影的白卡。save/restore 包住阴影状态，避免污染后续绘制。
function spPlate(ctx, x, y, w, h, r, blur) {
  ctx.save();
  ctx.shadowColor = 'rgba(16,32,48,0.10)';
  ctx.shadowBlur = blur || 16;
  ctx.shadowOffsetY = Math.round((blur || 16) / 3);
  ctx.fillStyle = '#ffffff';
  spRound(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();
}
function spChip(ctx, x, y, text, bg, fg, h, opts) {
  h = h || 40; opts = opts || {};
  ctx.save();
  ctx.font = 'bold 22px ' + SHARE_FONT;
  const w = Math.round(ctx.measureText(text).width + 32);
  const left = opts.align === 'right' ? x - w : x;
  ctx.fillStyle = bg; spRound(ctx, left, y, w, h, h / 2); ctx.fill();
  if (opts.outlined) { ctx.strokeStyle = 'rgba(30,136,229,0.22)'; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 16, y + h / 2 + 1);
  ctx.restore();
  return w;
}
function spEllipsis(ctx, text, maxWidth) {
  const s = String(text == null ? '' : text);
  if (ctx.measureText(s).width <= maxWidth) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}
// 自动折行。y 是「首行基线」，返回「下一块内容的基线」。
function spWrap(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text == null ? '' : text).split('');
  let line = '', ly = y, n = 0;
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (line && ctx.measureText(test).width > maxWidth) {
      n++;
      if (n >= maxLines) {
        ctx.fillText(spEllipsis(ctx, line + chars.slice(i).join(''), maxWidth), x, ly);
        return ly + lineHeight;
      }
      ctx.fillText(line, x, ly);
      line = chars[i]; ly += lineHeight;
    } else { line = test; }
  }
  ctx.fillText(line, x, ly);
  return ly + lineHeight;
}
// 图片加载：先试 CORS，失败再退回普通加载（imgbb 等图床不保证 CORS）。
function spLoadImage(url, timeout) {
  return new Promise(function (resolve, reject) {
    if (!url) { reject(new Error('no url')); return; }
    function attempt(useCors) {
      const img = new Image();
      if (useCors) img.crossOrigin = 'anonymous';
      const timer = setTimeout(function () { img.src = ''; done(false); }, timeout || 10000);
      function done(okFlag) {
        clearTimeout(timer);
        if (okFlag) { resolve(img); return; }
        if (useCors) attempt(false); else reject(new Error('failed'));
      }
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      img.src = url;
    }
    attempt(true);
  });
}
// 生成二维码元素（qrcodejs 是异步渲染的，这里轮询等它画好，比固定 sleep 快）
function spMakeQr(text, size) {
  return new Promise(function (resolve, reject) {
    if (typeof QRCode === 'undefined') { reject(new Error('no qrcode lib')); return; }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:' + size + 'px;height:' + size + 'px;';
    document.body.appendChild(host);
    function cleanup() { if (host.parentNode) host.parentNode.removeChild(host); }
    try {
      new QRCode(host, {
        text: text, width: size, height: size,
        colorDark: SHARE_INK, colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
    } catch (e) { cleanup(); reject(e); return; }
    let waited = 0;
    (function poll() {
      const el = host.querySelector('canvas') || host.querySelector('img');
      const ready = el && ((el.tagName === 'CANVAS' && el.width > 0) ||
                           (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0));
      if (ready) { cleanup(); resolve(el); return; }
      waited += 60;
      if (waited > 2400) { cleanup(); reject(new Error('qr timeout')); return; }
      setTimeout(poll, 60);
    })();
  });
}

// 生成分享海报（750×1334），返回 canvas。
// 版面顺序与分享弹层卡片一致：居中标题 → 细线夹小 LOGO 点缀 → 缩略图 → 作者/日期/分类
// →（空间够才画简介）→ 底部二维码区。二维码区反向锚定在底边 —— 标题 1 行还是 2 行都不会把二维码挤出画面。
async function renderSharePoster(work, shareUrl) {
  const W = 750, H = 1334;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const M = 44, CW = W - M * 2;

  // 底色：与站点 --bg-dark / --surface 同族的极浅冷灰
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#f7f9fc'); g.addColorStop(0.55, '#f2f5f9'); g.addColorStop(1, '#eaeff6');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.5, -160, 40, W * 0.5, -160, 520);
  glow.addColorStop(0, 'rgba(30,136,229,0.16)'); glow.addColorStop(1, 'rgba(30,136,229,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 520);

  let y = M;

  // ── 作品名称（居中，最多 2 行）—— 与分享弹层卡片同一个顺序：标题在最上
  ctx.save();
  ctx.fillStyle = SHARE_INK; ctx.font = 'bold 44px ' + SHARE_FONT;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  y = spWrap(ctx, work.title || '（未命名作品）', W / 2, y + 18, CW, 58, 2);
  ctx.restore();
  y += 6;

  // ── 一条细线夹一枚「小」LOGO 点缀（与弹层卡片同款）。
  //    ⚠ 以前是一整条 104px 高的白卡 + 62px 高的 LOGO，太抢戏；参考稿里 LOGO 只是一点点缀。
  const markH = 30;
  let markW = markH * (620 / 150);
  let markImg = null;
  try { markImg = await spLoadImage(getShareLogoUrl()); } catch (e) { markImg = null; }
  if (markImg && markImg.naturalWidth && markImg.naturalHeight) {
    markW = markH * (markImg.naturalWidth / markImg.naturalHeight);
  }
  const markMid = y + markH / 2;
  ctx.save();
  ctx.strokeStyle = SHARE_LINE; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(M + 40, markMid); ctx.lineTo(W / 2 - markW / 2 - 20, markMid);
  ctx.moveTo(W / 2 + markW / 2 + 20, markMid); ctx.lineTo(W - M - 40, markMid);
  ctx.stroke();
  ctx.restore();
  if (markImg) ctx.drawImage(markImg, W / 2 - markW / 2, y, markW, markH);
  y += markH + 30;

  // ── 场景缩略图（16:9 圆角）
  const th = Math.round(CW * 9 / 16);
  const cover = getWorkCoverUrl(work);
  ctx.save(); spRound(ctx, M, y, CW, th, 24); ctx.clip();
  let drew = false;
  if (cover) {
    try { ctx.drawImage(await spLoadImage(cover), M, y, CW, th); drew = true; } catch (e) { drew = false; }
  }
  if (!drew) { ctx.fillStyle = 'rgba(30,136,229,0.12)'; ctx.fillRect(M, y, CW, th); }
  ctx.restore();

  spChip(ctx, M + 20, y + 20, getWorkTypeLabel(work), 'rgba(30,136,229,0.94)', '#ffffff', 40);
  const sceneCount = (work.scenes && work.scenes.length) || 1;
  if (sceneCount > 1) {
    spChip(ctx, M + CW - 20, y + 20, sceneCount + ' 场景', 'rgba(255,255,255,0.92)', SHARE_INK, 40, { align: 'right' });
  }
  y += th + 46;

  // ── 作者 · 日期
  y += 46;
  const author = getWorkAuthor(work);
  const date = getWorkDateText(work);
  let cx = M;
  if (author) {
    const d0 = 46, cy = y + d0 / 2;
    ctx.save();
    ctx.fillStyle = SHARE_BRAND;
    ctx.beginPath(); ctx.arc(cx + d0 / 2, cy, d0 / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px ' + SHARE_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(author)[0].toUpperCase(), cx + d0 / 2, cy + 1);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = SHARE_INK; ctx.font = '26px ' + SHARE_FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const nameMax = 300;
    const nameShown = spEllipsis(ctx, author, nameMax);
    ctx.fillText(nameShown, cx + d0 + 16, cy);
    cx += d0 + 16 + ctx.measureText(nameShown).width + 18;
    ctx.restore();
  }
  if (date) {
    ctx.save();
    ctx.font = '24px ' + SHARE_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    if (author) {
      ctx.fillStyle = SHARE_LINE; ctx.fillText('·', cx, y + 23);
      cx += ctx.measureText('·').width + 12;
    }
    ctx.fillStyle = SHARE_MUTED;
    ctx.fillText('📅 ' + date, cx, y + 23);
    ctx.restore();
  }
  y += 46 + 44;

  // ── 分类芯片
  const catName = (typeof getCatName === 'function') ? getCatName(work.category) : '';
  if (catName) {
    spChip(ctx, M, y, catName, 'rgba(30,136,229,0.12)', SHARE_BRAND_T, 40, { outlined: true });
    y += 40 + 34;
  }

  // ── 底部二维码区（反向锚定在底边）
  const qrPlate = 274, qrSize = 226;
  const footBase = H - 44;
  const hintY = footBase - 30;
  const plateY = hintY - 30 - qrPlate;

  // 简介：space 不够就自动省略，绝不挤掉二维码
  if (work.desc && (plateY - 46 - y) > 92) {
    ctx.save();
    ctx.fillStyle = SHARE_INK2; ctx.font = '22px ' + SHARE_FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    spWrap(ctx, work.desc, M, y, CW, 34, 2);
    ctx.restore();
  }

  ctx.strokeStyle = SHARE_LINE; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M, plateY - 34); ctx.lineTo(M + CW, plateY - 34); ctx.stroke();

  spPlate(ctx, (W - qrPlate) / 2, plateY, qrPlate, qrPlate, 24, 16);
  if (shareUrl) {
    try {
      const qrEl = await spMakeQr(shareUrl, qrSize);
      ctx.drawImage(qrEl, (W - qrSize) / 2, plateY + (qrPlate - qrSize) / 2, qrSize, qrSize);
    } catch (e) { /* 二维码失败不阻断整张海报 */ }
  }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = SHARE_INK2; ctx.font = '24px ' + SHARE_FONT;
  ctx.fillText('长按识别二维码 · 查看全景作品', W / 2, hintY);
  ctx.fillStyle = SHARE_MUTED; ctx.font = '20px ' + SHARE_FONT;
  ctx.fillText('今视广告线上展馆 · 全景展馆', W / 2, footBase);
  ctx.restore();

  return canvas;
}
