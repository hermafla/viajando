# Consola privada de Valijeando

Página: `/consola.html`. Consulta las reservas de alojamiento de Supabase, con búsqueda por email, nombre, apellido, hotel o código; filtros de entorno, estado y fecha de entrada; páginas de 25 registros; detalle y descarga CSV de la página visible. Los totales monetarios corresponden a importes registrados, no a comisiones ni cobros acreditados.

## Acceso

El administrador inicial es `hola@valijeando.com.ar`. Puede cambiarse la lista permitida con `VALIJEANDO_ADMIN_EMAILS` en el servidor (emails separados por comas). Los cambios se verifican en cada consulta. Un usuario de Mi cuenta no obtiene acceso de administración, incluso si usa el mismo email.

El ingreso usa un código independiente de 12 dígitos, válido durante 10 minutos y consumido atómicamente. La sesión se conserva durante dos horas en una cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`. Nunca se devuelve un token de administración a JavaScript ni se guarda en localStorage. `ADMIN_CONSOLE_SECRET` permite una clave de firma independiente; en su ausencia se usa `MI_CUENTA_SECRET` o la clave privada del servidor.

La tabla existente `codigos_acceso` se reutiliza. Solicitar un nuevo código para el mismo email reemplaza el anterior, también entre Mi cuenta y la consola. Existe un intervalo mínimo de un minuto entre envíos basado en el vencimiento almacenado. El código de administración tiene un HMAC con un ámbito diferente del código de cliente. Cerrar sesión elimina la cookie local; cambiar el secreto invalida todas las sesiones, y retirar un email de la lista permitida revoca su acceso.

La API se integra en `/api/account-request-code?console=1` para conservar el número actual de funciones de Vercel. Todas las consultas exigen sesión de administrador. Los POST exigen el mismo origen HTTPS. Los filtros y límites se aplican en el servidor, las claves privadas permanecen en Vercel, y no se entregan transacciones, secretos de pago ni respuestas completas del proveedor al navegador.

## Alcance

Esta versión es de consulta: no cancela, borra ni modifica reservas o pagos. El detalle distingue reserva confirmada de acreditación registrada, y las pruebas de las reservas reales. Un correo marcado como enviado indica aceptación por el servicio de envío, no prueba de entrega en la bandeja del destinatario. Registros antiguos sin entorno o correo se muestran como datos sin registrar, sin deducir estados.

La descarga CSV incluye exclusivamente los 25 registros visibles y neutraliza prefijos de fórmulas para hojas de cálculo. La consola no aparece en el menú público y tiene `noindex`; su privacidad depende del control de acceso de servidor, no del nombre de la URL.

Verificación automatizada: `node --test tests/*.test.mjs`. Incluye rechazo de tokens de cliente, firmas inválidas, sesiones vencidas, operadores no autorizados, POST de otro origen, códigos usados simultáneamente y filtros paginados.
