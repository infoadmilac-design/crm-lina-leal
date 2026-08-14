/* ALLPETZ — app funcional (vanilla JS, sin dependencias) */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* Datos — catálogo y precios compartidos con el bot de WhatsApp     */
  /* (ver catalog.js, única fuente de verdad)                          */
  /* ---------------------------------------------------------------- */

  const CATALOG = window.ALLPETZ_CATALOG;
  const { PR, BARF, BARF_DEFAULT, BARF_OPTIONS, TIER, WEIGHTS, ROW_META, SERVICES } = CATALOG;
  const PET_COLORS = ['#2540FF', '#FF5A40', '#0E0E12', '#6B6B72', '#7A4DFF', '#1F9E7A'];

  const BRAND_SVG = `<svg viewBox="0 0 200 200" style="width:100%;height:100%;">
    <path d="M 48 48 L 60 24 L 78 48 Z" fill="#F4ECDC"></path>
    <path d="M 122 48 L 140 24 L 152 48 Z" fill="#F4ECDC"></path>
    <rect x="38" y="48" width="124" height="26" rx="6" fill="#F4ECDC"></rect>
    <path d="M 152 74 L 48 140" stroke="#F4ECDC" stroke-width="26" stroke-linecap="round"></path>
    <rect x="38" y="140" width="124" height="26" rx="6" fill="#F4ECDC"></rect>
    <path d="M 160 152 Q 178 152 178 168 Q 178 184 160 184" stroke="#F4ECDC" stroke-width="22" stroke-linecap="round" fill="none"></path>
  </svg>`;

  /* ---------------------------------------------------------------- */
  /* Estado                                                             */
  /* ---------------------------------------------------------------- */

  const STORAGE_KEY = 'allpetz_state_v1';

  function defaultState() {
    return {
      loggedIn: true,
      userName: 'María',
      activeTab: 'home',
      weightIdx: 0,
      paseoVar: 'mes',
      barfKey: 'pollo-250',
      services: { bano: true, paseo: true, barf: true, vacunas: true, dental: true },
      petIdx: 0,
      pets: [
        { id: 'luna', name: 'Luna', breed: 'Golden Retriever · 3 años', badge: '✂️ Grooming hoy', color: '#2540FF' },
        { id: 'rocky', name: 'Rocky', breed: 'Bulldog Francés · 2 años', badge: '🐕 Paseo 7 am', color: '#FF5A40' },
      ],
      upcoming: [
        { id: 'u1', icon: '✂️', title: 'Grooming pro', time: 'Hoy · 4:00 pm', status: 'confirmado' },
        { id: 'u2', icon: '🐕', title: 'Paseo matinal', time: 'Mañana · 7:00 am', status: 'agendado' },
      ],
      stats: { paseos: 12, satisfaction: 98 },
      planConfirmed: false,
      planSnapshot: null,
      notifications: [
        { id: 'n1', icon: '🎉', text: 'Bienvenida a ALLPETZ. Configura tu primer plan en la pestaña Plan.', unread: true },
        { id: 'n2', icon: '✂️', text: 'Grooming de Luna confirmado para hoy 4:00 pm.', unread: true },
        { id: 'n3', icon: '🐕', text: 'Recuerda: paseo de Rocky mañana 7:00 am.', unread: true },
      ],
      notifPrefs: { push: true, email: true, sms: false },
      paymentMethods: [
        { id: 'p1', brand: 'Visa', last4: '4242', name: 'María Ortiz', isDefault: true },
      ],
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      return defaultState();
    }
  }

  let state = loadState();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  function setState(patch) {
    Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
    save();
    render();
  }

  /* Transient UI state — not persisted */
  let notifOpen = false;
  let currentModal = null; // { type, ...payload }
  let modalState = {};

  /* ---------------------------------------------------------------- */
  /* Helpers                                                            */
  /* ---------------------------------------------------------------- */

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const { cop, fmt } = CATALOG;

  function activePet() { return state.pets[state.petIdx] || state.pets[0]; }

  function price(id) {
    return CATALOG.price(id, state.weightIdx, { paseoVar: state.paseoVar, barfKey: state.barfKey });
  }
  function activeRowIds() { return ['bano', 'paseo', 'barf', 'vacunas', 'dental'].filter(id => state.services[id]); }
  function computeTicketLines() {
    return activeRowIds().map(id => {
      let label = ROW_META[id].label;
      if (id === 'paseo') label += state.paseoVar === 'sem' ? ' (1×)' : ' (5×)';
      if (id === 'barf') label += ' · ' + (BARF_OPTIONS.find(o => o.val === state.barfKey) || {}).label;
      return { label, price: fmt(price(id)) };
    });
  }
  function computeTotal() { return activeRowIds().reduce((sum, id) => sum + price(id), 0); }
  function selectionKey() { return JSON.stringify({ w: state.weightIdx, pv: state.paseoVar, bk: state.barfKey, sv: state.services }); }
  function uid(prefix) { return prefix + '_' + Math.random().toString(36).slice(2, 9); }

  /* ---------------------------------------------------------------- */
  /* Toasts                                                             */
  /* ---------------------------------------------------------------- */

  function showToast(msg) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .2s ease-out';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 2400);
  }

  /* ---------------------------------------------------------------- */
  /* Render: shell                                                      */
  /* ---------------------------------------------------------------- */

  function render() {
    const root = document.getElementById('app-root');
    if (!state.loggedIn) {
      root.innerHTML = renderLogin();
    } else {
      root.innerHTML = renderHeader() + renderContent() + renderTabBar();
    }
    renderModal();
  }

  function renderHeader() {
    const unread = state.notifications.filter(n => n.unread).length;
    return `
    <div class="app-header">
      <div class="brand">
        <div class="brand-mark">${BRAND_SVG}</div>
        <span class="brand-name">ALLPETZ</span>
      </div>
      <button class="icon-btn" id="notif-bell" data-action="toggle-notif">🔔${unread ? '<span class="notif-dot"></span>' : ''}</button>
    </div>
    ${notifOpen ? renderNotifPanel() : ''}
    `;
  }

  function renderNotifPanel() {
    const items = state.notifications;
    return `
    <div class="notif-panel" id="notif-panel">
      <div class="notif-panel-head">
        <span>Notificaciones</span>
        <button data-action="mark-all-read" type="button">Marcar leídas</button>
      </div>
      ${items.length ? items.map(n => `
        <div class="notif-item ${n.unread ? 'unread' : ''}" data-action="read-notif" data-id="${n.id}">
          <span class="ni-dot ${n.unread ? '' : 'read'}"></span>
          <span>${n.icon} ${esc(n.text)}</span>
        </div>
      `).join('') : '<div class="notif-empty">No tienes notificaciones.</div>'}
    </div>`;
  }

  function renderTabBar() {
    const tabs = [
      { id: 'home', icon: '🏠', label: 'Inicio' },
      { id: 'services', icon: '🐾', label: 'Servicios' },
      { id: 'plan', icon: '💳', label: 'Plan' },
      { id: 'profile', icon: '🐶', label: 'Perfil' },
    ];
    return `<div class="tab-bar">
      ${tabs.map(t => `
        <button class="tab-btn ${state.activeTab === t.id ? 'active' : ''}" data-action="set-tab" data-tab="${t.id}">
          <span class="tb-icon">${t.icon}</span><span class="tb-label">${t.label}</span>
        </button>`).join('')}
    </div>`;
  }

  function renderContent() {
    let body = '';
    if (state.activeTab === 'home') body = renderHome();
    else if (state.activeTab === 'services') body = renderServices();
    else if (state.activeTab === 'plan') body = renderPlan();
    else if (state.activeTab === 'profile') body = renderProfile();
    return `<div class="app-content">${body}</div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Home                                                               */
  /* ---------------------------------------------------------------- */

  function renderHome() {
    const pet = activePet();
    return `
    <div style="display:flex; flex-direction:column; gap:20px;">
      <div class="section-tag">
        <div class="mono">// Hola, ${esc(state.userName)}</div>
        <div class="heading section-title">Tu pack, hoy 🐾</div>
      </div>

      <div class="pet-switcher">
        ${state.pets.map((p, i) => `
          <button class="pet-chip ${i === state.petIdx ? 'active' : ''}" data-action="set-pet" data-idx="${i}">
            <span class="pet-chip-avatar" style="background:${p.color};">${esc(p.name[0])}</span>
            ${esc(p.name)}
          </button>`).join('')}
        <button class="pet-chip-add" data-action="open-add-pet" title="Agregar mascota">+</button>
      </div>

      <div class="pet-card" style="background:${pet.color};">
        <div class="pet-live"><span class="pet-live-dot"></span>EN VIVO</div>
        <div class="pet-card-bottom">
          <div>
            <div class="pet-card-name">${esc(pet.name)}</div>
            <div class="pet-card-breed">${esc(pet.breed)}</div>
          </div>
          <div class="pet-card-badge">${esc(pet.badge)}</div>
        </div>
      </div>

      <div class="quick-actions">
        <button class="quick-action" data-action="set-tab" data-tab="services"><span class="qi">🐕</span><span class="ql">Paseo</span></button>
        <button class="quick-action" data-action="set-tab" data-tab="services"><span class="qi">🥩</span><span class="ql">BARF</span></button>
        <button class="quick-action" data-action="set-tab" data-tab="services"><span class="qi">🏥</span><span class="ql">Vet</span></button>
        <button class="quick-action dark" data-action="set-tab" data-tab="plan"><span class="qi">💳</span><span class="ql">Plan</span></button>
      </div>

      ${state.planConfirmed && state.planSnapshot ? `
      <div class="plan-banner">
        <div>
          <div class="pb-label">Plan activo · ${esc(state.planSnapshot.tierLabel)}</div>
          <div class="pb-value">${cop(state.planSnapshot.total)}/mes</div>
        </div>
        <button data-action="set-tab" data-tab="plan">Editar</button>
      </div>` : ''}

      <div>
        <div class="mono" style="margin-bottom:10px;">// Próximos servicios</div>
        <div style="display:flex; flex-direction:column; gap:10px;">
          ${state.upcoming.length ? state.upcoming.map(u => `
            <button class="upcoming-item" data-action="open-upcoming" data-id="${u.id}">
              <span class="ui-icon">${u.icon}</span>
              <div style="flex:1;"><div class="ui-title">${esc(u.title)}</div><div class="ui-time">${esc(u.time)}</div></div>
              <span class="pill ${u.status}">${u.status}</span>
            </button>`).join('') : '<div class="notif-empty">No tienes servicios próximos.</div>'}
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card" style="background:#FF5A40;">
          <div class="stat-num">${state.stats.paseos}</div>
          <div class="stat-label">paseos este mes</div>
        </div>
        <div class="stat-card" style="background:#BEE3FF;">
          <div class="stat-num">${state.stats.satisfaction}%</div>
          <div class="stat-label">satisfacción</div>
        </div>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Services                                                           */
  /* ---------------------------------------------------------------- */

  function renderServices() {
    return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="section-tag">
        <div class="mono">// Servicios</div>
        <div class="heading section-title">Elige y combina.</div>
      </div>
      <div class="services-grid">
        ${SERVICES.map(svc => {
          const selected = svc.map ? !!state.services[svc.map] : false;
          return `
          <div class="service-card ${selected ? 'selected' : ''}" style="background:${svc.bg}; color:${svc.text};" data-action="pick-service" data-id="${svc.id}">
            <div>
              <div class="sc-emoji">${svc.emoji}</div>
              <div class="sc-title">${svc.title}</div>
              <div class="sc-desc">${svc.desc}</div>
            </div>
            <span class="sc-tag">${selected ? 'en tu plan' : 'disponible'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Plan                                                               */
  /* ---------------------------------------------------------------- */

  function renderPlan() {
    const w = state.weightIdx;
    const rows = Object.values(ROW_META);
    const lines = computeTicketLines();
    const total = computeTotal();
    const isDirty = !state.planConfirmed || !state.planSnapshot || state.planSnapshot.key !== selectionKey();

    return `
    <div style="display:flex; flex-direction:column; gap:18px;">
      <div class="section-tag">
        <div class="mono">// Arma tu paquete</div>
        <div class="heading section-title">Solo lo que necesita.</div>
      </div>

      <div>
        <div style="font-size:11px; font-weight:600; color:#6B6B72; margin-bottom:8px;">¿Cuánto pesa?</div>
        <div class="weight-picker">
          ${WEIGHTS.map((wt, i) => `
            <button class="weight-chip ${i === w ? 'active' : ''}" data-action="set-weight" data-idx="${i}">
              <span class="wc-emo">${wt.emo}</span><span class="wc-name">${wt.name}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="builder">
        ${rows.map(row => {
          const on = !!state.services[row.id];
          return `
          <div class="builder-row">
            <div class="builder-row-top">
              <button class="toggle ${on ? 'on' : ''}" data-action="toggle-service" data-id="${row.id}"><span class="toggle-knob"></span></button>
              <span style="font-size:18px; flex-shrink:0;">${row.emoji}</span>
              <div class="builder-row-label"><div class="brl-title">${row.label}</div><div class="brl-sub">${row.sub}</div></div>
              <span class="builder-row-price">${fmt(price(row.id))}</span>
            </div>
            ${row.id === 'paseo' ? `
            <div class="variant-row">
              <button class="chip-btn ${state.paseoVar === 'sem' ? 'active' : ''}" data-action="set-paseo-variant" data-val="sem">1×/sem</button>
              <button class="chip-btn ${state.paseoVar === 'mes' ? 'active' : ''}" data-action="set-paseo-variant" data-val="mes">5×/sem</button>
            </div>` : ''}
          </div>`;
        }).join('')}
        <div class="barf-row">
          ${BARF_OPTIONS.map(bo => `
            <button class="chip-sm ${bo.val === state.barfKey ? 'active' : ''}" data-action="set-barf-key" data-val="${bo.val}">${bo.label}</button>`).join('')}
        </div>
      </div>

      <div class="ticket">
        <div class="ticket-head">
          <span class="th-tag">// Tu paquete</span>
          <span class="th-tier">${TIER[w]}</span>
        </div>
        <ul class="ticket-lines">
          ${lines.length ? lines.map(l => `<li><span class="tl-label">${esc(l.label)}</span><span class="tl-price">${l.price}</span></li>`).join('')
            : '<li class="ticket-empty">Selecciona al menos un servicio</li>'}
        </ul>
        <div>
          <div class="ticket-total-label">Total mensual</div>
          <div class="ticket-total-value">${cop(total)}</div>
          <div class="ticket-total-note">COP/mes · cancela cuando quieras</div>
        </div>
        <button class="ticket-cta ${state.planConfirmed && !isDirty ? 'confirmed' : ''}" data-action="confirm-plan">
          ${state.planConfirmed && !isDirty ? '✓ Plan confirmado' : 'Quiero este plan →'}
        </button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Profile                                                            */
  /* ---------------------------------------------------------------- */

  function renderProfile() {
    const pet = activePet();
    return `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="section-tag">
        <div class="mono">// Mi mascota</div>
        <div class="heading section-title">${esc(pet.name)}</div>
      </div>
      <div class="profile-hero">
        <div class="profile-avatar" style="background:${pet.color};"><span>${esc(pet.name[0])}</span></div>
        <div>
          <div class="profile-name">${esc(pet.name)}</div>
          <div class="profile-breed">${esc(pet.breed)}</div>
        </div>
        <button class="btn-edit" data-action="open-edit-pet">Editar</button>
      </div>
      <div class="settings-list">
        <button class="settings-item" data-action="open-notif-prefs"><span class="si-icon">🔔</span><span class="si-label">Notificaciones</span><span class="si-chevron">›</span></button>
        <button class="settings-item" data-action="open-payment"><span class="si-icon">💳</span><span class="si-label">Métodos de pago</span><span class="si-chevron">›</span></button>
        <button class="settings-item" data-action="open-logout"><span class="si-icon">🚪</span><span class="si-label si-danger">Cerrar sesión</span></button>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Login                                                              */
  /* ---------------------------------------------------------------- */

  function renderLogin() {
    return `
    <div class="login-screen">
      <div class="login-brand">
        <div class="login-mark">${BRAND_SVG}</div>
        <div class="login-title">ALLPETZ</div>
        <div class="login-tag">Bienvenida de nuevo. Inicia sesión para ver el pack de hoy.</div>
      </div>
      <form class="login-form" data-action="submit-login">
        <div class="form-field">
          <label>Correo</label>
          <input type="email" name="email" placeholder="maria@correo.com" required value="${esc(state.userName === 'María' ? 'maria@correo.com' : '')}">
        </div>
        <div class="form-field">
          <label>Contraseña</label>
          <input type="password" name="password" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn-primary">Iniciar sesión</button>
        <button type="button" class="login-forgot" data-action="forgot-password">¿Olvidaste tu contraseña?</button>
      </form>
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Modals                                                             */
  /* ---------------------------------------------------------------- */

  function openModal(type, payload) {
    currentModal = Object.assign({ type }, payload || {});
    if (type === 'addPet') {
      modalState = { color: PET_COLORS[state.pets.length % PET_COLORS.length], name: '', breed: '' };
    } else if (type === 'editPet') {
      const pet = activePet();
      modalState = { color: pet.color, name: pet.name, breed: pet.breed };
    } else {
      modalState = {};
    }
    render();
  }
  function closeModal() {
    currentModal = null;
    modalState = {};
    renderModal();
  }

  function renderModal() {
    const root = document.getElementById('modal-root');
    if (!currentModal) { root.innerHTML = ''; return; }
    let inner = '';
    if (currentModal.type === 'addPet') inner = renderPetForm({ title: 'Nueva mascota', submitAction: 'submit-add-pet', ctaLabel: 'Agregar mascota' });
    else if (currentModal.type === 'editPet') inner = renderPetForm({ title: 'Editar mascota', submitAction: 'submit-edit-pet', ctaLabel: 'Guardar cambios', pet: activePet() });
    else if (currentModal.type === 'notifPrefs') inner = renderNotifPrefsModal();
    else if (currentModal.type === 'payment') inner = renderPaymentModal();
    else if (currentModal.type === 'logoutConfirm') inner = renderLogoutModal();
    else if (currentModal.type === 'upcomingDetail') inner = renderUpcomingModal();

    root.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-sheet" data-action="noop">${inner}</div>
    </div>`;
  }

  function renderPetForm(opts) {
    return `
    <div class="modal-title">${opts.title}</div>
    <div class="modal-sub">Cuéntanos de tu compañero para personalizar su experiencia.</div>
    <form data-action="${opts.submitAction}">
      <div class="form-field">
        <label>Nombre</label>
        <input type="text" name="name" required maxlength="24" value="${esc(modalState.name || '')}" placeholder="Ej. Toby">
      </div>
      <div class="form-field">
        <label>Raza / edad</label>
        <input type="text" name="breed" required maxlength="40" value="${esc(modalState.breed || '')}" placeholder="Ej. Labrador · 1 año">
      </div>
      <div class="form-field">
        <label>Color</label>
        <div class="color-swatches">
          ${PET_COLORS.map(c => `
            <button type="button" class="color-swatch ${modalState.color === c ? 'selected' : ''}" style="background:${c};" data-action="pick-pet-color" data-color="${c}">
              ${modalState.color === c ? '<span class="cs-check">✓</span>' : ''}
            </button>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" data-action="close-modal">Cancelar</button>
        <button type="submit" class="btn-primary">${opts.ctaLabel}</button>
      </div>
    </form>`;
  }

  function renderNotifPrefsModal() {
    const p = state.notifPrefs;
    const rows = [
      { id: 'push', title: 'Notificaciones push', sub: 'Alertas en tiempo real de servicios' },
      { id: 'email', title: 'Correo electrónico', sub: 'Resúmenes y confirmaciones' },
      { id: 'sms', title: 'SMS', sub: 'Recordatorios de citas' },
    ];
    return `
    <div class="modal-title">Notificaciones</div>
    <div class="modal-sub">Elige cómo quieres que te avisemos.</div>
    ${rows.map(r => `
      <div class="pref-row">
        <div class="pref-row-label"><div class="pr-title">${r.title}</div><div class="pr-sub">${r.sub}</div></div>
        <button class="toggle ${p[r.id] ? 'on' : ''}" data-action="toggle-notif-pref" data-id="${r.id}"><span class="toggle-knob"></span></button>
      </div>`).join('')}
    <div class="modal-actions"><button class="btn-primary" style="flex:1" data-action="close-modal">Listo</button></div>`;
  }

  function renderPaymentModal() {
    const brandIcon = { Visa: '💳', Mastercard: '💳', Amex: '💳' };
    return `
    <div class="modal-title">Métodos de pago</div>
    <div class="modal-sub">Administra las tarjetas asociadas a tu cuenta.</div>
    ${state.paymentMethods.map(pm => `
      <div class="pay-item">
        <span class="pi-icon">${brandIcon[pm.brand] || '💳'}</span>
        <div class="pi-info">
          <div class="pi-name">${esc(pm.brand)} •••• ${esc(pm.last4)}</div>
          <div class="pi-sub">${esc(pm.name)}</div>
        </div>
        ${pm.isDefault ? '<span class="pi-default">Predet.</span>' : `<button class="pi-remove" data-action="remove-payment" data-id="${pm.id}">Eliminar</button>`}
      </div>`).join('') || '<div class="notif-empty">Aún no tienes tarjetas.</div>'}

    <form data-action="submit-add-payment" style="margin-top:14px; border-top:1.5px dashed rgba(26,26,34,0.2); padding-top:14px;">
      <div class="form-field">
        <label>Titular</label>
        <input type="text" name="name" required maxlength="40" placeholder="Nombre en la tarjeta">
      </div>
      <div class="form-field">
        <label>Marca</label>
        <select name="brand">
          <option value="Visa">Visa</option>
          <option value="Mastercard">Mastercard</option>
          <option value="Amex">Amex</option>
        </select>
      </div>
      <div class="form-field">
        <label>Últimos 4 dígitos</label>
        <input type="text" name="last4" required pattern="[0-9]{4}" maxlength="4" inputmode="numeric" placeholder="4242">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" data-action="close-modal">Cerrar</button>
        <button type="submit" class="btn-primary">Agregar tarjeta</button>
      </div>
    </form>`;
  }

  function renderLogoutModal() {
    return `
    <div class="modal-title">¿Cerrar sesión?</div>
    <div class="modal-sub">Tendrás que iniciar sesión de nuevo para ver tu pack.</div>
    <div class="modal-actions">
      <button class="btn-secondary" data-action="close-modal">Cancelar</button>
      <button class="btn-primary danger" data-action="confirm-logout">Cerrar sesión</button>
    </div>`;
  }

  function renderUpcomingModal() {
    const item = state.upcoming.find(u => u.id === currentModal.id);
    if (!item) return '';
    return `
    <div class="modal-title">${item.icon} ${esc(item.title)}</div>
    <div class="modal-sub">${esc(item.time)} · estado: ${item.status}</div>
    <div class="modal-actions">
      <button class="btn-secondary" data-action="close-modal">Cerrar</button>
      ${item.status !== 'cancelado' ? `<button class="btn-primary danger" data-action="cancel-upcoming" data-id="${item.id}">Cancelar servicio</button>` : ''}
    </div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Eventos (delegación)                                               */
  /* ---------------------------------------------------------------- */

  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-action]');
    if (!t) {
      // Click outside notif panel closes it
      if (notifOpen && !e.target.closest('.notif-panel') && !e.target.closest('#notif-bell')) {
        notifOpen = false;
        render();
      }
      return;
    }
    const action = t.getAttribute('data-action');

    switch (action) {
      case 'toggle-notif':
        notifOpen = !notifOpen;
        render();
        break;
      case 'mark-all-read':
        state.notifications.forEach(n => n.unread = false);
        save(); render();
        break;
      case 'read-notif': {
        const n = state.notifications.find(x => x.id === t.getAttribute('data-id'));
        if (n) n.unread = false;
        save(); render();
        break;
      }
      case 'set-tab':
        notifOpen = false;
        setState({ activeTab: t.getAttribute('data-tab') });
        break;
      case 'set-pet':
        setState({ petIdx: Number(t.getAttribute('data-idx')) });
        break;
      case 'open-add-pet':
        openModal('addPet');
        break;
      case 'open-edit-pet':
        openModal('editPet');
        break;
      case 'pick-pet-color':
        modalState.color = t.getAttribute('data-color');
        renderModal();
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'overlay-close':
        closeModal();
        break;
      case 'open-notif-prefs':
        openModal('notifPrefs');
        break;
      case 'toggle-notif-pref': {
        const id = t.getAttribute('data-id');
        state.notifPrefs[id] = !state.notifPrefs[id];
        save(); renderModal();
        break;
      }
      case 'open-payment':
        openModal('payment');
        break;
      case 'remove-payment': {
        const id = t.getAttribute('data-id');
        const pm = state.paymentMethods.find(p => p.id === id);
        if (pm && pm.isDefault) { showToast('No puedes eliminar tu tarjeta predeterminada.'); break; }
        state.paymentMethods = state.paymentMethods.filter(p => p.id !== id);
        save(); renderModal();
        showToast('Tarjeta eliminada.');
        break;
      }
      case 'open-logout':
        openModal('logoutConfirm');
        break;
      case 'confirm-logout':
        closeModal();
        setState({ loggedIn: false });
        break;
      case 'open-upcoming':
        openModal('upcomingDetail', { id: t.getAttribute('data-id') });
        break;
      case 'cancel-upcoming': {
        const id = t.getAttribute('data-id');
        const it = state.upcoming.find(u => u.id === id);
        if (it) it.status = 'cancelado';
        save();
        closeModal();
        showToast('Servicio cancelado.');
        break;
      }
      case 'pick-service': {
        const svc = SERVICES.find(s => s.id === t.getAttribute('data-id'));
        if (!svc) break;
        if (svc.map) {
          state.services[svc.map] = true;
          save();
          state.activeTab = 'plan';
          render();
          showToast(`${svc.title} agregado a tu plan ✅`);
        } else {
          showToast(`${svc.title}: muy pronto podrás agendarlo desde la app 🐾`);
        }
        break;
      }
      case 'set-weight':
        setState({ weightIdx: Number(t.getAttribute('data-idx')), barfKey: BARF_DEFAULT[Number(t.getAttribute('data-idx'))] });
        break;
      case 'toggle-service': {
        const id = t.getAttribute('data-id');
        state.services[id] = !state.services[id];
        save(); render();
        break;
      }
      case 'set-paseo-variant':
        setState({ paseoVar: t.getAttribute('data-val') });
        break;
      case 'set-barf-key':
        setState({ barfKey: t.getAttribute('data-val') });
        break;
      case 'confirm-plan': {
        const lines = computeTicketLines();
        if (!lines.length) { showToast('Selecciona al menos un servicio para continuar.'); break; }
        state.planConfirmed = true;
        state.planSnapshot = { tierLabel: TIER[state.weightIdx], total: computeTotal(), key: selectionKey() };
        save(); render();
        showToast('¡Excelente! Te contactaremos pronto 🐾');
        break;
      }
      case 'forgot-password':
        showToast('Revisa tu correo para restablecer tu contraseña 📩');
        break;
      default:
        break;
    }
  });

  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el.name && el.closest && el.closest('#modal-root')) {
      modalState[el.name] = el.value;
    }
  });

  document.addEventListener('submit', function (e) {
    const form = e.target.closest('[data-action]');
    if (!form) return;
    e.preventDefault();
    const action = form.getAttribute('data-action');
    const data = new FormData(form);

    if (action === 'submit-login') {
      setState({ loggedIn: true, activeTab: 'home' });
      showToast(`¡Bienvenida de nuevo, ${state.userName}! 🐾`);
    }

    if (action === 'submit-add-pet') {
      const name = String(data.get('name') || '').trim();
      const breed = String(data.get('breed') || '').trim();
      if (!name || !breed) return;
      const pet = { id: uid('pet'), name, breed, badge: '🐾 Nuevo miembro', color: modalState.color || PET_COLORS[0] };
      state.pets.push(pet);
      state.petIdx = state.pets.length - 1;
      save();
      closeModal();
      render();
      showToast(`¡${name} se unió a la familia! 🐾`);
    }

    if (action === 'submit-edit-pet') {
      const name = String(data.get('name') || '').trim();
      const breed = String(data.get('breed') || '').trim();
      if (!name || !breed) return;
      const pet = activePet();
      pet.name = name;
      pet.breed = breed;
      pet.color = modalState.color || pet.color;
      save();
      closeModal();
      render();
      showToast('Perfil actualizado ✅');
    }

    if (action === 'submit-add-payment') {
      const name = String(data.get('name') || '').trim();
      const brand = String(data.get('brand') || 'Visa');
      const last4 = String(data.get('last4') || '');
      if (!name || !/^[0-9]{4}$/.test(last4)) { showToast('Revisa los datos de la tarjeta.'); return; }
      state.paymentMethods.push({ id: uid('pm'), brand, last4, name, isDefault: false });
      save();
      renderModal();
      showToast('Tarjeta agregada 💳');
    }
  });

  /* ---------------------------------------------------------------- */
  /* Init                                                               */
  /* ---------------------------------------------------------------- */

  render();
})();
