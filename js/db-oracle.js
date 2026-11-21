/* ============================================================
   CAPA DE DATOS · MODO ONLINE (Oracle Autonomous Database + ORDS)
   Se usa cuando js/config.js tiene apiUrl. Expone exactamente las
   mismas funciones que el modo demo (js/db.js). Toda la validación
   y la separación entre cuentas la hace la base (paquete CG_API).
   ============================================================ */
window.DB_ORACLE = (() => {
  const cfg = window.APP_CONFIG;
  if (!cfg.apiUrl) return null;

  const TOK = "cg_token", TOK_SUPER = "cg_token_super";
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* sin storage */ } },
  };

  /** Llama a la API. tokenKey: qué sesión mandar (cuenta o superadmin) */
  async function rpc(fn, args = {}, tokenKey = TOK) {
    const body = { fn, args };
    if (tokenKey) body.token = ls.get(tokenKey);
    let res;
    try {
      // text/plain evita el "preflight" de CORS: una sola llamada por operación
      res = await fetch(cfg.apiUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error("No se pudo conectar con el servidor. Revisá tu conexión a internet.");
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error(`El servidor respondió con un error (${res.status}). Probá de nuevo.`); }
    if (!j.ok) {
      const e = new Error(j.error || "Ocurrió un error. Probá de nuevo.");
      if (j.sesion === false) { if (tokenKey) ls.del(tokenKey); e.sesion = false; }
      throw e;
    }
    return j.data;
  }

  return {
    modo: "online",

    /* ----- Sesión de la cuenta ----- */
    async sesion() {
      if (!ls.get(TOK)) return null;
      try { return await rpc("mi_cuenta"); } catch (e) { if (e.sesion === false) return null; throw e; }
    },
    async login(email, password) {
      const r = await rpc("login", { email, password }, null);
      ls.set(TOK, r.token);
      return r.cuenta;
    },
    async logout() { try { await rpc("logout"); } finally { ls.del(TOK); } return null; },
    cambiarClave: (actual, nueva) => rpc("cambiar_clave", { actual, nueva }),
    aceptarTerminos: () => rpc("aceptar_terminos"),

    /* ----- Categorías ----- */
    categorias: () => rpc("categorias"),
    guardarCategoria: (c) => rpc("guardar_categoria", c),
    borrarCategoria: (id) => rpc("borrar_categoria", { id }),

    /* ----- Movimientos ----- */
    movimientos: (f = {}) => rpc("movimientos", f),
    movimiento: (id) => rpc("movimiento", { id }),
    guardarMovimiento: (m) => rpc("guardar_movimiento", m),
    borrarMovimiento: (id) => rpc("borrar_movimiento", { id }),
    resumenMeses: (hasta, n) => rpc("resumen_meses", { hasta, n }),
    frecuentes: (tipo, n = 3) => rpc("frecuentes", { tipo, n }),

    /* ----- Ahorros ----- */
    ahorros: () => rpc("ahorros"),
    guardarAhorro: (a) => rpc("guardar_ahorro", a),
    borrarAhorro: (id) => rpc("borrar_ahorro", { id }),

    /* ----- Préstamos ----- */
    prestamos: () => rpc("prestamos"),
    prestamo: (id) => rpc("prestamo", { id }),
    guardarPrestamo: (p) => rpc("guardar_prestamo", p),
    borrarPrestamo: (id) => rpc("borrar_prestamo", { id }),
    cuotas: (prestamo_id) => rpc("cuotas", { prestamo_id }),
    pagarCuota: (id, fecha) => rpc("pagar_cuota", { id, fecha }),
    desmarcarCuota: (id) => rpc("desmarcar_cuota", { id }),
    guardarCuota: (c) => rpc("guardar_cuota", c),

    /* ----- Superadmin ----- */
    async superSesion() {
      if (!ls.get(TOK_SUPER)) return false;
      try { await rpc("super_ping", {}, TOK_SUPER); return true; } catch (e) { if (e.sesion === false) return false; throw e; }
    },
    async superLogin(email, password) {
      const r = await rpc("super_login", { email, password }, null);
      ls.set(TOK_SUPER, r.token);
      return true;
    },
    async superLogout() { try { await rpc("super_logout", {}, TOK_SUPER); } finally { ls.del(TOK_SUPER); } return null; },
    superCuentas: () => rpc("super_cuentas", {}, TOK_SUPER),
    superCrearCuenta: (x) => rpc("super_crear_cuenta", x, TOK_SUPER),
    superGuardarCuenta: (id, cambios) => rpc("super_guardar_cuenta", { id, cambios }, TOK_SUPER),
    superResetClave: (id) => rpc("super_reset_clave", { id }, TOK_SUPER),
    superBorrarCuenta: (id, confirmar) => rpc("super_borrar_cuenta", { id, confirmar }, TOK_SUPER),
    superRegistrarPago: (id, { meses, monto, fecha }) => rpc("super_registrar_pago", { id, meses, monto, fecha }, TOK_SUPER),
    superPagos: () => rpc("super_pagos", {}, TOK_SUPER),
    superEliminarPago: (id) => rpc("super_eliminar_pago", { id }, TOK_SUPER),

    reset: async () => { throw new Error("Solo disponible en el modo demo."); },
  };
})();
