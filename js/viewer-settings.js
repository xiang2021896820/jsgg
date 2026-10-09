// ============================================================
//  查看器设置快照 / 贴图方向策略 (viewer-settings.js)
//
//  两个职责，都放在这里，因为它们是同一件事的两面：
//
//  ① 【贴图方向记忆】旋转180°/镜像U/镜像V 三个开关的"上次选择"。
//     ⚠ 踩过的坑：把「重置贴图参数」也接进保存链路之后，点一次重置就把
//       "三个全关"写进记忆，之后每次加载都套用全关 → 用户每次上传都得再点一下镜像V。
//     现在的规则：**全关不算有效选择，直接删键**，让类型默认重新生效。
//
//  ② 【设置快照】把设置面板（显示/贴图/材质/光照）当前状态打包成一个普通对象，
//     发布作品时一起存进作品索引；下次用 ?model=<id> 打开该作品时原样还原。
//     这样"调好的贴图/材质/光照"不会一发布就退回上传时的默认值。
//
//  纯逻辑 + 只碰 DOM 的 value/checked，不依赖 THREE，便于用假 DOM 压测。
// ============================================================
(function (global) {
  'use strict';

  var VERSION = 1;

  // 方向记忆的键带上版本：v1 时期被「重置」写坏过（存了全关），
  // 升版可以让历史脏值自然失效，不用去猜用户 localStorage 里是什么。
  var ORIENT_PREFIX = 'uvOrient_v2_';

  // 各类型的方向默认值。
  //  .skp 走 OpenSKP，UV 是按面基向量重算的，实测**镜像 V** 之后贴图才正确
  //      （数学上等价于「旋转 180° + 镜像 U」同开，但只留一个开关更清楚）。
  //  .glb/.gltf 的贴图映射是源文件自带的，不动 —— 万一某个模型需要，
  //      用户在面板上点一次就会被记住（且重置不会再把记忆写坏）。
  function defaultOrient(modelType) {
    return { rot: false, mirrorU: false, mirrorV: modelType === 'skp' };
  }

  function orientKey(modelType) {
    return ORIENT_PREFIX + (modelType || 'glb');
  }

  function sanitizeOrient(o) {
    if (!o || typeof o !== 'object') return null;
    return { rot: !!o.rot, mirrorU: !!o.mirrorU, mirrorV: !!o.mirrorV };
  }

  // 三个方向全关 = 没有有效选择（多半是"重置"留下的），不该被记住
  function orientWorthRemembering(o) {
    return !!(o && (o.rot || o.mirrorU || o.mirrorV));
  }

  function store() {
    try { return global.localStorage || null; } catch (e) { return null; }
  }

  function loadOrient(modelType) {
    var ls = store();
    if (!ls) return null;
    try {
      var raw = ls.getItem(orientKey(modelType));
      if (!raw) return null;
      return sanitizeOrient(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function saveOrient(modelType, o) {
    var ls = store();
    if (!ls) return false;
    var key = orientKey(modelType);
    try {
      if (!orientWorthRemembering(o)) {
        ls.removeItem(key);      // 全关 → 删键，让默认重新生效
        return false;
      }
      ls.setItem(key, JSON.stringify(sanitizeOrient(o)));
      return true;
    } catch (e) {
      return false;              // 无痕模式等，静默忽略
    }
  }

  function clearOrient(modelType) {
    var ls = store();
    if (!ls) return;
    try { ls.removeItem(orientKey(modelType)); } catch (e) { /* 忽略 */ }
  }

  // ---------- DOM 读写小工具 ----------
  function el(doc, id) {
    return (doc && doc.getElementById) ? doc.getElementById(id) : null;
  }

  function readNum(doc, id, dflt) {
    var n = el(doc, id);
    if (!n) return dflt;
    var v = parseFloat(n.value);
    return isNaN(v) ? dflt : v;
  }

  function readBool(doc, id, dflt) {
    var n = el(doc, id);
    return n ? !!n.checked : dflt;
  }

  function readOrient(doc) {
    return {
      rot: readBool(doc, 'uvrotation-toggle', false),
      mirrorU: readBool(doc, 'uv-mirror-u', false),
      mirrorV: readBool(doc, 'uv-mirror-v', false)
    };
  }

  function writeOrient(doc, o) {
    o = sanitizeOrient(o) || defaultOrient('glb');
    var r = el(doc, 'uvrotation-toggle');
    var u = el(doc, 'uv-mirror-u');
    var v = el(doc, 'uv-mirror-v');
    if (r) r.checked = !!o.rot;
    if (u) u.checked = !!o.mirrorU;
    if (v) v.checked = !!o.mirrorV;
  }

  // ---------- 面板默认值（与 model-viewer.html 里的 HTML 默认一致）----------
  var DEFAULTS = {
    v: VERSION,
    uv: { rot: false, mirrorU: false, mirrorV: false, offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1 },
    mat: { color: '#ffffff', roughness: 1, metalness: 0, opacity: 1, all: true, picked: '' },
    light: { sun: true, intensity: 1, azimuth: 45, elevation: 45 },
    view: { edges: false, shadow: true, ao: false, autorotate: false, zfight: true }
  };

  function clamp(v, lo, hi, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  function normHex(c) {
    if (typeof c !== 'string') return DEFAULTS.mat.color;
    var s = c.trim();
    if (s.charAt(0) !== '#') s = '#' + s;
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : DEFAULTS.mat.color;
  }

  // ---------- 从面板抓当前设置 ----------
  // ctx: { pickedName } —— 吸取到的材质名不在 DOM 里，由调用方传进来
  function capture(doc, ctx) {
    ctx = ctx || {};
    var picked = (ctx.pickedName || '').trim();
    return {
      v: VERSION,
      uv: {
        rot: readBool(doc, 'uvrotation-toggle', false),
        mirrorU: readBool(doc, 'uv-mirror-u', false),
        mirrorV: readBool(doc, 'uv-mirror-v', false),
        offsetU: readNum(doc, 'uv-offset-u', 0),
        offsetV: readNum(doc, 'uv-offset-v', 0),
        scaleU: readNum(doc, 'uv-scale-u', 1),
        scaleV: readNum(doc, 'uv-scale-v', 1)
      },
      mat: {
        color: normHex(el(doc, 'mat-color') ? el(doc, 'mat-color').value : ''),
        roughness: readNum(doc, 'mat-rough', 1),
        metalness: readNum(doc, 'mat-metal', 0),
        opacity: readNum(doc, 'mat-opacity', 1),
        all: readBool(doc, 'mat-apply-all', false),
        picked: picked
      },
      light: {
        sun: readBool(doc, 'sunlight-toggle', true),
        intensity: readNum(doc, 'light-intensity', 1),
        azimuth: readNum(doc, 'light-azimuth', 45),
        elevation: readNum(doc, 'light-elevation', 45)
      },
      view: {
        edges: readBool(doc, 'edges-toggle', false),
        shadow: readBool(doc, 'shadow-toggle', true),
        ao: readBool(doc, 'ao-toggle', false),
        autorotate: readBool(doc, 'autorotate-toggle', false),
        zfight: readBool(doc, 'zfight-toggle', true)
      }
    };
  }

  // ---------- 校验（远端索引里存的东西不能盲信）----------
  function sanitize(s) {
    if (!s || typeof s !== 'object') return null;
    var out = {
      v: VERSION,
      uv: {
        rot: !!((s.uv || {}).rot),
        mirrorU: !!((s.uv || {}).mirrorU),
        mirrorV: !!((s.uv || {}).mirrorV),
        offsetU: clamp((s.uv || {}).offsetU, -1, 1, DEFAULTS.uv.offsetU),
        offsetV: clamp((s.uv || {}).offsetV, -1, 1, DEFAULTS.uv.offsetV),
        scaleU: clamp((s.uv || {}).scaleU, 0.1, 8, DEFAULTS.uv.scaleU),
        scaleV: clamp((s.uv || {}).scaleV, 0.1, 8, DEFAULTS.uv.scaleV)
      },
      mat: {
        color: normHex((s.mat || {}).color),
        roughness: clamp((s.mat || {}).roughness, 0, 1, DEFAULTS.mat.roughness),
        metalness: clamp((s.mat || {}).metalness, 0, 1, DEFAULTS.mat.metalness),
        opacity: clamp((s.mat || {}).opacity, 0, 1, DEFAULTS.mat.opacity),
        all: (s.mat && s.mat.all !== undefined) ? !!s.mat.all : DEFAULTS.mat.all,
        picked: typeof (s.mat || {}).picked === 'string' ? (s.mat.picked || '').trim() : ''
      },
      light: {
        sun: (s.light && s.light.sun !== undefined) ? !!s.light.sun : DEFAULTS.light.sun,
        intensity: clamp((s.light || {}).intensity, 0, 2, DEFAULTS.light.intensity),
        azimuth: clamp((s.light || {}).azimuth, 0, 360, DEFAULTS.light.azimuth),
        elevation: clamp((s.light || {}).elevation, 0, 90, DEFAULTS.light.elevation)
      },
      view: {
        edges: !!((s.view || {}).edges),
        shadow: (s.view && s.view.shadow !== undefined) ? !!s.view.shadow : DEFAULTS.view.shadow,
        ao: !!((s.view || {}).ao),
        autorotate: !!((s.view || {}).autorotate),
        zfight: (s.view && s.view.zfight !== undefined) ? !!s.view.zfight : DEFAULTS.view.zfight
      }
    };
    return out;
  }

  function isEmpty(s) {
    return !s || typeof s !== 'object';
  }

  // ---------- 把设置写回面板控件 ----------
  // 只负责"让面板显示成这个设置"，具体生效由调用方调各自的 apply 函数
  // （那些函数要用到 THREE / 当前模型，不适合放这个纯逻辑模块里）。
  // 返回：需要调用哪些 apply（true 表示要调）
  function apply(doc, s) {
    s = sanitize(s);
    if (!s) return null;

    function setVal(id, v) {
      var n = el(doc, id);
      if (n) n.value = v;
    }
    function setChk(id, v) {
      var n = el(doc, id);
      if (n) n.checked = !!v;
    }
    function setPair(id, v, digits) {
      setVal(id, v);
      setVal(id + '-value', Number(v).toFixed(digits));
    }

    // 贴图
    writeOrient(doc, s.uv);
    setPair('uv-offset-u', s.uv.offsetU, 2);
    setPair('uv-offset-v', s.uv.offsetV, 2);
    setPair('uv-scale-u', s.uv.scaleU, 2);
    setPair('uv-scale-v', s.uv.scaleV, 2);

    // 材质
    setVal('mat-color', s.mat.color);
    setPair('mat-rough', s.mat.roughness, 2);
    setPair('mat-metal', s.mat.metalness, 2);
    setPair('mat-opacity', s.mat.opacity, 2);
    setChk('mat-apply-all', s.mat.all);

    // 光照
    setChk('sunlight-toggle', s.light.sun);
    setPair('light-intensity', s.light.intensity, 1);
    setPair('light-azimuth', s.light.azimuth, 0);
    setPair('light-elevation', s.light.elevation, 0);

    // 显示
    setChk('edges-toggle', s.view.edges);
    setChk('shadow-toggle', s.view.shadow);
    setChk('ao-toggle', s.view.ao);
    setChk('autorotate-toggle', s.view.autorotate);
    setChk('zfight-toggle', s.view.zfight);

    // 显示开关（边线/阴影/环境吸收/自动旋转/消闪）已经写进控件了，
    // 但「生效」要调用各自的函数：那几个都依赖 THREE / 当前模型，
    // 所以这里只回报"哪些需要调用"，由调用方执行。
    //   uv     → 调 applyUvEdit()
    //   mat    → 调 applyMaterialEdit()
    //   light  → 调 applySunLight()
    //   autorotate → 需要同步自动旋转按钮
    // 其余四个（边线/阴影/环境吸收/消闪）调用方**无条件**按其当前 checked 调一次即可，
    // 它们是幂等的 —— 别写成"只有 true 才调"，否则关不掉。
    return { uv: true, mat: true, light: true, autorotate: s.view.autorotate };
  }

  // ---------- 把 UV 设置应用到一组贴图上 ----------
  // 首页横滑条 / 作品集卡片这些"小预览"共用这一份，免得作者在查看器里
  // 调好了方向，缩略图里贴图却还是镜像的。
  // 传入 settings 整体或 settings.uv 都行。基准 repeat/offset 取贴图当前值并缓存，
  // 重复调用不会叠加（这一点在 Node 压测里断言过）。
  function applyUvToTextures(root, settings) {
    if (!root || !root.traverse) return 0;
    var src = (settings && settings.uv) ? settings.uv : (settings || {});
    var uv = sanitize({ uv: src }).uv;
    var mu = uv.mirrorU ? -1 : 1;
    var mv = uv.mirrorV ? -1 : 1;
    var rot = uv.rot ? Math.PI : 0;
    var RW = (typeof THREE !== 'undefined' && THREE && THREE.RepeatWrapping !== undefined)
      ? THREE.RepeatWrapping : null;

    var seen = [];
    var n = 0;
    root.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
        if (!m || !m.map) return;
        var t = m.map;
        if (seen.indexOf(t.uuid) >= 0) return;
        seen.push(t.uuid);

        if (!t.__baseRepeat) t.__baseRepeat = [t.repeat.x, t.repeat.y];
        if (!t.__baseOffset) t.__baseOffset = [t.offset.x, t.offset.y];
        var br = t.__baseRepeat;
        var bo = t.__baseOffset;

        if (t.center && t.center.set) t.center.set(0.5, 0.5);
        t.rotation = rot;
        t.repeat.set(br[0] * mu / uv.scaleU, br[1] * mv / uv.scaleV);
        t.offset.set(bo[0] + uv.offsetU, bo[1] + uv.offsetV);
        // 镜像/缩放/偏移都需要重复寻址才成立
        if (RW !== null) {
          if (t.wrapS !== RW) t.wrapS = RW;
          if (t.wrapT !== RW) t.wrapT = RW;
        }
        t.matrixAutoUpdate = true;
        t.needsUpdate = true;
        n++;
      });
    });
    return n;
  }

  // 人类可读的摘要（发布后的提示语用）
  function describe(s) {
    s = sanitize(s);
    if (!s) return '';
    var bits = [];
    var dir = [];
    if (s.uv.rot) dir.push('旋转180°');
    if (s.uv.mirrorU) dir.push('镜像U');
    if (s.uv.mirrorV) dir.push('镜像V');
    bits.push('贴图方向：' + (dir.length ? dir.join('+') : '默认'));
    if (s.uv.offsetU || s.uv.offsetV || s.uv.scaleU !== 1 || s.uv.scaleV !== 1) bits.push('贴图偏移/缩放已保存');
    if (s.mat.all) bits.push('材质：整体调整');
    else if (s.mat.picked) bits.push('材质：' + s.mat.picked);
    else bits.push('材质：未指定');
    bits.push('光照 ' + s.light.intensity.toFixed(1) + ' / ' + s.light.azimuth + '° / ' + s.light.elevation + '°');
    return bits.join('，');
  }

  global.ViewerSettings = {
    VERSION: VERSION,
    ORIENT_PREFIX: ORIENT_PREFIX,
    DEFAULTS: DEFAULTS,
    defaultOrient: defaultOrient,
    orientKey: orientKey,
    sanitizeOrient: sanitizeOrient,
    orientWorthRemembering: orientWorthRemembering,
    loadOrient: loadOrient,
    saveOrient: saveOrient,
    clearOrient: clearOrient,
    readOrient: readOrient,
    writeOrient: writeOrient,
    capture: capture,
    sanitize: sanitize,
    isEmpty: isEmpty,
    apply: apply,
    applyUvToTextures: applyUvToTextures,
    describe: describe
  };
})(typeof window !== 'undefined' ? window : this);
