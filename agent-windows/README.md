# Agente de Windows (Fase 3) — especificación

El cerebro central **ya implementa** el lado servidor de este protocolo
(`server/src/devices/deviceHub.ts`, probado en `server/test/devices.test.ts`). En la Fase 3
se construirá aquí el agente (Node.js + TypeScript, ejecutándose en segundo plano en la
bandeja del sistema).

## Vinculación

1. En ATLAS → **Equipos → Vincular dispositivo** se genera un token `atlasdev_…` (se muestra una vez).
2. El agente guarda el token de forma protegida (Windows DPAPI / Credential Manager).
3. El token se puede revocar en cualquier momento; el agente queda desconectado al instante.

## Conexión

```
WebSocket  wss://<servidor>/ws/agent
Cabecera   Authorization: Bearer atlasdev_…
```

Sin token válido el servidor cierra con código `4401`. Revocado: `4001`.

## Mensajes del agente → servidor

```jsonc
{ "type": "hello", "version": "0.1.0", "hostname": "OFICINA-PC" }
{ "type": "heartbeat" }                                   // cada ≤ 30 s (a los 60 s sin latido = desconectado)
{ "type": "status", "state": "online" | "busy" | "error", "task": "Abriendo Excel", "error": null }
{ "type": "result", "commandId": "<uuid>", "ok": true, "output": { ... }, "error": "..." }
```

## Mensajes del servidor → agente

```jsonc
{ "type": "command", "id": "<uuid>", "action": "open_app", "params": { "app": "excel" } }
{ "type": "stop", "reason": "emergency" }   // detener TODO de inmediato
```

## Reglas de seguridad del agente

- Sólo ejecuta acciones de una **lista blanca** (`open_app`, `list_files`, `read_file`,
  `screenshot`…); cualquier otra se rechaza.
- Rutas limitadas a carpetas autorizadas por el usuario (p. ej. Escritorio, Documentos).
- Las acciones sensibles ya llegan aprobadas por el usuario desde el servidor; aun así el
  agente puede exigir confirmación local para las más delicadas.
- Botón local “Detener todo” y atajo de teclado global.
- Todo resultado que contenga contenido de archivos o pantalla se marca como **no confiable**
  en el servidor antes de entregárselo a la IA.
