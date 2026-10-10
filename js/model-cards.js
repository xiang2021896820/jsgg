// ============================================================
//  3D 模型作品集 · 卡片网格 + 搜索 / 分类 / 排序 (model-cards.js)
//
//  - 每个卡片 = 可拖拽旋转的 3D 预览 + 名称 + 分类 + 时间 + 「查看模型详情」
//  - 搜索（名称 / 分类）、分类筛选（chips）、排序（最新 / 最早 / 名称）
//  - 分类可**就地编辑**：点分类标签 → 变输入框 → 回车保存回 ModelSync
//  - ★ WebGL 上下文有硬上限（浏览器一般 8~16 个），所以卡片再多也只用 MAX_LIVE 个：
//      可见才建、超过上限就把「最久没用过」的那个释放掉（LRU），滚回来再重建。
//  - 模型取数优先级：本机 IndexedDB 二进制 → 作品 url
//      ★ 本机二进制必须优先：从 localhost 加载 https://jsgg.surge.sh/model/*.glb 属于跨域，
//        而 surge 不返回 Access-Control-Allow-Origin，浏览器会直接拦掉。
// ============================================================
(function () {
  'use strict';

  var grid = document.getElementById('cards-grid');
  if (!grid || typeof THREE === 'undefined') return;

  var toolbar = document.getElementById('cards-toolbar');
  var qInput = document.getElementById('cards-q');
  var chipsBox = document.getElementById('cards-categories');
  var sortSel = document.getElementById('cards-sort');
  var emptyBox = document.getElementById('cards-empty');
  var emptyTitle = document.getElementById('cards-empty-title');
  var emptyHint = document.getElementById('cards-empty-hint');
  var noteEl = document.getElementById('cards-note');

  var MAX_LIVE = 6;          // 同时存在的 WebGL 上下文上限
  var FIT_MARGIN = 1.12;     // 取景留白系数
  var SPIN = 0.26;           // 自转角速度 rad/s
  var RESUME_MS = 1200;      // 松手后多久恢复自转
  var GLB_RE = /\.(glb|gltf)(\?|#|$)/i;
  var UNCATEGORIZED = '未分类';

  var all = [];              // 全部作品
  var cards = [];            // 当前渲染出的卡片
  var live = [];             // 持有 WebGL 的卡片，末尾 = 最近使用（LRU）
  var activeCategory = '';   // '' = 全部分类
  var query = '';
  var sortMode = 'new';
  var io = null;
  var fromManifest = false;  // 数据来自项目 model/manifest.json（离线兜底）
  var loopStarted = false;

  // ---------- 小工具 ----------
  function isCrossOrigin(url) {
    try { return new URL(url, location.href).origin !== location.origin; }
    catch (e) { return false; }
  }

  function fmtTime(at) {
    if (!at) return '';
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function catOf(entry) {
    return ((entry && entry.category) || '').trim() || UNCATEGORIZED;
  }

  function setState(card, text, isError) {
    if (!card || !card.state) return;
    card.state.textContent = text;
    card.state.hidden = !text;
    card.state.classList.toggle('is-error', !!isError);
  }

  function setNote(text) {
    if (noteEl) noteEl.textContent = text;
  }

  function updateNote() {
    var shown = cards.length;
    var bits = [];
    if (query || activeCategory) bits.push('筛选出 ' + shown + ' / 共 ' + all.length + ' 件');
    else bits.push('共 ' + all.length + ' 件作品');
    if (fromManifest) bits.push('本地 model/ 目录兜底');
    if (location.protocol === 'file:') {
      var page = (location.pathname.split('/').pop() || 'models.html');
      bits.push('⚠ 当前是 file:// 直接打开，浏览器会拦掉模型文件 —— 请用 http://127.0.0.1:8123/' + page);
    }
    setNote(bits.join(' · '));
  }

  // ---------- 渲染器（懒建 + LRU 回收）----------
  function bindDrag(card) {
    var canvas = card.renderer.domElement;
    var lastX = 0, lastY = 0;

    function down(e) {
      if (!card.model) return;
      card.dragging = true;
      var p = e.touches ? e.touches[0] : e;
      lastX = p.clientX; lastY = p.clientY;
      card.view.classList.add('is-grabbing');
    }
    function move(e) {
      if (!card.dragging) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - lastX, dy = p.clientY - lastY;
      lastX = p.clientX; lastY = p.clientY;
      card.group.rotation.y += dx * 0.01;
      card.group.rotation.x = Math.max(-1.2, Math.min(1.2, card.group.rotation.x + dy * 0.01));
    }
    function up() {
      if (!card.dragging) return;
      card.dragging = false;
      card.view.classList.remove('is-grabbing');
      card.resumeAt = performance.now() + RESUME_MS;
    }

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: true });
    canvas.addEventListener('touchmove', move, { passive: true });
    canvas.addEventListener('touchend', up);
  }

  function initRenderer(card) {
    if (card.renderer) return;
    var w = card.view.clientWidth || 320;
    var h = card.view.clientHeight || 220;

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) {
      card.retryAt = performance.now() + 2500;
      setState(card, '显卡上下文不够用了，稍后自动重试…', false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    renderer.setSize(w, h, false);
    card.view.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f5);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    var hemi = new THREE.HemisphereLight(0xffffff, 0xdfe6ee, 0.5);
    hemi.position.set(0, 50, 0);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(6, 12, 8);
    scene.add(sun);

    var camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    camera.position.set(0, 0, 10);

    card.renderer = renderer;
    card.scene = scene;
    card.camera = camera;
    card.group = new THREE.Group();
    scene.add(card.group);
    bindDrag(card);
  }

  function releaseRenderer(card) {
    if (!card) return;
    if (card.renderer) {
      card.renderer.dispose();
      var cv = card.renderer.domElement;
      if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    }
    card.renderer = null;
    card.scene = null;
    card.camera = null;
    card.group = null;
    card.model = null;
    card.loaded = false;
    card.completed = false;   // 允许重新加载
    setState(card, '重新进入视野后自动加载', false);
    // ★ 故意不动 card.visible：那个值反映"是否在视野里"，只由 IntersectionObserver 改。
    //   回收后主循环要靠它判断这张卡是不是还需要一个上下文。
    var i = live.indexOf(card);
    if (i >= 0) live.splice(i, 1);
  }

  function releaseAll() {
    live.slice().forEach(releaseRenderer);
    live = [];
  }

  function touchLive(card) {
    var i = live.indexOf(card);
    if (i >= 0) live.splice(i, 1);
    live.push(card);
  }

  // 淘汰谁：优先淘汰"已经滚出视野"里最久没用的那个；
  // 实在全都在视野内（大屏一屏放得下 MAX_LIVE 个以上），才动最久没用的。
  // ★ 不能盲淘汰 live[0]：被淘汰的卡片如果还在屏幕上，它不会再触发 IntersectionObserver，
  //   画面会一直空着 —— 主循环里有一路补偿重建（见 loop()）。
  function evictOne() {
    if (!live.length) return;
    for (var i = 0; i < live.length; i++) {
      if (!live[i].visible) { releaseRenderer(live[i]); return; }
    }
    releaseRenderer(live[0]);
  }

  // 需要渲染器时：已有就直接用；没有就淘汰一个再建
  function ensureRenderer(card) {
    if (card.renderer) { touchLive(card); return true; }
    while (live.length >= MAX_LIVE) {
      evictOne();
    }
    initRenderer(card);
    if (!card.renderer) return false;
    touchLive(card);
    return true;
  }

  // 拿到渲染器就补加载（首次进视野 / 被回收后滚回来 走同一条路）
  function acquireAndLoad(card) {
    if (!ensureRenderer(card)) return false;
    resizeCard(card);
    if (!card.completed) {
      card.completed = true;
      loadModelFor(card);
    }
    return true;
  }

  function resizeCard(card) {
    if (!card.renderer) return;
    var w = card.view.clientWidth || 320;
    var h = card.view.clientHeight || 220;
    card.renderer.setSize(w, h, false);
    card.camera.aspect = w / h;
    card.camera.updateProjectionMatrix();
  }

  // ---------- 加载模型 ----------
  function polish(card, root) {
    if (!card.renderer) return;   // 上下文已被回收，别再往下碰
    var maxAniso = card.renderer.capabilities.getMaxAnisotropy();
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        m.side = THREE.DoubleSide;   // 单面几何（SketchUp）也能看见
        if (m.map) { m.map.anisotropy = maxAniso; m.map.needsUpdate = true; }
      });
    });
  }

  function tryLoad(card, onOk, onFail) {
    var entry = card.entry;
    var p = (window.ModelSync && entry.id)
      ? window.ModelSync.getLocalBinary(entry.id).catch(function () { return null; })
      : Promise.resolve(null);
    p.then(function (buf) {
      if (buf) { new THREE.GLTFLoader().parse(buf, '', onOk, onFail); return; }
      if (entry.url && GLB_RE.test(entry.url)) {
        new THREE.GLTFLoader().load(entry.url, onOk, undefined, onFail);
        return;
      }
      onFail(new Error(entry.url ? 'unsupported-url' : 'no-binary'));
    });
  }

  function fitToView(card, root) {
    var box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxSize = Math.max(size.x, size.y, size.z) || 1;
    var cam = card.camera;
    var fovV = cam.fov * Math.PI / 180;
    var fovH = 2 * Math.atan(Math.tan(fovV / 2) * Math.max(cam.aspect, 0.2));
    var distV = (size.y / 2) / Math.tan(fovV / 2);
    var distH = (Math.max(size.x, size.z) / 2) / Math.tan(fovH / 2);
    var distance = maxSize / 2 + Math.max(distV, distH) * FIT_MARGIN;
    card.group.position.set(0, 0, 0);
    card.group.rotation.set(0, 0, 0);
    cam.position.set(center.x, center.y + maxSize * 0.12, center.z + distance);
    // 近/远平面跨度决定深度缓冲精度，跨度越大越容易闪（原 far = 10×距离太奢侈）
    cam.near = Math.max(distance / 100, 0.05);
    cam.far = Math.max(distance * 6, 120);
    cam.updateProjectionMatrix();
    cam.lookAt(center.x, center.y, center.z);
  }

  function loadModelFor(card) {
    setState(card, '模型加载中…', false);

    function ok(gltf) {
      // ★ 加载是异步的：回调回来时这张卡可能已经被回收（滚出视野）或被重新筛选/排序而重排了。
      //   那一刻 card.renderer / card.group 已经是 null，继续往下走会抛 TypeError
      //   把整页脚本打断（卡片永远停在"加载中"，后面的卡片全不加载）。
      //   直接放弃这次结果即可 —— 卡片再进视野时会重新走一遍加载。
      if (!card.renderer || !card.group) { card.completed = false; return; }

      var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) { fail(null); return; }
      polish(card, root);
      // 作者发布时保存的贴图方向也要生效，否则卡片里贴图是镜像的
      // （与查看器看到的对不上）。没有设置快照的旧作品保持原样。
      if (card.entry.settings && window.ViewerSettings) {
        window.ViewerSettings.applyUvToTextures(root, card.entry.settings);
      }
      // 消闪：几何体检 → 合并同网格内的正反两片 → 跨网格重合面错层（材质已是双面，合并安全）
      if (window.ZFight) window.ZFight.run(root, true, { mergeSameMesh: true });
      card.group.add(root);
      card.model = root;
      fitToView(card, root);
      card.loaded = true;
      setState(card, '', false);
    }

    function fail(err) {
      // 同理：已经释放掉的卡片不该再往界面上写错误文案（它会被重新加载）
      if (!card.renderer) { card.completed = false; return; }
      var entry = card.entry;
      var msg = '加载失败';
      if (err && err.message === 'no-binary') {
        msg = '这条作品没填托管 URL，二进制只在上传它的那台浏览器里';
      } else if (err && err.message === 'unsupported-url') {
        msg = '托管 URL 不是 .glb / .gltf，浏览器无法直接加载';
      } else if (location.protocol === 'file:') {
        msg = 'file:// 下浏览器会拦掉模型文件，请改用 http://127.0.0.1:8123/';
      } else if (entry.url && isCrossOrigin(entry.url)) {
        msg = '跨域被拦：托管地址没返回 CORS 头（本机二进制或同源地址才行）';
      } else if (err && err.message) {
        msg = '加载失败：' + err.message;
      }
      setState(card, msg, true);
    }

    tryLoad(card, ok, fail);
  }

  // ---------- 建卡 ----------
  function renderCat(btn, text) {
    btn.textContent = text;
    btn.classList.toggle('is-none', text === UNCATEGORIZED);
  }

  function startEditCategory(card, btn) {
    if (btn.dataset.editing === '1') return;
    btn.dataset.editing = '1';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'model-card-cat-input';
    input.value = (card.entry.category || '');
    input.placeholder = '填分类后回车';
    input.maxLength = 24;
    btn.replaceWith(input);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var val = save ? input.value.trim() : (card.entry.category || '');
      if (input.parentNode) input.replaceWith(btn);
      btn.dataset.editing = '';
      if (!save) return;

      card.entry.category = val;
      renderCat(btn, catOf(card.entry));
      if (!window.ModelSync || !window.ModelSync.updateModelCategory) return;

      btn.classList.add('is-saving');
      window.ModelSync.updateModelCategory(card.entry.id, val).then(function (hit) {
        btn.classList.remove('is-saving');
        if (!hit) {
          setNote('分类没保存成功：远端索引里找不到这条作品');
          return;
        }
        var nowCat = catOf(card.entry);
        setNote('分类已更新' + (nowCat === UNCATEGORIZED ? '（已清空）' : '：' + nowCat));
        // 分类集合变了，筛选项要跟着变。★ 注意 refreshCategoryChips 有可能因为
        // "当前筛选的分类已经不存在"把 activeCategory 清空 —— 这时必须重排网格，
        // 否则 chips 显示"全部 N 件"、网格里却只留着一两张，前后对不上。
        var hadCat = activeCategory;
        refreshCategoryChips();
        if ((hadCat && !activeCategory) || !matches(card.entry)) renderGrid();
      }).catch(function () {
        btn.classList.remove('is-saving');
        setNote('分类保存失败，请检查网络后重试');
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  function createCard(entry) {
    var el = document.createElement('article');
    el.className = 'model-card';

    var view = document.createElement('div');
    view.className = 'model-card-view';

    var state = document.createElement('div');
    state.className = 'gallery-state';
    state.textContent = '滚动到此处加载…';
    view.appendChild(state);

    var body = document.createElement('div');
    body.className = 'model-card-body';

    var name = document.createElement('h3');
    name.className = 'model-card-name';
    name.textContent = entry.name || '未命名模型';

    var metaRow = document.createElement('div');
    metaRow.className = 'model-card-meta';

    var catBtn = document.createElement('button');
    catBtn.type = 'button';
    catBtn.className = 'model-card-cat';
    catBtn.title = '点击可改分类';
    renderCat(catBtn, catOf(entry));

    var time = document.createElement('span');
    time.className = 'model-card-time';
    time.textContent = fmtTime(entry.at);

    metaRow.appendChild(catBtn);
    if (time.textContent) metaRow.appendChild(time);

    var link = document.createElement('a');
    link.className = 'model-card-link';
    link.href = 'model-viewer.html?model=' + encodeURIComponent(entry.id);
    link.textContent = '查看模型详情 →';

    body.appendChild(name);
    body.appendChild(metaRow);
    body.appendChild(link);

    el.appendChild(view);
    el.appendChild(body);
    grid.appendChild(el);

    var card = {
      entry: entry, el: el, view: view, state: state,
      renderer: null, scene: null, camera: null, group: null, model: null,
      visible: false, loaded: false, completed: false, dragging: false, resumeAt: 0
    };
    catBtn.addEventListener('click', function () { startEditCategory(card, catBtn); });

    cards.push(card);
    return card;
  }

  // ---------- 过滤 / 排序 ----------
  function matches(e) {
    if (activeCategory && catOf(e) !== activeCategory) return false;
    var q = query.trim().toLowerCase();
    if (q) {
      var hay = ((e.name || '') + ' ' + (e.category || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function filtered() {
    var list = all.filter(matches);
    list.sort(function (a, b) {
      if (sortMode === 'old') return (a.at || 0) - (b.at || 0);
      if (sortMode === 'name') {
        try { return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'); }
        catch (e) { return String(a.name || '') < String(b.name || '') ? -1 : 1; }
      }
      return (b.at || 0) - (a.at || 0);
    });
    return list;
  }

  function refreshCategoryChips() {
    if (!chipsBox) return;
    var counts = {};
    all.forEach(function (e) {
      var c = catOf(e);
      counts[c] = (counts[c] || 0) + 1;
    });
    var cats = Object.keys(counts).sort();

    // 当前选中的分类如果已经不存在了（比如改了分类名），退回"全部"
    if (activeCategory && cats.indexOf(activeCategory) < 0) activeCategory = '';

    chipsBox.innerHTML = '';
    addChip('', '全部 ' + all.length);
    cats.forEach(function (c) { addChip(c, c + ' ' + counts[c]); });
  }

  function addChip(value, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cards-chip' + (value === activeCategory ? ' is-active' : '');
    b.textContent = label;
    b.setAttribute('aria-pressed', value === activeCategory ? 'true' : 'false');
    b.addEventListener('click', function () {
      activeCategory = value;
      refreshCategoryChips();
      renderGrid();
    });
    chipsBox.appendChild(b);
  }

  // ---------- 渲染 ----------
  function renderGrid() {
    releaseAll();
    grid.innerHTML = '';
    cards = [];

    var list = filtered();
    if (!list.length) {
      grid.hidden = true;
      if (emptyBox) {
        emptyBox.hidden = false;
        if (emptyTitle) {
          emptyTitle.textContent = all.length ? '没有符合条件的作品' : '暂无已发布的模型作品';
        }
        if (emptyHint) {
          emptyHint.textContent = all.length
            ? '换个关键词或分类试试，也可以点「全部」看所有作品'
            : '在管理后台上传模型并发布后，这里会显示卡片';
        }
      }
      updateNote();
      return;
    }

    if (emptyBox) emptyBox.hidden = true;
    grid.hidden = false;
    list.forEach(createCard);
    observeCards();
    updateNote();
  }

  function observeCards() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var card = en.target.__card;
        if (!card) return;
        card.visible = en.isIntersecting;
        if (!en.isIntersecting) return;
        // 有富余就直接加载（快）；没富余就不抢，交给 syncContexts 按"离屏幕中心远近"统一裁决，
        // 免得刚进视野的卡把正在看的卡挤掉、下一帧又被挤回来。
        if (live.length < MAX_LIVE) acquireAndLoad(card);
      });
    }, { rootMargin: '240px 0px', threshold: 0.05 });

    cards.forEach(function (c) {
      c.el.__card = c;
      io.observe(c.el);
    });
  }

  // ---------- 上下文调度 ----------
  // 一屏能同时看见的卡片可能多于 MAX_LIVE（宽屏 + 网格），所以不能按"谁先到谁拿"，
  // 否则先拿到的会被后面挤掉、被挤掉的又被补偿逻辑抢回来 —— 每帧互换，抖动到天荒地老。
  // 规则：把"当前可见"的卡片按离屏幕中心由近到远排序，只把上下文给最靠前的 MAX_LIVE 张；
  //      其余的在视野外沿，收回上下文并显示"重新进入视野后自动加载"。
  function syncContexts() {
    var vh = window.innerHeight || 800;
    var mid = vh / 2;

    var vis = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].visible) vis.push(cards[i]);
    }
    vis.forEach(function (c) {
      var r = c.el.getBoundingClientRect();
      c._dist = Math.abs((r.top + r.bottom) / 2 - mid);
    });
    vis.sort(function (a, b) { return a._dist - b._dist; });

    var keep = vis.slice(0, MAX_LIVE);
    live.slice().forEach(function (c) {
      if (keep.indexOf(c) < 0) releaseRenderer(c);
    });
    keep.forEach(function (c) {
      if (!c.renderer && performance.now() >= (c.retryAt || 0)) {
        if (!acquireAndLoad(c)) c.retryAt = performance.now() + 2500;
      } else if (c.renderer) {
        touchLive(c);
      }
    });
  }

  // ---------- 主循环（只渲染持有上下文且在视野内的卡片）----------
  var last = performance.now();
  var lastSync = 0;
  function loop() {
    requestAnimationFrame(loop);
    var now = performance.now();
    var dt = (now - last) / 1000;
    last = now;
    if (document.hidden) return;

    // 上下文调度：读 getBoundingClientRect 会触发布局，别每帧都做
    if (now - lastSync > 300) {
      lastSync = now;
      syncContexts();
    }

    for (var i = 0; i < live.length; i++) {
      var c = live[i];
      if (!c.renderer || !c.model || !c.visible) continue;
      if (!c.dragging && now >= c.resumeAt) c.group.rotation.y += dt * SPIN;
      c.renderer.render(c.scene, c.camera);
    }
  }

  window.addEventListener('resize', function () {
    cards.forEach(resizeCard);
  });

  // ---------- 搜索 / 排序 绑定 ----------
  if (qInput) {
    var qTimer = null;
    qInput.addEventListener('input', function () {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () {
        query = qInput.value || '';
        renderGrid();
      }, 160);
    });
  }
  if (sortSel) {
    sortSel.addEventListener('change', function () {
      sortMode = sortSel.value || 'new';
      renderGrid();
    });
  }

  // ---------- 离线兜底：项目 model/manifest.json ----------
  function loadManifest() {
    return fetch('model/manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var arr = Array.isArray(d) ? d : (d && Array.isArray(d.models) ? d.models : []);
        return arr.map(function (it) {
          var file = typeof it === 'string' ? it : (it && it.file);
          if (!file) return null;
          var base = String(file).replace(/\.[^.]+$/, '');
          return {
            id: (it && it.id) || base,
            name: (it && it.name) || base,
            url: 'model/' + file,
            thumb: '',
            at: (it && it.at) || 0,
            category: (it && it.category) || '',
            type: '',
            _local: false,
            _manifest: true
          };
        }).filter(Boolean);
      })
      .catch(function () { return null; });
  }

  // ---------- 启动 ----------
  function applyList(list) {
    all = list || [];
    if (!all.length) { showEmptyAll(); return; }
    if (toolbar) toolbar.hidden = false;
    refreshCategoryChips();
    renderGrid();
    startLoop();
  }

  function showEmptyAll() {
    if (emptyBox) {
      emptyBox.hidden = false;
      if (emptyTitle) emptyTitle.textContent = '暂无已发布的模型作品';
      if (emptyHint) emptyHint.textContent = '在管理后台上传模型并发布后，这里会显示卡片';
    }
    setNote(location.protocol === 'file:'
      ? '⚠ 当前是 file:// 直接打开，浏览器会拦掉清单与模型 —— 请用 http://127.0.0.1:8123/models.html'
      : '暂无作品');
  }

  function useManifest() {
    loadManifest().then(function (list) {
      if (list && list.length) { fromManifest = true; applyList(list); }
      else showEmptyAll();
    });
  }

  function startLoop() {
    if (loopStarted) return;
    loopStarted = true;
    loop();
  }

  function start() {
    // 数据层没加载上也要能显示 model/ 目录里的兜底清单，别直接摊手
    if (!window.ModelSync || !window.ModelSync.getModelEntries) { useManifest(); return; }
    window.ModelSync.getModelEntries().then(function (list) {
      if (!list || !list.length) { useManifest(); return; }
      applyList(list);
    }).catch(useManifest);
  }

  // 便于排查
  window.ModelCardsDebug = function () {
    return {
      total: all.length,
      shown: cards.length,
      liveWebGL: live.length,
      query: query,
      category: activeCategory || '(全部)',
      sort: sortMode,
      items: cards.map(function (c) {
        return { id: c.entry.id, name: c.entry.name, category: catOf(c.entry), loaded: !!c.model };
      })
    };
  };

  start();
})();
