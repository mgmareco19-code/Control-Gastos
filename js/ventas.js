/* Páginas públicas: nombre, precio, días de prueba y links de WhatsApp salen de js/config.js */
(() => {
  const cfg = window.APP_CONFIG;
  const msgs = {
    prueba: `Hola! Vi la página de ${cfg.nombreApp} y quiero probarlo ${cfg.diasPrueba} días gratis.`,
    alta: `Hola! Quiero una cuenta de ${cfg.nombreApp}.`,
  };
  const $$ = (s) => document.querySelectorAll(s);
  $$("[data-wa]").forEach((a) => { a.href = `https://wa.me/${cfg.soporteWhatsapp}?text=${encodeURIComponent(msgs[a.dataset.wa] || msgs.alta)}`; });
  $$("[data-precio]").forEach((el) => { el.textContent = U.gs(cfg.precioMensual); });
  $$("[data-prueba]").forEach((el) => { el.textContent = cfg.diasPrueba; });
  $$(".js-app").forEach((el) => { el.textContent = cfg.nombreApp; });
  $$("[data-anio]").forEach((el) => { el.textContent = new Date().getFullYear(); });
  if (window.lucide) lucide.createIcons();
})();
