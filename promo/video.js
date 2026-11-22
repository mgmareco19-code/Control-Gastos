/* ============================================================
   Video promocional (1080×1920, 30 cuadros por segundo)
   Todo se dibuja en un <canvas>; "Descargar MP4" lo codifica cuadro
   por cuadro con WebCodecs (H.264) y lo empaqueta con mp4-muxer.
   ============================================================ */
window.Promo = (() => {
  const cfg = window.APP_CONFIG;
  const W = 1080, H = 1920, FPS = 30, FADE = 0.4;
  const C = {
    green: "#0b7a5a", dark: "#0f2a24", dark2: "#1c3f37", mint: "#7ddfb3", soft: "#ddf3ea",
    red: "#b42318", redSoft: "#fde4e1", salmon: "#ff9e8f", bg: "#f3f4f6", card: "#ffffff",
    ink: "#111827", ink2: "#374151", muted: "#6b7280", track: "#e5e9ef", pale: "#cfe3dc", fondo: "#eef6f2",
  };
  const FUENTE = '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif';
  const F = (peso, tam) => `${peso} ${tam}px ${FUENTE}`;
  const gs = (n) => U.gs(n);
  const wa = String(cfg.soporteWhatsapp || "");
  const waLindo = wa ? `+${wa.slice(0, 3)} ${wa.slice(3, 6)} ${wa.slice(6)}` : "";

  /* ---------- tiempo y movimiento ---------- */
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const rebote = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const redondear = (n) => Math.round(n / 1000) * 1000;

  /* ---------- dibujo básico ---------- */
  function rr(ctx, x, y, w, h, r, color) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = color; ctx.fill(); }
  function texto(ctx, s, x, y, { tam = 40, peso = 700, color = C.ink, alinear = "left", espaciado = 0 } = {}) {
    ctx.font = F(peso, tam); ctx.fillStyle = color; ctx.textAlign = alinear; ctx.textBaseline = "alphabetic";
    ctx.letterSpacing = `${espaciado}px`;
    ctx.fillText(s, x, y);
    ctx.letterSpacing = "0px";
  }
  /** Línea con partes de distinto color, centrada en x */
  function partes(ctx, ps, x, y, tam, peso, espaciado = 0) {
    ctx.font = F(peso, tam); ctx.letterSpacing = `${espaciado}px`;
    const ancho = ps.reduce((s, [t]) => s + ctx.measureText(t).width, 0);
    let cx = x - ancho / 2;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    for (const [t, color] of ps) { ctx.fillStyle = color; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; }
    ctx.letterSpacing = "0px";
  }
  function flecha(ctx, cx, cy, tam, arriba, color) {
    ctx.save(); ctx.translate(cx, cy); if (!arriba) ctx.rotate(Math.PI);
    ctx.strokeStyle = color; ctx.lineWidth = tam * 0.13; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(0, tam * 0.38); ctx.lineTo(0, -tam * 0.38);
    ctx.moveTo(-tam * 0.3, -tam * 0.08); ctx.lineTo(0, -tam * 0.38); ctx.lineTo(tam * 0.3, -tam * 0.08); ctx.stroke();
    ctx.restore();
  }
  function tilde(ctx, cx, cy, tam, color, avance = 1) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = tam * 0.14; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const pts = [[-0.35, 0], [-0.1, 0.27], [0.38, -0.25]];
    ctx.beginPath(); ctx.moveTo(cx + pts[0][0] * tam, cy + pts[0][1] * tam);
    const a = clamp(avance * 2), b = clamp(avance * 2 - 1);
    ctx.lineTo(cx + (pts[0][0] + (pts[1][0] - pts[0][0]) * a) * tam, cy + (pts[0][1] + (pts[1][1] - pts[0][1]) * a) * tam);
    if (b > 0) ctx.lineTo(cx + (pts[1][0] + (pts[2][0] - pts[1][0]) * b) * tam, cy + (pts[1][1] + (pts[2][1] - pts[1][1]) * b) * tam);
    ctx.stroke(); ctx.restore();
  }
  function billete(ctx, cx, cy, tam, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = tam * 0.1; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.roundRect(cx - tam * 0.45, cy - tam * 0.28, tam * 0.9, tam * 0.56, tam * 0.08); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, tam * 0.12, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  function alerta(ctx, cx, cy, tam, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = tam * 0.1; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, cy - tam * 0.38); ctx.lineTo(cx + tam * 0.42, cy + tam * 0.34); ctx.lineTo(cx - tam * 0.42, cy + tam * 0.34); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - tam * 0.1); ctx.lineTo(cx, cy + tam * 0.1); ctx.moveTo(cx, cy + tam * 0.22); ctx.lineTo(cx, cy + tam * 0.23); ctx.stroke();
    ctx.restore();
  }
  /* Logo: img/logo-512.png (como ImageBitmap, así no "ensucia" el canvas) */
  let LOGO = null;
  async function cargarLogo() {
    if (LOGO !== null) return;
    try { LOGO = await createImageBitmap(await (await fetch("../img/logo-512.png")).blob()); }
    catch (e) { LOGO = false; }
  }
  const ESCUDO = new Path2D("M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5z");
  function logo(ctx, x, y, tam, color, colorSigno) {
    if (LOGO) {
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.22)"; ctx.shadowBlur = tam * 0.12; ctx.shadowOffsetY = tam * 0.04;
      ctx.drawImage(LOGO, x, y, tam, tam); ctx.restore();
      return;
    }
    // si no se pudo cargar la imagen: escudo simple
    ctx.save(); ctx.translate(x, y); ctx.scale(tam / 24, tam / 24); ctx.fillStyle = color; ctx.fill(ESCUDO); ctx.restore();
    texto(ctx, "$", x + tam / 2, y + tam * 0.69, { tam: tam * 0.5, peso: 800, color: colorSigno, alinear: "center" });
  }
  function marca(ctx, alfa = 1) {
    ctx.save(); ctx.globalAlpha *= alfa;
    ctx.font = F(800, 40);
    const ancho = 56 + 16 + ctx.measureText(cfg.nombreApp).width;
    const x = W / 2 - ancho / 2;
    logo(ctx, x, 92, 56, C.green, "#fff");
    texto(ctx, cfg.nombreApp, x + 72, 136, { tam: 40, peso: 800, color: C.green });
    ctx.restore();
  }

  /* Ícono cuadrado con flecha (como en la app) */
  function icoMov(ctx, x, y, tam, ingreso, colorCat) {
    rr(ctx, x, y, tam, tam, tam * 0.28, colorCat + "2e");
    flecha(ctx, x + tam / 2, y + tam / 2, tam * 0.5, ingreso, colorCat);
  }
  function fila(ctx, x, y, w, { titulo, sub, monto, ingreso, color }) {
    icoMov(ctx, x, y, 84, ingreso, color);
    texto(ctx, titulo, x + 108, y + 38, { tam: 32, peso: 700 });
    texto(ctx, sub, x + 108, y + 74, { tam: 24, peso: 500, color: C.muted });
    texto(ctx, monto, x + w, y + 54, { tam: 32, peso: 800, color: ingreso ? C.green : C.ink, alinear: "right" });
  }

  /* ---------- teléfono ---------- */
  const TEL = { x: 160, y: 480, w: 760, h: 1220, borde: 22, r: 86 };
  function telefono(ctx, t, pintar) {
    const e = eo(prog(t, 0, 0.6));
    const dy = (1 - e) * 140;
    ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, dy);
    ctx.shadowColor = "rgba(15,42,36,.28)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
    rr(ctx, TEL.x, TEL.y, TEL.w, TEL.h, TEL.r, "#111827");
    ctx.shadowColor = "transparent";
    const sx = TEL.x + TEL.borde, sy = TEL.y + TEL.borde, sw = TEL.w - TEL.borde * 2, sh = TEL.h - TEL.borde * 2;
    ctx.save(); ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, TEL.r - TEL.borde); ctx.clip();
    ctx.fillStyle = C.bg; ctx.fillRect(sx, sy, sw, sh);
    pintar(ctx, sx, sy, sw, sh);
    ctx.restore();
    rr(ctx, TEL.x + TEL.w / 2 - 70, TEL.y + 34, 140, 34, 17, "#111827"); // cámara
    ctx.restore();
  }
  function titulo(ctx, t, lineas, y0 = 250) {
    lineas.forEach((ps, i) => {
      const e = eo(prog(t, 0.05 + i * 0.12, 0.6 + i * 0.12));
      ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, (1 - e) * 40);
      partes(ctx, ps, W / 2, y0 + i * 88, 74, 800, -1.5);
      ctx.restore();
    });
  }
  function fondoClaro(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.fondo); g.addColorStop(1, "#ffffff");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function fondoOscuro(ctx, t) {
    ctx.fillStyle = C.dark; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.75, H * (0.2 + 0.03 * Math.sin(t)), 50, W * 0.75, H * 0.2, 900);
    g.addColorStop(0, "rgba(125,223,179,.20)"); g.addColorStop(1, "rgba(125,223,179,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.1, H * 0.9, 50, W * 0.1, H * 0.9, 800);
    g2.addColorStop(0, "rgba(11,122,90,.35)"); g2.addColorStop(1, "rgba(11,122,90,0)");
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
  }

  /* ============================================================
     Escenas: [duración, función(ctx, t local)]
     ============================================================ */
  const ESCENAS = [
    // 1. Gancho
    [3.4, (ctx, t) => {
      fondoOscuro(ctx, t);
      const L = [
        [["¿Llegás a fin de mes", "#fff"]],
        [["sin saber en qué", "#fff"]],
        [["se fue tu ", "#fff"], ["plata", C.mint], ["?", "#fff"]],
      ];
      L.forEach((ps, i) => {
        const e = eo(prog(t, 0.15 + i * 0.28, 0.75 + i * 0.28));
        ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, (1 - e) * 60);
        partes(ctx, ps, W / 2, 780 + i * 118, 92, 800, -2);
        ctx.restore();
      });
      const e = eo(prog(t, 1.9, 2.5));
      ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, (1 - e) * 30);
      rr(ctx, W / 2 - 330, 1200, 660, 96, 48, "rgba(125,223,179,.16)");
      texto(ctx, "Hay una forma más fácil", W / 2, 1262, { tam: 42, peso: 700, color: C.mint, alinear: "center" });
      ctx.restore();
    }],

    // 2. El mes de un vistazo
    [4.6, (ctx, t) => {
      fondoClaro(ctx); marca(ctx, eo(prog(t, 0, 0.4)));
      titulo(ctx, t, [[["Mirá tu mes ", C.ink], ["de un vistazo", C.green]]], 300);
      texto(ctx, "Ingresos, gastos y saldo, siempre al día", W / 2, 392, { tam: 36, peso: 500, color: C.muted, alinear: "center" });
      telefono(ctx, t - 0.2, (ctx, x, y, w) => {
        const tt = t - 0.2;
        texto(ctx, "Hola, Laura", x + 44, y + 150, { tam: 50, peso: 800, espaciado: -1 });
        texto(ctx, "Tus movimientos de este mes", x + 44, y + 194, { tam: 26, peso: 500, color: C.muted });
        // saldo
        rr(ctx, x + 30, y + 236, w - 60, 330, 44, C.dark);
        texto(ctx, "Saldo del mes", x + 74, y + 304, { tam: 28, peso: 500, color: C.pale });
        const k = eo(prog(tt, 0.5, 2.0));
        texto(ctx, gs(redondear(3450000 * k)), x + 74, y + 390, { tam: 74, peso: 800, color: "#fff", espaciado: -1.5 });
        rr(ctx, x + 60, y + 424, (w - 150) / 2, 110, 26, C.dark2);
        rr(ctx, x + 90 + (w - 150) / 2, y + 424, (w - 150) / 2, 110, 26, C.dark2);
        texto(ctx, "Ingresos", x + 88, y + 466, { tam: 24, peso: 500, color: C.pale });
        texto(ctx, gs(redondear(8000000 * k)), x + 88, y + 508, { tam: 30, peso: 800, color: C.mint });
        texto(ctx, "Gastos", x + 118 + (w - 150) / 2, y + 466, { tam: 24, peso: 500, color: C.pale });
        texto(ctx, gs(redondear(4550000 * k)), x + 118 + (w - 150) / 2, y + 508, { tam: 30, peso: 800, color: "#fff" });
        // categorías
        rr(ctx, x + 30, y + 600, w - 60, 470, 40, C.card);
        texto(ctx, "Gastos por categoría", x + 74, y + 670, { tam: 32, peso: 800 });
        const cats = [["Hogar", 1520000, "#7048e8", 1], ["Comida", 1450000, "#e8590c", 0.95], ["Transporte", 980000, "#1c7ed6", 0.64], ["Salud", 600000, "#c2255c", 0.4]];
        cats.forEach(([n, v, col, f], i) => {
          const yy = y + 740 + i * 84;
          const a = eo(prog(tt, 0.9 + i * 0.18, 1.8 + i * 0.18));
          texto(ctx, n, x + 74, yy, { tam: 28, peso: 500, color: C.ink2 });
          texto(ctx, gs(v), x + w - 74, yy, { tam: 28, peso: 800, alinear: "right" });
          rr(ctx, x + 74, yy + 20, w - 148, 16, 8, C.track);
          if (a > 0) rr(ctx, x + 74, yy + 20, Math.max(16, (w - 148) * f * a), 16, 8, col);
        });
      });
    }],

    // 3. Anotar un gasto
    [4.4, (ctx, t) => {
      fondoClaro(ctx); marca(ctx);
      titulo(ctx, t, [[["Anotá un gasto ", C.ink], ["en segundos", C.green]]], 300);
      texto(ctx, "Monto, categoría y listo", W / 2, 392, { tam: 36, peso: 500, color: C.muted, alinear: "center" });
      telefono(ctx, t - 0.15, (ctx, x, y, w, h) => {
        const tt = t - 0.15;
        texto(ctx, "Movimientos", x + 44, y + 150, { tam: 50, peso: 800, espaciado: -1 });
        texto(ctx, "Noviembre", x + 44, y + 194, { tam: 26, peso: 500, color: C.muted });
        const nueva = { titulo: "Almuerzo", sub: "Comida · hoy", monto: "-25.000", ingreso: false, color: "#e8590c" };
        const filas = [
          { titulo: "Sueldo", sub: "Salario · 1 nov", monto: "+8.000.000", ingreso: true, color: "#0b7a5a" },
          { titulo: "Farmacia", sub: "Salud · 18 nov", monto: "-85.000", ingreso: false, color: "#c2255c" },
          { titulo: "Nafta", sub: "Transporte · 17 nov", monto: "-150.000", ingreso: false, color: "#1c7ed6" },
          { titulo: "Supermercado", sub: "Comida · 15 nov", monto: "-320.000", ingreso: false, color: "#e8590c" },
          { titulo: "Alquiler", sub: "Hogar · 2 nov", monto: "-1.200.000", ingreso: false, color: "#7048e8" },
        ];
        const entra = eio(prog(tt, 1.45, 1.95));
        const alto = 128;
        rr(ctx, x + 30, y + 236, w - 60, alto * (filas.length + entra) + 30, 40, C.card);
        ctx.save(); ctx.beginPath(); ctx.rect(x + 30, y + 236, w - 60, alto * (filas.length + entra) + 30); ctx.clip();
        if (entra > 0) {
          const brillo = 1 - prog(tt, 2.4, 3.6);
          if (brillo > 0) { ctx.save(); ctx.globalAlpha *= brillo; rr(ctx, x + 44, y + 252, w - 88, alto - 4, 26, C.soft); ctx.restore(); }
          ctx.save(); ctx.globalAlpha *= entra; ctx.translate(0, (entra - 1) * 60);
          fila(ctx, x + 64, y + 270, w - 128, nueva); ctx.restore();
        }
        filas.forEach((f, i) => fila(ctx, x + 64, y + 270 + (i + entra) * alto, w - 128, f));
        ctx.restore();
        // botón +
        const toque = prog(tt, 0.7, 1.2);
        const esc = 1 - 0.12 * Math.sin(Math.PI * toque);
        const bx = x + w - 120, by = y + h - 130;
        ctx.save(); ctx.translate(bx, by); ctx.scale(esc, esc);
        ctx.shadowColor = "rgba(11,122,90,.4)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
        ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fillStyle = C.green; ctx.fill(); ctx.shadowColor = "transparent";
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 9; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.moveTo(0, -22); ctx.lineTo(0, 22); ctx.stroke();
        ctx.restore();
        if (toque > 0 && toque < 1) { // onda del toque
          ctx.save(); ctx.globalAlpha *= 0.35 * (1 - toque); ctx.beginPath(); ctx.arc(bx, by, 62 + 70 * toque, 0, Math.PI * 2); ctx.fillStyle = C.green; ctx.fill(); ctx.restore();
        }
        // aviso
        const av = eo(prog(tt, 2.0, 2.4)) * (1 - prog(tt, 3.6, 3.9));
        if (av > 0) {
          ctx.save(); ctx.globalAlpha *= av; ctx.translate(0, (1 - av) * 30);
          rr(ctx, x + 60, y + h - 330, w - 120, 96, 26, C.ink);
          ctx.beginPath(); ctx.arc(x + 116, y + h - 282, 22, 0, Math.PI * 2); ctx.fillStyle = C.mint; ctx.fill();
          tilde(ctx, x + 116, y + h - 282, 30, C.dark);
          texto(ctx, "Gasto registrado", x + 156, y + h - 271, { tam: 30, peso: 700, color: "#fff" });
          ctx.restore();
        }
      });
    }],

    // 4. Préstamos
    [5.0, (ctx, t) => {
      fondoClaro(ctx); marca(ctx);
      titulo(ctx, t, [[["Préstamos y cuotas ", C.ink]], [["bajo control", C.green]]], 270);
      telefono(ctx, t - 0.15, (ctx, x, y, w) => {
        const tt = t - 0.15;
        const pago = prog(tt, 2.5, 2.8);
        const pagado = tt >= 2.65;
        texto(ctx, "Préstamos", x + 44, y + 150, { tam: 50, peso: 800, espaciado: -1 });
        rr(ctx, x + 30, y + 200, w - 60, 200, 44, C.dark);
        texto(ctx, "Deuda pendiente", x + 74, y + 264, { tam: 28, peso: 500, color: C.pale });
        const deuda = 54026811 - (pagado ? 2000993 * eo(prog(tt, 2.65, 3.3)) : 0);
        texto(ctx, gs(Math.round(deuda)), x + 74, y + 350, { tam: 66, peso: 800, color: C.salmon, espaciado: -1.5 });
        // tarjeta del préstamo
        rr(ctx, x + 30, y + 436, w - 60, 250, 40, C.card);
        rr(ctx, x + 64, y + 470, 84, 84, 24, C.redSoft);
        billete(ctx, x + 106, y + 512, 50, C.red);
        texto(ctx, "Banco Familiar", x + 172, y + 506, { tam: 34, peso: 800 });
        if (!pagado) {
          const pulso = 0.65 + 0.35 * Math.sin(tt * 6);
          ctx.save(); ctx.globalAlpha *= pulso; texto(ctx, "1 cuota vencida", x + 172, y + 546, { tam: 26, peso: 600, color: C.red }); ctx.restore();
        } else texto(ctx, "Al día · próxima 25 dic", x + 172, y + 546, { tam: 26, peso: 600, color: C.green });
        const avance = (9 + (pagado ? eo(prog(tt, 2.65, 3.3)) : 0)) / 36 * eo(prog(tt, 0.5, 1.4));
        rr(ctx, x + 64, y + 610, w - 128, 18, 9, C.track);
        rr(ctx, x + 64, y + 610, Math.max(18, (w - 128) * avance), 18, 9, C.green);
        texto(ctx, `${pagado ? 10 : 9} de 36 cuotas pagadas`, x + 64, y + 664, { tam: 24, peso: 500, color: C.muted });
        // cuota 10
        rr(ctx, x + 30, y + 720, w - 60, 330, 40, C.card);
        rr(ctx, x + 64, y + 756, 84, 84, 24, pagado ? C.soft : C.redSoft);
        if (pagado) tilde(ctx, x + 106, y + 798, 46, C.green, prog(tt, 2.65, 3.0)); else alerta(ctx, x + 106, y + 798, 46, C.red);
        texto(ctx, "Cuota 10", x + 172, y + 792, { tam: 34, peso: 800 });
        texto(ctx, pagado ? "Pagada hoy" : "Vencía el 25 oct", x + 172, y + 830, { tam: 26, peso: 600, color: pagado ? C.green : C.red });
        texto(ctx, "2.000.993", x + w - 64, y + 812, { tam: 32, peso: 800, color: pagado ? C.ink : C.red, alinear: "right" });
        // botón
        const esc = 1 - 0.06 * Math.sin(Math.PI * pago);
        const bw = w - 128, bh = 100, bx = x + 64, by = y + 900;
        ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.scale(esc, esc);
        rr(ctx, -bw / 2, -bh / 2, bw, bh, 28, pagado ? C.soft : C.green);
        if (pagado) { tilde(ctx, -150, 0, 40, C.green); texto(ctx, "Cuota pagada", 20, 12, { tam: 34, peso: 800, color: C.green, alinear: "center" }); }
        else texto(ctx, "Marcar como pagada", 0, 12, { tam: 34, peso: 800, color: "#fff", alinear: "center" });
        ctx.restore();
        if (pago > 0 && pago < 1) { ctx.save(); ctx.globalAlpha *= 0.3 * (1 - pago); ctx.beginPath(); ctx.arc(bx + bw / 2, by + bh / 2, 40 + 160 * pago, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore(); }
        texto(ctx, "Se registra el gasto solo", x + w / 2, y + 1120, { tam: 28, peso: 600, color: C.muted, alinear: "center" });
      });
    }],

    // 5. Ahorros
    [3.6, (ctx, t) => {
      fondoClaro(ctx); marca(ctx);
      titulo(ctx, t, [[["Tus ahorros, ", C.ink], ["a la vista", C.green]]], 300);
      texto(ctx, "Cuánto juntaste y dónde está", W / 2, 392, { tam: 36, peso: 500, color: C.muted, alinear: "center" });
      telefono(ctx, t - 0.15, (ctx, x, y, w) => {
        const tt = t - 0.15;
        const k = eo(prog(tt, 0.4, 1.8));
        texto(ctx, "Ahorros", x + 44, y + 150, { tam: 50, peso: 800, espaciado: -1 });
        rr(ctx, x + 30, y + 200, w - 60, 220, 44, C.dark);
        texto(ctx, "Total ahorrado", x + 74, y + 266, { tam: 28, peso: 500, color: C.pale });
        texto(ctx, gs(redondear(1850000 * k)), x + 74, y + 360, { tam: 76, peso: 800, color: C.mint, espaciado: -1.5 });
        rr(ctx, x + 30, y + 456, w - 60, 330, 40, C.card);
        texto(ctx, "Dónde está", x + 74, y + 526, { tam: 32, peso: 800 });
        [["Cooperativa", 1200000, 1], ["Banco", 450000, 0.38], ["Alcancía", 200000, 0.17]].forEach(([n, v, f], i) => {
          const yy = y + 600 + i * 66;
          const a = eo(prog(tt, 0.7 + i * 0.2, 1.6 + i * 0.2));
          texto(ctx, n, x + 74, yy, { tam: 28, peso: 500, color: C.ink2 });
          texto(ctx, gs(v), x + w - 74, yy, { tam: 28, peso: 800, alinear: "right" });
          rr(ctx, x + 74, yy + 16, w - 148, 14, 7, C.track);
          if (a > 0) rr(ctx, x + 74, yy + 16, Math.max(14, (w - 148) * f * a), 14, 7, C.green);
        });
        rr(ctx, x + 30, y + 820, w - 60, 290, 40, C.card);
        fila(ctx, x + 64, y + 856, w - 128, { titulo: "Emergencias", sub: "Cooperativa · 10 nov", monto: "+200.000", ingreso: true, color: "#0b7a5a" });
        fila(ctx, x + 64, y + 984, w - 128, { titulo: "Arreglo del auto", sub: "Banco · 20 oct", monto: "-250.000", ingreso: false, color: "#6b7280" });
      });
    }],

    // 6. Llamado a la acción
    [4.4, (ctx, t) => {
      fondoOscuro(ctx, t);
      const e1 = rebote(prog(t, 0.1, 0.7));
      ctx.save(); ctx.translate(W / 2, 540); ctx.scale(e1, e1); logo(ctx, -140, -140, 280, C.mint, C.dark); ctx.restore();
      const ap = (a, b) => eo(prog(t, a, b));
      const capa = (a, b, f) => { const e = ap(a, b); ctx.save(); ctx.globalAlpha *= e; ctx.translate(0, (1 - e) * 40); f(); ctx.restore(); };
      capa(0.3, 0.8, () => texto(ctx, cfg.nombreApp, W / 2, 800, { tam: 78, peso: 800, color: "#fff", alinear: "center", espaciado: -1.5 }));
      capa(0.5, 1.0, () => texto(ctx, "Tus finanzas en orden, en guaraníes", W / 2, 870, { tam: 36, peso: 500, color: C.pale, alinear: "center" }));
      capa(0.9, 1.4, () => {
        texto(ctx, "Probalo", W / 2, 1060, { tam: 54, peso: 700, color: "#fff", alinear: "center" });
        texto(ctx, `${cfg.diasPrueba} días gratis`, W / 2, 1180, { tam: 118, peso: 800, color: C.mint, alinear: "center", espaciado: -3 });
        texto(ctx, `Después ${gs(cfg.precioMensual)} por mes`, W / 2, 1258, { tam: 40, peso: 600, color: C.pale, alinear: "center" });
      });
      capa(1.4, 1.9, () => {
        const pul = 1 + 0.025 * Math.sin(Math.max(0, t - 1.9) * 5);
        ctx.save(); ctx.translate(W / 2, 1420); ctx.scale(pul, pul);
        rr(ctx, -380, -70, 760, 140, 70, C.mint);
        texto(ctx, "Escribinos por WhatsApp", 0, -6, { tam: 40, peso: 800, color: C.dark, alinear: "center" });
        texto(ctx, waLindo, 0, 42, { tam: 34, peso: 600, color: C.dark, alinear: "center" });
        ctx.restore();
      });
      capa(1.8, 2.3, () => texto(ctx, "Celular y computadora · Sin instalar nada", W / 2, 1610, { tam: 32, peso: 500, color: C.pale, alinear: "center" }));
    }],
  ];
  const INICIOS = []; { let a = 0; for (const [d] of ESCENAS) { INICIOS.push(a); a += d; } }
  const DUR = INICIOS[INICIOS.length - 1] + ESCENAS[ESCENAS.length - 1][0];

  /** Dibuja el cuadro del segundo t */
  function dibujar(ctx, t) {
    ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    ESCENAS.forEach(([d, f], i) => {
      const a = INICIOS[i], fin = a + d + (i < ESCENAS.length - 1 ? FADE : 0);
      if (t < a || t >= fin) return;
      ctx.save();
      ctx.globalAlpha = i > 0 ? eo(prog(t, a, a + FADE)) : 1;
      f(ctx, t - a);
      ctx.restore();
    });
    // fundido final
    const fin = prog(t, DUR - 0.35, DUR);
    if (fin > 0) { ctx.fillStyle = `rgba(15,42,36,${fin})`; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  async function fuentes() {
    await Promise.all([400, 500, 600, 700, 800].map((p) => document.fonts.load(F(p, 40), "Áá$0")));
    await document.fonts.ready;
    await cargarLogo();
  }

  /** Genera el MP4 y devuelve un ArrayBuffer */
  async function generar(alAvanzar) {
    if (typeof VideoEncoder === "undefined") throw new Error("Este navegador no puede generar video: usá Chrome o Edge actualizado.");
    if (!window.Mp4Muxer) throw new Error("No se pudo cargar el empaquetador de video (revisá la conexión a internet).");
    await fuentes();
    // OffscreenCanvas + transferToImageBitmap: cada cuadro es una imagen nueva
    // (con un <canvas> común, VideoFrame a veces toma una imagen vieja).
    const lienzo = new OffscreenCanvas(W, H);
    const ctx = lienzo.getContext("2d");
    let codec = null;
    for (const c of ["avc1.640028", "avc1.4d0028", "avc1.42E028"]) {
      const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 3500000, framerate: FPS });
      if (s.supported) { codec = c; break; }
    }
    if (!codec) throw new Error("Este navegador no puede codificar H.264.");
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: FPS }, fastStart: "in-memory" });
    let fallo = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { fallo = e; } });
    enc.configure({ codec, width: W, height: H, bitrate: 3500000, framerate: FPS, latencyMode: "quality" });
    const N = Math.round(DUR * FPS);
    for (let i = 0; i < N; i++) {
      dibujar(ctx, i / FPS);
      const bmp = lienzo.transferToImageBitmap();
      const cuadro = new VideoFrame(bmp, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(cuadro, { keyFrame: i % (FPS * 2) === 0 });
      cuadro.close(); bmp.close();
      if (fallo) throw fallo;
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 10 === 0) { if (alAvanzar) alAvanzar(i / N); await new Promise((r) => setTimeout(r, 0)); }
    }
    await enc.flush();
    if (fallo) throw fallo;
    muxer.finalize();
    if (alAvanzar) alAvanzar(1);
    return muxer.target.buffer;
  }

  /* ---------- página ---------- */
  const lienzo = document.getElementById("lienzo");
  if (lienzo) {
    const ctx = lienzo.getContext("2d");
    const bPlay = document.getElementById("play"), bMp4 = document.getElementById("mp4");
    const estado = document.getElementById("estado"), barra = document.getElementById("barra");
    let corriendo = false, t0 = 0, tPausa = 0;
    fuentes().then(() => dibujar(ctx, 2.6));
    const paso = (ahora) => {
      if (!corriendo) return;
      const t = (ahora - t0) / 1000;
      if (t >= DUR) { corriendo = false; tPausa = 0; bPlay.textContent = "▶ Reproducir"; dibujar(ctx, DUR - 0.5); barra.style.width = "100%"; return; }
      dibujar(ctx, t); barra.style.width = `${(t / DUR) * 100}%`;
      requestAnimationFrame(paso);
    };
    bPlay.addEventListener("click", async () => {
      await fuentes();
      if (corriendo) { corriendo = false; tPausa = (performance.now() - t0) / 1000; bPlay.textContent = "▶ Seguir"; return; }
      corriendo = true; t0 = performance.now() - tPausa * 1000; bPlay.textContent = "❚❚ Pausa";
      requestAnimationFrame(paso);
    });
    bMp4.addEventListener("click", async () => {
      corriendo = false; bPlay.textContent = "▶ Reproducir"; tPausa = 0;
      bMp4.disabled = bPlay.disabled = true;
      try {
        const buf = await generar((p) => { estado.textContent = `Generando video… ${Math.round(p * 100)}%`; barra.style.width = `${p * 100}%`; });
        const nombre = `promo-${U.norm(cfg.nombreApp).replace(/[^a-z0-9]+/g, "-")}.mp4`;
        const url = URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
        const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        estado.textContent = `Listo: ${nombre} (${(buf.byteLength / 1048576).toFixed(1)} MB)`;
      } catch (e) { estado.textContent = e.message; estado.style.color = "#ff8473"; }
      bMp4.disabled = bPlay.disabled = false;
    });
  }

  /** Para pruebas automáticas: cuadro del segundo t como PNG (data URL) */
  async function cuadroPng(t) {
    await fuentes();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    dibujar(c.getContext("2d"), t);
    return c.toDataURL("image/png");
  }
  async function base64(buf) {
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(new Blob([buf])); });
  }
  return { W, H, FPS, DUR, dibujar, generar, cuadroPng, base64 };
})();
