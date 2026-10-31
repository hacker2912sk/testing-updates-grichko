/* ИСР — проверка доступа на стороне сайта (работает вместе с Cloudflare Worker).
 *
 * Подключается ПЕРВЫМ скриптом в <head> страницы:  <script src="/isr-gate.js"></script>
 * Эта строка должна быть в index.html. Остальное в index.html можно менять как угодно.
 *
 * Войти в аккаунт (профиль, бейджи) может участник с одной из ролей из списка MEMBER_ROLE_ID (на Worker).
 * json/accessFILE решает только, закрыт ли САЙТ для обычных участников:
 *   {"enabled": true}   сайт закрыт: пускаем только роли из ROLE_ID на Worker
 *   {"enabled": false}  сайт открыт всем; вход нужен лишь для профиля, бейджей и админ-панели
 * Если файл не читается или в нём ошибка — сайт считается ЗАКРЫТЫМ (так безопаснее).
 */
(function () {
  var WORKER_URL = 'https://isr-auth.isr-auth.workers.dev';   // без слеша в конце
  var GATE_PAGE = '/gate.html';
  var ACCESS_FILE = '/json/accessFILE';   // {"enabled": true|false} — включает/выключает вход через Discord
  var KEY = 'isr-auth-token';
  var RECHECK_MS = 60000;   // как часто перепроверять доступ, пока сайт открыт (мс)

  var isGate = !!(document.currentScript && document.currentScript.getAttribute('data-page') === 'gate');
  var store = {
    get: function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(KEY, v); } catch (e) {} },
    del: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
  };

  // токен, пришедший от Worker после входа: #isr_token=...
  var m = location.hash.match(/isr_token=([^&]+)/);
  if (m) {
    store.set(decodeURIComponent(m[1]));
    var back = '';
    try { back = sessionStorage.getItem('isr-after') || ''; sessionStorage.removeItem('isr-after'); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search + (/^#(u\/[\w-]+|admin)$/.test(back) ? back : '')); } catch (e) {}
  }

  function goGate(reason) {
    // запоминаем ссылку на профиль (#u/ID), чтобы после входа открыть именно её
    try { if (/^#(u\/[\w-]+|admin)$/.test(location.hash)) sessionStorage.setItem('isr-after', location.hash); } catch (e) {}
    location.replace(GATE_PAGE + (reason ? '?reason=' + reason : ''));
  }
  /* Возвращает { user } если пускаем, иначе { reason } (reason может быть пустым: просто нужен вход). */
  function check() {
    var token = store.get();
    if (!token) return Promise.resolve({ reason: null });
    return fetch(WORKER_URL + '/api/me', { headers: { Authorization: 'Bearer ' + token } }).then(function (r) {
      if (r.ok) return r.json().then(function (u) { return { user: u }; });
      if (r.status === 401) { store.del(); return { reason: null }; }
      if (r.status === 403) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          store.del(); return { reason: d.error || 'no_role', detail: d.reason || '' };
        });
      }
      throw new Error('worker ' + r.status);
    });
  }

  /* true — вход отключён в json/accessFILE (сайт открыт всем). Любая ошибка = false (закрыто). */
  function loadAccess() {
    return fetch(ACCESS_FILE + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { return !!c && c.enabled === false; })
      .catch(function () { return false; });
  }
  /* Результат: { open, user, reason }.
     open  — сайт открыт всем (accessFILE enabled:false); user — вошедший (может быть и при open);
     reason — почему не пускаем. Пускаем, если open или (user и user.access: роль из ROLE_ID). */
  function evaluate() {
    return loadAccess().then(function (open) {
      if (!window.ISRGate.configured) return open ? { open: true, user: null } : { reason: 'not_configured' };
      if (open) {
        if (!store.get()) return { open: true, user: null };
        return check().then(function (r) { return { open: true, user: r.user || null }; }, function () { return { open: true, user: null }; });
      }
      return check().then(function (r) {
        if (!r.user) return r;
        return r.user.access ? { user: r.user } : { reason: 'no_role', user: r.user };
      });
    });
  }
  function denied(res) { return !res.open && !(res.user && !res.reason); }

  /* Значок модератора (встроенный SVG, без внешних шрифтов): щит со звездой */
  function staffIcon(px) {
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', px || 16); svg.setAttribute('height', px || 16);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Модератор');
    svg.style.flex = 'none'; svg.style.verticalAlign = '-3px';
    var t = document.createElementNS(NS, 'title'); t.textContent = 'Модератор ИСР'; svg.appendChild(t);
    var p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M12 1.8 3.6 5v6.2c0 5.2 3.6 9.6 8.4 11 4.8-1.4 8.4-5.8 8.4-11V5L12 1.8Z');
    p.setAttribute('fill', '#F5C400'); p.setAttribute('stroke', '#1E1D18'); p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-linejoin', 'round');
    var st = document.createElementNS(NS, 'path'); st.setAttribute('d', 'm12 6.6 1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5L12 6.6Z');
    st.setAttribute('fill', '#1E1D18');
    svg.appendChild(p); svg.appendChild(st); return svg;
  }

  /* ---------- Плашка «Вы вошли как…» (только когда вход включён и человек вошёл) ---------- */
  function renderBadge(user, open) {
    var old = document.getElementById('isr-badge');
    var showLogin = !user && open && window.ISRGate.configured;     // сайт открыт, человек не вошёл: кнопка «Войти»
    if (!user && !showLogin) { if (old) old.remove(); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { renderBadge(user, open); }); return; }

    if (!document.getElementById('isr-badge-style')) {
      var st = document.createElement('style');
      st.id = 'isr-badge-style';
      st.textContent =
        '#isr-badge{position:fixed;right:12px;top:12px;z-index:9000;font:13px/1.35 var(--font-body,system-ui,sans-serif);color:var(--ink,#F4E9D8)}' +
        '#isr-badge.in-header{position:relative;right:auto;top:auto;z-index:50;margin-left:6px;flex:none}' +
        '#isr-badge .b-login{display:inline-flex;align-items:center;padding:8px 14px;border:1px solid var(--line-strong,#5B3A85);background:var(--paper-2,#1E1030);color:inherit;text-decoration:none;font:600 12px var(--font-body,system-ui,sans-serif);letter-spacing:.06em;text-transform:uppercase;border-radius:var(--radius,0)}' +
        '#isr-badge .b-login:hover{border-color:var(--yellow,#FF7A00);color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-main{display:flex;align-items:center;gap:8px;max-width:210px;padding:4px 10px 4px 4px;cursor:pointer;border:1px solid var(--line-strong,#5B3A85);' +
        'background:var(--paper-2,#1E1030);color:inherit;box-shadow:0 4px 18px rgba(0,0,0,.35);font:inherit;border-radius:var(--radius,0)}' +
        '#isr-badge .b-main:hover{border-color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-ava{width:26px;height:26px;border-radius:50%;object-fit:cover;background:var(--yellow,#FF7A00);color:var(--paper,#140A1E);' +
        'display:grid;place-items:center;font-weight:700;font-size:13px;flex:none;overflow:hidden}' +
        '#isr-badge .b-txt{display:flex;flex-direction:column;min-width:0;line-height:1.15;text-align:left}' +
        '#isr-badge .b-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:13px}' +
        '#isr-badge .b-bal{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;color:var(--ink-soft,#B9A3C9)}' +
        '#isr-badge .b-panel{display:none;position:absolute;right:0;top:calc(100% + 8px);width:280px;max-width:calc(100vw - 24px);padding:14px;' +
        'background:var(--paper-2,#1E1030);border:1px solid var(--line-strong,#5B3A85);border-top:3px solid var(--yellow,#FF7A00);' +
        'box-shadow:0 10px 30px rgba(0,0,0,.45);border-radius:var(--radius,0)}' +
        '#isr-badge.open .b-panel{display:block}' +
        '#isr-badge .b-lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft,#B9A3C9);margin:0 0 4px}' +
        '#isr-badge .b-who{font-weight:700;font-size:15px;word-break:break-word}' +
        '#isr-badge .b-id{font-size:11px;color:var(--ink-soft,#B9A3C9);margin-bottom:10px}' +
                                        '#isr-badge .b-out{width:100%;padding:8px;cursor:pointer;border:1px solid var(--line-strong,#5B3A85);background:transparent;color:inherit;font:inherit}' +
        '#isr-badge .b-out:hover{border-color:var(--yellow,#FF7A00);color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-prof{display:block;text-align:center;text-decoration:none;margin-bottom:6px}' +
        '#isr-badge .b-staff{display:inline-flex;align-items:center;gap:5px;margin-left:6px;font-size:11px;color:var(--yellow,#FF7A00);font-weight:700}' +
        '@media (max-width:1500px){#isr-badge.in-header .b-main{max-width:182px}#isr-badge.in-header .b-bal{font-size:9.5px}}' +
        '@media (max-width:900px){#isr-badge.in-header .b-txt{display:none}#isr-badge.in-header .b-main{padding:3px}}' +
        '@media print{#isr-badge{display:none}}';
      document.head.appendChild(st);
    }

    var el = document.createElement('div');
    el.id = 'isr-badge';
    function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function place() {
      var burger = document.getElementById('burgerBtn'), host = burger && burger.parentNode;
      var wasOpen = old && old.classList.contains('open');
      if (old) old.remove();
      if (host) { el.classList.add('in-header'); host.insertBefore(el, burger); } else document.body.appendChild(el);
      if (wasOpen) el.classList.add('open');
    }
    if (showLogin) {
      var lg = mk('a', 'b-login', 'Войти'); lg.href = window.ISRGate.loginUrl();
      lg.addEventListener('click', function () { try { if (/^#(u\/[\w-]+|admin)$/.test(location.hash)) sessionStorage.setItem('isr-after', location.hash); } catch (e) {} });
      el.appendChild(lg); place(); return;
    }

    // кнопка-плашка: аватар + ник
    var main = mk('button', 'b-main'); main.type = 'button'; main.title = 'Профиль Discord';
    var name = user.name || 'Игрок';
    var ava;
    if (user.avatar && /^[a-zA-Z0-9_]+$/.test(user.avatar) && /^\d+$/.test(user.id)) {
      ava = document.createElement('img'); ava.className = 'b-ava'; ava.alt = '';
      ava.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
      ava.onerror = function () { var f = mk('span', 'b-ava', name.charAt(0).toUpperCase()); ava.replaceWith(f); };
    } else { ava = mk('span', 'b-ava', name.charAt(0).toUpperCase()); }
    var txt = mk('span', 'b-txt'), nm = mk('span', 'b-name', name);
    if (user.staff) { nm.appendChild(document.createTextNode(' ')); nm.appendChild(staffIcon(13)); }
    var tot = user.balance && isFinite(Number(user.balance.total)) ? Number(user.balance.total).toLocaleString('ru-RU') : '—';
    txt.appendChild(nm); txt.appendChild(mk('span', 'b-bal', 'Итоговый баланс: ' + tot));
    main.appendChild(ava); main.appendChild(txt);

    // выпадающая панель: кто вошёл, профиль, админ-панель, выход
    var panel = mk('div', 'b-panel');
    panel.appendChild(mk('div', 'b-lbl', 'Вы вошли как'));
    var who = mk('div', 'b-who', name); if (user.staff) { who.appendChild(document.createTextNode(' ')); who.appendChild(staffIcon(16)); } panel.appendChild(who);
    panel.appendChild(mk('div', 'b-id', 'Discord ID: ' + user.id));
    if (/^\d+$/.test(user.id)) {
      var prof = mk('a', 'b-out b-prof', 'Мой профиль'); prof.href = '#u/' + user.id;
      prof.addEventListener('click', function () { el.classList.remove('open'); });
      panel.appendChild(prof);
    }
    if (user.staff) {
      var adm = mk('a', 'b-out b-prof', 'Админ-панель'); adm.href = '#admin';
      adm.addEventListener('click', function () { el.classList.remove('open'); });
      panel.appendChild(adm);
    }
    var out = mk('button', 'b-out', 'Выйти'); out.type = 'button';
    out.onclick = function () { window.ISRGate.logout(); };
    panel.appendChild(out);

    main.onclick = function (e) { e.stopPropagation(); el.classList.toggle('open'); };
    if (!window.__isrBadgeClose) {
      window.__isrBadgeClose = true;
      document.addEventListener('click', function (e) {
        var b = document.getElementById('isr-badge');
        if (b && !b.contains(e.target)) b.classList.remove('open');
      });
    }

    el.appendChild(panel); el.appendChild(main);
    place();
  }

  window.ISRGate = {
    workerUrl: WORKER_URL,
    token: function () { return store.get(); },
    configured: WORKER_URL.indexOf('ВАШ-') === -1,
    loginUrl: function () { return WORKER_URL + '/auth/login?return=' + encodeURIComponent(location.origin); },
    logout: function () { store.del(); goGate(); },
    check: check,
    loadAccess: loadAccess,
    evaluate: evaluate,
    staffIcon: staffIcon,
  };

  if (isGate) return;   // gate.html сама решает, что показывать

  // Прячем страницу до подтверждения (fail closed: при любой ошибке — на gate.html)
  var hide = document.createElement('style');
  hide.id = 'isr-gate-hide';
  hide.textContent = 'html{visibility:hidden!important}';
  document.documentElement.appendChild(hide);

  evaluate().then(function (res) {
    if (denied(res)) return goGate(res.reason);
    window.ISR_USER = res.user || null;
    hide.remove();
    renderBadge(res.user || null, !!res.open);
    document.dispatchEvent(new CustomEvent('isr-auth', { detail: res.user || null }));

    // Пока страница открыта, периодически перепроверяем доступ (сняли роль, забанили, включили закрытый режим — выкидывает на gate.html)
    var recheck = function () {
      evaluate().then(function (r) {
        if (denied(r)) return goGate(r.reason);
        window.ISR_USER = r.user || null;
        renderBadge(r.user || null, !!r.open);
      }).catch(function () {});
    };
    setInterval(recheck, RECHECK_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });
  }).catch(function () { goGate('unavailable'); });
})();
