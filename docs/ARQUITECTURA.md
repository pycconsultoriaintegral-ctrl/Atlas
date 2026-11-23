# Arquitectura de ATLAS

## Idea central

Un solo **cerebro central** (servidor) concentra la IA, la memoria, las herramientas, la
seguridad y el estado de los dispositivos. Todas las interfaces son “ventanas” a ese mismo
cerebro, por eso la memoria y las conversaciones son las mismas en el iPhone y en el PC.

```
┌──────────────┐   HTTPS + cookie de sesión   ┌───────────────────────────────────────┐
│ iPhone (PWA) │ ───────────────────────────► │            CEREBRO CENTRAL             │
├──────────────┤                              │  Fastify (Node.js + TypeScript)        │
│ Navegador PC │ ───────────────────────────► │                                        │
└──────────────┘   SSE (respuesta en vivo)    │  ├─ Autenticación y sesiones           │
                                              │  ├─ Orquestador de conversación ─────┐ │
┌──────────────┐   WebSocket + token propio   │  ├─ Registro de herramientas        │ │──► Anthropic Claude
│ Agente Win.  │ ◄──────────────────────────► │  │    (permisos + confirmación)     │ │    (otros proveedores
│  (Fase 3)    │   órdenes / estado / parada  │  ├─ Memoria · proyectos · tareas    │ │     en el futuro)
└──────────────┘                              │  ├─ Hub de dispositivos             │ │
                                              │  └─ Registro de operaciones         │ │
                                              │            SQLite (data/atlas.db)    │ │
                                              └───────────────────────────────────────┘
```

## Componentes

| Carpeta | Qué contiene |
|---|---|
| `server/src/ai/` | Proveedores de IA (`anthropicProvider.ts`, `mockProvider.ts`), registro de proveedores e instrucciones de sistema (`prompts.ts`). |
| `server/src/chat/` | Orquestador (bucle IA → herramientas → IA), conversaciones, acciones pendientes de confirmación, respuestas en curso. |
| `server/src/tools/` | Sistema modular de herramientas. Cada módulo es un archivo en `builtin/`. |
| `server/src/memory/`, `tasks/` | Memoria (con búsqueda de texto completo), proyectos y tareas. |
| `server/src/devices/` | Hub de dispositivos: vinculación por token, estado en vivo, envío de órdenes, parada de emergencia. |
| `server/src/auth/`, `http/` | Contraseñas (scrypt), sesiones, rutas de la API, streaming. |
| `server/src/security/` | Ocultación de secretos y envoltorio de contenido no confiable. |
| `web/` | Interfaz React + TypeScript (PWA). |
| `agent-windows/` | Especificación del agente de Windows (Fase 3). |

## Decisiones importantes (explicadas de forma sencilla)

1. **Node.js + TypeScript en todo el proyecto.** Un solo lenguaje para servidor, interfaz y
   el futuro agente de Windows: menos piezas, más fácil de mantener. TypeScript detecta
   errores antes de ejecutar.
2. **Base de datos SQLite integrada en Node.js.** Un único archivo (`data/atlas.db`), sin
   instalar nada ni pagar nada. Las consultas están aisladas en módulos “Repo” para poder
   migrar a PostgreSQL si ATLAS pasa a un servidor en la nube.
3. **PWA en lugar de app nativa.** Se instala desde Safari, se ve a pantalla completa y no
   requiere la App Store ni una cuenta de desarrollador de Apple (USD 99/año).
4. **Respuestas en streaming (SSE).** Ves a ATLAS escribir en tiempo real y puedes detenerlo
   en cualquier momento; al detener, el servidor corta también la llamada a la IA.
5. **Historial “sólo-agregar”.** Los mensajes nunca se editan: así la caché de la IA
   funciona (conversaciones largas ~90 % más baratas) y el razonamiento del modelo se
   mantiene válido. El contexto que cambia (fecha, recuerdos relevantes, dispositivos) se
   añade en cada turno como un mensaje de sistema `<atlas_context>`.
6. **La seguridad la impone el servidor, no la IA.** Aunque la IA “quisiera” borrar algo,
   el servidor revisa el permiso de cada herramienta y, si es sensible, crea una acción
   pendiente que sólo tú puedes aprobar.
7. **Multi-proveedor.** Todo el sistema habla con la IA a través de la interfaz
   `AIProvider` (`server/src/ai/types.ts`). Agregar OpenAI u otro proveedor es crear un
   archivo adaptador y registrarlo en `ai/registry.ts`; nada más cambia.
8. **Voz con las capacidades del propio dispositivo.** Dictado y lectura usan el motor de
   voz de Safari/Edge: gratis y sin enviar audio a servicios adicionales.

## Flujo de un mensaje

1. Escribes o dictas un mensaje → `POST /api/chat`.
2. El servidor guarda tu mensaje y agrega el contexto del turno (fecha, recuerdos
   relevantes, estado de dispositivos).
3. Llama a la IA con las instrucciones y herramientas **congeladas** de esa conversación.
4. Si la IA pide una herramienta:
   - permiso **automático** → se ejecuta y se registra;
   - **pedir confirmación** → se crea una acción pendiente y aparece una tarjeta para aprobar/rechazar;
   - **desactivada** → no se ejecuta y se le informa a la IA.
5. Se repite hasta que la IA termina (máximo 10 pasos por respuesta).
6. Todo se transmite en vivo a la pantalla; el orbe muestra si ATLAS piensa, escribe o ejecuta.

## Flujo futuro de control remoto (Fase 3)

iPhone → cerebro central → ¿necesita el PC? → `device_status` (¿conectado?) → ¿sensible?
→ confirmación → orden por WebSocket al agente → resultado → respuesta en el iPhone. Si el
PC está apagado, ATLAS lo dice claramente (ya implementado en `device_status`). El protocolo
está en [agent-windows/README.md](../agent-windows/README.md).

## Añadir un módulo de herramientas

1. Crea `server/src/tools/builtin/miModulo.ts` con `defineTool({...})`: nombre, descripción,
   esquema de parámetros (zod), permiso por defecto, si es sensible, `summarize` y `run`.
2. Agrégalo a la lista `BUILTIN` en `server/src/tools/registry.ts`.
3. Si el resultado contiene datos externos (archivos, web), devuelve `untrusted: true`.

Las conversaciones existentes conservan su conjunto de herramientas original; las nuevas
herramientas aparecen en las conversaciones nuevas.
