# js/lib — 第三方浏览器构建

## openskp.js

浏览器端 SketchUp `.skp` 解析器，用于让「上传 3D 模型」支持 `.skp`。

| 项 | 值 |
|---|---|
| 上游 | [iamahsanmehmood/openskp](https://github.com/iamahsanmehmood/openskp) |
| 版本 | `openskp@1.3.0` |
| 许可 | MIT |
| 本文件 | 用 esbuild 打包成的单文件 ESM（tree-shaking 后约 146KB） |

### 为什么要自己打包

`openskp` 的 `dist/index.mjs` 使用裸模块名引用了 `fflate` / `earcut` / `flatbuffers`，
浏览器无法直接解析。本文件是把这三个依赖一并内联后的自包含构建，因此可以
在无构建步骤的静态站点里直接用 `import()` 加载。

### 打包命令

需要 Node 环境，在任意临时目录执行（产物覆盖到本目录即可）：

```bash
npm install openskp esbuild
cat > entry.js <<'EOF'
export { parseSkp, SkpFile, SkpParseError, buildSceneFromParsed, buildScene, toGLB } from 'openskp';
EOF
npx esbuild entry.js --bundle --format=esm --platform=browser --minify --target=es2020 \
  --outfile=/path/to/3D/js/lib/openskp.js
```

升级版本时，务必用真实的 `.skp` 文件回归一次上传流程。

### 使用方式

`model-viewer.html` 中按需加载，只有用户真的选择 `.skp` 文件时才会下载这个文件：

```js
const openskp = await import('./js/lib/openskp.js');
const skpScene = openskp.buildScene(arrayBuffer, { respectEdgeVisibility: true });
const glb = openskp.toGLB(skpScene, { textures: true });   // Uint8Array
// 再交给 THREE.GLTFLoader().parse() 即可，后续逻辑与普通 glb 完全一致
```

### 已知限制（上游标注）

- 基于逆向工程实现，**与 Trimble / SketchUp 官方无关联**（MIT 许可，可商用）。
- 无法解析的版本：**V3 / V4 / V6 / 2019**，请在 SketchUp 中另存为 2021 及以上版本。
- 该 TypeScript 构建相比 Python / C++ 版本缺少部分能力（松边曲线、旧版 pages/scenes 等），
  对「几何 + 材质 → 渲染」这一用途没有影响。
