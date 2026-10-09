/* ==========================================================================
   今视广告线上展馆 — 主脚本
   说明：
   1) 全站交互（导航 / 滚动 / 表单 / 动效）均为原生实现，不依赖任何伪造库。
   2) 3D 场景按需初始化，并带加载态、WebGL 降级与页面不可见时暂停渲染。
   ========================================================================== */

(function () {
    'use strict';

    /* ----------------------------------------------------------------------
       站点配置：联系方式统一在这里维护，页面中带 data-site 的元素会自动填充。
       拿到正式资料后，只需修改这里的 phone / email 两个字段。
       ---------------------------------------------------------------------- */
    var SITE = {
        phone: '150-2550-5147',
        email: '2021896820@qq.com',
        // 若后续接入表单服务（如 Formspree、自建接口），填写 URL 即可改为异步提交；
        // 留空时表单会通过邮件客户端发送。
        formEndpoint: ''
    };

    var prefersReducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ============================ 通用交互 ============================ */

    function applySiteConfig() {
        var phoneLinks = document.querySelectorAll('[data-site="phone"]');
        var emailLinks = document.querySelectorAll('[data-site="email"]');

        Array.prototype.forEach.call(phoneLinks, function (el) {
            el.textContent = SITE.phone;
            if (el.tagName === 'A') {
                el.setAttribute('href', 'tel:' + SITE.phone.replace(/[^\d+]/g, ''));
            }
        });

        Array.prototype.forEach.call(emailLinks, function (el) {
            el.textContent = SITE.email;
            if (el.tagName === 'A') {
                el.setAttribute('href', 'mailto:' + SITE.email);
            }
        });

        var yearEl = document.getElementById('year');
        if (yearEl) {
            yearEl.textContent = String(new Date().getFullYear());
        }
    }

    function initHeader() {
        var header = document.getElementById('siteHeader');
        if (!header) return;

        var ticking = false;

        function update() {
            header.classList.toggle('is-scrolled', window.scrollY > 8);
            ticking = false;
        }

        window.addEventListener('scroll', function () {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(update);
            }
        }, { passive: true });

        update();
    }

    function initNav() {
        var toggle = document.getElementById('navToggle');
        var nav = document.getElementById('primaryNav');
        if (!toggle || !nav) return;

        function setOpen(open) {
            nav.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
        }

        toggle.addEventListener('click', function () {
            setOpen(!nav.classList.contains('is-open'));
        });

        // 点击导航项后收起移动端菜单
        nav.addEventListener('click', function (event) {
            if (event.target.closest('a')) setOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && nav.classList.contains('is-open')) {
                setOpen(false);
                toggle.focus();
            }
        });

        // 视口变宽后重置菜单状态，避免残留
        window.addEventListener('resize', function () {
            if (window.innerWidth > 860) setOpen(false);
        });

        // 点击页面空白处收起
        document.addEventListener('click', function (event) {
            if (!nav.classList.contains('is-open')) return;
            if (nav.contains(event.target) || toggle.contains(event.target)) return;
            setOpen(false);
        });
    }

    function initActiveNav() {
        var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
        if (!links.length || !('IntersectionObserver' in window)) return;

        var map = {};
        var sections = [];

        links.forEach(function (link) {
            var id = (link.getAttribute('href') || '').replace('#', '');
            var section = id && document.getElementById(id);
            if (section) {
                map[id] = link;
                sections.push(section);
            }
        });

        var visible = {};

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                visible[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
            });

            var bestId = null;
            var bestRatio = 0;
            Object.keys(visible).forEach(function (id) {
                if (visible[id] > bestRatio) {
                    bestRatio = visible[id];
                    bestId = id;
                }
            });

            links.forEach(function (link) {
                link.classList.toggle('is-active', bestId !== null && map[bestId] === link);
            });
        }, {
            rootMargin: '-45% 0px -45% 0px',
            threshold: [0, 0.25, 0.5, 0.75, 1]
        });

        sections.forEach(function (section) {
            observer.observe(section);
        });
    }

    function initReveal() {
        var items = document.querySelectorAll('.reveal');
        if (!items.length) return;

        if (prefersReducedMotion || !('IntersectionObserver' in window)) {
            Array.prototype.forEach.call(items, function (el) {
                el.classList.add('is-visible');
            });
            return;
        }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

        Array.prototype.forEach.call(items, function (el) {
            observer.observe(el);
        });
    }

    function initContactForm() {
        var form = document.getElementById('contactForm');
        if (!form) return;

        var statusEl = document.getElementById('formStatus');
        var submitBtn = form.querySelector('button[type="submit"]');

        function setStatus(message, type) {
            if (!statusEl) return;
            statusEl.textContent = message || '';
            statusEl.classList.remove('is-success', 'is-error');
            if (type) statusEl.classList.add('is-' + type);
        }

        function markError(input, hasError) {
            var field = input.closest('.field');
            if (field) field.classList.toggle('has-error', hasError);
        }

        function validate() {
            var nameInput = form.elements.name;
            var contactInput = form.elements.contact;
            var messageInput = form.elements.message;
            var firstInvalid = null;

            if (!nameInput.value.trim()) {
                markError(nameInput, true);
                firstInvalid = firstInvalid || nameInput;
            } else {
                markError(nameInput, false);
            }

            var contactValue = contactInput.value.trim();
            var contactOk = contactValue.length >= 5 &&
                (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue) || /^[\d\s+\-()]{5,20}$/.test(contactValue));

            if (!contactOk) {
                markError(contactInput, true);
                firstInvalid = firstInvalid || contactInput;
            } else {
                markError(contactInput, false);
            }

            if (!messageInput.value.trim()) {
                markError(messageInput, true);
                firstInvalid = firstInvalid || messageInput;
            } else {
                markError(messageInput, false);
            }

            return firstInvalid;
        }

        form.addEventListener('input', function (event) {
            if (event.target.closest('.field')) markError(event.target, false);
            setStatus('', null);
        });

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            var firstInvalid = validate();
            if (firstInvalid) {
                setStatus('请完整填写带 * 的必填项后再提交。', 'error');
                firstInvalid.focus();
                return;
            }

            var data = {
                name: form.elements.name.value.trim(),
                contact: form.elements.contact.value.trim(),
                message: form.elements.message.value.trim()
            };

            if (SITE.formEndpoint) {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = '提交中…';
                }
                setStatus('正在提交…', null);

                fetch(SITE.formEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify(data)
                })
                    .then(function (response) {
                        if (!response.ok) throw new Error('HTTP ' + response.status);
                        form.reset();
                        setStatus('提交成功，感谢您的留言，我们会尽快与您联系。', 'success');
                    })
                    .catch(function () {
                        setStatus('提交失败，请稍后重试，或直接致电 ' + SITE.phone + '。', 'error');
                    })
                    .then(function () {
                        if (submitBtn) {
                            submitBtn.disabled = false;
                            submitBtn.textContent = '提交';
                        }
                    });
                return;
            }

            // 未配置接口：通过邮件客户端发送，并给出明确反馈
            var subject = '网站咨询 - ' + data.name;
            var body = '姓名：' + data.name + '\n联系方式：' + data.contact + '\n\n需求：\n' + data.message;
            var mailto = 'mailto:' + SITE.email +
                '?subject=' + encodeURIComponent(subject) +
                '&body=' + encodeURIComponent(body);

            window.location.href = mailto;
            setStatus('已为您打开邮件客户端，点击发送即可。若没有弹出，请直接发送邮件至 ' + SITE.email + '。', 'success');
        });
    }

    /* ============================ 首屏 3D 场景 ============================ */

    function supportsWebGL() {
        try {
            var canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext &&
                (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
        } catch (e) {
            return false;
        }
    }

    function setSceneStatus(text, isError) {
        var statusEl = document.getElementById('scene-status');
        if (!statusEl) return;
        var textEl = statusEl.querySelector('.scene-status-text');
        if (textEl && text) textEl.textContent = text;
        statusEl.classList.toggle('is-error', !!isError);
    }

    function hideSceneStatus() {
        var statusEl = document.getElementById('scene-status');
        if (statusEl) statusEl.classList.add('is-hidden');
    }

    /* ======================= 首屏文案轮换 =======================
       首页 banner 那句话不再写死：换一个场景就换一句，常来看的人不会腻。
       文案围绕「Web3D / 全景 / 线上展馆 / 设计与技术」的表达，每条再配一句副标题。
       节奏：
         · 有多个场景在轮播 → 跟着场景切换换（不另开定时器，免得两套节奏打架）
         · 只有一个场景，或 WebGL 不可用走了静态兜底 → 自己按 BANNER_INTERVAL 换
       ------------------------------------------------------------ */
    var HERO_COPY = [
        { t: '让产品被看见，<br>让专业被相信。', s: 'Web3D 技术助力产品“走出去”' },
        { t: '不用到场，<br>也能看清每一处细节。', s: '720° 全景漫游，打开链接就能逛' },
        { t: '一张链接，<br>胜过一百页 PPT。', s: '全景 + 3D 模型，点开即看' },
        { t: '方案讲不明白，<br>就换一种讲法。', s: '用三维把想法直接摆出来' },
        { t: '把展馆搬到线上，<br>把客户留在屏幕前。', s: '24 小时不打烊的线上展馆' },
        { t: '不是更花哨，<br>是更讲得清楚。', s: '三维可视化，为沟通省时间' },
        { t: '看得见，<br>才谈得上相信。', s: '精细化建模，还原真实质感' },
        { t: '一次建模，<br>到处展示。', s: '网页、手机、大屏，同一份模型' },
        { t: '客户少跑一趟，<br>方案早定一天。', s: '远程看方案，决策快一步' },
        { t: '图纸到实景，<br>只差一次渲染。', s: '效果图 · 全景 · 三维模型' },
        { t: '产品走出去，<br>不必先走出门。', s: '一台设备，连接远方的客户' },
        { t: '好方案，<br>经得起 360° 看。', s: '720° 无死角呈现' },
        { t: '把展厅装进链接，<br>转发给每一位客户。', s: '微信一键分享，随时开逛' },
        { t: '空间不上锁，<br>随时都能进。', s: '手机陀螺仪环视，身临其境' },
        { t: '立面、材质、光影，<br>都值得认真对待。', s: '建筑与广告物料的精细化表达' },
        { t: '我们不只做效果，<br>还做能用的展示。', s: '可旋转、可测量、可交互' },
        { t: '让每一次提案，<br>都有画面感。', s: '先看清楚，再做决定' },
        { t: '设计落地之前，<br>先让它站起来。', s: '三维预演，减少返工' },
        { t: '从一张平面，<br>到一座可漫游的展馆。', s: '平面 · 三维 · 全景，全链路呈现' },
        { t: '技术藏在后面，<br>效果摆在前面。', s: '你只管看效果，繁琐交给引擎' },
        { t: '客户看懂的，<br>才是好方案。', s: '用直观的方式，讲专业的事' },
        { t: '尺度与质感，<br>一屏之内交代清楚。', s: '真实比例 + 物理材质' },
        { t: '让好设计，<br>被更快地点头。', s: '缩短决策链路的展示方式' },
        { t: '展馆会打烊，<br>线上展馆不会。', s: '随时随地，想看就看' },
        { t: '每一处细节，<br>都按真实比例生长。', s: '从建模到出图的完整标准' },
        { t: '把细节做足，<br>让专业自己说话。', s: '光影、材质、比例，逐项校准' },
        { t: '让好产品，<br>自己开口介绍自己。', s: '沉浸式浏览，胜过千言万语' }
    ];

    /* 洗牌发牌：一轮之内不重复，一轮发完再洗 —— 比「按下标顺序轮」更不容易被看出规律。
       洗完之后，最先发出的那张不能正好是刚看过的那张。 */
    function makeHeroCopyDeck() {
        var deck = [], last = -1;
        function reshuffle() {
            deck = HERO_COPY.map(function (_, i) { return i; });
            for (var i = deck.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
            }
            if (deck.length > 1 && deck[deck.length - 1] === last) {
                var t2 = deck[deck.length - 1]; deck[deck.length - 1] = deck[0]; deck[0] = t2;
            }
        }
        return function nextIndex() {
            if (!deck.length) reshuffle();
            last = deck.pop();
            return last;
        };
    }
    var heroCopyNextIndex = makeHeroCopyDeck();
    var heroCopyEls = null;
    var heroCopyTimer = null;
    var heroCopyPrimed = false;

    function applyHeroCopy(copy, animate) {
        if (!copy) return;
        if (!heroCopyEls) {
            var box = document.querySelector('.hero-content');
            heroCopyEls = box ? { h1: box.querySelector('h1'), p: box.querySelector('p') } : {};
        }
        var h1 = heroCopyEls.h1, p = heroCopyEls.p;
        if (!h1 || !p) return;
        h1.innerHTML = copy.t;
        p.textContent = copy.s;
        if (!animate) return;
        // 重播淡入动画：先摘 class 并强制重排，否则第二次加同一个 class 不会重新播
        [h1, p].forEach(function (el) {
            el.classList.remove('is-copy-in');
            void el.offsetWidth;
            el.classList.add('is-copy-in');
        });
    }

    // 首屏固定先显示 HERO_COPY[0]（与 index.html 里写死的那句一致），之后才随机发牌
    function primeHeroCopy() {
        if (heroCopyPrimed) return;
        heroCopyPrimed = true;
        applyHeroCopy(HERO_COPY[0], false);
    }
    function advanceHeroCopy() {
        primeHeroCopy();   // 兜底：万一没人先叫过 prime
        applyHeroCopy(HERO_COPY[heroCopyNextIndex()], true);
    }

    // 没有「场景轮播」来带动文案时，让文案自己转（切走标签页或首屏滚出去了就跳过这一拍）
    function startHeroCopyAutoRotate() {
        primeHeroCopy();
        if (heroCopyTimer) return;
        heroCopyTimer = window.setInterval(function () {
            if (document.hidden) return;
            var hero = document.querySelector('.hero');
            if (hero && hero.getBoundingClientRect().bottom <= 0) return;
            advanceHeroCopy();
        }, BANNER_INTERVAL);
    }

    function useStaticFallback(text) {
        var hero = document.querySelector('.hero');
        if (hero) hero.classList.add('is-static');
        setSceneStatus(text, true);
        // 静态兜底背景本身就是 panorama，短暂过渡后淡出提示层
        window.setTimeout(hideSceneStatus, 600);
        // 静态背景没有场景切换，文案得自己转，否则访客一直看同一句话
        startHeroCopyAutoRotate();
    }

    /* ======================= 首屏作品轮播（数据源） =======================
       首页 banner 轮播「全景展馆」里最新上传的全景作品。
       数据来源优先级：
         1) 远端作品索引 —— /vr/ 上传作品时同步过去的，任何设备的访客都能看到
         2) 本机 IndexedDB —— 与 /vr/ 同源，管理端自己的浏览器里就有
         3) 静态 images/panorama.jpg —— 兜底，保证首屏永远有画面
       -------------------------------------------------------------------- */
    var WORKS_INDEX_KEY = 'vrpv_works_qhhxo4k6lyr6ehcbjqt4gphx';
    var WORKS_INDEX_URL = 'https://textdb.online/' + WORKS_INDEX_KEY;
    var BANNER_INTERVAL = 5000;       // 每 5 秒自动切换
    var BANNER_MAX_SLIDES = 12;       // 最多轮播的场景数（一件多场景作品会占多条）
    var ROTATE_RESUME_MS = 1000;      // 用户交互停止后，多久恢复「自动旋转」
    var SLIDE_RESUME_MS = 5000;       // 交互停止后，多久「重新开始」下一个场景的倒计时

    function fetchWorksIndex() {
        return fetch(WORKS_INDEX_URL + '?_=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.text() : ''; })
            .then(function (txt) {
                txt = (txt || '').trim();
                if (!txt) return [];
                var arr = JSON.parse(txt);
                return Array.isArray(arr) ? arr : [];
            })
            .catch(function () { return []; });
    }

    // 同源兜底：直接读 /vr/ 用的那个 IndexedDB（注意：只在同一浏览器里有数据）
    function readLocalWorks() {
        return new Promise(function (resolve) {
            var done = false;
            function finish(v) { if (!done) { done = true; resolve(v); } }
            try {
                if (!window.indexedDB) { finish([]); return; }
                var req = indexedDB.open('vr_panorama_db');
                req.onerror = function () { finish([]); };
                req.onblocked = function () { finish([]); };
                req.onsuccess = function () {
                    var db = req.result;
                    try {
                        if (!db.objectStoreNames.contains('works')) { finish([]); return; }
                        var tx = db.transaction('works', 'readonly');
                        var g = tx.objectStore('works').getAll();
                        g.onsuccess = function () { finish(g.result || []); };
                        g.onerror = function () { finish([]); };
                    } catch (e) { finish([]); }
                };
                // 无痕模式等场景下 open 可能一直不回调，加个超时别卡住首屏
                window.setTimeout(function () { finish([]); }, 1500);
            } catch (e) { finish([]); }
        });
    }

    // 上传时间：新数据用 uploadedAt；旧数据退到 id 内嵌的毫秒时间戳，再退到 date
    function workTimeMs(w) {
        if (!w) return 0;
        if (w.uploadedAt) { var t = Number(w.uploadedAt); if (t) return t; }
        var n = parseInt(w.id, 10);
        if (!isNaN(n) && n > 1e12) return n;
        if (w.date) { var d = Date.parse(w.date); if (!isNaN(d)) return d; }
        return 0;
    }

    // 统一成轮播条目：把每件作品的「全部场景」按顺序摊平，作品之间按上传时间
    // 从近到远排序；同一件作品内保持创作者排定的场景顺序。
    function toSlides(list) {
        var works = (list || []).map(function (w) {
            var scenes = [];
            if (Array.isArray(w.sc) && w.sc.length) {
                // 远端作品索引（admin.js buildWorksIndex 产出）
                w.sc.forEach(function (s, i) {
                    var pano = (s && (s.p || s.panorama)) || '';
                    if (pano) {
                        scenes.push({ pano: pano, title: (s && s.t) || ('场景 ' + (i + 1)), i: i });
                    }
                });
            } else if (Array.isArray(w.scenes) && w.scenes.length) {
                // 本机 IndexedDB 里的作品（同一浏览器才有）
                w.scenes.forEach(function (s, i) {
                    var pano = (s && s.panorama) || '';
                    if (pano) {
                        scenes.push({ pano: pano, title: (s && s.title) || ('场景 ' + (i + 1)), i: i });
                    }
                });
            }
            // 兼容旧版索引：只有首场景图
            if (!scenes.length) {
                var single = w.pano || w.panorama || '';
                if (single) scenes.push({ pano: single, title: '', i: 0 });
            }
            return {
                id: w.id,
                title: w.t || w.title || '',
                at: w.at || workTimeMs(w),
                scenes: scenes
            };
        })
        .filter(function (w) { return w.scenes.length > 0; })
        .sort(function (a, b) { return b.at - a.at; }); // 上传时间从近到远

        var slides = [];
        works.forEach(function (w) {
            w.scenes.forEach(function (s) {
                slides.push({
                    title: w.title,
                    sceneTitle: s.title,
                    sceneIndex: s.i,
                    sceneCount: w.scenes.length,
                    url: s.pano,
                    // 深链直达「该作品的该场景」：VR 侧解析 ?work=&scene=
                    link: 'vr/index.html?work=' + encodeURIComponent(w.id) + '&scene=' + s.i,
                    at: w.at
                });
            });
        });
        return slides.slice(0, BANNER_MAX_SLIDES);
    }

    // 右下角「进入该场景」入口，跟随当前轮播项更新
    function updateHeroEntry(slide) {
        var el = document.getElementById('hero-entry');
        if (!el) return;
        if (!slide || !slide.url) { el.hidden = true; return; }
        el.hidden = false;
        el.setAttribute('href', slide.link || 'vr/');

        var multi = slide.sceneCount > 1;
        var sceneLabel = multi
            ? ('场景 ' + (slide.sceneIndex + 1) + '/' + slide.sceneCount
               + (slide.sceneTitle ? ' · ' + slide.sceneTitle : ''))
            : '进入该场景';

        el.setAttribute('aria-label', '进入该场景：' + (slide.title || '全景作品')
            + (multi ? '（' + sceneLabel + '）' : ''));

        var hintEl = el.querySelector('.hero-entry-hint');
        if (hintEl) hintEl.textContent = sceneLabel;
        var titleEl = el.querySelector('.hero-entry-title');
        if (titleEl) titleEl.textContent = slide.title || '全景作品';
    }

    function initHeroScene() {
        var container = document.getElementById('scene-container');
        if (!container) return;

        if (typeof THREE === 'undefined') {
            useStaticFallback('3D 组件未能加载，已切换为静态背景。');
            return;
        }

        if (!supportsWebGL()) {
            useStaticFallback('当前浏览器不支持 WebGL，已切换为静态背景。');
            return;
        }

        var scene, camera, renderer;
        var rafId = null;
        var isRunning = false;
        var isReady = false;
        var isDestroyed = false;

        try {
            scene = new THREE.Scene();

            var width = container.clientWidth || window.innerWidth;
            var height = container.clientHeight || window.innerHeight;

            camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 100);
            // 全景相机固定在球心：只改变朝向，不移动位置
            camera.position.set(0, 0, 0);

            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance'
            });

            // r152+ 使用 outputColorSpace；旧版本回退到 gammaOutput
            if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
                renderer.outputColorSpace = THREE.SRGBColorSpace;
            } else if ('gammaOutput' in renderer) {
                renderer.gammaOutput = true;
            }

            if (THREE.ACESFilmicToneMapping !== undefined) {
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                renderer.toneMappingExposure = 1.0;
            }

            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
            renderer.setSize(width, height, false);
            container.appendChild(renderer.domElement);
        } catch (e) {
            useStaticFallback('3D 场景初始化失败，已切换为静态背景。');
            return;
        }

        var loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous'); // 同源静态图：与 index.html 的 <link rel=preload crossOrigin> 对齐

        // 远端图床（imgbb 等）不保证返回 CORS 头；一旦带 crossOrigin，整张图会加载失败。
        // 这里远端图只当纹理用、不读像素，所以用不加 crossOrigin 的 loader。
        var remoteLoader = new THREE.TextureLoader();
        function pickLoader(url) {
            return /^(https?:)?\/\//.test(url) ? remoteLoader : loader;
        }

        function prepareTexture(tex) {
            if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
            tex.minFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
            return tex;
        }

        // 用翻转球体承载全景图：geometry.scale(-1,1,1) 把所有面转向内侧，
        // 相机位于球心即可看到全景。
        // 注意：翻转后必须用默认 FrontSide。若再叠加 side: BackSide，
        // 内侧的面会被整个剔除，结果是从球内看不到任何东西（原实现即为此 bug）。
        // 这里建两张球体，用透明度做交叉淡入淡出，实现作品轮播。
        function makeSphere() {
            var geometry = new THREE.SphereGeometry(60, 64, 40);
            geometry.scale(-1, 1, 1);
            var mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                transparent: true, opacity: 0, depthWrite: false
            }));
            scene.add(mesh);
            return mesh;
        }

        var SPHERES = [makeSphere(), makeSphere()];
        var frontIdx = 0;          // 当前完全可见的那张
        var fading = false;
        var fadeStartedAt = 0;
        var FADE_MS = 900;         // 交叉淡入淡出时长
        var bannerSlides = [];
        var bannerIndex = 0;
        var slideTimer = null;     // 下一场景的倒计时（可暂停/重置）
        var slideResumeTimer = null;
        var interacting = false;   // 用户正在拖拽全景

        function loadInto(sphere, url, onDone, onFail) {
            pickLoader(url).load(url, function (tex) {
                prepareTexture(tex);
                var old = sphere.material.map;
                sphere.material.map = tex;
                sphere.material.needsUpdate = true;
                if (old && old !== tex) old.dispose();
                if (onDone) onDone();
            }, undefined, function () { if (onFail) onFail(); });
        }

        function showSlide(i, instant) {
            var slide = bannerSlides[i];
            if (!slide) return;
            var backIdx = 1 - frontIdx;
            loadInto(SPHERES[backIdx], slide.url, function () {
                updateHeroEntry(slide);
                // 首屏文案跟着场景走：第一次固定 HERO_COPY[0]，之后每换一个场景换下一句
                if (instant) primeHeroCopy(); else advanceHeroCopy();
                if (instant) {
                    SPHERES[backIdx].material.opacity = 1;
                    SPHERES[frontIdx].material.opacity = 0;
                    frontIdx = backIdx;
                } else {
                    frontIdx = backIdx; // frontIdx 指向「正在淡入」的那张
                    fading = true;
                    fadeStartedAt = (window.performance && performance.now) ? performance.now() : Date.now();
                }
            }, function () {
                // 首张就失败：退回静态背景。后续某张失败则保持当前画面不动。
                if (!isReady) { useStaticFallback('全景图加载失败，已切换为静态背景。'); }
            });
        }

        /* 轮播调度：用「可重置的 setTimeout 链」而不是 setInterval，
           这样才能在用户拖拽时把倒计时真正停下来，并在交互结束后重新计时。 */
        function slideShouldHold() {
            if (isDestroyed || document.hidden) return true;
            return heroIsOffscreen(); // 首屏滚出视野就别切了，省流量
        }

        function clearSlideTimers() {
            if (slideTimer) { window.clearTimeout(slideTimer); slideTimer = null; }
            if (slideResumeTimer) { window.clearTimeout(slideResumeTimer); slideResumeTimer = null; }
        }

        function advanceSlide() {
            bannerIndex = (bannerIndex + 1) % bannerSlides.length;
            showSlide(bannerIndex, false);
        }

        // 倒计时 delay 毫秒后切到下一个场景，然后每 BANNER_INTERVAL 一次
        function armSlideTimer(delay) {
            if (slideTimer) { window.clearTimeout(slideTimer); slideTimer = null; }
            slideTimer = window.setTimeout(function () {
                slideTimer = null;
                if (bannerSlides.length < 2) return;
                if (slideShouldHold()) { armSlideTimer(1000); return; } // 稍后重试
                advanceSlide();
                armSlideTimer(BANNER_INTERVAL);
            }, delay);
        }

        function startBanner(slides) {
            bannerSlides = (slides && slides.length)
                ? slides
                : [{ title: '', url: 'images/panorama.jpg', link: 'vr/' }];
            bannerIndex = 0;
            isReady = true;
            hideSceneStatus();
            start();
            showSlide(0, true);
            if (bannerSlides.length > 1) {
                armSlideTimer(BANNER_INTERVAL);
            } else {
                // 只有一张全景，场景不会自己换 —— 那就让文案自己转，别让访客一直看同一句
                startHeroCopyAutoRotate();
            }
        }

        /* 用户开始交互（按下）→ 定时器与自转都立即停住；
           交互停止后：+1s 恢复自转，+5s 重新开始「5 秒后跳场景」的倒计时。 */
        function beginInteraction() {
            interacting = true;
            clearSlideTimers();          // 拖拽期间绝不切场景
        }

        function endInteraction() {
            interacting = false;
            pano.rotateResumeAt = nowMs() + ROTATE_RESUME_MS;
            if (bannerSlides.length > 1) {
                slideResumeTimer = window.setTimeout(function () {
                    slideResumeTimer = null;
                    armSlideTimer(BANNER_INTERVAL);
                }, SLIDE_RESUME_MS);
            }
        }

        /* ── 全景「原地旋转」控制器 ──────────────────────────────────
           全景的正确做法是相机固定在球心、只改变「朝向」。
           原先用 OrbitControls 在这里是无效的：相机位置 (0,0,0.1) 与
           target (0,0,0) 的连线正好落在极轴（phi=0）上，而方位角旋转
           在极轴上会退化 —— 于是 autoRotate 完全看不到转动、
           水平拖拽也毫无反应（只有垂直拖拽有效）。
           改为直接驱动 camera.rotation（YXZ：先偏航 yaw，再俯仰 pitch）。 */
        var pano = {
            yaw: 0,
            pitch: 0,
            autoSpeed: 0.032,     // 弧度/秒 ≈ 3 分钟转一圈，缓慢、不抢内容
            pitchLimit: 1.30,     // ≈74.5°，避免翻到正上方/正下方
            dragK: 0.0028,        // 像素 → 弧度
            dragging: false,
            pointerId: null,
            lastX: 0,
            lastY: 0,
            rotateResumeAt: 0,    // 交互停止后到这个时刻才恢复自转
            lastT: 0
        };

        camera.rotation.order = 'YXZ';
        camera.rotation.set(0, 0, 0);

        function applyPanoRotation() {
            camera.rotation.y = pano.yaw;
            camera.rotation.x = pano.pitch;
            camera.rotation.z = 0;
        }

        function nowMs() {
            return (window.performance && performance.now) ? performance.now() : Date.now();
        }

        var canvas = renderer.domElement;
        canvas.style.cursor = 'grab';
        canvas.style.touchAction = 'pan-y'; // 触屏：纵向仍可滚动页面，横向拖拽转全景

        function onPointerDown(e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            pano.dragging = true;
            pano.pointerId = e.pointerId;
            pano.lastX = e.clientX;
            pano.lastY = e.clientY;
            canvas.style.cursor = 'grabbing';
            beginInteraction();  // 停自转 + 停轮播倒计时
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }

        function onPointerMove(e) {
            if (!pano.dragging || e.pointerId !== pano.pointerId) return;
            var dx = e.clientX - pano.lastX;
            var dy = e.clientY - pano.lastY;
            pano.lastX = e.clientX;
            pano.lastY = e.clientY;
            pano.yaw -= dx * pano.dragK;   // 向右拖 → 画面向右走（与主流全景站一致）
            pano.pitch -= dy * pano.dragK;
            if (pano.pitch > pano.pitchLimit) pano.pitch = pano.pitchLimit;
            if (pano.pitch < -pano.pitchLimit) pano.pitch = -pano.pitchLimit;
            applyPanoRotation();
            if (e.cancelable) e.preventDefault(); // 拖拽时不要选中文字
        }

        function onPointerUp(e) {
            if (e.pointerId !== pano.pointerId) return;
            pano.dragging = false;
            pano.pointerId = null;
            endInteraction(); // +1s 恢复自转，+5s 重新开始跳场景倒计时
            canvas.style.cursor = 'grab';
            try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        }

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove, { passive: false });
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);

        function updatePano(now) {
            if (!pano.lastT) pano.lastT = now;
            // 夹住 dt：切回标签页/掉帧时不让画面跳一大步
            var dt = Math.min(0.1, Math.max(0, (now - pano.lastT) / 1000));
            pano.lastT = now;
            // 拖拽中不自转；交互停止后要等 ROTATE_RESUME_MS 才恢复
            if (!pano.dragging && !interacting && now >= pano.rotateResumeAt) {
                pano.yaw += pano.autoSpeed * dt; // 缓慢自转
                applyPanoRotation();
            }
        }

        // 取「最新上传的作品」并开始轮播：远端索引 → 本机 IndexedDB → 静态兜底
        fetchWorksIndex()
            .then(function (idx) {
                if (idx && idx.length) return toSlides(idx);
                return readLocalWorks().then(toSlides);
            })
            .then(function (slides) { startBanner(slides); })
            .catch(function () { startBanner([]); });

        function animate() {
            rafId = window.requestAnimationFrame(animate);
            var now = nowMs();
            updatePano(now); // 自转 + 拖拽后的朝向更新

            // 轮播交叉淡入淡出
            if (fading) {
                var t = Math.min(1, (now - fadeStartedAt) / FADE_MS);
                var e = t * t * (3 - 2 * t); // smoothstep，避免线性淡入显得生硬
                SPHERES[frontIdx].material.opacity = e;
                SPHERES[1 - frontIdx].material.opacity = 1 - e;
                if (t >= 1) fading = false;
            }

            renderer.render(scene, camera);
        }

        function start() {
            if (isRunning) return;
            isRunning = true;
            animate();
        }

        function stop() {
            if (!isRunning) return;
            isRunning = false;
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
                rafId = null;
            }
        }

        // 页面不可见 / 首屏滚出视野时暂停渲染，避免无谓的 GPU 占用
        function evaluateVisibility() {
            if (isDestroyed || !isReady) return;
            if (document.hidden || heroIsOffscreen()) stop();
            else start();
        }

        function heroIsOffscreen() {
            var hero = document.querySelector('.hero');
            if (!hero) return false;
            return hero.getBoundingClientRect().bottom <= 0;
        }

        document.addEventListener('visibilitychange', evaluateVisibility);
        window.addEventListener('scroll', function () {
            if (document.hidden) return;
            evaluateVisibility();
        }, { passive: true });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(function () {
                var w = container.clientWidth;
                var h = container.clientHeight;
                if (!w || !h) return;
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                renderer.setSize(w, h, false);
            }, 150);
        });

        renderer.domElement.addEventListener('webglcontextlost', function (event) {
            event.preventDefault();
            stop();
            useStaticFallback('3D 上下文已丢失，已切换为静态背景。');
        }, false);

        window.addEventListener('beforeunload', function () {
            isDestroyed = true;
            stop();
            clearSlideTimers();
            window.removeEventListener('visibilitychange', evaluateVisibility);
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            for (var i = 0; i < SPHERES.length; i++) {
                if (SPHERES[i].material.map) SPHERES[i].material.map.dispose();
            }
            renderer.dispose();
        });
    }

    /* ============================ 启动 ============================ */

    function boot() {
        applySiteConfig();
        initHeader();
        initNav();
        initActiveNav();
        initReveal();
        initContactForm();

        // 3D 场景放到首屏绘制完成之后再初始化，避免抢占首帧
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(initHeroScene, { timeout: 1200 });
        } else {
            window.setTimeout(initHeroScene, 200);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
