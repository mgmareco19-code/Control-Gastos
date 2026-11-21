/* ============================================================
   03 · Correr como GASTOS
   Paquete CG_API: toda la lógica de la app.
   La página llama a una sola URL (ver 04_ords.sql) con
     {"fn": "nombre_funcion", "args": {...}, "token": "..."}
   y recibe
     {"ok": true, "data": ...}   o   {"ok": false, "error": "mensaje"}
   Las tablas NO se publican: todo pasa por acá, y cada función
   filtra por la cuenta de la sesión (nadie ve datos de otro).
   ============================================================ */

create or replace package cg_api authid definer as
  function  rpc(p_body in clob) return clob;
  /* Crear o cambiar la clave del superadmin (correr a mano, ver 05_inicial.sql) */
  procedure crear_superadmin(p_email in varchar2, p_clave in varchar2);
end cg_api;
/

create or replace package body cg_api as

  /* ---------------- Configuración ---------------- */
  c_tz           constant varchar2(40) := 'America/Asuncion';
  c_dias_gracia  constant pls_integer  := 5;       -- igual que diasGracia en js/config.js
  c_precio       constant number       := 25000;   -- abono mensual por defecto (Gs.), igual que precioMensual en js/config.js
  c_dias_sesion  constant pls_integer  := 30;
  c_max_monto    constant number       := 99999999999;
  -- Versión de terminos.html / privacidad.html. Si cambiás los textos, poné acá la fecha nueva
  -- (la misma que «Última actualización») y re-corré este archivo: los clientes los aceptan de nuevo.
  -- Tiene que coincidir con terminosVersion en js/config.js
  c_terminos_ver constant varchar2(20) := '2026-11-21';

  /* ---------------- Estado de la llamada ---------------- */
  g_cuenta    number;
  g_super     number;
  g_tok_hash  raw(32);

  /* ---------------- Utilidades ---------------- */
  procedure err(p_msg varchar2) is
  begin
    raise_application_error(-20001, p_msg);
  end;

  procedure sin_sesion is
  begin
    raise_application_error(-20002, 'Tu sesión terminó. Volvé a ingresar.');
  end;

  function ahora return date is
  begin
    return cast(systimestamp at time zone c_tz as date);
  end;

  function hoy return date is
  begin
    return trunc(ahora);
  end;

  function iso(p date) return varchar2 is
  begin
    return to_char(p, 'YYYY-MM-DD');
  end;

  function iso_ts(p timestamp with time zone) return varchar2 is
  begin
    return to_char(p at time zone c_tz, 'YYYY-MM-DD"T"HH24:MI:SS');
  end;

  function tiene(o json_object_t, k varchar2) return boolean is
  begin
    return o.has(k) and not o.get(k).is_null;
  end;

  function a_txt(o json_object_t, k varchar2, p_max pls_integer default 4000) return varchar2 is
    v varchar2(32767);
  begin
    if not tiene(o, k) then return null; end if;
    v := trim(o.get_string(k));
    if length(v) > p_max then err('Uno de los textos es demasiado largo.'); end if;
    return v;
  end;

  function a_num(o json_object_t, k varchar2) return number is
    e json_element_t;
  begin
    if not tiene(o, k) then return null; end if;
    e := o.get(k);
    if e.is_number then
      return o.get_number(k);
    elsif e.is_string then
      return to_number(o.get_string(k));
    end if;
    err('Dato numérico inválido.');
    return null;
  exception
    when value_error or invalid_number then err('Dato numérico inválido.'); return null;
  end;

  function a_entero(o json_object_t, k varchar2, p_min number, p_max number, p_msg varchar2) return number is
    n number := a_num(o, k);
  begin
    if n is null or n <> trunc(n) or n < p_min or n > p_max then err(p_msg); end if;
    return n;
  end;

  function a_bool(o json_object_t, k varchar2) return number is
  begin
    if not tiene(o, k) then return null; end if;
    if not o.get(k).is_boolean then err('Dato inválido.'); end if;
    return case when o.get_boolean(k) then 1 else 0 end;
  end;

  function a_fecha(o json_object_t, k varchar2, p_msg varchar2 default 'Ingresá una fecha válida.') return date is
    v varchar2(20) := a_txt(o, k, 20);
    d date;
  begin
    if v is null or not regexp_like(v, '^\d{4}-\d{2}-\d{2}$') then err(p_msg); end if;
    d := to_date(v, 'YYYY-MM-DD');
    if d < date '2000-01-01' or d > add_months(hoy, 600) then err(p_msg); end if;
    return d;
  exception
    when others then
      if sqlcode = -20001 then raise; end if;
      err(p_msg); return null;
  end;

  function a_monto(o json_object_t, k varchar2, p_msg varchar2 default 'Ingresá un monto mayor a cero.') return number is
  begin
    return a_entero(o, k, 1, c_max_monto, p_msg);
  end;

  /* 31 ene + 1 mes = 28/29 feb (igual que en la página) */
  function sumar_meses(p date, n number) return date is
    t date := add_months(trunc(p, 'MM'), n);
  begin
    return t + least(extract(day from p), extract(day from last_day(t))) - 1;
  end;

  function gs(n number) return varchar2 is
  begin
    return 'Gs. ' || replace(trim(to_char(n, '999G999G999G999', 'NLS_NUMERIC_CHARACTERS='',.''')), ',', '.');
  end;

  procedure log_error(p_fn varchar2, p_error varchar2, p_pila varchar2) is
    pragma autonomous_transaction;
  begin
    insert into cg_errores (fn, error, pila) values (substr(p_fn, 1, 40), substr(p_error, 1, 4000), substr(p_pila, 1, 4000));
    commit;
  end;

  function validar_email(p varchar2) return varchar2 is
    v varchar2(200) := lower(trim(p));
  begin
    if v is null or length(v) > 120 or not regexp_like(v, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      err('Ingresá un email válido.');
    end if;
    return v;
  end;

  /* ---------------- Claves y sesiones ---------------- */
  function hash_clave(p_clave varchar2, p_sal raw) return raw is
    h raw(32);
  begin
    h := dbms_crypto.hash(utl_raw.concat(p_sal, utl_i18n.string_to_raw(nvl(p_clave, ' '), 'AL32UTF8')), dbms_crypto.hash_sh256);
    for i in 1 .. 5000 loop
      h := dbms_crypto.hash(utl_raw.concat(h, p_sal), dbms_crypto.hash_sh256);
    end loop;
    return h;
  end;

  procedure validar_clave(p varchar2) is
  begin
    if p is null or length(p) < 8 or length(p) > 100 then
      err('La contraseña tiene que tener al menos 8 caracteres.');
    end if;
  end;

  /* 10 caracteres sin letras confusas (sin l, I, O, 0, 1) */
  function clave_temporal return varchar2 is
    c constant varchar2(60) := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    r raw(10) := dbms_crypto.randombytes(10);
    v varchar2(10);
  begin
    for i in 1 .. 10 loop
      v := v || substr(c, mod(to_number(rawtohex(utl_raw.substr(r, i, 1)), 'XX'), length(c)) + 1, 1);
    end loop;
    return v;
  end;

  function nuevo_token(p_tipo varchar2, p_cuenta number, p_super number) return varchar2 is
    r raw(32) := dbms_crypto.randombytes(32);
    h raw(32) := dbms_crypto.hash(r, dbms_crypto.hash_sh256);
  begin
    delete from cg_sesiones where expira < systimestamp;
    insert into cg_sesiones (token_hash, tipo, cuenta_id, super_id, expira)
    values (h, p_tipo, p_cuenta, p_super, systimestamp + numtodsinterval(c_dias_sesion, 'DAY'));
    return lower(rawtohex(r));
  end;

  procedure cargar_sesion(p_token varchar2, p_tipo varchar2) is
    h raw(32);
  begin
    g_cuenta := null; g_super := null; g_tok_hash := null;
    if p_token is null or not regexp_like(p_token, '^[0-9a-f]{64}$') then sin_sesion; end if;
    h := dbms_crypto.hash(hextoraw(p_token), dbms_crypto.hash_sh256);
    if p_tipo = 'cuenta' then
      select s.cuenta_id into g_cuenta
        from cg_sesiones s
       where s.token_hash = h and s.tipo = 'cuenta' and s.expira > systimestamp and s.cuenta_id is not null;
    else
      select s.super_id into g_super
        from cg_sesiones s
       where s.token_hash = h and s.tipo = 'super' and s.expira > systimestamp and s.super_id is not null;
    end if;
    g_tok_hash := h;
  exception
    when no_data_found then sin_sesion;
  end;

  procedure cerrar_sesion(p_token varchar2) is
    h raw(32);
  begin
    if p_token is null or not regexp_like(p_token, '^[0-9a-f]{64}$') then return; end if;
    h := dbms_crypto.hash(hextoraw(p_token), dbms_crypto.hash_sh256);
    delete from cg_sesiones where token_hash = h;
  end;

  /* La cuenta tiene que cambiar la clave temporal antes de usar el sistema */
  procedure exigir_clave_propia is
    l number;
  begin
    select debe_cambiar into l from cg_cuentas where id = g_cuenta;
    if l = 1 then err('Antes de seguir, cambiá la contraseña temporal. Recargá la página.'); end if;
  end;

  /* ¿La cuenta todavía no aceptó los términos vigentes? */
  function terminos_pendiente(p_cuenta number) return boolean is
    l number;
  begin
    select count(*) into l from cg_aceptaciones where cuenta_id = p_cuenta and version = c_terminos_ver;
    return l = 0;
  end;

  procedure exigir_terminos is
  begin
    if terminos_pendiente(g_cuenta) then
      err('Para seguir, aceptá los Términos y la Política de privacidad. Recargá la página.');
    end if;
  end;

  /* Abono vencido (pasados los días de gracia) o cuenta suspendida = solo lectura */
  procedure exigir_escritura is
    l_act   number;
    l_vence date;
  begin
    select activo, vence_el into l_act, l_vence from cg_cuentas where id = g_cuenta;
    if l_act = 0 then
      err('Tu cuenta está suspendida: podés ver tus datos, pero no cargar ni modificar. Escribinos para reactivarla.');
    end if;
    if l_vence is not null and l_vence + c_dias_gracia < hoy then
      err('Tu abono venció el ' || to_char(l_vence, 'DD/MM/YYYY') || '. Podés ver tus datos, pero para cargar o modificar tenés que renovarlo.');
    end if;
  end;

  /* ---------------- JSON ---------------- */
  function cuenta_obj(p_id number, p_super boolean default false) return json_object_t is
    r  cg_cuentas%rowtype;
    o  json_object_t := json_object_t();
    l_movs number;
    l_ult  date;
  begin
    select * into r from cg_cuentas where id = p_id;
    o.put('id', r.id);
    o.put('nombre', r.nombre);
    o.put('email', r.email);
    o.put('activo', r.activo = 1);
    o.put('vence_el', iso(r.vence_el));
    o.put('precio', r.precio);
    o.put('debe_cambiar', r.debe_cambiar = 1);
    o.put('dias_gracia', c_dias_gracia);
    o.put('terminos_pendiente', terminos_pendiente(p_id));
    o.put('terminos_version', c_terminos_ver);
    o.put('creado_en', iso_ts(r.creado_en));
    if p_super then
      select count(*), max(fecha) into l_movs, l_ult from cg_movimientos where cuenta_id = p_id;
      o.put('whatsapp', r.whatsapp);
      o.put('notas', r.notas);
      o.put('ultimo_acceso', iso_ts(r.ultimo_acceso));
      o.put('movimientos', l_movs);
      o.put('ultimo_mov', iso(l_ult));
    end if;
    return o;
  end;

  function cat_json(p_id number) return clob is
    l clob;
  begin
    select json_object('id' value c.id, 'nombre' value c.nombre, 'tipo' value c.tipo, 'color' value c.color,
             'usos' value (select count(*) from cg_movimientos m where m.categoria_id = c.id)
                        + (select count(*) from cg_prestamos p where p.categoria_id = c.id) returning clob)
      into l from cg_categorias c where c.id = p_id;
    return l;
  end;

  function mov_json(p_id number) return clob is
    l clob;
  begin
    select json_object('id' value m.id, 'tipo' value m.tipo, 'monto' value m.monto, 'categoria_id' value m.categoria_id,
             'descripcion' value m.descripcion, 'fecha' value to_char(m.fecha, 'YYYY-MM-DD'), 'cuota_id' value m.cuota_id,
             'categoria' value json_object('id' value c.id, 'nombre' value c.nombre, 'tipo' value c.tipo, 'color' value c.color)
             returning clob)
      into l
      from cg_movimientos m join cg_categorias c on c.id = m.categoria_id
     where m.id = p_id and m.cuenta_id = g_cuenta;
    return l;
  exception
    when no_data_found then err('El movimiento ya no existe.'); return null;
  end;

  function cuota_json(p_id number) return clob is
    l clob;
  begin
    select json_object('id' value id, 'prestamo_id' value prestamo_id, 'numero' value numero,
             'vence' value to_char(vence, 'YYYY-MM-DD'), 'monto' value monto,
             'pagada_el' value to_char(pagada_el, 'YYYY-MM-DD'), 'movimiento_id' value movimiento_id returning clob)
      into l from cg_cuotas where id = p_id;
    return l;
  end;

  function ahorro_json(p_id number) return clob is
    l clob;
  begin
    select json_object('id' value id, 'fecha' value to_char(fecha, 'YYYY-MM-DD'), 'descripcion' value descripcion,
             'entidad' value entidad, 'tipo' value tipo, 'monto' value monto returning clob)
      into l from cg_ahorros where id = p_id;
    return l;
  end;

  /* Préstamo con su estado calculado (igual que estadoPrestamo en js/db.js) */
  function prestamo_obj(p_id number) return json_object_t is
    p       cg_prestamos%rowtype;
    o       json_object_t := json_object_t();
    c       json_object_t;
    l_n     number; l_pag number; l_total number; l_saldo number; l_venc number; l_cid number;
    l_hoy   date := hoy;
  begin
    begin
      select * into p from cg_prestamos where id = p_id and cuenta_id = g_cuenta;
    exception
      when no_data_found then err('El préstamo ya no existe.');
    end;
    select count(*), count(pagada_el), nvl(sum(monto), 0),
           nvl(sum(case when pagada_el is null then monto end), 0),
           count(case when pagada_el is null and vence < l_hoy then 1 end)
      into l_n, l_pag, l_total, l_saldo, l_venc
      from cg_cuotas where prestamo_id = p_id;
    o.put('id', p.id);
    o.put('entidad', p.entidad);
    o.put('cuotas', p.cuotas);
    o.put('monto_cuota', p.monto_cuota);
    o.put('fecha_inicio', iso(p.fecha_inicio));
    o.put('categoria_id', p.categoria_id);
    o.put('categoria', json_object_t.parse(cat_json(p.categoria_id)));
    o.put('total', l_total);
    o.put('saldo', l_saldo);
    o.put('pagado', l_total - l_saldo);
    o.put('pagadas', l_pag);
    o.put('pendientes', l_n - l_pag);
    o.put('vencidas', l_venc);
    o.put('cancelado', l_n - l_pag = 0);
    begin
      select id into l_cid
        from (select id from cg_cuotas where prestamo_id = p_id and pagada_el is null order by numero fetch first 1 row only);
      c := json_object_t.parse(cuota_json(l_cid));
      o.put('proxima', c);
    exception
      when no_data_found then o.put_null('proxima');
    end;
    return o;
  end;

  /* Categoría de esta cuenta; devuelve su tipo */
  function tipo_cat(p_id number) return varchar2 is
    l varchar2(7);
  begin
    select tipo into l from cg_categorias where id = p_id and cuenta_id = g_cuenta;
    return l;
  exception
    when no_data_found then err('Elegí una categoría.'); return null;
  end;

  procedure categorias_base(p_cuenta number) is
    procedure c(n varchar2, t varchar2, col varchar2) is
    begin
      insert into cg_categorias (cuenta_id, nombre, tipo, color) values (p_cuenta, n, t, col);
    end;
  begin
    c('Comida', 'gasto', '#D9480F');
    c('Transporte', 'gasto', '#1C7ED6');
    c('Hogar', 'gasto', '#7048E8');
    c('Salud', 'gasto', '#C2255C');
    c('Ocio', 'gasto', '#E8590C');
    c('Préstamos', 'gasto', '#E03131');
    c('Otros', 'gasto', '#868E96');
    c('Salario', 'ingreso', '#0B7A5A');
    c('Ventas', 'ingreso', '#2B8A3E');
    c('Otros ingresos', 'ingreso', '#0C8599');
  end;

  /* ================= CUENTA ================= */
  function f_login(a json_object_t) return clob is
    l_email varchar2(200) := lower(a_txt(a, 'email', 200));
    l_clave varchar2(200);
    r       cg_cuentas%rowtype;
    o       json_object_t := json_object_t();
  begin
    if tiene(a, 'password') then l_clave := a.get_string('password'); end if;
    begin
      select * into r from cg_cuentas where email = l_email for update;
    exception
      when no_data_found then err('Email o contraseña incorrectos.');
    end;
    if r.bloqueado_hasta > systimestamp then err('Demasiados intentos. Probá de nuevo en 15 minutos.'); end if;
    if hash_clave(l_clave, r.clave_sal) <> r.clave_hash then
      update cg_cuentas
         set intentos        = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
             bloqueado_hasta = case when intentos + 1 >= 5 then systimestamp + interval '15' minute end
       where id = r.id;
      commit; -- el intento queda guardado aunque después se haga rollback
      err('Email o contraseña incorrectos.');
    end if;
    update cg_cuentas set intentos = 0, bloqueado_hasta = null, ultimo_acceso = systimestamp where id = r.id;
    o.put('token', nuevo_token('cuenta', r.id, null));
    o.put('cuenta', cuenta_obj(r.id));
    return o.to_clob;
  end;

  function f_mi_cuenta return clob is
  begin
    update cg_cuentas set ultimo_acceso = systimestamp where id = g_cuenta;
    return cuenta_obj(g_cuenta).to_clob;
  end;

  function f_cambiar_clave(a json_object_t) return clob is
    l_actual varchar2(200);
    l_nueva  varchar2(200);
    r        cg_cuentas%rowtype;
    l_sal    raw(16) := dbms_crypto.randombytes(16);
  begin
    if tiene(a, 'actual') then l_actual := a.get_string('actual'); end if;
    if tiene(a, 'nueva') then l_nueva := a.get_string('nueva'); end if;
    select * into r from cg_cuentas where id = g_cuenta for update;
    if hash_clave(l_actual, r.clave_sal) <> r.clave_hash then err('La contraseña actual no es correcta.'); end if;
    validar_clave(l_nueva);
    if l_nueva = l_actual then err('La contraseña nueva tiene que ser distinta de la actual.'); end if;
    update cg_cuentas set clave_hash = hash_clave(l_nueva, l_sal), clave_sal = l_sal, debe_cambiar = 0, intentos = 0, bloqueado_hasta = null
     where id = g_cuenta;
    -- Cierra las otras sesiones (ej. otro celular)
    delete from cg_sesiones where cuenta_id = g_cuenta and token_hash <> g_tok_hash;
    return cuenta_obj(g_cuenta).to_clob;
  end;

  /* La cuenta acepta los Términos y la Política de privacidad vigentes (queda registrado) */
  function f_aceptar_terminos return clob is
    l_mail varchar2(120);
    l_ip   varchar2(64);
  begin
    if terminos_pendiente(g_cuenta) then
      begin
        l_ip := substr(nvl(owa_util.get_cgi_env('X-Forwarded-For'), owa_util.get_cgi_env('REMOTE_ADDR')), 1, 64);
      exception
        when others then l_ip := null;
      end;
      select email into l_mail from cg_cuentas where id = g_cuenta;
      insert into cg_aceptaciones (cuenta_id, email, version, ip) values (g_cuenta, l_mail, c_terminos_ver, l_ip);
    end if;
    return cuenta_obj(g_cuenta).to_clob;
  end;

  /* ================= CATEGORÍAS ================= */
  function f_categorias return clob is
    l clob;
  begin
    select json_arrayagg(json_object('id' value c.id, 'nombre' value c.nombre, 'tipo' value c.tipo, 'color' value c.color,
             'usos' value (select count(*) from cg_movimientos m where m.categoria_id = c.id)
                        + (select count(*) from cg_prestamos p where p.categoria_id = c.id))
             order by c.tipo, upper(c.nombre) returning clob)
      into l from cg_categorias c where c.cuenta_id = g_cuenta;
    return nvl(l, '[]');
  end;

  function f_guardar_categoria(a json_object_t) return clob is
    l_id     number := a_num(a, 'id');
    l_nombre varchar2(100) := a_txt(a, 'nombre', 100);
    l_tipo   varchar2(20) := a_txt(a, 'tipo', 20);
    l_color  varchar2(20) := nvl(a_txt(a, 'color', 20), '#868E96');
    l_tipo0  varchar2(7);
    l_cnt    number;
  begin
    if l_nombre is null then err('Ingresá un nombre.'); end if;
    if length(l_nombre) > 40 then err('El nombre es muy largo (máximo 40 letras).'); end if;
    if l_tipo not in ('gasto', 'ingreso') or l_tipo is null then err('Elegí si es de gastos o de ingresos.'); end if;
    if not regexp_like(l_color, '^#[0-9A-Fa-f]{6}$') then l_color := '#868E96'; end if;
    select count(*) into l_cnt from cg_categorias
     where cuenta_id = g_cuenta and tipo = l_tipo and upper(nombre) = upper(l_nombre) and id <> nvl(l_id, -1);
    if l_cnt > 0 then err('Ya existe una categoría con ese nombre.'); end if;
    if l_id is not null then
      begin
        select tipo into l_tipo0 from cg_categorias where id = l_id and cuenta_id = g_cuenta for update;
      exception
        when no_data_found then err('La categoría ya no existe.');
      end;
      if l_tipo0 <> l_tipo then
        select (select count(*) from cg_movimientos where categoria_id = l_id) + (select count(*) from cg_prestamos where categoria_id = l_id)
          into l_cnt from dual;
        if l_cnt > 0 then err('No se puede cambiar de tipo: la categoría ya tiene movimientos.'); end if;
      end if;
      update cg_categorias set nombre = l_nombre, tipo = l_tipo, color = upper(l_color) where id = l_id;
    else
      select count(*) into l_cnt from cg_categorias where cuenta_id = g_cuenta;
      if l_cnt >= 100 then err('Llegaste al máximo de 100 categorías.'); end if;
      insert into cg_categorias (cuenta_id, nombre, tipo, color) values (g_cuenta, l_nombre, l_tipo, upper(l_color))
      returning id into l_id;
    end if;
    return cat_json(l_id);
  end;

  function f_borrar_categoria(a json_object_t) return clob is
    l_id  number := a_num(a, 'id');
    l_cnt number;
  begin
    select count(*) into l_cnt from cg_movimientos where categoria_id = l_id and cuenta_id = g_cuenta;
    if l_cnt > 0 then
      err('No se puede borrar: tiene ' || l_cnt || case when l_cnt = 1 then ' movimiento.' else ' movimientos.' end);
    end if;
    select count(*) into l_cnt from cg_prestamos where categoria_id = l_id and cuenta_id = g_cuenta;
    if l_cnt > 0 then err('No se puede borrar: la usa un préstamo.'); end if;
    delete from cg_categorias where id = l_id and cuenta_id = g_cuenta;
    return 'true';
  end;

  /* ================= MOVIMIENTOS ================= */
  function f_movimientos(a json_object_t) return clob is
    l_desde date;
    l_hasta date;
    l_tipo  varchar2(20) := a_txt(a, 'tipo', 20);
    l_lim   number := 100000;
    l      clob;
  begin
    if tiene(a, 'desde') then l_desde := a_fecha(a, 'desde'); end if;
    if tiene(a, 'hasta') then l_hasta := a_fecha(a, 'hasta'); end if;
    if tiene(a, 'limite') then l_lim := a_entero(a, 'limite', 1, 100000, 'Límite inválido.'); end if;
    select json_arrayagg(json_object('id' value id, 'tipo' value tipo, 'monto' value monto, 'categoria_id' value categoria_id,
             'descripcion' value descripcion, 'fecha' value to_char(fecha, 'YYYY-MM-DD'), 'cuota_id' value cuota_id,
             'categoria' value json_object('id' value cat_id, 'nombre' value cat_nombre, 'tipo' value cat_tipo, 'color' value cat_color))
             order by fecha desc, id desc returning clob)
      into l
      from (select m.id, m.tipo, m.monto, m.categoria_id, m.descripcion, m.fecha, m.cuota_id,
                   c.id cat_id, c.nombre cat_nombre, c.tipo cat_tipo, c.color cat_color
              from cg_movimientos m join cg_categorias c on c.id = m.categoria_id
             where m.cuenta_id = g_cuenta
               and (l_desde is null or m.fecha >= l_desde)
               and (l_hasta is null or m.fecha <= l_hasta)
               and (l_tipo is null or m.tipo = l_tipo)
             order by m.fecha desc, m.id desc
             fetch first l_lim rows only);
    return nvl(l, '[]');
  end;

  function f_guardar_movimiento(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_tipo  varchar2(20) := a_txt(a, 'tipo', 20);
    l_monto number;
    l_cat   number := a_num(a, 'categoria_id');
    l_desc  varchar2(200) := a_txt(a, 'descripcion', 200);
    l_fecha date;
    l_cuota number;
  begin
    if l_tipo is null or l_tipo not in ('gasto', 'ingreso') then err('Elegí si es gasto o ingreso.'); end if;
    l_monto := a_monto(a, 'monto');
    if l_cat is null then err('Elegí una categoría.'); end if;
    if tipo_cat(l_cat) <> l_tipo then err('La categoría no corresponde al tipo de movimiento.'); end if;
    l_fecha := a_fecha(a, 'fecha');
    if length(l_desc) > 100 then err('La descripción es muy larga (máximo 100 letras).'); end if;
    if l_id is not null then
      begin
        select cuota_id into l_cuota from cg_movimientos where id = l_id and cuenta_id = g_cuenta for update;
      exception
        when no_data_found then err('El movimiento ya no existe.');
      end;
      if l_cuota is not null and l_tipo <> 'gasto' then err('Es el pago de una cuota: tiene que seguir siendo un gasto.'); end if;
      update cg_movimientos set tipo = l_tipo, monto = l_monto, categoria_id = l_cat, descripcion = l_desc, fecha = l_fecha
       where id = l_id;
      if l_cuota is not null then update cg_cuotas set pagada_el = l_fecha where id = l_cuota; end if;
    else
      insert into cg_movimientos (cuenta_id, tipo, monto, categoria_id, descripcion, fecha)
      values (g_cuenta, l_tipo, l_monto, l_cat, l_desc, l_fecha)
      returning id into l_id;
    end if;
    return mov_json(l_id);
  end;

  function f_borrar_movimiento(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_cuota number;
  begin
    begin
      select cuota_id into l_cuota from cg_movimientos where id = l_id and cuenta_id = g_cuenta for update;
    exception
      when no_data_found then err('El movimiento ya no existe.');
    end;
    if l_cuota is not null then  -- deshace el pago de la cuota
      update cg_cuotas set pagada_el = null, movimiento_id = null where id = l_cuota;
    end if;
    delete from cg_movimientos where id = l_id;
    return 'true';
  end;

  /* Totales por mes: n meses que terminan en `hasta` (AAAA-MM) */
  function f_resumen_meses(a json_object_t) return clob is
    l_hasta varchar2(20) := a_txt(a, 'hasta', 20);
    l_n     number := a_entero(a, 'n', 1, 24, 'Cantidad de meses inválida.');
    l_mes   date;
    l_ing   number;
    l_gas   number;
    arr     json_array_t := json_array_t();
    o       json_object_t;
  begin
    if l_hasta is null or not regexp_like(l_hasta, '^\d{4}-(0[1-9]|1[0-2])$') then err('Mes inválido.'); end if;
    for i in reverse 0 .. l_n - 1 loop
      l_mes := add_months(to_date(l_hasta || '-01', 'YYYY-MM-DD'), -i);
      select nvl(sum(case when tipo = 'ingreso' then monto end), 0), nvl(sum(case when tipo = 'gasto' then monto end), 0)
        into l_ing, l_gas
        from cg_movimientos
       where cuenta_id = g_cuenta and fecha >= l_mes and fecha < add_months(l_mes, 1);
      o := json_object_t();
      o.put('mes', to_char(l_mes, 'YYYY-MM'));
      o.put('ingresos', l_ing);
      o.put('gastos', l_gas);
      arr.append(o);
    end loop;
    return arr.to_clob;
  end;

  /* Lo que más se repite en los últimos 6 meses (para cargar con un toque) */
  function f_frecuentes(a json_object_t) return clob is
    l_tipo varchar2(20) := a_txt(a, 'tipo', 20);
    l_n    number := nvl(a_num(a, 'n'), 3);
    l      clob;
  begin
    if l_n not between 1 and 10 then l_n := 3; end if;
    select json_arrayagg(json_object('descripcion' value descripcion, 'monto' value monto, 'categoria_id' value categoria_id, 'veces' value veces)
             order by veces desc, ultima desc returning clob)
      into l
      from (select max(m.descripcion) descripcion, m.monto, m.categoria_id, count(*) veces, max(m.fecha) ultima
              from cg_movimientos m
             where m.cuenta_id = g_cuenta and m.tipo = l_tipo and m.cuota_id is null and m.descripcion is not null
               and m.fecha >= add_months(hoy, -6)
             group by lower(m.descripcion), m.monto, m.categoria_id
            having count(*) > 1
             order by count(*) desc, max(m.fecha) desc
             fetch first l_n rows only);
    return nvl(l, '[]');
  end;

  /* ================= AHORROS ================= */
  function f_ahorros return clob is
    l clob;
  begin
    select json_arrayagg(json_object('id' value id, 'fecha' value to_char(fecha, 'YYYY-MM-DD'), 'descripcion' value descripcion,
             'entidad' value entidad, 'tipo' value tipo, 'monto' value monto)
             order by fecha desc, id desc returning clob)
      into l from cg_ahorros where cuenta_id = g_cuenta;
    return nvl(l, '[]');
  end;

  function f_guardar_ahorro(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_tipo  varchar2(20) := a_txt(a, 'tipo', 20);
    l_monto number;
    l_ent   varchar2(200) := a_txt(a, 'entidad', 200);
    l_desc  varchar2(200) := a_txt(a, 'descripcion', 200);
    l_fecha date;
    l_saldo number;
    l_cnt   number;
  begin
    if l_tipo is null or l_tipo not in ('deposito', 'retiro') then err('Elegí depósito o retiro.'); end if;
    l_monto := a_monto(a, 'monto');
    if l_ent is null then err('Ingresá dónde está el ahorro (banco, cooperativa, alcancía…).'); end if;
    if length(l_ent) > 60 then err('El nombre de la entidad es muy largo.'); end if;
    if length(l_desc) > 100 then err('La descripción es muy larga (máximo 100 letras).'); end if;
    l_fecha := a_fecha(a, 'fecha');
    l_desc := nvl(l_desc, case l_tipo when 'deposito' then 'Ahorro' else 'Retiro' end);
    if l_tipo = 'retiro' then
      select nvl(sum(case tipo when 'deposito' then monto else -monto end), 0) into l_saldo
        from cg_ahorros where cuenta_id = g_cuenta and upper(entidad) = upper(l_ent) and id <> nvl(l_id, -1);
      if l_monto > l_saldo then err('En ' || l_ent || ' hay ' || gs(greatest(0, l_saldo)) || ': no alcanza para ese retiro.'); end if;
    end if;
    if l_id is not null then
      update cg_ahorros set fecha = l_fecha, descripcion = l_desc, entidad = l_ent, tipo = l_tipo, monto = l_monto
       where id = l_id and cuenta_id = g_cuenta;
      if sql%rowcount = 0 then err('El registro ya no existe.'); end if;
    else
      select count(*) into l_cnt from cg_ahorros where cuenta_id = g_cuenta;
      if l_cnt >= 20000 then err('Llegaste al máximo de registros de ahorro.'); end if;
      insert into cg_ahorros (cuenta_id, fecha, descripcion, entidad, tipo, monto)
      values (g_cuenta, l_fecha, l_desc, l_ent, l_tipo, l_monto) returning id into l_id;
    end if;
    return ahorro_json(l_id);
  end;

  function f_borrar_ahorro(a json_object_t) return clob is
  begin
    delete from cg_ahorros where id = a_num(a, 'id') and cuenta_id = g_cuenta;
    return 'true';
  end;

  /* ================= PRÉSTAMOS ================= */
  procedure generar_cuotas(p_id number, p_n number, p_monto number, p_inicio date) is
  begin
    for i in 1 .. p_n loop
      insert into cg_cuotas (prestamo_id, cuenta_id, numero, vence, monto)
      values (p_id, g_cuenta, i, sumar_meses(p_inicio, i - 1), p_monto);
    end loop;
  end;

  function f_prestamos return clob is
    arr json_array_t := json_array_t();
  begin
    for r in (select id from cg_prestamos where cuenta_id = g_cuenta order by id) loop
      arr.append(prestamo_obj(r.id));
    end loop;
    return arr.to_clob;
  end;

  function f_guardar_prestamo(a json_object_t) return clob is
    l_id     number := a_num(a, 'id');
    l_ent    varchar2(200) := a_txt(a, 'entidad', 200);
    l_n      number;
    l_monto  number;
    l_inicio date;
    l_cat    number := a_num(a, 'categoria_id');
    p        cg_prestamos%rowtype;
    l_pag    number;
    l_cambia boolean;
    l_cnt    number;
  begin
    if l_ent is null then err('Ingresá la entidad (banco, financiera, persona…).'); end if;
    if length(l_ent) > 60 then err('El nombre de la entidad es muy largo.'); end if;
    l_n := a_entero(a, 'cuotas', 1, 360, 'La cantidad de cuotas tiene que estar entre 1 y 360.');
    l_monto := a_monto(a, 'monto_cuota', 'Ingresá el monto de la cuota.');
    l_inicio := a_fecha(a, 'fecha_inicio', 'Ingresá la fecha de la primera cuota.');
    if l_cat is null then err('Elegí la categoría de gasto con la que se van a registrar los pagos.'); end if;
    if tipo_cat(l_cat) <> 'gasto' then err('Elegí la categoría de gasto con la que se van a registrar los pagos.'); end if;

    if l_id is not null then
      begin
        select * into p from cg_prestamos where id = l_id and cuenta_id = g_cuenta for update;
      exception
        when no_data_found then err('El préstamo ya no existe.');
      end;
      select count(*) into l_pag from cg_cuotas where prestamo_id = l_id and pagada_el is not null;
      l_cambia := l_n <> p.cuotas or l_monto <> p.monto_cuota or l_inicio <> p.fecha_inicio;
      if l_pag > 0 and l_cambia then
        err('Este préstamo ya tiene cuotas pagadas: solo se pueden cambiar la entidad y la categoría.');
      end if;
      update cg_prestamos set entidad = l_ent, cuotas = l_n, monto_cuota = l_monto, fecha_inicio = l_inicio, categoria_id = l_cat
       where id = l_id;
      if l_cambia then
        delete from cg_cuotas where prestamo_id = l_id;
        generar_cuotas(l_id, l_n, l_monto, l_inicio);
      end if;
    else
      select count(*) into l_cnt from cg_prestamos where cuenta_id = g_cuenta;
      if l_cnt >= 300 then err('Llegaste al máximo de 300 préstamos.'); end if;
      insert into cg_prestamos (cuenta_id, entidad, cuotas, monto_cuota, fecha_inicio, categoria_id)
      values (g_cuenta, l_ent, l_n, l_monto, l_inicio, l_cat) returning id into l_id;
      generar_cuotas(l_id, l_n, l_monto, l_inicio);
    end if;
    return prestamo_obj(l_id).to_clob;
  end;

  /* Borra el préstamo y sus cuotas. Los gastos ya registrados quedan (sin vínculo). */
  function f_borrar_prestamo(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
  begin
    update cg_movimientos set cuota_id = null
     where cuenta_id = g_cuenta and cuota_id in (select id from cg_cuotas where prestamo_id = l_id);
    delete from cg_prestamos where id = l_id and cuenta_id = g_cuenta;
    if sql%rowcount = 0 then err('El préstamo ya no existe.'); end if;
    return 'true';
  end;

  function f_cuotas(a json_object_t) return clob is
    l_id number := a_num(a, 'prestamo_id');
    l    clob;
  begin
    select json_arrayagg(json_object('id' value id, 'prestamo_id' value prestamo_id, 'numero' value numero,
             'vence' value to_char(vence, 'YYYY-MM-DD'), 'monto' value monto,
             'pagada_el' value to_char(pagada_el, 'YYYY-MM-DD'), 'movimiento_id' value movimiento_id)
             order by numero returning clob)
      into l from cg_cuotas where prestamo_id = l_id and cuenta_id = g_cuenta;
    return nvl(l, '[]');
  end;

  /* Marca la cuota como pagada y registra el gasto */
  function f_pagar_cuota(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_fecha date;
    c       cg_cuotas%rowtype;
    p       cg_prestamos%rowtype;
    l_mov   number;
  begin
    l_fecha := case when tiene(a, 'fecha') then a_fecha(a, 'fecha', 'Ingresá la fecha de pago.') else hoy end;
    if l_fecha > hoy then err('La fecha de pago no puede ser futura.'); end if;
    begin
      select * into c from cg_cuotas where id = l_id and cuenta_id = g_cuenta for update;
    exception
      when no_data_found then err('La cuota ya no existe.');
    end;
    if c.pagada_el is not null then err('Esa cuota ya está pagada.'); end if;
    select * into p from cg_prestamos where id = c.prestamo_id;
    insert into cg_movimientos (cuenta_id, tipo, monto, categoria_id, descripcion, fecha, cuota_id)
    values (g_cuenta, 'gasto', c.monto, p.categoria_id, substr('Cuota ' || c.numero || ' · ' || p.entidad, 1, 100), l_fecha, c.id)
    returning id into l_mov;
    update cg_cuotas set pagada_el = l_fecha, movimiento_id = l_mov where id = l_id;
    return cuota_json(l_id);
  end;

  /* Desmarca el pago y borra el gasto que se había registrado */
  function f_desmarcar_cuota(a json_object_t) return clob is
    l_id number := a_num(a, 'id');
    c    cg_cuotas%rowtype;
  begin
    begin
      select * into c from cg_cuotas where id = l_id and cuenta_id = g_cuenta for update;
    exception
      when no_data_found then err('La cuota ya no existe.');
    end;
    if c.pagada_el is null then err('Esa cuota no está pagada.'); end if;
    update cg_cuotas set pagada_el = null, movimiento_id = null where id = l_id;
    if c.movimiento_id is not null then delete from cg_movimientos where id = c.movimiento_id and cuenta_id = g_cuenta; end if;
    return cuota_json(l_id);
  end;

  /* Cambia monto o vencimiento de una cuota pendiente */
  function f_guardar_cuota(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_monto number := a_monto(a, 'monto');
    l_vence date := a_fecha(a, 'vence');
    c       cg_cuotas%rowtype;
  begin
    begin
      select * into c from cg_cuotas where id = l_id and cuenta_id = g_cuenta for update;
    exception
      when no_data_found then err('La cuota ya no existe.');
    end;
    if c.pagada_el is not null then err('La cuota ya está pagada: desmarcala primero para cambiarla.'); end if;
    update cg_cuotas set monto = l_monto, vence = l_vence where id = l_id;
    return cuota_json(l_id);
  end;

  /* ================= SUPERADMIN ================= */
  function f_super_login(a json_object_t) return clob is
    l_email varchar2(200) := lower(a_txt(a, 'email', 200));
    l_clave varchar2(200);
    r       cg_superadmins%rowtype;
  begin
    if tiene(a, 'password') then l_clave := a.get_string('password'); end if;
    begin
      select * into r from cg_superadmins where email = l_email for update;
    exception
      when no_data_found then err('Email o contraseña incorrectos.');
    end;
    if r.bloqueado_hasta > systimestamp then err('Demasiados intentos. Probá de nuevo en 15 minutos.'); end if;
    if hash_clave(l_clave, r.clave_sal) <> r.clave_hash then
      update cg_superadmins
         set intentos        = case when intentos + 1 >= 5 then 0 else intentos + 1 end,
             bloqueado_hasta = case when intentos + 1 >= 5 then systimestamp + interval '15' minute end
       where id = r.id;
      commit;
      err('Email o contraseña incorrectos.');
    end if;
    update cg_superadmins set intentos = 0, bloqueado_hasta = null where id = r.id;
    return '{"token":"' || nuevo_token('super', null, r.id) || '"}';
  end;

  function f_super_cuentas return clob is
    arr json_array_t := json_array_t();
  begin
    for r in (select id from cg_cuentas order by upper(nombre)) loop
      arr.append(cuenta_obj(r.id, true));
    end loop;
    return arr.to_clob;
  end;

  function whatsapp_ok(p varchar2) return varchar2 is
    v varchar2(40) := regexp_replace(p, '[^0-9]');
  begin
    if v is not null and length(v) not between 8 and 15 then err('El WhatsApp no parece un número válido.'); end if;
    return v;
  end;

  function f_super_crear_cuenta(a json_object_t) return clob is
    l_nombre varchar2(200) := a_txt(a, 'nombre', 200);
    l_email  varchar2(120);
    l_vence  date;
    l_precio number := c_precio;
    l_cnt    number;
    l_id     number;
    l_clave  varchar2(10) := clave_temporal;
    l_sal    raw(16) := dbms_crypto.randombytes(16);
    o        json_object_t;
  begin
    if l_nombre is null or length(l_nombre) < 2 then err('Ingresá el nombre del cliente.'); end if;
    if length(l_nombre) > 60 then err('El nombre es muy largo.'); end if;
    l_email := validar_email(a_txt(a, 'email', 200));
    select count(*) into l_cnt from cg_cuentas where email = l_email;
    if l_cnt > 0 then err('Ya hay una cuenta con ese email.'); end if;
    if tiene(a, 'vence_el') then l_vence := a_fecha(a, 'vence_el'); end if;
    if tiene(a, 'precio') then
      l_precio := a_entero(a, 'precio', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    end if;
    insert into cg_cuentas (nombre, email, clave_hash, clave_sal, debe_cambiar, whatsapp, notas, vence_el, precio)
    values (l_nombre, l_email, hash_clave(l_clave, l_sal), l_sal, 1, whatsapp_ok(a_txt(a, 'whatsapp', 40)),
            a_txt(a, 'notas', 500), l_vence, l_precio)
    returning id into l_id;
    categorias_base(l_id);
    o := cuenta_obj(l_id, true);
    o.put('clave_temporal', l_clave);
    return o.to_clob;
  end;

  function f_super_guardar_cuenta(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    c       json_object_t;
    r       cg_cuentas%rowtype;
    l_cnt   number;
    l_mail0 varchar2(120);
  begin
    if not tiene(a, 'cambios') or not a.get('cambios').is_object then err('Datos inválidos.'); end if;
    c := a.get_object('cambios');
    begin
      select * into r from cg_cuentas where id = l_id for update;
    exception
      when no_data_found then err('Cuenta no encontrada.');
    end;
    l_mail0 := r.email;
    if c.has('nombre') then
      r.nombre := a_txt(c, 'nombre', 200);
      if r.nombre is null or length(r.nombre) < 2 then err('Ingresá el nombre del cliente.'); end if;
      if length(r.nombre) > 60 then err('El nombre es muy largo.'); end if;
    end if;
    if c.has('email') then
      r.email := validar_email(a_txt(c, 'email', 200));
      select count(*) into l_cnt from cg_cuentas where email = r.email and id <> l_id;
      if l_cnt > 0 then err('Ya hay una cuenta con ese email.'); end if;
    end if;
    if c.has('whatsapp') then r.whatsapp := whatsapp_ok(a_txt(c, 'whatsapp', 40)); end if;
    if c.has('notas') then r.notas := a_txt(c, 'notas', 500); end if;
    if c.has('vence_el') then r.vence_el := case when tiene(c, 'vence_el') then a_fecha(c, 'vence_el') end; end if;
    if c.has('activo') then r.activo := nvl(a_bool(c, 'activo'), 1); end if;
    if c.has('precio') then
      r.precio := a_entero(c, 'precio', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    end if;
    update cg_cuentas
       set nombre = r.nombre, email = r.email, whatsapp = r.whatsapp, notas = r.notas,
           vence_el = r.vence_el, activo = r.activo, precio = r.precio
     where id = l_id;
    if r.email <> l_mail0 then delete from cg_sesiones where cuenta_id = l_id; end if;
    return cuenta_obj(l_id, true).to_clob;
  end;

  function f_super_reset_clave(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_clave varchar2(10) := clave_temporal;
    l_sal   raw(16) := dbms_crypto.randombytes(16);
  begin
    update cg_cuentas set clave_hash = hash_clave(l_clave, l_sal), clave_sal = l_sal, debe_cambiar = 1, intentos = 0, bloqueado_hasta = null
     where id = l_id;
    if sql%rowcount = 0 then err('Cuenta no encontrada.'); end if;
    delete from cg_sesiones where cuenta_id = l_id;
    return '{"clave":"' || l_clave || '"}';
  end;

  /* Borra la cuenta y TODOS sus datos. Pide el email como confirmación. */
  function f_super_borrar_cuenta(a json_object_t) return clob is
    l_id    number := a_num(a, 'id');
    l_email varchar2(120);
  begin
    begin
      select email into l_email from cg_cuentas where id = l_id for update;
    exception
      when no_data_found then err('Cuenta no encontrada.');
    end;
    if lower(a_txt(a, 'confirmar', 200)) is null or lower(a_txt(a, 'confirmar', 200)) <> l_email then
      err('Para borrar, escribí el email de la cuenta exactamente.');
    end if;
    -- primero se cortan los vínculos cuota ↔ movimiento para que la cascada no tropiece
    update cg_cuotas set movimiento_id = null where cuenta_id = l_id;
    update cg_movimientos set cuota_id = null where cuenta_id = l_id;
    delete from cg_movimientos where cuenta_id = l_id;
    delete from cg_prestamos where cuenta_id = l_id;
    delete from cg_cuentas where id = l_id;
    return 'true';
  end;

  function f_super_registrar_pago(a json_object_t) return clob is
    l_id     number := a_num(a, 'id');
    l_monto  number := a_entero(a, 'monto', 0, 100000000, 'Ingresá un monto válido en guaraníes (sin puntos ni decimales).');
    l_meses  number := a_entero(a, 'meses', 1, 24, 'Elegí cuántos meses paga.');
    l_fecha  date;
    l_desde  date;
    l_hasta  date;
    l_vence  date;
    l_pid    number;
    p        json_object_t := json_object_t();
    o        json_object_t := json_object_t();
  begin
    l_fecha := case when tiene(a, 'fecha') then a_fecha(a, 'fecha') else hoy end;
    if l_fecha > hoy then err('La fecha del pago no puede ser futura.'); end if;
    begin
      select vence_el into l_vence from cg_cuentas where id = l_id for update;
    exception
      when no_data_found then err('Cuenta no encontrada.');
    end;
    l_desde := case when l_vence is null or l_vence < hoy then hoy else l_vence end;
    l_hasta := sumar_meses(l_desde, l_meses);
    insert into cg_pagos (cuenta_id, fecha, monto, meses, desde, hasta)
    values (l_id, l_fecha, l_monto, l_meses, l_desde, l_hasta)
    returning id into l_pid;
    update cg_cuentas set vence_el = l_hasta, activo = 1 where id = l_id;

    p.put('id', l_pid); p.put('cuenta_id', l_id); p.put('fecha', iso(l_fecha)); p.put('monto', l_monto);
    p.put('meses', l_meses); p.put('desde', iso(l_desde)); p.put('hasta', iso(l_hasta));
    o.put('pago', p);
    o.put('cuenta', cuenta_obj(l_id, true));
    return o.to_clob;
  end;

  function f_super_pagos return clob is
    l clob;
  begin
    select json_arrayagg(json_object(
             'id' value p.id, 'cuenta_id' value p.cuenta_id, 'cliente' value c.nombre,
             'fecha' value to_char(p.fecha, 'YYYY-MM-DD'), 'monto' value p.monto, 'meses' value p.meses,
             'desde' value to_char(p.desde, 'YYYY-MM-DD'), 'hasta' value to_char(p.hasta, 'YYYY-MM-DD'))
             order by p.fecha desc, p.id desc returning clob)
      into l
      from cg_pagos p
      join cg_cuentas c on c.id = p.cuenta_id;
    return nvl(l, '[]');
  end;

  function f_super_eliminar_pago(a json_object_t) return clob is
  begin
    delete from cg_pagos where id = a_num(a, 'id');
    if sql%rowcount = 0 then err('Pago no encontrado.'); end if;
    return 'null';
  end;

  /* ================= ENTRADA ÚNICA ================= */
  function rpc(p_body in clob) return clob is
    req    json_object_t;
    a      json_object_t;
    fn     varchar2(40);
    tok    varchar2(100);
    l_data clob;
    res    json_object_t;
  begin
    -- ORDS reutiliza las conexiones: nada de la llamada anterior puede quedar cargado
    g_cuenta := null; g_super := null; g_tok_hash := null;
    begin
      req := json_object_t.parse(p_body);
    exception
      when others then err('Pedido inválido.');
    end;
    fn  := substr(req.get_string('fn'), 1, 40);
    tok := substr(req.get_string('token'), 1, 100);
    if tiene(req, 'args') and req.get('args').is_object then a := req.get_object('args'); else a := json_object_t(); end if;

    if fn in ('mi_cuenta', 'cambiar_clave', 'aceptar_terminos',
              'categorias', 'guardar_categoria', 'borrar_categoria',
              'movimientos', 'movimiento', 'guardar_movimiento', 'borrar_movimiento', 'resumen_meses', 'frecuentes',
              'ahorros', 'guardar_ahorro', 'borrar_ahorro',
              'prestamos', 'prestamo', 'guardar_prestamo', 'borrar_prestamo',
              'cuotas', 'pagar_cuota', 'desmarcar_cuota', 'guardar_cuota') then
      cargar_sesion(tok, 'cuenta');
      if fn not in ('mi_cuenta', 'cambiar_clave') then exigir_clave_propia; end if;
      if fn not in ('mi_cuenta', 'cambiar_clave', 'aceptar_terminos') then exigir_terminos; end if;
      if fn in ('guardar_categoria', 'borrar_categoria', 'guardar_movimiento', 'borrar_movimiento',
                'guardar_ahorro', 'borrar_ahorro', 'guardar_prestamo', 'borrar_prestamo',
                'pagar_cuota', 'desmarcar_cuota', 'guardar_cuota') then
        exigir_escritura;
      end if;
    elsif fn like 'super%' and fn <> 'super_login' then
      cargar_sesion(tok, 'super');
    end if;

    if    fn = 'login'                  then l_data := f_login(a);
    elsif fn = 'logout'                 then cerrar_sesion(tok); l_data := 'null';
    elsif fn = 'mi_cuenta'              then l_data := f_mi_cuenta;
    elsif fn = 'cambiar_clave'          then l_data := f_cambiar_clave(a);
    elsif fn = 'aceptar_terminos'       then l_data := f_aceptar_terminos;
    elsif fn = 'categorias'             then l_data := f_categorias;
    elsif fn = 'guardar_categoria'      then l_data := f_guardar_categoria(a);
    elsif fn = 'borrar_categoria'       then l_data := f_borrar_categoria(a);
    elsif fn = 'movimientos'            then l_data := f_movimientos(a);
    elsif fn = 'movimiento'             then l_data := mov_json(a_num(a, 'id'));
    elsif fn = 'guardar_movimiento'     then l_data := f_guardar_movimiento(a);
    elsif fn = 'borrar_movimiento'      then l_data := f_borrar_movimiento(a);
    elsif fn = 'resumen_meses'          then l_data := f_resumen_meses(a);
    elsif fn = 'frecuentes'             then l_data := f_frecuentes(a);
    elsif fn = 'ahorros'                then l_data := f_ahorros;
    elsif fn = 'guardar_ahorro'         then l_data := f_guardar_ahorro(a);
    elsif fn = 'borrar_ahorro'          then l_data := f_borrar_ahorro(a);
    elsif fn = 'prestamos'              then l_data := f_prestamos;
    elsif fn = 'prestamo'               then l_data := prestamo_obj(a_num(a, 'id')).to_clob;
    elsif fn = 'guardar_prestamo'       then l_data := f_guardar_prestamo(a);
    elsif fn = 'borrar_prestamo'        then l_data := f_borrar_prestamo(a);
    elsif fn = 'cuotas'                 then l_data := f_cuotas(a);
    elsif fn = 'pagar_cuota'            then l_data := f_pagar_cuota(a);
    elsif fn = 'desmarcar_cuota'        then l_data := f_desmarcar_cuota(a);
    elsif fn = 'guardar_cuota'          then l_data := f_guardar_cuota(a);
    elsif fn = 'super_login'            then l_data := f_super_login(a);
    elsif fn = 'super_logout'           then cerrar_sesion(tok); l_data := 'null';
    elsif fn = 'super_ping'             then l_data := 'true';
    elsif fn = 'super_cuentas'          then l_data := f_super_cuentas;
    elsif fn = 'super_crear_cuenta'     then l_data := f_super_crear_cuenta(a);
    elsif fn = 'super_guardar_cuenta'   then l_data := f_super_guardar_cuenta(a);
    elsif fn = 'super_reset_clave'      then l_data := f_super_reset_clave(a);
    elsif fn = 'super_borrar_cuenta'    then l_data := f_super_borrar_cuenta(a);
    elsif fn = 'super_registrar_pago'   then l_data := f_super_registrar_pago(a);
    elsif fn = 'super_pagos'            then l_data := f_super_pagos;
    elsif fn = 'super_eliminar_pago'    then l_data := f_super_eliminar_pago(a);
    else err('Función desconocida.');
    end if;

    commit;
    return '{"ok":true,"data":' || nvl(l_data, 'null') || '}';
  exception
    when others then
      declare
        l_code number         := sqlcode;
        l_msg  varchar2(4000) := sqlerrm;
        l_pila varchar2(4000) := dbms_utility.format_error_backtrace;
      begin
        rollback;
        res := json_object_t();
        res.put('ok', false);
        if l_code = -20002 then
          res.put('sesion', false);
          res.put('error', 'Tu sesión terminó. Volvé a ingresar.');
        elsif l_code = -20001 then
          res.put('error', regexp_replace(regexp_substr(l_msg, '^[^' || chr(10) || ']*'), '^ORA-20001: '));
        elsif l_code = -1 then
          res.put('error', 'Ese dato ya existe. Revisá que no esté repetido.');
        else
          log_error(fn, l_msg, l_pila);
          res.put('error', 'Ocurrió un error en el servidor. Probá de nuevo en un momento.');
        end if;
        return res.to_clob;
      end;
  end rpc;

  /* ================= MANTENIMIENTO ================= */
  procedure crear_superadmin(p_email in varchar2, p_clave in varchar2) is
    l_email varchar2(120) := lower(trim(p_email));
    l_sal   raw(16) := dbms_crypto.randombytes(16);
    l_hash  raw(32);
  begin
    if l_email is null or not regexp_like(l_email, '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise_application_error(-20001, 'Email inválido');
    end if;
    validar_clave(p_clave);
    l_hash := hash_clave(p_clave, l_sal);
    merge into cg_superadmins s
    using (select l_email email from dual) x
       on (s.email = x.email)
     when matched then update set clave_hash = l_hash, clave_sal = l_sal, intentos = 0, bloqueado_hasta = null
     when not matched then insert (email, clave_hash, clave_sal) values (l_email, l_hash, l_sal);
  end;

end cg_api;
/
