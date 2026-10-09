// 3D 模型管理（内联于 VR 后台 /vr/admin.html 的「3D 模型」页面）
// 依赖：window.ModelSync（来自 ../js/modelsync.js）
// 所有公开函数加 m3d 前缀，避免与全景后台 admin.js 的命名冲突。
(function () {
  var m3dModels = [];

  function m3dToast(msg, type) {
    var t = document.getElementById('m3dToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'm3dToast';
      t.className = 'm3d-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'm3d-toast on' + (type ? ' ' + type : '');
    clearTimeout(m3dToast._t);
    m3dToast._t = setTimeout(function () { t.className = 'm3d-toast'; }, 2200);
  }
  function m3dEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function m3dEnc(s) { return encodeURIComponent(s); }
  function m3dTypeBadge(type) {
    type = (type || '').toLowerCase();
    if (type.indexOf('skp') >= 0) return '<span class="badge skp">SKP</span>';
    if (type.indexOf('gltf') >= 0) return '<span class="badge gltf">GLTF</span>';
    return '<span class="badge glb">GLB</span>';
  }
  function m3dFmt(at) {
    if (!at) return '';
    var d = new Date(at);
    if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function m3dLoad() { m3dRender(true); }
  function m3dRender(force) { if (force) { m3dFetch(); return; } paint(); }

  function m3dFetch() {
    if (typeof ModelSync === 'undefined') { m3dToast('模型同步模块未加载', 'err'); return; }
    ModelSync.getModelEntries().then(function (list) {
      m3dModels = list || [];
      paint();
    }).catch(function (e) { m3dToast('读取模型失败：' + (e && e.message || e), 'err'); });
  }

  function paint() {
    var q = (document.getElementById('m3dSearch').value || '').trim().toLowerCase();
    var list = m3dModels.filter(function (m) {
      if (!q) return true;
      return (m.name || '').toLowerCase().indexOf(q) >= 0 || (m.category || '').toLowerCase().indexOf(q) >= 0;
    });
    document.getElementById('m3dCount').textContent = '共 ' + m3dModels.length + ' 件' + (q ? ('，匹配 ' + list.length + ' 件') : '');
    var grid = document.getElementById('m3dGrid');
    var empty = document.getElementById('m3dEmpty');
    if (!list.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      empty.querySelector('.big').textContent = m3dModels.length ? '🔍' : '🧊';
      empty.querySelector('div:nth-child(2)').textContent = m3dModels.length ? '没有匹配的模型' : '还没有模型作品';
      return;
    }
    empty.style.display = 'none';
    grid.innerHTML = list.map(function (m) {
      var vis = m.url ? '<span class="badge vis">跨设备</span>' : '<span class="badge loc">仅本机</span>';
      var thumb = m.thumb ? '<img src="' + m3dEsc(m.thumb) + '" alt="">' : '<span class="ph">🧊</span>';
      return '<div class="card" data-id="' + m3dEsc(m.id) + '">'
        + '<div class="thumb">' + thumb + m3dTypeBadge(m.type) + vis + '</div>'
        + '<div class="body">'
        + '<div class="name">' + m3dEsc(m.name || '未命名模型') + '</div>'
        + '<div class="meta"><span class="cat">' + (m.category ? ('#' + m3dEsc(m.category)) : '未分类') + '</span><span>' + m3dFmt(m.at) + '</span></div>'
        + '<div class="acts">'
        + '<a class="btn btn-ghost" href="../model-viewer.html?model=' + m3dEnc(m.id) + '" target="_blank">预览</a>'
        + '<button class="btn btn-outline" onclick="m3dOpenEdit(\'' + m3dEnc(m.id) + '\')">编辑</button>'
        + '<button class="btn btn-danger" onclick="m3dDel(\'' + m3dEnc(m.id) + '\')">删除</button>'
        + '</div>'
        + '</div></div>';
    }).join('');
  }

  var m3dEditId = null;
  function m3dOpenEdit(id) {
    var m = m3dModels.find(function (x) { return String(x.id) === String(id); });
    if (!m) return;
    m3dEditId = m.id;
    document.getElementById('m3dEName').value = m.name || '';
    document.getElementById('m3dECat').value = m.category || '';
    document.getElementById('m3dEUrl').value = m.url || '';
    document.getElementById('m3dEThumb').value = m.thumb || '';
    var cats = {};
    m3dModels.forEach(function (x) { if (x.category) cats[x.category] = 1; });
    document.getElementById('m3dCatList').innerHTML = Object.keys(cats).map(function (c) { return '<option value="' + m3dEsc(c) + '">'; }).join('');
    document.getElementById('m3dEditOverlay').classList.add('on');
  }
  function m3dCloseEdit() { document.getElementById('m3dEditOverlay').classList.remove('on'); m3dEditId = null; }
  function m3dSave() {
    if (!m3dEditId) return;
    var patch = {
      name: document.getElementById('m3dEName').value.trim(),
      category: document.getElementById('m3dECat').value.trim(),
      url: document.getElementById('m3dEUrl').value.trim(),
      thumb: document.getElementById('m3dEThumb').value.trim()
    };
    if (!patch.name) { m3dToast('名称不能为空', 'err'); return; }
    ModelSync.updateModelMeta(m3dEditId, patch).then(function (res) {
      if (!res) { m3dToast('未找到该模型', 'err'); return; }
      m3dToast('已保存', 'ok'); m3dCloseEdit(); m3dRender(true);
    }).catch(function (e) { m3dToast('保存失败：' + (e && e.message || e), 'err'); });
  }
  function m3dDel(id) {
    var m = m3dModels.find(function (x) { return String(x.id) === String(id); });
    var nm = m ? (m.name || '未命名模型') : '该模型';
    if (!confirm('确定删除「' + nm + '」？\n删除后将在所有设备隐藏（含远端索引）。此操作不可恢复。')) return;
    ModelSync.deleteModel(id).then(function () { m3dToast('已删除', 'ok'); m3dRender(true); })
      .catch(function (e) { m3dToast('删除失败：' + (e && e.message || e), 'err'); });
  }
  function m3dSwitchSub(sub) {
    document.querySelectorAll('.m3d-page .subtab').forEach(function (t) { t.classList.toggle('active', t.dataset.sub === sub); });
    document.getElementById('m3dSubList').style.display = sub === 'list' ? '' : 'none';
    document.getElementById('m3dSubUpload').style.display = sub === 'upload' ? '' : 'none';
    if (sub === 'upload') {
      var f = document.getElementById('m3dUploadFrame');
      if (f && !f.src) f.src = f.dataset.src;
    }
  }

  // 暴露给内联 onclick
  window.m3dLoad = m3dLoad;
  window.m3dRender = m3dRender;
  window.m3dOpenEdit = m3dOpenEdit;
  window.m3dCloseEdit = m3dCloseEdit;
  window.m3dSave = m3dSave;
  window.m3dDel = m3dDel;
  window.m3dSwitchSub = m3dSwitchSub;
})();
