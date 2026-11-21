/* ============================================================
   UTILIDADES: números, fechas y HTML
   Las fechas se manejan como texto "AAAA-MM-DD" (hora local).
   ============================================================ */
const U = (() => {
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MESES_C = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const DIAS_C = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const pad = (n) => String(n).padStart(2, "0");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** 1234567 → "1.234.567" */
  const num = (n) => {
    const v = Math.round(Number(n) || 0);
    const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (v < 0 ? "-" : "") + s;
  };
  const gs = (n) => "Gs. " + num(n);
  /** Con signo: +8.000.000 / -25.000 */
  const firmado = (n, tipo) => (tipo === "ingreso" ? "+" : "-") + num(Math.abs(n));
  /** "1.234.567" → 1234567 */
  const leerNum = (s) => Number(String(s || "").replace(/\D/g, "")) || 0;

  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const hoy = () => iso(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  /** Suma meses manteniendo el día (31 ene + 1 mes → 28/29 feb) */
  const addMonths = (s, n) => {
    const d = parse(s), dia = d.getDate();
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const ult = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(dia, ult));
    return iso(r);
  };
  const diasEntre = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);

  /* Períodos: "AAAA-MM" */
  const mesDe = (s) => String(s).slice(0, 7);
  const mesActual = () => mesDe(hoy());
  const mesMas = (m, n) => mesDe(addMonths(m + "-01", n));
  const rangoMes = (m) => {
    const d = parse(m + "-01");
    return { desde: m + "-01", hasta: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  };
  const nombreMes = (m) => { const d = parse(m + "-01"); return `${cap(MESES[d.getMonth()])} ${d.getFullYear()}`; };
  const mesCorto = (m) => cap(MESES_C[parse(m + "-01").getMonth()]);

  /* Formatos de fecha */
  const fecha = (s) => { if (!s) return ""; const d = parse(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const fechaCorta = (s) => {
    if (s === hoy()) return "Hoy";
    if (s === addDays(hoy(), -1)) return "Ayer";
    const d = parse(s); return `${d.getDate()} ${MESES_C[d.getMonth()]}`;
  };
  /** "SÁB 31 OCT" */
  const diaTitulo = (s) => { const d = parse(s); return `${DIAS_C[d.getDay()]} ${d.getDate()} ${MESES_C[d.getMonth()]}`.toUpperCase(); };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;

  /** Color de fondo suave a partir del color de la categoría */
  const suave = (hex, a = 0.18) => {
    const h = String(hex || "#868e96").replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${a})`;
  };

  /** Estado del abono de una cuenta (lo mismo que controla la base):
   *  activa · por_vencer (7 días antes) · gracia (vencida, todavía puede cargar) · vencida · suspendida
   *  soloLectura = no puede cargar ni modificar */
  const estadoCuenta = (c, gracia = 5) => {
    if (!c) return { estado: "activa", soloLectura: false, dias: null };
    if (!c.activo) return { estado: "suspendida", soloLectura: true, dias: null };
    if (!c.vence_el) return { estado: "activa", soloLectura: false, dias: null };
    const dias = diasEntre(hoy(), c.vence_el);
    if (dias < 0) return -dias <= gracia
      ? { estado: "gracia", soloLectura: false, dias, hasta: addDays(c.vence_el, gracia) }
      : { estado: "vencida", soloLectura: true, dias };
    return { estado: dias <= 7 ? "por_vencer" : "activa", soloLectura: false, dias };
  };
  const ESTADOS = { activa: "Activa", por_vencer: "Por vencer", gracia: "En gracia", vencida: "Vencida", suspendida: "Suspendida" };

  return { estadoCuenta, ESTADOS, num, gs, firmado, leerNum, iso, parse, hoy, addDays, addMonths, diasEntre, mesDe, mesActual, mesMas, rangoMes,
    nombreMes, mesCorto, fecha, fechaCorta, diaTitulo, esc, norm, plural, suave, cap };
})();
