# Seguridad de ATLAS

## Acceso

- **Cuenta única protegida por contraseña** (mínimo 10 caracteres con letras y números),
  guardada con **scrypt** (sólo se guarda un hash; nadie puede leer tu contraseña).
- **Configuración inicial con código de un solo uso** que sólo aparece en la consola del
  servidor: aunque alguien abriera la página antes que tú, no podría apropiarse de ATLAS.
- **Sesiones con tokens aleatorios de 256 bits** en cookies `HttpOnly` + `SameSite=Strict`
  (+ `Secure` bajo HTTPS). En la base de datos sólo se guarda el hash del token.
- Puedes **ver y cerrar sesiones** de cada dispositivo (Ajustes → Seguridad). Cambiar la
  contraseña cierra todas las demás sesiones.
- **Bloqueo progresivo** tras 5 intentos fallidos y límite de peticiones por IP.
- **Protección CSRF**: toda petición que modifica datos exige una cabecera especial que un
  sitio externo no puede enviar.
- Cabeceras de seguridad (CSP estricta, sin iframes, sin scripts externos).

## Comunicación

- El servidor escucha por defecto sólo en `127.0.0.1` (este computador).
- Para el iPhone se recomienda **Tailscale**: red privada cifrada (WireGuard) con HTTPS
  automático; ATLAS **no queda expuesto a internet**.
- El agente de Windows se conecta con un **token propio por dispositivo**, revocable, distinto
  de tu contraseña. Sin token válido, la conexión se rechaza y queda registrada.

## Acciones y herramientas

- **Permisos por herramienta** (Ajustes → Permisos): automático, pedir confirmación o desactivada.
- Las herramientas **sensibles** (borrar, enviar, comprar, publicar, modificar el computador…)
  **siempre requieren confirmación**: el servidor rechaza configurarlas en automático.
- La confirmación la aplica el **servidor**, no la IA. Una acción pendiente sólo se ejecuta
  cuando tú pulsas **Aprobar** (y confirmas en el diálogo). Caduca a las 24 horas.
- **Botón de emergencia** (escudo rojo, arriba a la derecha): detiene todas las respuestas en
  curso, rechaza todas las acciones pendientes y ordena a los dispositivos detenerse.
- ATLAS tiene prohibido afirmar que hizo algo que no hizo; si el PC está desconectado, lo dice.

## Protección contra instrucciones maliciosas (prompt injection)

- Todo contenido que no escribiste tú (documentos, páginas web, archivos, resultados de
  programas, historial) se entrega a la IA dentro de `<untrusted_content>`, con la regla
  explícita de tratarlo como **datos, nunca como órdenes**.
- El contenido se “neutraliza” para que no pueda cerrar esa etiqueta ni hacerse pasar por
  mensajes del sistema.
- Aun si la IA fuera engañada, las acciones sensibles siguen necesitando **tu** aprobación.
- ATLAS se niega a guardar contraseñas, claves o datos bancarios en su memoria.

## Secretos

- La API key vive sólo en el archivo `.env` del servidor (excluido de Git).
- Nunca se envía al navegador ni aparece en los registros (se ocultan cookies, cabeceras de
  autorización y cualquier texto con forma de clave).

## Registro de operaciones

Ajustes → Registro de operaciones muestra inicios de sesión, intentos fallidos,
herramientas ejecutadas, aprobaciones, rechazos, paradas de emergencia y conexiones de
dispositivos.

## Recomendaciones para ti

- Usa una contraseña larga y única (idealmente desde un gestor de contraseñas).
- Fija un límite de gasto mensual en la consola de Anthropic.
- Haz copia de seguridad periódica de la carpeta `data/` (contiene tu memoria).
- No compartas el enlace de Tailscale ni los tokens de dispositivos.
