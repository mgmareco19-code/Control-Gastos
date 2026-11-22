# Control de gastos

Sistema para que cada cliente anote sus ingresos y gastos, controle préstamos en cuotas y lleve sus ahorros.
**Multiusuario y por abono mensual**: vos creás las cuentas desde el superadmin y cobrás el abono. Cada cuenta es de una persona y nadie ve los datos de otro.
HTML + CSS + JavaScript sin frameworks, con base Oracle + ORDS (igual que Turnos Barber). Funciona en computadora y en celular.

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Tus clientes | Ingreso con email y contraseña, y todo el sistema |
| `superadmin.html` | Vos | Crear cuentas, cobrar el abono, suspender, generar contraseña nueva, borrar cuentas, ver lo cobrado |
| `ventas.html` | Interesados | Página de venta: qué incluye, precio, preguntas frecuentes y botones a tu WhatsApp |
| `terminos.html` · `privacidad.html` | Todos | Textos legales (borrador para revisar con un abogado) |

## Probarlo (modo demo)

Abrí `index.html`. Sin `apiUrl` en `js/config.js` arranca en **modo demo**: los datos quedan solo en ese navegador.

| Cuenta (contraseña `demo1234`) | Estado del abono |
|---|---|
| magnom@demo.com | Al día, con datos de ejemplo completos |
| ana@demo.com | Vence en 3 días (ve el aviso) |
| carlos@demo.com | Vencida: solo lectura |

Superadmin: `superadmin.html`, cualquier email, contraseña `super`.
Para volver a los datos de ejemplo: menú lateral → *Volver a los datos de ejemplo*.

## Cómo se vende

1. El cliente te escribe por WhatsApp (los botones de la pantalla de ingreso van a `soporteWhatsapp` de `js/config.js`).
2. En el superadmin: **Nueva cuenta** (nombre, email, WhatsApp, abono y vencimiento; se proponen 15 días de prueba).
3. Se genera una **contraseña temporal** con el mensaje listo para **Copiar** o **Enviar por WhatsApp**. No se vuelve a mostrar.
4. El cliente entra, la primera vez **tiene que elegir su propia contraseña** y **aceptar los Términos y la Política de privacidad** (queda registrado con fecha, versión e IP en `cg_aceptaciones`). Arranca con 10 categorías base.
5. Cuando paga: **Cobrar** (1, 2, 3, 6 o 12 meses). Suma los meses desde el vencimiento, o desde hoy si ya venció, y reactiva la cuenta.

**Estados del abono** (los controla la base, no la página):

| Estado | Qué ve el cliente |
|---|---|
| Activa | Todo normal |
| Por vencer (7 días antes) | Aviso azul con botón **Renovar** (WhatsApp) |
| En gracia (hasta 5 días después de vencer) | Aviso naranja, todavía puede cargar |
| Vencida | **Solo lectura**: ve todos sus datos pero no puede cargar ni modificar |
| Suspendida (la suspendés vos) | Igual que vencida |

- **Filtrar por fecha** (arriba del panel): **Mes** (con flechas o tocando el nombre), **Entre fechas** (desde/hasta) o **Todo**. Cambia el total cobrado y la lista de Cobros; en Cuentas podés elegir ver las que vencen, se crearon o entraron en ese período.
- **Olvidó la contraseña**: en el superadmin, abrí la cuenta → **Nueva contraseña** y mandásela. Se cierran sus sesiones abiertas.
- **Borrar una cuenta** borra todos sus datos y pide escribir el email. Si solo dejó de pagar, mejor suspendela.
- Precio por defecto: `precioMensual` en `js/config.js` y `c_precio` en `oracle/03_paquete.sql` (25.000 Gs.). A cada cuenta le podés poner otro precio.

## Instalarlo online (Oracle)

Usa la **misma base** Autonomous Database de Turnos Barber, en un esquema aparte (`GASTOS`).

1. **Database Actions → SQL** como **ADMIN**: `oracle/01_admin.sql` (antes cambiá la contraseña).
2. Entrá como **GASTOS** y corré en orden: `02_tablas.sql`, `03_paquete.sql`, `04_ords.sql`, `05_inicial.sql` (en este último poné tu email y contraseña de superadmin).
3. Si `03` da error: `select name, line, text from user_errors order by name, sequence;` y pasame el resultado.
4. En `js/config.js` poné en `apiUrl` la URL de la API: la misma de Turnos, cambiando `/ords/turnos/` por `/ords/gastos/`.
5. Publicar la página: `armar-zip.ps1` arma `..\gastos-web.zip` (sin el superadmin). Subilo a un bucket nuevo (por ejemplo `gastos-web`) igual que Turnos, y poné esa dirección en `urlPublica` de `js/config.js`.
6. El superadmin usalo desde tu computadora (Live Server, `http://127.0.0.1:5500`), que ya está permitido en `04_ords.sql`.

Errores inesperados de la API: tabla `cg_errores`.

## Pantallas

| Sección | Qué hace |
|---|---|
| **Inicio** | Saldo del mes, ingresos y gastos, % gastado, últimos movimientos, gastos por categoría y gráfico de los últimos 6 meses (tocá una barra para ir a ese mes) |
| **Movimientos** | Todo lo del mes agrupado por día, con buscador. Tocá uno para modificarlo o borrarlo |
| **Ingresos / Gastos** | Total del mes, cantidad y promedio. Tabla en computadora, lista en celular |
| **Categorías** | De gastos y de ingresos, con color. Una categoría en uso no se puede borrar |
| **Préstamos** | Deuda pendiente, cuota del mes, avance y atrasos. Activos y cancelados |
| **Ahorros** | Depósitos y retiros por entidad (banco, cooperativa, alcancía…), total ahorrado y dónde está |
| **Mi cuenta y configuración** (avatar o *Configuración* en el menú) | **Modo claro, oscuro o automático**, estado del abono, renovar por WhatsApp, **descargar mis datos en Excel**, cambiar contraseña, cerrar sesión |

Al cargar un movimiento aparecen los **frecuentes** (lo que más repetís) para anotarlos con un toque.

## Préstamos y cuotas

- Al incluir un préstamo se cargan entidad, cantidad de cuotas, monto de la cuota y fecha de la primera cuota. El total se calcula solo y se generan todas las cuotas (una por mes).
- **Marcar como pagada** registra automáticamente un **gasto** con la categoría del préstamo, en la fecha que elijas (no futura).
- Si borrás ese gasto, o desmarcás la cuota en *Ver todas las cuotas*, la cuota vuelve a quedar pendiente.
- Cada cuota pendiente se puede modificar (monto o vencimiento).
- Con al menos una cuota pagada, el préstamo solo deja cambiar la entidad y la categoría.
- Un préstamo con todas las cuotas pagadas pasa a **Cancelados**.

## Ahorros

Van aparte: no restan del saldo del mes. Un retiro no puede ser mayor a lo que hay en esa entidad.

## Descargar mis datos (Excel)

En *Mi cuenta* → **Descargar mis datos (Excel)**. Baja un `.xlsx` con 6 hojas: Resumen (totales y saldo por mes), Movimientos, Préstamos, Cuotas, Ahorros y Categorías. Funciona también con la cuenta vencida o suspendida, así el cliente siempre puede llevarse sus datos (es lo que prometen los Términos). Se arma en el navegador con las consultas que ya existen: no hace falta nada nuevo en la base.



## Archivos

```
index.html          la app del cliente (rutas #/inicio, #/movimientos, …)
superadmin.html     tu panel
css/styles.css      estilos
img/                logo: imagen original (no se publica), logo-512/256/96.png sin texto y fondo transparente, icono-180/512.png con fondo para el iPhone
js/config.js        WhatsApp de soporte, apiUrl, precio, días de gracia y de prueba
js/utils.js         formato de guaraníes, fechas y estado del abono
js/db.js            datos en modo demo (localStorage)
js/db-oracle.js     datos en modo online (mismas funciones que db.js)
js/app.js           pantallas del cliente
js/excel.js         arma y descarga el Excel (.xlsx) sin librerías
js/tema.js          modo claro / oscuro / automático (se guarda en el dispositivo)
js/superadmin.js    pantallas del superadmin
oracle/             scripts de la base (01 a 05)
armar-zip.ps1       arma el zip para publicar
maquetas/           maqueta de referencia (PDF)
promo/              video promocional (no se publica en el bucket)
```

## Video promocional

- `promo/promo-control-de-gastos.mp4`: vertical 1080×1920, 25 segundos, sin sonido (para estados de WhatsApp, Reels, TikTok y Shorts). `promo/promo-portada.png`: el cuadro final como imagen.
- Para rehacerlo (por ejemplo si cambiás el precio o los días de prueba en `js/config.js`): abrí `promo/video.html` en Chrome o Edge con Live Server → **Descargar MP4**. Los textos de cada escena están en `promo/video.js` (sección *Escenas*).
- La música agregala al publicar (Instagram, TikTok o CapCut tienen música con licencia).

## Términos y privacidad

- Son un **borrador**: revisalos con un abogado antes de vender.
- Si cambiás el texto, poné la fecha nueva en «Última actualización», en `terminosVersion` (`js/config.js`) y en `c_terminos_ver` (`oracle/03_paquete.sql`), y volvé a correr `03`. Todos los clientes los vuelven a aceptar al entrar.

## Pendiente

- **Mi atajo** (pantalla 3 de la maqueta): anotar un gasto desde el atajo del celular con un token personal.
- Recuperar contraseña por correo (hoy se resetea desde el superadmin).
