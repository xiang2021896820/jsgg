// ============================================================
//  全景VR展示平台 - 全景查看器 (Three.js)
//  支持：多场景切换、指南针、加载进度、热点渲染、视角模式
//        （正常/鱼眼/小行星/水晶球）、常驻工具栏、全屏、
//        背景音乐、评论面板、VR分屏、热点可视化标记
// ============================================================

const Viewer = (() => {
  let renderer, scene, camera, sphere, cameraL, cameraR;
  let musicEl;
  let isAnimating = false;
  let autoRotate = false;
  let autoRotateSpeed = 0.0015;
  let isFullscreen = false;

  // 拖拽状态
  let isDragging = false;
  let prevMouseX = 0, prevMouseY = 0;
  let rotationX = 0, rotationY = 0;
  let targetRotX = 0, targetRotY = 0;
  let velX = 0, velY = 0; // 松手后的惯性速度
  const dampFactor = 0.12;
  const momentumFactor = 0.94;

  // 触摸状态
  let prevTouchX = 0, prevTouchY = 0;
  let prevTouchDist = 0;

  // FOV
  let currentFOV = 75;
  const MIN_FOV = 30, MAX_FOV = 100;
  const FISHEYE_FOV = 140;

  // 陀螺仪
  let gyroEnabled = false;
  let gyroData = { alpha: 0, beta: 0, gamma: 0, ready: false };
  let deviceOrientationHandler = null;
  // 标准 DeviceOrientationControls 四元数（修正反向 + 屏幕方向）
  const zee = new THREE.Vector3(0, 0, 1);
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // 绕 X 轴 -90°
  const _gyroEuler = new THREE.Euler();

  // 指南针
  let compassEl = null;

  // 初始视角
  let initialRotation = { x: 0, y: 0 };

  // 视角模式
  let viewMode = 'normal'; // normal | fisheye | planet | ball
  let planetLockY = 0;

  // 热点
  let hotspotLayer = null;
  let hotspotMarkers = [];
  let currentHotspots = [];
  let currentScenes = [];
  let onSceneSwitchCb = null;

  // 热点放置模式（后台用）
  let placementMode = false;
  let placementCb = null;

  // VR 模式
  let vrMode = false;

  // 当前作品信息
  let currentWork = null;
  let onCommentToggleCb = null;
  let musicUrl = '';

  const _tmpVec = new THREE.Vector3();
  const _camDir = new THREE.Vector3();

  const canvas = () => document.getElementById('vrCanvas');
  const overlay = () => document.getElementById('viewerOverlay');
  const loadingEl = () => document.getElementById('viewerLoading');

  // ── 场景纹理缓存 + 预加载 ─────────────────────────────────
  // 全景纹理非常吃显存（8K×4K 的 RGBA 纹理约 130MB，含 mipmap 更多），
  // 所以缓存条数必须很小；它的作用是把「来回切换场景」变成瞬时的。
  const TEX_CACHE_MAX = 2;           // 最多缓存几张已解码纹理
  const TEX_CACHE_MAX_PIXELS = 48e6; // 超过此像素量的单张不缓存，避免撑爆显存
  const texCache = new Map();        // url -> THREE.Texture
  const texOrder = [];               // LRU 顺序：最近使用在末尾
  const preloadInflight = new Set();
  let preloadTimer = null;
  let preloadIdleHandle = null;
  let preloadToken = 0;

  // 弱网 / 开了省流量 / 低内存设备 → 不预加载
  function isPreloadBlocked() {
    if (document.hidden) return true;
    try {
      const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c) {
        if (c.saveData) return true;
        const et = String(c.effectiveType || '');
        if (et === 'slow-2g' || et === '2g') return true;
      }
      if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory < 2) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function texPixels(tex) {
    const img = tex && tex.image;
    return (img && img.width && img.height) ? (img.width * img.height) : 0;
  }

  function texCacheGet(url) {
    const t = texCache.get(url);
    if (!t) return null;
    const i = texOrder.indexOf(url);
    if (i !== -1) texOrder.splice(i, 1); // 提到「最近使用」
    texOrder.push(url);
    return t;
  }

  function texCachePut(url, tex) {
    if (!url || !tex) return;
    if (texPixels(tex) > TEX_CACHE_MAX_PIXELS) return; // 太大的不缓存
    const prev = texCache.get(url);
    if (prev && prev !== tex) { try { prev.dispose(); } catch (e) { /* ignore */ } }
    texCache.set(url, tex);
    const i = texOrder.indexOf(url);
    if (i !== -1) texOrder.splice(i, 1);
    texOrder.push(url);
    while (texOrder.length > TEX_CACHE_MAX) {
      const old = texOrder.shift();
      const t = texCache.get(old);
      texCache.delete(old);
      // 正在显示的纹理绝不能 dispose
      const inUse = !!(sphere && sphere.material && sphere.material.map === t);
      if (t && !inUse) { try { t.dispose(); } catch (e) { /* ignore */ } }
    }
  }

  function texCacheClear() {
    texOrder.length = 0;
    texCache.forEach((t) => {
      const inUse = !!(sphere && sphere.material && sphere.material.map === t);
      if (!inUse) { try { t.dispose(); } catch (e) { /* ignore */ } }
    });
    texCache.clear();
  }

  // ── 初始化 ──────────────────────────────────────────────
  function init() {
    const cv = canvas();
    if (!cv) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(currentFOV, cv.offsetWidth / cv.offsetHeight, 0.1, 1000);
    camera.position.set(0, 0, 0.01);
    cameraL = camera.clone();
    cameraR = camera.clone();

    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(cv.offsetWidth, cv.offsetHeight);

    // 背景音乐元素
    if (!document.getElementById('viewerMusic')) {
      musicEl = document.createElement('audio');
      musicEl.id = 'viewerMusic';
      musicEl.loop = true;
      musicEl.preload = 'auto';
      musicEl.style.display = 'none';
      overlay() && overlay().appendChild(musicEl);
    } else {
      musicEl = document.getElementById('viewerMusic');
    }

    window.addEventListener('resize', onResize);
    bindMouseEvents();
    bindTouchEvents();
    bindPlacementEvents();

    createCompass();
    ensureHotspotLayer();
    startLoop();
  }

  // ── 指南针 ──────────────────────────────────────────────
  function createCompass() {
    if (document.getElementById('viewerCompass')) return;
    compassEl = document.createElement('div');
    compassEl.id = 'viewerCompass';
    compassEl.className = 'viewer-compass';
    compassEl.innerHTML = `
      <div class="compass-ring">
        <div class="compass-needle"></div>
        <span class="compass-dir north">N</span>
        <span class="compass-dir south">S</span>
        <span class="compass-dir east">E</span>
        <span class="compass-dir west">W</span>
      </div>`;
    const container = document.querySelector('.viewer-container');
    if (container) container.appendChild(compassEl);
    else compassEl = null;
  }

  function updateCompass() {
    if (!compassEl) compassEl = document.getElementById('viewerCompass');
    if (!compassEl) return;
    const ring = compassEl.querySelector('.compass-ring');
    if (ring) {
      const deg = (rotationX * 180 / Math.PI) % 360;
      ring.style.transform = `rotate(${deg}deg)`;
    }
  }

  // ── 热点图层 ────────────────────────────────────────────
  function ensureHotspotLayer() {
    if (document.getElementById('hotspotLayer')) {
      hotspotLayer = document.getElementById('hotspotLayer');
      return;
    }
    hotspotLayer = document.createElement('div');
    hotspotLayer.id = 'hotspotLayer';
    hotspotLayer.className = 'hotspot-layer';
    const container = document.querySelector('.viewer-container');
    if (container) container.appendChild(hotspotLayer);
  }

  function buildHotspots(hotspots) {
    ensureHotspotLayer();
    hotspotLayer.innerHTML = '';
    hotspotMarkers = [];
    currentHotspots = Array.isArray(hotspots) ? hotspots : [];
    currentHotspots.forEach((h) => {
      const el = document.createElement('div');
      el.className = `hs-marker hs-type-${h.type || 'text'}`;
      el.dataset.id = h.id || '';
      const icon = hotspotIcon(h.type);
      el.innerHTML = `
        <div class="hs-dot">${icon}</div>
        <div class="hs-label">${escapeHtml(h.title || '热点')}</div>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        handleHotspotClick(h);
      });
      hotspotLayer.appendChild(el);
      hotspotMarkers.push({ el, hotspot: h });
    });
  }

  // 热点类型清单（图标 + 标签），供前台展示与后台编辑共用
  const HOTSPOT_TYPES = [
    { value: 'scene',    label: '场景切换', icon: '🏠' },
    { value: 'image',    label: '图片',     icon: '🖼' },
    { value: 'text',     label: '文字说明', icon: '📝' },
    { value: 'link',     label: '外部链接', icon: '🔗' },
    { value: 'phone',    label: '电话',     icon: '📞' },
    { value: 'video',    label: '视频',     icon: '🎬' },
    { value: 'audio',    label: '音频',     icon: '🔊' },
    { value: 'article',  label: '文章图文', icon: '📄' },
    { value: 'info',     label: '信息提示', icon: 'ℹ️' },
    { value: 'location', label: '位置导航', icon: '📍' },
    { value: 'product',  label: '商品购买', icon: '🛒' },
    { value: 'music',    label: '音乐曲目', icon: '🎵' },
    { value: 'gift',     label: '优惠福利', icon: '🎁' },
    { value: 'wechat',   label: '微信客服', icon: '💬' },
    { value: 'map',      label: '地图导航', icon: '🗺' },
    { value: 'download', label: '下载',     icon: '⬇️' },
  ];
  const HOTSPOT_ICON_MAP = {};
  HOTSPOT_TYPES.forEach(t => { HOTSPOT_ICON_MAP[t.value] = t.icon; });

  function hotspotIcon(type) {
    return HOTSPOT_ICON_MAP[type] || '📍';
  }

  function updateHotspots() {
    if (!hotspotLayer || hotspotMarkers.length === 0) return;
    const cv = canvas();
    const w = cv.offsetWidth, h = cv.offsetHeight;
    camera.getWorldDirection(_camDir);
    for (const m of hotspotMarkers) {
      const pos = yawPitchToVector(m.hotspot.position);
      if (!pos) { m.el.style.display = 'none'; continue; }
      // 在相机前方？
      _tmpVec.copy(pos).sub(camera.position);
      if (_tmpVec.dot(_camDir) <= 0.05) { m.el.style.display = 'none'; continue; }
      _tmpVec.copy(pos).project(camera);
      const x = (_tmpVec.x * 0.5 + 0.5) * w;
      const y = (-_tmpVec.y * 0.5 + 0.5) * h;
      m.el.style.display = 'flex';
      m.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    }
  }

  // yaw/pitch(弧度) -> 球面向量
  function yawPitchToVector(pos) {
    if (!pos) return null;
    const yaw = (pos.yaw || 0) * Math.PI / 180;
    const pitch = (pos.pitch || 0) * Math.PI / 180;
    const r = 300;
    return new THREE.Vector3(
      r * Math.cos(pitch) * Math.sin(yaw),
      r * Math.sin(pitch),
      r * Math.cos(pitch) * Math.cos(yaw)
    );
  }

  // 屏幕点击 -> yaw/pitch
  function screenToYawPitch(clientX, clientY) {
    const cv = canvas();
    const rect = cv.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    _tmpVec.set(ndcX, ndcY, 0.5).unproject(camera);
    _tmpVec.sub(camera.position).normalize();
    const yaw = Math.atan2(_tmpVec.x, _tmpVec.z) * 180 / Math.PI;
    const pitch = Math.asin(Math.max(-1, Math.min(1, _tmpVec.y))) * 180 / Math.PI;
    return { yaw: Math.round(yaw), pitch: Math.round(pitch) };
  }

  function openLinkContent(content, fallbackMsg) {
    if (!content) { if (typeof showToast === 'function') showToast(fallbackMsg || '链接未设置', 'error'); return; }
    const isHttp = /^https?:\/\//i.test(content) || content.startsWith('//');
    if (isHttp) window.open(content, '_blank');
    else window.open(content, '_blank'); // 相对路径或伪协议也尝试打开
  }

  function handleHotspotClick(h) {
    if (placementMode) return;
    switch (h.type) {
      case 'scene': {
        const idx = resolveSceneIndex(h.content);
        if (idx >= 0) {
          if (onSceneSwitchCb) onSceneSwitchCb(idx);
          else if (typeof switchScene === 'function') switchScene(idx);
        } else {
          if (typeof showToast === 'function') showToast('未找到目标场景', 'error');
        }
        break;
      }
      case 'link':
      case 'product':
      case 'map':
      case 'download':
      case 'gift':
        openLinkContent(h.content, '链接未设置');
        break;
      case 'phone':
        if (h.content) window.location.href = 'tel:' + h.content.replace(/[^\d+]/g, '');
        else if (typeof showToast === 'function') showToast('电话未设置', 'error');
        break;
      case 'image': showHotspotImage(h.content, h.title); break;
      case 'video': showHotspotVideo(h.content, h.title); break;
      case 'audio':
      case 'music': showHotspotAudio(h.content, h.title); break;
      case 'wechat':
        if (h.content) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(h.content)
              .then(() => { if (typeof showToast === 'function') showToast('微信号已复制：' + h.content, 'success'); })
              .catch(() => { if (typeof showToast === 'function') showToast('微信号：' + h.content, 'success'); });
          } else {
            if (typeof showToast === 'function') showToast('微信号：' + h.content, 'success');
          }
        } else if (typeof showToast === 'function') showToast('微信号未设置', 'error');
        break;
      case 'location':
        // 位置：若内容是一个链接（地图URL）则直接打开，否则展示地址文字
        if (h.content && /^https?:\/\//i.test(h.content)) { window.open(h.content, '_blank'); break; }
        showHotspotText(h.title, h.content);
        break;
      case 'article':
      case 'info':
      case 'text':
      default:
        showHotspotText(h.title, h.content);
        break;
    }
  }

  function resolveSceneIndex(content) {
    if (!currentScenes || currentScenes.length === 0) return -1;
    if (content == null) return -1;
    // 数字索引
    const num = parseInt(content, 10);
    if (!isNaN(num) && currentScenes[num]) return num;
    // 场景 id
    const byId = currentScenes.findIndex(s => s.id === content || String(s.id) === String(content));
    if (byId >= 0) return byId;
    // 场景标题
    const byTitle = currentScenes.findIndex(s => (s.title || '') === content);
    if (byTitle >= 0) return byTitle;
    return -1;
  }

  // ── 热点弹窗（图片/视频/音频/文字）─────────────────────
  function showHotspotModal(innerHtml) {
    const container = document.querySelector('.viewer-container');
    if (!container) return;
    let modal = document.getElementById('hsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'hsModal';
      modal.className = 'hs-modal';
      modal.innerHTML = `<div class="hs-modal-backdrop"></div><div class="hs-modal-box"><button class="hs-modal-close" onclick="Viewer.closeHotspotModal()">✕</button><div class="hs-modal-content"></div></div>`;
      modal.querySelector('.hs-modal-backdrop').addEventListener('click', closeHotspotModal);
      container.appendChild(modal);
    }
    modal.querySelector('.hs-modal-content').innerHTML = innerHtml;
    modal.classList.add('open');
  }

  function closeHotspotModal() {
    const modal = document.getElementById('hsModal');
    if (modal) {
      modal.classList.remove('open');
      // 释放 video/audio
      modal.querySelectorAll('video,audio').forEach(el => { try { el.pause(); } catch (e) {} });
    }
  }

  function showHotspotText(title, content) {
    showHotspotModal(`<h4>${escapeHtml(title || '说明')}</h4><p>${escapeHtml(content || '（无内容）')}</p>`);
  }
  function showHotspotImage(url, title) {
    if (!url) { if (typeof showToast === 'function') showToast('图片未设置', 'error'); return; }
    showHotspotModal(`<h4>${escapeHtml(title || '图片')}</h4><img src="${url}" alt="" style="max-width:100%;border-radius:10px;display:block">`);
  }
  function showHotspotVideo(url, title) {
    if (!url) { if (typeof showToast === 'function') showToast('视频未设置', 'error'); return; }
    showHotspotModal(`<h4>${escapeHtml(title || '视频')}</h4><video src="${url}" controls autoplay style="max-width:100%;border-radius:10px;display:block"></video>`);
  }
  function showHotspotAudio(url, title) {
    if (!url) { if (typeof showToast === 'function') showToast('音频未设置', 'error'); return; }
    showHotspotModal(`<h4>${escapeHtml(title || '音频')}</h4><audio src="${url}" controls autoplay style="width:100%"></audio>`);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── 全景球体 / 纹理应用（复用同一个球体，只换贴图）────────
  function ensurePanoSphere() {
    if (sphere) return sphere;
    const geo = new THREE.SphereGeometry(500, 64, 32);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: null });
    sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);
    return sphere;
  }

  function hasVisibleFrame() {
    return !!(sphere && sphere.material && sphere.material.map);
  }

  function isTexCached(tex) {
    let found = false;
    texCache.forEach(t => { if (t === tex) found = true; });
    return found;
  }

  function applyPanoramaTexture(tex) {
    const s = ensurePanoSphere();
    const old = s.material.map;
    s.material.map = tex;
    s.material.needsUpdate = true;
    // 旧贴图若不在缓存里（例如太大没被缓存），替换后必须释放，否则显存泄漏
    if (old && old !== tex && !isTexCached(old)) {
      try { old.dispose(); } catch (e) { /* ignore */ }
    }
  }

  function setLoadingCompact(on) {
    const el = loadingEl();
    if (!el) return;
    el.classList.toggle('has-frame', !!on);
  }

  function setLoadingText(sceneTitle) {
    const el = loadingEl();
    if (!el) return;
    const p = el.querySelector('.loading-title');
    if (p) p.textContent = sceneTitle ? ('正在加载「' + sceneTitle + '」…') : '正在加载全景…';
  }

  // 加载成功后的收尾（原来的成功回调尾部，抽出来给「缓存命中」路径共用）
  function finishPanoramaLoad(workInfo) {
    setLoadingCompact(false);
    showLoading(false);
    showTouchHint();
    // 加载完成后 0.5s 自动收起工具栏，用户点击手柄可再次拉起
    scheduleViewerToolbarCollapse(500);

    // 应用初始视角
    if (workInfo && workInfo.initialRotation) {
      targetRotX = workInfo.initialRotation.x || 0;
      targetRotY = workInfo.initialRotation.y || 0;
      rotationX = targetRotX;
      rotationY = targetRotY;
    } else {
      rotationX = 0; rotationY = 0;
      targetRotX = 0; targetRotY = 0;
    }
    currentFOV = 75;
    camera.fov = currentFOV;
    camera.updateProjectionMatrix();
    resetViewMode();
  }

  // ── 预加载 ──────────────────────────────────────────────
  // 思路：**只把字节下载进 HTTP 缓存**（不建纹理）。
  // 建纹理要占上百 MB 显存，为「用户可能根本不看的场景」付这个代价不划算；
  // 而把字节捂热后，真正切换时只剩下解码+上传，网络等待基本消失。
  const PRELOAD_CONCURRENCY = 2;
  const PRELOAD_MAX_SCENES = 8;   // 一个作品最多预取 8 个场景，别把用户流量吃光

  function prefetchImage(url) {
    if (!url || preloadInflight.has(url)) return Promise.resolve();
    preloadInflight.add(url);
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        preloadInflight.delete(url);
        resolve();
      };
      const img = new Image();
      img.decoding = 'async';
      img.onload = done;
      img.onerror = done;
      img.src = url;
      setTimeout(done, 30000); // 兜底，别让一个卡住的请求堵住队列
    });
  }

  // 顺序：先左右相邻场景（用户最可能接着看的），再其余
  function preloadOrder(curIdx, total) {
    const order = [];
    if (curIdx < 0) {
      for (let i = 0; i < total && order.length < PRELOAD_MAX_SCENES; i++) order.push(i);
      return order;
    }
    for (let d = 1; d < total && order.length < PRELOAD_MAX_SCENES; d++) {
      const a = curIdx + d;
      const b = curIdx - d;
      if (a < total) order.push(a);
      if (b >= 0 && order.length < PRELOAD_MAX_SCENES) order.push(b);
    }
    return order;
  }

  async function preloadOtherScenes(currentUrl) {
    if (!currentScenes || currentScenes.length < 2) return;
    if (isPreloadBlocked()) return;

    const myToken = ++preloadToken;
    const curIdx = currentScenes.findIndex(s => s && s.panorama === currentUrl);
    const urls = preloadOrder(curIdx, currentScenes.length)
      .map(i => currentScenes[i] && currentScenes[i].panorama)
      .filter(u => u && u !== currentUrl);
    if (!urls.length) return;

    let cursor = 0;
    const worker = async () => {
      while (cursor < urls.length) {
        if (myToken !== preloadToken) return;   // 已切换/已关闭 → 放弃
        if (document.hidden) return;
        await prefetchImage(urls[cursor++]);
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(PRELOAD_CONCURRENCY, urls.length) },
      () => worker()
    ));
  }

  // 等当前场景稳稳显示出来、浏览器空闲了再预取
  function scheduleScenePreload(currentUrl) {
    if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
    if (preloadIdleHandle && window.cancelIdleCallback) {
      window.cancelIdleCallback(preloadIdleHandle);
      preloadIdleHandle = null;
    }
    preloadTimer = setTimeout(() => {
      preloadTimer = null;
      const run = () => { preloadOtherScenes(currentUrl).catch(() => {}); };
      if ('requestIdleCallback' in window) {
        preloadIdleHandle = window.requestIdleCallback(run, { timeout: 3000 });
      } else {
        run();
      }
    }, 1200);
  }

  function cancelPreload() {
    preloadToken++; // 让正在跑的队列自行退出
    if (preloadTimer) { clearTimeout(preloadTimer); preloadTimer = null; }
    if (preloadIdleHandle && window.cancelIdleCallback) {
      window.cancelIdleCallback(preloadIdleHandle);
      preloadIdleHandle = null;
    }
  }

  // 鼠标悬停场景缩略图时提前把该场景「解码成纹理」，点下去就是瞬时的
  function warmScene(url) {
    if (!url || document.hidden) return;
    if (texCache.has(url)) return;
    if (isPreloadBlocked()) return;
    if (preloadInflight.has('tex:' + url)) return;
    preloadInflight.add('tex:' + url);
    const loader = new THREE.TextureLoader();
    loader.load(url,
      (tex) => {
        preloadInflight.delete('tex:' + url);
        tex.colorSpace = THREE.SRGBColorSpace;
        texCachePut(url, tex);
      },
      undefined,
      () => { preloadInflight.delete('tex:' + url); }
    );
  }

  // ── 加载全景图 ──────────────────────────────────────────
  function loadPanorama(imageUrl, workInfo) {
    showViewer(workInfo);
    showLoading(true, 0);
    resetViewerToolbar(); // 打开时先展开，加载完成后会自动收起

    currentWork = workInfo && workInfo.work ? workInfo.work : null;
    currentScenes = (currentWork && currentWork.scenes) || (workInfo && workInfo.scenes) || [];
    onSceneSwitchCb = workInfo && workInfo.onSceneSwitch ? workInfo.onSceneSwitch : null;
    onCommentToggleCb = workInfo && workInfo.onCommentToggle ? workInfo.onCommentToggle : null;
    musicUrl = (workInfo && workInfo.musicUrl) || (currentWork && currentWork.musicUrl) || '';

    // 清理旧热点
    buildHotspots(workInfo ? workInfo.hotspots : null);
    // 设置音乐
    setupMusic(musicUrl);

    // 注意：这里**不再销毁当前场景**。旧画面先留着，等新图就绪再原子替换，
    // 否则整段加载期间用户只能盯着黑屏（原来的做法就是这样，才显得特别慢）。

    // ① 缓存命中（刚看过的场景）→ 同步切换，几乎零等待
    const cachedTex = texCacheGet(imageUrl);
    if (cachedTex) {
      applyPanoramaTexture(cachedTex);
      finishPanoramaLoad(workInfo);
      scheduleScenePreload(imageUrl);
      return;
    }

    // 已有画面时，加载提示缩成小胶囊，不遮挡视图
    setLoadingCompact(hasVisibleFrame());
    setLoadingText(workInfo && workInfo.sceneTitle);

    const loader = new THREE.TextureLoader();
    loader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texCachePut(imageUrl, texture);
        applyPanoramaTexture(texture);
        finishPanoramaLoad(workInfo);
        scheduleScenePreload(imageUrl);
      },
      (progress) => {
        const loaded = (progress && progress.loaded) || 0;
        const total = (progress && progress.total) || 0;
        if (total > 0) showLoading(true, (loaded / total) * 100, loaded, total);
        else showLoading(true, 0, loaded, 0); // 总大小未知时显示不确定进度 + 已加载体积
      },
      (error) => {
        showLoading(false);
        setLoadingCompact(false);
        // 加载失败时保持工具栏可用，方便用户重试/退出
        resetViewerToolbar();
        if (typeof showToast === 'function') showToast('图片加载失败，请检查格式是否正确', 'error');
      }
    );
  }

  // ── 背景音乐 ────────────────────────────────────────────
  function setupMusic(url) {
    if (!musicEl) return;
    if (url) {
      musicEl.src = url;
      musicEl.load();
    } else {
      musicEl.removeAttribute('src');
      musicEl.load();
    }
    updateMusicBtn();
  }

  function toggleMusic() {
    if (!musicEl) return;
    if (!musicEl.src) { if (typeof showToast === 'function') showToast('该作品未设置背景音乐', 'error'); return; }
    if (musicEl.paused) {
      musicEl.play().then(() => updateMusicBtn()).catch(() => {
        if (typeof showToast === 'function') showToast('音乐播放被浏览器拦截，请再次点击', 'error');
      });
    } else {
      musicEl.pause();
      updateMusicBtn();
    }
  }

  function updateMusicBtn() {
    const btn = document.getElementById('btnMusic');
    if (btn && musicEl) {
      const playing = !musicEl.paused && !!musicEl.src;
      btn.classList.toggle('active', playing);
    }
  }

  // ── 渲染循环 ──────────────────────────────────────────
  function startLoop() {
    isAnimating = true;
    animate();
  }

  function animate() {
    if (!isAnimating) return;
    requestAnimationFrame(animate);

    if (!isDragging) {
      if (autoRotate) {
        targetRotX += autoRotateSpeed;
      } else if (Math.abs(velX) > 1e-4 || Math.abs(velY) > 1e-4) {
        // 松手惯性滑动
        targetRotX += velX;
        targetRotY += velY;
        velX *= momentumFactor;
        velY *= momentumFactor;
      }
      // 视角模式锁定（小行星/水晶球）
      if (viewMode === 'planet' || viewMode === 'ball') {
        targetRotY = planetLockY;
      }
      rotationX += (targetRotX - rotationX) * dampFactor;
      rotationY += (targetRotY - rotationY) * dampFactor;
    } else {
      rotationX = targetRotX;
      rotationY = targetRotY;
    }

    rotationY = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, rotationY));

    if (gyroEnabled) {
      applyGyroRotation();
    } else {
      camera.rotation.order = 'YXZ';
      camera.rotation.y = rotationX;
      camera.rotation.x = rotationY;
    }

    // VR 分屏更新副相机
    if (vrMode) {
      cameraL.position.copy(camera.position);
      cameraR.position.copy(camera.position);
      cameraL.quaternion.copy(camera.quaternion);
      cameraR.quaternion.copy(camera.quaternion);
      cameraL.position.x -= 0.03;
      cameraR.position.x += 0.03;
    }

    updateCompass();

    if (vrMode) {
      renderVR();
    } else {
      renderer.render(scene, camera);
    }
    updateHotspots();
  }

  function renderVR() {
    const cv = canvas();
    const w = cv.offsetWidth, h = cv.offsetHeight;
    const halfW = w / 2;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, halfW, h);
    renderer.setScissor(0, 0, halfW, h);
    renderer.render(scene, cameraL);
    renderer.setViewport(halfW, 0, halfW, h);
    renderer.setScissor(halfW, 0, halfW, h);
    renderer.render(scene, cameraR);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
  }

  // ── 鼠标交互 ────────────────────────────────────────────
  function bindMouseEvents() {
    const cv = canvas();
    cv.addEventListener('mousedown', (e) => {
      // 放置模式下也允许拖动旋转全景，仅在“干净点击（未拖动）”时放置热点
      isDragging = true;
      velX = 0; velY = 0;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      cv.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      const dRotX = dx * 0.0032;
      const dRotY = dy * 0.0032;
      targetRotX += dRotX;
      targetRotY += dRotY;
      velX = dRotX; velY = dRotY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (canvas()) canvas().style.cursor = 'grab';
      }
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      adjustFOV(e.deltaY * 0.05);
    }, { passive: false });
    cv.style.cursor = 'grab';
  }

  // ── 触摸交互 ────────────────────────────────────────────
  function bindTouchEvents() {
    const cv = canvas();
    cv.addEventListener('touchstart', (e) => {
      // 放置模式下同样允许单指拖动旋转全景
      if (e.touches.length === 1) {
        isDragging = true;
        velX = 0; velY = 0;
        prevTouchX = e.touches[0].clientX;
        prevTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        prevTouchDist = getTouchDist(e.touches);
      }
    }, { passive: false });

    cv.addEventListener('touchmove', (e) => {
      if (placementMode && e.touches.length === 1) e.preventDefault();
      else if (!placementMode) e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - prevTouchX;
        const dy = e.touches[0].clientY - prevTouchY;
        const dRotX = dx * 0.004;
        const dRotY = dy * 0.004;
        targetRotX += dRotX;
        targetRotY += dRotY;
        velX = dRotX; velY = dRotY;
        prevTouchX = e.touches[0].clientX;
        prevTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dist = getTouchDist(e.touches);
        const delta = prevTouchDist - dist;
        adjustFOV(delta * 0.1);
        prevTouchDist = dist;
      }
    }, { passive: false });

    cv.addEventListener('touchend', () => { isDragging = false; });
  }

  // ── 热点放置事件（后台调用 enablePlacement 后生效）────
  // 关键：放置模式下允许拖动旋转全景，只有在“未拖动的干净点击”时才放置热点，
  // 避免用户刚按下鼠标就被放置标记。
  function bindPlacementEvents() {
    const cv = canvas();
    const DRAG_THRESHOLD = 6; // 像素，超过则视为拖动
    let startX = null, startY = null, moved = false;
    let tStartX = null, tStartY = null, tMoved = false;

    cv.addEventListener('mousedown', (e) => {
      if (!placementMode) return;
      startX = e.clientX; startY = e.clientY; moved = false;
    });
    cv.addEventListener('mousemove', (e) => {
      if (!placementMode || startX === null) return;
      if (Math.abs(e.clientX - startX) > DRAG_THRESHOLD || Math.abs(e.clientY - startY) > DRAG_THRESHOLD) {
        moved = true;
      }
    });
    cv.addEventListener('mouseup', (e) => {
      if (!placementMode) return;
      const wasMoved = moved;
      startX = null; startY = null; moved = false;
      if (wasMoved || !placementCb) {
        if (placementMode && cv) cv.style.cursor = 'crosshair';
        return; // 拖动旋转场景，不放置
      }
      const pos = screenToYawPitch(e.clientX, e.clientY);
      const cb = placementCb;
      exitPlacement();
      cb(pos);
    });

    cv.addEventListener('touchstart', (e) => {
      if (!placementMode || e.touches.length !== 1) return;
      tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY; tMoved = false;
    }, { passive: true });
    cv.addEventListener('touchmove', (e) => {
      if (!placementMode || tStartX === null || e.touches.length !== 1) return;
      if (Math.abs(e.touches[0].clientX - tStartX) > DRAG_THRESHOLD || Math.abs(e.touches[0].clientY - tStartY) > DRAG_THRESHOLD) {
        tMoved = true;
      }
    }, { passive: true });
    cv.addEventListener('touchend', (e) => {
      if (!placementMode) return;
      const wasMoved = tMoved;
      const changed = e.changedTouches && e.changedTouches[0];
      tStartX = null; tStartY = null; tMoved = false;
      if (wasMoved || !placementCb || !changed) {
        if (placementMode && cv) cv.style.cursor = 'crosshair';
        return; // 拖动旋转场景，不放置
      }
      const pos = screenToYawPitch(changed.clientX, changed.clientY);
      const cb = placementCb;
      exitPlacement();
      cb(pos);
    });
  }

  function getTouchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── 陀螺仪 ──────────────────────────────────────────────
  function toggleGyro() {
    const btn = document.getElementById('btnGyro');
    if (!gyroEnabled) {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
          .then(perm => { if (perm === 'granted') enableGyro(btn); else { if (typeof showToast === 'function') showToast('陀螺仪权限被拒绝', 'error'); } })
          .catch(() => { if (typeof showToast === 'function') showToast('请在HTTPS环境下使用陀螺仪'); });
      } else {
        enableGyro(btn);
      }
    } else {
      disableGyro(btn);
    }
  }

  function enableGyro(btn) {
    gyroEnabled = true;
    gyroData.ready = false;
    velX = 0; velY = 0;
    btn && btn.classList.add('active');
    deviceOrientationHandler = (e) => {
      gyroData.alpha = e.alpha || 0;
      gyroData.beta = e.beta || 0;
      gyroData.gamma = e.gamma || 0;
      gyroData.ready = true;
    };
    window.addEventListener('deviceorientation', deviceOrientationHandler);
    if (typeof showToast === 'function') showToast('陀螺仪已开启');
  }

  function disableGyro(btn) {
    gyroEnabled = false;
    btn && btn.classList.remove('active');
    if (deviceOrientationHandler) {
      window.removeEventListener('deviceorientation', deviceOrientationHandler);
      deviceOrientationHandler = null;
    }
  }

  function screenOrientationAngle() {
    const angle = (screen.orientation && screen.orientation.angle != null)
      ? screen.orientation.angle
      : (window.orientation || 0);
    return angle * Math.PI / 180;
  }

  function applyGyroRotation() {
    if (!gyroData.ready) return;
    const alpha = gyroData.alpha * Math.PI / 180;
    const beta = gyroData.beta * Math.PI / 180;
    const gamma = gyroData.gamma * Math.PI / 180;
    const orient = screenOrientationAngle();
    _gyroEuler.set(beta, alpha, -gamma, 'YXZ');
    camera.quaternion.setFromEuler(_gyroEuler);
    camera.quaternion.multiply(q1);
    camera.quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
  }

  // ── 公共控制 ──────────────────────────────────────────
  function toggleAutoRotate() {
    autoRotate = !autoRotate;
    const btn = document.getElementById('btnAutoRotate');
    btn && btn.classList.toggle('active', autoRotate);
    if (typeof showToast === 'function') showToast(autoRotate ? '自动旋转已开启' : '自动旋转已关闭');
  }

  function adjustFOV(delta) {
    // 视角模式下限制FOV范围
    const upper = viewMode === 'fisheye' ? FISHEYE_FOV : MAX_FOV;
    currentFOV = Math.max(MIN_FOV, Math.min(upper, currentFOV + delta));
    camera.fov = currentFOV;
    camera.updateProjectionMatrix();
  }

  function resetView() {
    targetRotX = initialRotation.x || 0;
    targetRotY = initialRotation.y || 0;
    resetViewMode();
    currentFOV = 75;
    camera.fov = currentFOV;
    camera.updateProjectionMatrix();
    autoRotate = false;
    const btn = document.getElementById('btnAutoRotate');
    btn && btn.classList.remove('active');
    if (typeof showToast === 'function') showToast('视角已重置');
  }

  function setInitialRotation(rx, ry) {
    initialRotation = { x: rx || 0, y: ry || 0 };
  }

  function onResize() {
    const cv = canvas();
    if (!cv || !renderer || !camera) return;
    const w = cv.offsetWidth, h = cv.offsetHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── 视角模式 ────────────────────────────────────────────
  function setViewMode(mode) {
    viewMode = mode;
    if (mode === 'normal') {
      currentFOV = 75; autoRotate = false;
    } else if (mode === 'fisheye') {
      currentFOV = FISHEYE_FOV; autoRotate = false;
    } else if (mode === 'planet') {
      currentFOV = 130; planetLockY = -Math.PI / 2 + 0.15; autoRotate = true;
    } else if (mode === 'ball') {
      currentFOV = 130; planetLockY = Math.PI / 2 - 0.15; autoRotate = true;
    }
    camera.fov = currentFOV;
    camera.updateProjectionMatrix();
    const btn = document.getElementById('btnAutoRotate');
    btn && btn.classList.toggle('active', autoRotate && viewMode !== 'normal' && viewMode !== 'fisheye');
    updateViewModeUI();
  }

  function resetViewMode() {
    viewMode = 'normal';
    currentFOV = 75;
    camera.fov = currentFOV;
    camera.updateProjectionMatrix();
    updateViewModeUI();
  }

  function cycleViewMode() {
    const order = ['normal', 'fisheye', 'planet', 'ball'];
    const idx = order.indexOf(viewMode);
    setViewMode(order[(idx + 1) % order.length]);
    const labels = { normal: '正常视角', fisheye: '鱼眼', planet: '小行星', ball: '水晶球' };
    if (typeof showToast === 'function') showToast('视角：' + (labels[viewMode] || viewMode));
  }

  function updateViewModeUI() {
    const menu = document.getElementById('viewModeMenu');
    if (menu) {
      menu.querySelectorAll('.vm-opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.mode === viewMode);
      });
    }
    const btn = document.getElementById('btnViewMode');
    if (btn) {
      const labels = { normal: '正常', fisheye: '鱼眼', planet: '小行星', ball: '水晶球' };
      const lbl = btn.querySelector('.vm-label');
      if (lbl) lbl.textContent = labels[viewMode] || '视角';
    }
  }

  function toggleViewModeMenu() {
    const menu = document.getElementById('viewModeMenu');
    if (!menu) return;
    menu.classList.toggle('open');
  }

  // ── 全屏 ──────────────────────────────────────────────
  function toggleFullscreen() {
    const el = overlay();
    if (!document.fullscreenElement) {
      el.requestFullscreen && el.requestFullscreen();
    } else {
      document.exitFullscreen && document.exitFullscreen();
    }
  }

  // ── VR 模式 ────────────────────────────────────────────
  function toggleVR() {
    vrMode = !vrMode;
    const btn = document.getElementById('btnVR');
    btn && btn.classList.toggle('active', vrMode);
    const overlayEl = overlay();
    overlayEl && overlayEl.classList.toggle('vr-on', vrMode);
    if (typeof showToast === 'function') showToast(vrMode ? 'VR模式已开启（手机放入头显）' : 'VR模式已关闭');
  }

  // ── 截图 ──────────────────────────────────────────────
  function takeScreenshot() {
    if (!renderer) return;
    if (vrMode) renderVR(); else renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `VR截图_${Date.now()}.png`;
    a.click();
    if (typeof showToast === 'function') showToast('截图已保存', 'success');
  }

  // ── 评论面板 ────────────────────────────────────────────
  function toggleCommentPanel() {
    if (onCommentToggleCb) onCommentToggleCb();
  }

  // ── 视角读取/设置（后台视角设置用）─────────────────────
  function getRotation() {
    return { x: rotationX, y: rotationY };
  }

  function setLiveRotation(x, y) {
    targetRotX = x || 0;
    targetRotY = y || 0;
    rotationX = targetRotX;
    rotationY = targetRotY;
    velX = 0; velY = 0;
    autoRotate = false;
    const btn = document.getElementById('btnAutoRotate');
    btn && btn.classList.remove('active');
  }

  // ── 热点放置接口（后台）────────────────────────────────
  function enablePlacement(cb) {
    placementMode = true;
    placementCb = cb;
    const cv = canvas();
    if (cv) cv.style.cursor = 'crosshair';
    const overlayEl = overlay();
    if (overlayEl) overlayEl.classList.add('placement-mode');
    showPlacementBanner();
    if (typeof showToast === 'function') showToast('拖动旋转全景，在目标位置轻点即可放置热点', 'success');
  }

  function showPlacementBanner() {
    const container = document.querySelector('.viewer-container');
    if (!container) return;
    removePlacementBanner();
    const banner = document.createElement('div');
    banner.id = 'placementBanner';
    banner.className = 'placement-banner';
    banner.innerHTML = '📍 拖动旋转，轻点放置热点位置 · <span class="pb-cancel">点此取消</span>';
    banner.addEventListener('click', (e) => {
      if (e.target.classList.contains('pb-cancel') || e.target === banner) {
        exitPlacement();
        closeViewer();
      }
    });
    container.appendChild(banner);
  }

  function removePlacementBanner() {
    const b = document.getElementById('placementBanner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function exitPlacement() {
    placementMode = false;
    placementCb = null;
    const cv = canvas();
    if (cv) cv.style.cursor = 'grab';
    const overlayEl = overlay();
    if (overlayEl) overlayEl.classList.remove('placement-mode');
    removePlacementBanner();
  }

  // ── 显示/隐藏 ────────────────────────────────────────
  function showViewer(workInfo) {
    const el = overlay();
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    // 还原画布（图片查看器可能隐藏过）
    const cv = canvas();
    if (cv) cv.style.display = '';
    const imgC = document.getElementById('imageViewerContainer');
    if (imgC) imgC.style.display = 'none';
    if (workInfo) {
      const titleEl = document.getElementById('viewerTitle');
      const authorEl = document.getElementById('viewerAuthor');
      const sceneTitleEl = document.getElementById('viewerSceneTitle');
      if (titleEl) titleEl.textContent = workInfo.title || '全景作品';
      if (authorEl) {
        // 只有真正有作者名称时才显示（「匿名」等占位值视为没有作者，不留空占位）
        const aName = (typeof getWorkAuthor === 'function') ? getWorkAuthor(workInfo) : (workInfo.author || '');
        authorEl.textContent = aName ? '✍ ' + aName : '';
        authorEl.style.display = aName ? '' : 'none';
      }
      if (sceneTitleEl) {
        sceneTitleEl.textContent = workInfo.sceneTitle || '';
        sceneTitleEl.style.display = workInfo.sceneTitle ? 'block' : 'none';
      }
      if (workInfo.initialRotation) {
        initialRotation = workInfo.initialRotation;
      } else {
        initialRotation = { x: 0, y: 0 };
      }
    }
    requestAnimationFrame(() => {
      if (!renderer) { init(); } else { onResize(); }
    });
  }

  function closeViewer() {
    const el = overlay();
    el.classList.remove('open');
    document.body.style.overflow = '';
    // 停掉后台预加载，但**保留纹理缓存**：同一页面内再次打开时仍然秒开
    cancelPreload();
    setLoadingCompact(false);
    autoRotate = false;
    vrMode = false;
    const btn = document.getElementById('btnAutoRotate');
    btn && btn.classList.remove('active');
    const vrBtn = document.getElementById('btnVR');
    vrBtn && vrBtn.classList.remove('active');
    if (el) el.classList.remove('vr-on');
    disableGyro(document.getElementById('btnGyro'));
    // 暂停音乐
    if (musicEl && !musicEl.paused) { musicEl.pause(); updateMusicBtn(); }
    closeHotspotModal();
    exitPlacement();
    // 隐藏场景导航
    const nav = document.getElementById('sceneNav');
    if (nav) nav.style.display = 'none';
    // 清理工具栏自动收起定时器，并恢复为展开状态（下次打开时可见）
    clearTimeout(viewerToolbarTimer);
    viewerToolbarTimer = null;
    expandViewerToolbar();
  }

  let loadingSlowTimer = null;

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / 1048576;
    if (mb >= 1) return mb.toFixed(1) + 'MB';
    return Math.max(1, Math.round(bytes / 1024)) + 'KB';
  }

  function showLoading(show, pct, loaded, total) {
    const el = loadingEl();
    if (!el) return;

    if (!show) {
      el.style.display = 'none';
      el.classList.remove('is-slow');
      clearTimeout(loadingSlowTimer);
      loadingSlowTimer = null;
      return;
    }

    el.style.display = 'flex';

    const pctEl = el.querySelector('.loading-pct');
    const barEl = el.querySelector('.loading-bar-fill');
    const barWrap = el.querySelector('.loading-bar');
    const sizeEl = el.querySelector('.loading-size');

    const pctNum = Math.max(0, Math.min(100, Math.round(pct || 0)));
    const known = total > 0; // 移动端常见拿不到 Content-Length，此时用不确定进度

    if (barWrap) barWrap.classList.toggle('indeterminate', !known);
    if (pctEl) pctEl.textContent = known ? pctNum + '%' : '加载中';
    if (barEl) {
      if (known) barEl.style.width = pctNum + '%';
      else barEl.style.width = '';
    }
    if (sizeEl) {
      const l = formatBytes(loaded);
      const t = formatBytes(total);
      sizeEl.textContent = l ? (t ? '已加载 ' + l + ' / ' + t : '已加载 ' + l) : '';
    }

    // 超过 8 秒仍未完成 → 给出“网络较慢”提示，避免用户以为卡死
    if (!loadingSlowTimer) {
      loadingSlowTimer = setTimeout(() => {
        const e2 = loadingEl();
        if (e2 && e2.style.display !== 'none') e2.classList.add('is-slow');
      }, 8000);
    }
  }

  function showTouchHint() {
    if ('ontouchstart' in window) {
      const existing = document.querySelector('.touch-hint');
      if (existing) existing.remove();
      const hint = document.createElement('div');
      hint.className = 'touch-hint';
      hint.innerHTML = '<div style="font-size:2.5rem">👆</div><span>拖动查看全景 · 双指缩放</span>';
      const container = document.querySelector('.viewer-container');
      if (container) container.appendChild(hint);
      setTimeout(() => hint.remove(), 3500);
    }
  }

  function ensureInit() { if (!renderer) init(); }

  return {
    init,
    loadPanorama,
    hotspotIcon,
    HOTSPOT_TYPES,
    toggleAutoRotate,
    adjustFOV,
    resetView,
    toggleFullscreen,
    toggleGyro,
    takeScreenshot,
    toggleVR,
    setViewMode,
    cycleViewMode,
    toggleViewModeMenu,
    toggleCommentPanel,
    toggleMusic,
    enablePlacement,
    closeHotspotModal,
    close: closeViewer,
    ensureInit,
    setInitialRotation,
    getRotation,
    setLiveRotation,
    warmScene,          // 悬停缩略图时预热该场景（解码成纹理，点击即瞬时）
    cancelPreload,      // 退出查看器时停掉后台预加载
  };
})();

// 全局桥接
function closeViewer() { Viewer.close(); }
function toggleAutoRotate() { Viewer.toggleAutoRotate(); }
function adjustFOV(d) { Viewer.adjustFOV(d); }
function resetView() { Viewer.resetView(); }
function toggleFullscreen() { Viewer.toggleFullscreen(); }
function toggleGyro() { Viewer.toggleGyro(); }
function takeScreenshot() { Viewer.takeScreenshot(); }
function toggleVR() { Viewer.toggleVR(); }
function cycleViewMode() { Viewer.cycleViewMode(); }
function setViewMode(m) { Viewer.setViewMode(m); }
function toggleViewModeMenu() { Viewer.toggleViewModeMenu(); }
function toggleCommentPanel() { Viewer.toggleCommentPanel(); }
function toggleMusic() { Viewer.toggleMusic(); }
function openViewerShare() { /* 由 app.js 定义 */ if (typeof openShareModal === 'function') openShareModal(State.currentWorkId); }

// ── 底部工具栏 自动收起 / 点击拉起 ────────────────────────
let viewerToolbarTimer = null;

function expandViewerToolbar() {
  const tb = document.getElementById('viewerToolbar');
  const hd = document.getElementById('toolbarHandle');
  if (tb) tb.classList.remove('collapsed');
  if (hd) hd.classList.remove('visible');
}

function collapseViewerToolbar() {
  const tb = document.getElementById('viewerToolbar');
  const hd = document.getElementById('toolbarHandle');
  // 没有手柄的页面（如编辑器）不收起，避免工具栏无法恢复
  if (!tb || !hd) return;
  if (tb.offsetParent === null) return; // 查看器未打开时不处理
  tb.classList.add('collapsed');
  hd.classList.add('visible');
}

function toggleViewerToolbar() {
  const tb = document.getElementById('viewerToolbar');
  if (!tb) return;
  if (tb.classList.contains('collapsed')) expandViewerToolbar();
  else collapseViewerToolbar();
}

// 查看器打开/重新加载时先展开，加载完成后再延时自动收起
function resetViewerToolbar() {
  clearTimeout(viewerToolbarTimer);
  viewerToolbarTimer = null;
  expandViewerToolbar();
}

function scheduleViewerToolbarCollapse(delay) {
  clearTimeout(viewerToolbarTimer);
  viewerToolbarTimer = setTimeout(() => {
    viewerToolbarTimer = null;
    collapseViewerToolbar();
  }, delay == null ? 500 : delay);
}
