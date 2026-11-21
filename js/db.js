/* ============================================================
   CAPA DE DATOS
   - Si js/config.js tiene apiUrl → MODO ONLINE (js/db-oracle.js).
   - Si no → MODO DEMO: todo se guarda en el localStorage del navegador.
   Las dos variantes exponen las mismas funciones (todas async),
   así las páginas no cambian.

   Reglas que respeta (igual que el paquete CG_API en oracle/):
   - Cada cuenta ve solo sus datos.
   - Con clave temporal no se usa nada hasta cambiarla.
   - Abono vencido (pasados los días de gracia) o cuenta suspendida = solo lectura.
   - Pagar una cuota crea un gasto con la categoría del préstamo.
     Borrar ese gasto (o desmarcar la cuota) deshace el pago.
   - Un préstamo con cuotas pagadas solo deja cambiar entidad y categoría.
   - Una categoría en uso no se puede borrar.
   ============================================================ */
const DB = window.DB_ORACLE || (() => {
  const cfg = window.APP_CONFIG;
  const KEY = "control_gastos_demo_v2"; // v2: varias cuentas
  const nextId = (arr) => Math.max(0, ...arr.map((x) => x.id)) + 1;

  const CATEGORIAS_BASE = [
    ["Comida", "gasto", "#D9480F"], ["Transporte", "gasto", "#1C7ED6"], ["Hogar", "gasto", "#7048E8"],
    ["Salud", "gasto", "#C2255C"], ["Ocio", "gasto", "#E8590C"], ["Préstamos", "gasto", "#E03131"],
    ["Otros", "gasto", "#868E96"], ["Salario", "ingreso", "#0B7A5A"], ["Ventas", "ingreso", "#2B8A3E"],
    ["Otros ingresos", "ingreso", "#0C8599"],
  ];
  const datosVacios = () => ({
    categorias: CATEGORIAS_BASE.map(([nombre, tipo, color], i) => ({ id: i + 1, nombre, tipo, color })),
    movimientos: [], prestamos: [], cuotas: [], ahorros: [],
  });

  /* ---------------- Datos de ejemplo ---------------- */
  function datosEjemplo(completo) {
    const d = datosVacios();
    const mes = U.mesActual();
    const dia = (m, n) => `${U.mesMas(mes, m)}-${String(n).padStart(2, "0")}`;
    const hoy = U.hoy();
    const enMes = (f) => (f > hoy ? hoy : f); // no cargar movimientos en el futuro
    let mid = 0;
    const M = (tipo, monto, categoria_id, descripcion, fecha) =>
      d.movimientos.push({ id: ++mid, tipo, monto, categoria_id, descripcion, fecha: enMes(fecha), cuota_id: null });

    if (!completo) {
      M("ingreso", 4500000, 8, "Sueldo", dia(0, 1));
      M("gasto", 900000, 3, "Alquiler", dia(0, 2));
      M("gasto", 35000, 1, "Almuerzo", dia(0, 5));
      M("gasto", 120000, 2, "Nafta", dia(0, 8));
      return d;
    }

    // [ingreso, gastos del día a día] — las cuotas de préstamos se suman aparte
    const base = [[8000000, 3300000], [8000000, 2900000], [8500000, 3100000], [8000000, 3200000], [8000000, 2800000]];
    base.forEach(([ing, gas], i) => {
      const m = i - 5;
      M("ingreso", ing, 8, "Sueldo", dia(m, 1));
      M("gasto", 1200000, 3, "Alquiler", dia(m, 2));
      M("gasto", Math.round(gas * 0.3 / 1000) * 1000, 1, "Supermercado", dia(m, 8));
      M("gasto", Math.round(gas * 0.15 / 1000) * 1000, 2, "Nafta", dia(m, 12));
      M("gasto", Math.round(gas * 0.1 / 1000) * 1000, 5, "Salidas", dia(m, 18));
      M("gasto", gas - 1200000 - Math.round(gas * 0.55 / 1000) * 1000, 7, "Varios", dia(m, 24));
    });
    M("ingreso", 8000000, 8, "Sueldo", dia(0, 1));
    M("gasto", 1200000, 3, "Alquiler", dia(0, 1));
    M("gasto", 20000, 1, "Coca", dia(0, 1));
    M("gasto", 80000, 1, "Comida", dia(0, 1));
    M("gasto", 100000, 2, "Gps", dia(0, 1));
    M("gasto", 10000, 7, "Leche", dia(0, 2));
    M("gasto", 320000, 3, "Supermercado", dia(0, 5));
    M("gasto", 150000, 2, "Nafta", dia(0, 9));
    M("gasto", 8000, 1, "Café", dia(0, 12));
    M("gasto", 25000, 1, "Almuerzo", dia(0, 12));
    M("gasto", 25000, 1, "Almuerzo", dia(0, 15));
    M("gasto", 8000, 1, "Café", dia(0, 15));
    M("gasto", 150000, 2, "Nafta", dia(0, 17));
    M("gasto", 85000, 4, "Farmacia", dia(0, 18));
    M("ingreso", 350000, 9, "Venta de ropa usada", dia(0, 19));

    let pid = 0, cid = 0;
    const P = (entidad, n, monto_cuota, fecha_inicio, pagadas) => {
      const p = { id: ++pid, entidad, cuotas: n, monto_cuota, fecha_inicio, categoria_id: 6 };
      d.prestamos.push(p);
      for (let i = 1; i <= n; i++) {
        const c = { id: ++cid, prestamo_id: p.id, numero: i, vence: U.addMonths(fecha_inicio, i - 1), monto: monto_cuota, pagada_el: null, movimiento_id: null };
        if (pagadas == null ? c.vence < hoy : i <= pagadas) {
          c.pagada_el = c.vence > hoy ? hoy : c.vence;
          M("gasto", monto_cuota, 6, `Cuota ${i} · ${entidad}`, c.pagada_el);
          c.movimiento_id = mid;
          d.movimientos[d.movimientos.length - 1].cuota_id = c.id;
        }
        d.cuotas.push(c);
      }
    };
    // Banco Familiar: empezó hace 10 meses, 9 pagadas → la 10 está vencida (como en la maqueta)
    P("Banco Familiar", 36, 2000993, U.addMonths(dia(0, 1), -10).slice(0, 8) + "25", 9);
    P("Paraguayo Japonesa", 8, 490500, U.addMonths(dia(0, 6), -4), null);
    P("Aso Alex", 12, 575000, U.addMonths(dia(0, 28), -7), null);
    P("San Roque", 12, 352500, U.addMonths(dia(0, 1), -5), null);
    P("Mango", 1, 1995995, dia(1, 15), null);
    P("Celular en cuotas", 3, 400000, U.addMonths(dia(0, 10), -4), 3); // cancelado

    d.ahorros = [
      { id: 1, fecha: dia(-2, 4), descripcion: "Ahorro", entidad: "Solar", tipo: "deposito", monto: 300000 },
      { id: 2, fecha: dia(-1, 4), descripcion: "Ahorro", entidad: "Solar", tipo: "deposito", monto: 300000 },
      { id: 3, fecha: dia(-1, 20), descripcion: "Arreglo del auto", entidad: "Solar", tipo: "retiro", monto: 250000 },
      { id: 4, fecha: enMes(dia(0, 4)), descripcion: "Ahorro", entidad: "Solar", tipo: "deposito", monto: 50000 },
      { id: 5, fecha: enMes(dia(0, 10)), descripcion: "Fondo de emergencia", entidad: "Cooperativa Universitaria", tipo: "deposito", monto: 200000 },
    ];
    return d;
  }

  function seed() {
    const ahora = new Date().toISOString();
    const cuentas = [
      { id: 1, nombre: "Magnom", email: "magnom@demo.com", whatsapp: "595981111111", notas: "Cliente desde el lanzamiento", vence_el: U.addDays(U.hoy(), 20) },
      { id: 2, nombre: "Ana Benítez", email: "ana@demo.com", whatsapp: "595982222222", notas: "", vence_el: U.addDays(U.hoy(), 3) },
      { id: 3, nombre: "Carlos Duarte", email: "carlos@demo.com", whatsapp: "", notas: "Dijo que paga a fin de mes", vence_el: U.addDays(U.hoy(), -12) },
    ].map((c) => ({ ...c, clave: cfg.demoPassword, debe_cambiar: false, terminos_ver: cfg.terminosVersion, activo: true, precio: cfg.precioMensual, creado_en: ahora, ultimo_acceso: null }));
    const pagos = [
      { id: 1, cuenta_id: 1, fecha: U.addDays(U.hoy(), -10), monto: cfg.precioMensual, meses: 1, desde: U.addMonths(U.addDays(U.hoy(), 20), -1), hasta: U.addDays(U.hoy(), 20) },
      { id: 2, cuenta_id: 2, fecha: U.addDays(U.hoy(), -27), monto: cfg.precioMensual, meses: 1, desde: U.addMonths(U.addDays(U.hoy(), 3), -1), hasta: U.addDays(U.hoy(), 3) },
    ];
    return { cuentas, pagos, sesion: null, superSesion: false, datos: { 1: datosEjemplo(true), 2: datosEjemplo(false), 3: datosEjemplo(false) } };
  }

  /* ---------------- Almacenamiento ---------------- */
  let db;
  function cargar() {
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || !Array.isArray(db.cuentas)) { db = seed(); guardar(); }
  }
  function guardar() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* sin storage: queda en memoria */ }
  }
  cargar();
  // Otra pestaña cerró sesión o cambió datos → se recarga al usar
  window.addEventListener("storage", (e) => { if (e.key === KEY) cargar(); });

  const copia = (x) => JSON.parse(JSON.stringify(x));
  const ok = (x) => Promise.resolve(x === undefined ? undefined : copia(x));
  const error = (msg) => Promise.reject(new Error(msg));
  const errorSesion = () => { const e = new Error("Tu sesión terminó. Volvé a ingresar."); e.sesion = false; return Promise.reject(e); };

  /* Datos de la cuenta con sesión (data) y la cuenta (cta). Cada función pública los toma con conSesion. */
  let data, cta;
  function conSesion(fn, { escribir = false } = {}) {
    return (...args) => {
      cta = db.cuentas.find((c) => c.id === db.sesion);
      if (!cta) return errorSesion();
      if (cta.debe_cambiar) return error("Antes de seguir, cambiá la contraseña temporal. Recargá la página.");
      if (cta.terminos_ver !== cfg.terminosVersion) return error("Para seguir, aceptá los Términos y la Política de privacidad. Recargá la página.");
      if (escribir) {
        const e = U.estadoCuenta(cta, cfg.diasGracia);
        if (e.estado === "suspendida") return error("Tu cuenta está suspendida: podés ver tus datos, pero no cargar ni modificar. Escribinos para reactivarla.");
        if (e.estado === "vencida") return error(`Tu abono venció el ${U.fecha(cta.vence_el)}. Podés ver tus datos, pero para cargar o modificar tenés que renovarlo.`);
      }
      data = db.datos[cta.id] || (db.datos[cta.id] = datosVacios());
      try { return fn(...args); } catch (e) { return Promise.reject(e); }
    };
  }
  const soloSuper = (fn) => (...args) => (db.superSesion ? fn(...args) : errorSesion());

  /** Cuenta como la devuelve la base */
  function cuentaPublica(c, deSuper = false) {
    const o = { id: c.id, nombre: c.nombre, email: c.email, activo: c.activo, vence_el: c.vence_el, precio: c.precio,
      debe_cambiar: c.debe_cambiar, dias_gracia: cfg.diasGracia, creado_en: c.creado_en,
      terminos_pendiente: c.terminos_ver !== cfg.terminosVersion, terminos_version: cfg.terminosVersion };
    if (deSuper) {
      const movs = (db.datos[c.id] || datosVacios()).movimientos;
      Object.assign(o, { whatsapp: c.whatsapp, notas: c.notas, ultimo_acceso: c.ultimo_acceso, movimientos: movs.length,
        ultimo_mov: movs.reduce((m, x) => (x.fecha > m ? x.fecha : m), "") || null });
    }
    return o;
  }

  const cat = (id) => data.categorias.find((c) => c.id === id);

  /** Estado calculado de un préstamo */
  function estadoPrestamo(p) {
    const cs = data.cuotas.filter((c) => c.prestamo_id === p.id).sort((a, b) => a.numero - b.numero);
    const pend = cs.filter((c) => !c.pagada_el);
    const hoy = U.hoy();
    const total = cs.reduce((s, c) => s + c.monto, 0);
    const saldo = pend.reduce((s, c) => s + c.monto, 0);
    return {
      ...p, categoria: cat(p.categoria_id) || null,
      total, saldo, pagado: total - saldo,
      pagadas: cs.length - pend.length, pendientes: pend.length,
      vencidas: pend.filter((c) => c.vence < hoy).length,
      proxima: pend[0] || null, cancelado: pend.length === 0,
    };
  }

  function validarMov(m) {
    if (!["gasto", "ingreso"].includes(m.tipo)) return "Elegí si es gasto o ingreso.";
    if (!(m.monto > 0)) return "Ingresá un monto mayor a cero.";
    const c = cat(m.categoria_id);
    if (!c) return "Elegí una categoría.";
    if (c.tipo !== m.tipo) return "La categoría no corresponde al tipo de movimiento.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.fecha || "")) return "Ingresá una fecha válida.";
    if (String(m.descripcion || "").length > 100) return "La descripción es muy larga (máximo 100 letras).";
    return null;
  }
  function generarCuotas(p) {
    let id = nextId(data.cuotas);
    for (let i = 1; i <= p.cuotas; i++)
      data.cuotas.push({ id: id++, prestamo_id: p.id, numero: i, vence: U.addMonths(p.fecha_inicio, i - 1), monto: p.monto_cuota, pagada_el: null, movimiento_id: null });
  }
  const validarEmail = (s) => {
    const v = String(s || "").trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 120 ? v : null;
  };
  const claveTemporal = () => {
    const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => c[b % c.length]).join("");
  };

  const api = {
    modo: "demo",

    /* ----- Sesión de la cuenta ----- */
    sesion() {
      const c = db.cuentas.find((x) => x.id === db.sesion);
      return ok(c ? cuentaPublica(c) : null);
    },
    login(email, password) {
      const c = db.cuentas.find((x) => x.email === String(email || "").trim().toLowerCase());
      if (!c || c.clave !== password) return error("Email o contraseña incorrectos.");
      db.sesion = c.id; c.ultimo_acceso = new Date().toISOString(); guardar();
      return ok(cuentaPublica(c));
    },
    logout() { db.sesion = null; guardar(); return ok(null); },
    cambiarClave(actual, nueva) {
      const c = db.cuentas.find((x) => x.id === db.sesion);
      if (!c) return errorSesion();
      if (c.clave !== actual) return error("La contraseña actual no es correcta.");
      if (!nueva || nueva.length < 8) return error("La contraseña tiene que tener al menos 8 caracteres.");
      if (nueva === actual) return error("La contraseña nueva tiene que ser distinta de la actual.");
      c.clave = nueva; c.debe_cambiar = false; guardar();
      return ok(cuentaPublica(c));
    },

    aceptarTerminos() {
      const c = db.cuentas.find((x) => x.id === db.sesion);
      if (!c) return errorSesion();
      if (c.terminos_ver !== cfg.terminosVersion) { c.terminos_ver = cfg.terminosVersion; c.terminos_en = new Date().toISOString(); guardar(); }
      return ok(cuentaPublica(c));
    },

    /* ----- Categorías ----- */
    categorias: conSesion(() => ok(data.categorias.map((c) => ({
      ...c, usos: data.movimientos.filter((m) => m.categoria_id === c.id).length + data.prestamos.filter((p) => p.categoria_id === c.id).length,
    })))),
    guardarCategoria: conSesion((c) => {
      const nombre = String(c.nombre || "").trim();
      if (!nombre) return error("Ingresá un nombre.");
      if (nombre.length > 40) return error("El nombre es muy largo (máximo 40 letras).");
      if (!["gasto", "ingreso"].includes(c.tipo)) return error("Elegí si es de gastos o de ingresos.");
      if (data.categorias.find((x) => x.id !== c.id && x.tipo === c.tipo && U.norm(x.nombre) === U.norm(nombre))) return error("Ya existe una categoría con ese nombre.");
      if (c.id) {
        const x = cat(c.id);
        if (!x) return error("La categoría ya no existe.");
        const usada = data.movimientos.some((m) => m.categoria_id === c.id) || data.prestamos.some((p) => p.categoria_id === c.id);
        if (x.tipo !== c.tipo && usada) return error("No se puede cambiar de tipo: la categoría ya tiene movimientos.");
        Object.assign(x, { nombre, tipo: c.tipo, color: c.color || x.color });
        guardar(); return ok(x);
      }
      if (data.categorias.length >= 100) return error("Llegaste al máximo de 100 categorías.");
      const n = { id: nextId(data.categorias), nombre, tipo: c.tipo, color: c.color || "#868E96" };
      data.categorias.push(n); guardar(); return ok(n);
    }, { escribir: true }),
    borrarCategoria: conSesion((id) => {
      const n = data.movimientos.filter((m) => m.categoria_id === id).length;
      if (n) return error(`No se puede borrar: tiene ${U.plural(n, "movimiento", "movimientos")}.`);
      if (data.prestamos.some((p) => p.categoria_id === id)) return error("No se puede borrar: la usa un préstamo.");
      data.categorias = data.categorias.filter((c) => c.id !== id);
      guardar(); return ok(true);
    }, { escribir: true }),

    /* ----- Movimientos ----- */
    movimientos: conSesion((f = {}) => {
      let r = data.movimientos.filter((m) =>
        (!f.desde || m.fecha >= f.desde) && (!f.hasta || m.fecha <= f.hasta) && (!f.tipo || m.tipo === f.tipo));
      r.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
      if (f.limite) r = r.slice(0, f.limite);
      return ok(r.map((m) => ({ ...m, categoria: cat(m.categoria_id) || null })));
    }),
    movimiento: conSesion((id) => {
      const m = data.movimientos.find((x) => x.id === id);
      return m ? ok({ ...m, categoria: cat(m.categoria_id) || null }) : error("El movimiento ya no existe.");
    }),
    guardarMovimiento: conSesion((m) => {
      const mov = { ...m, monto: Math.round(Number(m.monto) || 0), descripcion: String(m.descripcion || "").trim() };
      const e = validarMov(mov);
      if (e) return error(e);
      if (mov.id) {
        const x = data.movimientos.find((y) => y.id === mov.id);
        if (!x) return error("El movimiento ya no existe.");
        if (x.cuota_id && mov.tipo !== "gasto") return error("Es el pago de una cuota: tiene que seguir siendo un gasto.");
        Object.assign(x, { tipo: mov.tipo, monto: mov.monto, categoria_id: mov.categoria_id, descripcion: mov.descripcion, fecha: mov.fecha });
        if (x.cuota_id) { const c = data.cuotas.find((y) => y.id === x.cuota_id); if (c) c.pagada_el = mov.fecha; }
        guardar(); return ok(x);
      }
      const n = { id: nextId(data.movimientos), tipo: mov.tipo, monto: mov.monto, categoria_id: mov.categoria_id, descripcion: mov.descripcion, fecha: mov.fecha, cuota_id: null };
      data.movimientos.push(n); guardar(); return ok(n);
    }, { escribir: true }),
    borrarMovimiento: conSesion((id) => {
      const m = data.movimientos.find((x) => x.id === id);
      if (!m) return error("El movimiento ya no existe.");
      if (m.cuota_id) { const c = data.cuotas.find((x) => x.id === m.cuota_id); if (c) { c.pagada_el = null; c.movimiento_id = null; } }
      data.movimientos = data.movimientos.filter((x) => x.id !== id);
      guardar(); return ok(true);
    }, { escribir: true }),
    resumenMeses: conSesion((hasta, n) => {
      const r = [];
      for (let i = n - 1; i >= 0; i--) {
        const mes = U.mesMas(hasta, -i);
        const ms = data.movimientos.filter((m) => U.mesDe(m.fecha) === mes);
        r.push({ mes, ingresos: ms.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0), gastos: ms.filter((m) => m.tipo === "gasto").reduce((s, m) => s + m.monto, 0) });
      }
      return ok(r);
    }),
    frecuentes: conSesion((tipo, n = 3) => {
      const desde = U.addMonths(U.hoy(), -6);
      const cuenta = new Map();
      data.movimientos.filter((m) => m.tipo === tipo && !m.cuota_id && m.descripcion && m.fecha >= desde).forEach((m) => {
        const k = `${U.norm(m.descripcion)}|${m.monto}|${m.categoria_id}`;
        const x = cuenta.get(k) || { descripcion: m.descripcion, monto: m.monto, categoria_id: m.categoria_id, veces: 0, ultima: "" };
        x.veces++; if (m.fecha > x.ultima) x.ultima = m.fecha;
        cuenta.set(k, x);
      });
      return ok([...cuenta.values()].filter((x) => x.veces > 1 && cat(x.categoria_id))
        .sort((a, b) => b.veces - a.veces || b.ultima.localeCompare(a.ultima)).slice(0, n));
    }),

    /* ----- Ahorros ----- */
    ahorros: conSesion(() => ok([...data.ahorros].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id))),
    guardarAhorro: conSesion((a) => {
      const x = { ...a, monto: Math.round(Number(a.monto) || 0), descripcion: String(a.descripcion || "").trim(), entidad: String(a.entidad || "").trim() };
      if (!["deposito", "retiro"].includes(x.tipo)) return error("Elegí depósito o retiro.");
      if (!(x.monto > 0)) return error("Ingresá un monto mayor a cero.");
      if (!x.entidad) return error("Ingresá dónde está el ahorro (banco, cooperativa, alcancía…).");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.fecha || "")) return error("Ingresá una fecha válida.");
      x.descripcion = x.descripcion || (x.tipo === "deposito" ? "Ahorro" : "Retiro");
      if (x.tipo === "retiro") {
        const saldo = data.ahorros.filter((y) => y.id !== x.id && U.norm(y.entidad) === U.norm(x.entidad))
          .reduce((s, y) => s + (y.tipo === "deposito" ? y.monto : -y.monto), 0);
        if (x.monto > saldo) return error(`En ${x.entidad} hay ${U.gs(Math.max(0, saldo))}: no alcanza para ese retiro.`);
      }
      const campos = { fecha: x.fecha, descripcion: x.descripcion, entidad: x.entidad, tipo: x.tipo, monto: x.monto };
      if (x.id) {
        const y = data.ahorros.find((z) => z.id === x.id);
        if (!y) return error("El registro ya no existe.");
        Object.assign(y, campos); guardar(); return ok(y);
      }
      const n = { id: nextId(data.ahorros), ...campos };
      data.ahorros.push(n); guardar(); return ok(n);
    }, { escribir: true }),
    borrarAhorro: conSesion((id) => { data.ahorros = data.ahorros.filter((x) => x.id !== id); guardar(); return ok(true); }, { escribir: true }),

    /* ----- Préstamos ----- */
    prestamos: conSesion(() => ok(data.prestamos.map(estadoPrestamo))),
    prestamo: conSesion((id) => {
      const p = data.prestamos.find((x) => x.id === id);
      return p ? ok(estadoPrestamo(p)) : error("El préstamo ya no existe.");
    }),
    guardarPrestamo: conSesion((p) => {
      const entidad = String(p.entidad || "").trim();
      const n = Math.round(Number(p.cuotas) || 0), monto = Math.round(Number(p.monto_cuota) || 0);
      if (!entidad) return error("Ingresá la entidad (banco, financiera, persona…).");
      if (entidad.length > 60) return error("El nombre de la entidad es muy largo.");
      if (!(n >= 1 && n <= 360)) return error("La cantidad de cuotas tiene que estar entre 1 y 360.");
      if (!(monto > 0)) return error("Ingresá el monto de la cuota.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_inicio || "")) return error("Ingresá la fecha de la primera cuota.");
      const c = cat(p.categoria_id);
      if (!c || c.tipo !== "gasto") return error("Elegí la categoría de gasto con la que se van a registrar los pagos.");
      if (p.id) {
        const x = data.prestamos.find((y) => y.id === p.id);
        if (!x) return error("El préstamo ya no existe.");
        const pagadas = data.cuotas.filter((y) => y.prestamo_id === x.id && y.pagada_el).length;
        const cambia = n !== x.cuotas || monto !== x.monto_cuota || p.fecha_inicio !== x.fecha_inicio;
        if (pagadas && cambia) return error("Este préstamo ya tiene cuotas pagadas: solo se pueden cambiar la entidad y la categoría.");
        Object.assign(x, { entidad, cuotas: n, monto_cuota: monto, fecha_inicio: p.fecha_inicio, categoria_id: p.categoria_id });
        if (cambia) { data.cuotas = data.cuotas.filter((y) => y.prestamo_id !== x.id); generarCuotas(x); }
        guardar(); return ok(estadoPrestamo(x));
      }
      const nuevo = { id: nextId(data.prestamos), entidad, cuotas: n, monto_cuota: monto, fecha_inicio: p.fecha_inicio, categoria_id: p.categoria_id };
      data.prestamos.push(nuevo); generarCuotas(nuevo);
      guardar(); return ok(estadoPrestamo(nuevo));
    }, { escribir: true }),
    borrarPrestamo: conSesion((id) => {
      const ids = new Set(data.cuotas.filter((c) => c.prestamo_id === id).map((c) => c.id));
      data.movimientos.forEach((m) => { if (ids.has(m.cuota_id)) m.cuota_id = null; });
      data.cuotas = data.cuotas.filter((c) => c.prestamo_id !== id);
      data.prestamos = data.prestamos.filter((p) => p.id !== id);
      guardar(); return ok(true);
    }, { escribir: true }),
    cuotas: conSesion((prestamoId) => ok(data.cuotas.filter((c) => c.prestamo_id === prestamoId).sort((a, b) => a.numero - b.numero))),
    pagarCuota: conSesion((id, fecha) => {
      const c = data.cuotas.find((x) => x.id === id);
      if (!c) return error("La cuota ya no existe.");
      if (c.pagada_el) return error("Esa cuota ya está pagada.");
      const f = fecha || U.hoy();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return error("Ingresá la fecha de pago.");
      if (f > U.hoy()) return error("La fecha de pago no puede ser futura.");
      const p = data.prestamos.find((x) => x.id === c.prestamo_id);
      const m = { id: nextId(data.movimientos), tipo: "gasto", monto: c.monto, categoria_id: p.categoria_id, descripcion: `Cuota ${c.numero} · ${p.entidad}`, fecha: f, cuota_id: c.id };
      data.movimientos.push(m);
      c.pagada_el = f; c.movimiento_id = m.id;
      guardar(); return ok(c);
    }, { escribir: true }),
    desmarcarCuota: conSesion((id) => {
      const c = data.cuotas.find((x) => x.id === id);
      if (!c || !c.pagada_el) return error("Esa cuota no está pagada.");
      data.movimientos = data.movimientos.filter((m) => m.id !== c.movimiento_id);
      c.pagada_el = null; c.movimiento_id = null;
      guardar(); return ok(c);
    }, { escribir: true }),
    guardarCuota: conSesion((cu) => {
      const c = data.cuotas.find((x) => x.id === cu.id);
      if (!c) return error("La cuota ya no existe.");
      if (c.pagada_el) return error("La cuota ya está pagada: desmarcala primero para cambiarla.");
      const monto = Math.round(Number(cu.monto) || 0);
      if (!(monto > 0)) return error("Ingresá un monto mayor a cero.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cu.vence || "")) return error("Ingresá una fecha válida.");
      c.monto = monto; c.vence = cu.vence;
      guardar(); return ok(c);
    }, { escribir: true }),

    /* ----- Superadmin ----- */
    superSesion: () => ok(Boolean(db.superSesion)),
    superLogin(email, password) {
      if (password !== cfg.demoPasswordSuper) return error("Email o contraseña incorrectos.");
      db.superSesion = true; guardar(); return ok(true);
    },
    superLogout() { db.superSesion = false; guardar(); return ok(null); },
    superCuentas: soloSuper(() => ok([...db.cuentas].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((c) => cuentaPublica(c, true)))),
    superCrearCuenta: soloSuper((x) => {
      const nombre = String(x.nombre || "").trim();
      if (nombre.length < 2) return error("Ingresá el nombre del cliente.");
      if (nombre.length > 60) return error("El nombre es muy largo.");
      const email = validarEmail(x.email);
      if (!email) return error("Ingresá un email válido.");
      if (db.cuentas.some((c) => c.email === email)) return error("Ya hay una cuenta con ese email.");
      const wa = String(x.whatsapp || "").replace(/\D/g, "");
      if (wa && (wa.length < 8 || wa.length > 15)) return error("El WhatsApp no parece un número válido.");
      const clave = claveTemporal();
      const c = { id: nextId(db.cuentas), nombre, email, whatsapp: wa, notas: String(x.notas || "").trim(), clave, debe_cambiar: true,
        activo: true, vence_el: x.vence_el || null, precio: x.precio ?? cfg.precioMensual, creado_en: new Date().toISOString(), ultimo_acceso: null };
      db.cuentas.push(c); db.datos[c.id] = datosVacios(); guardar();
      return ok({ ...cuentaPublica(c, true), clave_temporal: clave });
    }),
    superGuardarCuenta: soloSuper((id, cambios) => {
      const c = db.cuentas.find((x) => x.id === id);
      if (!c) return error("Cuenta no encontrada.");
      const n = { ...c };
      if ("nombre" in cambios) { n.nombre = String(cambios.nombre || "").trim(); if (n.nombre.length < 2) return error("Ingresá el nombre del cliente."); }
      if ("email" in cambios) {
        n.email = validarEmail(cambios.email);
        if (!n.email) return error("Ingresá un email válido.");
        if (db.cuentas.some((x) => x.id !== id && x.email === n.email)) return error("Ya hay una cuenta con ese email.");
      }
      if ("whatsapp" in cambios) {
        n.whatsapp = String(cambios.whatsapp || "").replace(/\D/g, "");
        if (n.whatsapp && (n.whatsapp.length < 8 || n.whatsapp.length > 15)) return error("El WhatsApp no parece un número válido.");
      }
      if ("notas" in cambios) n.notas = String(cambios.notas || "").trim();
      if ("vence_el" in cambios) n.vence_el = cambios.vence_el || null;
      if ("activo" in cambios) n.activo = Boolean(cambios.activo);
      if ("precio" in cambios) { n.precio = Math.round(Number(cambios.precio)); if (!(n.precio >= 0)) return error("Ingresá un monto válido en guaraníes."); }
      if (n.email !== c.email && db.sesion === id) db.sesion = null;
      Object.assign(c, n); guardar();
      return ok(cuentaPublica(c, true));
    }),
    superResetClave: soloSuper((id) => {
      const c = db.cuentas.find((x) => x.id === id);
      if (!c) return error("Cuenta no encontrada.");
      c.clave = claveTemporal(); c.debe_cambiar = true;
      if (db.sesion === id) db.sesion = null;
      guardar(); return ok({ clave: c.clave });
    }),
    superBorrarCuenta: soloSuper((id, confirmar) => {
      const c = db.cuentas.find((x) => x.id === id);
      if (!c) return error("Cuenta no encontrada.");
      if (String(confirmar || "").trim().toLowerCase() !== c.email) return error("Para borrar, escribí el email de la cuenta exactamente.");
      db.cuentas = db.cuentas.filter((x) => x.id !== id);
      db.pagos = db.pagos.filter((p) => p.cuenta_id !== id);
      delete db.datos[id];
      if (db.sesion === id) db.sesion = null;
      guardar(); return ok(true);
    }),
    superRegistrarPago: soloSuper((id, { meses, monto, fecha }) => {
      const c = db.cuentas.find((x) => x.id === id);
      if (!c) return error("Cuenta no encontrada.");
      meses = Number(meses); monto = Math.round(Number(monto));
      if (!(meses >= 1 && meses <= 24)) return error("Elegí cuántos meses paga.");
      if (!(monto >= 0)) return error("Ingresá un monto válido en guaraníes.");
      const f = fecha || U.hoy();
      if (f > U.hoy()) return error("La fecha del pago no puede ser futura.");
      const desde = !c.vence_el || c.vence_el < U.hoy() ? U.hoy() : c.vence_el;
      const hasta = U.addMonths(desde, meses);
      const p = { id: nextId(db.pagos), cuenta_id: id, fecha: f, monto, meses, desde, hasta };
      db.pagos.push(p); c.vence_el = hasta; c.activo = true; guardar();
      return ok({ pago: p, cuenta: cuentaPublica(c, true) });
    }),
    superPagos: soloSuper(() => ok(db.pagos.map((p) => ({ ...p, cliente: (db.cuentas.find((c) => c.id === p.cuenta_id) || {}).nombre || "—" }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id))),
    superEliminarPago: soloSuper((id) => { db.pagos = db.pagos.filter((p) => p.id !== id); guardar(); return ok(null); }),

    /** Vuelve a los datos de ejemplo (todas las cuentas) */
    reset() { db = seed(); guardar(); return ok(true); },
  };

  return api;
})();
