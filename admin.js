/* ALLPETZ — panel de administrador (vanilla JS, sin dependencias).
   Mismo patrón que colaboradores.js: comparte backend, catálogo y login por
   teléfono+código, pero controla todo el ecosistema (colaboradores,
   clientes, reservas globales) en vez de la vista de un solo colaborador. */
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

  const STORAGE_KEY = 'allpetz_admin_state_v1';

  function defaultState() {
    return {
      loggedIn: false,
      authStep: 'phone',
      authPhone: '',
      authToken: null,
      activeTab: 'resumen',
      admin: null,
      collaborators: [],
      customers: [],
      bookings: [],
      customerSearch: '',
      selectedCustomerPhone: null,
      selectedCustomerDetail: null,
      bookingStatusFilter: '',
      editingCollaboratorId: null, // 'new' | id | null
      financialPeriod: 'month', // 'today' | 'week' | 'month' | 'year' | 'custom'
      financialFrom: '',
      financialTo: '',
      financial: null,
      settings: {},
      settingsDefaults: null,
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

  let toastTimer = null;
  function showToast(text) {
    const root = document.getElementById('toast-root');
    root.innerHTML = `<div class="toast">${esc(text)}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, 3200);
  }

  const SERVICE_IDS = CATALOG.BUILDER_ROW_IDS;
  function serviceLabel(id) { return (CATALOG.ROW_META[id] || {}).label || id; }
  const STATUS_LABEL = { agendado: 'Sin horario', propuesto: 'Propuesto', confirmado: 'Confirmado', cancelado: 'Cancelado' };

  function bogotaTodayKey() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }
  function addDaysKey(key, days) {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  /** Rango [from, to) para cada período rápido — `to` es exclusivo. */
  function periodRange(period, customFrom, customTo) {
    const today = bogotaTodayKey();
    if (period === 'today') return { from: today, to: addDaysKey(today, 1) };
    if (period === 'week') return { from: addDaysKey(today, -6), to: addDaysKey(today, 1) };
    if (period === 'month') return { from: addDaysKey(today, -29), to: addDaysKey(today, 1) };
    if (period === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: `${Number(today.slice(0, 4)) + 1}-01-01` };
    if (customFrom && customTo) return { from: customFrom, to: customTo };
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Carga de datos                                                     */
  /* ---------------------------------------------------------------- */

  async function loadAll() {
    const me = await api('/admin/me');
    setState({ admin: me.admin });
    await Promise.all([loadCollaborators(), loadCustomers(), loadBookings(), loadSettings(), loadFinancial()]);
  }

  async function loadSettings() {
    const res = await api('/admin/settings');
    setState({ settings: res.settings || {}, settingsDefaults: res.defaults });
  }

  async function loadFinancial() {
    const range = periodRange(state.financialPeriod, state.financialFrom, state.financialTo);
    if (!range) return;
    const res = await api(`/admin/financial?from=${range.from}&to=${range.to}`);
    setState({ financial: res });
  }

  async function loadCollaborators() {
    const res = await api('/admin/collaborators');
    setState({ collaborators: res.collaborators });
  }
  async function loadCustomers() {
    const qs = state.customerSearch ? `?search=${encodeURIComponent(state.customerSearch)}` : '';
    const res = await api('/admin/customers' + qs);
    setState({ customers: res.customers });
  }
  async function loadBookings() {
    const qs = state.bookingStatusFilter ? `?status=${encodeURIComponent(state.bookingStatusFilter)}` : '';
    const res = await api('/admin/bookings' + qs);
    setState({ bookings: res.bookings });
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
        <h1 class="heading">Panel de administrador</h1>
        <p>Ingresa con tu número de WhatsApp registrado como administrador de ALLPETZ.</p>
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
      ['resumen', 'Resumen'],
      ['colaboradores', 'Colaboradores'],
      ['clientes', 'Clientes'],
      ['reservas', 'Reservas'],
      ['financiero', 'Financiero'],
      ['configuracion', 'Configuración'],
    ];
    return `<div class="tabs">${tabs.map(([id, label]) => `
      <button class="tab ${state.activeTab === id ? 'active' : ''}" data-action="set-tab" data-val="${id}">${esc(label)}</button>
    `).join('')}</div>`;
  }

  function renderResumen() {
    const activeCollabs = state.collaborators.filter((c) => c.active).length;
    const byStatus = { agendado: 0, propuesto: 0, confirmado: 0, cancelado: 0 };
    state.bookings.forEach((b) => { if (byStatus[b.status] != null) byStatus[b.status]++; });
    const totalRevenue = state.bookings.filter((b) => b.status === 'confirmado').reduce((s, b) => s + b.price, 0);
    return `
    <div class="card">
      <h2>Resumen del negocio</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="mono">Colaboradores activos</div><div class="kpi-num">${activeCollabs}</div></div>
        <div class="kpi"><div class="mono">Clientes</div><div class="kpi-num">${state.customers.length}</div></div>
        <div class="kpi"><div class="mono">Sin horario</div><div class="kpi-num">${byStatus.agendado}</div></div>
        <div class="kpi"><div class="mono">Propuestas</div><div class="kpi-num">${byStatus.propuesto}</div></div>
        <div class="kpi"><div class="mono">Confirmadas</div><div class="kpi-num">${byStatus.confirmado}</div></div>
        <div class="kpi"><div class="mono">Facturación confirmada</div><div class="kpi-num">${CATALOG.cop(totalRevenue)}</div></div>
      </div>
    </div>`;
  }

  function collaboratorFormFields(c) {
    c = c || { name: '', phone: '', specialties: [], active: true };
    return `
      <div class="field"><label>Nombre</label><input type="text" data-field="name" value="${esc(c.name)}" required></div>
      <div class="field"><label>WhatsApp</label><input type="tel" data-field="phone" value="${esc(c.phone || '')}" placeholder="573001112233"></div>
      <div class="field">
        <label>Especialidades</label>
        <div class="chip-row">
          ${SERVICE_IDS.map((id) => `
            <label class="chip">
              <input type="checkbox" data-field="specialty" value="${id}" ${c.specialties && c.specialties.includes(id) ? 'checked' : ''}>
              ${esc(serviceLabel(id))}
            </label>`).join('')}
        </div>
      </div>
      <div class="field"><label><input type="checkbox" data-field="active" ${c.active ? 'checked' : ''}> Activo</label></div>`;
  }

  function renderColaboradores() {
    const isNew = state.editingCollaboratorId === 'new';
    return `
    <div class="card">
      <div class="row" style="align-items:center;">
        <h2 style="margin:0;">Colaboradores</h2>
        <button class="btn small" data-action="new-collaborator">+ Nuevo colaborador</button>
      </div>
      ${isNew ? `
        <div class="item" data-editor="new">
          ${collaboratorFormFields(null)}
          <div class="actions">
            <button class="btn small" data-action="save-collaborator" data-id="new">Crear</button>
            <button class="btn small secondary" data-action="cancel-edit-collaborator">Cancelar</button>
          </div>
        </div>` : ''}
      ${!state.collaborators.length ? `<div class="empty">No hay colaboradores todavía.</div>` : state.collaborators.map((c) => {
        const editing = state.editingCollaboratorId === c.id;
        if (editing) {
          return `
          <div class="item" data-editor="${c.id}">
            ${collaboratorFormFields(c)}
            <div class="actions">
              <button class="btn small" data-action="save-collaborator" data-id="${c.id}">Guardar</button>
              <button class="btn small secondary" data-action="cancel-edit-collaborator">Cancelar</button>
            </div>
          </div>`;
        }
        return `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${esc(c.name)} ${c.active ? '' : '<span class="mono" style="color:var(--red);">INACTIVO</span>'}</div>
              <div class="sub">${esc(c.phone || 'sin teléfono')} · ${(c.specialties || []).map(serviceLabel).join(', ') || 'sin especialidad'}</div>
            </div>
            <button class="btn small secondary" data-action="edit-collaborator" data-id="${c.id}">Editar</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderClientes() {
    const detail = state.selectedCustomerDetail;
    return `
    <div class="card">
      <h2>Clientes</h2>
      <div class="field"><input type="text" id="customer-search" placeholder="Buscar por teléfono o nombre..." value="${esc(state.customerSearch)}"></div>
      ${!state.customers.length ? `<div class="empty">Sin clientes.</div>` : state.customers.map((c) => `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${esc(c.owner_name || 'Sin nombre')}</div>
              <div class="sub">${esc(c.phone)}</div>
            </div>
            <button class="btn small secondary" data-action="view-customer" data-phone="${esc(c.phone)}">Ver</button>
          </div>
        </div>
      `).join('')}
    </div>
    ${detail ? `
    <div class="card">
      <h2>${esc(detail.customer.owner_name || detail.customer.phone)}</h2>
      <p class="empty" style="padding-top:0;">${esc(detail.customer.phone)}</p>
      <h3 class="mono" style="margin-bottom:8px;">Mascotas</h3>
      ${!detail.pets.length ? `<div class="empty">Sin mascotas.</div>` : detail.pets.map((p) => `
        <div class="item"><div class="title">${esc(p.name)}</div><div class="sub">${esc(p.breed || 'raza no indicada')}</div></div>
      `).join('')}
      <h3 class="mono" style="margin:16px 0 8px;">Reservas</h3>
      ${!detail.bookings.length ? `<div class="empty">Sin reservas.</div>` : detail.bookings.map((b) => `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${esc(serviceLabel(b.service_id))} · ${esc(STATUS_LABEL[b.status] || b.status)}</div>
              <div class="sub">${b.scheduled_at ? new Date(b.scheduled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : 'sin horario'}</div>
            </div>
            <div class="price">${CATALOG.cop(b.price)}</div>
          </div>
        </div>
      `).join('')}
    </div>` : ''}`;
  }

  function renderReservas() {
    const statusOptions = ['', 'agendado', 'propuesto', 'confirmado', 'cancelado'];
    return `
    <div class="card">
      <div class="row" style="align-items:center;">
        <h2 style="margin:0;">Reservas</h2>
        <select id="booking-status-filter">
          ${statusOptions.map((s) => `<option value="${s}" ${state.bookingStatusFilter === s ? 'selected' : ''}>${s ? STATUS_LABEL[s] : 'Todas'}</option>`).join('')}
        </select>
      </div>
      ${!state.bookings.length ? `<div class="empty">Sin reservas.</div>` : state.bookings.map((b) => `
        <div class="item">
          <div class="row">
            <div>
              <div class="title">${esc(serviceLabel(b.service_id))}${b.pet_name ? ` · ${esc(b.pet_name)}` : ''} · ${esc(STATUS_LABEL[b.status] || b.status)}</div>
              <div class="sub">${esc(b.owner_name || b.customer_phone)} · ${b.scheduled_at ? new Date(b.scheduled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : 'sin horario'}</div>
              <div class="sub">Colaborador: ${esc(b.collaborator_name || 'sin asignar')}</div>
            </div>
            <div class="price">${CATALOG.cop(b.price)}</div>
          </div>
          ${b.scheduled_at ? `
          <div class="actions">
            <select data-field="reassign-collab" data-id="${b.id}">
              <option value="">Reasignar a...</option>
              ${state.collaborators.filter((c) => c.active).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
            <label class="chip" style="width:auto;"><input type="checkbox" data-field="force-reassign" data-id="${b.id}"> forzar</label>
            <button class="btn small" data-action="reassign-booking" data-id="${b.id}">Mover</button>
          </div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  const PERIOD_LABEL = { today: 'Hoy', week: 'Últimos 7 días', month: 'Últimos 30 días', year: 'Este año', custom: 'Personalizado' };

  function renderFinanciero() {
    const f = state.financial;
    return `
    <div class="card">
      <h2>Reporte financiero</h2>
      <div class="chip-row" style="margin-bottom:12px;">
        ${['today', 'week', 'month', 'year', 'custom'].map((p) => `
          <button class="tab ${state.financialPeriod === p ? 'active' : ''}" data-action="set-financial-period" data-val="${p}" style="padding:6px 14px;font-size:12px;">${PERIOD_LABEL[p]}</button>
        `).join('')}
      </div>
      ${state.financialPeriod === 'custom' ? `
        <div class="row" style="gap:10px;margin-bottom:12px;">
          <div class="field" style="margin:0;"><label>Desde</label><input type="date" id="financial-from" value="${esc(state.financialFrom)}"></div>
          <div class="field" style="margin:0;"><label>Hasta (excluye ese día)</label><input type="date" id="financial-to" value="${esc(state.financialTo)}"></div>
          <button class="btn small" data-action="apply-financial-range" style="align-self:flex-end;">Ver</button>
        </div>` : ''}
      ${!f ? `<div class="empty">Cargando...</div>` : `
      <div class="kpi-grid">
        <div class="kpi"><div class="mono">Servicios confirmados</div><div class="kpi-num">${f.count}</div></div>
        <div class="kpi"><div class="mono">Facturación</div><div class="kpi-num">${CATALOG.cop(f.totalRevenue)}</div></div>
        <div class="kpi"><div class="mono">Comisión ALLPETZ</div><div class="kpi-num">${CATALOG.cop(f.totalCommission)}</div></div>
        <div class="kpi"><div class="mono">Utilidad colaboradores</div><div class="kpi-num">${CATALOG.cop(f.totalPayout)}</div></div>
      </div>`}
    </div>
    ${f ? `
    <div class="card">
      <h2>Por servicio</h2>
      ${!f.byService.length ? `<div class="empty">Sin datos en este período.</div>` : f.byService.map((s) => `
        <div class="item"><div class="row">
          <div><div class="title">${esc(s.label)}</div><div class="sub">${s.count} servicio${s.count === 1 ? '' : 's'} · comisión ${CATALOG.cop(s.commission)}</div></div>
          <div class="price">${CATALOG.cop(s.revenue)}</div>
        </div></div>
      `).join('')}
    </div>
    <div class="card">
      <h2>Por colaborador</h2>
      ${!f.byCollaborator.length ? `<div class="empty">Sin datos en este período.</div>` : f.byCollaborator.map((c) => `
        <div class="item"><div class="row">
          <div><div class="title">${esc(c.name)}</div><div class="sub">${c.count} servicio${c.count === 1 ? '' : 's'} · utilidad ${CATALOG.cop(c.payout)}</div></div>
          <div class="price">${CATALOG.cop(c.revenue)}</div>
        </div></div>
      `).join('')}
    </div>` : ''}`;
  }

  function renderConfiguracion() {
    const defaultCommission = (state.settingsDefaults && state.settingsDefaults.commission) || {};
    const commission = Object.assign({}, defaultCommission, state.settings.commission || {});

    const biz = state.settings.businessInfo || {};

    const defaultTexts = (state.settingsDefaults && state.settingsDefaults.botTexts) || {};
    const texts = Object.assign({}, defaultTexts, state.settings.botTexts || {});

    return `
    <div class="card">
      <h2>Comisión ALLPETZ por servicio</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">Porcentaje que se queda ALLPETZ de cada servicio; el resto es la utilidad del colaborador.</p>
      ${SERVICE_IDS.map((id) => `
        <div class="field">
          <label>${esc(serviceLabel(id))}</label>
          <input type="number" min="0" max="100" step="1" data-commission="${id}" value="${Math.round((commission[id] != null ? commission[id] : 0.20) * 100)}"> %
        </div>
      `).join('')}
      <button class="btn small" data-action="save-commission">Guardar comisión</button>
    </div>

    <div class="card">
      <h2>Datos de la empresa</h2>
      <div class="field"><label>Nombre</label><input type="text" data-biz="name" value="${esc(biz.name || 'ALLPETZ')}"></div>
      <div class="field"><label>Teléfono de contacto</label><input type="text" data-biz="phone" value="${esc(biz.phone || '')}"></div>
      <div class="field"><label>Horario de atención</label><input type="text" data-biz="hours" value="${esc(biz.hours || '')}" placeholder="Lun a sáb, 8am - 6pm"></div>
      <div class="field"><label>Dirección</label><input type="text" data-biz="address" value="${esc(biz.address || '')}"></div>
      <button class="btn small" data-action="save-business-info">Guardar datos de la empresa</button>
    </div>

    <div class="card">
      <h2>Textos del bot</h2>
      <p class="empty" style="padding-top:0;margin-bottom:10px;">Solo estos dos mensajes de texto simple son editables por ahora — el resto del bot (listas, botones, precios) sigue igual.</p>
      <div class="field"><label>Bienvenida (primer contacto)</label><textarea data-text="welcome" rows="6" style="width:100%;border:var(--border);border-radius:12px;padding:10px;font-family:inherit;">${esc(texts.welcome || '')}</textarea></div>
      <div class="field"><label>"Hablar con alguien"</label><textarea data-text="humanHandoff" rows="2" style="width:100%;border:var(--border);border-radius:12px;padding:10px;font-family:inherit;">${esc(texts.humanHandoff || '')}</textarea></div>
      <button class="btn small" data-action="save-bot-texts">Guardar textos</button>
    </div>`;
  }

  function renderShell() {
    const view = state.activeTab === 'colaboradores' ? renderColaboradores()
      : state.activeTab === 'clientes' ? renderClientes()
      : state.activeTab === 'reservas' ? renderReservas()
      : state.activeTab === 'financiero' ? renderFinanciero()
      : state.activeTab === 'configuracion' ? renderConfiguracion()
      : renderResumen();
    return `
    <div class="shell">
      <div class="topbar">
        <div>
          <h1 class="heading">ALLPETZ · Administrador</h1>
          <div class="who">${esc(state.admin ? state.admin.name : '')}</div>
        </div>
        <div class="topbar-right">
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
    if (action === 'logout') { setState(defaultState()); return; }

    if (action === 'new-collaborator') { setState({ editingCollaboratorId: 'new' }); return; }
    if (action === 'edit-collaborator') { setState({ editingCollaboratorId: t.getAttribute('data-id') }); return; }
    if (action === 'cancel-edit-collaborator') { setState({ editingCollaboratorId: null }); return; }

    if (action === 'save-collaborator') {
      const id = t.getAttribute('data-id');
      const item = t.closest('.item');
      const name = item.querySelector('[data-field="name"]').value.trim();
      const phone = item.querySelector('[data-field="phone"]').value.trim().replace(/[^\d]/g, '');
      const specialties = Array.from(item.querySelectorAll('[data-field="specialty"]:checked')).map((el) => el.value);
      const activeEl = item.querySelector('[data-field="active"]');
      const active = activeEl ? activeEl.checked : true;
      if (!name) { showToast('El nombre es obligatorio.'); return; }
      try {
        if (id === 'new') {
          await api('/admin/collaborators', { method: 'POST', body: JSON.stringify({ name, phone, specialties }) });
          showToast('Colaborador creado ✅');
        } else {
          await api(`/admin/collaborators/${id}`, { method: 'PATCH', body: JSON.stringify({ name, phone, specialties, active }) });
          showToast('Colaborador actualizado ✅');
        }
        setState({ editingCollaboratorId: null });
        await loadCollaborators();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'view-customer') {
      const phone = t.getAttribute('data-phone');
      try {
        const detail = await api(`/admin/customers/${phone}`);
        setState({ selectedCustomerPhone: phone, selectedCustomerDetail: detail });
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'set-financial-period') {
      setState({ financialPeriod: t.getAttribute('data-val') });
      await loadFinancial();
      return;
    }

    if (action === 'apply-financial-range') {
      const from = document.getElementById('financial-from').value;
      const to = document.getElementById('financial-to').value;
      if (!from || !to) { showToast('Elige ambas fechas.'); return; }
      setState({ financialFrom: from, financialTo: to });
      await loadFinancial();
      return;
    }

    if (action === 'save-commission') {
      const card = t.closest('.card');
      const value = {};
      card.querySelectorAll('[data-commission]').forEach((inp) => {
        value[inp.getAttribute('data-commission')] = Math.max(0, Math.min(100, Number(inp.value) || 0)) / 100;
      });
      try {
        await api('/admin/settings/commission', { method: 'PUT', body: JSON.stringify({ value }) });
        showToast('Comisión guardada ✅');
        await loadSettings();
        await loadFinancial();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'save-business-info') {
      const card = t.closest('.card');
      const value = {};
      card.querySelectorAll('[data-biz]').forEach((inp) => { value[inp.getAttribute('data-biz')] = inp.value.trim(); });
      try {
        await api('/admin/settings/business_info', { method: 'PUT', body: JSON.stringify({ value }) });
        showToast('Datos de la empresa guardados ✅');
        await loadSettings();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'save-bot-texts') {
      const card = t.closest('.card');
      const value = {};
      card.querySelectorAll('[data-text]').forEach((el) => { value[el.getAttribute('data-text')] = el.value; });
      try {
        await api('/admin/settings/bot_texts', { method: 'PUT', body: JSON.stringify({ value }) });
        showToast('Textos guardados ✅');
        await loadSettings();
      } catch (err) { showToast(err.message); }
      return;
    }

    if (action === 'reassign-booking') {
      const id = t.getAttribute('data-id');
      const item = t.closest('.item');
      const collaboratorId = item.querySelector(`[data-field="reassign-collab"][data-id="${id}"]`).value;
      const force = item.querySelector(`[data-field="force-reassign"][data-id="${id}"]`).checked;
      if (!collaboratorId) { showToast('Elige un colaborador.'); return; }
      try {
        await api(`/admin/bookings/${id}/reassign`, { method: 'POST', body: JSON.stringify({ collaboratorId, force }) });
        showToast('Reserva reasignada ✅');
        await loadBookings();
      } catch (err) { showToast(err.message); }
      return;
    }
  });

  document.addEventListener('change', async function (e) {
    if (e.target.id === 'booking-status-filter') {
      setState({ bookingStatusFilter: e.target.value });
      await loadBookings();
      return;
    }
  });

  let searchTimer = null;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'customer-search') {
      state.customerSearch = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { loadCustomers(); }, 350);
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
        showToast(`¡Bienvenido, ${state.admin ? state.admin.name : ''}! 🐾`);
      } catch (err) {
        showToast(/administrador/.test(err.message) ? err.message : 'Código inválido o vencido.');
      }
      return;
    }
  });

  render();

  // Si la sesión ya estaba guardada (recarga de página), lo que se ve
  // primero es el caché de localStorage — se refresca en segundo plano
  // para no quedarse con datos viejos (o, como financiero/settings, que
  // ni siquiera existían la última vez que se guardó el estado).
  if (state.loggedIn && state.authToken) {
    loadAll().catch(() => { /* si falla (backend caído, token vencido), se queda con el caché */ });
  }
})();
