/* ============================================================
   01 · Correr como ADMIN (Database Actions → SQL, usuario ADMIN)
   Crea el esquema GASTOS en la misma base de Turnos Barber,
   le da permisos y lo publica en ORDS.
   >>> Cambiá la contraseña antes de correrlo. <<<
   ============================================================ */

create user gastos identified by "CambiaEstaClave#2026";

grant create session, create table, create sequence, create procedure, create view to gastos;
alter user gastos quota unlimited on data;

-- Contraseñas encriptadas y tokens de sesión
grant execute on dbms_crypto to gastos;

-- Publicar el esquema en ORDS: la API queda en  https://<tu-host>/ords/gastos/...
begin
  ords_admin.enable_schema(
    p_enabled             => true,
    p_schema              => 'GASTOS',
    p_url_mapping_type    => 'BASE_PATH',
    p_url_mapping_pattern => 'gastos',
    p_auto_rest_auth      => true   -- nada se publica solo: únicamente lo que define 04_ords.sql
  );
  commit;
end;
/
