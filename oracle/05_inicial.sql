/* ============================================================
   05 · Correr como GASTOS
   Tu usuario de superadmin (con este entrás a superadmin.html).
   >>> Cambiá el email y la contraseña (mínimo 8 caracteres). <<<
   Si te olvidás la contraseña, volvé a correr esto con una nueva.
   ============================================================ */

begin
  cg_api.crear_superadmin('tu-email@ejemplo.com', 'UnaClaveLarga2026');
  commit;
end;
/

/* Prueba rápida: en la salida tiene que aparecer
   {"ok":false,"error":"Email o contraseña incorrectos."} */
set serveroutput on
begin
  dbms_output.put_line(cg_api.rpc('{"fn":"login","args":{"email":"nadie@ejemplo.com","password":"x"}}'));
end;
/

/* Si algo no compiló: */
-- select name, line, text from user_errors order by name, sequence;
