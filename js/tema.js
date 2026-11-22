/* Tema claro / oscuro. Se carga en el <head> (antes de pintar) para que no parpadee.
   Preferencia guardada en este dispositivo: "claro", "oscuro" o "auto" (sigue al sistema). */
window.Tema = (() => {
  const CLAVE = "cg_tema";
  const sistema = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  const preferencia = () => { try { const v = localStorage.getItem(CLAVE); return ["claro", "oscuro", "auto"].includes(v) ? v : "auto"; } catch (e) { return "auto"; } };
  const efectivo = (p = preferencia()) => (p === "auto" ? (sistema && sistema.matches ? "oscuro" : "claro") : p);

  function aplicar() {
    const t = efectivo();
    document.documentElement.dataset.tema = t;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = t === "oscuro" ? "#171f1c" : "#ffffff";
  }
  function elegir(p) {
    try { localStorage.setItem(CLAVE, p); } catch (e) { /* sin almacenamiento: solo esta vez */ }
    aplicar();
  }
  if (sistema) {
    const alCambiar = () => { if (preferencia() === "auto") aplicar(); };
    sistema.addEventListener ? sistema.addEventListener("change", alCambiar) : sistema.addListener(alCambiar);
  }
  aplicar();
  return { preferencia, efectivo, elegir };
})();
