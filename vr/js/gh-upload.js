// gh-upload.js —— 把全景/编辑器上传的图片直接提交到 GitHub 仓库
// 不再使用第三方图床（imgbb），改为同源 GitHub Pages 加载，更快更可控。
// 令牌只来自管理员在「系统设置」里粘贴的值（存本机 localStorage），绝不内置写死在源码里——
// 公开仓库里的令牌会被 GitHub 密钥扫描自动吊销（实测一次，上传与 git push 双双失效）。
(function (global) {
  'use strict';

  // ⚠️ 仓库信息（与部署仓库一致）。如需换仓库，改这里即可。
  var GH_OWNER = 'xiang2021896820';
  var GH_REPO = 'jsgg';
  var GH_BRANCH = 'main';
  var GH_PATH = 'vr/uploads'; // 仓库内相对路径；线上地址 = https://<owner>.github.io/<repo>/vr/uploads/<name>

  var TOKEN_KEY = 'jsgg_gh_token';

  function getToken() {
    try {
      var t = localStorage.getItem(TOKEN_KEY);
      if (t && t.trim()) return t.trim();
    } catch (e) {}
    // 未配置 → 返回 null，由调用方提示「请到系统设置粘贴 GitHub 上传令牌」。
    // 绝不内置写死令牌：公开仓库里的令牌会被 GitHub 自动吊销。
    return null;
  }
  function setToken(t) {
    try {
      if (t && t.trim()) localStorage.setItem(TOKEN_KEY, t.trim());
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }
  function isConfigured() { return !!getToken(); }

  // 上传单个文件到仓库指定路径；返回 { url, thumb, medium, displayUrl, rawUrl }
  // targetPath 省略时落到默认 GH_PATH（全景图：vr/uploads）；3D 模型传 'model'。
  function uploadToPath(file, targetPath, onProgress) {
    return new Promise(function (resolve, reject) {
      var token = getToken();
      if (!token) {
        reject(new Error('请先在「系统设置 → GitHub 上传令牌」中粘贴你的 GitHub 令牌'));
        return;
      }
      var safe = (file.name || 'file').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
      var name = Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + safe;
      var path = (targetPath || GH_PATH) + '/' + name;

      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.onload = function () {
        var b64 = (reader.result || '').split(',')[1] || '';
        if (!b64) { reject(new Error('文件内容为空')); return; }
        var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + encodeURI(path);
        var body = JSON.stringify({ message: 'upload ' + name, content: b64, branch: GH_BRANCH });

        var xhr = new XMLHttpRequest();
        xhr.open('PUT', apiUrl);
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Accept', 'application/vnd.github+json');
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = function () {
          try {
            var resp = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && resp.content) {
              var rawUrl = resp.content.download_url;
              // 模型文件可能较大，download_url 走 raw.githubusercontent.com（带 CORS:*）；
              // 同时给出 pages 地址（兜底）。两处都可直接用 <model> 加载。
              var pagesUrl = 'https://' + GH_OWNER + '.github.io/' + GH_REPO + '/' + path;
              resolve({ url: pagesUrl, rawUrl: rawUrl, thumb: pagesUrl, medium: pagesUrl, displayUrl: pagesUrl });
            } else {
              var msg = resp.message || ('上传失败 (' + xhr.status + ')');
              if (xhr.status === 401) msg = 'GitHub 令牌无效或无权限（请用「仅限 jsgg 仓库、Contents 读写」的细粒度令牌）';
              else if (xhr.status === 403) msg = '令牌权限不足或触发限流，请检查令牌范围';
              else if (xhr.status === 422) msg = '提交被拒：文件可能过大（GitHub 单文件建议控制在 100MB 内，推荐 < 25MB）或路径冲突';
              reject(new Error(msg));
            }
          } catch (e) { reject(new Error('服务器返回格式错误')); }
        };
        xhr.onerror = function () { reject(new Error('网络错误：无法连接 GitHub')); };
        xhr.ontimeout = function () { reject(new Error('上传超时')); };
        xhr.timeout = 300000;
        xhr.send(body);
      };
      reader.readAsDataURL(file);
    });
  }

  // 全景图默认走 vr/uploads
  function upload(file, onProgress) {
    return uploadToPath(file, GH_PATH, onProgress);
  }

  global.GHUpload = {
    GH_OWNER: GH_OWNER, GH_REPO: GH_REPO, GH_BRANCH: GH_BRANCH, GH_PATH: GH_PATH,
    getToken: getToken, setToken: setToken, isConfigured: isConfigured,
    upload: upload, uploadToPath: uploadToPath
  };
})(window);
