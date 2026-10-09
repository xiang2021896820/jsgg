# 今视广告线上展馆

基于 Web3D 技术的产品线上展馆：企业用浏览器就能 360° 展示产品，无需安装插件。

包含两个页面：

- **`index.html`** — 官网首页。首屏为 Three.js 全景球背景（可拖拽转动、自动缓慢旋转），下方是服务、案例、关于、联系等常规区块。
- **`model-viewer.html`** — 3D 模型查看器。支持拖拽上传 **SketchUp `.skp`**、`.gltf` / `.glb` 模型，以及自动旋转、缩放、光照调节、全屏与漫游/飞行模式。

## 目录结构

```
3D/
├── index.html              # 官网首页
├── model-viewer.html       # 3D 模型查看器
├── css/
│   ├── style.css           # 首页样式
│   └── model-viewer.css    # 查看器样式（独立，避免与首页互相影响）
├── js/
│   ├── main.js             # 首页交互 + 3D 场景（含站点配置）
│   ├── three.min.js        # Three.js
│   ├── OrbitControls.js    # 轨道控制器
│   ├── GLTFLoader.js       # glTF / glb 加载器
│   └── lib/
│       └── openskp.js      # SketchUp .skp 解析器（按需加载，见 js/lib/README.md）
├── images/
│   ├── panorama.jpg        # 首屏全景贴图（2048×1024）
│   ├── logo.png / logo.webp
│   └── case-1.svg … case-3.svg   # 案例占位图（请替换为真实案例图）
├── model/
│   └── 33.glb              # 默认演示模型
├── _legacy/                # 改造前的原始文件备份，确认无误后可整个删除
├── deploy-config.json
└── DEPLOYMENT_GUIDE.md
```

## 本地运行

3D 场景与模型加载依赖 HTTP 协议，**直接双击 `index.html` 无法正常工作**（`file://` 下会被浏览器安全策略拦截），请用任意静态服务器启动：

```bash
# 任选其一，在项目根目录执行
python -m http.server 8080
npx serve .
```

然后访问 `http://localhost:8080`。

## 修改站点信息

联系电话、邮箱、表单提交方式集中在 **`js/main.js` 顶部的 `SITE` 对象**里，改这一处即可，页面上所有带 `data-site` 标记的位置会自动同步：

```js
var SITE = {
    phone: '400-123-4567',
    email: 'info@3dconnecter.cn',
    formEndpoint: ''   // 留空 = 通过邮件客户端发送；填入接口地址 = 异步提交
};
```

## 关于模型格式

查看器支持 **`.skp` / `.gltf` / `.glb`** 三种格式，上传入口已与实现保持一致。

**`.gltf` / `.glb`** 由 Three.js 官方的 `GLTFLoader` 直接加载。

**`.skp`（SketchUp）** 是闭源专有二进制格式，浏览器无法原生解析，three.js 也没有对应的 Loader。
这里的做法是用开源库 [OpenSKP](https://github.com/iamahsanmehmood/openskp)（MIT 协议）
**在浏览器本地**把 `.skp` 解析并转成 GLB，再交给 `GLTFLoader` —— 因此后续的优化、光照、
取景与交互逻辑与 glb 完全一致，**文件不会上传到任何服务器**。

### .skp 的已知限制

- OpenSKP 基于逆向工程实现，与 Trimble / SketchUp 官方无关（MIT 许可，可商用）。
- **无法解析的版本：V3 / V4 / V6 / 2019。** 遇到这些版本时页面会给出明确提示，
  建议在 SketchUp 中另存为 **2021 及以上版本**，或直接导出 `.glb` 后上传。
- 空模型（无可见几何体）会提示"这个文件里没有可显示的几何体"。
- 解析失败的**不会清空当前正在查看的模型**，只会提示错误。

### 为什么不支持 `.obj` / `.fbx` / `.stl`

这三个格式本身可以支持，但需要额外引入 `OBJLoader` / `FBXLoader` / `STLLoader`。
在没有确认需求前，界面上不会宣称支持它们——早先版本曾声称支持 6 种格式而实际全部被拒。

## 部署

静态站点，任意静态托管均可（Nginx / Apache / GitHub Pages / Netlify / Vercel）。详细步骤见 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)。

部署时需要保证服务器为 `.glb` 返回正确的 MIME 类型（`model/gltf-binary` 或 `application/octet-stream`）。

## 技术栈

- 原生 HTML5 / CSS3 / JavaScript（无构建步骤）
- Three.js（UMD 全局构建） + OrbitControls + GLTFLoader
- OpenSKP（MIT）—— 浏览器端 SketchUp `.skp` 解析，已打包为 `js/lib/openskp.js` 按需加载

## 本次改造说明

- **性能**：首屏全景贴图由 8192×4096 / 18.09MB 压缩为 2048×1024 / 0.51MB；移除未使用的 603KB `three.module.js`；脚本改为 `defer` 加载，3D 场景在首屏渲染完成后再初始化，页面不可见时自动暂停渲染。
- **清理**：移除伪造的 `gsap.min.js`（607 字节的假实现）与 `GLTFLoader-simple.js`（返回空场景）、测试脚本 `test-three.js`、调试脚本 `deployment-check.js`、未引用的 `earth-texture.svg`，以及 `model-viewer.html` 中重复定义两次的 `fitModelToScreen()`。
- **修复**：模型加载进度回调此前被挂到 `loader.onProgress`，而 `load()` 的第三个参数传的是 `undefined`，导致进度条永远不动；`localStorage` 中残留的失效 `blob:` 链接会导致下次打开查看器时模型加载失败。
- **功能**：联系表单补上校验与提交反馈；导航加入平滑滚动、当前区块高亮与移动端菜单；案例图懒加载；无 WebGL 时自动降级为静态背景。
- **新增 `.skp` 支持**：接入 OpenSKP，在浏览器本地把 SketchUp 文件转成 GLB 后复用既有加载链路；解析器 146KB 按需加载，不影响首屏体积。同时修正了「加载失败会把当前模型清空」的问题。
- **修复「上传后什么都没有」**（重要）：查看器里那套 LOD 实现会在加载大模型时**把模型整个清空**。
  两个原因叠加：`lod.addLevel(child)` 已经把原网格移进 LOD，代码随后又拿 `child.parent` 当"原父节点"用，
  实际执行成 `lod.add(lod)` 抛异常，原网格再也回不到场景；而 `simplifyGeometry()` 又是随机丢弃顶点
  却不更新索引缓冲区，几何本身就是损坏的。
  它只在 `modelComplexity.isComplex`（>10 万三角面或 >500 网格）时触发，所以**只有真实的大模型会踩中**。
  现在已移除这套伪 LOD / 伪简化（`applyLODToModel`、`simplifyGeometry` 保留为空实现以防误调用）。
- **SketchUp 几何改为双面渲染**：OpenSKP 导出的材质不带 `doubleSided`，按 glTF 规范默认即关闭，
  而 SketchUp 的面是单面的——从背面看会整块被剔除（例如进入室内时看不到墙）。仅对 `.skp` 生效。
