/* ==========================================================================
   도립 물구나무 훈련소 — app.js
   정적 페이지 + Supabase(인증 · 회원 승인 · 영상 목록)
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 설정 */
  var cfg = window.DOLIB_CONFIG || {};
  var studio = cfg.studio || {};
  var links = cfg.links || {};
  var ui = cfg.ui || {};

  var state = {
    sb: null,
    configured: false,
    authChecked: false,
    session: null,
    user: null,
    profile: null,
    profileState: 'idle',     // idle | loading | ready | missing | error
    profileError: '',
    videos: [],
    activeChapter: '__all',
    adminTab: 'members',
    members: [],
    membersLoading: false,
    editingVideoId: null,
    route: 'home'
  };

  /* ---------------------------------------------------------------- 유틸 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + d.getDate()).slice(-2);
  }

  function setMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-ok', !!ok);
  }

  function authErrorText(err) {
    var msg = (err && err.message) || '';
    var code = (err && err.code) || '';
    if (/Invalid login credentials/i.test(msg) || code === 'invalid_credentials') {
      return '이메일 또는 비밀번호가 올바르지 않습니다.';
    }
    if (/Email not confirmed/i.test(msg)) {
      return '이메일 인증이 아직 완료되지 않았습니다. 가입 확인 메일의 링크를 눌러 주세요.';
    }
    if (/User already registered/i.test(msg)) {
      return '이미 가입된 이메일입니다. 로그인해 주세요.';
    }
    if (/Password should be at least/i.test(msg)) {
      return '비밀번호는 6자 이상이어야 합니다.';
    }
    if (/rate limit|too many/i.test(msg)) {
      return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (/Failed to fetch|NetworkError|network/i.test(msg)) {
      return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    return msg || '알 수 없는 오류가 발생했습니다.';
  }

  /* ---------------------------------------------------------------- 영상 주소 해석 */
  function youtubeStart(params) {
    var raw = params.get('t') || params.get('start') || '';
    if (!raw) return '';
    if (/^\d+$/.test(raw)) return raw;
    var m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return '';
    var sec = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    return sec ? String(sec) : '';
  }

  function youtubeInfo(id, start) {
    id = String(id || '');
    if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) return null;
    var src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1&playsinline=1';
    if (start) src += '&start=' + encodeURIComponent(start);
    return { kind: 'youtube', embed: src, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
  }

  function parseVideoUrl(raw) {
    var value = String(raw || '').trim();
    if (!value) return null;
    if (/^[\w-]{11}$/.test(value)) return youtubeInfo(value, '');

    var url;
    try { url = new URL(value); } catch (e) { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    var host = url.hostname.replace(/^www\./, '').toLowerCase();
    var parts, id;

    if (host === 'youtu.be') {
      id = url.pathname.split('/').filter(Boolean)[0];
      return youtubeInfo(id, youtubeStart(url.searchParams));
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') {
        return youtubeInfo(url.searchParams.get('v'), youtubeStart(url.searchParams));
      }
      parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && /^(embed|shorts|live|v|e)$/.test(parts[0])) {
        return youtubeInfo(parts[1], youtubeStart(url.searchParams));
      }
      return null;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      parts = url.pathname.split('/').filter(Boolean);
      for (var i = parts.length - 1; i >= 0; i--) {
        if (/^\d{6,}$/.test(parts[i])) {
          return { kind: 'vimeo', embed: 'https://player.vimeo.com/video/' + parts[i] + '?dnt=1', thumb: '' };
        }
      }
      return null;
    }
    if (/\.(mp4|webm|ogv|ogg|m4v|mov)(\?|#|$)/i.test(url.pathname + url.search)) {
      return { kind: 'file', embed: url.href, thumb: '' };
    }
    return null;
  }

  function videoMarkup(info, title) {
    if (info.kind === 'file') {
      return '<div class="video-frame"><video controls playsinline preload="metadata" src="' +
        escapeHtml(info.embed) + '"></video></div>';
    }
    return '<div class="video-frame"><iframe src="' + escapeHtml(info.embed) +
      '" title="' + escapeHtml(title || '훈련 영상') +
      '" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  }

  /* ---------------------------------------------------------------- 라우팅 */
  var VALID_ROUTES = { home: 1, guide: 1, admin: 1 };

  function routeFromHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (h.indexOf('pricing') === 0 || h === 'pricing') return 'home';
    return VALID_ROUTES[h] ? h : 'home';
  }

  function navigate(route) {
    state.route = route;
    ['home', 'guide', 'admin'].forEach(function (name) {
      var view = document.getElementById('view-' + name);
      if (view) view.hidden = name !== route;
    });
    $$('[data-tab]').forEach(function (el) {
      el.classList.toggle('is-active', el.getAttribute('data-tab') === route);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (route === 'guide') renderGuide();
    if (route === 'admin') renderAdmin();
    if (route === 'home' && location.hash && location.hash.indexOf('pricing') !== -1) {
      var target = document.getElementById('pricing');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function initRouter() {
    window.addEventListener('hashchange', function () {
      var route = routeFromHash();
      if (route === state.route) {
        if (location.hash.indexOf('pricing') !== -1) {
          var target = document.getElementById('pricing');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      navigate(route);
    });
    navigate(routeFromHash());
  }

  /* ---------------------------------------------------------------- 설정 반영 */
  function initSiteCopy() {
    if (studio.address) {
      var addr = $('#studioAddress');
      if (addr) addr.textContent = studio.address;
      var faddr = $('#footerAddress');
      if (faddr) faddr.textContent = studio.address;
    }
    var mapQ = studio.mapQuery || studio.name || '도립 물구나무 훈련소';
    var mapLink = $('#mapLink');
    if (mapLink) mapLink.href = 'https://map.naver.com/p/search/' + encodeURIComponent(mapQ);

    if (ui.guideIntro) {
      var lede = $('#view-guide .view-head .lede');
      if (lede) lede.textContent = ui.guideIntro;
    }
    if (ui.pendingTitle) $('#pendingTitle').textContent = ui.pendingTitle;
    if (ui.pendingBody) $('#pendingBody').textContent = ui.pendingBody;
    if (ui.contactNote) $('#contactNote').textContent = ui.contactNote;

    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    // 예약·문의 링크
    $$('.js-contact').forEach(function (el) {
      var key = el.getAttribute('data-contact');
      var url = key === 'booking' ? (links.booking || links.instagram || links.kakao) : links[key];
      if (url) {
        el.href = url;
        el.target = '_blank';
        el.rel = 'noopener';
      } else {
        el.href = '#';
        el.setAttribute('data-missing', '1');
      }
    });

    // 주소 복사
    var copyBtn = $('#copyAddressBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = studio.address || '';
        if (!text) return;
        var done = function () { toast('주소를 복사했습니다.'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { toast('복사에 실패했습니다. 주소를 길게 눌러 복사해 주세요.'); });
        } else {
          toast('주소: ' + text);
        }
      });
    }
  }

  function initContactGuard() {
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest ? ev.target.closest('.js-contact') : null;
      if (!el) return;
      if (el.getAttribute('data-missing') === '1') {
        ev.preventDefault();
        toast('아직 연결되지 않은 링크입니다. 도립맨님께 문의해 주세요.');
      }
    });
  }

  /* ---------------------------------------------------------------- Supabase 초기화 */
  function readConfig() {
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    var key = String(cfg.SUPABASE_ANON_KEY || '').trim();
    return {
      url: url,
      key: key,
      ok: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && key.length > 20 && !/YOUR-/i.test(key)
    };
  }

  function initSupabase() {
    var conf = readConfig();
    state.configured = conf.ok;
    if (!conf.ok) {
      $('#configNotice').hidden = false;
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      state.configured = false;
      $('#configNotice').hidden = false;
      $('#configNotice').querySelector('span').textContent =
        '인증 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 새로고침해 주세요.';
      return;
    }

    state.sb = window.supabase.createClient(conf.url, conf.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    state.sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT') {
        state.session = null;
        state.user = null;
        state.profile = null;
        state.profileState = 'idle';
        state.videos = [];
        state.members = [];
        renderAll();
        return;
      }
      state.authChecked = true;
      if (session && (!state.session || state.session.user.id !== session.user.id)) {
        state.session = session;
        state.user = session.user;
        loadProfile();
      } else if (!session && !state.session) {
        renderAll();
      }
    });

    state.sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      state.authChecked = true;
      if (session) {
        if (state.session && state.session.user && state.session.user.id === session.user.id) {
          renderAll();
          return;
        }
        state.session = session;
        state.user = session.user;
        loadProfile();
      } else {
        renderAll();
      }
    }, function () {
      state.authChecked = true;
      renderAll();
    });
  }

  /* ---------------------------------------------------------------- 프로필 */
  function isAdmin(profile) {
    return !!profile && profile.role === 'admin';
  }
  function canView(profile) {
    return !!profile && (profile.approved === true || profile.role === 'admin');
  }

  function loadProfile() {
    if (!state.sb || !state.user) { renderAll(); return; }
    state.profileState = 'loading';
    state.profileError = '';
    renderAll();

    state.sb.from('profiles')
      .select('id,name,email,approved,role,created_at')
      .eq('id', state.user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) {
          state.profileState = 'error';
          state.profileError = res.error.message || '프로필을 불러오지 못했습니다.';
          renderAll();
          return;
        }
        if (!res.data) {
          state.profileState = 'missing';
          renderAll();
          return;
        }
        state.profile = res.data;
        state.profileState = 'ready';
        renderAll();
      });
  }

  function renderAccount() {
    var box = $('#accountBox');
    if (!box) return;
    var p = state.profile;
    var user = state.user;
    if (!user) { box.innerHTML = ''; return; }
    var name = (p && p.name) || (user.user_metadata && user.user_metadata.name) || (user.email || '').split('@')[0];
    var initial = String(name).trim().charAt(0) || '회';
    box.innerHTML = '<span class="account-chip" title="' + escapeHtml(user.email || '') + '">' +
      '<span class="avatar">' + escapeHtml(initial) + '</span>' +
      '<span class="who">' + escapeHtml(name) + '</span></span>';

    var admin = isAdmin(p);
    var adminTab = $('#adminTab');
    var adminBottom = $('#adminBottomTab');
    if (adminTab) adminTab.hidden = !admin;
    if (adminBottom) adminBottom.hidden = !admin;
  }

  /* ---------------------------------------------------------------- 가이드북 */
  function setGuidePanel(which) {
    ['authPanel', 'pendingPanel', 'loadingPanel', 'setupPanel', 'videosPanel'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = id !== which;
    });
  }

  function renderGuide() {
    if (state.route !== 'guide') return;

    if (!state.configured) {
      setGuidePanel('setupPanel');
      $('#setupBody').textContent = 'Supabase 연결 정보가 아직 입력되지 않았습니다. config.js의 SUPABASE_URL과 SUPABASE_ANON_KEY를 채우면 회원 로그인과 영상 기능이 켜집니다.';
      return;
    }
    if (!state.authChecked) { setGuidePanel('loadingPanel'); return; }
    if (!state.user) { setGuidePanel('authPanel'); return; }

    if (state.profileState === 'loading' || state.profileState === 'idle') {
      setGuidePanel('loadingPanel');
      return;
    }
    if (state.profileState === 'error') {
      setGuidePanel('setupPanel');
      $('#setupBody').textContent = '회원 정보를 불러오지 못했습니다. (' + state.profileError + ') 새로고침 후에도 계속되면 도립맨님께 알려 주세요.';
      return;
    }
    if (state.profileState === 'missing') {
      setGuidePanel('pendingPanel');
      $('#pendingTitle').textContent = '프로필 준비 중';
      $('#pendingBody').textContent = '가입은 완료되었지만 회원 정보가 아직 만들어지지 않았습니다. 잠시 후 새로고침을 눌러 주세요. 계속되면 도립맨님께 알려 주세요.';
      $('#pendingUser').textContent = state.user.email || '';
      return;
    }

    if (!canView(state.profile)) {
      setGuidePanel('pendingPanel');
      $('#pendingTitle').textContent = ui.pendingTitle || '승인 대기 중';
      $('#pendingBody').textContent = ui.pendingBody || '';
      var p = state.profile;
      $('#pendingUser').textContent = (p.name ? p.name + ' · ' : '') + (p.email || state.user.email || '');
      return;
    }

    setGuidePanel('videosPanel');
    var name = (state.profile && state.profile.name) || '회원';
    $('#guideHello').innerHTML = '<strong>' + escapeHtml(name) + '</strong>님, 오늘도 안전하게 훈련하세요.';
    if (!state.videos.length) loadVideos();
  }

  function loadVideos() {
    if (!state.sb) return;
    state.sb.from('videos')
      .select('id,chapter,title,description,video_url,sort_order,created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) {
          $('#videoEmpty').hidden = false;
          $('#videoEmpty').textContent = '영상을 불러오지 못했습니다. (' + res.error.message + ')';
          $('#videoList').innerHTML = '';
          return;
        }
        state.videos = res.data || [];
        renderChapterChips();
        renderVideos();
        if (state.route === 'admin' && isAdmin(state.profile)) renderAdminVideos();
      });
  }

  function renderChapterChips() {
    var box = $('#chapterChips');
    var chapters = [];
    state.videos.forEach(function (v) {
      var c = (v.chapter || '기타').trim();
      if (chapters.indexOf(c) === -1) chapters.push(c);
    });
    if (state.activeChapter !== '__all' && chapters.indexOf(state.activeChapter) === -1) {
      state.activeChapter = '__all';
    }
    var html = '<button class="chip' + (state.activeChapter === '__all' ? ' is-active' : '') +
      '" type="button" data-chapter="__all" role="tab">전체</button>';
    chapters.forEach(function (c) {
      html += '<button class="chip' + (state.activeChapter === c ? ' is-active' : '') +
        '" type="button" data-chapter="' + escapeHtml(c) + '" role="tab">' + escapeHtml(c) + '</button>';
    });
    box.innerHTML = html;
  }

  function renderVideos() {
    var list = $('#videoList');
    var empty = $('#videoEmpty');
    var items = state.videos.filter(function (v) {
      return state.activeChapter === '__all' || ((v.chapter || '기타').trim() === state.activeChapter);
    });

    if (!items.length) {
      list.innerHTML = '';
      empty.hidden = false;
      empty.textContent = state.videos.length
        ? '이 챕터에는 아직 영상이 없습니다.'
        : '아직 등록된 영상이 없습니다. 도립맨님이 곧 올려 드립니다.';
      return;
    }
    empty.hidden = true;

    list.innerHTML = items.map(function (v) {
      var info = parseVideoUrl(v.video_url);
      var thumb = info && info.thumb
        ? '<img src="' + escapeHtml(info.thumb) + '" alt="" loading="lazy" />'
        : '';
      var chapter = (v.chapter || '기타').trim();
      return '<article class="video-card" data-id="' + escapeHtml(v.id) + '">' +
        '<button class="video-head" type="button" aria-expanded="false">' +
          '<span class="video-thumb">' + thumb + '<span class="play" aria-hidden="true">▶</span></span>' +
          '<span class="video-meta">' +
            '<span class="video-chapter">' + escapeHtml(chapter) + '</span>' +
            '<span class="video-title">' + escapeHtml(v.title || '') + '</span>' +
            (v.description ? '<span class="video-desc">' + escapeHtml(v.description) + '</span>' : '') +
          '</span>' +
          '<span class="video-chevron" aria-hidden="true">▼</span>' +
        '</button>' +
        '<div class="video-body"></div>' +
      '</article>';
    }).join('');
  }

  function toggleVideoCard(card) {
    if (!card) return;
    var body = card.querySelector('.video-body');
    var head = card.querySelector('.video-head');
    var open = !card.classList.contains('is-open');

    // 한 번에 하나만 재생
    $$('.video-card.is-open').forEach(function (other) {
      if (other === card) return;
      other.classList.remove('is-open');
      other.querySelector('.video-body').innerHTML = '';
      var h = other.querySelector('.video-head');
      if (h) h.setAttribute('aria-expanded', 'false');
    });

    card.classList.toggle('is-open', open);
    if (head) head.setAttribute('aria-expanded', open ? 'true' : 'false');

    if (!open) { body.innerHTML = ''; return; }

    var id = card.getAttribute('data-id');
    var video = state.videos.filter(function (v) { return String(v.id) === String(id); })[0];
    if (!video) { body.innerHTML = ''; return; }
    var info = parseVideoUrl(video.video_url);
    if (!info) {
      body.innerHTML = '<p class="video-note">영상 주소를 재생할 수 없습니다. 도립맨님께 알려 주세요.</p>';
      return;
    }
    body.innerHTML = videoMarkup(info, video.title);
  }

  /* ---------------------------------------------------------------- 관리자 */
  function renderAdmin() {
    if (state.route !== 'admin') return;
    var gate = $('#adminGate');
    var body = $('#adminBody');
    if (!state.user) {
      gate.hidden = false;
      gate.querySelector('h3').textContent = '로그인이 필요합니다';
      gate.querySelector('p').textContent = '회원 가이드북에서 관리자 계정으로 로그인해 주세요.';
      body.hidden = true;
      return;
    }
    if (state.profileState === 'loading' || state.profileState === 'idle') {
      gate.hidden = false;
      gate.querySelector('h3').textContent = '확인 중입니다';
      gate.querySelector('p').textContent = '회원 정보를 불러오는 중입니다.';
      body.hidden = true;
      return;
    }
    if (!isAdmin(state.profile)) {
      gate.hidden = false;
      gate.querySelector('h3').textContent = '관리자 전용입니다';
      gate.querySelector('p').textContent = '관리자 계정으로 로그인해 주세요.';
      body.hidden = true;
      return;
    }
    gate.hidden = true;
    body.hidden = false;
    switchAdminTab(state.adminTab);
  }

  function switchAdminTab(tab) {
    state.adminTab = tab === 'videos' ? 'videos' : 'members';
    $$('[data-admin-tab]').forEach(function (el) {
      var active = el.getAttribute('data-admin-tab') === state.adminTab;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('#adminMembers').hidden = state.adminTab !== 'members';
    $('#adminVideos').hidden = state.adminTab !== 'videos';
    if (state.adminTab === 'members') loadMembers();
    if (state.adminTab === 'videos') { loadVideos(); renderAdminVideos(); }
  }

  function loadMembers(force) {
    if (!state.sb || !isAdmin(state.profile)) return;
    if (state.membersLoading) return;
    if (state.members.length && !force) { renderMembers(); return; }
    state.membersLoading = true;
    $('#memberList').innerHTML = '<p class="empty">회원 목록을 불러오는 중입니다…</p>';

    state.sb.from('profiles')
      .select('id,name,email,approved,role,created_at')
      .order('created_at', { ascending: false })
      .then(function (res) {
        state.membersLoading = false;
        if (res.error) {
          $('#memberList').innerHTML = '<p class="empty">회원 목록을 불러오지 못했습니다. (' +
            escapeHtml(res.error.message) + ')</p>';
          return;
        }
        state.members = res.data || [];
        renderMembers();
      });
  }

  function renderMembers() {
    var list = $('#memberList');
    var empty = $('#memberEmpty');
    var members = state.members;
    $('#memberCount').textContent = members.length ? String(members.length) : '';

    if (!members.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = members.map(function (m) {
      var name = m.name || (m.email || '').split('@')[0] || '이름 없음';
      var badges = '';
      if (m.role === 'admin') badges += '<span class="badge is-admin">관리자</span>';
      badges += m.approved
        ? '<span class="badge is-approved">승인됨</span>'
        : '<span class="badge">대기</span>';
      var action = m.role === 'admin'
        ? '<span class="member-note">관리자 계정</span>'
        : '<button class="btn btn-sm member-toggle ' + (m.approved ? 'btn-danger' : 'btn-primary') +
            '" type="button" data-approve="' + escapeHtml(m.id) + '" data-next="' + (m.approved ? 'false' : 'true') + '">' +
            (m.approved ? '승인 취소' : '승인') +
          '</button>';
      return '<div class="member-row" data-id="' + escapeHtml(m.id) + '">' +
          '<div class="member-main">' +
            '<span class="member-name">' + escapeHtml(name) + badges + '</span>' +
            '<span class="member-email">' + escapeHtml(m.email || '') + '</span>' +
            '<span class="member-date">가입 ' + escapeHtml(formatDate(m.created_at)) + '</span>' +
          '</div>' + action +
        '</div>';
    }).join('');
  }

  function toggleApprove(button) {
    var id = button.getAttribute('data-approve');
    var next = button.getAttribute('data-next') === 'true';
    var member = state.members.filter(function (m) { return String(m.id) === String(id); })[0];
    if (!member) return;
    var memberName = member.name || member.email || '이 회원';
    if (!next && !window.confirm(memberName + ' 님의 승인을 취소할까요? 취소하면 다시 승인할 때까지 영상을 볼 수 없습니다.')) return;

    button.disabled = true;
    button.textContent = '처리 중…';
    state.sb.from('profiles').update({ approved: next }).eq('id', id).select('id,approved').then(function (res) {
      button.disabled = false;
      if (res.error) {
        button.textContent = next ? '승인' : '승인 취소';
        toast('변경하지 못했습니다. ' + res.error.message);
        return;
      }
      member.approved = next;
      renderMembers();
      toast(next ? memberName + ' 님을 승인했습니다.' : memberName + ' 님의 승인을 취소했습니다.');
    });
  }

  function renderAdminVideos() {
    var list = $('#adminVideoList');
    var empty = $('#adminVideoEmpty');
    var videos = state.videos;
    $('#videoCount').textContent = videos.length ? String(videos.length) : '';

    var chapterSet = [];
    videos.forEach(function (v) {
      var c = (v.chapter || '기타').trim();
      if (chapterSet.indexOf(c) === -1) chapterSet.push(c);
    });
    $('#chapterOptions').innerHTML = chapterSet.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"></option>';
    }).join('');

    if (!videos.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = videos.map(function (v) {
      var info = parseVideoUrl(v.video_url);
      var kind = info ? (info.kind === 'youtube' ? 'YouTube' : info.kind === 'vimeo' ? 'Vimeo' : '파일') : '확인 필요';
      return '<div class="admin-video-row" data-id="' + escapeHtml(v.id) + '">' +
          '<div>' +
            '<span class="video-title">' + escapeHtml(v.title || '') + '</span>' +
            '<div class="meta">' +
              '<span>' + escapeHtml((v.chapter || '기타')) + '</span>' +
              '<span>순서 ' + escapeHtml(v.sort_order == null ? 0 : v.sort_order) + '</span>' +
              '<span>' + kind + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="admin-video-actions">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-edit="' + escapeHtml(v.id) + '">수정</button>' +
            '<button class="btn btn-danger btn-sm" type="button" data-delete="' + escapeHtml(v.id) + '">삭제</button>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function resetVideoForm(keepOpen) {
    var form = $('#videoForm');
    form.reset();
    form.elements.sort_order.value = '0';
    state.editingVideoId = null;
    $('#videoFormTitle').textContent = '영상 추가';
    $('#videoSubmitBtn').textContent = '추가하기';
    setMsg(form.querySelector('[data-msg]'), '');
    if (!keepOpen) form.hidden = true;
  }

  function fillVideoForm(video) {
    var form = $('#videoForm');
    state.editingVideoId = video.id;
    form.hidden = false;
    form.elements.chapter.value = video.chapter || '';
    form.elements.title.value = video.title || '';
    form.elements.description.value = video.description || '';
    form.elements.video_url.value = video.video_url || '';
    form.elements.sort_order.value = video.sort_order == null ? 0 : video.sort_order;
    $('#videoFormTitle').textContent = '영상 수정';
    $('#videoSubmitBtn').textContent = '수정 저장';
    setMsg(form.querySelector('[data-msg]'), '');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submitVideoForm(form) {
    var msg = form.querySelector('[data-msg]');
    var chapter = form.elements.chapter.value.trim();
    var title = form.elements.title.value.trim();
    var description = form.elements.description.value.trim();
    var url = form.elements.video_url.value.trim();
    var sortOrder = parseInt(form.elements.sort_order.value, 10);

    if (!chapter) { setMsg(msg, '챕터를 입력해 주세요.'); form.elements.chapter.focus(); return; }
    if (!title) { setMsg(msg, '제목을 입력해 주세요.'); form.elements.title.focus(); return; }
    if (!url) { setMsg(msg, '영상 주소를 입력해 주세요.'); form.elements.video_url.focus(); return; }
    if (!parseVideoUrl(url)) {
      setMsg(msg, '재생할 수 없는 주소입니다. 유튜브·비메오 주소 또는 .mp4 파일 주소를 넣어 주세요.');
      form.elements.video_url.focus();
      return;
    }
    if (isNaN(sortOrder)) sortOrder = 0;

    var payload = {
      chapter: chapter,
      title: title,
      description: description || null,
      video_url: url,
      sort_order: sortOrder
    };

    var btn = $('#videoSubmitBtn');
    btn.disabled = true;
    var editing = state.editingVideoId;
    var request = editing
      ? state.sb.from('videos').update(payload).eq('id', editing)
      : state.sb.from('videos').insert(payload);

    request.then(function (res) {
      btn.disabled = false;
      if (res.error) {
        setMsg(msg, '저장하지 못했습니다. ' + res.error.message);
        return;
      }
      setMsg(msg, '');
      toast(editing ? '영상을 수정했습니다.' : '영상을 추가했습니다.');
      resetVideoForm();
      loadVideos();
      renderAdminVideos();
    });
  }

  function deleteVideo(id) {
    var video = state.videos.filter(function (v) { return String(v.id) === String(id); })[0];
    var title = video ? video.title : '이 영상';
    if (!window.confirm('"' + title + '" 영상을 삭제할까요?\n삭제하면 회원 화면에서도 사라집니다.')) return;
    state.sb.from('videos').delete().eq('id', id).then(function (res) {
      if (res.error) { toast('삭제하지 못했습니다. ' + res.error.message); return; }
      state.videos = state.videos.filter(function (v) { return String(v.id) !== String(id); });
      if (state.editingVideoId === id) resetVideoForm();
      renderAdminVideos();
      renderChapterChips();
      renderVideos();
      toast('영상을 삭제했습니다.');
    });
  }

  /* ---------------------------------------------------------------- 전체 렌더 */
  function renderAll() {
    renderAccount();
    renderGuide();
    renderAdmin();
  }

  /* ---------------------------------------------------------------- 인증 폼 */
  function initAuthForms() {
    $$('[data-auth-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-auth-tab');
        $$('[data-auth-tab]').forEach(function (t) {
          var active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        $('#loginForm').hidden = target !== 'login';
        $('#signupForm').hidden = target !== 'signup';
        setMsg($('#loginForm [data-msg]'), '');
        setMsg($('#signupForm [data-msg]'), '');
      });
    });

    $('#loginForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var msg = form.querySelector('[data-msg]');
      var email = form.elements.email.value.trim();
      var password = form.elements.password.value;
      if (!email || !password) { setMsg(msg, '이메일과 비밀번호를 입력해 주세요.'); return; }
      if (!state.sb) { setMsg(msg, '연결 설정을 먼저 확인해 주세요.'); return; }

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      setMsg(msg, '');
      state.sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
        btn.disabled = false;
        if (res.error) {
          var text = authErrorText(res.error);
          setMsg(msg, text);
          if (/이메일 인증/.test(text)) setMsg(msg, text + ' 메일이 오지 않으면 스팸함도 확인해 주세요.');
          return;
        }
        form.reset();
        toast('로그인했습니다.');
        if (state.route === 'guide') renderGuide();
      });
    });

    $('#signupForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var form = ev.currentTarget;
      var msg = form.querySelector('[data-msg]');
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      var password = form.elements.password.value;

      if (!name) { setMsg(msg, '이름을 입력해 주세요.'); form.elements.name.focus(); return; }
      if (!email) { setMsg(msg, '이메일을 입력해 주세요.'); form.elements.email.focus(); return; }
      if (!password || password.length < 6) { setMsg(msg, '비밀번호는 6자 이상으로 정해 주세요.'); form.elements.password.focus(); return; }
      if (!state.sb) { setMsg(msg, '연결 설정을 먼저 확인해 주세요.'); return; }

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      setMsg(msg, '');
      state.sb.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name } }
      }).then(function (res) {
        btn.disabled = false;
        if (res.error) { setMsg(msg, authErrorText(res.error)); return; }

        var user = res.data && res.data.user;
        if (user && Array.isArray(user.identities) && user.identities.length === 0) {
          setMsg(msg, '이미 가입된 이메일입니다. 로그인해 주세요.');
          return;
        }
        form.reset();
        if (res.data && res.data.session) {
          toast('가입이 완료되었습니다. 승인을 기다려 주세요.');
          state.session = res.data.session;
          state.user = res.data.user;
          loadProfile();
        } else {
          setMsg(msg, '가입 신청이 접수되었습니다. 받은 메일의 인증 링크를 누른 뒤 로그인해 주세요.', true);
          toast('가입 확인 메일을 보냈습니다.');
        }
      });
    });

    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-logout]') : null;
      if (!btn) return;
      if (!state.sb) return;
      state.sb.auth.signOut().then(function () {
        toast('로그아웃했습니다.');
        if (state.route === 'admin') navigate('guide');
      });
    });

    var refresh = $('#refreshProfileBtn');
    if (refresh) {
      refresh.addEventListener('click', function () {
        if (!state.user) { renderGuide(); return; }
        toast('승인 상태를 다시 확인합니다.');
        loadProfile();
      });
    }
  }

  /* ---------------------------------------------------------------- 이벤트 연결 */
  function initEvents() {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var chip = t.closest('[data-chapter]');
      if (chip) {
        state.activeChapter = chip.getAttribute('data-chapter');
        renderChapterChips();
        renderVideos();
        return;
      }

      var head = t.closest('.video-head');
      if (head) {
        toggleVideoCard(head.closest('.video-card'));
        return;
      }

      var seg = t.closest('[data-admin-tab]');
      if (seg) { switchAdminTab(seg.getAttribute('data-admin-tab')); return; }

      var approve = t.closest('[data-approve]');
      if (approve) { toggleApprove(approve); return; }

      var edit = t.closest('[data-edit]');
      if (edit) {
        var vid = state.videos.filter(function (v) { return String(v.id) === edit.getAttribute('data-edit'); })[0];
        if (vid) fillVideoForm(vid);
        return;
      }

      var del = t.closest('[data-delete]');
      if (del) { deleteVideo(del.getAttribute('data-delete')); return; }
    });

    var videoForm = $('#videoForm');
    if (videoForm) {
      videoForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        submitVideoForm(ev.currentTarget);
      });
    }
    var cancel = $('#videoCancelBtn');
    if (cancel) cancel.addEventListener('click', function () { resetVideoForm(false); });

    var showForm = $('#showVideoFormBtn');
    if (showForm) {
      showForm.addEventListener('click', function () {
        var form = $('#videoForm');
        resetVideoForm(true);
        form.hidden = false;
        form.elements.chapter.focus();
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    var refreshMembers = $('#refreshMembersBtn');
    if (refreshMembers) {
      refreshMembers.addEventListener('click', function () { loadMembers(true); });
    }
  }

  /* ---------------------------------------------------------------- 시작 */
  function start() {
    initSiteCopy();
    initContactGuard();
    initSupabase();
    initAuthForms();
    initEvents();
    initRouter();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
