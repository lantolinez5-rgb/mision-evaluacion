# Misión Evaluación — El aprendizaje no termina en la nota

Aplicación web gamificada para estudiantes de educación media (grados 9.º y 10.º). Desarrollada con HTML, CSS y JavaScript; Cloudflare Pages Functions; Google Apps Script; Google Sheets; GitHub; y una opción de mentoría con Gemini.

## 1. Qué incluye

- Registro e inicio de sesión con correo y contraseña.
- Contraseñas almacenadas como hash SHA-256 con salt (nunca se guarda la contraseña original).
- Sesión con vencimiento de 6 horas.
- Tres misiones pedagógicas: identificación de tipos de evaluación, retroalimentación formativa y toma de decisiones.
- Desafío práctico para diseñar una estrategia de evaluación formativa.
- Reflexión metacognitiva con las tres preguntas solicitadas en la actividad.
- Puntos XP, cuatro niveles, cinco insignias y clasificación de agentes.
- Persistencia en Google Sheets.
- Menta IA opcional: orientaciones para mejorar el diseño práctico mediante Gemini. Si no configuras la API, muestra una lista de autoevaluación.
- API intermediada por Cloudflare para que las claves no lleguen al navegador.

## 2. Estructura del proyecto

```text
mision-evaluacion/
├── index.html                 # Interfaz y estructura
├── styles.css                 # Diseño visual responsive
├── app.js                     # Lógica del juego y consumo de API
├── _headers                   # Cabeceras de seguridad para Pages
├── functions/
│   └── api.js                 # Proxy Cloudflare Pages → Apps Script
├── gas/
│   └── Code.gs                # Backend, autenticación y conexión a Sheets
├── FICHA_PEDAGOGICA.md        # Justificación y diseño de la experiencia
├── package.json               # Comandos locales con Wrangler
└── README.md                  # Esta guía
```

## 3. Configurar Google Sheets y Apps Script

1. Entra a [script.google.com](https://script.google.com/) con la cuenta que administrará la base de datos.
2. Crea un proyecto nuevo llamado **Misión Evaluación Backend**.
3. Abre `gas/Code.gs` de este repositorio, copia todo su contenido y pégalo en el archivo `Code.gs` del proyecto de Apps Script.
4. En el editor, selecciona la función `setupDatabase` y pulsa **Ejecutar**. Autoriza el acceso a Google Sheets cuando Google lo solicite.
5. En el registro de ejecución aparecerá la URL de la hoja de cálculo creada. También quedará guardado su ID en las propiedades del proyecto.
6. En Apps Script, abre **Configuración del proyecto → Propiedades del script** y crea:
   - `API_SECRET`: una clave aleatoria larga (mínimo 32 caracteres). No uses una contraseña personal.
   - `GEMINI_API_KEY`: opcional. Pega aquí la clave obtenida en Google AI Studio para activar Menta IA.
   - `GEMINI_MODEL`: opcional. Identificador de un modelo Gemini disponible en tu proyecto; por defecto se usa `gemini-3.8-flash`.
7. Despliega el proyecto mediante **Implementar → Nueva implementación → Aplicación web**.
8. Configura **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier usuario**. Esta aplicación necesita que el backend escriba en la hoja del propietario. El acceso público al endpoint no revela por sí solo la hoja: Cloudflare añade el secreto del servidor en las solicitudes.
9. Pulsa **Implementar**, autoriza lo que Google solicite y copia la URL que termina en `/exec`.
10. Si modificas `Code.gs` más adelante, crea una nueva versión en **Implementar → Administrar implementaciones → Editar → Nueva versión → Implementar**.

> Importante: no compartas la hoja de cálculo con los estudiantes. El backend la administra con los permisos del propietario.


## 4. Probar localmente (opcional)

1. Instala Node.js LTS.
2. Copia `.dev.vars.example` como `.dev.vars` y reemplaza los valores por los de tu implementación de Apps Script.
3. En la carpeta del proyecto ejecuta `npm install`.
4. Ejecuta `npm run dev` y abre la dirección local que indique Wrangler.
5. No subas `.dev.vars` a GitHub; el archivo ya está excluido mediante `.gitignore`.

## 5. Configurar GitHub

1. Crea un repositorio nuevo en GitHub, por ejemplo `mision-evaluacion`.
2. Sube el contenido de esta carpeta a la raíz del repositorio. No subas claves, archivos `.env` ni datos de estudiantes.
3. Desde una terminal, dentro de esta carpeta, puedes usar:

```bash
git init
git add .
git commit -m "Versión inicial de Misión Evaluación"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/mision-evaluacion.git
git push -u origin main
```

## 6. Publicar en Cloudflare Pages

1. Entra a [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Abre **Workers & Pages → Create application → Pages → Connect to Git**.
3. Autoriza GitHub y selecciona el repositorio `mision-evaluacion`.
4. Configura:
   - Production branch: `main`
   - Framework preset: `None`
   - Build command: dejar vacío
   - Build output directory: `.` (raíz del repositorio)
5. Pulsa **Save and Deploy**.
6. Cuando el primer despliegue termine, entra al proyecto de Pages y abre **Settings → Variables and Secrets**.
7. Agrega estas variables para Production y Preview:
   - `GAS_WEB_APP_URL` (Text): la URL `/exec` obtenida al desplegar Apps Script.
   - `GAS_API_SECRET` (Secret): exactamente el mismo valor de `API_SECRET` guardado en Apps Script.
8. Guarda los cambios y realiza un nuevo despliegue para que las funciones reciban las variables.
9. Abre el dominio `*.pages.dev` y prueba el registro de una cuenta.

Cloudflare Pages detecta automáticamente la carpeta `functions/`. Cada cambio que envíes a la rama conectada de GitHub podrá desplegarse automáticamente.

## 7. Activar Menta IA

Menta IA está integrada como apoyo opcional en el desafío práctico.

1. Crea una clave desde [Google AI Studio](https://aistudio.google.com/apikey).
2. Guarda la clave en Apps Script como propiedad `GEMINI_API_KEY`.
3. Opcionalmente, define `GEMINI_MODEL` con el identificador de un modelo disponible para tu clave. El valor predeterminado es `gemini-3.8-flash`.
4. El backend utiliza la **Gemini Interactions API** y solicita una fortaleza, dos oportunidades de mejora, una pregunta metacognitiva y un siguiente paso. La solicitud usa `store: false`.
5. No pongas la clave en `app.js`, `index.html`, GitHub ni en variables públicas del frontend.

La aplicación sigue funcionando sin esta clave: Menta IA muestra una guía de autoevaluación. Google recomienda Interactions API para proyectos nuevos; revisa los modelos disponibles, las condiciones y los costos vigentes antes de emplearlo con un grupo. [Documentación oficial](https://ai.google.dev/gemini-api/docs/interactions-overview).

## 8. Cómo funciona la puntuación

| Experiencia | Puntuación máxima |
|---|---:|
| Misión 1: Radar evaluativo | 30 XP |
| Misión 2: Laboratorio de feedback | 20 XP |
| Misión 3: Decisión pedagógica | 20 XP |
| Desafío práctico | 20 XP |
| Reflexión final | 10 XP |
| **Total** | **100 XP** |

Se conserva la mejor puntuación de cada misión si el estudiante vuelve a intentarla. El desafío práctico y la reflexión se registran una sola vez para evitar repetir envíos y acumular puntos artificialmente.

Los XP de las actividades abiertas reconocen la realización y la completitud, no la calidad académica del texto. La valoración de la estrategia y de las reflexiones debe hacerla el docente con criterios pedagógicos explícitos.

## 9. Estructura de Google Sheets

El script crea cuatro pestañas:

- **Usuarios**: identificador, nombre, correo, salt, hash de contraseña, puntos y avance.
- **Intentos**: respuestas de las misiones, puntos obtenidos y retroalimentación asociada.
- **Aplicaciones**: las cuatro partes del desafío práctico.
- **Reflexiones**: respuestas a las tres preguntas metacognitivas.

## 10. Pruebas recomendadas antes de usarlo con estudiantes

1. Registra dos cuentas de prueba con correos diferentes.
2. Completa una misión y verifica el registro en `Usuarios` e `Intentos`.
3. Vuelve a intentar la misión con un resultado mejor y verifica que solo se sumen los puntos de mejora.
4. Completa el desafío práctico y la reflexión; verifica sus pestañas.
5. Comprueba que el ranking no expone correos electrónicos.
6. Cierra sesión y vuelve a entrar.
7. Prueba primero con datos ficticios. No solicites información sensible ni uses la plataforma como sistema institucional de calificaciones.

## 11. Alcance y límites

Este es un prototipo académico funcional, no un sistema institucional certificado. La autenticación usa hash SHA-256 con salt y sesiones temporales en `CacheService`; el caché puede expirar antes del plazo previsto. No reutilices contraseñas personales. Para un despliegue institucional con muchos usuarios se recomienda autenticación administrada, base de datos con controles de acceso, protección contra abuso y revisión de privacidad/retención de datos.

**Uso con estudiantes:** el formulario admite un nombre o alias. Para grupos de menores, prioriza alias, evita recopilar datos sensibles y no despliegues el registro con correos reales hasta contar con la autorización institucional y el aviso de tratamiento de datos que corresponda. La tabla de clasificación muestra el nombre/alias registrado; acuerda con el grupo qué identificador aparecerá públicamente.

La puntuación automática mide aciertos y completitud. No pretende juzgar automáticamente la profundidad conceptual, la creatividad ni la calidad de una reflexión.
