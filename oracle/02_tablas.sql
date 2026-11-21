/* ============================================================
   02 · Correr como GASTOS
   Tablas. Todo lo de cada cliente cuelga de cg_cuentas (cuenta_id)
   y se borra en cascada si se borra la cuenta.
   ============================================================ */

-- Cada cliente (una persona = una cuenta)
create table cg_cuentas (
  id               number generated always as identity primary key,
  nombre           varchar2(60)  not null,
  email            varchar2(120) not null constraint cg_cuentas_email_uk unique,
  clave_hash       raw(32)       not null,
  clave_sal        raw(16)       not null,
  debe_cambiar     number(1)     default 1 not null check (debe_cambiar in (0, 1)),  -- 1 = entra con clave temporal
  intentos         number(3)     default 0 not null,
  bloqueado_hasta  timestamp with time zone,
  whatsapp         varchar2(20),                 -- para que vos le escribas
  notas            varchar2(500),                -- notas tuyas (no las ve el cliente)
  activo           number(1)     default 1 not null check (activo in (0, 1)),
  vence_el         date,                         -- null = sin vencimiento
  precio           number(12)    not null check (precio >= 0),   -- abono mensual en Gs.
  creado_en        timestamp with time zone default systimestamp not null,
  ultimo_acceso    timestamp with time zone
);

-- Vos (la plataforma)
create table cg_superadmins (
  id               number generated always as identity primary key,
  email            varchar2(120) not null constraint cg_superadmins_email_uk unique,
  clave_hash       raw(32)       not null,
  clave_sal        raw(16)       not null,
  intentos         number(3)     default 0 not null,
  bloqueado_hasta  timestamp with time zone
);

-- Sesiones abiertas (se guarda el hash del token, nunca el token)
create table cg_sesiones (
  token_hash  raw(32)      primary key,
  tipo        varchar2(6)  not null check (tipo in ('cuenta', 'super')),
  cuenta_id   number       references cg_cuentas on delete cascade,
  super_id    number       references cg_superadmins on delete cascade,
  expira      timestamp with time zone not null,
  creado_en   timestamp with time zone default systimestamp not null
);
create index cg_sesiones_exp_ix on cg_sesiones (expira);
create index cg_sesiones_cta_ix on cg_sesiones (cuenta_id);

-- Cobros del abono
create table cg_pagos (
  id          number generated always as identity primary key,
  cuenta_id   number      not null references cg_cuentas on delete cascade,
  fecha       date        not null,
  monto       number(12)  not null check (monto >= 0),
  meses       number(2)   not null check (meses between 1 and 24),
  desde       date        not null,
  hasta       date        not null,
  creado_en   timestamp with time zone default systimestamp not null
);
create index cg_pagos_cta_ix on cg_pagos (cuenta_id);
create index cg_pagos_fecha_ix on cg_pagos (fecha);

/* ---------------- Datos de cada cuenta ---------------- */
create table cg_categorias (
  id         number generated always as identity primary key,
  cuenta_id  number       not null references cg_cuentas on delete cascade,
  nombre     varchar2(40) not null,
  tipo       varchar2(7)  not null check (tipo in ('gasto', 'ingreso')),
  color      varchar2(7)  default '#868E96' not null
);
create unique index cg_categorias_uk on cg_categorias (cuenta_id, tipo, upper(nombre));

create table cg_movimientos (
  id            number generated always as identity primary key,
  cuenta_id     number        not null references cg_cuentas on delete cascade,
  tipo          varchar2(7)   not null check (tipo in ('gasto', 'ingreso')),
  monto         number(14)    not null check (monto > 0),
  categoria_id  number        not null references cg_categorias,
  descripcion   varchar2(100),
  fecha         date          not null,
  cuota_id      number,                        -- si es el pago de una cuota (FK abajo)
  creado_en     timestamp with time zone default systimestamp not null
);
create index cg_mov_cta_fecha_ix on cg_movimientos (cuenta_id, fecha);
create index cg_mov_cat_ix on cg_movimientos (categoria_id);
create index cg_mov_cuota_ix on cg_movimientos (cuota_id);

create table cg_prestamos (
  id            number generated always as identity primary key,
  cuenta_id     number        not null references cg_cuentas on delete cascade,
  entidad       varchar2(60)  not null,
  cuotas        number(3)     not null check (cuotas between 1 and 360),
  monto_cuota   number(14)    not null check (monto_cuota > 0),
  fecha_inicio  date          not null,        -- vencimiento de la primera cuota
  categoria_id  number        not null references cg_categorias,
  creado_en     timestamp with time zone default systimestamp not null
);
create index cg_prest_cta_ix on cg_prestamos (cuenta_id);
create index cg_prest_cat_ix on cg_prestamos (categoria_id);

create table cg_cuotas (
  id             number generated always as identity primary key,
  prestamo_id    number      not null references cg_prestamos on delete cascade,
  cuenta_id      number      not null references cg_cuentas on delete cascade,
  numero         number(3)   not null,
  vence          date        not null,
  monto          number(14)  not null check (monto > 0),
  pagada_el      date,
  movimiento_id  number references cg_movimientos on delete set null,
  constraint cg_cuotas_uk unique (prestamo_id, numero)
);
create index cg_cuotas_mov_ix on cg_cuotas (movimiento_id);
create index cg_cuotas_cta_ix on cg_cuotas (cuenta_id);

alter table cg_movimientos add constraint cg_mov_cuota_fk foreign key (cuota_id) references cg_cuotas on delete set null;

create table cg_ahorros (
  id           number generated always as identity primary key,
  cuenta_id    number        not null references cg_cuentas on delete cascade,
  fecha        date          not null,
  descripcion  varchar2(100) not null,
  entidad      varchar2(60)  not null,
  tipo         varchar2(8)   not null check (tipo in ('deposito', 'retiro')),
  monto        number(14)    not null check (monto > 0),
  creado_en    timestamp with time zone default systimestamp not null
);
create index cg_ahorros_cta_ix on cg_ahorros (cuenta_id);

-- Errores inesperados de la API (para revisar vos)
create table cg_errores (
  id      number generated always as identity primary key,
  fn      varchar2(40),
  error   varchar2(4000),
  pila    varchar2(4000),
  en      timestamp with time zone default systimestamp not null
);

-- Aceptación de los Términos y la Política de privacidad: quién, cuándo y qué versión.
-- (la versión vigente es c_terminos_ver en 03_paquete.sql)
create table cg_aceptaciones (
  id           number generated always as identity primary key,
  cuenta_id    number         not null references cg_cuentas on delete cascade,
  email        varchar2(120)  not null,   -- copia: queda aunque después cambie el email
  version      varchar2(20)   not null,
  ip           varchar2(64),
  aceptado_en  timestamp with time zone default systimestamp not null
);
create index cg_aceptaciones_ix on cg_aceptaciones (cuenta_id, version);

/* Para ver quién aceptó:
     select a.aceptado_en, c.nombre, a.email, a.version, a.ip
       from cg_aceptaciones a join cg_cuentas c on c.id = a.cuenta_id
      order by a.aceptado_en desc; */
