# ATLAS — tu asistente personal de IA

ATLAS es un **único asistente** con un cerebro central, memoria compartida y distintas
interfaces: el navegador del computador Windows, el iPhone (como app instalada desde
Safari) y, en la Fase 3, un agente que ejecutará tareas autorizadas en tu PC.

```
  iPhone (PWA)  ─┐                         ┌─ Anthropic Claude (IA)
  Navegador PC  ─┼──►  CEREBRO CENTRAL  ───┤
  Agente Windows ┘     (servidor ATLAS)    └─ Memoria · tareas · registro (archivo local)
```

## Estado actual — Fase 1 completada

| Función | Estado |
|---|---|
| Cerebro central (servidor) con IA Claude y arquitectura multi-proveedor | ✅ |
| Chat en tiempo real (respuestas en streaming) con botón **detener** | ✅ |
| Cuenta protegida con contraseña, sesiones revocables, bloqueo por intentos fallidos | ✅ |
| Memoria compartida: recuerdos, proyectos, búsqueda en conversaciones anteriores | ✅ |
| Tareas (desde el chat o desde la pantalla de Tareas) | ✅ |
| Herramientas modulares con permisos por herramienta | ✅ |
| Confirmación obligatoria para acciones sensibles + **botón de emergencia** | ✅ |
| Registro de operaciones (auditoría) | ✅ |
| Interfaz tipo JARVIS, modo oscuro, adaptada a iPhone (una mano) | ✅ |
| App instalable en iPhone (PWA) | ✅ |
| Voz básica: dictado en español, lectura en voz alta, modo silencioso | ✅ (se pulirá en Fase 2) |
| Base para el agente de Windows (vinculación por token, estado en vivo, parada) | ✅ (el agente llega en Fase 3) |

## Puesta en marcha en tu computador Windows (resumen)

1. Instala **Node.js LTS** desde <https://nodejs.org> (botón verde “LTS”).
2. Descarga este proyecto (botón verde **Code → Download ZIP** en GitHub) y descomprímelo,
   por ejemplo en `C:\ATLAS`.
3. Haz doble clic en **`iniciar-atlas.bat`**. La primera vez instala lo necesario
   (unos minutos) y abre <http://localhost:8787>.
4. En la ventana negra aparecerá un **código de configuración** de 6 dígitos.
   Escríbelo en la página junto con tu usuario y contraseña para crear tu cuenta.

Guía detallada con capturas de qué esperar: [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md).

## Configurar la IA (API key de Anthropic)

Sin API key, ATLAS funciona en **modo demostración** (respuestas simuladas, claramente
marcadas). Para activar la IA real:

1. Entra a <https://console.anthropic.com> y crea una cuenta.
2. En **Billing**, agrega un método de pago y carga crédito (por ejemplo, USD 5–10 para empezar).
   Puedes fijar un **límite de gasto mensual** en *Limits* — recomendado.
3. En **API Keys → Create Key**, crea una clave llamada “ATLAS” y cópiala (empieza por `sk-ant-`).
4. Abre el archivo **`.env`** de la carpeta de ATLAS con el Bloc de notas y pégala así:
   `ANTHROPIC_API_KEY=sk-ant-...`
5. Cierra la ventana de ATLAS y vuelve a abrir `iniciar-atlas.bat`.

La clave sólo vive en tu computador (archivo `.env`): nunca se envía al navegador, nunca se
sube a GitHub (está excluida en `.gitignore`) y se oculta en los registros.

Modelo por defecto: **Claude Opus 5.5**. Puedes cambiarlo en *Ajustes* (Sonnet 5.5 cuesta la
mitad; Haiku 5.5 es mucho más barato para tareas simples). Estimación de costos en
[docs/COSTOS.md](docs/COSTOS.md).

## Usar ATLAS desde el iPhone

El iPhone necesita llegar a tu computador de forma **segura y cifrada (HTTPS)**. La opción
recomendada, gratuita y privada es **Tailscale** (tu PC y tu iPhone quedan en una red privada
cifrada; nada queda expuesto a internet). Pasos en [docs/IPHONE.md](docs/IPHONE.md). Luego, en
Safari: **Compartir → Agregar a pantalla de inicio**.

## Cosas que puedes decirle a ATLAS

- “Recuerda que mi empresa se llama …” · “¿Qué recuerdas de mí?”
- “Crea una tarea para el viernes: enviar la propuesta” · “¿Qué tengo pendiente?”
- “Crea el proyecto Presupuesto 2027 y guarda que el tope es …”
- “¿De qué hablamos la semana pasada sobre el proveedor?”
- “Borra el recuerdo #3” → ATLAS pedirá tu **confirmación** antes de hacerlo.

## Seguridad en una frase

ATLAS no ejecuta acciones destructivas ni sensibles sin tu aprobación explícita (lo impone
el servidor, no la IA), trata los documentos y páginas como datos y no como órdenes, y
registra todo lo que hace. Detalle en [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

## Documentación

- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) — cómo está construido y por qué.
- [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md) — instalación paso a paso.
- [docs/IPHONE.md](docs/IPHONE.md) — acceso seguro desde el iPhone e instalación como app.
- [docs/SEGURIDAD.md](docs/SEGURIDAD.md) — medidas de seguridad.
- [docs/COSTOS.md](docs/COSTOS.md) — análisis de costos e infraestructura.
- [docs/HOJA-DE-RUTA.md](docs/HOJA-DE-RUTA.md) — fases siguientes.
- [agent-windows/README.md](agent-windows/README.md) — protocolo del futuro agente de Windows.

## Para desarrolladores

```bash
npm install        # dependencias
npm run dev        # servidor (8787) + interfaz con recarga (5173)
npm test           # pruebas del servidor
npm run typecheck  # verificación de tipos
npm run build && npm start   # versión de producción en http://localhost:8787
```

Requisitos: Node.js ≥ 22.13 (usa el SQLite integrado de Node; sin servicios externos).
