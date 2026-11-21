/* ============================================================
   Superadmin · cuentas de clientes, abonos y cobros
   ============================================================ */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = U.esc;
  const icons = () => { if (window.lucide) lucide.createIcons(); };
  const app = $("#app");
  const state = {
    tab: "cuentas", buscar: "", filtro: "todas", cuentas: [], pagos: [],
    // Período: "mes" (uno por vez), "rango" (desde/hasta) o "todo"
    per: { modo: "mes", mes: U.mesActual(), desde: U.mesActual() + "-01", hasta: U.hoy() },
    fechaCuenta: "", // en Cuentas: "" (sin filtro), "vence", "alta" o "acceso"
  };
  const FECHAS_CUENTA = [["", "Sin filtro de fecha"], ["vence", "Vencen en el período"], ["alta", "Creadas en el período"], ["acceso", "Entraron en el período"]];

  /** {desde, hasta} del período elegido, o null si es "todo" */
  function rango() {
    const p = state.per;
    if (p.modo === "mes") return U.rangoMes(p.mes);
    if (p.modo === "rango") {
      const d = p.desde || "0000-01-01", h = p.hasta || "9999-12-31";
      return d <= h ? { desde: d, hasta: h } : { desde: h, hasta: d };
    }
    return null;
  }
  const enRango = (f, r = rango()) => !r || (!!f && f >= r.desde && f <= r.hasta);
  function nombrePeriodo() {
    const p = state.per;
    if (p.modo === "mes") return U.nombreMes(p.mes);
    if (p.modo === "todo") return "todo el historial";
    const r = rango();
    if (!p.desde && !p.hasta) return "todo el historial";
    if (!p.desde) return `hasta el ${U.fecha(r.hasta)}`;
    if (!p.hasta) return `desde el ${U.fecha(r.desde)}`;
    return r.desde === r.hasta ? `el ${U.fecha(r.desde)}` : `${U.fecha(r.desde)} al ${U.fecha(r.hasta)}`;
  }
  const fechaDeCuenta = (c, campo) =>
    campo === "vence" ? c.vence_el : campo === "alta" ? String(c.creado_en || "").slice(0, 10) : campo === "acceso" ? (c.ultimo_acceso || "").slice(0, 10) : null;
  const urlApp = () => cfg.urlPublica || new URL("index.html", location.href).href.replace(/index\.html$/, "");
  const waA = (num, msg) => `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  const est = (c) => U.estadoCuenta(c, cfg.diasGracia);
  const PILL = { activa: "", por_vencer: "gray", gracia: "red", vencida: "red", suspendida: "red" };

  /* ---------------- Interfaz ---------------- */
  function toast(msg, esError = false) {
    const t = document.createElement("div");
    t.className = "toast" + (esError ? " error" : "");
    t.innerHTML = `<i data-lucide="${esError ? "circle-alert" : "circle-check"}"></i><span>${esc(msg)}</span>`;
    $("#toasts").appendChild(t); icons();
    setTimeout(() => t.remove(), esError ? 4500 : 2800);
  }
  function modal({ titulo, cuerpo, pie = "", clase = "", alCerrar }) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-head"><button class="icon-btn" data-cerrar aria-label="Cerrar"><i data-lucide="x"></i></button><h2>${esc(titulo)}</h2></div>
      <div class="modal-body">${cuerpo}</div>${pie ? `<div class="modal-foot">${pie}</div>` : ""}</div>`;
    const cerrar = () => { back.remove(); alCerrar && alCerrar(); };
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-cerrar]")) cerrar(); });
    $("#modalRoot").appendChild(back); icons();
    return { el: back, cerrar };
  }
  function confirmar(titulo, texto, boton = "Confirmar", peligro = false) {
    return new Promise((res) => {
      let ok = false;
      const m = modal({ titulo, clase: "small", cuerpo: `<p style="margin:0;color:var(--ink2)">${texto}</p>`,
        pie: `<button class="btn btn-outline" data-cerrar>Cancelar</button><button class="btn btn-primary" data-si ${peligro ? 'style="background:var(--red)"' : ""}>${esc(boton)}</button>`,
        alCerrar: () => { if (!ok) res(false); } });
      $("[data-si]", m.el).addEventListener("click", () => { ok = true; m.cerrar(); res(true); });
    });
  }
  async function intentar(fn, errEl) {
    try { return await fn(); } catch (e) {
      if (e.sesion === false) { mostrarLogin(e.message); return undefined; }
      if (errEl) errEl.textContent = e.message; else toast(e.message, true);
      return undefined;
    }
  }
  function montoInput(input) {
    const fmt = () => { const v = U.leerNum(input.value); input.value = input.value.trim() === "" ? "" : U.num(v); };
    input.addEventListener("input", fmt); fmt();
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); toast("Copiado"); }
    catch (e) { toast("No se pudo copiar: seleccioná el texto y copialo a mano.", true); }
  }

  /** Mensaje con el acceso para mandarle al cliente */
  const mensajeAcceso = (c, clave) =>
    `Hola ${c.nombre.split(" ")[0]}, ya tenés tu cuenta de ${cfg.nombreApp}.\n\n` +
    `Entrá en: ${urlApp()}\nEmail: ${c.email}\nContraseña temporal: ${clave}\n\n` +
    `Al entrar te va a pedir que elijas tu propia contraseña.`;

  function modalAcceso(c, clave, titulo) {
    const msg = mensajeAcceso(c, clave);
    const m = modal({
      titulo, clase: "small",
      cuerpo: `
        <p style="margin:0;color:var(--ink2)">Mandale estos datos a <b>${esc(c.nombre)}</b>. La contraseña temporal <b>no se vuelve a mostrar</b>: si se pierde, generá otra.</p>
        <div class="card" style="padding:6px 18px">
          <div class="kv"><span class="k">Email</span><span class="v">${esc(c.email)}</span></div>
          <div class="kv"><span class="k">Contraseña temporal</span><span class="v" style="font-family:monospace;font-size:18px;letter-spacing:1px">${esc(clave)}</span></div>
        </div>
        <textarea readonly style="width:100%;min-height:150px;border:0;border-radius:14px;padding:12px;font:inherit;font-size:14px;background:#fff;resize:vertical">${esc(msg)}</textarea>`,
      pie: `<button class="btn btn-outline" id="acCopiar"><i data-lucide="copy"></i>Copiar</button>
        ${c.whatsapp ? `<a class="btn btn-primary" href="${waA(c.whatsapp, msg)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Enviar por WhatsApp</a>` : `<button class="btn btn-primary" data-cerrar>Listo</button>`}`,
    });
    $("#acCopiar", m.el).addEventListener("click", () => copiar(msg));
  }

  /* ---------------- Ingreso ---------------- */
  function mostrarLogin(msg) {
    document.body.classList.add("sin-sesion");
    $$(".modal-back").forEach((m) => m.remove());
    $("#auth").innerHTML = `
      <form class="auth-card" id="fLogin" novalidate>
        <div class="auth-brand" style="color:var(--ink)"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z"/></svg><span>Superadmin</span></div>
        <h1>${esc(cfg.nombreApp)}</h1>
        ${msg ? `<div class="aviso warn" style="margin:0"><span>${esc(msg)}</span></div>` : ""}
        <label class="field"><span>Email</span><input id="sEmail" type="email" autocomplete="username"></label>
        <label class="field"><span>Contraseña</span><input id="sClave" type="password" autocomplete="current-password"></label>
        <div class="err" id="sErr"></div>
        <button class="btn btn-primary btn-block" id="sBtn">Ingresar</button>
        ${DB.modo === "demo" ? `<div class="demo-hint"><b>Modo demo:</b> cualquier email, contraseña <code>${esc(cfg.demoPasswordSuper)}</code>.</div>` : ""}
      </form>`;
    $("#fLogin").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#sErr"); err.textContent = "";
      try { await DB.superLogin($("#sEmail").value.trim(), $("#sClave").value); entrar(); }
      catch (ex) { err.textContent = ex.message; }
    });
    setTimeout(() => $("#sEmail").focus(), 50);
  }
  function entrar() {
    document.body.classList.remove("sin-sesion");
    $("#auth").innerHTML = "";
    cargar();
  }

  /* ---------------- Datos ---------------- */
  async function cargar() {
    const r = await intentar(() => Promise.all([DB.superCuentas(), DB.superPagos()]));
    if (!r) return;
    [state.cuentas, state.pagos] = r;
    pintar();
  }

  function pintar() {
    const cs = state.cuentas, hoy = U.hoy(), mes = U.mesActual();
    const cuenta = { activa: 0, por_vencer: 0, gracia: 0, vencida: 0, suspendida: 0 };
    cs.forEach((c) => cuenta[est(c).estado]++);
    const esperado = cs.filter((c) => c.activo && est(c).estado !== "vencida").reduce((s, c) => s + c.precio, 0);
    const pagosPer = state.pagos.filter((p) => enRango(p.fecha));
    const cobradoPer = pagosPer.reduce((s, p) => s + p.monto, 0);
    const esMesActual = state.per.modo === "mes" && state.per.mes === mes;
    const anioPer = state.per.modo === "mes" ? state.per.mes.slice(0, 4) : null;
    const cobradoAnio = anioPer ? state.pagos.filter((p) => p.fecha.slice(0, 4) === anioPer).reduce((s, p) => s + p.monto, 0) : 0;
    const p = state.per;
    const MODOS = [["mes", "Mes"], ["rango", "Fechas"], ["todo", "Todo"]];

    app.innerHTML = `
      <div class="page-head">
        <div><h1 class="page-title">Clientes</h1><p class="page-sub">${U.plural(cs.length, "cuenta", "cuentas")} · ${DB.modo === "demo" ? "modo demo" : "base online"}</p></div>
        <div class="head-actions"><button class="btn btn-primary" id="btnNueva"><i data-lucide="user-plus"></i>Nueva cuenta</button></div>
      </div>
      <div class="filtro-per" id="perBar">
        <div class="seg" id="perModo">${MODOS.map(([k, v]) => `<button data-modo="${k}" class="${p.modo === k ? "on" : ""}">${v}</button>`).join("")}</div>
        ${p.modo === "mes" ? `<div class="periodo">
            <button class="icon-btn" data-d="-1" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
            <div class="periodo-nombre">${U.nombreMes(p.mes)}<input type="month" id="perMes" value="${p.mes}" aria-label="Elegir mes"></div>
            <button class="icon-btn" data-d="1" aria-label="Mes siguiente"><i data-lucide="chevron-right"></i></button>
            ${p.mes !== mes ? `<button class="btn btn-outline btn-sm" id="perHoy">Este mes</button>` : ""}
          </div>` : ""}
        ${p.modo === "rango" ? `<div class="per-fechas">
            <label class="field"><span>Desde</span><input type="date" id="perDesde" value="${p.desde}"></label>
            <label class="field"><span>Hasta</span><input type="date" id="perHasta" value="${p.hasta}"></label>
          </div>` : ""}
      </div>
      <section class="hero">
        <div class="hero-main"><div class="hero-label">Cobrado ${esMesActual ? "este mes" : `en ${esc(nombrePeriodo())}`}</div><div class="hero-amount mint">${U.gs(cobradoPer)}</div>
          <div class="hero-sub">${U.plural(pagosPer.length, "cobro", "cobros")}${anioPer ? ` · ${U.gs(cobradoAnio)} en ${anioPer}` : ""}</div></div>
        <div class="hero-boxes">
          <div class="hero-box"><div class="k">Ingreso mensual esperado</div><div class="v">${U.gs(esperado)}</div></div>
          <div class="hero-box"><div class="k">Al día / por vencer / vencidas</div><div class="v">${cuenta.activa} / ${cuenta.por_vencer} / <span style="color:var(--salmon)">${cuenta.gracia + cuenta.vencida}</span></div></div>
        </div>
      </section>
      <div class="seg" id="tabs" style="margin:18px 0;max-width:420px">
        <button data-tab="cuentas" class="${state.tab === "cuentas" ? "on" : ""}">Cuentas</button>
        <button data-tab="cobros" class="${state.tab === "cobros" ? "on" : ""}">Cobros</button>
      </div>
      <div id="tabBody"></div>`;
    $("#btnNueva").addEventListener("click", modalNueva);
    $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tab = b.dataset.tab; pintar(); } });
    const bar = $("#perBar");
    bar.addEventListener("click", (e) => {
      const m = e.target.closest("[data-modo]");
      if (m) { state.per.modo = m.dataset.modo; pintar(); return; }
      const d = e.target.closest("[data-d]");
      if (d) { state.per.mes = U.mesMas(state.per.mes, +d.dataset.d); pintar(); return; }
      if (e.target.closest("#perHoy")) { state.per.mes = U.mesActual(); pintar(); }
    });
    bar.addEventListener("change", (e) => {
      if (e.target.id === "perMes" && /^\d{4}-\d{2}$/.test(e.target.value)) { state.per.mes = e.target.value; pintar(); }
      if (e.target.id === "perDesde") { state.per.desde = e.target.value; pintar(); }
      if (e.target.id === "perHasta") { state.per.hasta = e.target.value; pintar(); }
    });
    if (state.tab === "cuentas") pintarCuentas(); else pintarCobros();
    icons();
  }

  function pintarCuentas() {
    const FILTROS = [["todas", "Todas"], ["atencion", "Por vencer y vencidas"], ["suspendida", "Suspendidas"]];
    $("#tabBody").innerHTML = `
      <label class="search"><i data-lucide="search"></i><input id="buscar" type="search" placeholder="Buscar cliente, email o WhatsApp" value="${esc(state.buscar)}" autocomplete="off"></label>
      <div class="chips" id="filtros" style="margin-bottom:14px;align-items:center">${FILTROS.map(([k, v]) => `<button class="chip ${state.filtro === k ? "on" : ""}" data-f="${k}" style="height:38px">${v}</button>`).join("")}
        <select class="chip sel-fecha ${state.fechaCuenta ? "on" : ""}" id="fechaCuenta" aria-label="Filtrar por fecha">${FECHAS_CUENTA.map(([k, v]) => `<option value="${k}" ${state.fechaCuenta === k ? "selected" : ""}>${k ? `${v.replace("el período", esc(nombrePeriodo()))}` : v}</option>`).join("")}</select></div>
      <div id="lista"></div>`;
    const lista = () => {
      const q = U.norm(state.buscar);
      const r = rango();
      const f = state.cuentas.filter((c) => {
        const e = est(c).estado;
        if (state.filtro === "atencion" && !["por_vencer", "gracia", "vencida"].includes(e)) return false;
        if (state.filtro === "suspendida" && e !== "suspendida") return false;
        if (state.fechaCuenta && !enRango(fechaDeCuenta(c, state.fechaCuenta), r)) return false;
        return !q || U.norm(`${c.nombre} ${c.email} ${c.whatsapp || ""}`).includes(q);
      });
      if (!f.length) { $("#lista").innerHTML = `<div class="empty"><h3>Sin cuentas</h3><p>${state.cuentas.length ? "Ninguna coincide con el filtro." : "Creá la primera con «Nueva cuenta»."}</p></div>`; return; }
      const vence = (c) => {
        const e = est(c);
        if (!c.vence_el) return "Sin vencimiento";
        const t = e.dias < 0 ? `venció hace ${-e.dias} d` : e.dias === 0 ? "vence hoy" : `en ${e.dias} d`;
        return `${U.fecha(c.vence_el)} <span class="mini">(${t})</span>`;
      };
      const acceso = (c) => c.ultimo_acceso ? U.fechaCorta(c.ultimo_acceso.slice(0, 10)) : "Nunca";
      $("#lista").innerHTML = `
        <div class="table-wrap only-desk" style="margin-top:0"><table class="tabla">
          <thead><tr><th>Cliente</th><th>Estado</th><th>Vence</th><th class="r">Abono</th><th>Último acceso</th><th class="r">Movs.</th><th></th></tr></thead>
          <tbody>${f.map((c) => `<tr data-id="${c.id}">
            <td><b>${esc(c.nombre)}</b><br><span class="mini" style="font-weight:500">${esc(c.email)}</span></td>
            <td><span class="pill ${PILL[est(c).estado]}">${U.ESTADOS[est(c).estado]}</span>${c.debe_cambiar ? `<br><span class="mini">sin estrenar</span>` : ""}</td>
            <td>${vence(c)}</td><td class="r">${U.num(c.precio)}</td><td>${acceso(c)}</td><td class="r">${U.num(c.movimientos)}</td>
            <td class="r" style="white-space:nowrap"><button class="btn btn-primary btn-sm" data-cobrar="${c.id}">Cobrar</button></td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="7">${U.plural(f.length, "cuenta", "cuentas")}</td></tr></tfoot>
        </table></div>
        <div class="list only-mob">${f.map((c) => `
          <div class="row" data-id="${c.id}" style="cursor:pointer">
            <span class="row-ico" style="background:var(--green-soft);color:var(--green);font-weight:800">${esc(c.nombre.charAt(0).toUpperCase())}</span>
            <span class="row-body"><span class="row-title">${esc(c.nombre)}</span><span class="row-sub">${c.vence_el ? `Vence ${U.fecha(c.vence_el)}` : "Sin vencimiento"}</span></span>
            <span class="row-end"><span class="pill ${PILL[est(c).estado]}">${U.ESTADOS[est(c).estado]}</span></span>
          </div>`).join("")}</div>`;
      icons();
    };
    $("#buscar").addEventListener("input", (e) => { state.buscar = e.target.value; lista(); });
    $("#filtros").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { state.filtro = b.dataset.f; pintarCuentas(); icons(); } });
    $("#fechaCuenta").addEventListener("change", (e) => { state.fechaCuenta = e.target.value; pintarCuentas(); icons(); });
    $("#lista").addEventListener("click", (e) => {
      const cb = e.target.closest("[data-cobrar]");
      if (cb) { modalCobrar(state.cuentas.find((c) => c.id === +cb.dataset.cobrar)); return; }
      const r = e.target.closest("[data-id]");
      if (r) modalCuenta(state.cuentas.find((c) => c.id === +r.dataset.id));
    });
    lista();
  }

  function pintarCobros() {
    const ps = state.pagos.filter((p) => enRango(p.fecha)).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id));
    $("#tabBody").innerHTML = !state.pagos.length ? `<div class="empty"><h3>Todavía no hay cobros</h3><p>Cuando registres un pago con «Cobrar», aparece acá.</p></div>`
      : !ps.length ? `<div class="empty"><h3>Sin cobros en ${esc(nombrePeriodo())}</h3><p>Probá con otro mes u otras fechas.</p></div>` : `
      <div class="list only-mob">${ps.map((p) => `
        <div class="row">
          <span class="row-ico" style="background:var(--green-soft);color:var(--green)"><i data-lucide="banknote"></i></span>
          <span class="row-body"><span class="row-title">${esc(p.cliente)}</span><span class="row-sub">${U.fecha(p.fecha)} · ${p.meses} ${p.meses === 1 ? "mes" : "meses"}</span></span>
          <span class="row-amount pos">${U.num(p.monto)}</span>
          <button class="icon-btn plain" data-borrar="${p.id}" aria-label="Borrar pago"><i data-lucide="trash-2"></i></button>
        </div>`).join("")}
        <div class="mini" style="padding:12px 0;text-align:right;border-top:1px solid #f1f3f5">${U.plural(ps.length, "cobro", "cobros")} · ${U.gs(ps.reduce((s, p) => s + p.monto, 0))}</div>
      </div>
      <div class="table-wrap only-desk" style="margin-top:0"><table class="tabla">
        <thead><tr><th>Fecha</th><th>Cliente</th><th class="r">Meses</th><th>Período</th><th class="r">Monto</th><th></th></tr></thead>
        <tbody>${ps.map((p) => `<tr style="cursor:default"><td>${U.fecha(p.fecha)}</td><td class="strong">${esc(p.cliente)}</td><td class="r">${p.meses}</td>
          <td>${U.fecha(p.desde)} → ${U.fecha(p.hasta)}</td><td class="r strong" style="color:var(--green)">${U.num(p.monto)}</td>
          <td class="r"><button class="icon-btn plain" data-borrar="${p.id}" aria-label="Borrar pago"><i data-lucide="trash-2"></i></button></td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="6">${U.plural(ps.length, "cobro", "cobros")} · ${U.gs(ps.reduce((s, p) => s + p.monto, 0))}</td></tr></tfoot>
      </table></div>`;
    $$("[data-borrar]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await confirmar("Borrar cobro", "Se borra el registro del pago. <b>El vencimiento de la cuenta no cambia solo</b>: si hace falta, corregilo editando la cuenta.", "Borrar", true))) return;
      if ((await intentar(() => DB.superEliminarPago(+b.dataset.borrar))) !== undefined) { toast("Cobro borrado"); cargar(); }
    }));
  }

  /* ---------------- Ventanas ---------------- */
  function camposCuenta(c = {}) {
    return `
      <label class="field"><span>Nombre del cliente</span><input id="cNombre" maxlength="60" value="${esc(c.nombre || "")}"></label>
      <label class="field"><span>Email (con este ingresa)</span><input id="cEmail" type="email" maxlength="120" value="${esc(c.email || "")}"></label>
      <label class="field"><span>WhatsApp (con código de país, ej. 595981…)</span><input id="cWa" inputmode="tel" maxlength="20" value="${esc(c.whatsapp || "")}"></label>
      <div class="grid-2" style="gap:14px">
        <label class="field"><span>Abono mensual (Gs.)</span><input id="cPrecio" inputmode="numeric" value="${c.precio ?? cfg.precioMensual}"></label>
        <label class="field"><span>Vence el</span><input id="cVence" type="date" value="${c.vence_el || ""}"></label>
      </div>
      <label class="field"><span>Notas (solo las ves vos)</span><input id="cNotas" maxlength="500" value="${esc(c.notas || "")}"></label>`;
  }
  const leerCampos = (el) => ({
    nombre: $("#cNombre", el).value, email: $("#cEmail", el).value, whatsapp: $("#cWa", el).value,
    precio: U.leerNum($("#cPrecio", el).value), vence_el: $("#cVence", el).value || null, notas: $("#cNotas", el).value,
  });

  function modalNueva() {
    const m = modal({
      titulo: "Nueva cuenta",
      cuerpo: `${camposCuenta({ vence_el: U.addDays(U.hoy(), cfg.diasPrueba) })}
        <p class="mini txt" style="margin:0;font-weight:500">Se proponen ${cfg.diasPrueba} días de prueba. Al guardar se genera una contraseña temporal para mandarle.</p>
        <div class="err" id="cErr"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="cOk">Crear cuenta</button>`,
    });
    montoInput($("#cPrecio", m.el));
    $("#cOk", m.el).addEventListener("click", async () => {
      const r = await intentar(() => DB.superCrearCuenta(leerCampos(m.el)), $("#cErr", m.el));
      if (!r) return;
      m.cerrar(); await cargar();
      modalAcceso(r, r.clave_temporal, "Cuenta creada");
    });
  }

  function modalCuenta(c) {
    const e = est(c);
    const m = modal({
      titulo: c.nombre,
      cuerpo: `
        <div class="card" style="padding:6px 18px">
          <div class="kv"><span class="k">Estado</span><span class="v"><span class="pill ${PILL[e.estado]}">${U.ESTADOS[e.estado]}</span></span></div>
          <div class="kv"><span class="k">Creada</span><span class="v">${U.fecha(String(c.creado_en).slice(0, 10))}</span></div>
          <div class="kv"><span class="k">Último acceso</span><span class="v">${c.ultimo_acceso ? U.fecha(c.ultimo_acceso.slice(0, 10)) : "Nunca"}${c.debe_cambiar ? " · todavía con clave temporal" : ""}</span></div>
          <div class="kv"><span class="k">Movimientos cargados</span><span class="v">${U.num(c.movimientos)}${c.ultimo_mov ? ` · último ${U.fecha(c.ultimo_mov)}` : ""}</span></div>
        </div>
        <div class="chips">
          <button class="chip" id="kCobrar"><i data-lucide="banknote"></i>Cobrar</button>
          ${c.whatsapp ? `<a class="chip" style="text-decoration:none" href="${waA(c.whatsapp, `Hola ${c.nombre.split(" ")[0]}, `)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>WhatsApp</a>` : ""}
          <button class="chip" id="kClave"><i data-lucide="key-round"></i>Nueva contraseña</button>
          <button class="chip" id="kActivo"><i data-lucide="${c.activo ? "pause" : "play"}"></i>${c.activo ? "Suspender" : "Reactivar"}</button>
        </div>
        ${camposCuenta(c)}
        <div class="err" id="cErr"></div>`,
      pie: `<button class="btn btn-danger-outline btn-icon" id="kBorrar" aria-label="Borrar cuenta"><i data-lucide="trash-2"></i></button>
        <button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="cOk">Guardar</button>`,
    });
    const el = m.el;
    montoInput($("#cPrecio", el));
    $("#cOk", el).addEventListener("click", async () => {
      const r = await intentar(() => DB.superGuardarCuenta(c.id, leerCampos(el)), $("#cErr", el));
      if (!r) return;
      m.cerrar(); toast("Cuenta guardada"); cargar();
    });
    $("#kCobrar", el).addEventListener("click", () => { m.cerrar(); modalCobrar(c); });
    $("#kClave", el).addEventListener("click", async () => {
      if (!(await confirmar("Nueva contraseña", `Se genera una contraseña temporal para <b>${esc(c.nombre)}</b> y se cierran sus sesiones abiertas. La actual deja de funcionar.`, "Generar"))) return;
      const r = await intentar(() => DB.superResetClave(c.id));
      if (!r) return;
      m.cerrar(); cargar(); modalAcceso(c, r.clave, "Contraseña nueva");
    });
    $("#kActivo", el).addEventListener("click", async () => {
      if (c.activo && !(await confirmar("Suspender cuenta", `<b>${esc(c.nombre)}</b> va a poder entrar y ver sus datos, pero no cargar ni modificar nada hasta que la reactives.`, "Suspender", true))) return;
      const r = await intentar(() => DB.superGuardarCuenta(c.id, { activo: !c.activo }));
      if (!r) return;
      m.cerrar(); toast(c.activo ? "Cuenta suspendida" : "Cuenta reactivada"); cargar();
    });
    $("#kBorrar", el).addEventListener("click", () => modalBorrar(c, m));
  }

  function modalBorrar(c, padre) {
    const m = modal({
      titulo: "Borrar cuenta", clase: "small",
      cuerpo: `<div class="aviso danger" style="margin:0"><i data-lucide="triangle-alert"></i><span>Se borran la cuenta de <b>${esc(c.nombre)}</b> y <b>todos sus datos</b> (movimientos, préstamos, ahorros y cobros). No se puede deshacer.</span></div>
        <p style="margin:0;color:var(--ink2)">Si solo dejó de pagar, mejor <b>suspendela</b>. Para borrar, escribí su email:</p>
        <label class="field"><span>${esc(c.email)}</span><input id="bConf" autocomplete="off"></label>
        <div class="err" id="bErr"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Cancelar</button><button class="btn btn-primary" id="bOk" style="background:var(--red)">Borrar definitivamente</button>`,
    });
    $("#bOk", m.el).addEventListener("click", async () => {
      const r = await intentar(() => DB.superBorrarCuenta(c.id, $("#bConf", m.el).value), $("#bErr", m.el));
      if (!r) return;
      m.cerrar(); padre.cerrar(); toast("Cuenta borrada"); cargar();
    });
  }

  function modalCobrar(c) {
    const desde = !c.vence_el || c.vence_el < U.hoy() ? U.hoy() : c.vence_el;
    const m = modal({
      titulo: `Cobrar · ${c.nombre}`, clase: "small",
      cuerpo: `
        <div class="lbl">Meses que paga</div>
        <div class="chips" id="pMeses">${[1, 2, 3, 6, 12].map((n) => `<button type="button" class="chip ${n === 1 ? "on" : ""}" data-m="${n}">${n} ${n === 1 ? "mes" : "meses"}</button>`).join("")}</div>
        <label class="field amount small"><span>Monto cobrado</span><span class="amount-line"><span class="cur">Gs.</span><input id="pMonto" inputmode="numeric" value="${c.precio}"></span></label>
        <label class="field"><span>Fecha del pago</span><input id="pFecha" type="date" value="${U.hoy()}"></label>
        <div class="field calc" id="pRes"></div>
        <div class="err" id="pErr"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="pOk"><i data-lucide="check"></i>Registrar pago</button>`,
    });
    const el = m.el;
    let meses = 1;
    montoInput($("#pMonto", el));
    const res = () => { $("#pRes", el).innerHTML = `<span>Nuevo vencimiento</span><div class="v" style="font-size:26px">${U.fecha(U.addMonths(desde, meses))}</div><div class="d">Se suma desde ${desde === U.hoy() ? "hoy" : `el vencimiento actual (${U.fecha(desde)})`}</div>`; };
    $("#pMeses", el).addEventListener("click", (e) => {
      const b = e.target.closest("[data-m]"); if (!b) return;
      meses = +b.dataset.m;
      $$("#pMeses .chip", el).forEach((x) => x.classList.toggle("on", x === b));
      $("#pMonto", el).value = U.num(c.precio * meses); res();
    });
    res();
    $("#pOk", el).addEventListener("click", async () => {
      const r = await intentar(() => DB.superRegistrarPago(c.id, { meses, monto: U.leerNum($("#pMonto", el).value), fecha: $("#pFecha", el).value }), $("#pErr", el));
      if (!r) return;
      m.cerrar(); toast(`Pago registrado · vence el ${U.fecha(r.cuenta.vence_el)}`); cargar();
    });
  }

  /* ---------------- Arranque ---------------- */
  $("#brandName").textContent = cfg.nombreApp;
  $("#btnSalir").addEventListener("click", async () => { await DB.superLogout().catch(() => {}); mostrarLogin(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { const ms = $$(".modal-back"); if (ms.length) ms[ms.length - 1].querySelector("[data-cerrar]").click(); }
  });
  (async () => {
    try { if (await DB.superSesion()) entrar(); else mostrarLogin(); }
    catch (e) { mostrarLogin(e.message); }
  })();
})();
