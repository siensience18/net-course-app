(() => {
  'use strict';

  // Должны совпадать с build.mjs
  const SALT_TEXT = 'net-course/v1';
  const ITERATIONS = 250000;
  const VER = document.documentElement.dataset.ver || '';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem('nc.' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) { try { localStorage.setItem('nc.' + k, JSON.stringify(v)); } catch { /* квота/приватный режим */ } },
    del(k) { try { localStorage.removeItem('nc.' + k); } catch { /* ignore */ } },
  };

  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-11"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
  };

  let DATA = null;
  let MOD = {};
  let SEQ = [];
  const state = { path: null, headings: [], pendingTerms: null };

  // ---------------- crypto / data ----------------

  const b64 = {
    enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
    dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  };

  async function deriveKey(login, pass) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey('raw', enc.encode(login.trim().toLowerCase() + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
    const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(SALT_TEXT)));
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, true, ['decrypt'],
    );
  }

  async function decrypt(buf, key) {
    const iv = new Uint8Array(buf, 0, 12);
    const ct = new Uint8Array(buf, 12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }

  function fetchData() {
    return fetch('data.bin?v=' + VER).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
  }

  async function boot() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (!window.crypto || !crypto.subtle || !window.DecompressionStream) {
      $('#boot').innerHTML = '<p style="padding:20px;text-align:center">Браузер слишком старый. Обновите Chrome, Safari или Firefox.</p>';
      return;
    }
    const dataP = fetchData();
    dataP.catch(() => {});
    const saved = LS.get('key') || sessionStorage.getItem('nc.key');
    if (saved) {
      try {
        const key = await crypto.subtle.importKey('raw', b64.dec(saved), 'AES-GCM', true, ['decrypt']);
        DATA = await decrypt(await dataP, key);
        return start();
      } catch {
        LS.del('key');
        sessionStorage.removeItem('nc.key');
      }
    }
    showLogin(dataP);
  }

  function showLogin(dataP) {
    $('#boot').hidden = true;
    $('#login').hidden = false;
    const form = $('#login-form');
    const btn = $('#login-btn');
    const err = $('#login-error');
    const user = $('#login-user');
    setTimeout(() => user.focus(), 50);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Проверяем…';
      try {
        const buf = await dataP.catch(() => { throw new Error('net'); });
        const key = await deriveKey(user.value, $('#login-pass').value);
        try {
          DATA = await decrypt(buf, key);
        } catch {
          throw new Error('auth');
        }
        const raw = b64.enc(await crypto.subtle.exportKey('raw', key));
        if ($('#login-remember').checked) LS.set('key', raw);
        else sessionStorage.setItem('nc.key', raw);
        $('#login').hidden = true;
        start();
      } catch (ex) {
        err.textContent = ex.message === 'net'
          ? 'Не удалось загрузить курс. Проверьте интернет и обновите страницу.'
          : 'Неверный логин или пароль';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        btn.disabled = false;
        btn.textContent = 'Войти';
        $('#login-pass').select();
      }
    });
  }

  function logout() {
    LS.del('key');
    sessionStorage.removeItem('nc.key');
    location.hash = '';
    location.reload();
  }

  // ---------------- helpers ----------------

  function slugify(text) {
    return text.trim().toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  }
  function uniqueSlug(text, seen) {
    const base = slugify(text) || 'section';
    let s = base;
    let i = 0;
    while (seen.has(s)) s = `${base}-${++i}`;
    seen.add(s);
    return s;
  }

  function href(path, frag) {
    const p = path === 'README.md' ? '' : path;
    return '#/' + encodeURI(p) + (frag ? '@' + encodeURIComponent(frag) : '');
  }

  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    try { h = decodeURIComponent(h); } catch { /* оставляем как есть */ }
    const at = h.indexOf('@');
    let path = at >= 0 ? h.slice(0, at) : h;
    const frag = at >= 0 ? h.slice(at + 1) : '';
    if (!path) path = 'README.md';
    path = path.replace(/\/$/, '');
    if (!DATA.files[path] && DATA.files[path + '/README.md']) path += '/README.md';
    return { path, frag };
  }

  function resolvePath(base, rel) {
    const parts = base.split('/');
    parts.pop();
    for (const seg of rel.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  function findFile(base, ref) {
    ref = ref.replace(/^\.\//, '').replace(/\/$/, '');
    if (!ref) return null;
    const cands = [resolvePath(base, ref)];
    const mod = base.split('/')[0];
    if (MOD[mod]) cands.push(`${mod}/${ref}`);
    for (const c of cands) {
      if (DATA.files[c]) return c;
      if (DATA.files[c + '/README.md']) return c + '/README.md';
    }
    if (MOD[mod] && !ref.includes('/')) {
      const hit = MOD[mod].files.find((f) => f.endsWith('/' + ref));
      if (hit) return hit;
    }
    if (DATA.files[ref]) return ref;
    return null;
  }

  const moduleOf = (path) => MOD[path.split('/')[0]] || null;
  const moduleLabel = (m) => `${m.num} · ${m.title}`;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // ---------------- progress ----------------

  const progress = {
    done: () => LS.get('done', {}),
    isDone: (id) => !!progress.done()[id],
    setDone(id, v) {
      const d = progress.done();
      if (v) d[id] = Date.now(); else delete d[id];
      LS.set('done', d);
    },
    read: (path) => LS.get('read', {})[path] || 0,
    setRead(path, r) {
      const all = LS.get('read', {});
      if (r > (all[path] || 0) + 0.005) { all[path] = Math.min(1, r); LS.set('read', all); }
    },
    pos: (path) => LS.get('pos', {})[path] || 0,
    setPos(path, y) { const all = LS.get('pos', {}); all[path] = Math.round(y); LS.set('pos', all); },
  };

  function moduleStatus(m) {
    if (progress.isDone(m.id)) return 'done';
    return progress.read(m.readme) > 0.02 ? 'started' : '';
  }

  // ---------------- markdown ----------------

  const LANG_ALIAS = { sh: 'bash', shell: 'bash', console: 'bash', zsh: 'bash', ps: 'powershell', ps1: 'powershell', py: 'python', yml: 'yaml', golang: 'go', conf: 'ini', toml: 'ini', js: 'javascript' };
  const EXT_LANG = {
    py: 'python', go: 'go', c: 'c', h: 'c', sh: 'bash', yml: 'yaml', yaml: 'yaml', conf: 'ini', service: 'ini',
    logrotate: 'nginx', nft: 'bash', prom: 'plaintext', mod: 'go', json: 'json', js: 'javascript', ts: 'typescript',
    toml: 'ini', ini: 'ini', md: 'markdown', txt: 'plaintext', ps1: 'powershell',
  };
  const NAME_LANG = { Dockerfile: 'dockerfile', Makefile: 'makefile' };

  function langFor(path) {
    const name = path.split('/').pop();
    if (NAME_LANG[name]) return NAME_LANG[name];
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    return EXT_LANG[ext] || 'plaintext';
  }

  function highlight(code, lang) {
    if (!window.hljs || !lang || !hljs.getLanguage(lang) || lang === 'plaintext') return esc(code);
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { return esc(code); }
  }

  function renderMarkdown(md, base, el) {
    el.innerHTML = window.marked ? marked.parse(md, { gfm: true }) : `<pre>${esc(md)}</pre>`;
    const seen = new Set();
    for (const h of $$('h1,h2,h3,h4,h5,h6', el)) {
      h.id = uniqueSlug(h.textContent, seen);
      if (h.tagName === 'H2' || h.tagName === 'H3') {
        const a = document.createElement('a');
        a.className = 'anchor';
        a.href = href(base, h.id);
        a.textContent = '#';
        a.setAttribute('aria-hidden', 'true');
        h.appendChild(a);
      }
    }

    for (const a of $$('a[href]', el)) {
      if (a.classList.contains('anchor')) continue;
      const raw = a.getAttribute('href');
      if (/^(https?:|mailto:)/i.test(raw)) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (raw.startsWith('#')) {
        a.href = href(base, decodeURIComponent(raw.slice(1)));
      } else {
        const [p, frag] = raw.split('#');
        const f = findFile(base, decodeURIComponent(p));
        if (f) a.href = href(f, frag ? decodeURIComponent(frag) : '');
      }
    }

    for (const c of $$(':not(pre) > code', el)) {
      if (c.closest('a')) continue;
      const t = c.textContent.trim();
      if (!/^[\w.\-/]+$/.test(t) || !(/\.[a-z0-9]{1,10}$/i.test(t) || /(Dockerfile|Makefile|\/)$/.test(t))) continue;
      const f = findFile(base, t);
      if (!f || f === base) continue;
      const a = document.createElement('a');
      a.href = href(f);
      a.className = 'file-link';
      a.title = 'Открыть ' + f;
      c.replaceWith(a);
      a.appendChild(c);
    }

    for (const pre of $$('pre', el)) {
      const code = $('code', pre) || pre;
      const m = (code.className || '').match(/language-([\w+-]+)/);
      let lang = m ? m[1].toLowerCase() : '';
      lang = LANG_ALIAS[lang] || lang;
      const wrap = document.createElement('div');
      wrap.className = 'code-block';
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      const src = code.textContent;
      if (lang && lang !== 'text' && window.hljs && hljs.getLanguage(lang)) {
        code.innerHTML = highlight(src, lang);
        code.classList.add('hljs');
      }
      if (m && lang !== 'text') {
        const l = document.createElement('span');
        l.className = 'code-lang';
        l.textContent = m[1];
        wrap.appendChild(l);
      }
      const b = document.createElement('button');
      b.className = 'copy-btn';
      b.innerHTML = ICON.copy;
      b.setAttribute('aria-label', 'Копировать');
      b.addEventListener('click', async () => {
        await copyText(src.replace(/\n$/, ''));
        b.innerHTML = ICON.check;
        b.classList.add('ok');
        setTimeout(() => { b.innerHTML = ICON.copy; b.classList.remove('ok'); }, 1400);
      });
      wrap.appendChild(b);
    }

    for (const t of $$('table', el)) {
      const w = document.createElement('div');
      w.className = 'table-wrap';
      t.replaceWith(w);
      w.appendChild(t);
    }

    const tasks = LS.get('tasks', {});
    const mine = tasks[base] || {};
    $$('li > input[type=checkbox], li > p > input[type=checkbox]', el).forEach((cb, i) => {
      const li = cb.closest('li');
      li.classList.add('task');
      cb.disabled = false;
      if (i in mine) cb.checked = !!mine[i];
      li.classList.toggle('checked', cb.checked);
      cb.addEventListener('change', () => {
        const all = LS.get('tasks', {});
        all[base] = all[base] || {};
        all[base][i] = cb.checked;
        LS.set('tasks', all);
        li.classList.toggle('checked', cb.checked);
      });
    });
  }

  // ---------------- views ----------------

  function renderNav() {
    const nav = $('#nav');
    const scroll = $('#sidebar').scrollTop;
    const cur = state.path;
    const curMod = moduleOf(cur);
    let h = `<a class="nav-home${cur === 'README.md' ? ' active' : ''}" href="#/">${ICON.home}<span>Главная и план курса</span></a>`;
    for (const part of DATA.parts) {
      h += `<div class="nav-part">${esc(part.title)}</div>`;
      for (const id of part.modules) {
        const m = MOD[id];
        const st = moduleStatus(m);
        const active = curMod === m;
        h += `<div class="nav-mod${active ? ' active' : ''}">`;
        h += `<a class="nav-mod-link" href="${href(m.readme)}"><span class="num ${st}"><span>${m.num}</span></span><span class="t">${esc(m.title)}</span></a>`;
        if (active && m.files.length) {
          h += '<div class="nav-files">';
          for (const f of m.files) {
            const rel = f.slice(id.length + 1);
            const i = rel.lastIndexOf('/');
            const dir = i >= 0 ? rel.slice(0, i + 1) : '';
            h += `<a href="${href(f)}"${f === cur ? ' class="active"' : ''} title="${esc(rel)}"><span class="dir">${esc(dir)}</span>${esc(rel.slice(i + 1))}</a>`;
          }
          h += '</div>';
        }
        h += '</div>';
      }
    }
    if (DATA.extra.length) {
      h += '<div class="nav-extra"><div class="nav-part" style="margin-top:4px">Прочее</div>';
      for (const f of DATA.extra) h += `<a href="${href(f)}"${f === cur ? ' class="active"' : ''}>${ICON.file}<span>${esc(f)}</span></a>`;
      h += '</div>';
    }
    nav.innerHTML = h;
    $('#sidebar').scrollTop = scroll;

    const total = DATA.modules.length;
    const done = DATA.modules.filter((m) => progress.isDone(m.id)).length;
    $('#sidebar-progress').innerHTML = `<div class="sp-label"><span>Пройдено модулей</span><span>${done} из ${total}</span></div><div class="bar"><i style="width:${(done / total) * 100}%"></i></div>`;
  }

  function renderHome(el) {
    const total = DATA.modules.length;
    const done = DATA.modules.filter((m) => progress.isDone(m.id)).length;
    const last = LS.get('last', null);
    const lastValid = last && DATA.files[last] && last !== 'README.md';
    const next = DATA.modules.find((m) => !progress.isDone(m.id));
    const target = lastValid ? last : (next || DATA.modules[0]).readme;
    const tm = moduleOf(target);
    const label = lastValid
      ? `Продолжить: ${tm ? moduleLabel(tm) : target.split('/').pop()}`
      : (done ? `Дальше: ${moduleLabel(next || DATA.modules[0])}` : 'Начать курс');
    const pct = Math.round((done / total) * 100);

    let h = `<section class="hero">
      <h1>${esc(DATA.title)}</h1>
      <div class="hero-stats"><span><b>${done}</b> / ${total} модулей</span><span><b>${pct}%</b> курса</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="hero-actions">
        <a class="btn" href="${href(target)}">${ICON.play}<span>${esc(label)}</span></a>
        ${next && lastValid && moduleOf(last) !== next ? `<a class="btn ghost" href="${href(next.readme)}">Следующий непройденный: ${next.num}</a>` : ''}
      </div>
    </section>`;

    for (const part of DATA.parts) {
      h += `<div class="part-title">${esc(part.title)}</div><div class="cards">`;
      for (const id of part.modules) {
        const m = MOD[id];
        const st = moduleStatus(m);
        const r = st === 'done' ? 1 : progress.read(m.readme);
        const meta = st === 'done' ? 'Пройден' : r > 0.02 ? `Прочитано ${Math.round(r * 100)}%` : 'Не начат';
        h += `<a class="card ${st}" href="${href(m.readme)}">
          <div class="card-top"><span class="num ${st}"><span>${m.num}</span></span><span class="card-meta">${meta}${m.files.length ? ` · файлов: ${m.files.length}` : ''}</span></div>
          <div class="card-title">${esc(m.title)}</div>
          <div class="bar"><i style="width:${Math.round(r * 100)}%"></i></div>
        </a>`;
      }
      h += '</div>';
    }
    const hasProgress = done > 0 || Object.keys(LS.get('read', {})).length > 0;
    h += `<details class="readme"${hasProgress ? '' : ' open'}><summary>О курсе и как учиться</summary><div id="home-readme"></div></details>`;
    el.innerHTML = h;
    renderMarkdown(DATA.files['README.md'], 'README.md', $('#home-readme', el));
  }

  function renderModule(el, m) {
    const st = moduleStatus(m);
    const head = document.createElement('div');
    head.className = 'mod-head';
    head.innerHTML = `<span class="chip">Модуль ${m.num} из ${DATA.modules[DATA.modules.length - 1].num}</span>`
      + (st === 'done' ? '<span class="chip ok">✓ Пройден</span>' : '')
      + (m.files.length ? `<span class="chip">${ICON.file.replace('<svg', '<svg style="width:14px;height:14px"')} файлов: ${m.files.length}</span>` : '');
    const body = document.createElement('div');
    renderMarkdown(DATA.files[m.readme], m.readme, body);
    el.replaceChildren(head, body);
  }

  function renderFile(el, path) {
    const m = moduleOf(path);
    const text = DATA.files[path];
    const name = path.split('/').pop();
    const crumbs = `<div class="crumbs">${m ? `<a href="${href(m.readme)}">${esc(moduleLabel(m))}</a> / ` : '<a href="#/">Главная</a> / '}${esc(path.split('/').slice(1, -1).join(' / '))}</div>`;
    const lines = text.replace(/\n$/, '').split('\n');
    const head = `${crumbs}<div class="file-head"><h1>${esc(name)}</h1>
      <button class="btn ghost" id="file-copy">${ICON.copy}<span class="hide-mobile">Копировать</span></button>
      <button class="btn ghost" id="file-dl">${ICON.download}<span class="hide-mobile">Скачать</span></button></div>
      <div class="file-meta">${lines.length} строк · ${(new Blob([text]).size / 1024).toFixed(1)} КБ</div><br>`;

    if (path.endsWith('.md')) {
      el.innerHTML = head + '<div id="file-md"></div>';
      renderMarkdown(text, path, $('#file-md', el));
    } else {
      const gutter = lines.map((_, i) => `<span id="L${i + 1}">${i + 1}</span>`).join('\n');
      el.innerHTML = head + `<div class="file-code"><pre class="gutter">${gutter}</pre><div class="src"><pre><code class="hljs">${highlight(lines.join('\n'), langFor(path))}</code></pre></div></div>`;
    }
    $('#file-copy', el).onclick = async () => { await copyText(text); toast('Скопировано'); };
    $('#file-dl', el).onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  function renderPager(path) {
    const pager = $('#pager');
    const m = moduleOf(path);
    if (path === 'README.md') { pager.innerHTML = ''; return; }
    if (m && path !== m.readme) {
      pager.innerHTML = `<div class="pager-links"><a href="${href(m.readme)}"><small>← Назад к модулю</small><span>${esc(moduleLabel(m))}</span></a></div>`;
      return;
    }
    if (!m) { pager.innerHTML = ''; return; }
    const i = SEQ.indexOf(path);
    const prev = SEQ[i - 1];
    const next = SEQ[i + 1];
    const done = progress.isDone(m.id);
    const nm = next && moduleOf(next);
    const pm = prev && moduleOf(prev);
    pager.innerHTML = `
      <div class="done-box">
        <p>${done ? 'Модуль отмечен как пройденный.' : 'Прочитал теорию, сделал лабы и домашку? Отметь модуль.'}</p>
        <button class="btn ${done ? 'ghost' : 'success'}" id="btn-done">${done ? 'Снять отметку' : `${ICON.check}<span>Модуль пройден</span>`}</button>
      </div>
      <div class="pager-links">
        ${prev ? `<a class="prev" href="${href(prev)}"><small>← Назад</small><span>${esc(pm ? moduleLabel(pm) : 'Главная')}</span></a>` : ''}
        ${next ? `<a class="next" href="${href(next)}"><small>Дальше →</small><span>${esc(moduleLabel(nm))}</span></a>` : ''}
      </div>`;
    $('#btn-done').onclick = () => {
      progress.setDone(m.id, !done);
      if (!done) toast(`Модуль ${m.num} пройден`);
      renderPager(path);
      renderNav();
      const chipHost = $('.mod-head');
      if (chipHost) {
        const ok = $('.chip.ok', chipHost);
        if (!done && !ok) chipHost.children[0].insertAdjacentHTML('afterend', '<span class="chip ok">✓ Пройден</span>');
        if (done && ok) ok.remove();
      }
    };
  }

  function renderToc() {
    const el = $('#content');
    state.headings = $$('h2, h3', el).filter((h) => !h.closest('details:not([open])'));
    const list = $('#toc-list');
    const show = state.path !== 'README.md' && state.headings.length > 1;
    $('#toc').hidden = !show;
    $('#btn-toc').hidden = !show;
    list.innerHTML = state.headings
      .map((h) => `<a class="l${h.tagName[1]}" href="${href(state.path, h.id)}">${esc(h.textContent.replace(/#$/, ''))}</a>`)
      .join('');
  }

  function scrollToFrag(frag, flash) {
    const target = document.getElementById(frag);
    if (!target) return false;
    const det = target.closest('details');
    if (det) det.open = true;
    const y = target.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top'), 10) || 56) - 16;
    window.scrollTo(0, Math.max(0, y));
    if (flash) {
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    }
    return true;
  }

  function markTerms(terms, fromEl) {
    if (!terms || !terms.length) return;
    const root = $('#content');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let started = !fromEl;
    const t0 = terms[0];
    let node;
    while ((node = walker.nextNode())) {
      if (!started) {
        if (fromEl.contains(node) || (fromEl.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) started = true;
        else continue;
      }
      const i = node.nodeValue.toLowerCase().indexOf(t0);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + t0.length);
      const mark = document.createElement('mark');
      mark.className = 'flash';
      try { range.surroundContents(mark); } catch { return; }
      const rect = mark.getBoundingClientRect();
      if (rect.top < 80 || rect.bottom > innerHeight - 40) {
        window.scrollTo(0, Math.max(0, rect.top + window.scrollY - innerHeight / 3));
      }
      const pre = mark.closest('.src, pre');
      if (pre) pre.scrollLeft = Math.max(0, mark.offsetLeft - 40);
      return;
    }
  }

  function route() {
    if (!DATA) return;
    const { path, frag } = parseHash();
    closeOverlays();

    if (path === state.path) {
      const terms = state.pendingTerms;
      state.pendingTerms = null;
      $$('#content mark.flash').forEach((mk) => mk.replaceWith(...mk.childNodes));
      if (frag) scrollToFrag(frag, !terms);
      else window.scrollTo(0, 0);
      if (terms) markTerms(terms, frag ? document.getElementById(frag) : null);
      return;
    }

    const el = $('#content');
    state.path = path;
    const m = moduleOf(path);

    if (!DATA.files[path]) {
      el.innerHTML = `<h1>Страница не найдена</h1><p><code>${esc(path)}</code></p><p><a href="#/">На главную</a></p>`;
    } else if (path === 'README.md') {
      renderHome(el);
    } else if (m && path === m.readme) {
      renderModule(el, m);
    } else {
      renderFile(el, path);
    }

    const title = path === 'README.md' ? 'Главная' : m ? (path === m.readme ? moduleLabel(m) : path.split('/').pop()) : path;
    $('#topbar-title').textContent = path === 'README.md' ? '' : title;
    document.title = `${title} — Курс по сетям`;
    if (path !== 'README.md' && DATA.files[path]) LS.set('last', path);

    renderNav();
    renderPager(path);
    renderToc();

    const terms = state.pendingTerms;
    state.pendingTerms = null;
    requestAnimationFrame(() => {
      let ok = false;
      if (frag) ok = scrollToFrag(frag, !terms);
      if (!ok) window.scrollTo(0, path === 'README.md' ? 0 : progress.pos(path));
      if (terms) markTerms(terms, frag ? document.getElementById(frag) : null);
      onScroll();
    });
  }

  // ---------------- scroll tracking ----------------

  let scrollTimer = 0;
  function onScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    const r = max > 0 ? Math.min(1, scrollY / max) : 1;
    $('#read-progress').style.width = (state.path === 'README.md' ? 0 : r * 100) + '%';
    $('#to-top').classList.toggle('show', scrollY > 900);

    const hs = state.headings;
    if (hs.length) {
      let cur = -1;
      const lim = 130;
      for (let i = 0; i < hs.length; i++) {
        if (hs[i].getBoundingClientRect().top <= lim) cur = i; else break;
      }
      const links = $$('#toc-list a');
      links.forEach((a, i) => a.classList.toggle('on', i === cur));
      const on = links[cur];
      const toc = $('#toc');
      if (on && innerWidth >= 1280) {
        const top = on.offsetTop - toc.clientHeight / 3;
        if (on.offsetTop < toc.scrollTop + 40 || on.offsetTop > toc.scrollTop + toc.clientHeight - 60) toc.scrollTop = top;
      }
    }

    clearTimeout(scrollTimer);
    const path = state.path;
    scrollTimer = setTimeout(() => {
      if (!path || path !== state.path || path === 'README.md') return;
      progress.setPos(path, scrollY);
      progress.setRead(path, r);
    }, 250);
  }

  // ---------------- search ----------------

  let INDEX = null;
  function stripMd(s) {
    return s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/<[^>]+>/g, '').trim();
  }
  function buildIndex() {
    INDEX = [];
    for (const [path, text] of Object.entries(DATA.files)) {
      if (path.endsWith('.md')) {
        const seen = new Set();
        let cur = { path, title: path === 'README.md' ? 'Главная' : path, frag: '', body: [] };
        let fence = false;
        const flush = () => { if (cur.body.length || cur.frag) INDEX.push({ ...cur, body: cur.body.join('\n') }); };
        for (const line of text.split('\n')) {
          if (/^\s*(```|~~~)/.test(line)) fence = !fence;
          const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
          if (h) {
            flush();
            const t = stripMd(h[2]);
            cur = { path, title: t, frag: uniqueSlug(t, seen), body: [] };
          } else cur.body.push(line);
        }
        flush();
      } else {
        INDEX.push({ path, title: path.split('/').pop(), frag: '', body: text, code: true });
      }
    }
    for (const e of INDEX) { e.lt = e.title.toLowerCase(); e.lb = e.body.toLowerCase(); }
  }

  function mark(text, terms) {
    let out = esc(text);
    for (const t of terms) {
      const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, (x) => `<mark>${x}</mark>`);
    }
    return out;
  }

  let searchSel = 0;
  let searchHits = [];
  function doSearch(q) {
    const box = $('#search-results');
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (!terms.length) {
      box.innerHTML = '<div class="hint">Ищите по теории, командам и коду. Например: <b>three-way handshake</b>, <b>SNI</b>, <b>nftables</b></div>';
      searchHits = [];
      return;
    }
    if (!INDEX) buildIndex();
    const hits = [];
    for (const e of INDEX) {
      let score = 0;
      let ok = true;
      for (const t of terms) {
        const inT = e.lt.includes(t);
        const inB = e.lb.includes(t);
        if (!inT && !inB) { ok = false; break; }
        score += (inT ? 20 : 0) + (inB ? 2 : 0);
      }
      if (!ok) continue;
      if (e.lt.includes(terms.join(' '))) score += 30;
      if (e.code) score -= 5;
      if (e.path === 'README.md') score -= 3;
      hits.push([score, e]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    searchHits = hits.slice(0, 60).map((x) => x[1]);
    searchSel = 0;
    if (!searchHits.length) { box.innerHTML = '<div class="hint">Ничего не найдено</div>'; return; }
    box.innerHTML = searchHits.map((e, i) => {
      const m = moduleOf(e.path);
      const where = m ? `${m.num} · ${m.title}${e.code || e.path !== m.readme ? ' · ' + e.path.slice(m.id.length + 1) : ''}` : e.path;
      let snip = '';
      const k = e.lb.indexOf(terms[0]);
      if (k >= 0) {
        const s = Math.max(0, k - 50);
        snip = (s > 0 ? '…' : '') + e.body.slice(s, k + 140).replace(/\s+/g, ' ').replace(/[#*`|]+/g, ' ').trim();
      }
      return `<a class="sr${i === 0 ? ' sel' : ''}" data-i="${i}" href="${searchHref(e, terms)}">
        <div class="sr-where">${esc(where)}</div>
        <div class="sr-title">${mark(e.title, terms)}</div>
        ${snip ? `<div class="sr-snip">${mark(snip, terms)}</div>` : ''}</a>`;
    }).join('');
  }

  function searchHref(e, terms) {
    if (e.code) {
      const k = e.lb.indexOf(terms[0]);
      const line = k >= 0 ? e.body.slice(0, k).split('\n').length : 0;
      return href(e.path, line ? 'L' + line : '');
    }
    return href(e.path, e.frag);
  }

  function openSearch() {
    $('#search').hidden = false;
    const inp = $('#search-input');
    inp.focus();
    inp.select();
    doSearch(inp.value);
  }
  function closeSearch() { $('#search').hidden = true; }

  function goSearchHit(e) {
    const terms = $('#search-input').value.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    state.pendingTerms = e.code ? null : terms;
    const h = searchHref(e, terms);
    closeSearch();
    if (location.hash === h) {
      state.path = null;
      route();
    } else location.hash = h;
  }

  // ---------------- chrome ----------------

  function closeOverlays() {
    document.body.classList.remove('menu-open', 'toc-open');
    $('#settings-pop').hidden = true;
  }

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    LS.set('theme', t);
    $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t));
    document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0f172a' : '#ffffff';
  }

  function setFont(delta) {
    const root = document.documentElement;
    if (delta === 0) {
      root.style.removeProperty('--fs');
      LS.del('fontSize');
      return;
    }
    const cur = parseFloat(getComputedStyle(root).getPropertyValue('--fs')) || 16;
    const v = Math.max(13, Math.min(24, cur + delta));
    root.style.setProperty('--fs', v + 'px');
    LS.set('fontSize', v);
  }

  function bindChrome() {
    $('#btn-menu').onclick = () => document.body.classList.toggle('menu-open');
    $('#scrim').onclick = closeOverlays;
    $('#btn-toc').onclick = () => document.body.classList.toggle('toc-open');
    $('#btn-toc-close').onclick = closeOverlays;
    $('#btn-search').onclick = openSearch;
    $('#search-close').onclick = closeSearch;
    $('#search').addEventListener('click', (e) => { if (e.target.id === 'search') closeSearch(); });
    $('#to-top').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

    $('#btn-settings').onclick = (e) => {
      e.stopPropagation();
      $('#settings-pop').hidden = !$('#settings-pop').hidden;
    };
    document.addEventListener('click', (e) => {
      const pop = $('#settings-pop');
      if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
    });
    $$('[data-theme-set]').forEach((b) => { b.onclick = () => setTheme(b.dataset.themeSet); });
    setTheme(document.documentElement.dataset.theme || 'dark');
    $('#fs-inc').onclick = () => setFont(1);
    $('#fs-dec').onclick = () => setFont(-1);
    $('#fs-reset').onclick = () => setFont(0);
    $('#btn-logout').onclick = logout;
    $('#btn-reset-progress').onclick = () => {
      if (!confirm('Сбросить весь прогресс: отметки модулей, позиции чтения и чек-листы?')) return;
      ['done', 'read', 'pos', 'tasks', 'last'].forEach(LS.del);
      state.path = null;
      route();
      toast('Прогресс сброшен');
    };

    $('#toc-list').addEventListener('click', (e) => {
      if (e.target.closest('a')) document.body.classList.remove('toc-open');
    });

    const inp = $('#search-input');
    let t = 0;
    inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => doSearch(inp.value), 120); });
    inp.addEventListener('keydown', (e) => {
      const items = $$('#search-results .sr');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((a, i) => a.classList.toggle('sel', i === searchSel));
        items[searchSel].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (searchHits[searchSel]) goSearchHit(searchHits[searchSel]);
      }
    });
    $('#search-results').addEventListener('click', (e) => {
      const a = e.target.closest('.sr');
      if (!a) return;
      e.preventDefault();
      goSearchHit(searchHits[+a.dataset.i]);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
      if (e.key === 'Escape') { closeSearch(); closeOverlays(); return; }
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    });

    let sx = 0;
    let sy = 0;
    document.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
      if (dx > 0 && sx < 30) document.body.classList.add('menu-open');
      if (dx < 0 && document.body.classList.contains('menu-open')) document.body.classList.remove('menu-open');
    }, { passive: true });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', () => {
      if (state.path && state.path !== 'README.md') progress.setPos(state.path, scrollY);
    });
  }

  function start() {
    MOD = Object.fromEntries(DATA.modules.map((m) => [m.id, m]));
    SEQ = ['README.md', ...DATA.parts.flatMap((p) => p.modules).map((id) => MOD[id].readme)];
    $('#boot').hidden = true;
    $('#login').hidden = true;
    $('#app').hidden = false;
    bindChrome();
    route();
  }

  boot();
})();
