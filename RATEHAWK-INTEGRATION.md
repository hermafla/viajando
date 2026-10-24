# Integración directa con RateHawk

RateHawk se implementa como proveedor separado de Nuitee. Ninguna ruta `nuitee-*` se modifica.

## Estado de preparación

- La búsqueda Sandbox de certificación usa los hoteles `10004834` y `8819557`.
- El endpoint `/api/ratehawk-sandbox-search` solo apunta a `api-sandbox.ratehawk.com`; no puede operar en producción.
- La búsqueda requiere las claves del entorno Sandbox guardadas como secretos del servidor:
  - `RATEHAWK_SANDBOX_KEY_ID`
  - `RATEHAWK_SANDBOX_API_KEY`
- El cuerpo de búsqueda admite varios cuartos y edades de menores para los escenarios de certificación.
- No se incluye una reserva simulada ni se exponen respuestas de debug del proveedor.

## API preparada

`POST /api/ratehawk-sandbox-search`

```json
{
  "checkin": "2027-01-10",
  "checkout": "2027-01-12",
  "residency": "ar",
  "guests": [
    { "adults": 2, "children": [] }
  ]
}
```

Si no se indica `hids`, consulta ambos hoteles de certificación. También se permite elegir uno de esos dos IDs explícitamente. No admite el hotel `8473727`, que pertenece al entorno Test y requiere credenciales diferentes.

## Siguiente etapa, al recibir las claves Sandbox

1. Configurarlas solo en Vercel Preview/Development.
2. Ejecutar la búsqueda de tarifas y confirmar la respuesta de ambos HIDs.
3. Implementar y conectar hotelpage, prebook, create/start booking, booking status y cancelación.
4. Hacer visibles los hoteles de certificación mediante el flujo normal de Valijeando y grabar el recorrido requerido.
5. Revisar con RateHawk la lista de IPs de salida de Vercel para su whitelist.

## Prueba local

```sh
node --test tests/ratehawk-sandbox.test.mjs
```

Las pruebas validan el contrato local y simulan la respuesta HTTP; no acreditan acceso real al Sandbox.
