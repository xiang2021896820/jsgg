// ============================================================
//  全景VR展示平台 - 管理后台逻辑 (admin.js)
//  支持：密码保护、作品管理、访客记录、黑名单、GitHub 仓库图片存储
// ============================================================

// ── 分享链接基础URL ─────────────────────────────────────
// 始终使用线上部署地址作为分享链接，确保本地访问也能正常分享
// 注意：本项目已作为「全景效果图」案例并入主站，访问路径为 /vr/
function getShareBaseUrl() {
  // 主机无关：基于当前页面地址推导，兼容 GitHub Pages 子路径 / 自定义域名 / surge
  return new URL('index.html', location.href).href;
}

// ── 状态管理 ─────────────────────────────────────────────
const State = {
  currentPage: 'works',
  currentManageTab: 'all',
  currentViewMode: 'card-lg', // card-lg, card-sm, list, chart
  tags: [],
  selectedFiles: [],
  selectedObjectURLs: [],
  currentWorkId: null,
  currentSceneIdx: 0,
  myWorks: [],
  searchTerm: '',
  categories: [],
  isUploading: false,
  editingWorkId: null,
  editScenes: [],
  editTags: [],
  editObjectURLs: [],
};

// ── IndexedDB（升级版 v3：新增 visitor_logs、blacklist、settings）──
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
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// 快捷方法
async function dbGetAllWorks() { return dbGetAll(STORE_WORKS); }
async function dbPutWork(work) { return dbPut(STORE_WORKS, work); }
async function dbDeleteWork(id) { return dbDelete(STORE_WORKS, id); }
async function dbGetAllCats() { return dbGetAll(STORE_CATS); }
async function dbPutCat(cat) { return dbPut(STORE_CATS, cat); }
async function dbDeleteCat(id) { return dbDelete(STORE_CATS, id); }
async function dbGetAllVisitors() { return dbGetAll(STORE_VISITORS); }
async function dbAddVisitorLog(log) { return dbPut(STORE_VISITORS, log); }
async function dbClearVisitorLogs() { return dbClear(STORE_VISITORS); }
async function dbGetAllBlacklist() { return dbGetAll(STORE_BLACKLIST); }
async function dbAddBlacklist(item) { return dbPut(STORE_BLACKLIST, item); }
async function dbRemoveBlacklist(visitorId) { return dbDelete(STORE_BLACKLIST, visitorId); }
async function dbGetSetting(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}
async function dbSetSetting(key, value) {
  return dbPut(STORE_SETTINGS, { key, value });
}

// ── GitHub 上传配置（图片直接提交到仓库，同源 GitHub Pages 加载，免图床加速）──
// 令牌由管理员在「系统设置」中粘贴，存于本机 localStorage（不写进源码）。
async function getGithubToken() { return GHUpload.getToken(); }
async function setGithubToken(t) { GHUpload.setToken(t); }

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

function genId() { return Date.now() + Math.floor(Math.random() * 1000); }

function getWorkPanorama(work) {
  if (work.scenes && work.scenes.length > 0) return work.scenes[0].panorama;
  return work.panorama || work.thumb || '';
}

// ── 分享数据编解码 ───────────────────────────────────────
function encodeShareData(work) {
  var minimal = {
    t: work.title || '',
    a: getWorkAuthor(work), // 「匿名」等占位值不写入分享数据
    c: work.category || '',
    d: work.desc || '',
    s: (work.scenes || []).map(function(s) {
      return { t: s.title || '', p: s.panorama || '', h: s.thumb || '' };
    }),
    th: work.thumb || '',
  };
  var json = JSON.stringify(minimal);
  return LZString.compressToEncodedURIComponent(json);
}

// ── 管理员密码 ──────────────────────────────────────────
async function getAdminPassword() {
  return await dbGetSetting('admin_password');
}

async function setAdminPassword(pwd) {
  await dbSetSetting('admin_password', pwd);
}

async function unlockAdmin() {
  var pwdInput = document.getElementById('adminPassword');
  var pwd = pwdInput ? pwdInput.value.trim() : '';
  if (!pwd) { showToast('请输入密码', 'error'); return; }

  var storedPwd = await getAdminPassword();
  if (!storedPwd) {
    // 首次设置密码
    await setAdminPassword(pwd);
    showAdminApp();
    showToast('密码设置成功', 'success');
  } else if (pwd === storedPwd) {
    showAdminApp();
  } else {
    showToast('密码错误', 'error');
    pwdInput.value = '';
    pwdInput.focus();
  }
}

async function checkAdminLock() {
  // 统一后台（/admin.html）内嵌模式：父页已通过密码锁屏并置 jsgg_admin_authed，
  // 此处免重复锁屏，直接进后台。直接打开本页（未从统一后台进入）仍走正常锁屏。
  try {
    var _p = new URLSearchParams(location.search);
    if (_p.get('embed') === '1' && sessionStorage.getItem('jsgg_admin_authed') === '1') {
      showAdminApp();
      return;
    }
  } catch (e) { /* ignore */ }

  // 检查10分钟会话保持
  var sessionLoginTime = sessionStorage.getItem('vr_admin_login_time');
  if (sessionLoginTime) {
    var elapsed = Date.now() - parseInt(sessionLoginTime, 10);
    if (elapsed < 10 * 60 * 1000) { // 10分钟内
      showAdminApp();
      return;
    }
    sessionStorage.removeItem('vr_admin_login_time'); // 过期清除
  }

  var storedPwd = await getAdminPassword();
  var lockscreen = document.getElementById('adminLockscreen');
  var hint = document.getElementById('lockHint');
  var tip = document.getElementById('lockTip');
  if (!storedPwd) {
    if (hint) hint.textContent = '首次使用，请设置管理员密码';
    if (tip) tip.textContent = '此密码用于保护后台数据，请牢记';
  } else {
    if (hint) hint.textContent = '请输入管理员密码';
    if (tip) tip.textContent = '';
  }
  // 回车提交
  document.getElementById('adminPassword')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockAdmin();
  });
}

function showAdminApp() {
  // 记录登录时间（会话保持10分钟）
  sessionStorage.setItem('vr_admin_login_time', String(Date.now()));
  document.getElementById('adminLockscreen').style.display = 'none';
  // 关键：必须移除行内 display，否则会覆盖 css/editor.css 里 .wb-app{display:flex}，
  // 导致 .wb-main 掉到侧边栏下方、内容区被挤出视口（表现为“右侧一片空白”）
  document.getElementById('adminApp').style.removeProperty('display');
  initAdminApp();
}

// 统一后台（/admin.html）内嵌时，父页解锁后通过 postMessage 通知本页免重复锁屏。
// 用 postMessage 而非共享 sessionStorage：跨 iframe 的 sessionStorage 在部分浏览器不共享，
// 而 postMessage 仅在本页被内嵌且父页已解锁时才会收到，会话级、不会持久化泄露。
try {
  window.addEventListener('message', function (e) {
    try {
      if (e && e.data && e.data.type === 'jsgg_admin_authed') {
        var _ep = new URLSearchParams(location.search);
        if (_ep.get('embed') === '1') showAdminApp();
      }
    } catch (err) { /* ignore */ }
  });
} catch (e) { /* ignore */ }

// ── 页面切换 ──────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: '工作台', works: '作品管理', upload: '上传作品',
  visitors: '访客记录', settings: '系统设置',
};
function switchPage(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('page-active'));
  const target = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
  if (target) target.classList.add('page-active');

  document.querySelectorAll('.wb-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const titleEl = document.getElementById('wbPageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || '管理后台';

  State.currentPage = page;
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}

  try {
    if (page === 'works') { State.currentManageTab = 'all'; document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.dataset.status === 'all')); renderManageGrid(); }
    if (page === 'upload') { resetUploadForm(); renderCategoryOptions(); }
    if (page === 'visitors') renderVisitorPage();
    if (page === 'settings') renderSettingsPage();
    if (page === 'dashboard') renderDashboard();
    if (page === 'models') m3dLoad();
  } catch (e) {
    console.error('switchPage render failed for', page, e);
  }
}

// ── 导航栏 ────────────────────────────────────────────────
function initHeader() {
  document.querySelectorAll('.wb-nav-item').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); switchPage(el.dataset.page); });
  });
}

// ══════════════════════════════════════════════════════════
//  分类 CRUD
// ══════════════════════════════════════════════════════════

async function loadCategories() {
  let cats = await dbGetAllCats();
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) { await dbPutCat(c); }
    cats = [...DEFAULT_CATEGORIES];
  }
  State.categories = cats.sort((a, b) => (a.order || 0) - (b.order || 0));
  renderCategoryOptions();
}

function renderCategoryOptions() {
  const sel = document.getElementById('workCategory');
  const editSel = document.getElementById('editWorkCategory');
  [sel, editSel].forEach(s => {
    if (!s) return;
    const current = s.value;
    s.innerHTML = '<option value="">请选择分类</option>';
    State.categories.forEach(c => {
      s.innerHTML += `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`;
    });
    if (current) s.value = current;
  });
}

async function addCatFromSettings() {
  const input = document.getElementById('settingsNewCat');
  const name = input?.value.trim();
  if (!name) { showToast('请输入分类名称', 'error'); return; }
  if (State.categories.some(c => c.name === name)) { showToast('分类已存在', 'error'); return; }
  const id = 'cat_' + Date.now();
  const cat = { id, name, icon: '📁', order: State.categories.length };
  await dbPutCat(cat);
  State.categories.push(cat);
  input.value = '';
  renderSettingsPage();
  renderCategoryOptions();
  showToast('分类已添加', 'success');
}

async function deleteCatFromSettings(catId) {
  const cat = State.categories.find(c => c.id === catId);
  if (!cat) return;
  if (!confirm(`确定删除分类"${cat.name}"吗？`)) return;
  await dbDeleteCat(catId);
  State.categories = State.categories.filter(c => c.id !== catId);
  renderSettingsPage();
  renderCategoryOptions();
  showToast('分类已删除', 'success');
}

// ══════════════════════════════════════════════════════════
//  作品管理
// ══════════════════════════════════════════════════════════

function renderManageGrid() {
  const grid = document.getElementById('manageGrid');
  if (!grid) return;

  const allWorks = State.myWorks;
  const filtered = allWorks.filter(w => {
    if (State.currentManageTab === 'all') return true;
    if (State.currentManageTab === 'published') return w.status === 'published';
    if (State.currentManageTab === 'draft') return w.status === 'draft';
    return true;
  }).filter(w => {
    if (!State.searchTerm) return true;
    const t = State.searchTerm.toLowerCase();
    return (w.title || '').toLowerCase().includes(t) || (w.author || '').toLowerCase().includes(t) || (w.category || '').toLowerCase().includes(t);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>暂无作品</h3><p>去上传你的第一个全景作品吧</p></div>`;
    grid.className = 'manage-grid';
    return;
  }

  // 根据视图模式渲染
  grid.className = 'manage-grid view-' + State.currentViewMode;

  if (State.currentViewMode === 'chart') {
    renderChartView(grid, filtered);
    return;
  }

  if (State.currentViewMode === 'list') {
    renderListView(grid, filtered);
    return;
  }

  // 卡片模式（大/小）
  const isSmall = State.currentViewMode === 'card-sm';
  grid.innerHTML = filtered.map(w => {
    const sceneCount = (w.scenes && w.scenes.length) || 1;
    const canEdit = true;
    const coverUrl = getWorkCoverUrl(w);
    const panoSrc = getWorkCoverSource(w);
    const logoHtml = w.logo
      ? `<img class="mcs-logo" src="${w.logo}" alt="logo" onerror="this.style.display='none'">`
      : '';
    if (isSmall) {
      return `
      <div class="manage-card-sm">
        <div class="mcs-thumb" onclick="openViewer('${w.id}')">
          <img src="${coverUrl}" data-pano="${panoSrc}" alt="${w.title}" loading="lazy" onerror="this.style.background='var(--bg-card2)';this.removeAttribute('data-pano')">
          ${logoHtml}
          <span class="mcs-scenes">${sceneCount}场景</span>
        </div>
        <div class="mcs-info">
          <div class="mcs-title">${w.title}</div>
          <div class="mcs-meta">👁 ${formatNumber(w.views||0)} · ${w.date || ''}</div>
          <div class="mcs-actions">
            <button class="ma-btn" onclick="openViewer('${w.id}')">▶</button>
            <button class="ma-btn" onclick="openShareModal('${w.id}')">↗</button>
            ${canEdit ? `<button class="ma-btn edit" onclick="openEditor('${w.id}')">✏️</button>` : ''}
            ${canEdit ? `<button class="ma-btn danger" onclick="deleteWork('${w.id}')">🗑</button>` : ''}
          </div>
        </div>
      </div>`;
    }
    return `
    <div class="manage-card">
      <div class="manage-thumb-wrap">
        <img class="manage-thumb" src="${coverUrl}" data-pano="${panoSrc}" alt="${w.title}" onerror="this.style.background='var(--bg-card2)';this.removeAttribute('data-pano')" loading="lazy">
        ${logoHtml}
        <span class="manage-scene-tag">主场景</span>
      </div>
      <div class="manage-body">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div class="manage-title" style="flex:1">${w.title}</div>
          <span class="status-badge ${w.status === 'draft' ? 'draft' : 'published'}">
            ${w.status === 'draft' ? '草稿' : '已发布'}
          </span>
        </div>
        <div class="manage-stats">
          <span>👁 ${formatNumber(w.views || 0)}</span>
          <span>❤ ${formatNumber(w.likes || 0)}</span>
          <span>📅 ${w.date || ''}</span>
          <span>🗂 ${getCatName(w.category)}</span>
          <span>🎬 ${sceneCount}场景</span>
        </div>
        <div class="manage-actions">
          <button class="ma-btn" onclick="openViewer('${w.id}')">▶ 预览</button>
          <button class="ma-btn" onclick="openShareModal('${w.id}')">↗ 分享</button>
          ${canEdit ? `<button class="ma-btn edit" onclick="openEditor('${w.id}')">✏️ 编辑</button>` : ''}
          ${canEdit ? `<button class="ma-btn danger" onclick="deleteWork('${w.id}')">🗑 删除</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
  enhanceCoverImages(grid);
}

// ── 列表视图 ──────────────────────────────────────────────
function renderListView(grid, works) {
  grid.innerHTML = `
    <div class="manage-list">
      <div class="ml-header">
        <span class="ml-col" style="width:40px">#</span>
        <span class="ml-col" style="flex:2">作品名称</span>
        <span class="ml-col" style="flex:1">分类</span>
        <span class="ml-col" style="width:80px">场景</span>
        <span class="ml-col" style="width:80px">浏览</span>
        <span class="ml-col" style="width:100px">日期</span>
        <span class="ml-col" style="width:80px">状态</span>
        <span class="ml-col" style="width:160px">操作</span>
      </div>
      ${works.map((w, i) => {
        const sceneCount = (w.scenes && w.scenes.length) || 1;
        const canEdit = true;
        const listCover = getWorkCoverUrl(w);
        const listPano = getWorkCoverSource(w);
        return `<div class="ml-row">
          <span class="ml-col" style="width:40px">${i + 1}</span>
          <span class="ml-col" style="flex:2">
            <div style="display:flex;align-items:center;gap:8px">
              <img src="${listCover}" data-pano="${listPano}" style="width:48px;height:28px;object-fit:cover;border-radius:4px" loading="lazy" onerror="this.style.display='none';this.removeAttribute('data-pano')">
              <span style="font-weight:600">${w.title}</span>
            </div>
          </span>
          <span class="ml-col" style="flex:1">${getCatName(w.category)}</span>
          <span class="ml-col" style="width:80px">${sceneCount}</span>
          <span class="ml-col" style="width:80px">${formatNumber(w.views || 0)}</span>
          <span class="ml-col" style="width:100px">${w.date || '-'}</span>
          <span class="ml-col" style="width:80px"><span class="status-badge ${w.status === 'draft' ? 'draft' : 'published'}">${w.status === 'draft' ? '草稿' : '已发布'}</span></span>
          <span class="ml-col" style="width:160px">
            <button class="ma-btn" onclick="openViewer('${w.id}')">▶</button>
            <button class="ma-btn" onclick="openShareModal('${w.id}')">↗</button>
            ${canEdit ? `<button class="ma-btn edit" onclick="openEditor('${w.id}')">✏️</button>` : ''}
            ${canEdit ? `<button class="ma-btn danger" onclick="deleteWork('${w.id}')">🗑</button>` : ''}
          </span>
        </div>`;
      }).join('')}
    </div>`;
  enhanceCoverImages(grid);
}
function renderChartView(grid, works) {
  var totalViews = works.reduce((s, w) => s + (w.views || 0), 0);
  var totalLikes = works.reduce((s, w) => s + (w.likes || 0), 0);
  var totalScenes = works.reduce((s, w) => s + ((w.scenes && w.scenes.length) || 1), 0);
  var maxViews = Math.max(...works.map(w => w.views || 0), 1);

  grid.innerHTML = `
    <div class="chart-view">
      <div class="chart-summary">
        <div class="cs-card"><div class="cs-num">${works.length}</div><div class="cs-label">作品总数</div></div>
        <div class="cs-card"><div class="cs-num">${totalViews}</div><div class="cs-label">总浏览量</div></div>
        <div class="cs-card"><div class="cs-num">${totalLikes}</div><div class="cs-label">总点赞</div></div>
        <div class="cs-card"><div class="cs-num">${totalScenes}</div><div class="cs-label">场景总数</div></div>
      </div>
      <h4 style="margin:20px 0 12px;font-size:0.95rem;color:var(--text-secondary)">📊 浏览量排行</h4>
      <div class="chart-bars">
        ${works.slice(0, 10).map(w => {
          var pct = Math.max(Math.round((w.views || 0) / maxViews * 100), 2);
          return `<div class="chart-bar-row">
            <span class="cbr-name">${w.title}</span>
            <div class="cbr-bar-wrap"><div class="cbr-bar" style="width:${pct}%"></div></div>
            <span class="cbr-val">${w.views || 0}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── 视图切换 ──────────────────────────────────────────────
function switchView(mode) {
  State.currentViewMode = mode;
  document.querySelectorAll('.vs-btn').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  renderManageGrid();
}

// ── 工作台概览 ──────────────────────────────────────────
function renderDashboard() {
  const works = State.myWorks;
  const totalViews = works.reduce((s, w) => s + (w.views || 0), 0);
  const totalLikes = works.reduce((s, w) => s + (w.likes || 0), 0);
  const totalScenes = works.reduce((s, w) => s + ((w.scenes && w.scenes.length) || 1), 0);
  const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setNum('wbStatWorks', works.length);
  setNum('wbStatViews', totalViews);
  setNum('wbStatLikes', totalLikes);
  setNum('wbStatScenes', totalScenes);

  const recent = document.getElementById('wbDashRecent');
  if (!recent) return;
  if (works.length === 0) {
    recent.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><h3>还没有作品</h3><p>点击右上角「新建作品」开始创作</p></div>`;
    return;
  }
  recent.innerHTML = works.slice(0, 4).map(w => {
    const cover = getWorkCoverUrl(w);
    const pano = getWorkCoverSource(w);
    const sc = (w.scenes && w.scenes.length) || 1;
    return `
    <div class="wb-recent-card">
      <div class="wb-recent-thumb" onclick="openViewer('${w.id}')">
        <img src="${cover}" data-pano="${pano}" alt="${w.title}" loading="lazy" onerror="this.style.background='var(--bg-card2)';this.removeAttribute('data-pano')">
        <span class="wb-recent-scenes">${sc} 场景</span>
      </div>
      <div class="wb-recent-body">
        <div class="wb-recent-title">${w.title}</div>
        <div class="wb-recent-meta">👁 ${formatNumber(w.views || 0)} · ${w.date || ''}</div>
        <div class="wb-recent-actions">
          <button class="ma-btn" onclick="openViewer('${w.id}')">▶</button>
          <button class="ma-btn" onclick="openShareModal('${w.id}')">↗</button>
          <button class="ma-btn edit" onclick="openEditor('${w.id}')">✏️</button>
        </div>
      </div>
    </div>`;
  }).join('');
  enhanceCoverImages(recent);
}

function wbSearchWorks(v) {
  State.searchTerm = (v || '').trim();
  if (State.currentPage !== 'works') switchPage('works');
  else renderManageGrid();
}

// ── 管理端查看器分享 ──────────────────────────────────────
function openAdminShare() {
  if (!State.currentWorkId) return;
  openShareModal(State.currentWorkId);
}

// ── 获取访客评论（后台可查看）─────────────────────────────
function getWorkComments(workId) {
  try {
    return JSON.parse(localStorage.getItem('vr_comments_' + workId) || '[]');
  } catch (e) { return []; }
}

// ── 获取所有作品评论统计 ──────────────────────────────────
function getAllCommentsStats() {
  var allWorks = State.myWorks;
  var stats = [];
  allWorks.forEach(w => {
    var comments = getWorkComments(w.id);
    if (comments.length > 0) {
      stats.push({ workId: w.id, title: w.title, count: comments.length, comments: comments });
    }
  });
  return stats;
}

async function deleteWork(workId) {
  if (!confirm('确定删除这个作品吗？此操作不可恢复。')) return;
  try { await dbDeleteWork(Number(workId)); } catch (e) { console.warn('IndexedDB delete failed:', e); }
  const idx = State.myWorks.findIndex(w => w.id == workId);
  if (idx > -1) {
    State.myWorks.splice(idx, 1);
    addDeletedWorkId(workId); // 记墓碑：否则远端那份会在下次合并时把它「复活」
    syncWorksIndexToRemote(); // 删除后同步，首页 banner 不再展示它
    syncWorksDataToRemote();  // 全量数据同步（含墓碑）
    renderManageGrid();
    showToast('作品已删除', 'success');
  } else {
    showToast('演示作品不可删除', 'error');
  }
}

function initManageTabs() {
  document.querySelectorAll('.mtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.currentManageTab = btn.dataset.status;
      renderManageGrid();
    });
  });
}

// ══════════════════════════════════════════════════════════
//  全景查看器
// ══════════════════════════════════════════════════════════

function openViewer(workId) {
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == workId);
  if (!work) { showToast('作品不存在', 'error'); return; }

  State.currentWorkId = workId;
  State.currentSceneIdx = 0;
  work.views = (work.views || 0) + 1;
  if (work.isLocal) dbPutWork(work).catch(() => {});

  const firstScene = (work.scenes && work.scenes[0]) || {};
  Viewer.loadPanorama(firstScene.panorama || getWorkPanorama(work), {
    title: work.title,
    author: getWorkAuthor(work),
    sceneTitle: firstScene.title || '场景 1',
  });
  renderSceneNav(work);
}

function renderSceneNav(work) {
  const nav = document.getElementById('sceneNav');
  if (!nav) return;
  if (!work.scenes || work.scenes.length <= 1) { nav.style.display = 'none'; return; }
  nav.style.display = 'flex';
  nav.innerHTML = work.scenes.map((s, i) => `
    <div class="scene-thumb ${i === State.currentSceneIdx ? 'active' : ''}" onclick="switchScene(${i})" title="${s.title || '场景 ' + (i+1)}">
      <img src="${s.thumb || work.thumb}" alt="${s.title || ''}" loading="lazy">
      <span class="scene-label">${s.title || '场景 ' + (i+1)}</span>
    </div>
  `).join('');
}

function switchScene(idx) {
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == State.currentWorkId);
  if (!work || !work.scenes || !work.scenes[idx]) return;
  State.currentSceneIdx = idx;
  const scene = work.scenes[idx];
  Viewer.loadPanorama(scene.panorama, {
    title: work.title, author: work.author,
    sceneTitle: scene.title || ('场景 ' + (idx + 1)),
  });
  document.querySelectorAll('.scene-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

// ══════════════════════════════════════════════════════════
//  分享功能
// ══════════════════════════════════════════════════════════

let shareQRInstance = null;

function openShareModal(workId) {
  var allWorks = State.myWorks;
  var work = allWorks.find(w => w.id == workId);
  if (!work) return;

  State.currentWorkId = workId;

  // 弹层顶部的作品卡片（场景缩略图 + 名称 + 作者 + 时间 + 今视广告 LOGO）。
  // 与访客端共用 data.js 的 buildShareCardHtml()，两边长得一样。
  renderShareCard(work);

  var baseUrl = getShareBaseUrl();
  // token 里可能出现 '+'，直接拼进查询串会被解析成空格 → 必须 encodeURIComponent
  var encodedData = encodeURIComponent(encodeShareData(work));
  var shareUrl = baseUrl + '?data=' + encodedData;

  const urlInput = document.getElementById('shareUrl');
  if (urlInput) urlInput.value = shareUrl;

  // 二维码现在长在卡片右下角（data.js 的 buildShareCardHtml() 产出 #shareWorkQr）；
  // 保留 #shareQR 兜底，防止结构不匹配的旧缓存页面拿不到容器。
  const qrContainer = document.getElementById('shareWorkQr') || document.getElementById('shareQR');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    if (!shareUrl) {
      qrContainer.innerHTML = '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:var(--bg-card2);border-radius:8px;font-size:0.7rem;color:var(--text-secondary)">无法生成二维码</div>';
    } else {
      try {
        // 画布按 2 倍出图（280），再用 CSS 缩到 140 显示 —— 分享链接里塞了整份作品数据，
        // 二维码模块很密，降采样比 1:1 出图清晰，更好扫。
        shareQRInstance = new QRCode(qrContainer, {
          text: shareUrl, width: 280, height: 280,
          colorDark: '#1a1a3e', colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
      } catch (e) {
        qrContainer.innerHTML = '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:8px;font-size:0.7rem;color:#666">二维码生成失败</div>';
      }
    }
  }
  document.getElementById('shareOverlay')?.classList.add('open');
}

function closeShare() { document.getElementById('shareOverlay')?.classList.remove('open'); }

function copyShareUrl() {
  const input = document.getElementById('shareUrl');
  if (!input || !input.value) return;
  navigator.clipboard?.writeText(input.value)
    .then(() => showToast('链接已复制到剪贴板', 'success'))
    .catch(() => { input.select(); document.execCommand('copy'); showToast('链接已复制', 'success'); });
}

function shareToWechat() {
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == State.currentWorkId);
  if (!work) return;
  showToast('正在生成分享海报...');
  generateSharePoster(work).then(() => {
    showToast('长按海报图片可保存到手机', 'success');
  }).catch(err => {
    console.error('Poster generation failed:', err);
    showToast('海报生成失败', 'error');
  });
}

function shareToMoments() { shareToWechat(); }

async function generateSharePoster(work) {
  var baseUrl = getShareBaseUrl();
  var shareUrl = baseUrl + '?data=' + encodeURIComponent(encodeShareData(work));
  // 海报版面与绘制统一在 data.js 的 renderSharePoster()（访客端 app.js 调同一份），
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
  try {
    img.src = posterCanvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    posterCanvas.style.maxWidth = '100%'; posterCanvas.style.borderRadius = '12px';
    container.appendChild(posterCanvas); overlay.classList.add('open'); return;
  }
  img.style.maxWidth = '100%'; img.style.borderRadius = '12px'; img.id = 'posterImg';
  container.appendChild(img); overlay.classList.add('open');
}

function closePoster() { document.getElementById('posterOverlay')?.classList.remove('open'); }

function downloadPoster() {
  var img = document.querySelector('#posterPreview img#posterImg');
  if (img && img.src && img.src.startsWith('data:')) {
    var a = document.createElement('a'); a.href = img.src; a.download = 'VR全景分享海报.jpg'; a.click();
    showToast('海报已下载', 'success');
  } else {
    showToast('请长按海报图片保存', 'success');
  }
}

// 辅助绘图函数
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

// ══════════════════════════════════════════════════════════
//  上传
// ══════════════════════════════════════════════════════════

function initFormatTabs() {
  document.querySelectorAll('.ftab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function initDropZone() {
  const zone = document.getElementById('dropZone');
  if (!zone) return;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) processFiles(files); else showToast('请拖入图片文件', 'error');
  });
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) processFiles(files);
}

function processFiles(files) {
  const allowed = files.slice(0, 20);
  State.selectedObjectURLs.forEach(u => URL.revokeObjectURL(u));
  State.selectedFiles = allowed; State.selectedObjectURLs = [];
  const previewArea = document.getElementById('previewArea');
  const previewGrid = document.getElementById('previewGrid');
  if (!previewArea || !previewGrid) return;
  previewGrid.innerHTML = '';
  allowed.forEach((file, idx) => {
    const objUrl = URL.createObjectURL(file);
    State.selectedObjectURLs.push(objUrl);
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb'; thumb.draggable = true; thumb.dataset.idx = idx;
    thumb.innerHTML = `
      <img src="${objUrl}" alt="${file.name}">
      <div class="preview-remove" onclick="removeUploadFile(${idx})" title="移除">✕</div>
      <div class="preview-info">
        <input class="preview-scene-name" type="text" value="场景 ${idx + 1}" placeholder="场景名称" onclick="event.stopPropagation()">
        <span class="preview-file-size">${(file.size/1024/1024).toFixed(1)}MB</span>
      </div>`;
    thumb.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', idx); thumb.classList.add('dragging'); });
    thumb.addEventListener('dragend', () => thumb.classList.remove('dragging'));
    thumb.addEventListener('dragover', (e) => e.preventDefault());
    thumb.addEventListener('drop', (e) => { e.preventDefault(); reorderFile(parseInt(e.dataTransfer.getData('text/plain')), idx); });
    previewGrid.appendChild(thumb);
  });
  previewArea.style.display = 'block';
}

function reorderFile(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const [file] = State.selectedFiles.splice(fromIdx, 1);
  const [url] = State.selectedObjectURLs.splice(fromIdx, 1);
  State.selectedFiles.splice(toIdx, 0, file);
  State.selectedObjectURLs.splice(toIdx, 0, url);
  processFiles(State.selectedFiles);
}

function removeUploadFile(idx) {
  if (State.selectedObjectURLs[idx]) URL.revokeObjectURL(State.selectedObjectURLs[idx]);
  State.selectedFiles.splice(idx, 1); State.selectedObjectURLs.splice(idx, 1);
  if (State.selectedFiles.length === 0) clearFiles(); else processFiles(State.selectedFiles);
}

function clearFiles() {
  State.selectedObjectURLs.forEach(u => URL.revokeObjectURL(u));
  State.selectedFiles = []; State.selectedObjectURLs = [];
  document.getElementById('previewArea').style.display = 'none';
  document.getElementById('previewGrid').innerHTML = '';
  const fi = document.getElementById('fileInput'); if (fi) fi.value = '';
}

function initCharCount() {
  const textarea = document.getElementById('workDesc');
  const counter = document.getElementById('descCount');
  if (textarea && counter) textarea.addEventListener('input', () => { counter.textContent = textarea.value.length + '/200'; });
}

function initPrivacyToggle() {
  document.querySelectorAll('input[name="privacy"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const pwGroup = document.getElementById('passwordGroup');
      if (pwGroup) pwGroup.style.display = radio.value === 'link' ? '' : 'none';
    });
  });
}

function addTag(e) {
  if (e.key !== 'Enter') return; e.preventDefault();
  const input = document.getElementById('tagInput'); const val = input?.value.trim();
  if (!val) return; if (State.tags.length >= 8) { showToast('最多添加8个标签'); return; }
  if (State.tags.includes(val)) { showToast('标签已存在'); return; }
  State.tags.push(val); renderTags(); if (input) input.value = '';
}

function removeTag(idx) { State.tags.splice(idx, 1); renderTags(); }

function renderTags() {
  const container = document.getElementById('tagsContainer');
  if (!container) return;
  container.innerHTML = State.tags.map((t, i) =>
    `<span class="tag">${t}<button onclick="removeTag(${i})" title="删除">✕</button></span>`
  ).join('');
}

async function uploadToGithub(file, onProgress) {
  if (!GHUpload.isConfigured()) throw new Error('请先在「系统设置 → GitHub 上传令牌」中配置令牌');
  return GHUpload.upload(file, onProgress);
}

async function submitWork() {
  if (State.isUploading) return;
  const title = document.getElementById('workTitle')?.value.trim();
  const category = document.getElementById('workCategory')?.value;
  const author = document.getElementById('workAuthor')?.value.trim() || '';
  const desc = document.getElementById('workDesc')?.value.trim() || '';
  const privacy = document.querySelector('input[name="privacy"]:checked')?.value || 'public';
  const agree = document.getElementById('agreeCheck')?.checked;
  if (!title) { showToast('请填写作品名称', 'error'); return; }
  if (!category) { showToast('请选择分类', 'error'); return; }
  if (State.selectedFiles.length === 0) { showToast('请选择图片', 'error'); return; }
  if (!agree) { showToast('请先同意用户协议', 'error'); return; }
  const apiKey = await getGithubToken();
  if (!apiKey) { showToast('请先在系统设置配置 GitHub 上传令牌', 'error'); return; }

  State.isUploading = true;
  const btn = document.querySelector('#pageUpload .btn-full');
  const progressEl = document.getElementById('uploadProgress');
  const bar = document.getElementById('progressBar');
  const tipEl = document.getElementById('uploadTip');
  const statusEl = document.getElementById('uploadStatus');
  if (btn) { btn.disabled = true; btn.textContent = '上传中...'; }
  if (progressEl) progressEl.style.display = 'block';
  if (bar) bar.style.width = '0%';

  try {
    const sceneNames = Array.from(document.querySelectorAll('.preview-scene-name')).map(i => i.value.trim() || '场景');
    const scenes = [];
    for (let i = 0; i < State.selectedFiles.length; i++) {
      if (tipEl) tipEl.textContent = `正在上传场景 ${i + 1}/${State.selectedFiles.length}...`;
      const pct = Math.round((i / State.selectedFiles.length) * 100);
      if (bar) bar.style.width = pct + '%';
      const result = await uploadToGithub(State.selectedFiles[i], (p) => {
        const totalPct = Math.round(((i + p / 100) / State.selectedFiles.length) * 100);
        if (bar) bar.style.width = totalPct + '%';
      });
      scenes.push({ id: 's_' + genId() + '_' + i, title: sceneNames[i] || ('场景 ' + (i + 1)), panorama: result.url, thumb: result.thumb || result.url });
    }
    if (bar) bar.style.width = '100%';

    const newWork = {
      id: genId(), title, author, category, desc, thumb: scenes[0]?.thumb || '',
      panorama: scenes[0]?.panorama || '',
      views: 0, likes: 0, date: new Date().toISOString().slice(0, 10),
      uploadedAt: Date.now(), // 精确上传时间（date 只到天，首页 banner 排序要用毫秒）
      tags: [...State.tags], status: 'published', badge: 'new', privacy, isLocal: true, scenes,
      type: document.querySelector('.ftab.active')?.dataset.fmt || 'panorama',
    };
    await dbPutWork(newWork);
    State.myWorks.unshift(newWork);
    syncWorksIndexToRemote(); // 同步作品索引，主站首屏 banner 会立刻用上
    syncWorksDataToRemote();  // 同步全量作品数据，换台电脑也能看到
    resetUploadForm();
    showToast('🎉 作品发布成功！', 'success');
    setTimeout(() => switchPage('works'), 800);
  } catch (err) {
    showToast('上传失败：' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🚀 发布作品'; }
    if (progressEl) progressEl.style.display = 'none';
  } finally { State.isUploading = false; }
}

function resetUploadForm() {
  const btn = document.querySelector('#pageUpload .btn-full');
  if (btn) { btn.disabled = false; btn.textContent = '🚀 发布作品'; }
  clearFiles();
  ['workTitle', 'workDesc', 'workAuthor'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const catEl = document.getElementById('workCategory'); if (catEl) catEl.value = '';
  const countEl = document.getElementById('descCount'); if (countEl) countEl.textContent = '0/200';
  const agreeEl = document.getElementById('agreeCheck'); if (agreeEl) agreeEl.checked = false;
  State.tags = []; renderTags();
  const progressEl = document.getElementById('uploadProgress'); if (progressEl) progressEl.style.display = 'none';
  const tipEl = document.getElementById('uploadTip'); if (tipEl) tipEl.textContent = '作品图片上传到 GitHub 仓库，同源加载更快（约 1–2 分钟后全站生效）';
  const statusEl = document.getElementById('uploadStatus'); if (statusEl) statusEl.style.display = 'none';
}

function showImgbbConfig() {
  getGithubToken().then(key => {
    const input = document.getElementById('imgbbKeyInput');
    if (input) input.value = key || '';
    document.getElementById('imgbbConfigModal')?.classList.add('open');
  });
}
function closeImgbbConfig() { document.getElementById('imgbbConfigModal')?.classList.remove('open'); }

async function saveImgbbConfig() {
  const input = document.getElementById('imgbbKeyInput');
  const key = input?.value.trim();
  if (!key) { showToast('请输入 GitHub 上传令牌', 'error'); return; }
  await setGithubToken(key);
  closeImgbbConfig();
  showToast('✅ GitHub 上传配置已保存', 'success');
}

// ══════════════════════════════════════════════════════════
//  作品编辑
// ══════════════════════════════════════════════════════════

function openEditor(workId) {
  // 跳转到 720yun 风格的全屏专业编辑器
  window.location.href = 'editor.html?id=' + workId;
}

function openEditModal(workId) {
  const allWorks = State.myWorks;
  const work = allWorks.find(w => w.id == workId);
  if (!work) return;
  State.editingWorkId = workId;
  State.editTags = [...(work.tags || [])];
  State.editScenes = JSON.parse(JSON.stringify(work.scenes || []));
  State.editObjectURLs = [];
  const el = (id) => document.getElementById(id);
  if (el('editWorkTitle')) el('editWorkTitle').value = work.title || '';
  if (el('editWorkCategory')) { renderCategoryOptions(); el('editWorkCategory').value = work.category || ''; }
  if (el('editWorkDesc')) el('editWorkDesc').value = work.desc || '';
  if (el('editWorkAuthor')) el('editWorkAuthor').value = getWorkAuthor(work); // 「匿名」等占位值显示为空，保存即清除
  if (el('editCoverPreview')) { el('editCoverPreview').src = work.thumb || ''; el('editCoverPreview').style.display = work.thumb ? '' : 'none'; }
  if (el('editLogoPreview')) { el('editLogoPreview').src = work.logo || ''; el('editLogoPreview').style.display = work.logo ? '' : 'none'; }
  if (el('editInitialRotX')) el('editInitialRotX').value = (work.initialRotation && work.initialRotation.x) || 0;
  if (el('editInitialRotY')) el('editInitialRotY').value = (work.initialRotation && work.initialRotation.y) || 0;
  if (el('editExpireTime')) el('editExpireTime').value = work.expireTime || '';
  if (el('editWorkPassword')) el('editWorkPassword').value = work.accessPassword || '';
  if (el('editWorkMusic')) el('editWorkMusic').value = work.musicUrl || '';
  const privacyRadio = document.querySelector(`input[name="editPrivacy"][value="${work.privacy || 'public'}"]`);
  if (privacyRadio) privacyRadio.checked = true;
  toggleEditPasswordVisibility();
  renderEditTags(); renderEditScenes(); renderHotspotSceneSelect();
  switchEditTab('info');
  document.getElementById('editModal')?.classList.add('open');
}

// ── 编辑标签页切换 ──
function switchEditTab(tabId) {
  document.querySelectorAll('.etab').forEach(b => b.classList.toggle('active', b.dataset.etag === tabId));
  document.querySelectorAll('.edit-tab-content').forEach(c => c.style.display = 'none');
  var tab = document.getElementById('editTab' + tabId.charAt(0).toUpperCase() + tabId.slice(1));
  if (tab) tab.style.display = 'block';
  // 进入热点页时刷新场景下拉与列表，避免数据不同步
  if (tabId === 'hotspots') renderHotspotSceneSelect();
}

// ── 编辑密码可见性 ──
function toggleEditPasswordVisibility() {
  var privacy = document.querySelector('input[name="editPrivacy"]:checked')?.value || 'public';
  var pwGroup = document.getElementById('editPasswordGroup');
  if (pwGroup) pwGroup.style.display = privacy === 'link' ? '' : 'none';
}

// 监听分享设置中的隐私选项变化
document.addEventListener('change', function(e) {
  if (e.target.name === 'editPrivacy') toggleEditPasswordVisibility();
});

// ── 封面替换 ──
function replaceEditCover() {
  var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    var file = e.target.files[0]; if (!file) return;
    showToast('正在上传封面...');
    try {
      var result = await uploadToGithub(file);
      var preview = document.getElementById('editCoverPreview');
      if (preview) { preview.src = result.thumb || result.url; preview.style.display = ''; }
      State._editNewCover = result.thumb || result.url;
      showToast('封面已替换', 'success');
    } catch (err) { showToast('替换失败', 'error'); }
  };
  input.click();
}

// ── Logo 替换/移除 ──
function replaceEditLogo() {
  var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    var file = e.target.files[0]; if (!file) return;
    showToast('正在上传Logo...');
    try {
      var result = await uploadToGithub(file);
      var preview = document.getElementById('editLogoPreview');
      if (preview) { preview.src = result.url; preview.style.display = ''; }
      State._editNewLogo = result.url;
      showToast('Logo已替换', 'success');
    } catch (err) { showToast('替换失败', 'error'); }
  };
  input.click();
}

function removeEditLogo() {
  State._editNewLogo = '';
  var preview = document.getElementById('editLogoPreview');
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
}

// ── 视角设置 ──
function previewCurrentViewpoint() {
  var rotX = parseFloat(document.getElementById('editInitialRotX')?.value) || 0;
  var rotY = parseFloat(document.getElementById('editInitialRotY')?.value) || 0;
  if (typeof Viewer !== 'undefined' && Viewer.setLiveRotation) {
    Viewer.setLiveRotation(rotX, rotY);
  }
  showToast('已预览视角', 'success');
}

function setCurrentViewpoint() {
  // 从当前全景预览读取视角并写回输入框
  if (typeof Viewer === 'undefined' || !Viewer.getRotation) { showToast('请先打开全景预览', 'error'); return; }
  var r = Viewer.getRotation();
  var rx = document.getElementById('editInitialRotX');
  var ry = document.getElementById('editInitialRotY');
  if (rx) rx.value = (r.x || 0).toFixed(3);
  if (ry) ry.value = (r.y || 0).toFixed(3);
  Viewer.setLiveRotation(r.x || 0, r.y || 0);
  showToast('已设为初始视角', 'success');
}

// ── 热点管理 ──
function renderHotspotSceneSelect() {
  var sel = document.getElementById('hotspotSceneSelect');
  if (!sel) return;
  sel.innerHTML = State.editScenes.map((s, i) =>
    `<option value="${i}">${s.title || '场景 ' + (i+1)}</option>`
  ).join('');
  renderHotspotList();
}

function renderHotspotList() {
  var container = document.getElementById('hotspotList');
  if (!container) return;
  var sceneIdx = parseInt(document.getElementById('hotspotSceneSelect')?.value) || 0;
  var scene = State.editScenes[sceneIdx];
  if (!scene) { container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:20px">请先添加场景</div>'; return; }
  var hotspots = scene.hotspots || [];
  if (hotspots.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:20px">该场景暂无热点</div>';
    return;
  }
  const typeList = (typeof Viewer !== 'undefined' && Viewer.HOTSPOT_TYPES) ? Viewer.HOTSPOT_TYPES : [
    { value: 'scene', label: '场景切换', icon: '🏠' }, { value: 'image', label: '图片', icon: '🖼' },
    { value: 'text', label: '文字说明', icon: '📝' }, { value: 'link', label: '外部链接', icon: '🔗' },
    { value: 'phone', label: '电话', icon: '📞' }, { value: 'video', label: '视频', icon: '🎬' },
    { value: 'audio', label: '音频', icon: '🔊' }, { value: 'article', label: '文章图文', icon: '📄' },
    { value: 'info', label: '信息提示', icon: 'ℹ️' }, { value: 'location', label: '位置导航', icon: '📍' },
    { value: 'product', label: '商品购买', icon: '🛒' }, { value: 'music', label: '音乐曲目', icon: '🎵' },
    { value: 'gift', label: '优惠福利', icon: '🎁' }, { value: 'wechat', label: '微信客服', icon: '💬' },
    { value: 'map', label: '地图导航', icon: '🗺' }, { value: 'download', label: '下载', icon: '⬇️' },
  ];
  const getIcon = (t) => { const m = typeList.find(x => x.value === t); return m ? m.icon : '📍'; };
  const placeholderMap = {
    image: '图片URL', text: '说明文字', link: '链接(含http)', phone: '电话号码',
    video: '视频URL', audio: '音频URL', article: '图文/文章URL或文字', info: '提示文字',
    location: '地址或地图URL', product: '商品链接(含http)', music: '音频URL',
    gift: '活动链接(含http)', wechat: '微信号', map: '地图链接(含http)', download: '下载链接(含http)',
  };
  container.innerHTML = hotspots.map((h, i) => {
    const icon = getIcon(h.type);
    const typeOpts = typeList.map(t => `<option value="${t.value}" ${h.type === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
    let contentField;
    if (h.type === 'scene') {
      const sceneOpts = State.editScenes.map((s, si) =>
        `<option value="${s.id != null ? s.id : si}" ${((s.id != null && s.id == h.content) || (s.id == null && String(si) === String(h.content))) ? 'selected' : ''}>${s.title || ('场景 ' + (si + 1))}</option>`
      ).join('');
      contentField = `<select class="hs-content" onchange="updateHotspot(${sceneIdx},${i},'content',this.value)"><option value="">选择目标场景</option>${sceneOpts}</select>`;
    } else {
      const ph = placeholderMap[h.type] || '内容';
      contentField = `<input class="hs-content" type="text" value="${h.content || ''}" placeholder="${ph}" onchange="updateHotspot(${sceneIdx},${i},'content',this.value)">`;
    }
    return `
    <div class="hotspot-item" data-hs-type="${h.type}">
      <div class="hs-icon hs-icon-${h.type}">${icon}</div>
      <div class="hs-info">
        <input class="hs-name" type="text" value="${h.title || '热点 ' + (i+1)}" placeholder="热点名称" onchange="updateHotspot(${sceneIdx},${i},'title',this.value)">
        <select class="hs-type" onchange="updateHotspot(${sceneIdx},${i},'type',this.value)">${typeOpts}</select>
        ${contentField}
        <div class="hs-pos">
          ${(h.position && (h.position.yaw || h.position.pitch)) ? `<span class="hs-coord">📌 ${Math.round(h.position.yaw || 0)}°, ${Math.round(h.position.pitch || 0)}°</span>` : `<span class="hs-unmarked">⚠ 未标记位置</span>`}
          <button class="hs-place-btn" onclick="placeHotspot(${sceneIdx},${i})" title="在全景中标记位置">${h.position && (h.position.yaw || h.position.pitch) ? '🔄 重新标记' : '📍 标记位置'}</button>
        </div>
      </div>
      <button class="edit-scene-btn danger" onclick="removeHotspot(${sceneIdx},${i})" title="删除">✕</button>
    </div>`;
  }).join('');
}

function addHotspot() {
  var sceneIdx = parseInt(document.getElementById('hotspotSceneSelect')?.value) || 0;
  if (!State.editScenes[sceneIdx]) return;
  if (!State.editScenes[sceneIdx].hotspots) State.editScenes[sceneIdx].hotspots = [];
  var newIdx = State.editScenes[sceneIdx].hotspots.length;
  State.editScenes[sceneIdx].hotspots.push({
    id: 'h_' + Date.now(),
    type: 'scene',
    title: '新热点',
    content: '',
    position: { yaw: 0, pitch: 0 }
  });
  renderHotspotList();
  var scene = State.editScenes[sceneIdx];
  if (scene.panorama) {
    showToast('请在全景中点击放置热点位置', 'success');
    placeHotspot(sceneIdx, newIdx);
  } else {
    showToast('已添加热点，请先为该场景上传全景图后再标记位置', 'error');
  }
}

function updateHotspot(sceneIdx, hotspotIdx, key, value) {
  if (State.editScenes[sceneIdx] && State.editScenes[sceneIdx].hotspots && State.editScenes[sceneIdx].hotspots[hotspotIdx]) {
    State.editScenes[sceneIdx].hotspots[hotspotIdx][key] = value;
  }
}

function removeHotspot(sceneIdx, hotspotIdx) {
  if (State.editScenes[sceneIdx] && State.editScenes[sceneIdx].hotspots) {
    State.editScenes[sceneIdx].hotspots.splice(hotspotIdx, 1);
    renderHotspotList();
  }
}

// ── 热点可视化放置 ──
function placeHotspot(sceneIdx, hotspotIdx) {
  var scene = State.editScenes[sceneIdx];
  if (!scene || !scene.panorama) { showToast('请先为场景上传全景图', 'error'); return; }
  var work = State.myWorks.find(w => w.id == State.editingWorkId);
  // 固定目标场景，避免放置过程中切场景导致写错场景
  var targetSceneIdx = sceneIdx;
  Viewer.loadPanorama(scene.panorama, {
    title: (work && work.title) || '预览',
    sceneTitle: scene.title || ('场景 ' + (sceneIdx + 1)),
    hotspots: scene.hotspots || [],
    work: { scenes: State.editScenes },
    onSceneSwitch: null,
  });
  Viewer.enablePlacement(function (pos) {
    if (!State.editScenes[targetSceneIdx].hotspots) State.editScenes[targetSceneIdx].hotspots = [];
    if (State.editScenes[targetSceneIdx].hotspots[hotspotIdx]) {
      State.editScenes[targetSceneIdx].hotspots[hotspotIdx].position = pos;
      renderHotspotList();
      showToast('热点位置已更新：' + Math.round(pos.yaw) + '°, ' + Math.round(pos.pitch) + '°', 'success');
    }
    closeViewer();
  });
}

function closeEditModal() {
  State.editObjectURLs.forEach(u => URL.revokeObjectURL(u));
  State.editObjectURLs = []; State.editingWorkId = null;
  document.getElementById('editModal')?.classList.remove('open');
}

function addEditTag(e) {
  if (e.key !== 'Enter') return; e.preventDefault();
  const input = document.getElementById('editTagInput'); const val = input?.value.trim();
  if (!val) return; if (State.editTags.length >= 8) return; if (State.editTags.includes(val)) return;
  State.editTags.push(val); renderEditTags(); if (input) input.value = '';
}
function removeEditTag(idx) { State.editTags.splice(idx, 1); renderEditTags(); }
function renderEditTags() {
  const container = document.getElementById('editTagsContainer');
  if (!container) return;
  container.innerHTML = State.editTags.map((t, i) => `<span class="tag">${t}<button onclick="removeEditTag(${i})" title="删除">✕</button></span>`).join('');
}

function renderEditScenes() {
  const container = document.getElementById('editScenesList');
  if (!container) return;
  if (State.editScenes.length === 0) { container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">暂无场景</div>'; return; }
  container.innerHTML = State.editScenes.map((s, i) => `
    <div class="edit-scene-item" data-idx="${i}" draggable="true">
      <div class="edit-scene-handle" title="拖拽排序">⠿</div>
      <div class="edit-scene-thumb"><img src="${s.thumb || ''}" alt="${s.title || ''}" loading="lazy"></div>
      <div class="edit-scene-info">
        <input class="edit-scene-name" type="text" value="${s.title || '场景 ' + (i+1)}" placeholder="场景名称">
        <span class="edit-scene-idx">${i === 0 ? '★ 封面' : '#' + (i + 1)}</span>
      </div>
      <div class="edit-scene-actions">
        ${i === 0 ? '' : `<button class="edit-scene-btn" onclick="setCoverScene(${i})" title="设为封面">🖼</button>`}
        <button class="edit-scene-btn" onclick="replaceEditScene(${i})" title="替换图片">🔄</button>
        <button class="edit-scene-btn danger" onclick="removeEditScene(${i})" title="删除场景">✕</button>
      </div>
    </div>`).join('');
  container.querySelectorAll('.edit-scene-item').forEach(item => {
    item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', item.dataset.idx); item.classList.add('dragging'); });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => { e.preventDefault(); reorderEditScene(parseInt(e.dataTransfer.getData('text/plain')), parseInt(item.dataset.idx)); });
  });
}

function reorderEditScene(from, to) { if (from === to) return; const [s] = State.editScenes.splice(from, 1); State.editScenes.splice(to, 0, s); renderEditScenes(); }
function setCoverScene(idx) {
  if (idx === 0 || !State.editScenes[idx]) return;
  const [s] = State.editScenes.splice(idx, 1);
  State.editScenes.unshift(s);
  renderEditScenes();
  showToast('已设为封面场景', 'success');
}
function removeEditScene(idx) { State.editScenes.splice(idx, 1); renderEditScenes(); }
function replaceEditScene(idx) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    showToast('正在上传替换图片...');
    try {
      const result = await uploadToGithub(file);
      State.editScenes[idx] = { ...State.editScenes[idx], panorama: result.url, thumb: result.thumb || result.url };
      renderEditScenes(); showToast('场景图片已替换', 'success');
    } catch (err) { showToast('替换失败', 'error'); }
  };
  input.click();
}

function addNewScene() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    showToast('正在上传新场景...');
    try {
      for (const file of files) {
        const result = await uploadToGithub(file);
        State.editScenes.push({ id: 's_' + genId(), title: '新场景', panorama: result.url, thumb: result.thumb || result.url });
      }
      renderEditScenes(); showToast('新场景已添加', 'success');
    } catch (err) { showToast('添加失败', 'error'); }
  };
  input.click();
}

async function saveEditWork() {
  if (!State.editingWorkId) return;
  const work = State.myWorks.find(w => w.id == State.editingWorkId);
  if (!work) return;
  const el = (id) => document.getElementById(id);
  const title = el('editWorkTitle')?.value.trim();
  const category = el('editWorkCategory')?.value;
  if (!title) { showToast('请填写作品名称', 'error'); return; }
  if (!category) { showToast('请选择分类', 'error'); return; }
  if (State.editScenes.length === 0) { showToast('至少需要保留一个场景', 'error'); return; }
  document.querySelectorAll('.edit-scene-name').forEach((input, idx) => { if (State.editScenes[idx]) State.editScenes[idx].title = input.value.trim() || ('场景 ' + (idx + 1)); });
  work.title = title; work.category = category; work.desc = el('editWorkDesc')?.value.trim() || '';
  work.author = el('editWorkAuthor')?.value.trim() || '';
  work.privacy = document.querySelector('input[name="editPrivacy"]:checked')?.value || 'public';
  work.accessPassword = el('editWorkPassword')?.value || '';
  work.expireTime = el('editExpireTime')?.value || '';
  work.musicUrl = el('editWorkMusic')?.value.trim() || '';
  work.tags = [...State.editTags]; work.scenes = [...State.editScenes];
  // 封面
  if (State._editNewCover) { work.thumb = State._editNewCover; State._editNewCover = null; }
  else { work.thumb = State.editScenes[0]?.thumb || work.thumb; }
  work.panorama = State.editScenes[0]?.panorama || work.panorama || '';
  // Logo
  if (State._editNewLogo !== undefined) { work.logo = State._editNewLogo; State._editNewLogo = undefined; }
  // 视角
  var rotX = parseFloat(el('editInitialRotX')?.value) || 0;
  var rotY = parseFloat(el('editInitialRotY')?.value) || 0;
  work.initialRotation = { x: rotX, y: rotY };
  try { await dbPutWork(work); syncWorksIndexToRemote(); syncWorksDataToRemote(); closeEditModal(); renderManageGrid(); showToast('✅ 作品已更新', 'success'); }
  catch (err) { showToast('保存失败', 'error'); }
}

// ══════════════════════════════════════════════════════════
//  访客记录 & 黑名单
// ══════════════════════════════════════════════════════════

// ── 远端访客记录（跨设备）────────────────────────────────
// 键必须与 js/app.js 中的 VISIT_SYNC_KEY 保持一致。
// IndexedDB 是按设备隔离的，手机访客的记录不会写进本机库，因此需从远端拉取合并。
const VISIT_SYNC_KEY = 'vrpv_visits_2p8hyet0pwpxw3ahp68m2sal';
const VISIT_SYNC_BASE = 'https://textdb.online';

async function fetchRemoteVisitLogs() {
  try {
    const res = await fetch(VISIT_SYNC_BASE + '/' + VISIT_SYNC_KEY + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return [];
    const txt = (await res.text()).trim();
    if (!txt) return [];
    const parsed = JSON.parse(txt);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}

async function clearRemoteVisitLogs() {
  try {
    const body = new URLSearchParams();
    body.set('key', VISIT_SYNC_KEY);
    body.set('value', '[]');
    await fetch(VISIT_SYNC_BASE + '/update', { method: 'POST', body });
  } catch (e) { /* 远端不可用时忽略 */ }
}

// ── 作品索引远端同步（供主站首屏 banner 读取）──────────────
// 主站首页与 /vr/ 同源，但 IndexedDB 是「按浏览器」隔离的：
// 访客自己的设备上没有管理员上传的作品，所以首页读本地库会是空的。
// 这里把「作品索引」同步到远端共享键，首页即可展示最新作品。
// 首页 banner 用的作品索引：键/构建/推送都在 js/data.js（WORKS_INDEX_SYNC_KEY /
// buildWorksIndexPayload / pushWorksIndexRemote），访客端也用同一套。

// ── 作品「全量数据」远端同步（让换一台电脑也能看到作品）──────
// 上面那个索引只够首页 banner 用（标题/场景图）。
// 而 IndexedDB 是「按浏览器」隔离的 → 换台电脑：访客端作品广场是空的、
// 后台管理也看不到任何已上传作品。所以这里把「完整作品数据 + 分类」
// 也同步到远端，任何设备打开都能拿到。
// ⚠️ 实测 textdb.online 的值有大小上限（160KB 可存、200KB 会被静默丢弃，
//    写入仍返回 200 但读回是空）→ 推送前做体积检查。
// 常量与实现已抽到 js/data.js（**访客端也要用同一套**）：
//   WORKS_DATA_SYNC_KEY / fetchWorksDataRemote / pushWorksDataRemote /
//   readDeletedWorkIds / addDeletedWorkId / worksSyncSignature
// 这里只保留「合并时写进本机 IndexedDB」——那是后台独有的行为。
// ⚠️ 不要再在本文件重复声明 data.js 里已有的顶层 const（如 WORKS_DATA_MAX_BYTES）：
//    classic script 共用同一个全局词法作用域，重复的 const 会抛 SyntaxError，
//    导致**本文件整个不执行**（后台会整个失去功能）。改动后请跑 `node _check_dupes.cjs`。

// 拉取远端作品并合并进本机（写入 IndexedDB，这样编辑器等页面也能用）
async function hydrateWorksFromRemote() {
  const payload = await fetchWorksDataRemote(6000); // 拉取前置步骤，超时给宽松些
  if (!payload) return 0;
  const dead = {};
  readDeletedWorkIds().forEach(id => { dead[id] = 1; });
  payload.deleted.forEach(id => { dead[id] = 1; });

  let added = 0;
  for (const w of payload.works) {
    if (!w || w.id == null || dead[String(w.id)]) continue;
    if (State.myWorks.some(mw => String(mw.id) === String(w.id))) continue;
    if (!w.scenes && (w.panorama || w.thumb)) {
      w.scenes = [{ id: 's_legacy', title: '场景 1', panorama: w.panorama || w.thumb, thumb: w.thumb || w.panorama }];
    }
    try { await dbPutWork(w); } catch (e) { /* 仍是可用的内存副本 */ }
    State.myWorks.push(w);
    added++;
  }

  // 远端分类也补进来（缺失才补，不覆盖本地）
  try {
    State.categories = State.categories || [];
    for (const c of payload.cats) {
      if (!c || c.id == null) continue;
      if (!State.categories.some(x => String(x.id) === String(c.id))) {
        State.categories.push(c);
        try { await dbPutCat(c); } catch (e) { /* ignore */ }
      }
    }
    State.categories.sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) { /* ignore */ }

  if (added) console.log('[admin] 已从远端合并 ' + added + ' 个作品');
  return added;
}

// 把本机作品 + 分类全量推到远端
// （实现已抽到 js/data.js 的 pushWorksDataRemote：先读后写合并、本地优先、墓碑生效、
//   空列表防误删、体积上限检查。访客端走的是同一个函数，避免两边逻辑漂移）
async function syncWorksDataToRemote(opts) {
  try {
    const r = await pushWorksDataRemote(State.myWorks, State.categories, opts);
    if (r.ok) {
      console.log('[admin] 作品全量数据已同步：' + r.count + ' 个作品 / ' + Math.round(r.bytes / 1024) + 'KB');
    } else if (r.reason === 'too-big') {
      // 超限会被远端静默丢弃，必须让用户知道，否则会以为「同步好了」
      showToast('作品数据 ' + Math.round(r.bytes / 1024) + 'KB 已超过跨设备同步上限（约 150KB），'
        + '换电脑可能看不到最新作品', 'error');
    } else if (r.reason === 'offline') {
      console.warn('[admin] 远端不可达，本次跳过全量同步');
    }
    return r;
  } catch (e) { return { ok: false, reason: 'exception' }; }
}

// 作品上传时间：新数据用 uploadedAt；旧数据没有，用 id 内嵌的毫秒时间戳兜底
// （genId() = Date.now() + 随机数），再退到 date（只精确到天）
// 注：与 js/data.js 的 getWorkSyncTime 同义，保留此名是因为后台多处引用。
function getWorkUploadTime(work) {
  if (!work) return 0;
  if (work.uploadedAt) { const t = Number(work.uploadedAt); if (t) return t; }
  const n = parseInt(work.id, 10);
  if (!isNaN(n) && n > 1e12) return n;
  if (work.date) { const t = Date.parse(work.date); if (!isNaN(t)) return t; }
  return 0;
}

// 索引的构建与推送都在 js/data.js（buildWorksIndexPayload / pushWorksIndexRemote），
// 因为**访客端也要推**：否则必须「打开后台并登录过」首页 banner 才会有内容。
async function syncWorksIndexToRemote() {
  try { return await pushWorksIndexRemote(State.myWorks); }
  catch (e) { return false; } // 远端不可用时忽略，首页退回本地/静态兜底
}

async function renderVisitorPage() {
  var localLogs = await dbGetAllVisitors();
  var remoteLogs = await fetchRemoteVisitLogs();

  // 合并「本机记录 + 远端跨设备记录」并按 (访客+时间+作品) 去重
  var seen = {};
  var logs = [];
  localLogs.concat(remoteLogs).forEach(function (l) {
    if (!l || !l.visitTime) return;
    var k = (l.visitorId || '') + '|' + l.visitTime + '|' + (l.workId || '');
    if (seen[k]) return;
    seen[k] = 1;
    logs.push(l);
  });

  // 黑名单（本机 + 远端合并，按 visitorId 去重）
  var localBlack = await dbGetAllBlacklist();
  var remoteBlack = await fetchRemoteBlocklist();
  var bmap = {};
  localBlack.concat(remoteBlack).forEach(function (b) { if (b && b.visitorId) bmap[b.visitorId] = b; });
  var blacklist = Object.keys(bmap).map(function (k) { return bmap[k]; });

  // 统计
  var uniqueVisitors = new Set(logs.map(l => l.visitorId)).size;
  document.getElementById('vstatTotalVisits').textContent = logs.length;
  document.getElementById('vstatUniqueVisitors').textContent = uniqueVisitors;
  document.getElementById('vstatBlacklistCount').textContent = blacklist.length;

  // 访客列表
  var tbody = document.getElementById('visitorTableBody');
  var emptyEl = document.getElementById('visitorEmpty');
  var tableWrap = document.querySelector('.visitor-table-wrap');

  if (logs.length === 0) {
    if (tableWrap) tableWrap.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'flex';
  } else {
    if (tableWrap) tableWrap.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    // 按时间倒序
    logs.sort((a, b) => (b.visitTime || '').localeCompare(a.visitTime || ''));
    tbody.innerHTML = logs.slice(0, 100).map(l => {
      var isBlack = blacklist.some(b => b.visitorId === l.visitorId);
      var time = l.visitTime ? new Date(l.visitTime).toLocaleString('zh-CN') : '-';
      return `<tr class="${isBlack ? 'blacklisted' : ''}">
        <td><div class="visitor-cell"><span class="visitor-nick">${l.nickname || '匿名访客'}</span><span class="visitor-id">${(l.visitorId || '').substring(0, 8)}...</span></div></td>
        <td>${l.workTitle || '-'}</td>
        <td>${time}</td>
        <td>${l.device || '-'}</td>
        <td>${isBlack
          ? `<button class="ma-btn" onclick="removeFromBlacklist('${l.visitorId}')">✅ 解除</button>`
          : `<button class="ma-btn danger" onclick="addToBlacklist('${l.visitorId}', '${(l.nickname || '').replace(/'/g, "\\'")}')">🚫 拉黑</button>`
        }</td>
      </tr>`;
    }).join('');
  }

  // 黑名单
  var blContainer = document.getElementById('blacklistContainer');
  var blEmpty = document.getElementById('blacklistEmpty');
  if (blacklist.length === 0) {
    blContainer.innerHTML = '';
    if (blEmpty) blEmpty.style.display = 'flex';
  } else {
    if (blEmpty) blEmpty.style.display = 'none';
    blContainer.innerHTML = blacklist.map(b => `
      <div class="blacklist-item">
        <div class="bl-info">
          <span class="bl-nick">${b.nickname || '匿名'}</span>
          <span class="bl-id">${(b.visitorId || '').substring(0, 12)}...</span>
        </div>
        <div class="bl-meta">
          <span>拉黑时间：${b.addedAt ? new Date(b.addedAt).toLocaleString('zh-CN') : '-'}</span>
        </div>
        <button class="ma-btn" onclick="removeFromBlacklist('${b.visitorId}')">✅ 解除</button>
      </div>
    `).join('');
  }
}

// ── 黑名单远端同步（让拉黑在所有设备上生效）──────────────
// 键必须与 js/app.js 中的 BLOCK_SYNC_KEY 保持一致。
const BLOCK_SYNC_KEY = 'vrpv_blocklist_tahuggn4454aatb31bd7ivq4';
const BLOCK_SYNC_BASE = 'https://textdb.online';

async function fetchRemoteBlocklist() {
  try {
    const res = await fetch(BLOCK_SYNC_BASE + '/' + BLOCK_SYNC_KEY + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return [];
    const txt = (await res.text()).trim();
    if (!txt) return [];
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

async function writeRemoteBlocklist(list) {
  try {
    const body = new URLSearchParams();
    body.set('key', BLOCK_SYNC_KEY);
    body.set('value', JSON.stringify(list));
    await fetch(BLOCK_SYNC_BASE + '/update', { method: 'POST', body });
  } catch (e) { /* 远端不可用时忽略，本机黑名单仍然生效 */ }
}

// 把「本机 + 远端」合并后写回远端；excludeVisitorId 用于「解除拉黑」的场景
async function syncBlocklistToRemote(excludeVisitorId) {
  try {
    const local = await dbGetAllBlacklist();
    const remote = await fetchRemoteBlocklist();
    const map = {};
    local.concat(remote).forEach(b => {
      if (!b || !b.visitorId) return;
      if (excludeVisitorId && b.visitorId === excludeVisitorId) return;
      map[b.visitorId] = {
        visitorId: b.visitorId,
        nickname: b.nickname || '',
        addedAt: b.addedAt || new Date().toISOString(),
      };
    });
    await writeRemoteBlocklist(Object.keys(map).map(k => map[k]));
  } catch (e) { /* ignore */ }
}

async function addToBlacklist(visitorId, nickname) {
  if (!visitorId) return;
  var exists = await dbGetAllBlacklist();
  if (exists.some(b => b.visitorId === visitorId)) { showToast('该访客已在黑名单中'); return; }
  await dbAddBlacklist({ visitorId, nickname: nickname || '', addedAt: new Date().toISOString() });
  await syncBlocklistToRemote();
  showToast('已拉黑该访客（所有设备生效）', 'success');
  renderVisitorPage();
}

async function removeFromBlacklist(visitorId) {
  await dbRemoveBlacklist(visitorId);
  await syncBlocklistToRemote(visitorId);
  showToast('已解除拉黑（所有设备生效）', 'success');
  renderVisitorPage();
}

async function addBlacklistManual() {
  var vid = prompt('请输入要拉黑的访客ID（可在访客日志中查看）：');
  if (!vid || !vid.trim()) return;
  var nickname = prompt('备注名称（可选）：', '') || '手动添加';
  await addToBlacklist(vid.trim(), nickname.trim());
}

async function clearVisitorLogs() {
  if (!confirm('确定清空所有访客日志？此操作不可恢复（本机记录与云端跨设备记录都会清空）。')) return;
  await dbClearVisitorLogs();
  await clearRemoteVisitLogs();
  showToast('访客日志已清空', 'success');
  renderVisitorPage();
}

// ══════════════════════════════════════════════════════════
//  系统设置页
// ══════════════════════════════════════════════════════════

async function renderSettingsPage() {
  // 填充当前 GitHub 上传令牌
  var key = await getGithubToken();
  var keyInput = document.getElementById('settingsImgbbKey');
  if (keyInput) keyInput.value = key || '';

  // 分类列表
  var catList = document.getElementById('settingsCatList');
  if (catList) {
    catList.innerHTML = State.categories.map(c => `
      <div class="cat-item">
        <span class="cat-item-icon">${c.icon || '📁'}</span>
        <span class="cat-item-name">${c.name}</span>
        <div class="cat-item-actions">
          <button class="cat-act-btn danger" onclick="deleteCatFromSettings('${c.id}')" title="删除">🗑️</button>
        </div>
      </div>
    `).join('');
  }
}

async function saveImgbbFromSettings() {
  var input = document.getElementById('settingsImgbbKey');
  var key = input?.value.trim();
  if (!key) { showToast('请输入 GitHub 上传令牌', 'error'); return; }
  await setGithubToken(key);
  showToast('✅ GitHub 上传配置已保存', 'success');
}

async function changeAdminPassword() {
  var oldPwd = document.getElementById('oldAdminPwd')?.value;
  var newPwd = document.getElementById('newAdminPwd')?.value;
  if (!oldPwd || !newPwd) { showToast('请填写完整', 'error'); return; }
  var storedPwd = await getAdminPassword();
  if (oldPwd !== storedPwd) { showToast('当前密码错误', 'error'); return; }
  await setAdminPassword(newPwd);
  document.getElementById('oldAdminPwd').value = '';
  document.getElementById('newAdminPwd').value = '';
  showToast('✅ 密码已修改', 'success');
}

// 数据导入导出
async function exportAllData() {
  try {
    var data = {
      works: await dbGetAllWorks(),
      categories: await dbGetAllCats(),
      blacklist: await dbGetAllBlacklist(),
      visitorLogs: await dbGetAllVisitors(),
      ghToken: await getGithubToken(),
    };
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vr_panorama_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('数据已导出', 'success');
  } catch (e) { showToast('导出失败', 'error'); }
}

async function importAllData(event) {
  var file = event.target.files[0];
  if (!file) return;
  try {
    var text = await file.text();
    var data = JSON.parse(text);
    if (data.works) { for (var w of data.works) await dbPutWork(w); }
    if (data.categories) { for (var c of data.categories) await dbPutCat(c); }
    if (data.blacklist) { for (var b of data.blacklist) await dbAddBlacklist(b); }
    if (data.ghToken) await setGithubToken(data.ghToken);
    // 重新加载
    State.myWorks = await dbGetAllWorks();
    State.categories = await dbGetAllCats();
    State.categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    renderManageGrid();
    showToast('✅ 数据导入成功', 'success');
  } catch (e) { showToast('导入失败：文件格式错误', 'error'); }
  event.target.value = '';
}

// ── 弹窗关闭 ─────────────────────────────────────────────
function initOverlayClose() {
  const overlayCloseMap = {
    shareOverlay: closeShare,
    posterOverlay: closePoster,
    imgbbConfigModal: closeImgbbConfig,
    editModal: closeEditModal,
  };
  Object.entries(overlayCloseMap).forEach(([id, closeFn]) => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeFn();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeShare(); closePoster(); closeImgbbConfig(); closeEditModal(); closeViewer(); }
  });
}

// ── 初始化 ────────────────────────────────────────────────
// 把历史数据里被兜底写入的「匿名」等占位作者名真正清空。
// 只处理仍为占位值的记录，清空后不会再命中，因此是幂等的一次性清洗。
async function migratePlaceholderAuthors() {
  if (!Array.isArray(State.myWorks) || !State.myWorks.length) return;
  if (typeof PLACEHOLDER_AUTHORS === 'undefined') return;
  var changed = 0;
  for (var i = 0; i < State.myWorks.length; i++) {
    var w = State.myWorks[i];
    if (!w) continue;
    var raw = String(w.author == null ? '' : w.author).trim();
    if (raw && PLACEHOLDER_AUTHORS.indexOf(raw.toLowerCase()) !== -1) {
      w.author = '';
      try { await dbPutWork(w); changed++; } catch (e) { /* ignore */ }
    }
  }
  if (changed) console.log('[admin] 已清除 ' + changed + ' 个作品的占位作者名');
}

async function initAdminApp() {
  // 先绑定侧边栏导航（不依赖任何异步数据），确保即使后续数据库/渲染出错，导航也始终可用
  initHeader();

  try { await loadCategories(); } catch (e) { console.error('loadCategories failed:', e); }
  try { State.myWorks = await dbGetAllWorks(); } catch (e) { State.myWorks = []; console.error('dbGetAllWorks failed:', e); }

  // 兼容旧 localStorage 数据迁移
  try {
    var raw = localStorage.getItem('vr_my_works');
    if (raw) {
      var oldWorks = JSON.parse(raw);
      for (var w of oldWorks) {
        if (!State.myWorks.find(mw => mw.id === w.id)) {
          if (!w.scenes && (w.panorama || w.thumb)) {
            w.scenes = [{ id: 's_legacy', title: '场景 1', panorama: w.panorama || w.thumb, thumb: w.thumb || w.panorama }];
          }
          await dbPutWork(w);
          State.myWorks.unshift(w);
        }
      }
      localStorage.removeItem('vr_my_works');
    }
  } catch (e) { /* ignore */ }

  // 从远端把作品/分类合并进来 —— 换一台电脑（本机库为空）时，
  // 后台管理页也能看到之前上传过的作品，访客端作品广场也不再是空的
  try { await hydrateWorksFromRemote(); } catch (e) { console.error('hydrateWorksFromRemote failed:', e); }

  // 一次性清洗：把历史数据里被兜底写成「匿名」的作者名真正清空，
  // 这样展示页不会再出现「匿名」，且不会每次都被重新算一遍
  try { await migratePlaceholderAuthors(); } catch (e) { /* ignore */ }

  // 种子：把作品索引 + 全量数据推到远端（首屏 banner 与跨设备可见性都靠它）
  try { syncWorksIndexToRemote(); } catch (e) { /* ignore */ }
  try { syncWorksDataToRemote(); } catch (e) { /* ignore */ }

  initFormatTabs();
  initDropZone();
  initCharCount();
  initPrivacyToggle();
  initManageTabs();
  initOverlayClose();
  try { renderDashboard(); } catch (e) { console.error('renderDashboard failed:', e); }
  try { renderManageGrid(); } catch (e) { console.error('renderManageGrid failed:', e); }
}

// 启动
document.addEventListener('DOMContentLoaded', checkAdminLock);
