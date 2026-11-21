/* ============================================================
   CONFIGURACIÓN DE LA PLATAFORMA
   ============================================================ */
window.APP_CONFIG = {
  nombreApp: "Control de gastos",

  /* A dónde te escriben los clientes para renovar o pedir ayuda (sin "+") */
  soporteWhatsapp: "595981681218",

  /* Fecha de terminos.html y privacidad.html. Si cambiás los textos, poné la fecha nueva acá y en
     c_terminos_ver (oracle/03_paquete.sql): los clientes los vuelven a aceptar al entrar. */
  terminosVersion: "2026-11-21",

  /* --- Base de datos online (Oracle Autonomous Database + ORDS) ---
     URL de la API publicada con oracle/04_ords.sql, por ejemplo:
     "https://abc123-saas.adb.sa-santiago-1.oraclecloudapps.com/ords/gastos/api/rpc"
     Vacío = MODO DEMO (los datos quedan solo en este navegador). */
  apiUrl: "",

  /* Dirección pública de la página (termina en /). Se usa en el mensaje con el acceso
     que le mandás a cada cliente. Vacío = la dirección actual. */
  urlPublica: "",

  /* Abono mensual por defecto (Gs.). A cada cuenta le podés poner otro precio desde el superadmin.
     Tiene que coincidir con c_precio en oracle/03_paquete.sql */
  precioMensual: 25000,

  /* Días que una cuenta vencida sigue pudiendo cargar (después queda en solo lectura).
     Tiene que coincidir con c_dias_gracia en oracle/03_paquete.sql */
  diasGracia: 5,

  /* Días de prueba que se proponen al crear una cuenta */
  diasPrueba: 15,

  /* Meses que muestra el gráfico Ingresos vs Gastos */
  mesesGrafico: 6,

  /* Solo para el modo demo */
  demoPassword: "demo1234",
  demoPasswordSuper: "super",
};
