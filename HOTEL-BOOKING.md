# Reservas de hoteles en Valijeando

El sitio utiliza Nuitee LiteAPI. Las ventas reales permanecen deshabilitadas por defecto.

## Habilitación pendiente

1. Ejecutar `db/hotel-checkouts.sql` en el proyecto Supabase del sitio. La tabla conserva el par prebook/transacción, los datos del huésped y el resultado del proveedor antes de enviar una confirmación. Su acceso queda limitado al servidor con service_role.
2. Mantener `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `RESEND_API_KEY` correctamente configuradas en Vercel. Los mensajes se envían desde reservas@valijeando.com.ar y las respuestas van a hola@valijeando.com.ar.
3. Probar el SDK con una clave sandbox. En POST `/api/nuitee-prebook` se puede solicitar `usePaymentSdk:true` junto con `reservation` (hotelId, hotelName, checkin, checkout, occupancies, roomName, boardName). El acceso al SDK se rechaza si la tabla no está disponible; la ruta sandbox existente sigue funcionando sin SDK.
4. Obtener y configurar la clave de producción de Nuitee por un canal seguro. Nunca publicar claves en GitHub ni incorporarlas al HTML.
5. Solo después de validar el pago SDK de prueba, configurar `NUITEE_LIVE_BOOKING_ENABLED=true`. Una clave de producción sin ese indicador no habilita reservas. El SDK de producción utiliza `live` y el sandbox utiliza `sandbox`.

## Circuito SDK

Prebook valida la tarifa y guarda precio, ocupación, prebookId y transactionId en el servidor. Solo entonces entrega al navegador el client secret del formulario de pago. El secret no se incluye en URLs ni se guarda en la tabla.

Antes de abrir el formulario, `/api/hotel-checkout` guarda responsable y huéspedes. Al volver del pago, `/api/nuitee-book` usa un token firmado para recuperar los datos del servidor y envía `TRANSACTION_ID` al proveedor. El parámetro de retorno del navegador no demuestra que haya un pago: Nuitee comprueba la transacción al confirmar.

Una actualización condicional reclama el checkout antes de Book. Las repeticiones consultan el estado o la confirmación guardada. Ante un resultado incierto se busca la reserva por clientReference; no se vuelve a cobrar ni a enviar Book. Si el guardado posterior falla, queda el resultado del proveedor para recuperar la reserva. El correo tiene una clave de idempotencia independiente.

La bandera `pagado` no se infiere a partir de una redirección del navegador. La validación de captura, conciliación y liquidación real sigue pendiente de la prueba con la cuenta de producción.

## Verificación

`node --test tests/*.test.mjs`

Las pruebas de producción usan respuestas simuladas: no prueban un cobro real ni habilitan la cuenta comercial. Sandbox siempre identifica la reserva como prueba en la confirmación y en el correo. Las reservas nuevas de sandbox se identifican también en Mi cuenta.

Documentación primaria:
- https://docs.liteapi.travel/docs/user-payment
- https://docs.liteapi.travel/reference/post_rates-book
- https://docs.liteapi.travel/docs/hotel-integration-guide
- https://docs.liteapi.travel/docs/revenue-management-and-commission
