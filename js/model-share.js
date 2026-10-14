// ============================================================
//  3D 模型作品 · 分享模块 (model-share.js)
//  与全景 vr/js/data.js 的分享能力同形态：
//  - 分享弹层：作品卡片（名称 + 小 LOGO + 缩略图 + 日期/分类 + 二维码）+ 复制链接 + 微信/朋友圈
//  - 分享海报：750×1334 canvas，长按保存
//  区别：模型 .glb 太大不能内联进 URL（全景用 ?data= 内联），所以模型分享链接指向
//        model-viewer.html?model=<id>（依赖作品已发布、跨设备可见）。
//  缩略图优先级：调用方即时截图(opts.thumb) > 作品 thumb 字段 > 蓝灰占位。
//  用法：ModelShare.openById(id, {thumb: dataURLorNull})
// ============================================================
(function (global) {
  'use strict';

  // ── 配色/字体常量（具体色值，避免依赖任一站点变量体系）──
  var SHARE_FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Segoe UI",sans-serif';
  var SHARE_INK = '#16202b';     // 主墨色（标题/正文）
  var SHARE_INK2 = '#46586b';    // 次墨色（简介）
  var SHARE_MUTED = '#6b7b8c';   // 灰（提示/说明）
  var SHARE_LINE = '#e3e8ee';    // 浅分隔线
  var SHARE_BRAND = '#1e88e5';   // 品牌蓝
  var SHARE_BRAND_T = '#1976d2'; // 品牌蓝（深）

  // ── 小工具 ──
  function escShareText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(at) {
    if (!at) return '';
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 分享链接基础地址：指向本站 model-viewer.html（兼容子路径/自定义域名/本地）
  function getModelShareBaseUrl() {
    try { return new URL('model-viewer.html', location.href).href; }
    catch (e) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'model-viewer.html'; }
  }
  function getModelShareLogoUrl() {
    try { return new URL('images/logo.png', location.href).href; }
    catch (e) { return 'images/logo.png'; }
  }
  function getModelWorkCoverUrl(m) {
    if (m && m.thumb) return m.thumb;
    return null;
  }

  // ── canvas 绘图辅助 ──
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
    var w = Math.round(ctx.measureText(text).width + 32);
    var left = opts.align === 'right' ? x - w : x;
    ctx.fillStyle = bg; spRound(ctx, left, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 16, y + h / 2 + 1);
    ctx.restore();
    return w;
  }
  function spEllipsis(ctx, text, maxWidth) {
    var s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxWidth) return s;
    var t = s;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }
  function spWrap(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text == null ? '' : text).split('');
    var line = '', ly = y, n = 0;
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
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
  function spLoadImage(url, timeout) {
    return new Promise(function (resolve, reject) {
      if (!url) { reject(new Error('no url')); return; }
      function attempt(useCors) {
        var img = new Image();
        if (useCors) img.crossOrigin = 'anonymous';
        var timer = setTimeout(function () { img.src = ''; done(false); }, timeout || 10000);
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
  function spMakeQr(text, size) {
    return new Promise(function (resolve, reject) {
      if (typeof QRCode === 'undefined') { reject(new Error('no qrcode lib')); return; }
      var host = document.createElement('div');
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
      var waited = 0;
      (function poll() {
        var el = host.querySelector('canvas') || host.querySelector('img');
        var ready = el && ((el.tagName === 'CANVAS' && el.width > 0) ||
                         (el.tagName === 'IMG' && el.complete && el.naturalWidth > 0));
        if (ready) { cleanup(); resolve(el); return; }
        waited += 60;
        if (waited > 2400) { cleanup(); reject(new Error('qr timeout')); return; }
        setTimeout(poll, 60);
      })();
    });
  }

  // ── 分享弹层里的作品卡片（HTML 字符串）──
  // 版式：作品名居中 → 细线夹小 LOGO → 缩略图 → 底部左侧 日期·分类 + 右侧二维码
  function buildModelShareCardHtml(work, opts) {
    if (!work) return '';
    opts = opts || {};
    var cover = (opts.thumb || getModelWorkCoverUrl(work));
    var date = fmtDate(work.at);

    var chips = '<span class="swc-chip model">' + escShareText('3D 模型') + '</span>';

    var meta = '';
    if (date) meta += '<span class="swc-date">' + escShareText(date) + '</span>';
    if (work.category) {
      if (date) meta += '<span class="swc-dot">·</span>';
      meta += '<span class="swc-cat">' + escShareText(work.category) + '</span>';
    }

    return '<div class="swc-head">' +
        '<div class="swc-title" title="' + escShareText(work.name || '') + '">' +
          escShareText(work.name || '（未命名模型）') + '</div>' +
        '<div class="swc-rule"><i></i>' +
          '<img class="swc-mark" src="' + escShareText(getModelShareLogoUrl()) + '" alt="今视广告">' +
        '<i></i></div>' +
      '</div>' +
      '<div class="swc-thumb">' +
        (cover ? '<img src="' + escShareText(cover) + '" alt="' + escShareText(work.name || '') +
                 '" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
        chips +
      '</div>' +
      '<div class="swc-foot">' +
        '<div class="swc-foot-left">' +
          '<div class="swc-meta">' + meta + '</div>' +
          '<div class="swc-tag">今视广告 · 3D 模型展馆</div>' +
        '</div>' +
        '<div class="swc-qrbox">' +
          '<div class="swc-qr" id="modelShareQr"></div>' +
          '<div class="swc-qrcap">扫码看 3D 模型</div>' +
        '</div>' +
      '</div>';
  }

  function renderModelShareCard(work, opts) {
    var box = document.getElementById('modelShareWorkCard');
    if (!box) return;
    box.innerHTML = buildModelShareCardHtml(work, opts);
    box.style.display = work ? '' : 'none';
  }

  // ── 缩略图来源（海报用）：调用方截图 > 作品 thumb > null ──
  function loadPosterThumb(work, opts) {
    var src = (opts && opts.thumb) || getModelWorkCoverUrl(work);
    if (!src) return Promise.resolve(null);
    return spLoadImage(src).catch(function () { return null; });
  }


  // 同步预加载（海报内缩略图用，避免 Promise 嵌套）
  function syncLoadImage(src) {
    if (!src) return null;
    var img = new Image();
    img.src = src;
    return img.complete && img.naturalWidth ? img : null;
  }

  // ── 弹层控制 ──
  var currentModel = null;
  var currentOpts = null;
  var currentPoster = null;

  function getModelById(id) {
    return new Promise(function (resolve) {
      if (window.ModelSync && window.ModelSync.getModelEntries) {
        window.ModelSync.getModelEntries().then(function (list) {
          var m = (list || []).find(function (x) { return String(x.id) === String(id); });
          resolve(m || null);
        }).catch(function () { resolve(null); });
      } else { resolve(null); }
    });
  }

  function openModelModal(m, opts) {
    opts = opts || {};
    if (!m) return;
    currentModel = m;
    currentOpts = opts;

    renderModelShareCard(m, opts);

    var base = getModelShareBaseUrl();
    var shareUrl = base + '?model=' + encodeURIComponent(m.id);
    var urlInput = document.getElementById('modelShareUrl');
    if (urlInput) urlInput.value = shareUrl;

    // 仅本机可见提示
    var localOnly = !m.url && m._local;
    var hint = document.getElementById('modelShareHint');
    var lo = document.getElementById('modelShareLocalOnly');
    if (lo) {
      if (localOnly) {
        lo.style.display = '';
        lo.textContent = '⚠ 该作品仅本机可见，分享后他人无法加载（请先在后台发布后再分享）';
      } else { lo.style.display = 'none'; }
    }
    if (hint) hint.style.display = localOnly ? 'none' : '';

    // 二维码（卡片右下角）
    var qrBox = document.getElementById('modelShareQr');
    if (qrBox) {
      qrBox.innerHTML = '';
      try {
        if (typeof QRCode === 'undefined') throw new Error('no qrcode');
        // 出图 280（链接含作品 id，模块紧凑），CSS 缩到 140 显示更清晰
        new QRCode(qrBox, { text: shareUrl, width: 280, height: 280, colorDark: SHARE_INK, colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      } catch (e) {
        qrBox.innerHTML = '<div style="width:140px;height:140px;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:8px;font-size:0.7rem;color:#666">二维码生成失败</div>';
      }
    }

    var ov = document.getElementById('modelShareOverlay');
    if (ov) ov.classList.add('open');
  }

  function openById(id, opts) {
    if (!id) return;
    getModelById(id).then(function (m) {
      if (m) { m.id = id; openModelModal(m, opts); }
      else openModelModal({ id: id, name: '分享的 3D 模型作品', at: Date.now() }, opts);
    });
  }

  function close() {
    var ov = document.getElementById('modelShareOverlay');
    if (ov) ov.classList.remove('open');
  }

  function copyUrl() {
    var input = document.getElementById('modelShareUrl');
    if (!input || !input.value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value)
        .then(function () { toast('链接已复制'); })
        .catch(function () { input.select(); document.execCommand('copy'); toast('链接已复制'); });
    } else {
      input.select(); document.execCommand('copy'); toast('链接已复制');
    }
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    var t = document.getElementById('viewer-toast');
    if (!t) return;
    t.textContent = msg; t.style.opacity = '1';
    setTimeout(function () { t.style.opacity = '0'; }, 1800);
  }

  function generatePoster() {
    if (!currentModel) return Promise.resolve();
    var base = getModelShareBaseUrl();
    var shareUrl = base + '?model=' + encodeURIComponent(currentModel.id);
    // 海报二维码用 spMakeQr（异步），卡片二维码用 new QRCode；这里把生成包装成 Promise
    return new Promise(function (resolve) {
      // 先拿到二维码 canvas，再绘制整张海报
      var qrPromise = (shareUrl && typeof QRCode !== 'undefined')
        ? spMakeQr(shareUrl, 226) : Promise.resolve(null);
      qrPromise.then(function (qrEl) {
        var canvas = drawPosterWithQr(currentModel, shareUrl, currentOpts || {}, qrEl);
        currentPoster = canvas;
        showPosterPreview(canvas);
        resolve(canvas);
      }).catch(function () {
        var canvas = drawPosterWithQr(currentModel, shareUrl, currentOpts || {}, null);
        currentPoster = canvas;
        showPosterPreview(canvas);
        resolve(canvas);
      });
    });
  }

  // 真正的绘制（二维码已就绪传入，避免 Promise 嵌套在 canvas 绘制中途）
  function drawPosterWithQr(work, shareUrl, opts, qrEl) {
    opts = opts || {};
    var W = 750, H = 1334;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var M = 44, CW = W - M * 2;

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7f9fc'); g.addColorStop(0.55, '#f2f5f9'); g.addColorStop(1, '#eaeff6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.5, -160, 40, W * 0.5, -160, 520);
    glow.addColorStop(0, 'rgba(30,136,229,0.16)'); glow.addColorStop(1, 'rgba(30,136,229,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, 520);

    var y = M;
    ctx.save();
    ctx.fillStyle = SHARE_INK; ctx.font = 'bold 44px ' + SHARE_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    y = spWrap(ctx, work.name || '（未命名模型）', W / 2, y + 18, CW, 58, 2);
    ctx.restore();
    y += 6;

    var markH = 30;
    var markW = markH * (620 / 150);
    var syncMark = new Image();
    syncMark.src = getModelShareLogoUrl();
    if (syncMark.complete && syncMark.naturalWidth) { markW = markH * (syncMark.naturalWidth / syncMark.naturalHeight); }
    var markMid = y + markH / 2;
    ctx.save();
    ctx.strokeStyle = SHARE_LINE; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(M + 40, markMid); ctx.lineTo(W / 2 - markW / 2 - 20, markMid);
    ctx.moveTo(W / 2 + markW / 2 + 20, markMid); ctx.lineTo(W - M - 40, markMid);
    ctx.stroke();
    ctx.restore();
    if (syncMark.complete && syncMark.naturalWidth) ctx.drawImage(syncMark, W / 2 - markW / 2, y, markW, markH);
    y += markH + 30;

    var th = Math.round(CW * 9 / 16);
    ctx.save(); spRound(ctx, M, y, CW, th, 24); ctx.clip();
    var thumbImg = syncLoadImage((opts.thumb || getModelWorkCoverUrl(work)));
    if (thumbImg) { ctx.drawImage(thumbImg, M, y, CW, th); }
    else { ctx.fillStyle = 'rgba(30,136,229,0.12)'; ctx.fillRect(M, y, CW, th); }
    ctx.restore();
    spChip(ctx, M + 20, y + 20, '3D 模型', 'rgba(30,136,229,0.94)', '#ffffff', 40);
    y += th + 46;

    y += 46;
    var date = fmtDate(work.at);
    if (date) {
      ctx.save();
      ctx.font = '24px ' + SHARE_FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = SHARE_MUTED;
      ctx.fillText('📅 ' + date, M, y + 23);
      ctx.restore();
    }
    y += 46 + 44;

    if (work.category) {
      spChip(ctx, M, y, work.category, 'rgba(30,136,229,0.12)', SHARE_BRAND_T, 40, { outlined: true });
      y += 40 + 34;
    }

    var qrPlate = 274, qrSize = 226;
    var footBase = H - 44;
    var hintY = footBase - 30;
    var plateY = hintY - 30 - qrPlate;

    ctx.strokeStyle = SHARE_LINE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(M, plateY - 34); ctx.lineTo(M + CW, plateY - 34); ctx.stroke();

    spPlate(ctx, (W - qrPlate) / 2, plateY, qrPlate, qrPlate, 24, 16);
    if (qrEl) {
      try { ctx.drawImage(qrEl, (W - qrSize) / 2, plateY + (qrPlate - qrSize) / 2, qrSize, qrSize); } catch (e) {}
    } else if (shareUrl && typeof QRCode !== 'undefined') {
      try {
        var tmp = document.createElement('div');
        tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(tmp);
        new QRCode(tmp, { text: shareUrl, width: qrSize, height: qrSize, colorDark: SHARE_INK, colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
        var qc = tmp.querySelector('canvas') || tmp.querySelector('img');
        if (qc) ctx.drawImage(qc, (W - qrSize) / 2, plateY + (qrPlate - qrSize) / 2, qrSize, qrSize);
        if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      } catch (e) {}
    }

    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = SHARE_INK2; ctx.font = '24px ' + SHARE_FONT;
    ctx.fillText('长按识别二维码 · 查看 3D 模型作品', W / 2, hintY);
    ctx.fillStyle = SHARE_MUTED; ctx.font = '20px ' + SHARE_FONT;
    ctx.fillText('今视广告线上展馆 · 3D 模型展馆', W / 2, footBase);
    ctx.restore();

    return canvas;
  }

  function showPosterPreview(canvas) {
    close();
    var ov = document.getElementById('modelPosterOverlay');
    var box = document.getElementById('modelPosterPreview');
    if (!ov || !box) return;
    box.innerHTML = '';
    var img = document.createElement('img');
    try { img.src = canvas.toDataURL('image/jpeg', 0.92); }
    catch (e) { canvas.style.maxWidth = '100%'; canvas.style.borderRadius = '12px'; box.appendChild(canvas); ov.classList.add('open'); return; }
    img.style.maxWidth = '100%'; img.style.borderRadius = '12px';
    box.appendChild(img);
    ov.classList.add('open');
  }

  function closePoster() {
    var ov = document.getElementById('modelPosterOverlay');
    if (ov) ov.classList.remove('open');
  }

  function downloadPoster() {
    if (!currentPoster) return;
    try {
      var a = document.createElement('a');
      a.href = currentPoster.toDataURL('image/jpeg', 0.92);
      a.download = '今视广告-3D模型分享海报.jpg';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('下载失败'); }
  }

  function toWechat() {
    toast('正在生成分享海报...');
    generatePoster().then(function () {}).catch(function () { toast('海报生成失败'); });
  }
  function toMoments() { toWechat(); }

  // ── 截图工具：把某个 WebGL canvas 缩成缩略图 dataURL ──
  // 需该 renderer 开启了 preserveDrawingBuffer 才能截到内容
  function captureThumb(srcCanvas, maxW, maxH) {
    try {
      if (!srcCanvas || !srcCanvas.width) return null;
      maxW = maxW || 360; maxH = maxH || 203;
      var c = document.createElement('canvas');
      c.width = maxW; c.height = maxH;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, 0, maxW, maxH);
      ctx.drawImage(srcCanvas, 0, 0, maxW, maxH);
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  // 点击遮罩空白处关闭
  function wireOverlayClose() {
    var so = document.getElementById('modelShareOverlay');
    if (so) so.addEventListener('click', function (e) { if (e.target === so) close(); });
    var po = document.getElementById('modelPosterOverlay');
    if (po) po.addEventListener('click', function (e) { if (e.target === po) closePoster(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireOverlayClose);
  } else { wireOverlayClose(); }

  global.ModelShare = {
    openById: openById,
    open: openModelModal,
    close: close,
    closePoster: closePoster,
    copyUrl: copyUrl,
    toWechat: toWechat,
    toMoments: toMoments,
    downloadPoster: downloadPoster,
    captureThumb: captureThumb,
    renderPoster: generatePoster,
    getShareBaseUrl: getModelShareBaseUrl
  };
})(window);
