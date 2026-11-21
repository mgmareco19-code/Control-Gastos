/* ============================================================
   Control de gastos · pantallas
   Rutas (#/…): inicio, movimientos, ingresos, gastos, categorias,
   prestamos, prestamos/cancelados, ahorros
   ============================================================ */
(() => {
  const cfg = window.APP_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $("#app");
  const esc = U.esc;
  const icons = () => { if (window.lucide) lucide.createIcons(); };

  const COLORES = ["#D9480F", "#E8590C", "#F59F00", "#2B8A3E", "#0B7A5A", "#0C8599", "#1C7ED6", "#4263EB", "#7048E8", "#AE3EC9", "#C2255C", "#E03131", "#5C940D", "#868E96"];

  const state = { mes: U.mesActual(), ruta: "inicio", sub: "", buscar: "", tabCuotas: "todas", cuenta: null };
  let renderId = 0;

  const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z"/><text x="12" y="16.5" font-size="12" font-weight="800" text-anchor="middle" fill="#fff">$</text></svg>`;
  const wa = (msg) => `https://wa.me/${cfg.soporteWhatsapp}?text=${encodeURIComponent(msg)}`;
  const estado = () => U.estadoCuenta(state.cuenta, cfg.diasGracia);
  const primerNombre = () => ((state.cuenta && state.cuenta.nombre) || "").trim().split(/\s+/)[0];

  /* ============================================================
     Utilidades de interfaz
     ============================================================ */
  function toast(msg, esError = false) {
    const t = document.createElement("div");
    t.className = "toast" + (esError ? " error" : "");
    t.innerHTML = `<i data-lucide="${esError ? "circle-alert" : "circle-check"}"></i><span>${esc(msg)}</span>`;
    $("#toasts").appendChild(t); icons();
    setTimeout(() => t.remove(), esError ? 4500 : 2800);
  }

  /** Abre un modal. Devuelve { el, cerrar }. Se apilan (uno encima de otro). */
  function modal({ titulo, cuerpo, pie = "", clase = "", alCerrar }) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal ${clase}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
        <div class="modal-head">
          <button class="icon-btn" data-cerrar aria-label="Cerrar"><i data-lucide="x"></i></button>
          <h2>${esc(titulo)}</h2>
        </div>
        <div class="modal-body">${cuerpo}</div>
        ${pie ? `<div class="modal-foot">${pie}</div>` : ""}
      </div>`;
    const cerrar = () => { back.remove(); if (!$(".modal-back")) document.body.style.overflow = ""; alCerrar && alCerrar(); };
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-cerrar]")) cerrar(); });
    $("#modalRoot").appendChild(back);
    document.body.style.overflow = "hidden";
    icons();
    const primero = back.querySelector("input:not([readonly]):not([disabled])");
    if (primero && window.matchMedia("(min-width: 900px)").matches) setTimeout(() => primero.focus(), 30);
    return { el: back, cerrar };
  }

  function confirmar(titulo, texto, boton = "Borrar") {
    return new Promise((res) => {
      let respondio = false;
      const m = modal({
        titulo, clase: "small",
        cuerpo: `<p style="margin:0;color:var(--ink2)">${texto}</p>`,
        pie: `<button class="btn btn-outline" data-cerrar>Cancelar</button><button class="btn btn-primary" data-si style="${/^(Borrar|Desmarcar)/.test(boton) ? "background:var(--red)" : ""}">${esc(boton)}</button>`,
        alCerrar: () => { if (!respondio) res(false); },
      });
      $("[data-si]", m.el).addEventListener("click", () => { respondio = true; m.cerrar(); res(true); });
    });
  }

  /** Ejecuta una acción async mostrando el error en pantalla si falla */
  async function intentar(fn, errEl) {
    try { return await fn(); } catch (e) {
      if (e.sesion === false) { mostrarLogin(e.message); return undefined; }
      if (errEl) errEl.textContent = e.message; else toast(e.message, true);
      return undefined;
    }
  }

  /** Campo de monto con puntos de miles mientras se escribe */
  function montoInput(input) {
    const fmt = () => { const v = U.leerNum(input.value); input.value = v ? U.num(v) : ""; };
    input.addEventListener("input", fmt);
    fmt();
  }

  const icoDot = (color) => `<span class="row-ico" style="background:${U.suave(color)}"><span class="dot" style="background:${color}"></span></span>`;
  const icoLucide = (name, bg, fg) => `<span class="row-ico" style="background:${bg};color:${fg}"><i data-lucide="${name}"></i></span>`;
  const colorCat = (c) => (c && c.color) || "#868E96";

  function periodoHtml() {
    return `<div class="periodo">
      <button class="icon-btn" data-act="mes" data-d="-1" aria-label="Mes anterior"><i data-lucide="chevron-left"></i></button>
      <div class="periodo-nombre">${U.nombreMes(state.mes)}<input type="month" id="mesInput" value="${state.mes}" aria-label="Elegir mes"></div>
      <button class="icon-btn" data-act="mes" data-d="1" aria-label="Mes siguiente"><i data-lucide="chevron-right"></i></button>
    </div>`;
  }

  function filaMov(m, sub) {
    const c = m.categoria;
    return `<button class="row" data-act="editar-mov" data-id="${m.id}">
      ${icoLucide(m.tipo === "ingreso" ? "arrow-up" : "arrow-down", U.suave(colorCat(c)), colorCat(c))}
      <span class="row-body"><span class="row-title">${esc(m.descripcion || (c ? c.nombre : "Sin descripción"))}</span>
      <span class="row-sub">${esc(sub ?? (c ? c.nombre : ""))}</span></span>
      <span class="row-amount ${m.tipo === "ingreso" ? "pos" : "neg"}">${U.firmado(m.monto, m.tipo)}</span>
    </button>`;
  }

  function listaPorDia(movs) {
    let html = "", dia = "";
    movs.forEach((m) => {
      if (m.fecha !== dia) { dia = m.fecha; html += `<div class="list-day">${U.diaTitulo(dia)}</div>`; }
      html += filaMov(m);
    });
    return `<div class="list">${html}</div>`;
  }

  function vacio(titulo, texto, boton, act, extra = "") {
    return `<div class="empty"><div class="empty-ico"><i data-lucide="receipt-text"></i></div>
      <h3>${esc(titulo)}</h3><p>${esc(texto)}</p>
      ${boton ? `<button class="btn btn-primary" data-act="${act}" ${extra}>${esc(boton)}</button>` : ""}</div>`;
  }

  const suma = (arr, tipo) => arr.filter((m) => !tipo || m.tipo === tipo).reduce((s, m) => s + m.monto, 0);

  /* ============================================================
     Gráfico Ingresos vs Gastos (SVG)
     ============================================================ */
  function dibujarGrafico(cont, datos) {
    const W = Math.max(280, cont.clientWidth), H = W < 500 ? 220 : 260;
    const pl = 42, pr = 8, pt = 10, pb = 28;
    const max = Math.max(1, ...datos.flatMap((d) => [d.ingresos, d.gastos]));
    const paso = (() => { const crudo = max / 3; const p = Math.pow(10, Math.floor(Math.log10(crudo))); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((v) => v >= crudo); })();
    const tope = paso * Math.ceil(max / paso);
    const y = (v) => pt + (H - pt - pb) * (1 - v / tope);
    const etiqueta = (v) => v >= 1e6 ? `${+(v / 1e6).toFixed(1)} M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)} mil` : String(v);
    const ancho = (W - pl - pr) / datos.length;
    const bw = Math.min(26, ancho * 0.28);
    let s = "";
    for (let v = 0; v <= tope + 1; v += paso) {
      s += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/>`;
      s += `<text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${etiqueta(v)}</text>`;
    }
    const barra = (x, v, color, tit) => {
      const h = Math.max(0, H - pb - y(v));
      if (!h) return "";
      const r = Math.min(5, h / 2);
      return `<path d="M${x},${H - pb} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z" fill="${color}"><title>${tit}</title></path>`;
    };
    datos.forEach((d, i) => {
      const cx = pl + ancho * i + ancho / 2;
      const actual = d.mes === state.mes;
      s += `<g class="bar-hit" data-act="ir-mes" data-mes="${d.mes}" style="cursor:pointer">
        <rect x="${pl + ancho * i}" y="${pt}" width="${ancho}" height="${H - pt}" fill="${actual ? "#f3f7f5" : "transparent"}" rx="10"/>
        ${barra(cx - bw - 2, d.ingresos, "#0b7a5a", `Ingresos ${U.nombreMes(d.mes)}: ${U.gs(d.ingresos)}`)}
        ${barra(cx + 2, d.gastos, "#111827", `Gastos ${U.nombreMes(d.mes)}: ${U.gs(d.gastos)}`)}
        <text x="${cx}" y="${H - 8}" text-anchor="middle" style="${actual ? "font-weight:700;fill:#111827" : ""}">${U.mesCorto(d.mes)}</text>
      </g>`;
    });
    cont.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img" aria-label="Ingresos y gastos de los últimos ${datos.length} meses">${s}</svg>`;
  }

  /* ============================================================
     Páginas
     ============================================================ */
  const PAGINAS = {
    async inicio(id) {
      const { desde, hasta } = U.rangoMes(state.mes);
      const [movs, resumen] = await Promise.all([DB.movimientos({ desde, hasta }), DB.resumenMeses(state.mes, cfg.mesesGrafico || 6)]);
      if (id !== renderId) return;
      const ing = suma(movs, "ingreso"), gas = suma(movs, "gasto"), saldo = ing - gas;
      const pct = ing ? Math.round((gas / ing) * 100) : (gas ? 100 : 0);

      const porCat = new Map();
      movs.filter((m) => m.tipo === "gasto").forEach((m) => {
        const k = m.categoria_id, x = porCat.get(k) || { cat: m.categoria, total: 0 };
        x.total += m.monto; porCat.set(k, x);
      });
      const cats = [...porCat.values()].sort((a, b) => b.total - a.total).slice(0, 6);
      const maxCat = cats[0] ? cats[0].total : 1;

      app.innerHTML = `
        <div class="page-head">
          <div><h1 class="page-title">Hola, ${esc(primerNombre())}</h1><p class="page-sub">Tus movimientos de ${U.nombreMes(state.mes).toLowerCase()}</p></div>
          <div class="head-actions">${periodoHtml()}<button class="btn btn-primary only-desk" data-act="nuevo-mov" data-tipo="gasto"><i data-lucide="plus"></i>Nuevo movimiento</button></div>
        </div>
        <section class="hero">
          <div class="hero-main"><div class="hero-label">Saldo del mes</div><div class="hero-amount">${U.gs(saldo)}</div></div>
          <div class="hero-boxes">
            <div class="hero-box"><div class="k">Ingresos</div><div class="v mint">${U.gs(ing)}</div></div>
            <div class="hero-box"><div class="k">Gastos</div><div class="v">${U.gs(gas)}</div></div>
          </div>
          <div style="flex-basis:100%">
            <div class="bar"><span style="width:${Math.min(100, pct)}%;${pct > 100 ? "background:var(--salmon)" : ""}"></span></div>
            <div class="hero-sub">${ing ? `Gastaste el ${pct}% de tus ingresos` : gas ? "Todavía no cargaste ingresos este mes" : "Sin movimientos este mes"}</div>
          </div>
        </section>
        <div class="tiles">
          <a class="tile" href="#/movimientos"><span class="tile-ico"><i data-lucide="trending-up"></i></span>Movimientos</a>
          <a class="tile" href="#/categorias"><span class="tile-ico"><i data-lucide="tag"></i></span>Categorías</a>
          <a class="tile" href="#/prestamos"><span class="tile-ico"><i data-lucide="banknote"></i></span>Préstamos</a>
          <a class="tile" href="#/ahorros"><span class="tile-ico"><i data-lucide="piggy-bank"></i></span>Ahorros</a>
        </div>
        <div class="grid-2">
          <div>
            <div class="section-head"><h2>Últimos movimientos</h2><a class="link" href="#/movimientos">Ver todo</a></div>
            ${movs.length ? `<div class="list compact">${movs.slice(0, 5).map((m) => filaMov(m, `${m.categoria ? m.categoria.nombre : ""} · ${U.fechaCorta(m.fecha)}`)).join("")}</div>`
              : vacio("Aún no hay movimientos", "Cuando cargues un ingreso o un gasto, aparecerá aquí.", "Incluir movimiento", "nuevo-mov", 'data-tipo="gasto"')}
          </div>
          <div>
            <div class="section-head"><h2>Gastos por categoría</h2></div>
            <div class="card">${cats.length ? cats.map((x) => `
              <div class="catbar"><div class="catbar-head"><span>${esc(x.cat ? x.cat.nombre : "Sin categoría")}</span><b>${U.gs(x.total)}</b></div>
              <div class="track"><span style="width:${Math.max(3, (x.total / maxCat) * 100)}%;background:${colorCat(x.cat)}"></span></div></div>`).join("")
              : `<p class="page-sub" style="margin:0">Sin gastos este mes.</p>`}</div>
          </div>
        </div>
        <div class="section-head"><h2>Ingresos vs Gastos</h2>
          <div class="chart-legend"><span><i style="background:#0b7a5a"></i>Ingresos</span><span><i style="background:#111827"></i>Gastos</span></div></div>
        <div class="card" style="padding:16px 14px 8px"><div id="grafico"></div></div>`;
      const g = $("#grafico");
      g._datos = resumen;
      dibujarGrafico(g, resumen);
    },

    async movimientos(id) {
      const { desde, hasta } = U.rangoMes(state.mes);
      const todos = await DB.movimientos({ desde, hasta });
      if (id !== renderId) return;
      const ing = suma(todos, "ingreso"), gas = suma(todos, "gasto");
      app.innerHTML = `
        <div class="page-head">
          <div><a class="crumb" href="#/inicio">Inicio</a><h1 class="page-title">Movimientos del período</h1></div>
          <div class="head-actions"><button class="btn btn-primary only-desk" data-act="nuevo-mov" data-tipo="gasto"><i data-lucide="plus"></i>Incluir</button></div>
        </div>
        <div class="page-head" style="align-items:center">${periodoHtml()}</div>
        <section class="hero">
          <div class="hero-main"><div class="hero-label">Saldo del período</div><div class="hero-amount">${U.gs(ing - gas)}</div></div>
          <div class="hero-boxes">
            <div class="hero-box"><div class="k">Ingresos</div><div class="v mint">${U.gs(ing)}</div></div>
            <div class="hero-box"><div class="k">Gastos</div><div class="v">${U.gs(gas)}</div></div>
          </div>
        </section>
        <div class="section-head"><h2>Movimientos</h2><span class="mini">${U.plural(todos.length, "movimiento", "movimientos")}</span></div>
        ${todos.length ? `<label class="search"><i data-lucide="search"></i><input id="buscarMov" type="search" placeholder="Buscar descripción o categoría" value="${esc(state.buscar)}" autocomplete="off"></label><div id="listaMov"></div>`
          : vacio("Aún no hay movimientos", "No encontramos registros para este período. Cuando cargues un ingreso o un gasto, aparecerá aquí.", "Incluir movimiento", "nuevo-mov", 'data-tipo="gasto"')}`;
      if (!todos.length) return;
      const pintar = () => {
        const q = U.norm(state.buscar);
        const f = q ? todos.filter((m) => U.norm(m.descripcion).includes(q) || U.norm(m.categoria && m.categoria.nombre).includes(q)) : todos;
        $("#listaMov").innerHTML = f.length ? listaPorDia(f) : `<div class="empty"><h3>Sin resultados</h3><p>No hay movimientos que coincidan con «${esc(state.buscar)}».</p></div>`;
        icons();
      };
      $("#buscarMov").addEventListener("input", (e) => { state.buscar = e.target.value; pintar(); });
      pintar();
    },

    ingresos: (id) => paginaTipo(id, "ingreso"),
    gastos: (id) => paginaTipo(id, "gasto"),

    async categorias(id) {
      const cats = await DB.categorias();
      if (id !== renderId) return;
      app.innerHTML = `
        <div class="page-head">
          <div><a class="crumb" href="#/inicio">Inicio</a><h1 class="page-title">Categorías</h1></div>
          <div class="head-actions only-desk"><button class="btn btn-primary" data-act="nueva-cat"><i data-lucide="plus"></i>Nueva categoría</button></div>
        </div>
        <label class="search"><i data-lucide="search"></i><input id="buscarCat" type="search" placeholder="Buscar" autocomplete="off"></label>
        <div id="listaCat"></div>`;
      const pintar = (q) => {
        const f = cats.filter((c) => !q || U.norm(c.nombre).includes(U.norm(q)));
        const grupo = (tipo, titulo) => {
          const g = f.filter((c) => c.tipo === tipo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
          if (!g.length) return "";
          return `<div class="list-day">${titulo}</div>` + g.map((c) => `
            <button class="row" data-act="editar-cat" data-id="${c.id}">
              ${icoDot(c.color)}
              <span class="row-body"><span class="row-title">${esc(c.nombre)}</span><span class="row-sub">${tipo === "gasto" ? "Gasto" : "Ingreso"} · ${c.usos ? U.plural(c.usos, "uso", "usos") : "sin uso"}</span></span>
              <span class="row-end"><span class="mini">N.º ${c.id}</span><i data-lucide="chevron-right" class="row-chev"></i></span>
            </button>`).join("");
        };
        const html = grupo("gasto", "GASTOS") + grupo("ingreso", "INGRESOS");
        $("#listaCat").innerHTML = html ? `<div class="list">${html}</div>` : `<div class="empty"><h3>Sin resultados</h3><p>No hay categorías con ese nombre.</p><button class="btn btn-primary" data-act="nueva-cat">Crear categoría</button></div>`;
        icons();
      };
      $("#buscarCat").addEventListener("input", (e) => pintar(e.target.value));
      pintar("");
    },

    async prestamos(id) {
      const cancelados = state.sub === "cancelados";
      const todos = await DB.prestamos();
      if (id !== renderId) return;
      const activos = todos.filter((p) => !p.cancelado);
      const lista = (cancelados ? todos.filter((p) => p.cancelado) : activos)
        .sort((a, b) => cancelados ? b.id - a.id : (a.proxima.vence.localeCompare(b.proxima.vence)));
      const deuda = activos.reduce((s, p) => s + p.saldo, 0);
      const cuotaMes = activos.reduce((s, p) => s + p.proxima.monto, 0);
      const hoy = U.hoy();

      const estado = (p) => p.cancelado ? `<span class="pill gray">Cancelado</span>` : p.vencidas ? `<span class="pill red">Atrasado</span>` : `<span class="pill">Activo</span>`;
      const avance = (p) => `<div class="track"><span style="width:${(p.pagadas / p.cuotas) * 100}%;background:var(--green)"></span></div>`;
      const subMob = (p) => {
        if (p.cancelado) return `${p.cuotas} cuotas · pagado`;
        if (p.vencidas) return `<span style="color:var(--red)">${p.vencidas === 1 ? "1 cuota vencida" : `${p.vencidas} cuotas vencidas`}</span>`;
        return `Cuota ${p.proxima.numero}/${p.cuotas} · vence ${U.fechaCorta(p.proxima.vence)}`;
      };

      app.innerHTML = `
        <div class="page-head">
          <div><a class="crumb" href="#/inicio">Inicio</a><h1 class="page-title">${cancelados ? "Préstamos cancelados" : "Préstamos"}</h1></div>
          <div class="head-actions">
            <a class="btn btn-outline only-desk" href="${cancelados ? "#/prestamos" : "#/prestamos/cancelados"}">${cancelados ? "Activos" : "Cancelados"}</a>
            <button class="btn btn-primary only-desk" data-act="nuevo-prestamo"><i data-lucide="plus"></i>Incluir préstamo</button>
          </div>
        </div>
        <section class="hero">
          <div class="hero-main"><div class="hero-label">Deuda pendiente</div><div class="hero-amount salmon">${U.gs(deuda)}</div></div>
          <div class="hero-boxes">
            <div class="hero-box"><div class="k">Cuota mensual</div><div class="v">${U.gs(cuotaMes)}</div></div>
            <div class="hero-box"><div class="k">Préstamos activos</div><div class="v">${activos.length}</div></div>
          </div>
        </section>
        <div class="section-head only-mob" style="display:flex"><h2>${cancelados ? "Cancelados" : "Préstamos activos"}</h2><a class="link" href="${cancelados ? "#/prestamos" : "#/prestamos/cancelados"}">${cancelados ? "Ver activos" : "Cancelados"}</a></div>
        ${!lista.length ? `<div style="margin-top:18px">${cancelados ? vacio("Sin préstamos cancelados", "Cuando termines de pagar un préstamo, va a aparecer acá.") : vacio("No tenés préstamos activos", "Cargá un préstamo con sus cuotas y el sistema te avisa cuáles vencen.", "Incluir préstamo", "nuevo-prestamo")}</div>` : `
        <div class="table-wrap only-desk"><table class="tabla">
          <thead><tr><th>Préstamo</th><th>Estado</th><th>${cancelados ? "Última cuota" : "Próx. venc."}</th><th class="r">Cuotas</th><th class="r">Monto cuota</th><th class="r">Total</th><th class="r">Saldo</th><th>Avance</th><th></th></tr></thead>
          <tbody>${lista.map((p) => `
            <tr data-act="cuotas" data-id="${p.id}">
              <td><span class="cell-ico">${icoLucide("banknote", "var(--red-soft)", "var(--red)")}${esc(p.entidad)}</span></td>
              <td>${estado(p)}</td>
              <td style="${!p.cancelado && p.proxima.vence < hoy ? "color:var(--red);font-weight:600" : ""}">${p.cancelado ? U.fecha(U.addMonths(p.fecha_inicio, p.cuotas - 1)) : U.fecha(p.proxima.vence)}</td>
              <td class="r">${p.pagadas}/${p.cuotas}</td>
              <td class="r">${U.num(p.monto_cuota)}</td>
              <td class="r">${U.num(p.total)}</td>
              <td class="r strong" style="color:${p.saldo ? "var(--red)" : "var(--green)"}">${U.num(p.saldo)}</td>
              <td>${avance(p)}</td>
              <td class="r"><button class="icon-btn plain" data-act="editar-prestamo" data-id="${p.id}" aria-label="Modificar ${esc(p.entidad)}"><i data-lucide="pencil"></i></button></td>
            </tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="9">${U.plural(lista.length, "préstamo", "préstamos")}</td></tr></tfoot>
        </table></div>
        <div class="list only-mob">${lista.map((p) => `
          <div class="prest-mob">
            <div class="row" style="padding:0">
              <button class="row" data-act="cuotas" data-id="${p.id}" style="padding:0;flex:1;min-width:0">
                ${icoLucide("banknote", "var(--red-soft)", "var(--red)")}
                <span class="row-body"><span class="row-title">${esc(p.entidad)}</span><span class="row-sub">${subMob(p)}</span></span>
              </button>
              <button class="icon-btn plain" data-act="editar-prestamo" data-id="${p.id}" aria-label="Modificar ${esc(p.entidad)}"><i data-lucide="pencil"></i></button>
            </div>
            <button class="pm-pie" data-act="cuotas" data-id="${p.id}">
              ${avance(p)}<span class="row-amount ${p.saldo ? "debt" : "pos"}">${U.gs(p.saldo)}</span>
            </button>
          </div>`).join("")}</div>`}`;
    },

    async ahorros(id) {
      const lista = await DB.ahorros();
      if (id !== renderId) return;
      const dep = lista.filter((a) => a.tipo === "deposito").reduce((s, a) => s + a.monto, 0);
      const ret = lista.filter((a) => a.tipo === "retiro").reduce((s, a) => s + a.monto, 0);
      const ent = new Map();
      lista.forEach((a) => { const k = U.norm(a.entidad); const x = ent.get(k) || { nombre: a.entidad, saldo: 0 }; x.saldo += a.tipo === "deposito" ? a.monto : -a.monto; ent.set(k, x); });
      const entidades = [...ent.values()].filter((x) => x.saldo !== 0).sort((a, b) => b.saldo - a.saldo);
      const signo = (a) => a.tipo === "deposito" ? "+" : "-";
      const icoAhorro = (a) => a.tipo === "deposito" ? icoLucide("arrow-up", "var(--green-soft)", "var(--green)") : icoLucide("arrow-down", "#eceff3", "#4b5563");

      app.innerHTML = `
        <div class="page-head">
          <div><a class="crumb" href="#/inicio">Inicio</a><h1 class="page-title">Ahorros</h1></div>
          <div class="head-actions only-desk"><button class="btn btn-primary" data-act="nuevo-ahorro"><i data-lucide="plus"></i>Incluir ahorro</button></div>
        </div>
        <section class="hero">
          <div class="hero-main"><div class="hero-label">Total ahorrado</div><div class="hero-amount mint">${U.gs(dep - ret)}</div></div>
          <div class="hero-boxes">
            <div class="hero-box"><div class="k">Depositado</div><div class="v mint">${U.gs(dep)}</div></div>
            <div class="hero-box"><div class="k">Retirado</div><div class="v">${U.gs(ret)}</div></div>
          </div>
        </section>
        ${entidades.length > 1 ? `<div class="section-head"><h2>Dónde está</h2></div>
          <div class="card">${entidades.map((x) => `<div class="catbar"><div class="catbar-head"><span>${esc(x.nombre)}</span><b>${U.gs(x.saldo)}</b></div>
          <div class="track"><span style="width:${Math.max(3, (x.saldo / Math.max(...entidades.map((e) => e.saldo))) * 100)}%;background:var(--green)"></span></div></div>`).join("")}</div>` : ""}
        <div class="section-head only-mob" style="display:flex"><h2>Movimientos</h2></div>
        ${!lista.length ? `<div style="margin-top:18px">${vacio("Todavía no hay ahorros", "Registrá cada depósito o retiro y vas a ver cuánto juntaste y dónde.", "Incluir ahorro", "nuevo-ahorro")}</div>` : `
        <div class="table-wrap only-desk"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Entidad</th><th>Tipo</th><th class="r">Monto</th></tr></thead>
          <tbody>${lista.map((a) => `<tr data-act="editar-ahorro" data-id="${a.id}">
            <td>${U.fecha(a.fecha)}</td><td class="strong"><span class="cell-ico">${icoAhorro(a)}${esc(a.descripcion)}</span></td><td>${esc(a.entidad)}</td>
            <td>${a.tipo === "deposito" ? `<span class="pill">Depósito</span>` : `<span class="pill gray">Retiro</span>`}</td>
            <td class="r strong" style="color:${a.tipo === "deposito" ? "var(--green)" : "var(--ink)"}">${signo(a)}${U.num(a.monto)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="5">${U.plural(lista.length, "movimiento", "movimientos")}</td></tr></tfoot>
        </table></div>
        <div class="list only-mob">${lista.map((a) => `
          <button class="row" data-act="editar-ahorro" data-id="${a.id}">
            ${icoAhorro(a)}
            <span class="row-body"><span class="row-title">${esc(a.descripcion)}</span><span class="row-sub">${esc(a.entidad)} · ${U.fechaCorta(a.fecha)}</span></span>
            <span class="row-amount ${a.tipo === "deposito" ? "pos" : "neg"}">${signo(a)}${U.num(a.monto)}</span>
          </button>`).join("")}</div>`}`;
    },
  };

  async function paginaTipo(id, tipo) {
    const { desde, hasta } = U.rangoMes(state.mes);
    const movs = await DB.movimientos({ desde, hasta, tipo });
    if (id !== renderId) return;
    const total = suma(movs), ing = tipo === "ingreso";
    const titulo = ing ? "Ingresos" : "Gastos";
    app.innerHTML = `
      <div class="page-head">
        <div><a class="crumb" href="#/inicio">Inicio</a><h1 class="page-title">${titulo}</h1></div>
        <div class="head-actions only-desk"><button class="btn btn-primary" data-act="nuevo-mov" data-tipo="${tipo}"><i data-lucide="plus"></i>Incluir ${ing ? "ingreso" : "gasto"}</button></div>
      </div>
      <div class="page-head" style="align-items:center">${periodoHtml()}</div>
      <section class="hero">
        <div class="hero-main"><div class="hero-label">${titulo} del mes</div><div class="hero-amount ${ing ? "mint" : ""}">${U.gs(total)}</div></div>
        <div class="hero-boxes">
          <div class="hero-box"><div class="k">Movimientos</div><div class="v">${movs.length}</div></div>
          <div class="hero-box"><div class="k">Promedio</div><div class="v">${U.gs(movs.length ? total / movs.length : 0)}</div></div>
        </div>
      </section>
      ${!movs.length ? `<div style="margin-top:18px">${vacio(`Sin ${titulo.toLowerCase()} este mes`, `Cuando cargues un ${ing ? "ingreso" : "gasto"}, aparecerá aquí.`, `Incluir ${ing ? "ingreso" : "gasto"}`, "nuevo-mov", `data-tipo="${tipo}"`)}</div>` : `
      <div class="table-wrap only-desk"><table class="tabla">
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="r">Monto</th></tr></thead>
        <tbody>${movs.map((m) => `<tr data-act="editar-mov" data-id="${m.id}">
          <td>${U.fecha(m.fecha)}</td><td class="strong">${esc(m.descripcion)}</td>
          <td><span class="pill" style="background:${U.suave(colorCat(m.categoria))};color:${colorCat(m.categoria)}">${esc(m.categoria ? m.categoria.nombre : "—")}</span></td>
          <td class="r strong" style="${ing ? "color:var(--green)" : ""}">${U.firmado(m.monto, tipo)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="4">${U.plural(movs.length, "movimiento", "movimientos")}</td></tr></tfoot>
      </table></div>
      <div class="only-mob"><div class="section-head"><h2>Movimientos</h2></div>${listaPorDia(movs)}</div>`}`;
  }

  /* ============================================================
     Modal: movimiento (incluir / modificar)
     ============================================================ */
  async function modalMovimiento({ id = null, tipo = "gasto" } = {}) {
    let mov = null;
    if (id) { mov = await intentar(() => DB.movimiento(id)); if (!mov) return; tipo = mov.tipo; }
    let cats = await DB.categorias();
    const f = {
      tipo, monto: mov ? mov.monto : 0, categoria_id: mov ? mov.categoria_id : null,
      descripcion: mov ? mov.descripcion : "", fecha: mov ? mov.fecha : (U.mesDe(U.hoy()) === state.mes ? U.hoy() : U.rangoMes(state.mes).desde),
    };
    const esCuota = mov && mov.cuota_id;

    const m = modal({
      titulo: id ? "Modificar movimiento" : "Incluir movimiento",
      cuerpo: `
        ${id ? `<div class="mini" style="margin-bottom:-4px">Movimiento n.º ${id}</div>` : ""}
        ${esCuota ? `<div class="notice"><i data-lucide="info"></i><span>Es el pago de una cuota de préstamo. Si lo borrás, la cuota vuelve a quedar pendiente.</span></div>` : ""}
        <div class="seg" id="mTipo"><button type="button" data-t="gasto">Gasto</button><button type="button" data-t="ingreso" ${esCuota ? "disabled" : ""}>Ingreso</button></div>
        <label class="field amount" id="mMontoBox"><span>Monto</span><span class="amount-line"><span class="cur">Gs.</span><input id="mMonto" inputmode="numeric" autocomplete="off" placeholder="0" value="${f.monto || ""}"></span></label>
        <div class="lbl">Categoría</div>
        <div class="chips" id="mCats"></div>
        <label class="field"><span>Descripción</span><input id="mDesc" maxlength="100" placeholder="Ej.: Almuerzo" value="${esc(f.descripcion)}"></label>
        <label class="field"><span>Fecha</span><input id="mFecha" type="date" value="${f.fecha}"></label>
        <div id="mFreq"></div>
        <div class="err" id="mErr"></div>`,
      pie: `${id ? `<button class="btn btn-danger-outline btn-icon" id="mBorrar" aria-label="Borrar"><i data-lucide="trash-2"></i></button>` : ""}
        <button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="mGuardar">Guardar</button>`,
    });
    const el = m.el, err = $("#mErr", el);
    montoInput($("#mMonto", el));

    const pintarCats = () => {
      const lista = cats.filter((c) => c.tipo === f.tipo).sort((a, b) => b.usos - a.usos || a.nombre.localeCompare(b.nombre, "es"));
      if (!lista.some((c) => c.id === f.categoria_id)) f.categoria_id = null;
      $("#mCats", el).innerHTML = lista.map((c) => `<button type="button" class="chip ${c.id === f.categoria_id ? "on" : ""}" data-c="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.nombre)}</button>`).join("")
        + `<button type="button" class="chip add" data-c="nueva"><i data-lucide="plus"></i>Nueva</button>`;
      icons();
    };
    const pintarFreq = async () => {
      if (id) return;
      const fr = await DB.frecuentes(f.tipo, 3);
      $("#mFreq", el).innerHTML = fr.length ? `<div class="mini" style="margin-bottom:8px">Frecuentes</div><div class="freq">${fr.map((x, i) => `<button type="button" data-i="${i}">${esc(x.descripcion)} ·<br>${U.num(x.monto)}</button>`).join("")}</div>` : "";
      $$("#mFreq [data-i]", el).forEach((b) => b.addEventListener("click", () => {
        const x = fr[+b.dataset.i];
        $("#mMonto", el).value = U.num(x.monto); $("#mDesc", el).value = x.descripcion; f.categoria_id = x.categoria_id; pintarCats();
      }));
    };
    const pintarTipo = () => {
      $$("#mTipo button", el).forEach((b) => b.classList.toggle("on", b.dataset.t === f.tipo));
      $("#mTipo", el).classList.toggle("ingreso", f.tipo === "ingreso");
      $("#mMontoBox", el).classList.toggle("ingreso", f.tipo === "ingreso");
      $("#mDesc", el).placeholder = f.tipo === "ingreso" ? "Ej.: Sueldo de noviembre" : "Ej.: Almuerzo";
      pintarCats(); pintarFreq();
    };
    $("#mTipo", el).addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b && !b.disabled) { f.tipo = b.dataset.t; pintarTipo(); } });
    $("#mCats", el).addEventListener("click", async (e) => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      if (b.dataset.c === "nueva") {
        const nueva = await modalCategoria({ tipo: f.tipo });
        if (nueva) { cats = await DB.categorias(); f.categoria_id = nueva.id; pintarCats(); }
        return;
      }
      f.categoria_id = +b.dataset.c; pintarCats();
    });
    pintarTipo();

    const guardar = async () => {
      err.textContent = "";
      const datos = { id, tipo: f.tipo, monto: U.leerNum($("#mMonto", el).value), categoria_id: f.categoria_id, descripcion: $("#mDesc", el).value, fecha: $("#mFecha", el).value };
      const btn = $("#mGuardar", el); btn.disabled = true;
      const r = await intentar(() => DB.guardarMovimiento(datos), err);
      btn.disabled = false;
      if (!r) return;
      m.cerrar();
      toast(id ? "Movimiento modificado" : `Anotado: ${U.gs(datos.monto)}${f.categoria_id ? " en " + cats.find((c) => c.id === f.categoria_id).nombre : ""}`);
      if (!id && U.mesDe(datos.fecha) !== state.mes && ["inicio", "movimientos", "ingresos", "gastos"].includes(state.ruta)) state.mes = U.mesDe(datos.fecha);
      render();
    };
    $("#mGuardar", el).addEventListener("click", guardar);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardar(); } });
    const bb = $("#mBorrar", el);
    if (bb) bb.addEventListener("click", async () => {
      if (!(await confirmar("Borrar movimiento", esCuota ? "Se borra el gasto y la cuota vuelve a quedar <b>pendiente</b>." : "¿Seguro que querés borrar este movimiento?"))) return;
      if (await intentar(() => DB.borrarMovimiento(id), err)) { m.cerrar(); toast("Movimiento borrado"); render(); }
    });
  }

  /* ============================================================
     Modal: categoría. Devuelve la categoría guardada (o null).
     ============================================================ */
  async function modalCategoria({ id = null, tipo = "gasto" } = {}) {
    let c = null;
    if (id) { c = (await DB.categorias()).find((x) => x.id === id); if (!c) return null; }
    const f = { tipo: c ? c.tipo : tipo, color: c ? c.color : COLORES[Math.floor(Math.random() * COLORES.length)] };
    return new Promise((res) => {
      let resultado = null;
      const m = modal({
        titulo: id ? "Modificar categoría" : "Nueva categoría", clase: "small",
        alCerrar: () => res(resultado),
        cuerpo: `
          ${id ? `<div class="mini" style="margin-bottom:-4px">Categoría n.º ${id}${c.usos ? ` · ${U.plural(c.usos, "uso", "usos")}` : ""}</div>` : ""}
          <div class="seg" id="cTipo"><button type="button" data-t="gasto">Gasto</button><button type="button" data-t="ingreso">Ingreso</button></div>
          <label class="field"><span>Nombre</span><input id="cNombre" maxlength="40" placeholder="Ej.: Supermercado" value="${esc(c ? c.nombre : "")}"></label>
          <div class="lbl">Color</div>
          <div class="colors" id="cColores">${COLORES.map((x) => `<button type="button" data-col="${x}" style="background:${x}" aria-label="Color ${x}"></button>`).join("")}</div>
          <div class="err" id="cErr"></div>`,
        pie: `${id ? `<button class="btn btn-danger-outline btn-icon" id="cBorrar" aria-label="Borrar"><i data-lucide="trash-2"></i></button>` : ""}
          <button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="cGuardar">Guardar</button>`,
      });
      const el = m.el, err = $("#cErr", el);
      const pintar = () => {
        $$("#cTipo button", el).forEach((b) => b.classList.toggle("on", b.dataset.t === f.tipo));
        $("#cTipo", el).classList.toggle("ingreso", f.tipo === "ingreso");
        $$("#cColores button", el).forEach((b) => b.classList.toggle("on", b.dataset.col === f.color));
      };
      $("#cTipo", el).addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { f.tipo = b.dataset.t; pintar(); } });
      $("#cColores", el).addEventListener("click", (e) => { const b = e.target.closest("[data-col]"); if (b) { f.color = b.dataset.col; pintar(); } });
      pintar();
      const guardar = async () => {
        err.textContent = "";
        const r = await intentar(() => DB.guardarCategoria({ id, nombre: $("#cNombre", el).value, tipo: f.tipo, color: f.color }), err);
        if (!r) return;
        resultado = r; m.cerrar(); toast(id ? "Categoría modificada" : "Categoría creada");
        if (state.ruta === "categorias") render();
      };
      $("#cGuardar", el).addEventListener("click", guardar);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardar(); } });
      const bb = $("#cBorrar", el);
      if (bb) bb.addEventListener("click", async () => {
        if (!(await confirmar("Borrar categoría", `¿Borrar «${esc(c.nombre)}»?`))) return;
        if (await intentar(() => DB.borrarCategoria(id), err)) { m.cerrar(); toast("Categoría borrada"); render(); }
      });
    });
  }

  /* ============================================================
     Modal: préstamo (incluir / modificar)
     ============================================================ */
  async function modalPrestamo(id = null) {
    let p = null;
    if (id) { p = await intentar(() => DB.prestamo(id)); if (!p) return; }
    const cats = (await DB.categorias()).filter((c) => c.tipo === "gasto");
    const bloqueado = p && p.pagadas > 0;
    const f = { categoria_id: p ? p.categoria_id : (cats.find((c) => U.norm(c.nombre).startsWith("prestamo")) || {}).id || null };
    const lock = bloqueado ? "readonly" : "";

    const m = modal({
      titulo: id ? "Modificar préstamo" : "Incluir préstamo",
      cuerpo: `
        ${bloqueado ? `<div class="notice"><i data-lucide="lock"></i><span>Este préstamo ya tiene <b>${U.plural(p.pagadas, "cuota pagada", "cuotas pagadas")}</b>. Las cuotas, el monto y la fecha de inicio quedan bloqueados para no perder el historial de pagos.</span></div>` : ""}
        <label class="field"><span>Entidad</span><input id="pEnt" maxlength="60" placeholder="Ej.: Banco Familiar" value="${esc(p ? p.entidad : "")}"></label>
        <label class="field ${bloqueado ? "locked" : ""}"><span>Cantidad de cuotas</span><input id="pCuotas" inputmode="numeric" placeholder="Ej.: 12" value="${p ? p.cuotas : ""}" ${lock}></label>
        <label class="field amount small ${bloqueado ? "locked" : ""}"><span>Monto de la cuota</span><span class="amount-line"><span class="cur">Gs.</span><input id="pMonto" inputmode="numeric" placeholder="0" value="${p ? p.monto_cuota : ""}" ${lock}></span></label>
        <div class="field calc ${bloqueado ? "locked" : ""}" id="pTotal"></div>
        <label class="field ${bloqueado ? "locked" : ""}"><span>Fecha de la primera cuota</span><input id="pFecha" type="date" value="${p ? p.fecha_inicio : U.hoy()}" ${lock}></label>
        <div class="lbl">Categoría de los pagos</div>
        <div class="chips" id="pCats"></div>
        <div class="mini txt" style="font-weight:500">Al marcar una cuota como pagada se registra un gasto con esta categoría.</div>
        <div class="err" id="pErr"></div>`,
      pie: `${id ? `<button class="btn btn-danger-outline btn-icon" id="pBorrar" aria-label="Borrar"><i data-lucide="trash-2"></i></button>` : ""}
        <button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="pGuardar">Guardar</button>`,
    });
    const el = m.el, err = $("#pErr", el);
    montoInput($("#pMonto", el));
    $("#pCuotas", el).addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3); });
    const total = () => {
      const n = U.leerNum($("#pCuotas", el).value), mo = U.leerNum($("#pMonto", el).value);
      $("#pTotal", el).innerHTML = `<span>${bloqueado ? "Total a pagar" : "Total a pagar (se calcula solo)"}</span>
        <div class="v"><small>Gs.</small>${U.num(p && bloqueado ? p.total : n * mo)}</div>
        ${n && mo ? `<div class="d">${n} ${n === 1 ? "cuota" : "cuotas"} × ${U.gs(mo)}</div>` : ""}`;
    };
    ["#pCuotas", "#pMonto"].forEach((s) => $(s, el).addEventListener("input", total));
    total();
    const pintarCats = () => {
      $("#pCats", el).innerHTML = cats.map((c) => `<button type="button" class="chip ${c.id === f.categoria_id ? "on" : ""}" data-c="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.nombre)}</button>`).join("");
    };
    $("#pCats", el).addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) { f.categoria_id = +b.dataset.c; pintarCats(); } });
    pintarCats();

    const guardar = async () => {
      err.textContent = "";
      const datos = { id, entidad: $("#pEnt", el).value, cuotas: U.leerNum($("#pCuotas", el).value), monto_cuota: U.leerNum($("#pMonto", el).value), fecha_inicio: $("#pFecha", el).value, categoria_id: f.categoria_id };
      const r = await intentar(() => DB.guardarPrestamo(datos), err);
      if (!r) return;
      m.cerrar(); toast(id ? "Préstamo modificado" : "Préstamo incluido"); render();
    };
    $("#pGuardar", el).addEventListener("click", guardar);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardar(); } });
    const bb = $("#pBorrar", el);
    if (bb) bb.addEventListener("click", async () => {
      const txt = p.pagadas ? `Se borran el préstamo y sus cuotas. Los <b>${U.plural(p.pagadas, "pago ya registrado", "pagos ya registrados")}</b> quedan en tus gastos.` : "Se borran el préstamo y todas sus cuotas.";
      if (!(await confirmar(`Borrar ${esc(p.entidad)}`, txt))) return;
      if (await intentar(() => DB.borrarPrestamo(id), err)) { m.cerrar(); toast("Préstamo borrado"); render(); }
    });
  }

  /* ============================================================
     Modal: cuotas de un préstamo (próximas y todas)
     ============================================================ */
  function icoCuota(c) {
    if (c.pagada_el) return icoLucide("check", "var(--green-soft)", "var(--green)");
    if (c.vence < U.hoy()) return icoLucide("triangle-alert", "var(--red-soft)", "var(--red)");
    return icoLucide("calendar", "#eceff3", "#4b5563");
  }
  /** "25 nov" este año, "25 ene 2027" otro año */
  const fechaCuota = (s) => { const t = `${+s.slice(8, 10)} ${U.mesCorto(s.slice(0, 7)).toLowerCase()}`; return s.slice(0, 4) === U.hoy().slice(0, 4) ? t : `${t} ${s.slice(0, 4)}`; };
  function subCuota(c) {
    if (c.pagada_el) return `<span class="row-sub">Pagada el ${fechaCuota(c.pagada_el)}</span>`;
    const d = U.diasEntre(c.vence, U.hoy());
    if (d > 0) return `<span class="row-sub danger">Vencida · ${d === 1 ? "1 día" : `${d} días`} de mora</span>`;
    if (d === 0) return `<span class="row-sub danger">Vence hoy</span>`;
    return `<span class="row-sub">Vence ${fechaCuota(c.vence)}</span>`;
  }

  async function modalCuotas(prestamoId) {
    const m = modal({
      titulo: "Cuotas", cuerpo: `<div id="cuBody"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="cuTodas">Ver todas las cuotas</button>`,
    });
    const el = m.el;
    const pintar = async () => {
      const p = await intentar(() => DB.prestamo(prestamoId));
      if (!p) { m.cerrar(); return; }
      const cs = await DB.cuotas(prestamoId);
      $(".modal-head h2", el).textContent = `Cuotas · ${p.entidad}`;
      const pend = cs.filter((c) => !c.pagada_el);
      const hoy = U.hoy();
      const prox = [...pend.filter((c) => c.vence < hoy), ...pend.filter((c) => c.vence >= hoy).slice(0, 3)];
      $("#cuBody", el).innerHTML = `
        <section class="hero" style="margin-bottom:18px">
          <div class="hero-main"><div class="hero-label">Pendiente por pagar</div><div class="hero-amount ${p.saldo ? "salmon" : "mint"}" style="font-size:34px">${U.gs(p.saldo)}</div></div>
          <div class="hero-boxes">
            <div class="hero-box" style="min-width:0"><div class="k">Cuotas pendientes</div><div class="v">${p.pendientes}</div></div>
            <div class="hero-box" style="min-width:0"><div class="k">Vencidas</div><div class="v ${p.vencidas ? "salmon" : ""}">${p.vencidas}</div></div>
          </div>
        </section>
        <div class="section-head" style="margin-top:0"><h2>${p.cancelado ? "Préstamo cancelado" : "Próximas cuotas"}</h2></div>
        ${p.cancelado ? `<div class="empty"><div class="empty-ico"><i data-lucide="party-popper"></i></div><h3>¡Pagaste todas las cuotas!</h3><p>${U.plural(p.cuotas, "cuota", "cuotas")} · ${U.gs(p.total)} en total.</p></div>`
          : `<div class="list">${prox.map((c, i) => `
            <div ${i ? 'style="border-top:1px solid #f1f3f5"' : ""}>
              <div class="row">
                ${icoCuota(c)}
                <span class="row-body"><span class="row-title">Cuota ${c.numero}</span>${subCuota(c)}</span>
                <span class="row-amount ${c.vence < hoy ? "debt" : "neg"}">${U.num(c.monto)}</span>
                ${i ? `<button class="icon-btn plain" data-editar="${c.id}" aria-label="Modificar cuota ${c.numero}"><i data-lucide="pencil"></i></button>` : ""}
              </div>
              ${i === 0 ? `<div class="cuota-actions"><button class="btn btn-primary btn-sm" data-pagar="${c.id}"><i data-lucide="check"></i>Marcar como pagada</button><button class="btn btn-outline btn-sm" data-editar="${c.id}">Modificar</button></div>` : ""}
            </div>`).join("")}</div>`}`;
      icons();
      $$("[data-pagar]", el).forEach((b) => b.addEventListener("click", () => modalPagar(cs.find((c) => c.id === +b.dataset.pagar), p, refrescar)));
      $$("[data-editar]", el).forEach((b) => b.addEventListener("click", () => modalCuota(cs.find((c) => c.id === +b.dataset.editar), refrescar)));
    };
    const refrescar = () => { pintar(); render(); };
    $("#cuTodas", el).addEventListener("click", () => modalTodasCuotas(prestamoId, refrescar));
    pintar();
  }

  async function modalTodasCuotas(prestamoId, alCambiar) {
    const m = modal({ titulo: "Todas las cuotas", cuerpo: `<div id="tcBody"></div>`, pie: `<button class="btn btn-outline btn-block" data-cerrar style="flex:1">Salir</button>` });
    const el = m.el;
    const pintar = async () => {
      const p = await intentar(() => DB.prestamo(prestamoId));
      if (!p) { m.cerrar(); return; }
      const cs = await DB.cuotas(prestamoId);
      $(".modal-head h2", el).textContent = `Todas las cuotas · ${p.entidad}`;
      const pct = p.total ? Math.round((p.pagado / p.total) * 100) : 0;
      const t = state.tabCuotas;
      const lista = cs.filter((c) => t === "todas" || (t === "pagadas" ? c.pagada_el : !c.pagada_el));
      $("#tcBody", el).innerHTML = `
        <section class="hero" style="margin-bottom:16px">
          <div class="hero-main"><div class="hero-label">Total del préstamo</div><div class="hero-amount" style="font-size:34px">${U.gs(p.total)}</div></div>
          <div class="hero-split"><div><div class="k">Pagado</div><div class="v" style="color:var(--mint)">${U.gs(p.pagado)}</div></div>
            <div><div class="k">Pendiente</div><div class="v" style="color:var(--salmon)">${U.gs(p.saldo)}</div></div></div>
          <div style="width:100%"><div class="bar"><span style="width:${pct}%"></span></div><div class="hero-sub">${p.pagadas} de ${p.cuotas} cuotas pagadas · ${pct}%</div></div>
        </section>
        <div class="seg" id="tcTabs" style="margin-bottom:14px">
          ${[["todas", "Todas"], ["pendientes", "Pendientes"], ["pagadas", "Pagadas"]].map(([k, v]) => `<button type="button" data-tab="${k}" class="${k === t ? "on" : ""}">${v}</button>`).join("")}
        </div>
        ${lista.length ? `<div class="list">${lista.map((c) => `
          <button class="row" data-cu="${c.id}">
            ${icoCuota(c)}
            <span class="row-body"><span class="row-title">Cuota ${c.numero}</span>${subCuota(c)}</span>
            <span class="row-amount ${!c.pagada_el && c.vence < U.hoy() ? "debt" : "neg"}">${U.num(c.monto)}</span>
          </button>`).join("")}</div>` : `<div class="empty"><p style="margin:0">No hay cuotas ${t === "pagadas" ? "pagadas" : "pendientes"}.</p></div>`}`;
      icons();
      $("#tcTabs", el).addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { state.tabCuotas = b.dataset.tab; pintar(); } });
      $$("[data-cu]", el).forEach((b) => b.addEventListener("click", async () => {
        const c = cs.find((x) => x.id === +b.dataset.cu);
        if (c.pagada_el) {
          if (!(await confirmar(`Cuota ${c.numero}`, `Pagada el ${U.fecha(c.pagada_el)}. ¿Desmarcar el pago? Se borra el gasto que se había registrado.`, "Desmarcar pago"))) return;
          if (await intentar(() => DB.desmarcarCuota(c.id))) { toast(`Cuota ${c.numero} vuelve a estar pendiente`); refrescar(); }
        } else modalCuota(c, refrescar, p);
      }));
    };
    const refrescar = () => { pintar(); alCambiar && alCambiar(); };
    pintar();
  }

  /** Confirma el pago de una cuota eligiendo la fecha */
  function modalPagar(c, p, alCambiar) {
    const m = modal({
      titulo: `Pagar cuota ${c.numero}`, clase: "small",
      cuerpo: `
        <p style="margin:0;color:var(--ink2)">${esc(p.entidad)} · <b>${U.gs(c.monto)}</b>. Se registra como gasto en <b>${esc(p.categoria ? p.categoria.nombre : "")}</b>.</p>
        <label class="field"><span>Fecha de pago</span><input id="pgFecha" type="date" value="${U.hoy()}"></label>
        <div class="err" id="pgErr"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="pgOk"><i data-lucide="check"></i>Marcar como pagada</button>`,
    });
    $("#pgOk", m.el).addEventListener("click", async () => {
      const r = await intentar(() => DB.pagarCuota(c.id, $("#pgFecha", m.el).value), $("#pgErr", m.el));
      if (!r) return;
      m.cerrar(); toast(`Cuota ${c.numero} pagada`); alCambiar && alCambiar();
    });
  }

  /** Modifica monto o vencimiento de una cuota pendiente */
  async function modalCuota(c, alCambiar, p) {
    if (!p) p = await DB.prestamo(c.prestamo_id);
    const m = modal({
      titulo: `Cuota ${c.numero}`, clase: "small",
      cuerpo: `
        <label class="field amount small"><span>Monto</span><span class="amount-line"><span class="cur">Gs.</span><input id="cuMonto" inputmode="numeric" value="${c.monto}"></span></label>
        <label class="field"><span>Vence</span><input id="cuVence" type="date" value="${c.vence}"></label>
        <div class="err" id="cuErr"></div>`,
      pie: `<button class="btn btn-outline" id="cuPagar" title="Marcar como pagada"><i data-lucide="check"></i>Pagada</button><button class="btn btn-primary" id="cuOk">Guardar</button>`,
    });
    montoInput($("#cuMonto", m.el));
    $("#cuOk", m.el).addEventListener("click", async () => {
      const r = await intentar(() => DB.guardarCuota({ id: c.id, monto: U.leerNum($("#cuMonto", m.el).value), vence: $("#cuVence", m.el).value }), $("#cuErr", m.el));
      if (!r) return;
      m.cerrar(); toast(`Cuota ${c.numero} modificada`); alCambiar && alCambiar();
    });
    $("#cuPagar", m.el).addEventListener("click", () => { m.cerrar(); modalPagar(c, p, alCambiar); });
  }

  /* ============================================================
     Modal: ahorro
     ============================================================ */
  async function modalAhorro(id = null) {
    const lista = await DB.ahorros();
    const a = id ? lista.find((x) => x.id === id) : null;
    if (id && !a) return toast("El registro ya no existe.", true);
    const entidades = [...new Set(lista.map((x) => x.entidad))];
    const f = { tipo: a ? a.tipo : "deposito" };
    const m = modal({
      titulo: id ? "Modificar ahorro" : "Incluir ahorro",
      cuerpo: `
        <div class="seg ingreso" id="aTipo"><button type="button" data-t="deposito">Depósito</button><button type="button" data-t="retiro">Retiro</button></div>
        <label class="field amount" id="aMontoBox"><span>Monto</span><span class="amount-line"><span class="cur">Gs.</span><input id="aMonto" inputmode="numeric" placeholder="0" value="${a ? a.monto : ""}"></span></label>
        <label class="field"><span>Entidad</span><input id="aEnt" list="aEntList" maxlength="60" placeholder="Ej.: Banco, cooperativa, alcancía" value="${esc(a ? a.entidad : (entidades[0] || ""))}" autocomplete="off"></label>
        <datalist id="aEntList">${entidades.map((e) => `<option value="${esc(e)}">`).join("")}</datalist>
        <label class="field"><span>Descripción</span><input id="aDesc" maxlength="100" placeholder="Ej.: Ahorro del mes" value="${esc(a ? a.descripcion : "")}"></label>
        <label class="field"><span>Fecha</span><input id="aFecha" type="date" value="${a ? a.fecha : U.hoy()}"></label>
        <div class="err" id="aErr"></div>`,
      pie: `${id ? `<button class="btn btn-danger-outline btn-icon" id="aBorrar" aria-label="Borrar"><i data-lucide="trash-2"></i></button>` : ""}
        <button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="aGuardar">Guardar</button>`,
    });
    const el = m.el, err = $("#aErr", el);
    montoInput($("#aMonto", el));
    const pintar = () => {
      $$("#aTipo button", el).forEach((b) => b.classList.toggle("on", b.dataset.t === f.tipo));
      $("#aTipo", el).classList.toggle("ingreso", f.tipo === "deposito");
      $("#aMontoBox", el).classList.toggle("ingreso", f.tipo === "deposito");
    };
    $("#aTipo", el).addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { f.tipo = b.dataset.t; pintar(); } });
    pintar();
    const guardar = async () => {
      err.textContent = "";
      const r = await intentar(() => DB.guardarAhorro({ id, tipo: f.tipo, monto: U.leerNum($("#aMonto", el).value), entidad: $("#aEnt", el).value, descripcion: $("#aDesc", el).value, fecha: $("#aFecha", el).value }), err);
      if (!r) return;
      m.cerrar(); toast(id ? "Ahorro modificado" : f.tipo === "deposito" ? "Depósito registrado" : "Retiro registrado"); render();
    };
    $("#aGuardar", el).addEventListener("click", guardar);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardar(); } });
    const bb = $("#aBorrar", el);
    if (bb) bb.addEventListener("click", async () => {
      if (!(await confirmar("Borrar registro", "¿Seguro que querés borrar este registro de ahorro?"))) return;
      if (await intentar(() => DB.borrarAhorro(id), err)) { m.cerrar(); toast("Registro borrado"); render(); }
    });
  }

  /* ============================================================
     Cuenta: ingreso, clave, abono
     ============================================================ */
  function mostrarLogin(msg) {
    state.cuenta = null;
    renderId++;
    $$(".modal-back").forEach((m) => m.remove());
    document.body.style.overflow = "";
    document.body.classList.add("sin-sesion");
    $("#auth").innerHTML = `
      <form class="auth-card" id="fLogin" novalidate>
        <div class="auth-brand">${LOGO}<span>${esc(cfg.nombreApp)}</span></div>
        <h1>Ingresá a tu cuenta</h1>
        <p class="page-sub">Tus ingresos, gastos, préstamos y ahorros en un solo lugar.</p>
        ${msg ? `<div class="aviso warn" style="margin:0"><i data-lucide="info"></i><span>${esc(msg)}</span></div>` : ""}
        <label class="field"><span>Email</span><input id="lEmail" type="email" autocomplete="username" inputmode="email" required></label>
        <label class="field"><span>Contraseña</span><input id="lClave" type="password" autocomplete="current-password" required></label>
        <div class="err" id="lErr"></div>
        <button class="btn btn-primary btn-block" id="lBtn">Ingresar</button>
        <div class="auth-help">¿Olvidaste tu contraseña? <a href="${wa(`Hola, olvidé mi contraseña de ${cfg.nombreApp}.`)}" target="_blank" rel="noopener">Escribinos</a> y te damos una nueva.</div>
        <div class="auth-help">¿Todavía no tenés cuenta? <a href="${wa(`Hola, quiero una cuenta de ${cfg.nombreApp}.`)}" target="_blank" rel="noopener">Pedila por WhatsApp</a></div>
        <div class="auth-help" style="font-size:13px"><a href="terminos.html" target="_blank">Términos</a> · <a href="privacidad.html" target="_blank">Privacidad</a> · <a href="ventas.html">Conocé el sistema</a></div>
        ${DB.modo === "demo" ? `<div class="demo-hint"><b>Modo demo.</b> Cuentas de prueba (contraseña <code>${esc(cfg.demoPassword)}</code>):<br>
          <button type="button" data-demo="magnom@demo.com">magnom@demo.com</button> · al día<br>
          <button type="button" data-demo="ana@demo.com">ana@demo.com</button> · vence en 3 días<br>
          <button type="button" data-demo="carlos@demo.com">carlos@demo.com</button> · vencida (solo lectura)<br>
          Superadmin: <a href="superadmin.html" style="color:#8a5a00;font-weight:600">superadmin.html</a> (contraseña <code>${esc(cfg.demoPasswordSuper)}</code>)</div>` : ""}
      </form>`;
    icons();
    const f = $("#fLogin");
    $$("[data-demo]", f).forEach((b) => b.addEventListener("click", () => { $("#lEmail").value = b.dataset.demo; $("#lClave").value = cfg.demoPassword; }));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#lErr"), btn = $("#lBtn");
      err.textContent = "";
      const email = $("#lEmail").value.trim(), clave = $("#lClave").value;
      if (!email || !clave) { err.textContent = "Ingresá tu email y tu contraseña."; return; }
      btn.disabled = true; btn.textContent = "Ingresando…";
      try {
        const c = await DB.login(email, clave);
        seguir(c, clave);
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = "Ingresar";
      }
    });
    setTimeout(() => $("#lEmail") && $("#lEmail").focus(), 50);
  }

  /** Primer ingreso (o clave reseteada): tiene que elegir su propia contraseña */
  function mostrarCambioClave(temporal) {
    document.body.classList.add("sin-sesion");
    $("#auth").innerHTML = `
      <form class="auth-card" id="fClave" novalidate>
        <div class="auth-brand">${LOGO}<span>${esc(cfg.nombreApp)}</span></div>
        <h1>Elegí tu contraseña</h1>
        <p class="page-sub">Estás usando una contraseña temporal. Cambiala por una que solo vos sepas.</p>
        <label class="field" ${temporal ? "hidden" : ""}><span>Contraseña temporal</span><input id="cActual" type="password" autocomplete="current-password" value="${esc(temporal || "")}"></label>
        <label class="field"><span>Contraseña nueva (mínimo 8 caracteres)</span><input id="cNueva" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Repetila</span><input id="cRepite" type="password" autocomplete="new-password"></label>
        <div class="err" id="cErr"></div>
        <button class="btn btn-primary btn-block" id="cBtn">Guardar y entrar</button>
        <div class="auth-help"><a href="#" id="cSalir">Salir</a></div>
      </form>`;
    const f = $("#fClave");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#cErr");
      err.textContent = "";
      const nueva = $("#cNueva").value;
      if (nueva.length < 8) { err.textContent = "La contraseña tiene que tener al menos 8 caracteres."; return; }
      if (nueva !== $("#cRepite").value) { err.textContent = "Las dos contraseñas no coinciden."; return; }
      try {
        const c = await DB.cambiarClave($("#cActual").value, nueva);
        toast("Listo, ya tenés tu contraseña"); seguir(c);
      } catch (ex) {
        if (ex.sesion === false) mostrarLogin(ex.message); else err.textContent = ex.message;
      }
    });
    $("#cSalir").addEventListener("click", async (e) => { e.preventDefault(); await DB.logout().catch(() => {}); mostrarLogin(); });
    setTimeout(() => $(temporal ? "#cNueva" : "#cActual").focus(), 50);
  }

  /** Después de ingresar: clave temporal → elegir la propia; términos sin aceptar → aceptarlos; si no, adentro */
  function seguir(c, temporal = "") {
    if (c.debe_cambiar) mostrarCambioClave(temporal);
    else if (c.terminos_pendiente) mostrarTerminos(c);
    else entrar(c);
  }

  function mostrarTerminos(c) {
    document.body.classList.add("sin-sesion");
    $("#auth").innerHTML = `
      <form class="auth-card" id="fTerm" novalidate>
        <div class="auth-brand">${LOGO}<span>${esc(cfg.nombreApp)}</span></div>
        <h1>Antes de empezar</h1>
        <p class="page-sub">Para usar ${esc(cfg.nombreApp)} tenés que leer y aceptar las condiciones del servicio y cómo cuidamos tus datos.</p>
        <div class="card stack" style="padding:18px">
          <a class="row" href="terminos.html" target="_blank" rel="noopener" style="text-decoration:none;padding:4px 0">
            ${icoLucide("file-text", "var(--green-soft)", "var(--green)")}
            <span class="row-body"><span class="row-title">Términos y condiciones</span><span class="row-sub">Abono, uso del servicio y responsabilidades</span></span>
            <i data-lucide="external-link" class="row-chev"></i></a>
          <a class="row" href="privacidad.html" target="_blank" rel="noopener" style="text-decoration:none;padding:4px 0;border-top:1px solid #f1f3f5">
            ${icoLucide("shield-check", "var(--green-soft)", "var(--green)")}
            <span class="row-body"><span class="row-title">Política de privacidad</span><span class="row-sub">Qué datos guardamos y quién puede verlos</span></span>
            <i data-lucide="external-link" class="row-chev"></i></a>
        </div>
        <label class="notice" style="cursor:pointer;align-items:flex-start">
          <input type="checkbox" id="tAcepto" style="width:20px;height:20px;margin:1px 0 0;accent-color:var(--green);flex-shrink:0">
          <span>Leí y acepto los Términos y condiciones y la Política de privacidad. Soy mayor de edad.</span>
        </label>
        <div class="err" id="tErr"></div>
        <button class="btn btn-primary btn-block" id="tBtn">Aceptar y continuar</button>
        <div class="auth-help"><a href="#" id="tSalir">Salir</a></div>
      </form>`;
    icons();
    $("#fTerm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#tErr");
      if (!$("#tAcepto").checked) { err.textContent = "Para continuar, marcá la casilla de aceptación."; return; }
      try { entrar(await DB.aceptarTerminos()); }
      catch (ex) { if (ex.sesion === false) mostrarLogin(ex.message); else err.textContent = ex.message; }
    });
    $("#tSalir").addEventListener("click", async (e) => { e.preventDefault(); await DB.logout().catch(() => {}); mostrarLogin(); });
  }

  function entrar(c) {
    state.cuenta = c;
    state.mes = U.mesActual();
    document.body.classList.remove("sin-sesion");
    $("#auth").innerHTML = "";
    pintarCuenta();
    if (!location.hash) location.replace("#/inicio");
    render();
  }

  async function salir() {
    await DB.logout().catch(() => {});
    location.hash = "#/inicio";
    mostrarLogin();
  }

  /** Avatar, nombre y aviso del abono */
  function pintarCuenta() {
    const c = state.cuenta;
    if (!c) return;
    $("#userName").textContent = primerNombre().toLowerCase();
    $("#avatar").textContent = (c.nombre || "?").trim().charAt(0).toUpperCase();
    const e = estado();
    const renovar = `<a class="btn btn-primary btn-sm" href="${wa(`Hola, quiero renovar mi abono de ${cfg.nombreApp} (${c.email}).`)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Renovar</a>`;
    const aviso = (tipo, ico, texto, boton = renovar) => `<div class="aviso ${tipo}"><i data-lucide="${ico}"></i><span>${texto}</span>${boton}</div>`;
    let html = "";
    if (e.estado === "por_vencer")
      html = aviso("info", "calendar-clock", `Tu abono vence <b>${e.dias === 0 ? "hoy" : e.dias === 1 ? "mañana" : `en ${e.dias} días`}</b> (${U.fecha(c.vence_el)}).`);
    else if (e.estado === "gracia")
      html = aviso("warn", "triangle-alert", `Tu abono venció el <b>${U.fecha(c.vence_el)}</b>. Podés seguir cargando hasta el ${U.fecha(e.hasta)}; después la cuenta queda en solo lectura.`);
    else if (e.estado === "vencida")
      html = aviso("danger", "lock", `Tu abono venció el <b>${U.fecha(c.vence_el)}</b>. La cuenta está en <b>solo lectura</b>: podés ver tus datos, pero no cargar ni modificar.`);
    else if (e.estado === "suspendida")
      html = aviso("danger", "lock", `Tu cuenta está <b>suspendida</b> (solo lectura).`, `<a class="btn btn-primary btn-sm" href="${wa(`Hola, mi cuenta de ${cfg.nombreApp} (${c.email}) está suspendida.`)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Escribinos</a>`);
    $("#aviso").innerHTML = html;
    $("#navFoot").innerHTML = `${DB.modo === "demo" ? `Modo demo: los datos se guardan solo en este navegador.<br><button data-act="reset">Volver a los datos de ejemplo</button><br><br>` : ""}<button data-act="salir">Cerrar sesión</button>`;
    icons();
  }

  /** En solo lectura, avisa en vez de abrir el formulario */
  function puedeEscribir() {
    const e = estado();
    if (!e.soloLectura) return true;
    const c = state.cuenta;
    modal({
      titulo: "Cuenta en solo lectura", clase: "small",
      cuerpo: `<p style="margin:0;color:var(--ink2)">${e.estado === "suspendida" ? "Tu cuenta está suspendida." : `Tu abono venció el <b>${U.fecha(c.vence_el)}</b>.`}
        Podés ver todos tus datos, pero para cargar o modificar tenés que ${e.estado === "suspendida" ? "reactivarla" : "renovarlo"}.</p>`,
      pie: `<button class="btn btn-outline" data-cerrar>Cerrar</button><a class="btn btn-primary" href="${wa(`Hola, quiero renovar mi abono de ${cfg.nombreApp} (${c.email}).`)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Escribir por WhatsApp</a>`,
    });
    return false;
  }

  /** Mi cuenta: datos, abono, cambiar contraseña y salir */
  async function modalMiCuenta() {
    const c = (await intentar(() => DB.sesion())) || state.cuenta;
    if (!c) return;
    state.cuenta = c; pintarCuenta();
    const e = estado();
    const pill = { activa: "", por_vencer: "gray", gracia: "red", vencida: "red", suspendida: "red" }[e.estado];
    const m = modal({
      titulo: "Mi cuenta", clase: "small",
      cuerpo: `
        <div class="card" style="padding:6px 18px">
          <div class="kv"><span class="k">Nombre</span><span class="v">${esc(c.nombre)}</span></div>
          <div class="kv"><span class="k">Email</span><span class="v">${esc(c.email)}</span></div>
          <div class="kv"><span class="k">Abono</span><span class="v"><span class="pill ${pill}">${U.ESTADOS[e.estado]}</span></span></div>
          ${c.vence_el ? `<div class="kv"><span class="k">${e.dias < 0 ? "Venció el" : "Vence el"}</span><span class="v">${U.fecha(c.vence_el)}</span></div>` : ""}
          <div class="kv"><span class="k">Abono mensual</span><span class="v">${U.gs(c.precio)}</span></div>
        </div>
        <div class="stack">
          <a class="btn btn-primary btn-block" href="${wa(`Hola, quiero renovar mi abono de ${cfg.nombreApp} (${c.email}).`)}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i>Renovar o consultar por WhatsApp</a>
          <button class="btn btn-outline btn-block" id="mcClave"><i data-lucide="key-round"></i>Cambiar contraseña</button>
          <button class="btn btn-danger-outline btn-block" id="mcSalir"><i data-lucide="log-out"></i>Cerrar sesión</button>
        </div>`,
    });
    $("#mcClave", m.el).addEventListener("click", () => { m.cerrar(); modalCambiarClave(); });
    $("#mcSalir", m.el).addEventListener("click", () => { m.cerrar(); salir(); });
  }

  function modalCambiarClave() {
    const m = modal({
      titulo: "Cambiar contraseña", clase: "small",
      cuerpo: `
        <label class="field"><span>Contraseña actual</span><input id="ccActual" type="password" autocomplete="current-password"></label>
        <label class="field"><span>Contraseña nueva (mínimo 8 caracteres)</span><input id="ccNueva" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Repetila</span><input id="ccRepite" type="password" autocomplete="new-password"></label>
        <p class="mini txt" style="margin:0;font-weight:500">Se cierra la sesión en tus otros dispositivos.</p>
        <div class="err" id="ccErr"></div>`,
      pie: `<button class="btn btn-outline" data-cerrar>Salir</button><button class="btn btn-primary" id="ccOk">Guardar</button>`,
    });
    const el = m.el, err = $("#ccErr", el);
    const guardar = async () => {
      err.textContent = "";
      const nueva = $("#ccNueva", el).value;
      if (nueva.length < 8) { err.textContent = "La contraseña tiene que tener al menos 8 caracteres."; return; }
      if (nueva !== $("#ccRepite", el).value) { err.textContent = "Las dos contraseñas no coinciden."; return; }
      const c = await intentar(() => DB.cambiarClave($("#ccActual", el).value, nueva), err);
      if (!c) return;
      state.cuenta = c; m.cerrar(); toast("Contraseña cambiada");
    };
    $("#ccOk", el).addEventListener("click", guardar);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); guardar(); } });
  }

  /* ============================================================
     Navegación
     ============================================================ */
  const FAB = {
    inicio: () => modalMovimiento({ tipo: "gasto" }),
    movimientos: () => modalMovimiento({ tipo: "gasto" }),
    gastos: () => modalMovimiento({ tipo: "gasto" }),
    ingresos: () => modalMovimiento({ tipo: "ingreso" }),
    categorias: () => modalCategoria(),
    prestamos: () => modalPrestamo(),
    ahorros: () => modalAhorro(),
  };

  async function render() {
    if (!state.cuenta) return;
    const [ruta, sub] = location.hash.replace(/^#\/?/, "").split("/");
    if (!PAGINAS[ruta]) { location.replace("#/inicio"); return; }
    if (ruta !== state.ruta) state.buscar = "";
    state.ruta = ruta; state.sub = sub || "";
    $$(".nav-item").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === ruta));
    document.body.classList.remove("menu-abierto");
    $("#fab").classList.toggle("visible", Boolean(FAB[ruta]) && !estado().soloLectura);
    const id = ++renderId;
    try {
      await PAGINAS[ruta](id);
    } catch (e) {
      if (e.sesion === false) { mostrarLogin(e.message); return; }
      console.error(e);
      app.innerHTML = `<div class="empty"><h3>Algo salió mal</h3><p>${esc(e.message)}</p><button class="btn btn-primary" data-act="recargar">Reintentar</button></div>`;
    }
    if (id === renderId) icons();
  }

  // Acciones que cargan o modifican: en solo lectura muestran el aviso
  const ESCRIBEN = new Set(["nuevo-mov", "nueva-cat", "nuevo-prestamo", "nuevo-ahorro"]);

  // Clics de toda la página (delegados)
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || t.closest(".modal-back")) return;
    const n = Number(t.dataset.id);
    if (ESCRIBEN.has(t.dataset.act) && !puedeEscribir()) return;
    switch (t.dataset.act) {
      case "mes": state.mes = U.mesMas(state.mes, Number(t.dataset.d)); render(); break;
      case "ir-mes": state.mes = t.dataset.mes; render(); break;
      case "nuevo-mov": modalMovimiento({ tipo: t.dataset.tipo || "gasto" }); break;
      case "editar-mov": modalMovimiento({ id: n }); break;
      case "nueva-cat": modalCategoria(); break;
      case "editar-cat": modalCategoria({ id: n }); break;
      case "nuevo-prestamo": modalPrestamo(); break;
      case "editar-prestamo": e.stopPropagation(); modalPrestamo(n); break;
      case "cuotas": state.tabCuotas = "todas"; modalCuotas(n); break;
      case "nuevo-ahorro": modalAhorro(); break;
      case "editar-ahorro": modalAhorro(n); break;
      case "recargar": render(); break;
      case "salir": salir(); break;
      case "reset": (async () => {
        if (!(await confirmar("Volver a los datos de ejemplo", "Se borra todo lo que se cargó en este navegador (todas las cuentas de prueba) y vuelven los datos de ejemplo.", "Borrar y reiniciar"))) return;
        await DB.reset(); toast("Datos de ejemplo restaurados"); mostrarLogin();
      })(); break;
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "mesInput" && /^\d{4}-\d{2}$/.test(e.target.value)) { state.mes = e.target.value; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const ms = $$(".modal-back");
      if (ms.length) { const top = ms[ms.length - 1]; const x = top.querySelector("[data-cerrar]"); if (x) x.click(); }
      else document.body.classList.remove("menu-abierto");
    }
  });
  // Una llamada que falla por sesión vencida en cualquier lado → al login
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.sesion === false) { e.preventDefault(); mostrarLogin(e.reason.message); }
  });
  $("#btnMenu").addEventListener("click", () => {
    if (window.matchMedia("(min-width: 900px)").matches) document.body.classList.toggle("sin-menu");
    else document.body.classList.toggle("menu-abierto");
  });
  $("#scrim").addEventListener("click", () => document.body.classList.remove("menu-abierto"));
  $("#fab").addEventListener("click", () => { if (FAB[state.ruta] && puedeEscribir()) FAB[state.ruta](); });
  $("#btnCuenta").addEventListener("click", modalMiCuenta);

  let rz;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => { const g = $("#grafico"); if (g && g._datos) dibujarGrafico(g, g._datos); }, 150);
  });
  window.addEventListener("hashchange", render);

  /* ---------------- Arranque ---------------- */
  document.title = cfg.nombreApp || "Control de gastos";
  $("#brandName").textContent = cfg.nombreApp || "Control de gastos";

  (async () => {
    try {
      const c = await DB.sesion();
      if (!c) mostrarLogin();
      else seguir(c);
    } catch (e) {
      $("#auth").innerHTML = `<div class="auth-card"><div class="empty"><h3>No se pudo conectar</h3><p>${esc(e.message)}</p><button class="btn btn-primary" id="reintentar">Reintentar</button></div></div>`;
      $("#reintentar").addEventListener("click", () => location.reload());
    }
  })();
})();
