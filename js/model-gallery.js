// ============================================================
//  3D 模型作品集页 · 多窗口横向浏览 (model-gallery.js)
//  - 最多 MAX_CARDS 个模型窗口，取最新上传的作品（ModelSync 按 at 倒序）
//  - 每个窗口懒加载：滚进视野才建 WebGL 上下文，离屏暂停渲染
//  - 模型取数优先级：本机 IndexedDB 二进制 → 作品 url → model/manifest.json 静态兜底
//    ★ 本机二进制必须优先：从 localhost 加载 https://jsgg.surge.sh/model/*.glb 属于跨域，
//      而 surge 不返回 Access-Control-Allow-Origin，浏览器会直接拦掉。
//  - 窗口下方信息块整块可点 → model-viewer.html?model=<id>
// ============================================================
(function () {
  'use strict';

  var gallery = document.getElementById('gallery');
  var track = document.getElementById('gallery-track');
  var emptyBox = document.getElementById('gallery-empty');
  var moreEl = document.getElementById('gallery-more');   // 「查看更多」→ models.html
  var noteEl = document.getElementById('gallery-note');
  var prevBtn = document.getElementById('gallery-prev');
  var nextBtn = document.getElementById('gallery-next');
  if (!track || typeof THREE === 'undefined') return;

  var MAX_CARDS = 4;
  var FIT_MARGIN = 1.12;
  var SPIN = 0.26;          // 自转角速度 rad/s
  var RESUME_MS = 1200;     // 松手后多久恢复自转
  var GAP = 20;             // 与 CSS .gallery-track 的 gap 一致
  var GLB_RE = /\.(glb|gltf)(\?|#|$)/i;

  var cards = [];

  // ---------- 小工具 ----------
  function isCrossOrigin(url) {
    try {
      return new URL(url, location.href).origin !== location.origin;
    } catch (e) {
      return false;
    }
  }

  function fmtTime(at) {
    if (!at) return '';
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function setState(card, text, isError) {
    if (!card.state) return;
    card.state.textContent = text;
    card.state.hidden = !text;
    card.state.classList.toggle('is-error', !!isError);
    card.status = text;
  }

  // ---------- 建卡 ----------
  function createCard(entry) {
    var el = document.createElement('article');
    el.className = 'gallery-card';

    var viewport = document.createElement('div');
    viewport.className = 'gallery-viewport';

    var state = document.createElement('div');
    state.className = 'gallery-state';
    state.textContent = '排队等待…';
    viewport.appendChild(state);

    var badge = document.createElement('span');
    badge.className = 'gallery-badge';
    badge.textContent = entry._manifest ? '本地文件' : (entry.url ? '已托管' : '仅本机可见');
    viewport.appendChild(badge);

    var info = document.createElement('a');
    info.className = 'gallery-info';
    info.href = 'model-viewer.html?model=' + encodeURIComponent(entry.id);

    var name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = entry.name || '未命名模型';

    var meta = document.createElement('span');
    meta.className = 'gallery-meta';
    var bits = [];
    var cat = (entry.category || '').trim();
    if (cat) bits.push(cat);          // 与作品集页的分类信息保持一致
    var t = fmtTime(entry.at);
    if (t) bits.push(t);
    if (entry._manifest) bits.push('项目 model/ 目录');
    else if (entry.url) bits.push(isCrossOrigin(entry.url) ? '托管地址 · 跨域' : '托管地址 · 同源');
    else bits.push('未填托管 URL');
    meta.textContent = bits.join(' · ');

    var go = document.createElement('span');
    go.className = 'gallery-go';
    go.textContent = '查看模型详情 →';

    info.appendChild(name);
    info.appendChild(meta);
    info.appendChild(go);

    el.appendChild(viewport);
    el.appendChild(info);
    track.appendChild(el);

    var card = {
      entry: entry,
      el: el,
      viewport: viewport,
      state: state,
      badge: badge,
      visible: false,
      loaded: false,
      dragging: false,
      resumeAt: 0,
      completed: false,
      status: ''
    };
    cards.push(card);
    return card;
  }

  function createAddCard() {
    var el = document.createElement('article');
    el.className = 'gallery-card gallery-card--add';

    var a = document.createElement('a');
    a.className = 'gallery-add';
    a.href = 'model-viewer.html?admin';

    var icon = document.createElement('span');
    icon.className = 'gallery-add-icon';
    icon.textContent = '+';

    var title = document.createElement('span');
    title.className = 'gallery-add-title';
    title.textContent = '上传新模型';

    var hint = document.createElement('span');
    hint.className = 'gallery-add-hint';
    hint.textContent = '支持 SketchUp (.skp) / .gltf / .glb';

    a.appendChild(icon);
    a.appendChild(title);
    a.appendChild(hint);
    el.appendChild(a);
    track.appendChild(el);
  }

  // ---------- 渲染器（懒建） ----------
  function initRenderer(card) {
    if (card.renderer) return;

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    card.viewport.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f5);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6ee, 0.5));
    var sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(6, 10, 8);
    scene.add(sun);

    var group = new THREE.Group();
    scene.add(group);

    card.renderer = renderer;
    card.scene = scene;
    card.group = group;
    card.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    card.camera.position.set(0, 2, 8);

    bindDrag(card);
    resizeCard(card);
  }

  function resizeCard(card) {
    if (!card.renderer) return;
    var w = card.viewport.clientWidth || 320;
    var h = card.viewport.clientHeight || 230;
    card.renderer.setSize(w, h, false);
    card.camera.aspect = w / h;
    card.camera.updateProjectionMatrix();
  }

  function applyMaterialPolish(card, root) {
    var maxAniso = card.renderer.capabilities.getMaxAnisotropy();
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) {
        m.side = THREE.DoubleSide;   // 单面几何（SketchUp）也能看见
        if (m.map) {
          m.map.anisotropy = maxAniso;
          m.map.needsUpdate = true;
        }
      });
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
    // 近/远平面的跨度决定深度缓冲的精度分布：跨度越大，模型处能分辨的深度越粗，
    // 「差一点点」的面就越容易闪。原来 far = 10×取景距离太奢侈了。
    cam.near = Math.max(distance / 100, 0.05);
    cam.far = Math.max(distance * 6, 120);
    cam.updateProjectionMatrix();
    cam.lookAt(center.x, center.y, center.z);
  }

  function clearCard(card) {
    if (!card.model) return;
    card.group.remove(card.model);
    card.model.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          for (var k in m) { if (m[k] && m[k].isTexture) m[k].dispose(); }
          m.dispose();
        });
      }
    });
    card.model = null;
  }

  // ---------- 取数并加载 ----------
  function loadModelFor(card) {
    var entry = card.entry;
    setState(card, '模型加载中…', false);

    function ok(gltf) {
      var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!root) { fail(null); return; }
      clearCard(card);
      applyMaterialPolish(card, root);
      // 作者发布时保存的贴图方向也要生效，否则缩略图里贴图是镜像的
      // （与查看器看到的对不上）。没有设置快照的旧作品保持原样。
      if (entry.settings && window.ViewerSettings) {
        window.ViewerSettings.applyUvToTextures(root, entry.settings);
      }
      // 面重叠闪烁治理：几何体检 → 合并同网格内的正反两片 → 给跨网格重合面错层。
      // 上面刚把材质设成 DoubleSide，所以合并掉重复片是安全的（视觉完全一致）。
      if (window.ZFight) window.ZFight.run(root, true, { mergeSameMesh: true });
      card.group.add(root);
      card.model = root;
      fitToView(card, root);
      card.loaded = true;
      setState(card, '', false);
      card.state.hidden = true;
    }

    function parseBuf(buf) {
      new THREE.GLTFLoader().parse(buf, '', ok, fail);
    }

    function loadUrl(url) {
      new THREE.GLTFLoader().load(url, ok, undefined, fail);
    }

    function fail(err) {
      var reason;
      if (err && err.message && /404|not found/i.test(err.message)) {
        reason = '托管地址 404：文件不在服务器上';
      } else if (entry.url && GLB_RE.test(entry.url) && isCrossOrigin(entry.url)) {
        reason = '跨域加载被浏览器拦截（模型托管站未返回 CORS 头）。本机验证请把 .glb 放进项目 model/ 目录，托管 URL 填同源地址 model/文件名.glb';
      } else {
        reason = '模型加载失败' + (err && err.message ? '：' + err.message : '');
      }
      setState(card, reason, true);
      card.loaded = false;
    }

    // 1) 本机 IndexedDB 二进制优先（跨域 URL 在本机一定失败，本机有二进制就直接用）
    var localP = (window.ModelSync && entry.id)
      ? window.ModelSync.getLocalBinary(entry.id).catch(function () { return null; })
      : Promise.resolve(null);

    localP.then(function (buf) {
      if (buf) { parseBuf(buf); return; }
      if (entry.url && GLB_RE.test(entry.url)) { loadUrl(entry.url); return; }
      if (entry.url) {
        setState(card, '托管地址不是 .glb / .gltf 文件，无法直接加载', true);
      } else {
        setState(card, '这个作品发布时没填「托管 URL」，模型文件只存在上传它的那台设备的浏览器里', true);
      }
    }).catch(function () {
      if (entry.url && GLB_RE.test(entry.url)) loadUrl(entry.url);
      else setState(card, '读取本机模型数据失败', true);
    });
  }

  // ---------- 交互：窗口内拖拽旋转 ----------
  function bindDrag(card) {
    var canvas = card.renderer.domElement;
    var lastX = 0, lastY = 0;

    function down(e) {
      if (!card.model) return;
      card.dragging = true;
      var p = e.touches ? e.touches[0] : e;
      lastX = p.clientX;
      lastY = p.clientY;
      card.viewport.classList.add('is-grabbing');
    }

    function move(e) {
      if (!card.dragging) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - lastX, dy = p.clientY - lastY;
      lastX = p.clientX;
      lastY = p.clientY;
      card.group.rotation.y += dx * 0.01;
      card.group.rotation.x = Math.max(-1.2, Math.min(1.2, card.group.rotation.x + dy * 0.01));
    }

    function up() {
      if (!card.dragging) return;
      card.dragging = false;
      card.viewport.classList.remove('is-grabbing');
      card.resumeAt = performance.now() + RESUME_MS;
    }

    canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: true });
    canvas.addEventListener('touchmove', move, { passive: true });
    canvas.addEventListener('touchend', up);
  }

  // ---------- 交互：整排左右拖动（在非画布区域按下时生效） ----------
  var panning = false, panStartX = 0, panStartScroll = 0, panMoved = 0;

  function onPanDown(e) {
    if (e.button && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('canvas')) return;  // 画布上是旋转模型
    var p = e.touches ? e.touches[0] : e;
    panning = true;
    panMoved = 0;
    panStartX = p.clientX;
    panStartScroll = track.scrollLeft;
    track.classList.add('is-panning');
  }

  function onPanMove(e) {
    if (!panning) return;
    var p = e.touches ? e.touches[0] : e;
    var dx = p.clientX - panStartX;
    panMoved = Math.max(panMoved, Math.abs(dx));
    track.scrollLeft = panStartScroll - dx;
  }

  function onPanUp() {
    if (!panning) return;
    panning = false;
    track.classList.remove('is-panning');
  }

  track.addEventListener('mousedown', onPanDown);
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
  track.addEventListener('touchstart', onPanDown, { passive: true });
  track.addEventListener('touchmove', onPanMove, { passive: true });
  track.addEventListener('touchend', onPanUp);
  track.addEventListener('touchcancel', onPanUp);

  // 拖动过之后抑制这次点击（否则会误触发信息块的跳转）
  track.addEventListener('click', function (e) {
    if (panMoved > 6) {
      e.preventDefault();
      e.stopPropagation();
      panMoved = 0;
    }
  }, true);

  // 键盘左右键
  track.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { track.scrollLeft += cardStep(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { track.scrollLeft -= cardStep(); e.preventDefault(); }
  });

  // ---------- 左右切换按钮 ----------
  function cardStep() {
    if (!cards.length) return 340;
    var w = cards[0].el.getBoundingClientRect().width || 320;
    return w + GAP;
  }

  function updateArrows() {
    if (!prevBtn || !nextBtn) return;
    var max = Math.max(0, track.scrollWidth - track.clientWidth);
    prevBtn.disabled = track.scrollLeft <= 1;
    nextBtn.disabled = track.scrollLeft >= max - 1;
    // 窗口全部放得下时（首页 4 张在宽屏正好排满）左右箭头毫无意义 →
    // 打上 is-static，由 CSS 整个收起，避免留两个灰掉的死按钮。
    if (gallery) gallery.classList.toggle('is-static', max <= 1);
  }

  if (prevBtn) prevBtn.addEventListener('click', function () { track.scrollLeft -= cardStep(); });
  if (nextBtn) nextBtn.addEventListener('click', function () { track.scrollLeft += cardStep(); });
  track.addEventListener('scroll', updateArrows);

  // ---------- 主循环 ----------
  var last = performance.now();
  function loop() {
    requestAnimationFrame(loop);
    var now = performance.now();
    var dt = (now - last) / 1000;
    last = now;
    if (document.hidden) return;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (!c.renderer || !c.model || !c.visible) continue;
      if (!c.dragging && now >= c.resumeAt) c.group.rotation.y += dt * SPIN;
      c.renderer.render(c.scene, c.camera);
    }
  }

  window.addEventListener('resize', function () {
    cards.forEach(resizeCard);
    updateArrows();
  });

  // ---------- 组装 ----------
  // 这条容器带 .reveal（CSS 里默认 opacity:0），要等 main.js 的 IntersectionObserver 补上
  // .is-visible 才淡入。它一开始是 hidden 的，只有变成可见才会有盒子、才会被判定。
  // 万一浏览器没重算，整条就永远停在透明 —— 所以揭开时如果在视野内，直接兜一次。
  function revealNow() {
    if (!gallery || !gallery.classList || !gallery.classList.contains('reveal')) return;
    if (gallery.classList.contains('is-visible')) return;
    requestAnimationFrame(function () {
      if (gallery.classList.contains('is-visible')) return;
      var r = gallery.getBoundingClientRect();
      var vh = window.innerHeight || 800;
      if (r.height > 0 && r.top < vh && r.bottom > 0) gallery.classList.add('is-visible');
    });
  }

  function render(entries, fromManifest) {
    entries.forEach(createCard);
    // 首页那条也复用本模块，但不想要「上传新模型」占位卡（页头已经有按钮了）→ data-no-add
    if (!track.hasAttribute('data-no-add') && entries.length < MAX_CARDS) createAddCard();

    if (gallery) gallery.hidden = false;
    revealNow();
    if (emptyBox) emptyBox.hidden = true;
    if (moreEl) moreEl.hidden = false;   // 有窗口才显示「查看更多」
    if (noteEl) {
      var note = '共 ' + entries.length + ' 件作品 · 可左右滑动查看'
        + (fromManifest ? '（本地 model/ 目录兜底）' : '');
      if (location.protocol === 'file:') {
        var page = (location.pathname.split('/').pop() || 'index.html');
        note = '⚠ 当前是 file:// 直接打开，浏览器会拦掉模型文件与清单 —— 请用 http 打开：'
          + 'http://127.0.0.1:8123/' + page + ' · ' + note;
      }
      noteEl.textContent = note;
    }

    cards.forEach(function (card) {
      var io = new IntersectionObserver(function (es) {
        var hit = es[0].isIntersecting;
        card.visible = hit;
        if (!hit) return;
        initRenderer(card);
        resizeCard(card);
        if (!card.completed) {
          card.completed = true;
          loadModelFor(card);
        }
      }, { root: track, threshold: 0.2 });
      io.observe(card.el);
    });

    updateArrows();
    loop();
  }

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
            _local: false,
            _manifest: true
          };
        }).filter(Boolean);
      })
      .catch(function () { return null; });
  }

  function showEmpty(reason) {
    if (gallery) gallery.hidden = true;
    if (moreEl) moreEl.hidden = true;    // 空态已经有自己的上传入口，不再显示「查看更多」
    if (emptyBox) {
      emptyBox.hidden = false;
      if (reason) {
        var hint = emptyBox.querySelector('.gallery-empty-hint');
        if (hint) hint.textContent = reason;
      }
    }
    if (noteEl) {
      var page = (location.pathname.split('/').pop() || 'index.html');
      noteEl.textContent = (location.protocol === 'file:')
        ? '⚠ 当前是 file:// 直接打开，浏览器会拦掉模型文件与清单 —— 请用 http 打开：http://127.0.0.1:8123/' + page
        : '暂无作品';
    }
  }

  function useManifest() {
    loadManifest().then(function (list) {
      if (list && list.length) render(list.slice(0, MAX_CARDS), true);
      else showEmpty();
    });
  }

  function start() {
    if (!window.ModelSync) { useManifest(); return; }
    window.ModelSync.getModelEntries().then(function (list) {
      var entries = (list || []).slice(0, MAX_CARDS);
      if (entries.length) render(entries, false);
      else useManifest();
    }).catch(useManifest);
  }

  // 便于排查：在控制台读窗口状态
  window.ModelGalleryDebug = function () {
    return cards.map(function (c) {
      return {
        id: c.entry.id,
        name: c.entry.name,
        url: c.entry.url || '',
        local: !!c.entry._local,
        manifest: !!c.entry._manifest,
        hasModel: !!c.model,
        status: c.status || 'ok'
      };
    });
  };

  start();
})();
