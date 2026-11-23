# Costos e infraestructura

> Precios aproximados a noviembre de 2026. **Verifícalos antes de contratar** cualquier
> servicio. ATLAS no contrata nada ni genera gastos por sí mismo.

## Resumen recomendado para la fase inicial

| Pieza | Opción elegida | Costo |
|---|---|---|
| Servidor (cerebro central) | Tu propio PC con Windows | USD 0 |
| Base de datos | SQLite integrado (archivo `data/atlas.db`) | USD 0 |
| Acceso seguro desde el iPhone | Tailscale (plan personal gratuito) | USD 0 |
| Tiempo real | SSE + WebSocket incluidos en el servidor | USD 0 |
| Voz | Motores de voz de Safari / Edge | USD 0 |
| Almacenamiento | Disco de tu PC | USD 0 |
| **IA (Anthropic Claude)** | Pago por uso | **ver abajo** |

El único gasto real al empezar es la IA, y lo controlas tú con un límite mensual.

## IA: cuánto puede costar

Precio por millón de *tokens* (≈ 750 000 palabras) — entrada / salida:

| Modelo | Entrada | Salida | Uso sugerido |
|---|---|---|---|
| Claude Opus 5.5 (por defecto) | USD 4 | USD 20 | Máxima calidad |
| Claude Sonnet 5.5 | USD 2 | USD 10 | Muy buena calidad a la mitad de precio |
| Claude Haiku 5.5 | USD 0,10 | USD 0,50 | Tareas simples, muy barato |
| Claude Fable 5.2 | USD 8 | USD 40 | Problemas muy complejos |

Estimación para **30 mensajes al día** (≈ 3 000 tokens de entrada y 500 de salida por
mensaje, con caché activada):

| Modelo | Al mes (aprox.) |
|---|---|
| Opus 5.5 | USD 15 – 25 |
| Sonnet 5.5 | USD 8 – 12 |
| Haiku 5.5 | menos de USD 1 |

El nivel de razonamiento (Ajustes) también influye: “Bajo/Medio” gasta menos que “Alto/Máximo”.
ATLAS activa la **caché de instrucciones** automáticamente, lo que abarata mucho las
conversaciones largas.

**Consejo:** empieza con Opus 5.5 o Sonnet 5.5 y fija en <https://console.anthropic.com>
un límite mensual (por ejemplo USD 20). Revisa el consumo real tras una semana.

## Cuándo pasar a un servidor en la nube (decisión futura)

Con el servidor en tu PC, si el PC está apagado ATLAS no responde desde el iPhone. Para la
Fase 3 (control remoto) conviene que el cerebro viva en la nube y el PC sólo ejecute el agente:

| Opción | Costo aproximado | Comentario |
|---|---|---|
| Fly.io / Railway / Render (contenedor pequeño + disco) | USD 5 – 10 / mes | Sencillo; ATLAS ya es fácil de empaquetar. |
| VPS (Hetzner, DigitalOcean, etc.) | USD 4 – 7 / mes | Más control; requiere algo de administración. |
| Oracle Cloud “Always Free” | USD 0 | Gratis pero con más configuración y disponibilidad variable. |
| PostgreSQL gestionado (Neon, Supabase) | USD 0 en planes gratuitos | Sólo si se necesita más adelante; SQLite basta para un usuario. |

**No se contratará nada sin tu autorización.** Cuando llegue el momento te presentaré la
comparación actualizada y tú decides.
