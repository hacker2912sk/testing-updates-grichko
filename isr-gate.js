/* ИСР — проверка доступа на стороне сайта (работает вместе с Cloudflare Worker).
 *
 * Подключается ПЕРВЫМ скриптом в <head> страницы:  <script src="/isr-gate.js"></script>
 * Эта строка должна быть в index.html. Остальное в index.html можно менять как угодно.
 *
 * Включение/выключение входа — файл json/accessFILE:
 *   {"enabled": true}   вход через Discord обязателен (по умолчанию)
 *   {"enabled": false}  сайт открыт всем, без входа
 * Если файл не читается или в нём ошибка — вход считается ОБЯЗАТЕЛЬНЫМ (так безопаснее).
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
    try { history.replaceState(null, '', location.pathname + location.search + (/^#u\/[\w-]+$/.test(back) ? back : '')); } catch (e) {}
  }

  function goGate(reason) {
    // запоминаем ссылку на профиль (#u/ID), чтобы после входа открыть именно её
    try { if (/^#u\/[\w-]+$/.test(location.hash)) sessionStorage.setItem('isr-after', location.hash); } catch (e) {}
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
          store.del(); return { reason: d.error || 'no_role' };
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
  /* { open:true } — вход выключен; { user } — вошёл; { reason } — не пускать */
  function evaluate() {
    return loadAccess().then(function (open) {
      if (open) return { open: true };
      if (!window.ISRGate.configured) return { reason: 'not_configured' };
      return check();
    });
  }

  /* ---------- Плашка «Вы вошли как…» (только когда вход включён и человек вошёл) ---------- */
  function renderBadge(user) {
    var old = document.getElementById('isr-badge');
    if (!user) { if (old) old.remove(); return; }
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { renderBadge(user); }); return; }

    if (!document.getElementById('isr-badge-style')) {
      var st = document.createElement('style');
      st.id = 'isr-badge-style';
      st.textContent =
        '#isr-badge{position:fixed;left:12px;bottom:12px;z-index:9000;font:13px/1.35 var(--font-body,system-ui,sans-serif);color:var(--ink,#F4E9D8)}' +
        '#isr-badge .b-main{display:flex;align-items:center;gap:8px;max-width:240px;padding:5px 12px 5px 5px;cursor:pointer;border:1px solid var(--line-strong,#5B3A85);' +
        'background:var(--paper-2,#1E1030);color:inherit;box-shadow:0 4px 18px rgba(0,0,0,.35);font:inherit;border-radius:var(--radius,0)}' +
        '#isr-badge .b-main:hover{border-color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-ava{width:26px;height:26px;border-radius:50%;object-fit:cover;background:var(--yellow,#FF7A00);color:var(--paper,#140A1E);' +
        'display:grid;place-items:center;font-weight:700;font-size:13px;flex:none;overflow:hidden}' +
        '#isr-badge .b-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '#isr-badge .b-panel{display:none;position:absolute;left:0;bottom:calc(100% + 8px);width:280px;max-width:calc(100vw - 24px);padding:14px;' +
        'background:var(--paper-2,#1E1030);border:1px solid var(--line-strong,#5B3A85);border-top:3px solid var(--yellow,#FF7A00);' +
        'box-shadow:0 10px 30px rgba(0,0,0,.45);border-radius:var(--radius,0)}' +
        '#isr-badge.open .b-panel{display:block}' +
        '#isr-badge .b-lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft,#B9A3C9);margin:0 0 4px}' +
        '#isr-badge .b-who{font-weight:700;font-size:15px;word-break:break-word}' +
        '#isr-badge .b-id{font-size:11px;color:var(--ink-soft,#B9A3C9);margin-bottom:10px}' +
        '#isr-badge .b-roles{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 12px;max-height:150px;overflow:auto}' +
        '#isr-badge .b-role{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--line,#3A2455);font-size:12px;border-radius:999px}' +
        '#isr-badge .b-role.acc{border-color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-dot{width:9px;height:9px;border-radius:50%;background:var(--ink-soft,#B9A3C9);flex:none}' +
        '#isr-badge .b-out{width:100%;padding:8px;cursor:pointer;border:1px solid var(--line-strong,#5B3A85);background:transparent;color:inherit;font:inherit}' +
        '#isr-badge .b-out:hover{border-color:var(--yellow,#FF7A00);color:var(--yellow,#FF7A00)}' +
        '#isr-badge .b-prof{display:block;text-align:center;text-decoration:none;margin-bottom:6px}' +
        '@media (max-width:900px){#isr-badge{bottom:76px}}' +
        '@media print{#isr-badge{display:none}}';
      document.head.appendChild(st);
    }

    var el = document.createElement('div');
    el.id = 'isr-badge';
    function mk(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    // кнопка-плашка: аватар + ник
    var main = mk('button', 'b-main'); main.type = 'button'; main.title = 'Профиль Discord';
    var name = user.name || 'Игрок';
    var ava;
    if (user.avatar && /^[a-zA-Z0-9_]+$/.test(user.avatar) && /^\d+$/.test(user.id)) {
      ava = document.createElement('img'); ava.className = 'b-ava'; ava.alt = '';
      ava.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64';
      ava.onerror = function () { var f = mk('span', 'b-ava', name.charAt(0).toUpperCase()); ava.replaceWith(f); };
    } else { ava = mk('span', 'b-ava', name.charAt(0).toUpperCase()); }
    main.appendChild(ava); main.appendChild(mk('span', 'b-name', name));

    // выпадающая панель: кто вошёл, роли, выход
    var panel = mk('div', 'b-panel');
    panel.appendChild(mk('div', 'b-lbl', 'Вы вошли как'));
    panel.appendChild(mk('div', 'b-who', name));
    panel.appendChild(mk('div', 'b-id', 'Discord ID: ' + user.id));
    panel.appendChild(mk('div', 'b-lbl', 'Ваши роли'));
    var roles = mk('div', 'b-roles');
    (user.roles || []).forEach(function (r) {
      var chip = mk('span', 'b-role' + (r.access ? ' acc' : ''));
      var dot = mk('span', 'b-dot');
      if (r.color && /^#[0-9a-fA-F]{6}$/.test(r.color)) dot.style.background = r.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(r.name || ('роль …' + String(r.id).slice(-4))));
      if (r.access) chip.title = 'Эта роль даёт доступ на сайт';
      roles.appendChild(chip);
    });
    if (!(user.roles || []).length) roles.appendChild(mk('span', 'b-lbl', 'нет данных'));
    panel.appendChild(roles);
    if (/^\d+$/.test(user.id)) {
      var prof = mk('a', 'b-out b-prof', 'Мой профиль'); prof.href = '/#u/' + user.id;
      prof.addEventListener('click', function () { el.classList.remove('open'); });
      panel.appendChild(prof);
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
    var wasOpen = old && old.classList.contains('open');
    if (old) old.remove();
    if (wasOpen) el.classList.add('open');
    document.body.appendChild(el);
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
  };

  if (isGate) return;   // gate.html сама решает, что показывать

  // Прячем страницу до подтверждения (fail closed: при любой ошибке — на gate.html)
  var hide = document.createElement('style');
  hide.id = 'isr-gate-hide';
  hide.textContent = 'html{visibility:hidden!important}';
  document.documentElement.appendChild(hide);

  evaluate().then(function (res) {
    if (!res.open && !res.user) return goGate(res.reason);
    window.ISR_USER = res.user || null;
    hide.remove();
    renderBadge(res.user || null);      // при enabled:false user нет — плашки не будет
    document.dispatchEvent(new CustomEvent('isr-auth', { detail: res.user || null }));

    // Пока страница открыта, периодически перепроверяем доступ (сняли роль или включили вход — выкидывает на gate.html)
    var recheck = function () {
      evaluate().then(function (r) {
        if (!r.open && !r.user) return goGate(r.reason);
        window.ISR_USER = r.user || null;
        renderBadge(r.user || null);
      }).catch(function () {});
    };
    setInterval(recheck, RECHECK_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });
  }).catch(function () { goGate('unavailable'); });
})();