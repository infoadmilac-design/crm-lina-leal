/* ALLPETZ — panel de colaboradores (vanilla JS, sin dependencias).
   Comparte backend, catálogo y login por teléfono+código con la app de
   clientes (ver app.js) pero es una página aparte: audiencia y layout
   distintos (colaboradores, no clientes; escritorio, no mockup de teléfono). */
(function () {
  'use strict';

  const CATALOG = window.ALLPETZ_CATALOG;
  const API_BASE = (window.ALLPETZ_API_BASE || 'http://localhost:3000') + '/api';

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (state.authToken) headers.Authorization = 'Bearer ' + state.authToken;
    const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  const STORAGE_KEY = 'allpetz_collab_state_v1';

  function defaultState() {
    return {
      loggedIn: false,
      authStep: 'phone', // 'phone' | 'code'
      authPhone: '',
      authToken: null,
      activeTab: 'propuestas',
      collaborator: null,
      availability: [],
      pending: [],
      proposals: [],
      bookings: [],
      earnings: null,
      calendarMonthOffset: 0,
      calendarSelectedDate: null, // "YYYY-MM-DD"
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { return defaultState(); }
  }

  let state = loadState();
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* noop */ } }
  function setState(patch) {
    Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    save();
    render();
  }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes..domingo, aunque se guarda 0=domingo
  const WEEKDAY_LABEL = { 0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado' };
  const WD_MINI = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const MONTH_LABEL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function bogotaTodayKey() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  }
  /** Metadatos del mes a mostrar (offset 0 = mes actual, hora de Bogotá). */
  function monthMeta(offset) {
    const [ty, tm] = bogotaTodayKey().split('-').map(Number);
    let year = ty, month = tm - 1 + offset; // month: 0-11
    year += Math.floor(month / 12);
    month = ((month % 12) + 12) % 12;
    const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=domingo
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return { year, month, firstWeekday, daysInMonth, label: `${MONTH_LABEL[month]} ${year}` };
  }
  function dateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function weekdayOf(dateStr) {
    return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  }

  let toastTimer = null;
  function showToast(text) {
    const root = document.getElementById('toast-root');
    root.innerHTML = `<div class="toast">${esc(text)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3200);
  }

  /* ---------------------------------------------------------------- */
  /* Carga de datos                                                     */
  /* ---------------------------------------------------------------- */

  async function loadAll() {
    const me = await api('/collab/me');
    setState({
      collaborator: me.collaborator,
      availability: me.availability,
      bookings: me.bookings,
    });
    try {
      const [p, props, earnings] = await Promise.all([
        api('/collab/pending'),
        api('/collab/proposals'),
        api('/collab/earnings'),
      ]);
      setState({ pending: p.bookings, proposals: props.bookings, earnings });
    } catch (e) { /* si falla, se queda con lo que había */ }
  }

  /* ---------------------------------------------------------------- */
  /* Vistas                                                             */
  /* ---------------------------------------------------------------- */

  function renderLogin() {
    if (state.authStep === 'code') {
      return `
      <div class="login-wrap">
        <div class="login-card">
          <h1 class="heading">ALLPETZ</h1>
          <p>Te escribimos por WhatsApp al ${esc(state.authPhone)} con un código de 6 dígitos.</p>
          <form class="login-form" data-action="submit-code">
            <div class="field">
              <label>Código</label>
              <input type="text" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required autofocus>
            </div>
            <button type="submit" class="btn">Entrar</button>
            <button type="button" class="link-btn" data-action="back-to-phone">Usar otro número</button>
          </form>
        </div>
      </div>`;
    }
    return `
    <div class="login-wrap">
      <div class="login-card">
        <h1 class="heading">Panel de colaboradores</h1>
        <p>Ingresa con tu número de WhatsApp registrado como colaborador de ALLPETZ.</p>
        <form class="login-form" data-action="submit-phone">
          <div class="field">
            <label>WhatsApp</label>
            <input type="tel" name="phone" inputmode="numeric" placeholder="573001112233" required value="${esc(state.authPhone)}">
          </div>
          <button type="submit" class="btn">Enviar código</button>
        </form>
      </div>
    </div>`;
  }

  function renderTabs() {
    const tabs = [
      ['propuestas', `Propuestas${state.proposals.length ? ` (${state.proposals.length})` : ''}`],
      ['pendientes', `Sin horario${state.pending.length ? ` (${state.pending.length})` : ''}`],
      ['calendario', 'Mi calendario'],
      ['ingresos', 'Mis ingresos'],
      ['disponibilidad', 'Mi disponibilidad'],
    ];
    return `<div class="tabs">${tabs.map(([id, label]) => `
      <button class="tab ${state.activeTab === id ? 'active' : ''}" data-action="set-tab" data-val="${id}">${esc(label)}</button>
    `).join('')}</div>`;
  }

  function renderDisponibilidad() {
    const byWeekday = {};
    state.availability.forEach((s) => { byWeekday[s.weekday] = s; });
    const rows = WEEKDAY_ORDER.map((wd) => {
      const slot = byWeekday[wd];
      const checked = !!slot;
      return `
      <div class="avail-row">
        <label>
          <input type="checkbox" data-action="toggle-day" data-weekday="${wd}" ${checked ? 'checked' : ''}>
          ${WEEKDAY_LABEL[wd]}
        </label>
        <div></div>
        <input type="time" data-field="start" data-weekday="${wd}" value="${slot ? slot.start_time : '09:00'}" ${checked ? '' : 'disabled'}>
        <input type="time" data-field="end" data-weekday="${wd}" value="${slot ? slot.end_time : '17:00'}" ${checked ? '' : 'disabled'}>
      </div>`;
    }).join('');
    return `
    <div class="card">
      <h2>Mi disponibilidad semanal</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">Marca los días que atiendes y el rango de horas. Solo se te podrán asignar citas dentro de estos horarios.</p>
      <div id="avail-rows">${rows}</div>
      <div style="margin-top:16px;"><button class="btn small" data-action="save-availability">Guardar disponibilidad</button></div>
    </div>`;
  }

  function serviceLabel(id) { return (CATALOG.ROW_META[id] || {}).label || id; }

  function renderPendientes() {
    if (!state.pending.length) return `<div class="card"><div class="empty">No hay solicitudes sin horario que coincidan con tu especialidad.</div></div>`;
    return `<div class="card"><h2>Solicitudes sin horario</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">El cliente pidió que ustedes lo contacten — asígnale tú un horario.</p>
      ${state.pending.map((b) => `
      <div class="item" data-booking="${b.id}">
        <div class="row">
          <div>
            <div class="title">${esc(serviceLabel(b.service_id))}${b.pet_name ? ` · ${esc(b.pet_name)}` : ''}</div>
            <div class="sub">${esc(b.owner_name || b.customer_phone)} · ${esc(b.customer_phone)}</div>
          </div>
          <div class="price">${CATALOG.cop(b.price)}</div>
        </div>
        <div class="actions">
          <input type="date" data-field="date">
          <input type="time" data-field="time">
          <button class="btn small" data-action="assign-booking" data-id="${b.id}">Asignar horario</button>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function fmtProposed(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  }

  function renderPropuestas() {
    if (!state.proposals.length) return `<div class="card"><div class="empty">No hay horarios propuestos por clientes todavía.</div></div>`;
    return `<div class="card"><h2>Propuestas de horario</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">El cliente eligió este horario. Acéptalo si te queda bien, o recházalo para que proponga otro.</p>
      ${state.proposals.map((b) => `
      <div class="item" data-booking="${b.id}">
        <div class="row">
          <div>
            <div class="title">${esc(serviceLabel(b.service_id))}${b.pet_name ? ` · ${esc(b.pet_name)}` : ''}</div>
            <div class="sub">${esc(b.owner_name || b.customer_phone)} · ${esc(b.customer_phone)}</div>
            <div class="sub">📅 ${esc(fmtProposed(b.proposed_at))}</div>
          </div>
          <div class="price">${CATALOG.cop(b.price)}</div>
        </div>
        <div class="actions">
          <button class="btn small" data-action="accept-proposal" data-id="${b.id}">Aceptar</button>
          <button class="btn small secondary" data-action="decline-proposal" data-id="${b.id}">Rechazar</button>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function renderIngresos() {
    const e = state.earnings;
    if (!e) return `<div class="card"><div class="empty">Cargando...</div></div>`;
    return `
    <div class="card">
      <h2>Mis ingresos de este mes</h2>
      <div class="row" style="gap:24px;flex-wrap:wrap;">
        <div><div class="mono">Servicios realizados</div><div class="title" style="font-size:22px;">${e.servicesCount}</div></div>
        <div><div class="mono">Tu utilidad</div><div class="title" style="font-size:22px;">${CATALOG.cop(e.totalPayout)}</div></div>
        <div><div class="mono">Comisión ALLPETZ</div><div class="title" style="font-size:22px;">${CATALOG.cop(e.totalCommission)}</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Por servicio</h2>
      ${!e.byService.length ? `<div class="empty">Todavía no tienes servicios confirmados este mes.</div>` : e.byService.map((s) => `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${esc(s.label)}</div>
              <div class="sub">${s.count} servicio${s.count === 1 ? '' : 's'} · comisión ALLPETZ ${CATALOG.cop(s.commission)}</div>
            </div>
            <div class="price">${CATALOG.cop(s.payout)}</div>
          </div>
        </div>
      `).join('')}
    </div>`;
  }

  function renderCalendario() {
    const meta = monthMeta(state.calendarMonthOffset);
    const todayKey = bogotaTodayKey();

    // Citas por día (hora de Bogotá).
    const bookingsByDate = {};
    state.bookings.filter((b) => b.scheduled_at).forEach((b) => {
      const key = new Date(b.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      (bookingsByDate[key] = bookingsByDate[key] || []).push(b);
    });

    // Disponibilidad que TÚ declaraste, por día de la semana.
    const availByWeekday = {};
    state.availability.forEach((s) => { availByWeekday[s.weekday] = s; });

    const leadBlanks = meta.firstWeekday; // celdas vacías antes del día 1
    const totalCells = Math.ceil((leadBlanks + meta.daysInMonth) / 7) * 7;

    let cells = '';
    for (let i = 0; i < totalCells; i++) {
      const day = i - leadBlanks + 1;
      if (day < 1 || day > meta.daysInMonth) { cells += `<div class="cal-cell empty"></div>`; continue; }
      const key = dateKey(meta.year, meta.month, day);
      const wd = weekdayOf(key);
      const avail = availByWeekday[wd];
      const dayBookings = bookingsByDate[key] || [];
      const isToday = key === todayKey;
      const isSelected = key === state.calendarSelectedDate;
      cells += `
        <button class="cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-action="select-day" data-date="${key}">
          <span class="cal-daynum">${day}</span>
          ${avail ? `<span class="cal-avail">${esc(avail.start_time)}–${esc(avail.end_time)}</span>` : `<span class="cal-avail off">Sin horario</span>`}
          ${dayBookings.length ? `<span class="cal-badge">${dayBookings.length} cita${dayBookings.length === 1 ? '' : 's'}</span>` : ''}
        </button>`;
    }

    const selectedKey = state.calendarSelectedDate;
    const selectedBookings = selectedKey ? (bookingsByDate[selectedKey] || []) : [];
    const selectedAvail = selectedKey ? availByWeekday[weekdayOf(selectedKey)] : null;

    return `
    <div class="card">
      <div class="cal-header">
        <button class="btn small secondary" data-action="cal-prev">‹</button>
        <h2 style="margin:0;text-transform:capitalize;">${esc(meta.label)}</h2>
        <button class="btn small secondary" data-action="cal-next">›</button>
      </div>
      <div class="cal-grid">
        ${WD_MINI.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}
        ${cells}
      </div>
    </div>
    ${selectedKey ? `
    <div class="card">
      <h2>${esc(dayLongLabel(selectedKey))}</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">
        ${selectedAvail
          ? `🕘 Tu disponibilidad ese día: <strong>${esc(selectedAvail.start_time)} – ${esc(selectedAvail.end_time)}</strong> (la definiste tú en "Mi disponibilidad").`
          : `🕘 No marcaste disponibilidad para los ${esc(WEEKDAY_LABEL[weekdayOf(selectedKey)])} — puedes agregarla en "Mi disponibilidad".`}
      </p>
      ${!selectedBookings.length ? `<div class="empty">Sin citas agendadas este día.</div>` : selectedBookings.map((b) => {
        const time = new Date(b.scheduled_at).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
        return `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${time} · ${esc(serviceLabel(b.service_id))}${b.pet_name ? ` · ${esc(b.pet_name)}` : ''}</div>
              <div class="sub">${esc(b.owner_name || b.customer_phone)}</div>
            </div>
            <div class="price">${CATALOG.cop(b.price)}</div>
          </div>
          <div class="actions"><button class="btn small secondary" data-action="release-booking" data-id="${b.id}">Liberar</button></div>
        </div>`;
      }).join('')}
    </div>` : ''}`;
  }

  function dayLongLabel(dateStr) {
    return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
  }

  function renderEarningsMini() {
    const e = state.earnings;
    return `
    <button class="earnings-mini" data-action="set-tab" data-val="ingresos" title="Ver detalle en Mis ingresos">
      <span class="mono">Utilidad del mes</span>
      <span class="earnings-mini-amount">${e ? CATALOG.cop(e.totalPayout) : '—'}</span>
    </button>`;
  }

  function renderShell() {
    const view = state.activeTab === 'pendientes' ? renderPendientes()
      : state.activeTab === 'calendario' ? renderCalendario()
      : state.activeTab === 'ingresos' ? renderIngresos()
      : state.activeTab === 'propuestas' ? renderPropuestas()
      : renderDisponibilidad();
    return `
    <div class="shell">
      <div class="topbar">
        <div>
          <h1 class="heading">ALLPETZ · Colaboradores</h1>
          <div class="who">${esc(state.collaborator ? state.collaborator.name : '')}</div>
        </div>
        <div class="topbar-right">
          ${renderEarningsMini()}
          <button class="btn small secondary" data-action="logout">Salir</button>
        </div>
      </div>
      ${renderTabs()}
      ${view}
    </div>`;
  }

  function render() {
    document.getElementById('app-root').innerHTML = state.loggedIn ? renderShell() : renderLogin();
  }

  /* ---------------------------------------------------------------- */
  /* Eventos                                                            */
  /* ---------------------------------------------------------------- */

  document.addEventListener('click', async function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.getAttribute('data-action');

    if (action === 'back-to-phone') { setState({ authStep: 'phone' }); return; }

    if (action === 'set-tab') { setState({ activeTab: t.getAttribute('data-val') }); return; }

    if (action === 'toggle-day') {
      const weekday = Number(t.getAttribute('data-weekday'));
      const row = t.closest('.avail-row');
      row.querySelectorAll('input[type=time]').forEach((inp) => { inp.disabled = !t.checked; });
      return;
    }

    if (action === 'save-availability') {
      const slots = [];
      document.querySelectorAll('.avail-row').forEach((row) => {
        const check = row.querySelector('[data-action="toggle-day"]');
        if (!check.checked) return;
        const weekday = Number(check.getAttribute('data-weekday'));
        const start = row.querySelector('[data-field="start"]').value;
        const end = row.querySelector('[data-field="end"]').value;
        if (start && end) slots.push({ weekday, start, end });
      });
      try {
        const res = await api('/collab/availability', { method: 'PUT', body: JSON.stringify({ slots }) });
        setState({ availability: res.availability });
        showToast('Disponibilidad guardada ✅');
      } catch (err) { showToast('No se pudo guardar: ' + err.message); }
      return;
    }

    if (action === 'assign-booking') {
      const id = t.getAttribute('data-id');
      const item = t.closest('.item');
      const date = item.querySelector('[data-field="date"]').value;
      const time = item.querySelector('[data-field="time"]').value;
      if (!date || !time) { showToast('Elige fecha y hora.'); return; }
      try {
        await api(`/collab/bookings/${id}/assign`, { method: 'POST', body: JSON.stringify({ scheduledAt: `${date}T${time}` }) });
        showToast('Cita asignada y cliente notificado por WhatsApp ✅');
        await loadAll();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'accept-proposal') {
      const id = t.getAttribute('data-id');
      try {
        await api(`/collab/bookings/${id}/accept`, { method: 'POST' });
        showToast('Cita confirmada y cliente notificado por WhatsApp ✅');
        await loadAll();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'decline-proposal') {
      const id = t.getAttribute('data-id');
      try {
        await api(`/collab/bookings/${id}/decline`, { method: 'POST' });
        showToast('Rechazada — le pedimos al cliente que proponga otro horario.');
        await loadAll();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'cal-prev') { setState({ calendarMonthOffset: state.calendarMonthOffset - 1, calendarSelectedDate: null }); return; }
    if (action === 'cal-next') { setState({ calendarMonthOffset: state.calendarMonthOffset + 1, calendarSelectedDate: null }); return; }

    if (action === 'select-day') {
      const date = t.getAttribute('data-date');
      setState({ calendarSelectedDate: state.calendarSelectedDate === date ? null : date });
      return;
    }

    if (action === 'release-booking') {
      const id = t.getAttribute('data-id');
      try {
        await api(`/collab/bookings/${id}/release`, { method: 'POST' });
        showToast('Cita liberada.');
        await loadAll();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'logout') {
      setState(defaultState());
      return;
    }
  });

  document.addEventListener('submit', async function (e) {
    const form = e.target.closest('[data-action]');
    if (!form) return;
    e.preventDefault();
    const action = form.getAttribute('data-action');
    const data = new FormData(form);

    if (action === 'submit-phone') {
      const phone = String(data.get('phone') || '').replace(/[^\d]/g, '');
      if (!phone) { showToast('Ingresa tu número de WhatsApp.'); return; }
      try {
        await api('/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) });
        setState({ authStep: 'code', authPhone: phone });
        showToast('Te enviamos un código por WhatsApp 🐾');
      } catch (err) { showToast('No pudimos enviar el código.'); }
      return;
    }

    if (action === 'submit-code') {
      const code = String(data.get('code') || '').trim();
      if (!code) { showToast('Ingresa el código que te enviamos.'); return; }
      try {
        const res = await api('/auth/verify-code', { method: 'POST', body: JSON.stringify({ phone: state.authPhone, code }) });
        state.authToken = res.token;
        save();
        await loadAll();
        setState({ loggedIn: true });
        showToast(`¡Bienvenido, ${state.collaborator ? state.collaborator.name : ''}! 🐾`);
      } catch (err) {
        showToast(/colaborador/.test(err.message) ? err.message : 'Código inválido o vencido.');
      }
      return;
    }
  });

  render();
})();
