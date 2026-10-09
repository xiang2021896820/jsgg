/*!
 * ZFight —— 面重叠闪烁（z-fighting）治理
 *
 * 「模型的面在闪」只有两种根因，先分清楚再动手：
 *
 *   A. 两个面处在**完全相同**的位置 —— 模型自带的地坪正好压在场景地面上、
 *      同一块板的正反两片、SketchUp 里重复粘贴的构件……
 *      两者深度值逐像素打平，谁先谁后全看光栅化顺序，于是整片闪。
 *      这种情况**调相机参数没用**（间距是 0，再高的精度也分不开）。
 *
 *   B. 相机近/远平面跨度太大，24 位深度缓冲在模型处已经分不清 0.1mm。
 *      收紧 near / far 即可（各页面在自己的 fitToView 里做）。
 *
 * A 又要分两种，处理方式完全不同：
 *
 *   A1. **同一个网格内**位置完全重合的三角形。
 *       SketchUp 的「一块板」如果被导成正反两片，就会这样 —— 两片同材质、
 *       同深度，polygonOffset 是材质属性、分不开它们。但只要材质是双面渲染
 *       （side = DoubleSide），两片里**任意留一片视觉完全一致** →
 *       直接合并掉多余的索引（mergeSameMesh），这是唯一有效的解法。
 *
 *   A2. **不同网格之间**位置完全重合。
 *       按材质做深度错层（polygonOffset 逐层递增）即可。
 *
 * 纯逻辑、不碰 DOM、不弹提示，由调用方决定怎么反馈给用户。
 */
(function (global) {
    'use strict';

    var QUANT = 10000;        // 位置量化精度 1/10000 m = 0.1mm
    var MAX_TRIS = 1200000;   // 三角形总数超过这个值就跳过体检，避免卡住加载
    // 层数上限。polygonOffsetUnits 的单位是「最小可分辨深度差」（约 1 个深度最低位），
    // 几十个单位的偏移在画面上是亚像素级的，肉眼看不见；真正影响观感的是
    // polygonOffsetFactor（按面的斜率放大偏移），所以这里只放开层数、factor 固定为 1。
    // 上限存在的意义只是别让千百个构件各占一层导致数字失控。
    var MAX_LAYER = 32;

    var activeMaterials = new Set();  // 参与重叠的材质 uuid
    var lastReport = null;
    var enabled = true;

    // 三角形去重键：三个顶点的量化坐标排序后拼接。
    // 顶点顺序不同的同一个三角形会得到同一个键 —— 这里只要求「一致」，不要求字典序正确。
    function triangleKey(pos, ia, ib, ic) {
        var q = QUANT;
        var v = [
            Math.round(pos[ia * 3] * q) + ',' + Math.round(pos[ia * 3 + 1] * q) + ',' + Math.round(pos[ia * 3 + 2] * q),
            Math.round(pos[ib * 3] * q) + ',' + Math.round(pos[ib * 3 + 1] * q) + ',' + Math.round(pos[ib * 3 + 2] * q),
            Math.round(pos[ic * 3] * q) + ',' + Math.round(pos[ic * 3 + 1] * q) + ',' + Math.round(pos[ic * 3 + 2] * q)
        ];
        v.sort();
        return v[0] + '|' + v[1] + '|' + v[2];
    }

    function isDrawableMesh(o) {
        return !!(o && o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position);
    }

    // 几何体检：找出位置完全重合的三角形，并区分「同网格内」与「跨网格」。
    // 只做一遍全遍历（O(三角形数)），几万面的模型在几十毫秒内完成。
    function audit(root) {
        var report = {
            meshes: 0, triangles: 0, skipped: false,
            sameMesh: 0,           // 同网格内重复的三角形数（A1，靠合并解决）
            overlapping: 0,        // 跨网格重合的三角形数（A2，靠错层解决）
            meshCount: 0,          // 涉及跨网格重合的网格数
            materialUuids: [],
            transparentMaterials: 0,
            layered: 0, merged: 0
        };
        if (!root || !root.traverse) return report;

        var meshList = [];
        var triTotal = 0;
        root.traverse(function (o) {
            if (!isDrawableMesh(o)) return;
            meshList.push(o);
            var g = o.geometry;
            triTotal += Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
        });
        report.meshes = meshList.length;
        report.triangles = triTotal;

        if (!meshList.length) return report;
        if (triTotal > MAX_TRIS) { report.skipped = true; return report; }

        // 透明/半透明材质单独报一下：它们互相穿插时的「闪」是排序问题，不是深度冲突，
        // 本模块的错层对它们无效，得让用户知道方向不同。
        var transparentSeen = new Set();
        meshList.forEach(function (mesh) {
            var mm = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mm.forEach(function (m) {
                if (m && m.transparent && !transparentSeen.has(m.uuid)) {
                    transparentSeen.add(m.uuid);
                }
            });
        });
        report.transparentMaterials = transparentSeen.size;

        var firstSeen = new Map();   // 三角形键 -> 首次出现的网格序号
        var crossMesh = new Set();

        for (var mi = 0; mi < meshList.length; mi++) {
            var geo = meshList[mi].geometry;
            var pos = geo.attributes.position.array;
            var idx = geo.index ? geo.index.array : null;
            var count = idx ? idx.length : geo.attributes.position.count;

            for (var t = 0; t + 2 < count; t += 3) {
                var ia = idx ? idx[t] : t;
                var ib = idx ? idx[t + 1] : t + 1;
                var ic = idx ? idx[t + 2] : t + 2;
                var key = triangleKey(pos, ia, ib, ic);
                var first = firstSeen.get(key);

                if (first === undefined) {
                    firstSeen.set(key, mi);
                } else if (first !== mi) {
                    // 同一个三角形位置落在两个网格里 → 这两片必定互相闪，靠错层分开
                    crossMesh.add(first);
                    crossMesh.add(mi);
                    report.overlapping++;
                } else {
                    // 同一个网格里出现两次 → 就是 A1（正反两片 / 重复导出），靠合并删掉
                    report.sameMesh++;
                }
            }
        }

        report.meshCount = crossMesh.size;

        var seenMat = new Set();
        crossMesh.forEach(function (mi) {
            var m = meshList[mi].material;
            (Array.isArray(m) ? m : [m]).forEach(function (material) {
                if (!material || seenMat.has(material.uuid)) return;
                seenMat.add(material.uuid);
                report.materialUuids.push(material.uuid);
            });
        });

        return report;
    }

    // 合并同一网格内位置完全重合的三角形：只保留第一个，其余从索引里去掉。
    //
    // ⚠ 只对**双面渲染**的网格动手（side === DoubleSide）。单面渲染时两片里有一片是
    //   背朝相机的，删掉它会让面消失。调用方要保证材质已经设为双面（.skp 路径会）。
    function mergeSameMesh(root, restrictToMesh) {
        if (!root || !root.traverse) return 0;

        var removedTotal = 0;

        root.traverse(function (mesh) {
            if (!isDrawableMesh(mesh)) return;
            if (restrictToMesh && mesh !== restrictToMesh) return;

            var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            var allDoubleSided = mats.every(function (m) {
                return m && m.side === 2;   // THREE.DoubleSide === 2
            });
            if (!allDoubleSided) return;

            var geo = mesh.geometry;
            var posAttr = geo.attributes.position;
            var pos = posAttr.array;
            var indexAttr = geo.index;
            var count = indexAttr ? indexAttr.count : posAttr.count;
            var src = indexAttr ? indexAttr.array : null;

            var seen = new Set();
            var kept = [];
            var removed = 0;

            for (var t = 0; t + 2 < count; t += 3) {
                var ia = src ? src[t] : t;
                var ib = src ? src[t + 1] : t + 1;
                var ic = src ? src[t + 2] : t + 2;

                if (ia >= posAttr.count || ib >= posAttr.count || ic >= posAttr.count) continue;

                var key = triangleKey(pos, ia, ib, ic);
                if (seen.has(key)) { removed++; continue; }
                seen.add(key);
                kept.push(ia, ib, ic);
            }

            if (!removed) return;

            geo.setIndex(kept);            // three.js 会按最大索引自动选 Uint16 / Uint32
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            removedTotal += removed;
        });

        return removedTotal;
    }

    // 深度错层：给参与重叠的材质各让开一点点深度（每层 1 个深度单位，肉眼不可见）。
    // 只动这些材质，其余材质保持原样 —— 避免把整个模型推得出现穿透。
    function apply(root, wantEnabled) {
        if (!root || !root.traverse) return 0;

        var layer = 0;
        var touched = new Set();

        root.traverse(function (o) {
            if (!o.isMesh) return;
            var mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(function (m) {
                if (!m || touched.has(m.uuid)) return;
                touched.add(m.uuid);

                if (wantEnabled && activeMaterials.has(m.uuid)) {
                    // 从 1 个单位起步：0 个单位时只剩 factor 在起作用，
                    // 而水平面（深度斜率接近 0）几乎得不到偏移 → 仍可能共面。
                    m.polygonOffset = true;
                    m.polygonOffsetFactor = 1;
                    m.polygonOffsetUnits = Math.min(layer + 1, MAX_LAYER);
                    layer++;
                    m.needsUpdate = true;
                } else if (m.polygonOffset) {
                    m.polygonOffset = false;
                    m.polygonOffsetFactor = 0;
                    m.polygonOffsetUnits = 0;
                    m.needsUpdate = true;
                }
            });
        });

        return layer;
    }

    // 加载完模型后调用：体检 → 合并（可选）→ 错层，返回体检报告。
    // options.mergeSameMesh: 是否合并同网格内的重合面（.skp 强制双面后才可开）
    function run(root, wantEnabled, options) {
        if (wantEnabled !== undefined) enabled = !!wantEnabled;
        var opts = options || {};

        lastReport = audit(root);
        activeMaterials = new Set(lastReport.materialUuids);

        if (opts.mergeSameMesh && !lastReport.skipped) {
            lastReport.merged = mergeSameMesh(root);
        }
        lastReport.layered = apply(root, enabled);

        if (global.console && global.console.log) {
            console.log('[消闪] 网格 ' + lastReport.meshes + ' 个 / 三角形 ' + lastReport.triangles +
                ' 个；重合面 —— 同网格 ' + lastReport.sameMesh + ' 个（已合并 ' + lastReport.merged +
                ' 个）、跨网格 ' + lastReport.overlapping + ' 个（涉及 ' + lastReport.meshCount +
                ' 个构件，已错层 ' + lastReport.layered + ' 个材质）；透明材质 ' +
                lastReport.transparentMaterials + ' 个' +
                (lastReport.skipped ? '（面数过多，已跳过体检）' : ''));
        }
        return lastReport;
    }

    function setEnabled(root, want) {
        enabled = !!want;
        return apply(root, enabled);
    }

    global.ZFight = {
        QUANT: QUANT,
        MAX_TRIS: MAX_TRIS,
        MAX_LAYER: MAX_LAYER,
        triangleKey: triangleKey,
        audit: audit,
        mergeSameMesh: mergeSameMesh,
        apply: apply,
        run: run,
        setEnabled: setEnabled,
        isEnabled: function () { return enabled; },
        materials: function () { return activeMaterials; },
        report: function () { return lastReport; }
    };
})(typeof window !== 'undefined' ? window : globalThis);
