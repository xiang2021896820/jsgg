// ============================================================
//  打开方式守卫 (serve-check.js)
//  用 file:// 直接双击打开本地 html 时，浏览器会拦掉 XHR / fetch，
//  模型文件与清单一律读不到 —— 3D 显示不出来，但很容易被误判成「功能坏了」。
//  这里在页面顶部直接给出可点击的 http 地址，并把该说的话说到位。
//  （http 下本脚本什么都不做，零开销。）
// ============================================================
(function () {
  'use strict';
  if (location.protocol !== 'file:') return;

  var PORT = 8123;

  function pageName() {
    var parts = location.pathname.split('/');
    var last = parts[parts.length - 1] || 'index.html';
    return last + (location.search || '') + (location.hash || '');
  }

  var httpUrl = 'http://127.0.0.1:' + PORT + '/' + pageName();

  function mount() {
    if (!document.body || document.getElementById('serve-check-bar')) return;

    var bar = document.createElement('div');
    bar.id = 'serve-check-bar';
    bar.setAttribute('role', 'alert');
    bar.style.cssText = [
      'position:relative',
      'z-index:9999',
      'padding:13px 18px',
      'background:#fff4e5',
      'border-bottom:1px solid #ffd8a8',
      'color:#7a4a00',
      'font:14px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif'
    ].join(';');

    var head = document.createElement('div');
    head.innerHTML = '<strong>当前是用 file:// 双击打开本地文件的，浏览器会拦截模型文件读取，' +
      '3D 与模型清单都加载不出来（不是功能坏了）。</strong>';

    var line = document.createElement('div');
    line.style.marginTop = '6px';
    line.appendChild(document.createTextNode('请改用本地服务器打开：'));

    var link = document.createElement('a');
    link.href = httpUrl;
    link.textContent = httpUrl;
    link.style.cssText = 'display:inline-block;margin:0 6px;padding:3px 12px;' +
      'background:#1e88e5;color:#fff;border-radius:6px;text-decoration:none';
    line.appendChild(link);

    var hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;color:#8a6a3a';
    hint.innerHTML = '若点开打不开，说明本地服务器没启动。在项目目录执行：' +
      '<code style="background:#fff;padding:1px 6px;border-radius:4px">' +
      'python -m http.server ' + PORT + '</code>' +
      '（本机用托管解释器路径亦可）';

    bar.appendChild(head);
    bar.appendChild(line);
    bar.appendChild(hint);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
