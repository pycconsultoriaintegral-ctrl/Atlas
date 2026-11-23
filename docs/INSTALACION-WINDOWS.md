# Instalar ATLAS en Windows 11 (paso a paso)

## 1. Instalar Node.js (una sola vez)

1. Entra a <https://nodejs.org>.
2. Descarga la versión **LTS** (botón verde) e instálala con las opciones por defecto
   (Siguiente → Siguiente → Instalar).
3. Para comprobarlo: abre el menú Inicio, escribe `cmd`, ábrelo y escribe `node -v`.
   Debe mostrar `v22.13` o superior (por ejemplo `v24.x`).

## 2. Descargar ATLAS

- Opción fácil: en la página de GitHub del proyecto, **Code → Download ZIP**, y
  descomprímelo en una carpeta sin espacios raros, por ejemplo `C:\ATLAS`.
- Opción con Git: `git clone <url-del-repositorio> C:\ATLAS`.

## 3. Arrancar

1. Abre la carpeta `C:\ATLAS` y haz doble clic en **`iniciar-atlas.bat`**.
2. La primera vez instalará componentes (2–5 minutos). Si Windows pregunta por el firewall,
   puedes **denegar** el acceso a redes públicas: ATLAS sólo escucha en este computador.
3. Se abrirá el navegador en <http://localhost:8787>.
4. En la ventana negra verás:

   ```
   PRIMER USO → código de configuración:  123456
   ```

   Escríbelo en la página, elige tu usuario y contraseña, y entra.

Mientras la ventana negra esté abierta, ATLAS está encendido. Para apagarlo, ciérrala.

## 4. Activar la IA

Sigue la sección **“Configurar la IA”** del [README](../README.md). Tras pegar la API key en
`.env`, cierra la ventana y abre `iniciar-atlas.bat` de nuevo. En *Ajustes* debería decir
“Conectado a Anthropic Claude”.

## 5. (Opcional) Arrancar ATLAS automáticamente con Windows

1. Pulsa `Win + R`, escribe `shell:startup` y pulsa Enter.
2. Crea ahí un **acceso directo** a `C:\ATLAS\iniciar-atlas.bat`.

## Copias de seguridad

Toda tu información (memoria, conversaciones, tareas) está en `C:\ATLAS\data\atlas.db`.
Copia la carpeta `data` a OneDrive o a un disco externo de vez en cuando (con ATLAS apagado).

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| “Falta Node.js” | Instala Node.js LTS (paso 1) y vuelve a abrir el `.bat`. |
| “ATLAS necesita Node.js 22.13 o superior” | Instala la última versión LTS desde nodejs.org. |
| `EADDRINUSE` (puerto en uso) | ATLAS ya está abierto en otra ventana, o cambia `PORT=` en `.env`. |
| “La API key de Anthropic no es válida” | Revisa que la clave en `.env` esté completa y sin espacios. |
| “Tu cuenta de Anthropic no tiene saldo” | Carga crédito en console.anthropic.com → Billing. |
| Olvidé la contraseña | En la carpeta de ATLAS abre `cmd` y ejecuta `npm run reset-password` (no se pierde ningún dato). |
