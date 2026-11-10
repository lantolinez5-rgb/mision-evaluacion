# Misión Evaluación — cambios de la versión 1.1.0

## Correcciones

- Los controladores de envío ahora obtienen el formulario desde `event.target`, no desde `event.currentTarget`. En los eventos delegados, `currentTarget` es `#activityContent` (un `div`), no el formulario.
- Se aplica validación explícita del tipo e identificador de formulario antes de construir `FormData`.
- Se corrige el mismo patrón en el desafío práctico y la reflexión final.
- Se evita el envío duplicado mientras una actividad está guardándose.
- La actualización de puntos y progreso ya no cambia automáticamente de pantalla y oculta el resultado de la actividad.
- Se mejora el diagnóstico de respuestas inválidas de la API.
- `index.html` carga `app.js?v=1.1.0` para evitar que el navegador conserve la versión anterior en caché.

## Archivos modificados

- `app.js`
- `index.html`

No se modificaron `functions/api.js`, `gas/Code.gs`, la estructura de Google Sheets ni las variables secretas.

## Validación realizada

- `node --check app.js`: correcto (sin errores de sintaxis).
- Comprobación estática: los formularios de misión, desafío práctico y reflexión utilizan el resolvedor de formulario y no usan `event.currentTarget` para construir `FormData`.

## Publicación

Sube `app.js` e `index.html` a la raíz del repositorio GitHub conectado a Cloudflare Pages. Espera un despliegue exitoso y recarga la página publicada con `Ctrl + F5`.
