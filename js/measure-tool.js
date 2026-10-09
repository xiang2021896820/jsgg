// ============================================================
//  测量工具 · 纯逻辑模块 (measure-tool.js)
//  - 不依赖 THREE / DOM：可以在 Node 下真跑压测
//  - 这里只负责「算」：单位换算与格式化、吸附点空间索引、测量记录集合
//  - 「画」的部分（three 线段 + DOM 标注）在 model-viewer.html 里
//
//  ★ 关于单位：场景坐标的单位是「米」。
//    SketchUp 的 GLTF 导出器会在根节点写一个 1/39.37 = 0.0254 的缩放矩阵
//    （英寸 → 米，glTF 规范要求米），实测 model/33.glb 就是这个值，
//    所以遍历时套上 matrixWorld 之后，1 个场景单位 = 1 米。
//    模型单位允许用户手动更正，改正后所有测量值会重算。
// ============================================================
(function (root) {
    'use strict';

    // 1 个「模型单位」等于多少毫米
    var UNIT_TO_MM = { mm: 1, cm: 10, m: 1000 };
    // 各显示单位保留的小数位（组合起来足以表达 0.1mm 的精度）
    var DISPLAY_DIGITS = { mm: 1, cm: 2, m: 3 };

    function normalizeUnit(u) {
        u = String(u == null ? '' : u).toLowerCase();
        return Object.prototype.hasOwnProperty.call(UNIT_TO_MM, u) ? u : 'mm';
    }

    function unitToMm(u) { return UNIT_TO_MM[normalizeUnit(u)]; }

    // 去掉小数末尾多余的 0。
    // ⚠ 只在含小数点时动手 —— 否则 "100" 会被削成 "1"。
    function trimZeros(s) {
        if (s.indexOf('.') < 0) return s;
        s = s.replace(/0+$/, '');
        if (s.charAt(s.length - 1) === '.') s = s.slice(0, -1);
        return s;
    }

    // 把「毫米值」按指定显示单位格式化，例如 1250 → "1250 mm" / "125 cm" / "1.25 m"
    function formatLength(mm, unit) {
        unit = normalizeUnit(unit);
        var v = (Number(mm) || 0) / UNIT_TO_MM[unit];
        var s = trimZeros(v.toFixed(DISPLAY_DIGITS[unit]));
        if (s === '-0') s = '0';
        return s + ' ' + unit;
    }

    // 按模型包围盒最长边猜「模型单位」。
    // 上千个单位长的事物基本不可能是米（那是 1km 级），按毫米处理；
    // 其余按米 —— SketchUp 的 GLTF 导出统一是米，这也是本项目模型的实际来源。
    function guessModelUnit(maxDim) {
        var d = Number(maxDim) || 0;
        return d >= 1000 ? 'mm' : 'm';
    }

    function distance3(a, b) {
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    function midpoint3(a, b) {
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    }

    // ---------------- 吸附点空间索引（均匀网格 + 邻域查询） ----------------
    // 顶点动辄十几万个，不能用「遍历全部点算最近」的写法，所以铺一层均匀网格：
    // 查询时只看目标格周围 r 圈（r = ceil(半径/格宽)），复杂度与点数无关。
    // 网格同时兼职去重：同一格内已有极近的点就不再重复占坑。
    function createIndex(opts) {
        opts = opts || {};
        var cell = opts.cell > 0 ? opts.cell : 0.05;
        var maxPoints = opts.maxPoints > 0 ? opts.maxPoints : 250000;
        var grid = new Map();
        var xs = [], ys = [], zs = [], kinds = [];
        var n = 0;
        var tol2 = (cell * 0.25) * (cell * 0.25);

        function cellOf(v) { return Math.floor(v / cell); }
        function keyOf(ix, iy, iz) { return ix + '|' + iy + '|' + iz; }

        // kind: 'v' 顶点 / 'e' 边中点
        function add(x, y, z, kind) {
            if (n >= maxPoints) return false;
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
            var ix = cellOf(x), iy = cellOf(y), iz = cellOf(z);
            var k = keyOf(ix, iy, iz);
            var bucket = grid.get(k);
            if (!bucket) {
                bucket = [];
                grid.set(k, bucket);
            } else {
                for (var i = 0; i < bucket.length; i++) {
                    var j = bucket[i];
                    var dx = xs[j] - x, dy = ys[j] - y, dz = zs[j] - z;
                    if (dx * dx + dy * dy + dz * dz <= tol2) {
                        // 重复点。顶点比边中点更值得吸附，遇到就升级。
                        if (kind === 'v' && kinds[j] === 'e') kinds[j] = 'v';
                        return false;
                    }
                }
            }
            xs.push(x); ys.push(y); zs.push(z);
            kinds.push(kind === 'v' ? 'v' : 'e');
            bucket.push(n);
            n++;
            return true;
        }

        function nearest(x, y, z, maxDist) {
            if (n === 0) return null;
            var d = Number(maxDist);
            if (!(d > 0)) return null;
            var r = Math.ceil(d / cell);
            var cx = cellOf(x), cy = cellOf(y), cz = cellOf(z);
            var best = -1, bestD2 = d * d;
            for (var ax = -r; ax <= r; ax++) {
                for (var ay = -r; ay <= r; ay++) {
                    for (var az = -r; az <= r; az++) {
                        var bucket = grid.get(keyOf(cx + ax, cy + ay, cz + az));
                        if (!bucket) continue;
                        for (var i = 0; i < bucket.length; i++) {
                            var j = bucket[i];
                            var dx = xs[j] - x, dy = ys[j] - y, dz = zs[j] - z;
                            var dd = dx * dx + dy * dy + dz * dz;
                            if (dd <= bestD2) { bestD2 = dd; best = j; }
                        }
                    }
                }
            }
            if (best < 0) return null;
            return {
                x: xs[best], y: ys[best], z: zs[best],
                kind: kinds[best],
                dist: Math.sqrt(bestD2)
            };
        }

        return {
            add: add,
            nearest: nearest,
            size: function () { return n; },
            cell: function () { return cell; },
            clear: function () {
                grid.clear();
                xs = []; ys = []; zs = []; kinds = [];
                n = 0;
            }
        };
    }

    // ---------------- 测量记录集合 ----------------
    function createStore() {
        var recs = [];
        var seq = 0;
        var displayUnit = 'mm';   // 用户要求：默认毫米
        var modelUnit = 'm';

        function recompute(r) {
            r.mm = distance3(r.a, r.b) * UNIT_TO_MM[modelUnit];
            r.text = formatLength(r.mm, displayUnit);
            return r;
        }

        function add(a, b) {
            var r = {
                id: 'm' + (++seq),
                a: { x: a.x, y: a.y, z: a.z, kind: a.kind || 'free' },
                b: { x: b.x, y: b.y, z: b.z, kind: b.kind || 'free' },
                hidden: false,
                mm: 0,
                text: ''
            };
            recompute(r);
            recs.push(r);
            return r;
        }

        function indexOfId(id) {
            for (var i = 0; i < recs.length; i++) {
                if (recs[i].id === id) return i;
            }
            return -1;
        }

        return {
            add: add,
            list: function () { return recs; },
            get: function (id) {
                var i = indexOfId(id);
                return i < 0 ? null : recs[i];
            },
            remove: function (id) {
                var i = indexOfId(id);
                if (i < 0) return null;
                return recs.splice(i, 1)[0];
            },
            setHidden: function (id, h) {
                var r = this.get(id);
                if (!r) return null;
                r.hidden = !!h;
                return r;
            },
            allHidden: function (h) {
                var want = !!h;
                for (var i = 0; i < recs.length; i++) recs[i].hidden = want;
                return want;
            },
            isAllHidden: function () {
                if (!recs.length) return false;
                for (var i = 0; i < recs.length; i++) {
                    if (!recs[i].hidden) return false;
                }
                return true;
            },
            count: function () { return recs.length; },
            visibleCount: function () {
                var c = 0;
                for (var i = 0; i < recs.length; i++) if (!recs[i].hidden) c++;
                return c;
            },
            clear: function () {
                var n = recs.length;
                recs = [];
                return n;
            },
            displayUnit: function () { return displayUnit; },
            modelUnit: function () { return modelUnit; },
            setDisplayUnit: function (u) {
                displayUnit = normalizeUnit(u);
                for (var i = 0; i < recs.length; i++) recompute(recs[i]);
                return displayUnit;
            },
            setModelUnit: function (u) {
                modelUnit = normalizeUnit(u);
                for (var i = 0; i < recs.length; i++) recompute(recs[i]);
                return modelUnit;
            },
            recomputeAll: function () {
                for (var i = 0; i < recs.length; i++) recompute(recs[i]);
            }
        };
    }

    root.MeasureTool = {
        VERSION: '1.0.0',
        UNIT_TO_MM: UNIT_TO_MM,
        DISPLAY_DIGITS: DISPLAY_DIGITS,
        normalizeUnit: normalizeUnit,
        unitToMm: unitToMm,
        trimZeros: trimZeros,
        formatLength: formatLength,
        guessModelUnit: guessModelUnit,
        distance3: distance3,
        midpoint3: midpoint3,
        createIndex: createIndex,
        createStore: createStore
    };
})(typeof window !== 'undefined' ? window : globalThis);
