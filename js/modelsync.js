// ============================================================
//  3D 模型作品集 · 跨设备同步层 (modelsync.js)
//  与全景平台的 data.js 同一思路：
//  - 元数据（含模型托管 URL）存到 textdb 远端共享键，任何设备可读；
//  - 模型二进制（几 MB）存本机 IndexedDB，作为「管理员本机」兜底预览。
//  textdb 值有大小上限（~150KB），只放轻量元数据，不放二进制。
//  用法：首页轮播读 getModelEntries()；管理后台发布用 publishModel()。
// ============================================================
(function (global) {
  'use strict';

  var SYNC_BASE = 'https://textdb.online';
  // 模型作品集索引键（与全景索引键分开，互不影响）
  var MODELS_SYNC_KEY = 'vrpv_models_x9k2m4p7qw8r3t6y';
  var DB_NAME = 'jsgg_model_works';
  var STORE = 'models';
  // 删除墓碑（本地）：删除一件作品后写入，getModelEntries 会滤掉，
  // 防止「本机/别机重新推送索引」把已删作品复活（与全景 data.js 的删除墓碑同思路）。
  var DELETED_LS = 'jsgg_deleted_model_ids';

  function readDeletedIds() {
    try {
      var a = JSON.parse(global.localStorage.getItem(DELETED_LS) || '[]');
      return Array.isArray(a) ? a.map(String) : [];
    } catch (e) { return []; }
  }
  function addDeletedId(id) {
    try {
      var a = readDeletedIds();
      var s = String(id);
      if (a.indexOf(s) === -1) a.push(s);
      global.localStorage.setItem(DELETED_LS, JSON.stringify(a.slice(-300)));
    } catch (e) { /* ignore */ }
  }

  // ---------- textdb（远端元数据）----------
  function fetchRemoteIndex(timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, timeoutMs || 6000);
      fetch(SYNC_BASE + '/' + MODELS_SYNC_KEY + '?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (txt) {
          if (done) return;
          done = true; clearTimeout(timer);
          txt = (txt || '').trim();
          if (!txt) return resolve([]);
          try {
            var d = JSON.parse(txt);
            resolve(Array.isArray(d) ? d : (Array.isArray(d.works) ? d.works : []));
          } catch (e) { resolve([]); }
        })
        .catch(function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
    });
  }

  function pushRemoteIndex(entries) {
    return fetch(SYNC_BASE + '/update', {
      method: 'POST',
      body: new URLSearchParams({ key: MODELS_SYNC_KEY, value: JSON.stringify(entries) })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  // ---------- IndexedDB（本机二进制兜底）----------
  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) return reject(new Error('no-idb'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(rec) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbDelete(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- 对外：合并远端索引 + 本机模型 ----------
  // 返回 [{ id, name, url, thumb, at, category, _local: bool }]
  // url 存在 → 可跨设备加载；仅 _local → 仅本机（管理员浏览器）可见。
  function getModelEntries() {
    return Promise.all([fetchRemoteIndex(6000), idbAll().catch(function () { return []; })])
      .then(function (res) {
        var remote = res[0] || [];
        var local = res[1] || [];
        var dead = {};
        readDeletedIds().forEach(function (id) { dead[String(id)] = 1; });
        var byId = {};
        remote.forEach(function (w) { if (w && w.id != null && !dead[String(w.id)]) byId[String(w.id)] = Object.assign({}, w, { _local: false }); });
        local.forEach(function (w) {
          var k = String(w.id);
          if (dead[k]) return; // 已删：本机二进制也不展示
          if (!byId[k]) {
            byId[k] = {
              id: w.id, name: w.name || '未命名模型', url: '', thumb: w.thumb || '',
              at: w.at || 0, type: w.type || '', category: w.category || '',
              settings: w.settings || null, _local: true
            };
          } else byId[k]._local = true; // 本机也有二进制，可离线预览
        });
        var list = Object.keys(byId).map(function (k) { return byId[k]; });
        list.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
        return list;
      });
  }

  // 取某条作品的二进制（本机 IndexedDB）；没有则返回 null
  function getLocalBinary(id) {
    return idbGet(id).then(function (rec) {
      return rec && rec.blob ? rec.blob : null;
    }).catch(function () { return null; });
  }

  // ---------- 对外：发布一件作品 ----------
  // entry: { id, name, url, thumb?, blob?(ArrayBuffer), type?, category?, settings? }
  //  - 远端索引：始终写入（url 为空则只在本机可见，但仍记录 name 方便管理）
  //  - 本机：blob 存在则存入 IndexedDB（供离线/本机预览）
  //  - settings：查看器设置快照（贴图方向/材质/光照/显示开关）。
  //    用 ?model=<id> 打开时还原，所以必须跟着索引走，不能只存本机。
  function publishModel(entry) {
    var rec = {
      id: entry.id,
      name: entry.name || '未命名模型',
      url: entry.url || '',
      thumb: entry.thumb || '',
      at: entry.at || Date.now(),
      type: entry.type || '',
      category: (entry.category || '').trim(),
      settings: entry.settings || null
    };
    // ⚠ 本机 IndexedDB 只是"兜底预览"，它失败**不能**把发布本身带塌：
    //   无痕模式 / 浏览器禁用存储时 openDB 会直接 reject，
    //   不兜住的话远端索引明明写成功了，用户却看到"发布失败"。
    var p1 = entry.blob
      ? idbPut(Object.assign({ blob: entry.blob }, rec)).catch(function () { return false; })
      : Promise.resolve(true);
    return getModelEntries().then(function (list) {
      var others = list.filter(function (w) { return String(w.id) !== String(rec.id); });
      // 注意：写远端时必须逐个字段列出。早先这里漏了 type，导致它写进去就丢 ——
      // 所以新增字段（如 category）一定要同步补到这里。
      others.push({
        id: rec.id, name: rec.name, url: rec.url, thumb: rec.thumb,
        at: rec.at, type: rec.type, category: rec.category, settings: rec.settings
      });
      others.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return pushRemoteIndex(others.slice(0, 24)).then(function () { return rec; });
    }).then(function () { return p1.then(function () { return rec; }); });
  }

  // ---------- 对外：改一条作品的分类 ----------
  // 列表页就地归类用。只动远端索引里的 category，不碰模型二进制；
  // 本机 IndexedDB 里若有同一条记录也同步改掉，免得两台设备看到的分类不一致。
  function updateModelCategory(id, category) {
    var cat = (category || '').trim();
    return getModelEntries().then(function (list) {
      var hit = null;
      var next = list.map(function (w) {
        // ★ 这里必须把每个字段都搬过来：改分类走的是"读全量 → 改一个 → 写回"，
        //   漏一个字段就等于把那个字段从远端索引里删掉。
        //   （早先漏过 type，后来又差点漏掉 settings —— 每次加字段都要看这里。）
        var copy = {
          id: w.id, name: w.name, url: w.url || '', thumb: w.thumb || '',
          at: w.at || 0, type: w.type || '', category: w.category || '',
          settings: w.settings || null
        };
        if (String(w.id) === String(id)) { copy.category = cat; hit = copy; }
        return copy;
      });
      if (!hit) return null;
      return pushRemoteIndex(next.slice(0, 24)).then(function (ok) {
        // 同理：本机那条记录同步失败（没有 IndexedDB / 存储被禁）不能算改分类失败。
        // 之前这里没兜住 reject，会让列表页显示"分类保存失败，请检查网络后重试"，
        // 而远端其实早就改好了。
        return idbGet(id).catch(function () { return null; }).then(function (rec) {
          if (!rec) return ok;
          rec.category = cat;
          return idbPut(rec).then(function () { return ok; }).catch(function () { return ok; });
        }).then(function () { return hit; });
      });
    });
  }

  // ---------- 对外：删除一件作品（跨设备）----------
  // 写本地墓碑（防止复活）+ 从远端索引剔除 + 删本机二进制。
  // 若远端拉不到（离线）仍先写墓碑+清本机，下次联网同步时索引会被正确剔除。
  function deleteModel(id) {
    var k = String(id);
    addDeletedId(k);
    return idbDelete(k).catch(function () { return false; }).then(function () {
      return getModelEntries().then(function (list) {
        var next = list.filter(function (w) { return String(w.id) !== k; });
        return pushRemoteIndex(next.slice(0, 24)).catch(function () { return false; });
      }).catch(function () { return false; });
    });
  }

  // ---------- 对外：修改一件作品的元数据（改名/改托管URL/改分类/改封面）----------
  // patch: { name?, url?, category?, thumb?, type?, settings? }，只改给出的字段。
  // 走「读全量 → 改一条 → 写回」，逐字段搬运（与 updateModelCategory 同一铁律：漏字段=丢字段）。
  function updateModelMeta(id, patch) {
    patch = patch || {};
    var k = String(id);
    return getModelEntries().then(function (list) {
      var hit = null;
      var next = list.map(function (w) {
        if (String(w.id) !== k) return w;
        var copy = {
          id: w.id,
          name: patch.name != null ? String(patch.name) : (w.name || '未命名模型'),
          url: patch.url != null ? String(patch.url) : (w.url || ''),
          thumb: patch.thumb != null ? String(patch.thumb) : (w.thumb || ''),
          at: w.at || 0,
          type: patch.type != null ? String(patch.type) : (w.type || ''),
          category: patch.category != null ? String(patch.category).trim() : (w.category || ''),
          settings: patch.settings !== undefined ? patch.settings : (w.settings || null)
        };
        hit = copy;
        return copy;
      });
      if (!hit) return null;
      return pushRemoteIndex(next.slice(0, 24)).then(function (ok) {
        // 本机二进制记录同步改元数据（不碰 blob 本身）
        return idbGet(k).catch(function () { return null; }).then(function (rec) {
          if (!rec) return hit;
          if (patch.name != null) rec.name = hit.name;
          if (patch.category != null) rec.category = hit.category;
          if (patch.url != null) rec.url = hit.url;
          if (patch.thumb != null) rec.thumb = hit.thumb;
          if (patch.type != null) rec.type = hit.type;
          if (patch.settings !== undefined) rec.settings = hit.settings;
          return idbPut(rec).then(function () { return hit; }).catch(function () { return hit; });
        }).then(function () { return hit; });
      });
    });
  }

  global.ModelSync = {
    MODELS_SYNC_KEY: MODELS_SYNC_KEY,
    fetchRemoteIndex: fetchRemoteIndex,
    getModelEntries: getModelEntries,
    getLocalBinary: getLocalBinary,
    publishModel: publishModel,
    updateModelCategory: updateModelCategory,
    updateModelMeta: updateModelMeta,
    deleteModel: deleteModel,
    idbPut: idbPut,
    idbGet: idbGet,
    idbDelete: idbDelete
  };
})(window);
