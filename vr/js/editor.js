// ============================================================
//  全景VR展示平台 - 720yun 风格作品编辑器 (editor.js)
//  全屏三栏：左侧模块栏 / 左侧属性面板 / 中央全景舞台 + 底部场景条
//  自包含数据层，避免与管理后台冲突
// ============================================================

const EditorState = {
  workId: null,
  work: null,
  sceneIdx: 0,
  scenes: [],
  tags: [],
  newCover: null,
  newLogo: undefined,
  activeModule: 'basic',
  activeHotspotScene: 0,
  dirty: false,
  viewerReady: false,
};

let EDITOR_CATEGORIES = [];

// ── 模块定义（对齐 720yun）──────────────────────────────
const EDITOR_MODULES = [
  { id: 'basic',   icon: '📋', label: '基础' },
  { id: 'view',    icon: '👁', label: '视角' },
  { id: 'hotspot', icon: '📍', label: '热点' },
  { id: 'music',   icon: '🎵', label: '音乐' },
  { id: 'sandbox', icon: '🗺', label: '沙盘' },
  { id: 'mask',    icon: '🧱', label: '遮罩' },
  { id: 'embed',   icon: '📌', label: '嵌入' },
  { id: 'effect',  icon: '✨', label: '特效' },
];

// ══════════════════════════════════════════════════════════
//  数据层（自包含）
// ══════════════════════════════════════════════════════════
const E_DB_NAME = 'vr_panorama_db';
const E_DB_VERSION = 3;
const E_STORE_WORKS = 'works';

function eOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(E_DB_NAME, E_DB_VERSION);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function eDbGetAllWorks() {
  const db = await eOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(E_STORE_WORKS, 'readonly');
    const req = tx.objectStore(E_STORE_WORKS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function eDbPutWork(work) {
  const db = await eOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(E_STORE_WORKS, 'readwrite');
    const req = tx.objectStore(E_STORE_WORKS).put(work);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function eDbGetAllCats() {
  const db = await eOpenDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('categories', 'readonly');
      const r = tx.objectStore('categories').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

// ── 图床（imgbb）─────────────────────────────────────────
const E_IMGBB_URL = 'https://api.imgbb.com/1/upload';
let eImgbbKey = '';
async function eGetImgbbKey() {
  if (eImgbbKey) return eImgbbKey;
  try {
    const db = await eOpenDB();
    const v = await new Promise((res) => {
      const tx = db.transaction('settings', 'readonly');
      const r = tx.objectStore('settings').get('imgbb_api_key');
      r.onsuccess = () => res(r.result ? r.result.value : '');
      r.onerror = () => res('');
    });
    if (v) { eImgbbKey = v; return v; }
  } catch (e) {}
  return '';
}
async function uploadToImgbb(file, onProgress) {
  const apiKey = await eGetImgbbKey();
  if (!apiKey) throw new Error('请先在管理后台配置图床 API Key');
  const formData = new FormData();
  formData.append('image', file);
  formData.append('key', apiKey);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', E_IMGBB_URL);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const resp = JSON.parse(xhr.responseText);
        if (resp.success && resp.data) resolve({ url: resp.data.url, thumb: resp.data.thumb?.url || resp.data.url });
        else reject(new Error(resp.error?.message || '上传失败'));
      } catch (e) { reject(new Error('服务器返回格式错误')); }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.timeout = 120000;
    xhr.send(formData);
  });
}

// ── 工具 ─────────────────────────────────────────────────
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}
// 本项目已作为「全景效果图」案例并入主站，访问路径为 /vr/
function getShareBaseUrl() { return new URL('index.html', location.href).href; }
function $(id) { return document.getElementById(id); }
function genId() { return Date.now() + Math.floor(Math.random() * 1000); }

function encodeShareData(work) {
  var minimal = {
    t: work.title || '', a: work.author || '', c: work.category || '', d: work.desc || '',
    s: (work.scenes || []).map(s => ({ t: s.title || '', p: s.panorama || '', h: s.thumb || '' })),
    th: work.thumb || '',
  };
  return LZString.compressToEncodedURIComponent(JSON.stringify(minimal));
}

// ══════════════════════════════════════════════════════════
//  初始化
// ══════════════════════════════════════════════════════════
async function initEditor() {
  try {
    await initEditorInner();
  } catch (e) {
    console.error('[editor] 编辑器初始化失败：', e);
    try { buildRail(); } catch (_) { /* ignore */ }
    const panel = $('etPanel');
    if (panel) {
      panel.innerHTML = `
        <div class="et-empty">
          <div class="et-empty-icon">⚠️</div>
          <div class="et-empty-title">编辑器初始化失败</div>
          <div class="et-empty-desc">${(e && e.message) ? e.message : e}</div>
          <button class="et-empty-btn" onclick="window.location.href='admin.html'">返回工作台</button>
        </div>`;
    }
  }
}

async function initEditorInner() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) { return editorEmptyState('未指定作品', '请从工作台点击某个作品的「编辑」按钮进入专业编辑器。'); }
  EditorState.workId = id;
  let works = [];
  try { works = await eDbGetAllWorks(); } catch (e) { works = []; }
  const work = works.find(w => String(w.id) === String(id));
  if (!work) { return editorEmptyState('作品不存在', '该作品可能已被删除，请返回工作台选择其它作品。'); }
  EditorState.work = work;
  EditorState.scenes = JSON.parse(JSON.stringify(work.scenes || []));
  if (!EditorState.scenes.length) {
    EditorState.scenes.push({
      id: 's_' + genId(), title: '场景 1',
      panorama: work.panorama || work.thumb || '', thumb: work.thumb || work.panorama || '', hotspots: [],
    });
  }
  EditorState.tags = [...(work.tags || [])];

  try { EDITOR_CATEGORIES = await eDbGetAllCats(); } catch (e) { EDITOR_CATEGORIES = []; }

  const tEl = $('etTitle');
  if (tEl) tEl.value = work.title || '';

  // 关键：先搭建编辑器界面骨架（模块栏 / 属性面板 / 场景条），
  // 保证即使 3D 查看器初始化失败（WebGL 不可用、three.js 未加载等），界面依然完整可用
  buildRail();
  renderSceneStrip();
  switchModule('basic');

  // 再初始化全景查看器，失败时降级但绝不阻断界面
  initViewerSafe(work);
}

// 安全初始化查看器：任何异常都只降级提示，不影响编辑器界面
function initViewerSafe(work) {
  EditorState.viewerReady = false;
  if (typeof Viewer === 'undefined' || !Viewer.init) {
    showStageNotice('全景引擎未加载（three.js 加载失败），可继续编辑文字/场景/热点，但无法预览 3D 画面');
    return;
  }
  try {
    Viewer.init();
  } catch (e) {
    console.warn('[editor] 查看器初始化失败：', e);
    showStageNotice('3D 全景预览不可用（' + (e && e.message ? e.message : e) + '），仍可正常编辑与保存');
    return;
  }
  EditorState.viewerReady = true;
  try {
    loadSceneToViewer(0, true);
    if (work && work.initialRotation) {
      Viewer.setInitialRotation(work.initialRotation.x || 0, work.initialRotation.y || 0);
    }
  } catch (e) {
    console.warn('[editor] 场景载入失败：', e);
  }
}

// 在舞台中央给出降级提示（替代一直转圈的加载层）
function showStageNotice(msg) {
  const ld = $('viewerLoading');
  if (ld) {
    ld.style.display = 'flex';
    ld.innerHTML = '<div style="max-width:420px;text-align:center;line-height:1.8;font-size:0.85rem;color:#f0b46a;">'
      + '<div style="font-size:1.8rem;margin-bottom:10px;">⚠️</div>' + msg + '</div>';
  }
}

// 没有作品时的友好兜底：仍然把编辑器骨架搭起来，避免整页看起来是坏的
function editorEmptyState(title, desc) {
  buildRail();
  const strip = $('sceneStrip');
  if (strip) strip.innerHTML = '';
  const ld = $('viewerLoading');
  if (ld) ld.style.display = 'none';
  const hint = document.querySelector('.et-stage-hint');
  if (hint) hint.textContent = '请从工作台进入编辑器';
  const panel = $('etPanel');
  if (panel) panel.innerHTML = `
    <div class="et-empty">
      <div class="et-empty-icon">🗂️</div>
      <div class="et-empty-title">${title}</div>
      <div class="et-empty-desc">${desc}</div>
      <button class="et-empty-btn" onclick="window.location.href='admin.html'">返回工作台</button>
    </div>`;
}

function loadSceneToViewer(idx, initial) {
  const scene = EditorState.scenes[idx];
  if (!scene) return;
  EditorState.sceneIdx = idx;
  try {
    Viewer.loadPanorama(scene.panorama, {
      title: (EditorState.work && EditorState.work.title) || '全景作品',
      author: (EditorState.work && EditorState.work.author) || '',
      sceneTitle: scene.title || ('场景 ' + (idx + 1)),
      hotspots: scene.hotspots || [],
      work: { scenes: EditorState.scenes },
      musicUrl: (EditorState.work && EditorState.work.musicUrl) || '',
    });
  } catch (e) {
    console.warn('[editor] loadPanorama 失败：', e);
  }
  // 高亮场景条
  document.querySelectorAll('.et-scene').forEach((el, i) => el.classList.toggle('active', i === idx));
}

// ══════════════════════════════════════════════════════════
//  左侧模块栏
// ══════════════════════════════════════════════════════════
function buildRail() {
  const rail = $('etRail');
  if (!rail) return;
  rail.innerHTML = EDITOR_MODULES.map(m => `
    <button class="et-rail-btn" data-mod="${m.id}" onclick="switchModule('${m.id}')" title="${m.label}">
      <span class="et-rail-icon">${m.icon}</span>
      <span class="et-rail-label">${m.label}</span>
    </button>
  `).join('');
}

function switchModule(mod) {
  EditorState.activeModule = mod;
  document.querySelectorAll('.et-rail-btn').forEach(b => b.classList.toggle('active', b.dataset.mod === mod));
  const panel = $('etPanel');
  if (!panel) return;
  if (mod === 'basic') renderBasicPanel();
  else if (mod === 'view') renderViewPanel();
  else if (mod === 'hotspot') renderHotspotPanel();
  else if (mod === 'music') renderMusicPanel();
  else if (mod === 'sandbox') renderSandboxPanel();
  else if (mod === 'mask') renderMaskPanel();
  else if (mod === 'embed') renderEmbedPanel();
  else if (mod === 'effect') renderEffectPanel();
}

// ── 基础信息 ─────────────────────────────────────────────
function renderBasicPanel() {
  const w = EditorState.work;
  const catOpts = EDITOR_CATEGORIES.map(c => `<option value="${c.id}" ${w.category === c.id ? 'selected' : ''}>${c.icon || ''} ${c.name}</option>`).join('')
    || `<option value="${w.category || ''}">${w.category || '未分类'}</option>`;
  const privacy = w.privacy || 'public';
  const tagsHtml = EditorState.tags.map((t, i) => `<span class="tag">${t}<button onclick="editorRemoveTag(${i})">✕</button></span>`).join('');
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>基础信息</h3><span class="et-panel-sub">设置作品的基础资料</span></div>
    <div class="et-form">
      <div class="et-field">
        <label>作品分类</label>
        <select id="etCategory">${catOpts}</select>
      </div>
      <div class="et-field">
        <label>作者 / 设计师</label>
        <input id="etAuthor" type="text" value="${getWorkAuthor(w)}" placeholder="请输入作者（留空则不展示）">
      </div>
      <div class="et-field">
        <label>设计说明</label>
        <textarea id="etDesc" rows="4" placeholder="描述这个全景作品的设计理念...">${(w.desc || '').replace(/</g, '&lt;')}</textarea>
      </div>
      <div class="et-field">
        <label>标签</label>
        <input id="etTagInput" type="text" placeholder="输入标签后回车" onkeydown="editorAddTag(event)">
        <div class="tags-container" id="etTags">${tagsHtml}</div>
      </div>
      <div class="et-field">
        <label>访问权限</label>
        <div class="et-radio-row">
          <label class="et-radio"><input type="radio" name="etPrivacy" value="public" ${privacy === 'public' ? 'checked' : ''} onchange="editorTogglePrivacy()"><span>公开</span></label>
          <label class="et-radio"><input type="radio" name="etPrivacy" value="link" ${privacy === 'link' ? 'checked' : ''} onchange="editorTogglePrivacy()"><span>链接访问</span></label>
          <label class="et-radio"><input type="radio" name="etPrivacy" value="private" ${privacy === 'private' ? 'checked' : ''} onchange="editorTogglePrivacy()"><span>私密</span></label>
        </div>
      </div>
      <div class="et-field" id="etPwField" style="display:${privacy === 'link' ? 'block' : 'none'}">
        <label>访问密码</label>
        <input id="etPassword" type="text" value="${w.accessPassword || ''}" placeholder="设置访问密码">
      </div>
      <div class="et-switch-row">
        <div><div class="et-switch-title">自动巡游</div><div class="et-switch-desc">无操作一段时间后自动旋转展示</div></div>
        <label class="et-switch"><input type="checkbox" id="etAutoRotate" ${w.autoRotate ? 'checked' : ''}><span class="et-switch-slider"></span></label>
      </div>
      <div class="et-switch-row">
        <div><div class="et-switch-title">手机陀螺仪</div><div class="et-switch-desc">移动端可用陀螺仪环视</div></div>
        <label class="et-switch"><input type="checkbox" id="etGyro" ${w.gyro !== false ? 'checked' : ''}><span class="et-switch-slider"></span></label>
      </div>
    </div>`;
}
function editorTogglePrivacy() {
  const pw = $('etPwField');
  const v = document.querySelector('input[name="etPrivacy"]:checked')?.value;
  if (pw) pw.style.display = v === 'link' ? 'block' : 'none';
}
function editorAddTag(e) {
  if (e.key !== 'Enter') return; e.preventDefault();
  const v = e.target.value.trim();
  if (!v || EditorState.tags.includes(v) || EditorState.tags.length >= 8) return;
  EditorState.tags.push(v);
  e.target.value = '';
  renderBasicPanel();
}
function editorRemoveTag(i) { EditorState.tags.splice(i, 1); renderBasicPanel(); }

// ── 视角 ─────────────────────────────────────────────────
function renderViewPanel() {
  const w = EditorState.work;
  const rx = (w.initialRotation && w.initialRotation.x) || 0;
  const ry = (w.initialRotation && w.initialRotation.y) || 0;
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>视角设置</h3><span class="et-panel-sub">设置作品打开时的初始画面</span></div>
    <div class="et-form">
      <div class="et-tip">💡 在中央全景中拖动到想要的初始角度，点击「设为初始视角」即可保存。</div>
      <div class="et-field et-readonly">
        <label>当前水平角 (Yaw)</label>
        <input id="etRotX" type="text" value="${rx.toFixed(2)}" readonly>
      </div>
      <div class="et-field et-readonly">
        <label>当前俯仰角 (Pitch)</label>
        <input id="etRotY" type="text" value="${ry.toFixed(2)}" readonly>
      </div>
      <div class="et-btn-row">
        <button class="et-btn" onclick="editorPreviewView()">👁 预览当前视角</button>
        <button class="et-btn primary" onclick="editorSetViewpoint()">📌 设为初始视角</button>
      </div>
      <div class="et-switch-row">
        <div><div class="et-switch-title">自动巡游保持初始视角</div><div class="et-switch-desc">巡游时回到初始高度</div></div>
        <label class="et-switch"><input type="checkbox" id="etKeepInit"><span class="et-switch-slider"></span></label>
      </div>
    </div>`;
  if (w.keepInitialView) $('etKeepInit').checked = true;
}
function editorPreviewView() {
  if (!EditorState.viewerReady) { showToast('3D 预览不可用，无法预览视角', 'error'); return; }
  const x = parseFloat($('etRotX')?.value) || 0;
  const y = parseFloat($('etRotY')?.value) || 0;
  if (Viewer.setLiveRotation) Viewer.setLiveRotation(x, y);
  showToast('已预览视角', 'success');
}
function editorSetViewpoint() {
  if (!EditorState.viewerReady || !Viewer.getRotation) { showToast('3D 预览不可用，无法设置初始视角', 'error'); return; }
  const r = Viewer.getRotation();
  const rx = $('etRotX'), ry = $('etRotY');
  if (rx) rx.value = (r.x || 0).toFixed(2);
  if (ry) ry.value = (r.y || 0).toFixed(2);
  if (Viewer.setLiveRotation) Viewer.setLiveRotation(r.x || 0, r.y || 0);
  showToast('已设为初始视角', 'success');
  EditorState.dirty = true;
}

// ── 热点 ─────────────────────────────────────────────────
function renderHotspotPanel() {
  if (EditorState.activeHotspotScene >= EditorState.scenes.length) EditorState.activeHotspotScene = 0;
  const chips = EditorState.scenes.map((s, i) => `
    <button class="et-chip ${i === EditorState.activeHotspotScene ? 'active' : ''}" onclick="editorSelectHotspotScene(${i})">${s.title || ('场景 ' + (i + 1))}</button>
  `).join('');
  const scene = EditorState.scenes[EditorState.activeHotspotScene];
  const hotspots = (scene && scene.hotspots) || [];
  const typeList = (typeof Viewer !== 'undefined' && Viewer.HOTSPOT_TYPES) ? Viewer.HOTSPOT_TYPES : [
    { value: 'scene', label: '场景切换', icon: '🏠' }, { value: 'image', label: '图片', icon: '🖼' },
    { value: 'text', label: '文字说明', icon: '📝' }, { value: 'link', label: '外部链接', icon: '🔗' },
    { value: 'phone', label: '电话', icon: '📞' }, { value: 'video', label: '视频', icon: '🎬' },
    { value: 'audio', label: '音频', icon: '🔊' }, { value: 'article', label: '文章图文', icon: '📄' },
  ];
  const placeholderMap = {
    image: '图片URL', text: '说明文字', link: '链接(含http)', phone: '电话号码',
    video: '视频URL', audio: '音频URL', article: '图文/文章URL或文字',
  };
  const listHtml = hotspots.length === 0
    ? `<div class="et-empty">该场景暂无热点，点击下方「添加热点」开始</div>`
    : hotspots.map((h, i) => {
        const icon = (typeList.find(t => t.value === h.type) || {}).icon || '📍';
        const typeOpts = typeList.map(t => `<option value="${t.value}" ${h.type === t.value ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('');
        let contentField;
        if (h.type === 'scene') {
          const sceneOpts = EditorState.scenes.map((s, si) =>
            `<option value="${s.id != null ? s.id : si}" ${((s.id != null && s.id == h.content) || (s.id == null && String(si) === String(h.content))) ? 'selected' : ''}>${s.title || ('场景 ' + (si + 1))}</option>`
          ).join('');
          contentField = `<select class="hs-content" onchange="editorUpdateHotspot(${EditorState.activeHotspotScene},${i},'content',this.value)"><option value="">选择目标场景</option>${sceneOpts}</select>`;
        } else {
          const ph = placeholderMap[h.type] || '内容';
          contentField = `<input class="hs-content" type="text" value="${h.content || ''}" placeholder="${ph}" onchange="editorUpdateHotspot(${EditorState.activeHotspotScene},${i},'content',this.value)">`;
        }
        const marked = h.position && (h.position.yaw || h.position.pitch);
        return `
        <div class="hotspot-item" data-hs-type="${h.type}">
          <div class="hs-icon hs-icon-${h.type}">${icon}</div>
          <div class="hs-info">
            <input class="hs-name" type="text" value="${h.title || '热点 ' + (i + 1)}" placeholder="热点名称" onchange="editorUpdateHotspot(${EditorState.activeHotspotScene},${i},'title',this.value)">
            <select class="hs-type" onchange="editorUpdateHotspot(${EditorState.activeHotspotScene},${i},'type',this.value)">${typeOpts}</select>
            ${contentField}
            <div class="hs-pos">
              ${marked ? `<span class="hs-coord">📌 ${Math.round(h.position.yaw || 0)}°, ${Math.round(h.position.pitch || 0)}°</span>` : `<span class="hs-unmarked">⚠ 未标记位置</span>`}
              <button class="hs-place-btn" onclick="editorPlaceHotspot(${EditorState.activeHotspotScene},${i})">${marked ? '🔄 重新标记' : '📍 标记位置'}</button>
            </div>
          </div>
          <button class="edit-scene-btn danger" onclick="editorRemoveHotspot(${EditorState.activeHotspotScene},${i})">✕</button>
        </div>`;
      }).join('');

  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>热点编辑</h3><span class="et-panel-sub">为当前场景添加交互热点</span></div>
    <div class="et-chip-row">${chips}</div>
    <button class="et-btn primary et-add-hotspot" onclick="editorAddHotspot()">＋ 添加热点</button>
    <div class="et-hotspot-list">${listHtml}</div>`;
}
function editorSelectHotspotScene(i) {
  EditorState.activeHotspotScene = i;
  loadSceneToViewer(i);
  renderHotspotPanel();
}
function editorAddHotspot() {
  const i = EditorState.activeHotspotScene;
  const scene = EditorState.scenes[i];
  if (!scene) return;
  if (!scene.hotspots) scene.hotspots = [];
  const idx = scene.hotspots.length;
  scene.hotspots.push({ id: 'h_' + genId(), type: 'scene', title: '新热点', content: '', position: { yaw: 0, pitch: 0 } });
  EditorState.dirty = true;
  renderHotspotPanel();
  if (scene.panorama) { showToast('请在全景中轻点放置热点位置', 'success'); editorPlaceHotspot(i, idx); }
  else showToast('请先上传该场景全景图后再标记', 'error');
}
function editorUpdateHotspot(sceneIdx, i, key, value) {
  const scene = EditorState.scenes[sceneIdx];
  if (scene && scene.hotspots && scene.hotspots[i]) { scene.hotspots[i][key] = value; EditorState.dirty = true; }
}
function editorRemoveHotspot(sceneIdx, i) {
  const scene = EditorState.scenes[sceneIdx];
  if (scene && scene.hotspots) { scene.hotspots.splice(i, 1); EditorState.dirty = true; renderHotspotPanel(); }
}
function editorPlaceHotspot(sceneIdx, hotspotIdx) {
  const scene = EditorState.scenes[sceneIdx];
  if (!scene || !scene.panorama) { showToast('请先为场景上传全景图', 'error'); return; }
  if (!EditorState.viewerReady || typeof Viewer === 'undefined' || !Viewer.enablePlacement) {
    showToast('3D 预览不可用，无法拖动放置热点', 'error'); return;
  }
  loadSceneToViewer(sceneIdx);
  try {
    Viewer.enablePlacement(function (pos) {
      const sc = EditorState.scenes[sceneIdx];
      if (!sc.hotspots) sc.hotspots = [];
      const hs = sc.hotspots[hotspotIdx];
      if (hs) { hs.position = pos; EditorState.dirty = true; renderHotspotPanel(); showToast('热点位置：' + Math.round(pos.yaw) + '°, ' + Math.round(pos.pitch) + '°', 'success'); }
    });
  } catch (e) {
    console.warn('[editor] 热点放置失败：', e);
    showToast('热点放置失败，请刷新后重试', 'error');
  }
}

// ── 音乐 ─────────────────────────────────────────────────
function renderMusicPanel() {
  const w = EditorState.work;
  const url = w.musicUrl || '';
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>背景音乐</h3><span class="et-panel-sub">为作品添加 BGM</span></div>
    <div class="et-form">
      <div class="et-field">
        <label>音乐文件直链 (URL)</label>
        <input id="etMusicUrl" type="text" value="${url}" placeholder="https://.../bgm.mp3">
      </div>
      <div class="et-btn-row">
        <button class="et-btn" onclick="editorUploadMusic()">⬆️ 上传音乐</button>
        <button class="et-btn" onclick="editorPlayMusic()">▶ 试听</button>
      </div>
      <div class="et-tip">支持 mp3 / m4a 直链。也可在管理后台「系统设置」配置图床后使用。</div>
    </div>`;
}
function editorUploadMusic() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'audio/*';
  input.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    showToast('正在上传音乐...');
    try {
      const r = await uploadToImgbb(f);
      const el = $('etMusicUrl');
      if (el) { el.value = r.url; EditorState.dirty = true; }
      showToast('音乐已上传', 'success');
    } catch (err) { showToast('上传失败：' + err.message, 'error'); }
  };
  input.click();
}
function editorPlayMusic() {
  const url = $('etMusicUrl')?.value.trim();
  if (!url) { showToast('请先填写音乐链接', 'error'); return; }
  let a = document.getElementById('etMusicAudio');
  if (!a) { a = document.createElement('audio'); a.id = 'etMusicAudio'; a.loop = true; document.body.appendChild(a); }
  a.src = url; a.play().then(() => showToast('正在播放', 'success')).catch(() => showToast('播放失败，可能是跨域或链接无效', 'error'));
}

// ── 沙盘 / 遮罩 / 嵌入 / 特效（配置持久化）────────────────
function renderSandboxPanel() {
  const w = EditorState.work;
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>电子沙盘</h3><span class="et-panel-sub">上传平面图并定位场景</span></div>
    <div class="et-form">
      <div class="et-field">
        <label>沙盘平面图</label>
        <input id="etSandboxImg" type="text" value="${w.sandbox && w.sandbox.image || ''}" placeholder="平面图图片URL">
        <button class="et-btn" style="margin-top:8px" onclick="editorUploadSandbox()">⬆️ 上传平面图</button>
      </div>
      <div class="et-tip">在图上为各场景添加定位点，观看者点击即可跳转（预览页生效）。</div>
    </div>`;
}
function editorUploadSandbox() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    showToast('正在上传...');
    try {
      const r = await uploadToImgbb(f);
      const el = $('etSandboxImg'); if (el) { el.value = r.url; EditorState.dirty = true; }
      showToast('平面图已上传', 'success');
    } catch (err) { showToast('上传失败：' + err.message, 'error'); }
  };
  input.click();
}
function renderMaskPanel() {
  const w = EditorState.work; const m = w.mask || {};
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>遮罩</h3><span class="et-panel-sub">顶部/底部信息层</span></div>
    <div class="et-form">
      <div class="et-field"><label>顶部遮罩文字</label><input id="etMaskTop" type="text" value="${m.top || ''}" placeholder="如：品牌 / LOGO 文案"></div>
      <div class="et-field"><label>底部遮罩文字</label><input id="etMaskBottom" type="text" value="${m.bottom || ''}" placeholder="如：版权信息"></div>
      <div class="et-tip">遮罩用于在全景顶部/底部展示固定信息（预览页生效）。</div>
    </div>`;
}
function renderEmbedPanel() {
  const w = EditorState.work; const embeds = w.embeds || [];
  const list = embeds.length ? embeds.map((e, i) => `<div class="et-embed-item">${e.text || e.url || '嵌入项'} <button onclick="editorRemoveEmbed(${i})">✕</button></div>`).join('') : '<div class="et-empty">暂无嵌入</div>';
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>嵌入</h3><span class="et-panel-sub">图文贴片</span></div>
    <div class="et-form">
      <div class="et-field"><label>嵌入文字</label><input id="etEmbedText" type="text" placeholder="嵌入说明文字"></div>
      <button class="et-btn primary" onclick="editorAddEmbed()">＋ 添加嵌入</button>
      <div class="et-embed-list" style="margin-top:12px">${list}</div>
    </div>`;
}
function editorAddEmbed() {
  const v = $('etEmbedText')?.value.trim(); if (!v) return;
  if (!EditorState.work.embeds) EditorState.work.embeds = [];
  EditorState.work.embeds.push({ text: v }); EditorState.dirty = true; renderEmbedPanel();
}
function editorRemoveEmbed(i) { EditorState.work.embeds.splice(i, 1); EditorState.dirty = true; renderEmbedPanel(); }
function renderEffectPanel() {
  const w = EditorState.work; const fx = w.effects || {};
  $('etPanel').innerHTML = `
    <div class="et-panel-head"><h3>特效</h3><span class="et-panel-sub">烘托场景氛围</span></div>
    <div class="et-form">
      <div class="et-switch-row"><div><div class="et-switch-title">下雪</div></div><label class="et-switch"><input type="checkbox" id="etFxSnow" ${fx.snow ? 'checked' : ''}><span class="et-switch-slider"></span></label></div>
      <div class="et-switch-row"><div><div class="et-switch-title">下雨</div></div><label class="et-switch"><input type="checkbox" id="etFxRain" ${fx.rain ? 'checked' : ''}><span class="et-switch-slider"></span></label></div>
      <div class="et-tip">特效将在作品预览/分享页展示。</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════
//  场景条
// ══════════════════════════════════════════════════════════
function renderSceneStrip() {
  const strip = $('sceneStrip');
  if (!strip) return;
  const tiles = EditorState.scenes.map((s, i) => `
    <div class="et-scene ${i === EditorState.sceneIdx ? 'active' : ''}" data-idx="${i}" onclick="editorSwitchScene(${i})">
      <img src="${s.thumb || s.panorama || ''}" alt="${s.title || ''}" loading="lazy">
      <span class="et-scene-name">${s.title || ('场景 ' + (i + 1))}</span>
      ${i === 0 ? '<span class="et-scene-cover">封面</span>' : ''}
      <div class="et-scene-actions" onclick="event.stopPropagation()">
        ${i === 0 ? '' : `<button onclick="editorSetCover(${i})" title="设为封面">⭐</button>`}
        <button onclick="editorReplaceScene(${i})" title="替换图片">🔄</button>
        <button onclick="editorRemoveScene(${i})" title="删除">✕</button>
      </div>
    </div>
  `).join('');
  strip.innerHTML = tiles + `<div class="et-scene add" onclick="editorAddScene()"><div class="et-scene-add-ico">＋</div><span>添加场景</span></div>`;
}
function editorSwitchScene(i) { loadSceneToViewer(i); if (EditorState.activeModule === 'hotspot') { EditorState.activeHotspotScene = i; renderHotspotPanel(); } }
function editorSetCover(i) {
  if (i === 0) return;
  const [s] = EditorState.scenes.splice(i, 1);
  EditorState.scenes.unshift(s);
  EditorState.dirty = true;
  renderSceneStrip(); renderHotspotPanel();
  showToast('已设为封面场景', 'success');
}
function editorReplaceScene(i) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
  input.onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    showToast('正在上传替换图片...');
    try {
      const r = await uploadToImgbb(f);
      EditorState.scenes[i] = { ...EditorState.scenes[i], panorama: r.url, thumb: r.thumb || r.url };
      EditorState.dirty = true; renderSceneStrip(); loadSceneToViewer(i);
      showToast('场景图片已替换', 'success');
    } catch (err) { showToast('替换失败：' + err.message, 'error'); }
  };
  input.click();
}
function editorRemoveScene(i) {
  if (EditorState.scenes.length <= 1) { showToast('至少保留一个场景', 'error'); return; }
  EditorState.scenes.splice(i, 1);
  EditorState.dirty = true; renderSceneStrip();
  if (EditorState.activeHotspotScene >= EditorState.scenes.length) EditorState.activeHotspotScene = 0;
  loadSceneToViewer(Math.min(i, EditorState.scenes.length - 1));
  renderHotspotPanel();
}
function editorAddScene() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    showToast('正在上传新场景...');
    try {
      for (const f of files) {
        const r = await uploadToImgbb(f);
        EditorState.scenes.push({ id: 's_' + genId(), title: '新场景', panorama: r.url, thumb: r.thumb || r.url, hotspots: [] });
      }
      EditorState.dirty = true; renderSceneStrip();
      showToast('新场景已添加', 'success');
    } catch (err) { showToast('添加失败：' + err.message, 'error'); }
  };
  input.click();
}

// ══════════════════════════════════════════════════════════
//  保存 / 发布 / 预览 / 退出
// ══════════════════════════════════════════════════════════
function onTitleInput() {
  if (EditorState.work) { EditorState.work.title = $('etTitle').value.trim() || '未命名作品'; EditorState.dirty = true; }
}
function collectBasic() {
  const w = EditorState.work;
  w.category = $('etCategory')?.value || w.category || '';
  w.author = $('etAuthor')?.value.trim() || '';
  w.desc = $('etDesc')?.value.trim() || '';
  w.tags = [...EditorState.tags];
  w.privacy = document.querySelector('input[name="etPrivacy"]:checked')?.value || 'public';
  w.accessPassword = $('etPassword')?.value || '';
  w.autoRotate = $('etAutoRotate')?.checked || false;
  w.gyro = $('etGyro')?.checked !== false;
  w.initialRotation = { x: parseFloat($('etRotX')?.value) || 0, y: parseFloat($('etRotY')?.value) || 0 };
  w.keepInitialView = $('etKeepInit')?.checked || false;
  w.musicUrl = $('etMusicUrl')?.value.trim() || '';
  w.sandbox = { image: $('etSandboxImg')?.value.trim() || '' };
  w.mask = { top: $('etMaskTop')?.value.trim() || '', bottom: $('etMaskBottom')?.value.trim() || '' };
  w.embeds = w.embeds || [];
  w.effects = { snow: $('etFxSnow')?.checked || false, rain: $('etFxRain')?.checked || false };
  w.scenes = JSON.parse(JSON.stringify(EditorState.scenes));
  w.thumb = EditorState.scenes[0]?.thumb || w.thumb || '';
  w.panorama = EditorState.scenes[0]?.panorama || w.panorama || '';
}
async function saveWork(silent) {
  if (!EditorState.work) return;
  collectBasic();
  try {
    await eDbPutWork(EditorState.work);
    EditorState.dirty = false;
    const flag = $('etSaveFlag'); if (flag) { flag.textContent = '已保存'; flag.classList.add('saved'); }
    if (!silent) showToast('✅ 作品已保存', 'success');
  } catch (err) { showToast('保存失败：' + err.message, 'error'); }
}
async function publishWork() {
  if (!EditorState.work) return;
  EditorState.work.status = 'published';
  await saveWork(true);
  showToast('🚀 作品已发布', 'success');
  setTimeout(() => openPreview(), 600);
}
function openPreview() {
  if (!EditorState.work) return;
  collectBasic();
  const url = getShareBaseUrl() + '?data=' + encodeShareData(EditorState.work);
  window.open(url, '_blank');
}
function editorExit() {
  if (EditorState.dirty) {
    if (!confirm('有未保存的修改，确定离开吗？')) return;
  }
  document.body.style.overflow = '';
  location.href = 'admin.html';
}

// ══════════════════════════════════════════════════════════
//  视图菜单
// ══════════════════════════════════════════════════════════
function toggleViewMenu() {
  const m = $('etViewMenu');
  if (m) m.style.display = m.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', (e) => {
  const m = $('etViewMenu');
  if (m && m.style.display === 'block' && !e.target.closest('.et-tool-group')) m.style.display = 'none';
});

// ── 启动 ──
window.addEventListener('DOMContentLoaded', initEditor);
