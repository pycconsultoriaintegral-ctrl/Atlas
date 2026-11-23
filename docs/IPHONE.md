# ATLAS en el iPhone

El iPhone necesita conectarse a tu computador **de forma cifrada (HTTPS)**. Además, Safari
sólo permite el micrófono y la instalación como app en sitios HTTPS.

## Opción recomendada: Tailscale (gratis, privado)

Tailscale crea una red privada cifrada entre tus dispositivos. ATLAS **no queda publicado
en internet**: sólo tus dispositivos, con tu cuenta, pueden llegar a él.

### En el computador Windows

1. Descarga Tailscale desde <https://tailscale.com/download> e instálalo.
2. Inicia sesión (con Google, Microsoft o Apple).
3. En el panel web de Tailscale (<https://login.tailscale.com/admin/dns>) activa
   **MagicDNS** y **HTTPS Certificates**.
4. Con ATLAS encendido, abre `cmd` y ejecuta:

   ```
   tailscale serve --bg 8787
   ```

   Te mostrará una dirección como `https://mi-pc.tu-red.ts.net`. Esa es la dirección de ATLAS.
   (Sólo se hace una vez; Tailscale la recuerda.)

### En el iPhone

1. Instala **Tailscale** desde la App Store e inicia sesión con la **misma cuenta**.
2. Abre **Safari** y entra a `https://mi-pc.tu-red.ts.net`.
3. Inicia sesión en ATLAS.
4. Toca **Compartir** (cuadro con flecha) → **Agregar a pantalla de inicio** → **Agregar**.
5. Abre ATLAS desde el ícono nuevo: se verá como una app a pantalla completa.

> Tailscale debe estar activo en el iPhone (ícono de VPN) para llegar a ATLAS.

## Voz en el iPhone

- Toca el **micrófono** para dictar. La primera vez, Safari pedirá permiso para el micrófono.
- El dictado usa el reconocimiento de voz de Apple; requiere tener **Siri y Dictado**
  activados (Ajustes → General → Teclado → Activar Dictado).
- Si el dictado no funciona dentro de la app instalada, puedes usar el micrófono del
  teclado del iPhone: funciona siempre.
- Activa o desactiva la voz de ATLAS con el ícono de altavoz (modo silencioso).
- En *Ajustes → Voz* puedes elegir la voz (las voces “mejoradas” se descargan en
  Ajustes del iPhone → Accesibilidad → Contenido leído → Voces → Español).

## Uso con una mano

- El campo de texto y el botón de micrófono/enviar están abajo, al alcance del pulgar.
- La barra inferior da acceso directo a Chat, Memoria, Tareas, Equipos y Ajustes.
- Arriba: historial, nueva conversación, modo silencioso y **botón de emergencia**.

## Importante

- Si el computador está apagado o ATLAS cerrado, la app mostrará “Sin conexión con el
  cerebro central”. (En una fase futura podremos mover el cerebro a la nube para que esté
  siempre disponible; ver [COSTOS.md](COSTOS.md).)
