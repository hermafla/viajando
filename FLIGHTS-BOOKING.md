# Reservas de vuelos en Viaje completo

## Flujo

1. El cliente selecciona alojamiento y vuelo.
2. Completa contacto y datos requeridos por la aerolínea.
3. Vercel crea el prebook de vuelo con Nuitee y muestra el pago seguro del SDK de LiteAPI.
4. Tras el pago, Vercel confirma el vuelo con el mismo `prebookId` y `transactionId`; la API del proveedor es idempotente para esa confirmación.
5. Recién entonces se reconfirma el hotel y se abre el checkout hotelero existente.
6. El vuelo y el alojamiento se cobran en dos operaciones y se guardan como reservas separadas. Mi cuenta las lista juntas.

No se inicia ningún prebook de vuelo hasta que la persona completa los datos de pasajeros. No se inventa un contador: la pantalla muestra una fecha límite solo cuando Nuitee la devuelve en `reservationExpiresAt` o `expiresAt`.

## Activación por entorno

La reserva de vuelos está bloqueada por defecto, aun cuando la búsqueda de vuelos funcione. Antes de habilitarla, LiteAPI/Nuitee debe confirmar que Flights y el SDK de pago están concedidos para la clave de ese entorno.

- Preview/sandbox: configurar `NUITEE_FLIGHTS_SANDBOX_API_KEY` y, después de probar el flujo con datos de prueba, `NUITEE_SANDBOX_FLIGHTS_BOOKING_ENABLED=true`.
- Producción: solo después de la habilitación escrita del proveedor, configurar `NUITEE_FLIGHTS_BOOKING_ENABLED=true`.
- Los dos valores de activación son independientes. La llave sandbox no habilita producción.

El pago usa el SDK de LiteAPI con `usePaymentSdk: true`; el backend nunca recibe los datos de tarjeta.

## Persistencia

Ejecutar `db/flight-checkouts.sql` en Supabase antes de desplegar el checkout. La migración crea `flight_checkouts` para estados transitorios del prebook y `reservas_vuelos` para el historial de Mi cuenta. Ambas tablas tienen RLS habilitado, revocan acceso de `anon` y `authenticated`, y permiten acceso solo a `service_role` desde Vercel.

No se guardan números de documento en Supabase. Se envían a Nuitee al crear el prebook y permanecen únicamente en el navegador mientras se completa el flujo. El proveedor conserva el manifiesto de pasajeros en la reserva confirmada.

## Errores inciertos

Si el pago se completó pero Vercel no puede verificar la respuesta del proveedor, la página indica no volver a pagar. La reserva queda en estado incierto para conciliación. No se inicia automáticamente un segundo pago.
