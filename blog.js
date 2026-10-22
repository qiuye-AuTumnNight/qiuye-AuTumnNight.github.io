/*!
 * 秋叶的窝 —— 博客前台
 *
 * 文章和留言都存在仓库里的 data.json，通过 GitHub Contents API 提交，
 * 所以 GitHub 既是托管也是后端。写入需要一个只授权本仓库 Contents 读写
 * 的细粒度令牌，令牌只存在访问者本机的 localStorage 里。
 */
(() => {
  'use strict';

  const OWNER = 'qiuye-AuTumnNight';
  const REPO = 'qiuye-AuTumnNight.github.io';
  const BRANCH = 'main';
  const DATA_PATH = 'data.json';
  const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO;
  const TOKEN_KEY = 'blog.token';

  const view = document.getElementById('view');
  const sheet = document.getElementById('sheet');
  const sheetTitle = document.getElementById('sheetTitle');
  const sheetBody = document.getElementById('sheetBody');
  const toastEl = document.getElementById('toast');

  /* ==================== 状态 ==================== */
  const state = {
    data: { posts: [], comments: [] },
    token: '',
    loaded: false,
    offline: false,
  };

  try {
    state.token = localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    state.token = '';
  }

  /* ==================== 小工具 ==================== */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);
  }

  function fmtDate(iso, withTime) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const date = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (!withTime) return date;
    return date + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function inlineMd(t) {
    return t
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  // 先整体转义，再只注入我们自己生成的标签 —— 留言是他人输入，不能直接拼 HTML
  function richText(raw) {
    const out = [];
    esc(raw).split(/\n{2,}/).forEach((block) => {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) return;

      const isUl = lines.every((l) => /^\s*[-*+]\s+/.test(l));
      const isOl = !isUl && lines.every((l) => /^\s*\d+[.)]\s+/.test(l));

      if (isUl || isOl) {
        const tag = isUl ? 'ul' : 'ol';
        const items = lines.map((l) =>
          '<li>' + inlineMd(l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')) + '</li>');
        out.push('<' + tag + ' class="md-list">' + items.join('') + '</' + tag + '>');
      } else {
        out.push('<p>' + inlineMd(block.replace(/\n/g, '<br>')) + '</p>');
      }
    });
    return out.join('');
  }

  function excerpt(body, max) {
    // 摘要是纯文本预览，得先把 markdown 记号摘掉，否则会露出 ** 和 - 列表符
    const flat = String(body || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*]/g, '')
      .replace(/^\s*(?:[-*+]|#{1,6})\s+/gm, '')
      .replace(/\s+([，。、；：！？])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length <= max ? flat : flat.slice(0, max) + '…';
  }

  let toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('is-error', !!isError);
    // 弹层打开时把提示挪到顶部：底部的位置会被弹层自己的按钮压住
    toastEl.classList.toggle('toast--top', !sheet.hidden);
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, isError ? 5200 : 2600);
  }

  /* ==================== 数据 ==================== */
  function normalize(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const posts = Array.isArray(d.posts) ? d.posts.filter((p) => p && p.id && p.title) : [];
    const comments = Array.isArray(d.comments) ? d.comments.filter((c) => c && c.id && c.text) : [];
    return { posts: posts, comments: comments };
  }

  async function loadData() {
    try {
      const res = await fetch('./' + DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = normalize(await res.json());
    } catch (e) {
      // 离线 / 弱网：退回 Service Worker 里的缓存副本
      try {
        const cached = await caches.match('./' + DATA_PATH);
        if (cached) {
          state.data = normalize(await cached.json());
          state.offline = true;
        }
      } catch (err) { /* 没有缓存就保持空 */ }
    }
    state.loaded = true;
  }

  function sortedPosts() {
    return state.data.posts.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return new Date(b.date || 0) - new Date(a.date || 0);
    });
  }

  function commentsFor(postId) {
    return state.data.comments
      .filter((c) => (postId ? c.post === postId : !c.post))
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  }

  /* ==================== Base64（UTF-8 安全） ==================== */
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ==================== GitHub Contents API ==================== */
  function authHeaders() {
    return {
      Authorization: 'Bearer ' + state.token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  }

  function apiErrorText(status, raw) {
    let msg = '';
    try { msg = (JSON.parse(raw) || {}).message || ''; } catch (e) { msg = ''; }
    if (status === 401) return '令牌无效或已过期，请重新填写';
    if (status === 403) return '令牌权限不够：Contents 需要设为 Read and write';
    if (status === 404) return '找不到仓库或文件：确认令牌已勾选 ' + REPO;
    if (status === 409) return '远端刚被改过，请重试一次';
    if (status === 422) return '提交被拒绝：' + (msg || '内容可能为空');
    return '提交失败（HTTP ' + status + '）' + (msg ? '：' + msg : '');
  }

  async function fetchRemote() {
    const res = await fetch(API + '/contents/' + DATA_PATH + '?ref=' + BRANCH, {
      headers: authHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(apiErrorText(res.status, await res.text()));
    const json = await res.json();
    return { sha: json.sha, data: normalize(JSON.parse(b64decode(json.content || ''))) };
  }

  /** 读远端最新版本 → 交给 mutate 修改 → 提交回仓库 */
  async function commitData(mutate, message) {
    if (!state.token) throw new Error('NO_TOKEN');
    const remote = await fetchRemote();
    mutate(remote.data);
    const body = {
      message: message,
      content: b64encode(JSON.stringify(remote.data, null, 2) + '\n'),
      sha: remote.sha,
      branch: BRANCH,
    };
    const res = await fetch(API + '/contents/' + DATA_PATH, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(apiErrorText(res.status, await res.text()));
    state.data = remote.data;
    return remote.data;
  }

  function errorText(e) {
    if (e && e.message === 'NO_TOKEN') return '还没有填写令牌';
    if (e && e.name === 'TypeError') return '网络不通，稍后再试';
    return (e && e.message) || '出错了';
  }

  /* ==================== 路由 ==================== */
  function currentRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')).trim();
    if (h.indexOf('p/') === 0) return { name: 'post', id: h.slice(2) };
    if (h === 'guest') return { name: 'guest' };
    return { name: 'home' };
  }

  function updateNav() {
    const name = currentRoute().name;
    document.querySelectorAll('#nav a').forEach((a) => {
      const key = a.dataset.nav;
      a.classList.toggle('is-active',
        (key === 'home' && name === 'home') || (key === 'guest' && name === 'guest'));
    });
  }

  /* ==================== 渲染：首页 ==================== */
  function postCard(p) {
    const n = commentsFor(p.id).length;
    const tags = (p.tags || []).map((t) => '<span class="chip">' + esc(t) + '</span>').join('');
    return '<a class="post" href="#/p/' + esc(p.id) + '">'
      + '<span class="post__date">' + esc(fmtDate(p.date)) + '</span>'
      + '<span class="post__title">' + esc(p.title) + '</span>'
      + '<span class="post__excerpt">' + esc(excerpt(p.body, 96)) + '</span>'
      + '<span class="post__foot">' + (tags || '<span></span>')
      + '<span class="post__meta">' + (n ? '💬 ' + n : '') + '</span></span>'
      + '</a>';
  }

  function renderHome() {
    const posts = sortedPosts();
    const intro = '<header class="hero">'
      + '<p class="hero__eyebrow">LEAVES</p>'
      + '<h1 class="hero__title">秋叶的窝</h1>'
      + '<p class="hero__sub">史上最帅高中生</p>'
      + '</header>';

    if (!state.loaded) {
      view.innerHTML = intro + '<div class="loading">正在读取……</div>';
      return;
    }

    if (!posts.length) {
      view.innerHTML = intro
        + '<div class="empty">还没有文章。<br>点下面的按钮写第一篇吧。</div>'
        + '<div class="feed__actions"><button type="button" class="btn btn--primary" id="btnNew">✎ 写点什么</button></div>';
      document.getElementById('btnNew').addEventListener('click', () => openComposer('post'));
      return;
    }

    view.innerHTML = intro
      + '<div class="feed__head">'
      + '<h2 class="feed__label">最近的记录 <span class="feed__count">' + posts.length + '</span></h2>'
      + '<button type="button" class="btn btn--ghost" id="btnNew">✎ 写</button>'
      + '</div>'
      + '<div class="feed">' + posts.map(postCard).join('') + '</div>'
      + '<div class="feed__actions">'
      + '<a class="btn btn--primary" href="./games.html">进入游戏盒 →</a>'
      + '</div>';

    document.getElementById('btnNew').addEventListener('click', () => openComposer('post'));
  }

  /* ==================== 渲染：文章详情 ==================== */
  function commentList(list, emptyText) {
    if (!list.length) return '<p class="comments__empty">' + emptyText + '</p>';
    // 删除按钮只给有令牌的人看：访客看到的应该是干净的阅读界面
    const canDel = !!state.token;
    return '<ul class="comments__list">' + list.map((c) => {
      return '<li class="comment">'
        + '<div class="comment__head"><b>' + esc(c.name || '匿名') + '</b>'
        + '<time>' + esc(fmtDate(c.date, true)) + '</time>'
        + (canDel ? '<button type="button" class="mini-btn comment__del" data-cid="'
          + esc(c.id) + '">删除</button>' : '')
        + '</div>'
        + '<div class="comment__text">' + richText(c.text) + '</div>'
        + '</li>';
    }).join('') + '</ul>';
  }

  function wireCommentDeletes() {
    if (!state.token) return;
    view.querySelectorAll('.comment__del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const c = state.data.comments.find((x) => x.id === btn.dataset.cid);
        if (c) confirmDeleteComment(c);
      });
    });
  }

  function renderPost(id) {
    const post = state.data.posts.find((p) => p.id === id);
    if (!post) {
      view.innerHTML = '<div class="empty">这篇文章找不到了。<br><a class="link" href="#/">回到首页</a></div>';
      return;
    }
    const list = commentsFor(id);
    const tags = (post.tags || []).map((t) => '<span class="chip">' + esc(t) + '</span>').join('');
    view.innerHTML = '<article class="article">'
      + '<a class="back" href="#/">‹ 返回</a>'
      + '<h1 class="article__title">' + esc(post.title) + '</h1>'
      + '<div class="article__meta">' + esc(fmtDate(post.date)) + (tags ? ' · ' + tags : '')
      + (state.token ? '<button type="button" class="mini-btn" id="btnDelPost">删除</button>' : '')
      + '</div>'
      + '<div class="article__body">' + richText(post.body) + '</div>'
      + '</article>'
      + '<section class="comments">'
      + '<div class="comments__head">'
      + '<h2 class="comments__title">评论 <span class="feed__count">' + list.length + '</span></h2>'
      + '<button type="button" class="btn btn--ghost" id="btnComment">写评论</button>'
      + '</div>'
      + commentList(list, '还没有评论，来说两句？')
      + '</section>';
    document.getElementById('btnComment').addEventListener('click', () => openComposer('comment', id));
    const delPost = document.getElementById('btnDelPost');
    if (delPost) delPost.addEventListener('click', () => confirmDeletePost(post));
    wireCommentDeletes();
  }

  /* ==================== 渲染：留言板 ==================== */
  function renderGuest() {
    const list = commentsFor(null);
    view.innerHTML = '<header class="hero hero--compact">'
      + '<p class="hero__eyebrow">GUESTBOOK</p>'
      + '<h1 class="hero__title">留言板</h1>'
      + '<p class="hero__sub">随便写点什么，会一直留在这儿。</p>'
      + '</header>'
      + '<div class="feed__actions"><button type="button" class="btn btn--primary" id="btnGuest">✎ 写留言</button></div>'
      + '<section class="comments">' + commentList(list, '这里还空着，第一条留给你。') + '</section>';
    document.getElementById('btnGuest').addEventListener('click', () => openComposer('guest'));
    wireCommentDeletes();
  }

  function render() {
    updateNav();
    const r = currentRoute();
    if (r.name === 'post') renderPost(r.id);
    else if (r.name === 'guest') renderGuest();
    else renderHome();

    const sync = document.getElementById('footSync');
    if (state.offline) {
      sync.hidden = false;
      sync.textContent = '当前显示的是本地缓存，联网后刷新可获取最新内容';
    } else {
      sync.hidden = true;
    }
  }

  /* ==================== 弹层 ==================== */
  function openSheet(title, html) {
    // 清掉残留提示，否则它可能正好压在弹层的按钮上
    toastEl.hidden = true;
    if (toastTimer) clearTimeout(toastTimer);
    sheetTitle.textContent = title;
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    document.body.classList.add('is-locked');
    const first = sheetBody.querySelector('input, textarea');
    if (first && window.innerWidth > 720) first.focus();
  }

  function closeSheet() {
    sheet.hidden = true;
    document.body.classList.remove('is-locked');
    sheetBody.innerHTML = '';
  }

  /* ==================== 令牌设置 ==================== */
  function openTokenSheet() {
    openSheet('需要一个令牌', `
      <p class="sheet__note">
        文章和留言都会直接提交到你的 GitHub 仓库，所以需要一个令牌来授权。
        令牌只保存在这台设备的浏览器里，不会发到别处。
      </p>
      <ol class="steps">
        <li>点开 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">新建细粒度令牌</a></li>
        <li>Repository access 选 <b>Only select repositories</b>，只勾 <code>${esc(REPO)}</code></li>
        <li>Permissions → Repository permissions → <b>Contents</b> 设成 <b>Read and write</b></li>
        <li>生成后把令牌粘到下面</li>
      </ol>
      <label class="field">
        <span class="field__label">GitHub 令牌</span>
        <input class="input" id="fToken" type="password" autocomplete="off" spellcheck="false"
               placeholder="github_pat_..." value="${esc(state.token)}">
      </label>
      <div class="sheet__actions">
        <button type="button" class="btn btn--ghost" id="fCancel">取消</button>
        <button type="button" class="btn btn--primary" id="fSave">保存</button>
      </div>
      ${state.token ? '<button type="button" class="sheet__danger" id="fForget">清除本机保存的令牌</button>' : ''}
    `);

    document.getElementById('fCancel').addEventListener('click', closeSheet);
    document.getElementById('fSave').addEventListener('click', () => {
      const v = document.getElementById('fToken').value.trim();
      if (!v) { toast('请先粘贴令牌', true); return; }
      state.token = v;
      try { localStorage.setItem(TOKEN_KEY, v); } catch (e) { /* 隐私模式 */ }
      closeSheet();
      toast('令牌已保存');
    });
    const forget = document.getElementById('fForget');
    if (forget) {
      forget.addEventListener('click', () => {
        state.token = '';
        try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* 忽略 */ }
        closeSheet();
        toast('已清除令牌');
      });
    }
  }

  /* ==================== 删除 ==================== */
  // 删除是不可逆的，所以走二次确认；确认层复用了编辑弹层，样式和交互都一致
  function openConfirm(title, noteHtml, onConfirm) {
    openSheet(title, ''
      + '<p class="sheet__note">' + noteHtml + '</p>'
      + '<div class="sheet__actions">'
      + '<button type="button" class="btn btn--ghost" id="fCancel">取消</button>'
      + '<button type="button" class="btn btn--danger" id="fConfirm">删除</button>'
      + '</div>');
    document.getElementById('fCancel').addEventListener('click', closeSheet);

    const btn = document.getElementById('fConfirm');
    btn.addEventListener('click', async () => {
      setBusy(btn, true, '删除中…');
      try {
        await onConfirm();
      } catch (e) {
        if (e && e.message === 'NO_TOKEN') { closeSheet(); openTokenSheet(); return; }
        toast(errorText(e), true);
      } finally {
        setBusy(btn, false);
      }
    });
  }

  function confirmDeletePost(post) {
    const kids = commentsFor(post.id).length;
    openConfirm('删除这篇文章',
      '「<b>' + esc(post.title) + '</b>」会被永久删除，'
      + (kids ? '它下面的 <b>' + kids + '</b> 条评论也会一起删掉，' : '')
      + '这个操作不能撤销。',
      async () => {
        await commitData((d) => {
          d.posts = d.posts.filter((p) => p.id !== post.id);
          // 文章没了，挂在它下面的评论也要清掉，否则会留下无主的孤儿数据
          d.comments = d.comments.filter((c) => c.post !== post.id);
        }, 'delete post: ' + post.title);
        closeSheet();
        toast('已删除，GitHub Pages 约 1 分钟后生效');
        location.hash = '#/';
        render();
      });
  }

  function confirmDeleteComment(c) {
    openConfirm('删除这条留言',
      '「<b>' + esc(excerpt(c.text, 40)) + '</b>」会被永久删除，这个操作不能撤销。',
      async () => {
        await commitData((d) => {
          d.comments = d.comments.filter((x) => x.id !== c.id);
        }, 'delete comment: ' + excerpt(c.text, 20));
        closeSheet();
        toast('已删除，GitHub Pages 约 1 分钟后生效');
        render();
      });
  }

  /* ==================== 编辑器 ==================== */
  function openComposer(mode, postId) {
    if (!state.token) { openTokenSheet(); return; }

    if (mode === 'post') {
      openSheet('写点什么', `
        <label class="field">
          <span class="field__label">标题</span>
          <input class="input" id="fTitle" maxlength="80" placeholder="给这篇起个标题">
        </label>
        <label class="field">
          <span class="field__label">正文</span>
          <textarea class="input input--area" id="fBody" rows="9" maxlength="8000"
            placeholder="支持空行分段、**加粗**、\`代码\` 和 [链接](https://…)"></textarea>
        </label>
        <label class="field">
          <span class="field__label">标签<span class="field__hint">可选，空格分隔</span></span>
          <input class="input" id="fTags" maxlength="40" placeholder="比如：更新 游戏">
        </label>
        <div class="sheet__actions">
          <button type="button" class="btn btn--ghost" id="fCancel">取消</button>
          <button type="button" class="btn btn--primary" id="fSubmit">发布</button>
        </div>
      `);
    } else {
      const isGuest = mode === 'guest';
      openSheet(isGuest ? '写留言' : '写评论', `
        <label class="field">
          <span class="field__label">署名</span>
          <input class="input" id="fName" maxlength="20" value="秋叶" placeholder="怎么称呼你">
        </label>
        <label class="field">
          <span class="field__label">内容</span>
          <textarea class="input input--area" id="fText" rows="6" maxlength="2000"
            placeholder="想说的话……"></textarea>
        </label>
        <div class="sheet__actions">
          <button type="button" class="btn btn--ghost" id="fCancel">取消</button>
          <button type="button" class="btn btn--primary" id="fSubmit">发出</button>
        </div>
      `);
    }

    document.getElementById('fCancel').addEventListener('click', closeSheet);
    document.getElementById('fSubmit').addEventListener('click', (ev) => {
      submit(mode, postId, ev.currentTarget);
    });
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    btn.disabled = busy;
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || '提交中…';
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
  }

  async function submit(mode, postId, btn) {
    const now = new Date().toISOString();

    if (mode === 'post') {
      const title = document.getElementById('fTitle').value.trim();
      const body = document.getElementById('fBody').value.trim();
      const tags = document.getElementById('fTags').value.trim().split(/\s+/).filter(Boolean).slice(0, 4);
      if (!title) { toast('标题不能为空', true); return; }
      if (!body) { toast('正文不能为空', true); return; }

      setBusy(btn, true, '发布中…');
      try {
        const post = { id: newId('p'), title: title, body: body, tags: tags, date: now };
        await commitData((d) => { d.posts.unshift(post); }, 'post: ' + title);
        closeSheet();
        toast('已发布，GitHub Pages 约 1 分钟后对外生效');
        location.hash = '#/p/' + post.id;
        render();
      } catch (e) {
        if (e && e.message === 'NO_TOKEN') { closeSheet(); openTokenSheet(); return; }
        toast(errorText(e), true);
      } finally {
        setBusy(btn, false);
      }
      return;
    }

    const text = document.getElementById('fText').value.trim();
    const name = document.getElementById('fName').value.trim() || '匿名';
    if (!text) { toast('内容不能为空', true); return; }

    setBusy(btn, true, '发送中…');
    try {
      const c = { id: newId('c'), text: text, name: name, date: now };
      if (mode === 'comment' && postId) c.post = postId;
      await commitData((d) => { d.comments.unshift(c); }, (mode === 'guest' ? 'guestbook: ' : 'comment: ') + excerpt(text, 24));
      closeSheet();
      toast('已发出，GitHub Pages 约 1 分钟后对外生效');
      render();
    } catch (e) {
      if (e && e.message === 'NO_TOKEN') { closeSheet(); openTokenSheet(); return; }
      toast(errorText(e), true);
    } finally {
      setBusy(btn, false);
    }
  }

  /* ==================== 启动 ==================== */
  async function init() {
    document.getElementById('sheetClose').addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.hidden) closeSheet();
    });

    window.addEventListener('hashchange', () => {
      render();
      window.scrollTo(0, 0);
    });

    render();
    await loadData();
    render();

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线能力可选 */ });
      });
    }
  }

  init();
})();
