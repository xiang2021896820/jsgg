// ============================================================
//  全景VR展示平台 - 访客页面逻辑 (app.js)
//  纯查看模式：作品浏览、全景查看、分享、访客记录
// ============================================================

// ── 分享链接基础URL ─────────────────────────────────────
// 始终使用线上部署地址，本地打开也能正常生成分享链接
// 注意：本项目已作为「全景效果图」案例并入主站，访问路径为 /vr/
function getShareBaseUrl() {
  // 主机无关：基于当前页面地址推导，兼容 GitHub Pages 子路径 / 自定义域名 / surge
  return new URL('index.html', location.href).href;
}

// ── 状态管理 ─────────────────────────────────────────────
const State = {
  currentCategory: 'all',
  searchKeyword: '',
  displayedCount: 0,
  pageSize: 6,
  currentWorkId: null,
  currentSceneIdx: 0,
  myWorks: [],          // 包含分享过来的临时作品
  categories: [],
  visitorId: '',        // 访客唯一ID
  visitorNickname: '',  // 访客昵称
  // 深链：主站首屏 banner 点「进入该场景」过来时，指定作品与场景
  pendingWorkId: null,
  pendingSceneIdx: 0,
  openMode: '',         // '' | 'share'（?data=） | 'work'（?work=&scene=）
};

// ── IndexedDB（v3：访客记录 + 黑名单 + 设置）──────────────
const DB_NAME = 'vr_panorama_db';
const DB_VERSION = 3;
const STORE_WORKS = 'works';
const STORE_CATS = 'categories';
const STORE_VISITORS = 'visitor_logs';
const STORE_BLACKLIST = 'blacklist';
const STORE_SETTINGS = 'settings';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_WORKS)) {
        const ws = db.createObjectStore(STORE_WORKS, { keyPath: 'id' });
        ws.createIndex('date', 'date', { unique: false });
        ws.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CATS)) {
        db.createObjectStore(STORE_CATS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_VISITORS)) {
        const vs = db.createObjectStore(STORE_VISITORS, { keyPath: 'id', autoIncrement: true });
        vs.createIndex('visitorId', 'visitorId', { unique: false });
        vs.createIndex('visitTime', 'visitTime', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_BLACKLIST)) {
        db.createObjectStore(STORE_BLACKLIST, { keyPath: 'visitorId' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAddVisitorLog(log) { return dbPut(STORE_VISITORS, log); }
async function dbGetAllBlacklist() { return dbGetAll(STORE_BLACKLIST); }
async function dbGetAllCats() { return dbGetAll(STORE_CATS); }
async function dbPutCat(cat) { return dbPut(STORE_CATS, cat); }

// ── 工具函数 ──────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function formatNumber(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000)  return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function getCatName(catId) {
  const cat = State.categories.find(c => c.id === catId);
  return cat ? cat.name : catId;
}

function getWorkPanorama(work) {
  if (work.scenes && work.scenes.length > 0) return work.scenes[0].panorama;
  return work.panorama || work.thumb || '';
}

// ── 访客身份 ─────────────────────────────────────────────
function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function detectDeviceInfo() {
  var ua = navigator.userAgent;
  var isMob = isMobile();

  // 解析设备名
  var deviceName = '';
  if (isMob) {
    // 手机：尝试从UA提取设备型号
    var match = ua.match(/;\s*([^;)]+)\s*Build\//);
    if (match) {
      deviceName = match[1].trim();
    } else if (/iPhone/.test(ua)) {
      var iphoneMatch = ua.match(/iPhone\s*OS\s*([\d_]+)/);
      deviceName = 'iPhone' + (iphoneMatch ? ' iOS' + iphoneMatch[1].replace(/_/g, '.') : '');
    } else if (/iPad/.test(ua)) {
      deviceName = 'iPad';
    } else {
      deviceName = '手机';
    }
  } else {
    // 电脑：提取操作系统
    if (/Windows/.test(ua)) {
      var winMatch = ua.match(/Windows NT ([\d.]+)/);
      deviceName = 'Windows' + (winMatch ? ' ' + winMatch[1] : '');
    } else if (/Mac OS X/.test(ua)) {
      var macMatch = ua.match(/Mac OS X ([\d_]+)/);
      deviceName = 'macOS' + (macMatch ? ' ' + macMatch[1].replace(/_/g, '.') : '');
    } else if (/Linux/.test(ua)) {
      deviceName = 'Linux';
    } else {
      deviceName = '电脑';
    }
  }

  return {
    isMobile: isMob,
    deviceName: deviceName,
    platform: isMob ? '手机' : '电脑',
  };
}

function getOrCreateVisitorId() {
  var vid = localStorage.getItem('vr_visitor_id');
  if (!vid) {
    vid = 'v_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('vr_visitor_id', vid);
  }
  State.visitorId = vid;
  return vid;
}

// 自动获取访客标识：手机取设备名+微信信息，电脑取设备名+IP
async function autoDetectVisitorName() {
  // 如果已经设置过标识，直接返回
  var existing = localStorage.getItem('vr_visitor_name');
  if (existing) {
    State.visitorNickname = existing;
    return existing;
  }

  var info = detectDeviceInfo();
  var nameParts = [info.deviceName];

  if (info.isMobile) {
    // 手机：尝试获取微信信息
    // 微信内置浏览器的UA包含 MicroMessenger/版本号
    var wxMatch = navigator.userAgent.match(/MicroMessenger\/([\d.]+)/);
    if (wxMatch) {
      nameParts.push('微信' + wxMatch[1]);
    }
  } else {
    // 电脑：尝试获取IP地址
    try {
      var resp = await fetch('https://api.ipify.org?format=json');
      var data = await resp.json();
      if (data.ip) {
        nameParts.push(data.ip);
      }
    } catch (e) {
      // IP获取失败，跳过
    }
  }

  var name = nameParts.filter(Boolean).join(' · ');
  if (!name) name = info.platform + '访客';

  localStorage.setItem('vr_visitor_name', name);
  State.visitorNickname = name;
  return name;
}

// ── 访客记录：远端同步 ────────────────────────────────────
// IndexedDB 是「按设备 / 按浏览器」隔离的存储：手机上的浏览记录只会写进手机的
// 浏览器里，管理员在自己电脑上打开后台读的是另一份库，所以永远看不到手机访客。
// 为支持跨设备查看，这里额外把记录同步到远端一个共享键（纯静态站点没有自己的后端）。
const VISIT_SYNC_KEY = 'vrpv_visits_2p8hyet0pwpxw3ahp68m2sal';
const VISIT_SYNC_BASE = 'https://textdb.online';
const VISIT_SYNC_MAX = 300; // 远端最多保留最近 300 条，避免体积过大

async function syncVisitToRemote(log) {
  try {
    // 远端没有「列出所有键」的接口，只能把整个列表存在一个键里 → 先读后写
    let list = [];
    try {
      const res = await fetch(VISIT_SYNC_BASE + '/' + VISIT_SYNC_KEY + '?_=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const txt = (await res.text()).trim();
        if (txt) {
          const parsed = JSON.parse(txt);
          if (Array.isArray(parsed)) list = parsed;
        }
      }
    } catch (e) { /* 首条记录/内容为空 → 从空数组开始 */ }

    list.push({
      visitorId: log.visitorId,
      nickname: log.nickname,
      workId: log.workId,
      workTitle: log.workTitle,
      visitTime: log.visitTime,
      device: log.device,
      deviceName: log.deviceName,
    });
    if (list.length > VISIT_SYNC_MAX) list = list.slice(list.length - VISIT_SYNC_MAX);

    const body = new URLSearchParams();
    body.set('key', VISIT_SYNC_KEY);
    body.set('value', JSON.stringify(list));
    await fetch(VISIT_SYNC_BASE + '/update', { method: 'POST', body });
  } catch (e) { /* 远端不可用时静默降级，本地记录依然有效 */ }
}

// ── 访客记录写入 ─────────────────────────────────────────
async function recordVisit(workId, workTitle) {
  var info;
  try { info = detectDeviceInfo(); } catch (e) { info = { platform: '未知', deviceName: '' }; }
  var log = {
    visitorId: State.visitorId || getOrCreateVisitorId(),
    nickname: State.visitorNickname || localStorage.getItem('vr_visitor_name') || '',
    workId: String(workId),
    workTitle: workTitle || '',
    visitTime: new Date().toISOString(),
    device: info.platform,
    deviceName: info.deviceName,
    ua: (navigator.userAgent || '').substring(0, 200),
  };
  // 远端同步先发起：它与本地 IndexedDB 写入互不阻塞。
  // （IndexedDB 在某些环境下可能很慢或被禁用，不能让它挡住跨设备同步）
  syncVisitToRemote(log);
  try { await dbAddVisitorLog(log); } catch (e) { /* 本地写入失败不影响浏览 */ }
}

// ── 黑名单检查（跨设备）──────────────────────────────────
// 黑名单也存在「按设备隔离」的问题：管理员在自己电脑上拉黑某访客后，
// 对方用手机访问时读的是手机本地的黑名单（里面是空的），所以完全拦不住。
// 这里改为「本地 + 远端共享黑名单」一起判断，并用 localStorage 缓存减少网络等待。
const BLOCK_SYNC_KEY = 'vrpv_blocklist_tahuggn4454aatb31bd7ivq4';
const BLOCK_SYNC_BASE = 'https://textdb.online';
const BLOCK_CACHE_KEY = 'vr_remote_blocklist';
const BLOCK_CACHE_TTL = 10 * 60 * 1000; // 缓存 10 分钟

function readBlockCache() {
  try {
    var o = JSON.parse(localStorage.getItem(BLOCK_CACHE_KEY) || 'null');
    if (!o || !Array.isArray(o.list)) return null;
    if (Date.now() - (o.t || 0) > BLOCK_CACHE_TTL) return null;
    return o.list;
  } catch (e) { return null; }
}
function writeBlockCache(list) {
  try { localStorage.setItem(BLOCK_CACHE_KEY, JSON.stringify({ t: Date.now(), list: list })); } catch (e) { /* ignore */ }
}
async function fetchRemoteBlocklist(timeoutMs) {
  try {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 4000);
    var opts = { cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    var res = await fetch(BLOCK_SYNC_BASE + '/' + BLOCK_SYNC_KEY + '?_=' + Date.now(), opts);
    clearTimeout(timer);
    if (!res.ok) return null;
    var txt = (await res.text()).trim();
    if (!txt) return [];
    var arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return null; }
}
function showBlockedPage() {
  var blockedEl = document.getElementById('blockedPage');
  if (blockedEl && blockedEl.parentNode) blockedEl.parentNode.removeChild(blockedEl);
  if (!blockedEl) { blockedEl = document.createElement('div'); blockedEl.id = 'blockedPage'; }
  document.body.innerHTML = ''; // 清掉页面内容，避免被拦截后还能看到作品
  document.body.style.background = '#0d0d1a';
  document.body.appendChild(blockedEl);
  blockedEl.style.display = 'flex';
  blockedEl.className = 'blocked-page';
  blockedEl.innerHTML = '<div class="blocked-card"><div class="blocked-icon">🚫</div><h2>该内容不对外开放</h2><p>抱歉，您没有权限查看此内容</p></div>';
}

async function checkBlacklist() {
  try {
    var vid = State.visitorId || getOrCreateVisitorId();
    var hit = function (b) { return b && b.visitorId === vid; };

    // 1) 本机黑名单（最快）
    var local = [];
    try { local = await dbGetAllBlacklist(); } catch (e) { local = []; }
    if (local.some(hit)) { showBlockedPage(); return true; }

    // 2) 远端黑名单：有可用缓存就先按缓存判断（零等待），同时后台静默刷新
    var cached = readBlockCache();
    if (cached) {
      if (cached.some(hit)) { showBlockedPage(); return true; }
      fetchRemoteBlocklist(6000).then(function (r) { if (r) writeBlockCache(r); });
      return false;
    }

    // 3) 首次访问 / 缓存过期：拉一次远端，带超时避免拖慢首屏
    //    （拉到后写入缓存，之后 10 分钟内都走缓存，不再有网络等待）
    var remote = await fetchRemoteBlocklist(1800);
    if (remote) {
      writeBlockCache(remote);
      if (remote.some(hit)) { showBlockedPage(); return true; }
    }
  } catch (e) { /* 检查失败不拦截 */ }
  return false; // 未被拦截
}

// ── 页面导航 ──────────────────────────────────────────────
function scrollToGallery() {
  document.getElementById('gallerySection')?.scrollIntoView({ behavior: 'smooth' });
}

// ── 分类渲染 ──────────────────────────────────────────────
async function loadCategories() {
  let cats = await dbGetAllCats();
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) { await dbPutCat(c); }
    cats = [...DEFAULT_CATEGORIES];
  }
  State.categories = cats.sort((a, b) => (a.order || 0) - (b.order || 0));
  renderCategoryTabs();
}

function renderCategoryTabs() {
  const container = document.getElementById('categoryTabs');
  if (!container) return;
  let html = `<button class="tab-btn ${State.currentCategory === 'all' ? 'active' : ''}" data-cat="all">全部</button>`;
  State.categories.forEach(c => {
    html += `<button class="tab-btn ${State.currentCategory === c.id ? 'active' : ''}" data-cat="${c.id}">${c.icon || ''} ${c.name}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.currentCategory = btn.dataset.cat;
      State.displayedCount = 0;
      renderWorksGrid();
    });
  });
}

// ── 作品展示 ──────────────────────────────────────────────
function getFilteredWorks() {
  const myWorks = Array.isArray(State.myWorks) ? State.myWorks : [];
  const allWorks = State.myWorks;
  const kw = State.searchKeyword.trim().toLowerCase();
  return allWorks.filter(w => {
    // 访客端只列「公开」作品（'链接访问'/'私密' 不应出现在作品广场；
    // 它们仍可通过对应的分享/深链直接打开）
    if (typeof isPublicWork === 'function' && !isPublicWork(w)) return false;
    const catMatch = State.currentCategory === 'all' || w.category === State.currentCategory;
    if (!catMatch) return false;
    if (!kw) return true;
    return ((w.title && w.title.toLowerCase().includes(kw)) ||
      (w.author && w.author.toLowerCase().includes(kw)) ||
      (w.desc && w.desc.toLowerCase().includes(kw)) ||
      (w.tags && w.tags.some(t => t.toLowerCase().includes(kw))));
  });
}

function buildWorkCard(work) {
  const badgeHtml = work.badge
    ? `<span class="card-badge ${work.badge}">${work.badge === 'hot' ? '🔥 热门' : '✨ 最新'}</span>`
    : '';
  const sceneCount = (work.scenes && work.scenes.length) || 1;
  const sceneTag = sceneCount > 1 ? `<span class="card-scene-count">${sceneCount}场景</span>` : '';
  // 作品类型标签
  const typeLabel = work.type === 'image' ? '🖼 图片' : work.type === 'video' ? '🎬 视频' : work.type === 'article' ? '📝 图文' : '🌐 VR';
  const isLiked = localStorage.getItem('vr_liked_' + work.id);

  const coverUrl = getWorkCoverUrl(work);
  const panoSrc = getWorkCoverSource(work);
  const authorName = getWorkAuthor(work); // 「匿名」等占位值视为没有作者
  const logoHtml = work.logo
    ? `<img class="card-logo" src="${work.logo}" alt="logo" onerror="this.style.display='none'">`
    : `<div class="card-logo card-logo-text">${(authorName || 'VR')[0].toUpperCase()}</div>`;
  // 只有真正有作者名称时才展示作者区域
  const authorHtml = authorName
    ? `<div class="card-author"><div class="author-avatar">${authorName[0]}</div><span>${authorName}</span></div>`
    : '';
  return `
    <div class="work-card" onclick="openViewer('${work.id}')">
      <div class="card-thumb">
        <img class="card-cover-img" src="${coverUrl}" data-pano="${panoSrc}" alt="${work.title}" loading="lazy" onerror="this.style.background='var(--bg-card2)';this.removeAttribute('data-pano')">
        <div class="card-cover-grad"></div>
        <div class="card-overlay"><div class="play-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21"/></svg></div></div>
        ${logoHtml}
        ${badgeHtml}
        <div class="card-vr-icon">${typeLabel}</div>
        ${sceneTag}
        <span class="card-scene-label">主场景</span>
      </div>
      <div class="card-body">
        <div class="card-title" title="${work.title}">${work.title}</div>
        <div class="card-meta">
          ${authorHtml}
          <div class="card-stats">
            <span title="浏览">👁 ${formatNumber(work.views || 0)}</span>
            <span title="点赞" class="like-count ${isLiked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike('${work.id}')">❤ ${formatNumber(work.likes || 0)}</span>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="card-cat-tag">${getCatName(work.category)}</span>
        <div class="card-action-btns">
          <button class="card-act-btn view" onclick="event.stopPropagation();openViewer('${work.id}')">▶ 查看</button>
          <button class="card-act-btn share" onclick="event.stopPropagation();openShareModal('${work.id}')">↗ 分享</button>
        </div>
      </div>
    </div>`;
}

function buildSkeletonCards(n = 6) {
  return Array.from({ length: n }, () => `
    <div class="work-card" style="pointer-events:none">
      <div class="card-thumb skeleton" style="aspect-ratio:2/1"></div>
      <div class="card-body"><div class="skeleton" style="height:18px;width:70%;margin-bottom:10px;border-radius:4px"></div><div class="skeleton" style="height:14px;width:50%;border-radius:4px"></div></div>
      <div class="card-footer"><div class="skeleton" style="height:22px;width:60px;border-radius:20px"></div></div>
    </div>`).join('');
}

function renderWorksGrid(append = false) {
  const grid = document.getElementById('worksGrid');
  if (!grid) return;
  const filtered = getFilteredWorks();
  if (!append) {
    grid.innerHTML = buildSkeletonCards();
    State.displayedCount = 0;
    setTimeout(() => {
      grid.innerHTML = '';
      const slice = filtered.slice(0, State.pageSize);
      State.displayedCount = slice.length;
      if (slice.length === 0) {
        const noWorksAtAll = State.myWorks.length === 0 && State.currentCategory === 'all' && !State.searchKeyword.trim();
        grid.innerHTML = noWorksAtAll
          ? `<div class="empty-state">
               <div class="empty-icon">🛰️</div>
               <h3>还没有全景作品</h3>
               <p>打开管理后台，上传你的第一张全景图吧</p>
               <a class="empty-cta" href="admin.html" target="_blank">前往管理后台 →</a>
             </div>`
          : `<div class="empty-state"><div class="empty-icon">🔍</div><h3>暂无匹配作品</h3><p>试试其他关键词或分类</p></div>`;
      } else {
        slice.forEach(w => grid.insertAdjacentHTML('beforeend', buildWorkCard(w)));
        enhanceCoverImages(grid);
      }
      const loadBtn = document.getElementById('loadMoreBtn');
      if (loadBtn) loadBtn.style.display = State.displayedCount >= filtered.length ? 'none' : '';
    }, 300);
  } else {
    const slice = filtered.slice(State.displayedCount, State.displayedCount + State.pageSize);
    slice.forEach(w => grid.insertAdjacentHTML('beforeend', buildWorkCard(w)));
    State.displayedCount += slice.length;
    enhanceCoverImages(grid);
    const loadBtn = document.getElementById('loadMoreBtn');
    if (loadBtn) loadBtn.style.display = State.displayedCount >= filtered.length ? 'none' : '';
  }
}

function loadMoreWorks() { renderWorksGrid(true); }

function filterWorks() {
  State.searchKeyword = document.getElementById('searchInput')?.value || '';
  State.displayedCount = 0;
  renderWorksGrid();
}

// ══════════════════════════════════════════════════════════
//  全景查看器
// ══════════════════════════════════════════════════════════

function openViewer(workId, sceneIdx) {
  const myWorks = Array.isArray(State.myWorks) ? State.myWorks : [];
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == workId);
  if (!work) { showToast('作品不存在', 'error'); return; }

  // 目标场景：优先用深链指定的场景（越界则夹到合法范围）
  var scenes = work.scenes || [];
  var idx = parseInt(sceneIdx, 10);
  if (isNaN(idx) || idx < 0) idx = 0;
  if (idx > scenes.length - 1) idx = Math.max(0, scenes.length - 1);

  State.currentWorkId = workId;
  State.currentSceneIdx = idx;
  work.views = (work.views || 0) + 1;

  // 记录访客访问
  recordVisit(workId, work.title);

  // 非VR类型作品：图片/图文/视频直接打开图片预览
  var workType = work.type || 'panorama';
  if (workType === 'image' || workType === 'article') {
    openImageViewer(work);
    return;
  }
  if (workType === 'video') {
    showToast('视频作品即将上线');
    return;
  }

  // VR全景模式：直接载入目标场景
  const scene = scenes[idx] || {};
  Viewer.loadPanorama(scene.panorama || getWorkPanorama(work), {
    title: work.title, author: getWorkAuthor(work),
    sceneTitle: scene.title || ('场景 ' + (idx + 1)),
    // 初始视角只对第一个场景有意义，其余场景保持默认朝向
    initialRotation: idx === 0 ? (work.initialRotation || null) : null,
    hotspots: scene.hotspots || [],
    musicUrl: work.musicUrl || '',
    work: work,
    onSceneSwitch: (i) => switchScene(i),
    onCommentToggle: () => toggleCommentPanel(),
  });
  renderSceneNav(work);
}

// ── 图片/图文作品查看器 ──────────────────────────────────
function openImageViewer(work) {
  var overlay = document.getElementById('viewerOverlay');
  if (!overlay) return;
  // 设置标题
  document.getElementById('viewerTitle').textContent = work.title || '图片作品';
  // 只有真正有作者名称时才显示作者元素
  var authorEl = document.getElementById('viewerAuthor');
  if (authorEl) {
    var aName = getWorkAuthor(work);
    authorEl.textContent = aName ? '✍ ' + aName : '';
    authorEl.style.display = aName ? '' : 'none';
  }
  document.getElementById('viewerSceneTitle').style.display = 'none';
  // 隐藏3D画布，显示图片
  var canvas = document.getElementById('vrCanvas');
  if (canvas) canvas.style.display = 'none';
  // 创建或获取图片容器
  var imgContainer = document.getElementById('imageViewerContainer');
  if (!imgContainer) {
    imgContainer = document.createElement('div');
    imgContainer.id = 'imageViewerContainer';
    imgContainer.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:rgba(0,0,0,0.9);z-index:1;';
    var container = overlay.querySelector('.viewer-container');
    if (container) container.insertBefore(imgContainer, container.querySelector('.viewer-loading'));
  }
  imgContainer.innerHTML = `<img src="${work.thumb || work.panorama}" style="max-width:95%;max-height:90vh;object-fit:contain;border-radius:8px" alt="${work.title}">`;
  imgContainer.style.display = 'flex';
  // 隐藏3D控制栏
  var ctrlToggle = document.getElementById('ctrlToggle');
  if (ctrlToggle) ctrlToggle.style.display = 'none';
  var sceneNav = document.getElementById('sceneNav');
  if (sceneNav) sceneNav.style.display = 'none';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function renderSceneNav(work) {
  const nav = document.getElementById('sceneNav');
  if (!nav) return;
  if (!work.scenes || work.scenes.length <= 1) { nav.style.display = 'none'; return; }
  nav.style.display = 'flex';
  nav.innerHTML = work.scenes.map((s, i) => `
    <div class="scene-thumb ${i === State.currentSceneIdx ? 'active' : ''}" onclick="switchScene(${i})"
         onpointerenter="prewarmScene(${i}, event)" title="${s.title || '场景 ' + (i+1)}">
      <img src="${s.thumb || work.thumb}" alt="${s.title || ''}" loading="lazy">
      <span class="scene-label">${s.title || '场景 ' + (i+1)}</span>
    </div>`).join('');
}

// 鼠标移到某个场景缩略图上 → 提前把它解码成纹理，点下去就是瞬时的。
// （只对鼠标生效；触屏的 pointerenter 没有"悬停"含义，提前解码反而浪费）
function prewarmScene(idx, ev) {
  try {
    if (ev && ev.pointerType && ev.pointerType !== 'mouse') return;
    if (typeof Viewer === 'undefined' || !Viewer.warmScene) return;
    const work = (State.myWorks || []).find(w => w.id == State.currentWorkId);
    const sc = work && work.scenes && work.scenes[idx];
    if (sc && sc.panorama) Viewer.warmScene(sc.panorama);
  } catch (e) { /* 预热失败不影响正常切换 */ }
}

function switchScene(idx) {
  const myWorks = Array.isArray(State.myWorks) ? State.myWorks : [];
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == State.currentWorkId);
  if (!work || !work.scenes || !work.scenes[idx]) return;
  State.currentSceneIdx = idx;
  const scene = work.scenes[idx];
  Viewer.loadPanorama(scene.panorama, {
    title: work.title, author: getWorkAuthor(work),
    sceneTitle: scene.title || ('场景 ' + (idx + 1)),
    hotspots: scene.hotspots || [],
    musicUrl: work.musicUrl || '',
    work: work,
    onSceneSwitch: (i) => switchScene(i),
    onCommentToggle: () => toggleCommentPanel(),
  });
  document.querySelectorAll('.scene-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

// ══════════════════════════════════════════════════════════
//  点赞 & 评论
// ══════════════════════════════════════════════════════════

function toggleLike(workId) {
  var key = 'vr_liked_' + workId;
  var isLiked = localStorage.getItem(key);
  if (isLiked) {
    localStorage.removeItem(key);
    showToast('已取消点赞');
  } else {
    localStorage.setItem(key, '1');
    showToast('❤️ 已点赞', 'success');
  }
  renderWorksGrid();
}

function getComments(workId) {
  try {
    return JSON.parse(localStorage.getItem('vr_comments_' + workId) || '[]');
  } catch (e) { return []; }
}

function saveComment(workId, text) {
  var comments = getComments(workId);
  comments.push({
    id: 'c_' + Date.now(),
    nickname: State.visitorNickname || localStorage.getItem('vr_visitor_name') || '匿名访客',
    text: text,
    time: new Date().toISOString(),
    visitorId: State.visitorId || '',
  });
  localStorage.setItem('vr_comments_' + workId, JSON.stringify(comments));
}

// ── 评论侧边面板 ──────────────────────────────────────
function toggleCommentPanel() {
  var panel = document.getElementById('commentPanel');
  if (!panel) return;
  var isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    renderComments();
    panel.classList.add('open');
  }
  var btn = document.getElementById('btnComment');
  if (btn) btn.classList.toggle('active', !isOpen);
}

function renderComments() {
  var list = document.getElementById('commentList');
  if (!list) return;
  var comments = getComments(State.currentWorkId);
  if (!comments || comments.length === 0) {
    list.innerHTML = '<div class="comment-empty">还没有评论，快来抢沙发 ~</div>';
    return;
  }
  list.innerHTML = comments.map(function(c) {
    return '<div class="comment-item">' +
      '<div class="comment-avatar">' + escapeComment((c.nickname || '匿')[0]) + '</div>' +
      '<div class="comment-body">' +
        '<div class="comment-meta"><span class="comment-nick">' + escapeComment(c.nickname || '匿名访客') + '</span><span class="comment-time">' + formatCommentTime(c.time) + '</span></div>' +
        '<div class="comment-text">' + escapeComment(c.text) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
}

function sendComment() {
  var input = document.getElementById('commentInput');
  if (!input) return;
  var text = input.value.trim();
  if (!text) { showToast('请输入评论内容', 'error'); return; }
  saveComment(State.currentWorkId, text);
  input.value = '';
  renderComments();
  showToast('评论成功', 'success');
}

function escapeComment(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatCommentTime(iso) {
  try {
    var d = new Date(iso);
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + '天前';
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  } catch (e) { return ''; }
}

// ══════════════════════════════════════════════════════════
//  分享功能
// ══════════════════════════════════════════════════════════

let shareQRInstance = null;

function encodeShareData(work) {
  var minimal = {
    t: work.title || '', a: work.author || '', c: work.category || '',
    d: work.desc || '',
    s: (work.scenes || []).map(function(s) { return { t: s.title || '', p: s.panorama || '', h: s.thumb || '' }; }),
    th: work.thumb || '',
  };
  return LZString.compressToEncodedURIComponent(JSON.stringify(minimal));
}

function decodeShareData(encoded) {
  try {
    var json = LZString.decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    var m = JSON.parse(json);
    return {
      id: 'shared_' + Date.now(), title: m.t || '分享的全景作品', author: m.a || '',
      category: m.c || '', desc: m.d || '',
      thumb: m.th || (m.s && m.s[0] && m.s[0].h) || '',
      views: 0, likes: 0, date: new Date().toISOString().slice(0, 10),
      tags: [], status: 'published', privacy: 'public', isLocal: false,
      scenes: (m.s || []).map(function(s) {
        return { id: 's_' + Date.now() + '_' + Math.random(), title: s.t || '场景 1', panorama: s.p || '', thumb: s.h || s.p || '' };
      }),
    };
  } catch (e) { return null; }
}

function openShareModal(workId) {
  var myWorks = Array.isArray(State.myWorks) ? State.myWorks : [];
  var allWorks = State.myWorks;
  var work = allWorks.find(w => w.id == workId);
  if (!work) return;

  State.currentWorkId = workId;

  // 弹层顶部的作品卡片（场景缩略图 + 名称 + 作者 + 时间 + 今视广告 LOGO）。
  // 结构与转义都在 data.js 的 buildShareCardHtml()，后台 admin.js 调同一个函数。
  renderShareCard(work);

  var baseUrl = getShareBaseUrl();
  var encodedData = encodeShareData(work);
  var vid = State.visitorId || getOrCreateVisitorId();
  var shareUrl = baseUrl + '?data=' + encodedData + '&vid=' + vid;

  const urlInput = document.getElementById('shareUrl');
  if (urlInput) urlInput.value = shareUrl;

  // 二维码现在长在卡片右下角（data.js 的 buildShareCardHtml() 产出 #shareWorkQr）；
  // 保留 #shareQR 兜底，防止结构不匹配的旧缓存页面拿不到容器。
  const qrContainer = document.getElementById('shareWorkQr') || document.getElementById('shareQR');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    try {
      // 画布按 2 倍出图（280），再用 CSS 缩到 140 显示 —— 分享链接里塞了整份作品数据，
      // 二维码模块很密，降采样比 1:1 出图清晰，更好扫。
      shareQRInstance = new QRCode(qrContainer, { text: shareUrl, width: 280, height: 280, colorDark: '#1a1a3e', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } catch (e) {
      qrContainer.innerHTML = '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:8px;font-size:0.7rem;color:#666">二维码生成失败</div>';
    }
  }
  document.getElementById('shareOverlay')?.classList.add('open');
}

function closeShare() { document.getElementById('shareOverlay')?.classList.remove('open'); }

function copyShareUrl() {
  const input = document.getElementById('shareUrl');
  if (!input || !input.value || input.value.startsWith('需部署')) {
    showToast('无法复制分享链接', 'error'); return;
  }
  navigator.clipboard?.writeText(input.value)
    .then(() => showToast('链接已复制', 'success'))
    .catch(() => { input.select(); document.execCommand('copy'); showToast('链接已复制', 'success'); });
}

function shareToWechat() {
  var myWorks = Array.isArray(State.myWorks) ? State.myWorks : [];
  var allWorks = State.myWorks;
  var work = allWorks.find(w => w.id == State.currentWorkId);
  if (!work) return;
  showToast('正在生成分享海报...');
  generateSharePoster(work).then(() => showToast('长按海报保存后分享', 'success')).catch(() => showToast('海报生成失败', 'error'));
}

function shareToMoments() { shareToWechat(); }

async function generateSharePoster(work) {
  var baseUrl = getShareBaseUrl();
  var shareUrl = baseUrl + '?data=' + encodeShareData(work) + '&vid=' + (State.visitorId || '');
  // 海报版面与绘制统一在 data.js 的 renderSharePoster()（后台 admin.js 调同一份），
  // 避免两边各写一套、改一处忘一处。
  var canvas = await renderSharePoster(work, shareUrl);
  showPosterPreview(canvas);
}

function showPosterPreview(posterCanvas) {
  closeShare();
  var overlay = document.getElementById('posterOverlay');
  var container = document.getElementById('posterPreview');
  if (!overlay || !container) return;
  container.innerHTML = '';
  var img = document.createElement('img');
  try { img.src = posterCanvas.toDataURL('image/jpeg', 0.92); }
  catch (e) { posterCanvas.style.maxWidth = '100%'; posterCanvas.style.borderRadius = '12px'; container.appendChild(posterCanvas); overlay.classList.add('open'); return; }
  img.style.maxWidth = '100%'; img.style.borderRadius = '12px'; img.id = 'posterImg';
  container.appendChild(img); overlay.classList.add('open');
}

function closePoster() { document.getElementById('posterOverlay')?.classList.remove('open'); }

function downloadPoster() {
  var img = document.querySelector('#posterPreview img#posterImg');
  if (img && img.src && img.src.startsWith('data:')) {
    var a = document.createElement('a'); a.href = img.src; a.download = 'VR全景分享海报.jpg'; a.click();
    showToast('海报已下载', 'success');
  } else { showToast('请长按海报图片保存', 'success'); }
}

// 绘图辅助
function loadImage(url, timeout) {
  timeout = timeout || 10000;
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var timer = setTimeout(function() { img.src = ''; reject(new Error('timeout')); }, timeout);
    img.crossOrigin = 'anonymous';
    img.onload = function() { clearTimeout(timer); resolve(img); };
    img.onerror = function() {
      clearTimeout(timer);
      var img2 = new Image();
      var timer2 = setTimeout(function() { img2.src = ''; reject(new Error('timeout')); }, timeout);
      img2.onload = function() { clearTimeout(timer2); resolve(img2); };
      img2.onerror = function() { clearTimeout(timer2); reject(new Error('failed')); };
      img2.src = url;
    };
    img.src = url;
  });
}

function drawImageSafe(ctx, img, x, y, w, h) {
  try { ctx.drawImage(img, x, y, w, h); } catch (e) { ctx.fillStyle = 'rgba(108,99,255,0.15)'; ctx.fillRect(x, y, w, h); }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function roundRectFill(ctx, x, y, w, h, r) { roundRect(ctx, x, y, w, h, r); ctx.fill(); }

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = text.split(''); let line = '', lineY = y, lineCount = 0;
  for (let i = 0; i < chars.length; i++) {
    const testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      lineCount++; if (lineCount >= 3) { ctx.fillText(line.trim() + '...', x, lineY); return; }
      ctx.fillText(line, x, lineY); line = chars[i]; lineY += lineHeight;
    } else { line = testLine; }
  }
  ctx.fillText(line, x, lineY);
}

// ── URL 参数处理 ──────────────────────────────────────────
// ── 作品索引（远端共享键，与 admin.js / 主站首屏 banner 三方约定）──────
// 主站 banner 用 ?work=<id>&scene=<n> 深链过来时，访客设备本地没有该作品，
// 需要从这份远端索引把作品还原出来（只有全景图与场景标题，够查看器用）。
const WORKS_INDEX_KEY = 'vrpv_works_qhhxo4k6lyr6ehcbjqt4gphx';
const WORKS_INDEX_BASE = 'https://textdb.online';

async function fetchWorksIndexRemote(timeoutMs) {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 2500) : null;
    const url = WORKS_INDEX_BASE + '/' + WORKS_INDEX_KEY + '?_=' + Date.now();
    const res = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (timer) clearTimeout(timer);
    if (!res.ok) return [];
    const txt = (await res.text()).trim();
    if (!txt) return [];
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// ── 作品「全量数据」远端读取（跨设备可见）──────────────────
// IndexedDB 按浏览器隔离：换一台电脑（或清过站点数据）本机库是空的，
// 作品广场就没内容。这里从远端把作品全量数据取回来，**只在内存里合并**，
// 不写回本机库（避免在访客设备上攒出一份会过期的本地副本）。
// 取数/推送函数在 js/data.js（后台也用同一套，避免两边逻辑漂移）：
// fetchWorksDataRemote / pushWorksDataRemote / worksSyncSignature

// 把远端作品/分类合并进 State（本机已有的优先，按 id 去重）
function mergeRemoteWorksIntoState(remote) {
  if (!remote) return 0;
  const dead = {};
  (remote.deleted || []).forEach(id => { dead[String(id)] = 1; });

  const have = {};
  State.myWorks.forEach(w => { if (w && w.id != null) have[String(w.id)] = 1; });

  let added = 0;
  (remote.works || []).forEach(w => {
    if (!w || w.id == null) return;
    const k = String(w.id);
    if (have[k] || dead[k]) return;
    if (!Array.isArray(w.scenes) || !w.scenes.length) {
      if (!w.panorama && !w.thumb) return;
      w.scenes = [{ id: 's_legacy', title: '场景 1', panorama: w.panorama || w.thumb, thumb: w.thumb || w.panorama }];
    }
    w.fromRemote = true;
    State.myWorks.push(w);
    have[k] = 1;
    added++;
  });

  if (remote.cats && remote.cats.length) {
    State.categories = Array.isArray(State.categories) ? State.categories : [];
    remote.cats.forEach(c => {
      if (!c || c.id == null) return;
      if (!State.categories.some(x => String(x.id) === String(c.id))) State.categories.push(c);
    });
    State.categories.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  return added;
}

// ── 本机有作品就自动推一次（关键！）──────────────────────
// 之前只有「打开后台并登录」才会推送 → 极易出现「本机能看、换台电脑什么都没有」。
// 改成：任何页面打开时，只要这台设备的本机库里有作品、而远端还不是最新，就自动推。
// 普通访客本机库是空的 → 永远不会触发写入；只有真正上传过作品的设备才会推。
async function syncLocalWorksIfNeeded(localWorks, remote) {
  if (!Array.isArray(localWorks) || !localWorks.length) return null;
  if (typeof pushWorksDataRemote !== 'function') return null;

  const localSig = worksSyncSignature(localWorks);
  const remoteSig = remote ? worksSyncSignature(remote.works) : '';
  let pushedSig = '';
  try { pushedSig = localStorage.getItem(WORKS_PUSHED_SIG_LS) || ''; } catch (e) { /* ignore */ }

  // 远端已经和本机一致 → 不用推；读不到远端但上次已推过同一份 → 也不用推
  if (remoteSig && remoteSig === localSig) return null;
  if (!remote && pushedSig === localSig) return null;

  const r = await pushWorksDataRemote(localWorks, State.categories, { timeoutMs: 8000 });
  if (r && r.ok) {
    console.log('[vr] 已把本机 ' + r.count + ' 个作品同步到云端（换设备也能看到）');
    // 顺手更新首页 banner 索引，否则访客的首页首屏会没有内容
    try { await pushWorksIndexRemote(localWorks); } catch (e) { /* ignore */ }
  } else if (r && r.reason === 'too-big') {
    console.warn('[vr] 作品数据 ' + Math.round((r.bytes || 0) / 1024) + 'KB 超过同步上限，未推送');
  }
  return r;
}

// 把远端索引条目还原成查看器能用的 work 结构
function workFromIndexItem(item) {
  if (!item) return null;
  var scenes = [];
  if (Array.isArray(item.sc) && item.sc.length) {
    scenes = item.sc
      .map(function (s, i) {
        var pano = (s && (s.p || s.panorama)) || '';
        if (!pano) return null;
        return {
          id: 's_' + i,
          title: (s && s.t) || ('场景 ' + (i + 1)),
          panorama: pano,
          thumb: pano,
        };
      })
      .filter(Boolean);
  } else if (item.pano) {
    // 兼容旧版索引（只有首场景图）
    scenes = [{ id: 's_0', title: '场景 1', panorama: item.pano, thumb: item.pano }];
  }
  if (!scenes.length) return null;
  return {
    id: item.id,
    title: item.t || '全景作品',
    author: '',
    category: '', desc: '',
    thumb: scenes[0].thumb,
    views: 0, likes: 0,
    date: new Date().toISOString().slice(0, 10),
    tags: [], status: 'published', privacy: 'public',
    isLocal: false, fromIndex: true,
    scenes: scenes,
  };
}

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);

  // ── 1) work + scene 深链（主站首屏 banner 的「进入该场景」）──
  const workId = params.get('work');
  if (workId) {
    const s = parseInt(params.get('scene'), 10);
    State.pendingWorkId = workId;
    State.pendingSceneIdx = isNaN(s) || s < 0 ? 0 : s;
    State.openMode = 'work';
    // 作品若已在本机库中，resolvePendingWork 会直接命中；否则去远端索引还原
    return true;
  }

  // ── 2) data 参数（跨设备分享链接 / 旧二维码）──
  // 兼容历史链接：token 里的 '+' 会被 URLSearchParams 解析成空格，这里换回来
  const rawData = params.get('data');
  const encodedData = rawData ? rawData.replace(/ /g, '+') : '';
  if (encodedData) {
    var work = decodeShareData(encodedData);
    if (work && work.scenes && work.scenes.length > 0) {
      // 标记为分享模式，避免 init 后续重复渲染和昵称弹窗干扰
      State.shareMode = true;
      State.openMode = 'share';
      State.myWorks.unshift(work);
      // 关键：把分享作品也登记为「待打开目标」，否则 init 里定位不到它
      State.pendingWorkId = work.id;
      const s2 = parseInt(params.get('scene'), 10);
      State.pendingSceneIdx = isNaN(s2) || s2 < 0 ? 0 : s2;
      return true;
    } else {
      showToast('分享链接数据解析失败', 'error');
    }
  }

  // 处理 vid 参数（访客ID，从分享链接带过来的）
  const vid = params.get('vid');
  if (vid && !localStorage.getItem('vr_visitor_id')) {
    localStorage.setItem('vr_visitor_id', vid);
    State.visitorId = vid;
  }
  return false;
}

// 深链目标作品的定位：本机库 → 远端作品索引
async function resolvePendingWork() {
  const id = State.pendingWorkId;
  if (!id) return null;
  const local = (State.myWorks || []).find(w => String(w.id) === String(id));
  if (local && local.scenes && local.scenes.length) return local;

  const idx = await fetchWorksIndexRemote(2500);
  const item = (idx || []).find(x => x && String(x.id) === String(id));
  const built = workFromIndexItem(item);
  if (built) {
    State.myWorks.unshift(built); // 让查看器/场景条能找到它
    return built;
  }
  return null;
}

// ── 弹窗关闭 ──────────────────────────────────────────────
function initOverlayClose() {
  const overlayCloseMap = {
    shareOverlay: closeShare,
    posterOverlay: closePoster,
  };
  Object.entries(overlayCloseMap).forEach(([id, closeFn]) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeFn();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeShare(); closePoster(); closeViewer(); }
  });
}

// ── 初始化 ────────────────────────────────────────────────
async function init() {
  // 生成访客ID
  getOrCreateVisitorId();
  // 自动获取访客标识（设备名+微信/IP）
  await autoDetectVisitorName();

  // 黑名单检查
  var blocked = await checkBlacklist();
  if (blocked) return; // 被拦截，不继续初始化

  // 加载分类
  await loadCategories();

  // 加载本地作品（IndexedDB）；同时并行拉取远端全量作品，换台电脑也有内容
  var remoteWorksPromise = fetchWorksDataRemote(6000);
  try {
    var localWorks = await dbGetAll(STORE_WORKS);
    State.myWorks = Array.isArray(localWorks) ? localWorks : [];
  } catch (e) { State.myWorks = []; }
  var remotePayload = null;
  try {
    remotePayload = await remoteWorksPromise;
    var addedFromRemote = mergeRemoteWorksIntoState(remotePayload);
    if (addedFromRemote) console.log('[vr] 已从远端合并 ' + addedFromRemote + ' 个作品');
  } catch (e) { /* 远端不可用时仅展示本机作品 */ }

  // 本机有作品、而远端还不是最新 → 后台静默推一次（不必登录后台）。
  // 刻意不 await：推送要读一次远端再写，不能拖慢作品广场的首屏。
  try {
    if (typeof syncLocalWorksIfNeeded === 'function') {
      var pushP = syncLocalWorksIfNeeded(localWorks, remotePayload);
      if (pushP && pushP.catch) pushP.catch(function () { /* 静默 */ });
    }
  } catch (e) { /* ignore */ }

  // URL参数处理 — 分享链接(?data=) 或 主站深链(?work=&scene=) 都在这里解析
  var hasTarget = handleUrlParams();

  // 渲染作品列表
  renderWorksGrid();

  // 弹窗关闭
  initOverlayClose();

  if (hasTarget) {
    // ── 深链/分享：直接打开目标作品的「指定场景」──
    // 本机库没有该作品时（访客设备），会从远端作品索引还原
    var target = await resolvePendingWork();
    if (target) {
      var openIdx = State.pendingSceneIdx || 0;
      // openViewer 内部已记录访客访问，这里不再重复计数
      (function (w, ix) {
        setTimeout(function () { openViewer(w.id, ix); }, 800);
      })(target, openIdx);
    } else if (State.openMode === 'work') {
      showToast('未找到该全景作品，已返回作品广场', 'error');
    }
  }

  // 搜索防抖
  let searchTimer;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(filterWorks, 300);
    });
  }

  // 评论输入框回车发送
  const commentInput = document.getElementById('commentInput');
  if (commentInput) {
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendComment(); }
    });
  }

  // 页面访问记录（不是分享链接/深链进来时，记录一次首页访问）
  if (!hasTarget) {
    recordVisit('home', '首页访问');
  }
}

document.addEventListener('DOMContentLoaded', init);
