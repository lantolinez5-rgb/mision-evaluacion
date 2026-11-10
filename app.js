'use strict';

/* Misión Evaluación — frontend reconstruido v1.1.0 */

const API_PATH = '/api';
const state = {
  token: localStorage.getItem('misionToken') || '',
  user: null,
  points: 0,
  completedMissions: [],
  completedPractice: false,
  completedReflection: false,
  leaderboard: []
};
let authMode = 'login';
let currentActivity = '';

const MISSION_META = [
  { code: 'radar', number: 'MISIÓN 01', icon: '◉', title: 'Radar evaluativo', description: 'Identifica el propósito de la evaluación en diferentes momentos del aprendizaje.', xp: 30 },
  { code: 'feedback', number: 'MISIÓN 02', icon: '✳', title: 'Laboratorio de feedback', description: 'Transforma comentarios generales en orientaciones que ayudan a avanzar.', xp: 20 },
  { code: 'decision', number: 'MISIÓN 03', icon: '⌁', title: 'Decisión pedagógica', description: 'Resuelve un caso y decide cómo convertir un resultado en una oportunidad.', xp: 20 }
];

const BADGES = [
  { key: 'radar', icon: '◉', name: 'Radar activo', description: 'Reconociste los tipos de evaluación.' },
  { key: 'feedback', icon: '✳', name: 'Voz que impulsa', description: 'Elegiste una retroalimentación útil.' },
  { key: 'decision', icon: '⌁', name: 'Decisión consciente', description: 'Tomaste una decisión pedagógica.' },
  { key: 'practice', icon: '✎', name: 'Diseñador de evidencias', description: 'Creaste una estrategia aplicable.' },
  { key: 'reflection', icon: '◎', name: 'Agente reflexivo', description: 'Cerraste la misión con metacognición.' }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Obtiene el formulario real. En eventos delegados, currentTarget es el contenedor. */
function getFormFromEvent(event, expectedId = '') {
  const target = event && event.target;
  const form = target instanceof HTMLFormElement
    ? target
    : (target && typeof target.closest === 'function' ? target.closest('form') : null);

  if (!(form instanceof HTMLFormElement)) {
    console.error('No se pudo identificar el formulario enviado.', { expectedId, target });
    return null;
  }
  if (expectedId && form.id !== expectedId) {
    console.error(`Se esperaba el formulario #${expectedId}, pero se recibió #${form.id || '(sin id)'}.`);
    return null;
  }
  return form;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

async function api(action, payload = {}) {
  let response;
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload, token: state.token })
    });
  } catch (error) {
    console.error('Error de conexión con /api:', error);
    throw new Error('No fue posible conectar con el servidor. Comprueba tu conexión e inténtalo nuevamente.');
  }

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('La API no devolvió JSON válido:', raw);
    throw new Error(`El servidor respondió con un formato inesperado (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    throw new Error(data?.message || `El servidor respondió con el estado HTTP ${response.status}.`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('El servidor devolvió una respuesta vacía o inválida.');
  }
  if (data.ok !== true) {
    throw new Error(data.message || 'No se pudo completar la operación.');
  }
  return data;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 3400);
}

function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === 'register';
  $$('.auth-tab').forEach(tab => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('#nameField').hidden = !isRegister;
  $('#privacyField').hidden = !isRegister;
  $('input[name="name"]').required = isRegister;
  $('input[name="privacy"]').required = isRegister;
  $('input[name="password"]').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('#authTitle').textContent = isRegister ? 'Crea tu identidad' : 'Prepara tu misión';
  $('#authSubtitle').textContent = isRegister ? 'Registra tu perfil de agente y conserva tu progreso.' : 'Ingresa para guardar tu avance y desbloquear insignias.';
  $('#authSubmit').innerHTML = isRegister ? 'Crear cuenta <span>→</span>' : 'Entrar a la misión <span>→</span>';
  $('#authMessage').textContent = '';
}

function showAuth() {
  $('#authView').hidden = false;
  $('#appView').hidden = true;
  $('#activityView').hidden = true;
  $('#topbarRight').hidden = true;
}

function showApp() {
  $('#authView').hidden = true;
  $('#appView').hidden = false;
  $('#activityView').hidden = true;
  $('#topbarRight').hidden = false;
}

async function handleAuth(event) {
  event.preventDefault();
  const form = getFormFromEvent(event, 'authForm');
  if (!form) return;
  const values = new FormData(form);
  const email = String(values.get('email') || '').trim().toLowerCase();
  const password = String(values.get('password') || '');
  const message = $('#authMessage');
  const submit = $('#authSubmit');
  message.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Validando…';
  try {
    let result;
    if (authMode === 'register') {
      if (!values.get('privacy')) throw new Error('Debes aceptar el aviso de tratamiento de datos para crear tu cuenta.');
      result = await api('register', {
        name: String(values.get('name') || '').trim(),
        email,
        password
      });
    } else {
      result = await api('login', { email, password });
    }
    state.token = result.token;
    localStorage.setItem('misionToken', state.token);
    await refreshState();
    showToast(authMode === 'register' ? 'Perfil creado. ¡Tu misión comienza ahora!' : 'Sesión iniciada. ¡Vamos con tu misión!');
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = authMode === 'register' ? 'Crear cuenta <span>→</span>' : 'Entrar a la misión <span>→</span>';
  }
}

async function refreshState({ navigateToDashboard = true } = {}) {
  const result = await api('state');
  if (!result.user) throw new Error('El servidor no devolvió los datos del perfil.');

  state.user = result.user;
  state.points = Number(result.user.points || 0);
  state.completedMissions = Array.isArray(result.user.completedMissions) ? result.user.completedMissions : [];
  state.completedPractice = Boolean(result.user.completedPractice);
  state.completedReflection = Boolean(result.user.completedReflection);
  state.leaderboard = Array.isArray(result.leaderboard) ? result.leaderboard : [];
  renderDashboard();

  if (navigateToDashboard) showApp();
}

function getRank(points) {
  if (points >= 80) return { name: 'Transformador', next: '¡Has alcanzado el nivel máximo!', icon: '✺' };
  if (points >= 55) return { name: 'Estratega', next: `${80 - points} XP para Transformador`, icon: '✧' };
  if (points >= 25) return { name: 'Analista', next: `${55 - points} XP para Estratega`, icon: '◇' };
  return { name: 'Explorador', next: `${25 - points} XP para Analista`, icon: '◎' };
}

function isBadgeEarned(key) {
  if (key === 'practice') return state.completedPractice;
  if (key === 'reflection') return state.completedReflection;
  return state.completedMissions.includes(key);
}

function renderDashboard() {
  const name = state.user?.name || 'Agente';
  $('#welcomeName').textContent = name.split(' ')[0];
  $('#headerName').textContent = name;
  $('#headerPoints').textContent = `${state.points} XP`;
  $('#userAvatar').textContent = name.trim().charAt(0).toUpperCase() || 'A';
  const rank = getRank(state.points);
  $('#rankName').textContent = rank.name;
  $('#rankNext').textContent = rank.next;
  $('.rank-icon').textContent = rank.icon;

  const completedCount = state.completedMissions.length + Number(state.completedPractice) + Number(state.completedReflection);
  const percent = Math.round((completedCount / 5) * 100);
  $('#progressText').textContent = `${completedCount} de 5 experiencias completadas`;
  $('#progressPercent').textContent = `${percent}%`;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressPoints').textContent = `${state.points} XP acumulados`;

  $('#missionsGrid').innerHTML = MISSION_META.map(mission => {
    const completed = state.completedMissions.includes(mission.code);
    return `<article class="mission-card ${completed ? 'completed' : ''}" data-open="${mission.code}" tabindex="0" role="button" aria-label="Abrir ${escapeHTML(mission.title)}">
      <div class="mission-top"><span class="mission-number">${mission.number}</span><span class="mission-status ${completed ? 'done' : ''}">${completed ? '✓ Completada' : 'Disponible'}</span></div>
      <div class="mission-icon">${mission.icon}</div><h3>${escapeHTML(mission.title)}</h3><p>${escapeHTML(mission.description)}</p>
      <div class="mission-bottom"><span class="mission-xp">${completed ? 'RETO SUPERADO' : `HASTA ${mission.xp} XP`}</span><span class="small-arrow">${completed ? '✓' : '↗'}</span></div>
    </article>`;
  }).join('');

  $('#closingGrid').innerHTML = `
    <article class="closing-card" data-open="practice" tabindex="0" role="button" aria-label="Abrir desafío práctico">
      <span class="closing-icon practical">✎</span><div><strong>Desafío práctico</strong><small>${state.completedPractice ? 'Actividad enviada · hasta 20 XP' : 'Diseña una evaluación que ayude a mejorar'}</small></div><span class="small-arrow">${state.completedPractice ? '✓' : '↗'}</span>
    </article>
    <article class="closing-card" data-open="reflection" tabindex="0" role="button" aria-label="Abrir reflexión final">
      <span class="closing-icon reflect">◎</span><div><strong>Reflexión final</strong><small>${state.completedReflection ? 'Reflexión guardada · hasta 10 XP' : 'Mira tu proceso y transforma tu mirada'}</small></div><span class="small-arrow">${state.completedReflection ? '✓' : '↗'}</span>
    </article>`;

  $('#badgesList').innerHTML = BADGES.map(badge => `<div class="badge-row ${isBadgeEarned(badge.key) ? 'earned' : ''}"><span class="badge-emblem">${badge.icon}</span><div><strong>${badge.name}</strong><small>${badge.description}</small></div></div>`).join('');
  renderLeaderboard();
}

function renderLeaderboard() {
  const list = $('#leaderboardList');
  if (!state.leaderboard.length) {
    list.innerHTML = '<p class="muted">Aún no hay agentes en la clasificación. ¡Puedes ser el primero!</p>';
    return;
  }
  list.innerHTML = state.leaderboard.slice(0, 6).map((person, index) => {
    const isMe = person.userId === state.user?.id;
    return `<div class="leader-row ${isMe ? 'me' : ''}"><span class="leader-position">${String(index + 1).padStart(2, '0')}</span><span class="leader-name">${escapeHTML(person.name)}${isMe ? ' · tú' : ''}</span><span class="leader-score">${Number(person.points || 0)} XP</span></div>`;
  }).join('');
}

function openActivity(code) {
  currentActivity = code;
  $('#appView').hidden = true;
  $('#activityView').hidden = false;
  const content = $('#activityContent');
  if (MISSION_META.some(mission => mission.code === code)) content.innerHTML = renderMission(code);
  else if (code === 'practice') content.innerHTML = renderPractice();
  else if (code === 'reflection') content.innerHTML = renderReflection();
  else content.innerHTML = renderMentorInfo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function activityHero(code, title, description, maxXp, tag) {
  return `<header class="activity-hero"><span class="activity-code">${code}</span><h1>${title}</h1><p>${description}</p><div class="activity-meta"><span class="meta-pill">${maxXp} XP posibles</span><span class="meta-pill">${tag}</span><span class="meta-pill">Evaluar para mejorar</span></div></header>`;
}

function renderMission(code) {
  const completed = state.completedMissions.includes(code);
  if (completed) return renderAlreadyCompleted(MISSION_META.find(m => m.code === code).title);

  if (code === 'radar') return `${activityHero('MISIÓN 01 / OBSERVAR Y RELACIONAR', 'Radar evaluativo', 'Detecta qué intención tiene cada situación. No todas las evaluaciones cumplen la misma función: algunas permiten conocer el punto de partida, otras acompañan el proceso y otras valoran los resultados al cierre.', 30, '3 preguntas · 10 XP cada una')}
    <section class="activity-panel"><h2>Activa tu radar</h2><p>Lee cada situación y selecciona el tipo de evaluación que mejor la describe.</p>
      <form id="missionForm" data-code="radar">
        <div class="question-block"><div class="question-title">01. Antes de iniciar una unidad, la docente propone preguntas y una actividad corta para conocer qué saben sus estudiantes y qué necesitan reforzar.</div><div class="option-list">
          ${radioOption('q1','diagnostica','Evaluación diagnóstica')}${radioOption('q1','formativa','Evaluación formativa')}${radioOption('q1','sumativa','Evaluación sumativa')}
        </div></div>
        <div class="question-block"><div class="question-title">02. Durante el desarrollo de un proyecto, el docente revisa borradores, conversa con los equipos y propone ajustes antes de la entrega final.</div><div class="option-list">
          ${radioOption('q2','diagnostica','Evaluación diagnóstica')}${radioOption('q2','formativa','Evaluación formativa')}${radioOption('q2','sumativa','Evaluación sumativa')}
        </div></div>
        <div class="question-block"><div class="question-title">03. Al finalizar el periodo, se aplica una prueba para valorar el nivel de logro alcanzado frente a los objetivos propuestos.</div><div class="option-list">
          ${radioOption('q3','diagnostica','Evaluación diagnóstica')}${radioOption('q3','formativa','Evaluación formativa')}${radioOption('q3','sumativa','Evaluación sumativa')}
        </div></div>
        <div class="activity-actions"><p class="muted">Responde las tres situaciones para completar el reto.</p><button class="button button-primary" type="submit">Verificar respuestas <span>→</span></button></div>
      </form><div id="activityResult"></div>
    </section>`;

  if (code === 'feedback') return `${activityHero('MISIÓN 02 / EVALUAR Y ACOMPAÑAR', 'Laboratorio de feedback', 'La retroalimentación no debería limitarse a señalar un error o entregar una nota. Debe ofrecer información específica y una orientación que el estudiante pueda utilizar para mejorar.', 20, '1 caso · 20 XP')}
    <section class="activity-panel"><h2>Formula una respuesta que impulse</h2><p>Un estudiante entrega un primer borrador y comenta: «No sé si voy por buen camino». ¿Cuál respuesta ofrece una retroalimentación más formativa?</p>
      <form id="missionForm" data-code="feedback">
        <div class="question-block"><div class="option-list">
          ${radioOption('choice','A','«Tu trabajo está mal. Debes esforzarte más».')}
          ${radioOption('choice','B','«Vas bien, sigue así».')}
          ${radioOption('choice','C','«Tu idea central se entiende y utilizas dos ejemplos pertinentes. Para fortalecerla, explica cómo cada ejemplo respalda tu argumento y revisa el orden de los párrafos. Puedes volver a entregarlo para conversar los avances».')}
        </div></div>
        <div class="feedback-box"><strong>PISTA DEL LABORATORIO</strong><p>Una orientación útil suele reconocer evidencias concretas, señalar un paso de mejora y permitir que el estudiante utilice esa información.</p></div>
        <div class="activity-actions"><p class="muted">Elige la alternativa más útil para aprender.</p><button class="button button-primary" type="submit">Enviar decisión <span>→</span></button></div>
      </form><div id="activityResult"></div>
    </section>`;

  return `${activityHero('MISIÓN 03 / DECIDIR Y TRANSFORMAR', 'Decisión pedagógica', 'Una calificación puede mostrar un resultado, pero no siempre explica qué ocurrió durante el aprendizaje. Tu misión es elegir una acción que permita comprender las dificultades y seguir avanzando.', 20, '1 caso · 20 XP')}
    <section class="activity-panel"><h2>El caso de Valentina</h2><p>Valentina obtiene una calificación baja en una actividad. Al conversar con ella, el docente descubre que comprende los conceptos, pero tiene dificultades para organizar sus ideas y justificar sus respuestas. ¿Qué decisión tiene mayor sentido formativo?</p>
      <form id="missionForm" data-code="decision">
        <div class="question-block"><div class="option-list">
          ${radioOption('choice','A','Mantener la nota sin conversar sobre el proceso, porque la evaluación ya terminó.')}
          ${radioOption('choice','B','Revisar con Valentina las evidencias, identificar qué logró y qué necesita fortalecer, ofrecer orientación específica y permitir una nueva oportunidad de aplicación.')}
          ${radioOption('choice','C','Comparar su resultado con el de sus compañeros para que se esfuerce más.')}
        </div></div>
        <div class="activity-actions"><p class="muted">Piensa en la evaluación como acompañamiento.</p><button class="button button-primary" type="submit">Confirmar decisión <span>→</span></button></div>
      </form><div id="activityResult"></div>
    </section>`;
}

function radioOption(name, value, label) {
  return `<label class="option"><input type="radio" name="${name}" value="${value}" required><span>${escapeHTML(label)}</span></label>`;
}

function renderAlreadyCompleted(title) {
  return `${activityHero('RETO SUPERADO', title, 'Ya completaste esta misión. El aprendizaje continúa cuando utilizas lo que descubriste en nuevos contextos.', 0, 'Actividad registrada')}
    <section class="activity-panel result-screen"><div class="result-icon">✦</div><h2>Esta misión ya está en tu bitácora</h2><p>Tu avance quedó guardado. Puedes volver al tablero y continuar con otra experiencia.</p><button class="button button-primary" data-action="back">Volver al tablero →</button></section>`;
}

function renderPractice() {
  if (state.completedPractice) return `${activityHero('DESAFÍO PRÁCTICO / APLICAR', 'Diseña una evaluación que ayude a mejorar', 'Convierte los conceptos en una decisión pedagógica aplicable a una clase.', 0, 'Actividad registrada')}
    <section class="activity-panel result-screen"><div class="result-icon">✎</div><h2>Tu diseño ya fue registrado</h2><p>La estrategia que planteaste quedó guardada en tu bitácora. Recuerda que los puntos reconocen la elaboración de la propuesta; su calidad pedagógica requiere revisión docente.</p><button class="button button-primary" data-action="back">Volver al tablero →</button></section>`;

  return `${activityHero('DESAFÍO PRÁCTICO / APLICAR', 'Diseña una evaluación que ayude a mejorar', 'Imagina que acompañas una clase de grado 9.º. El grupo debe elaborar una infografía científica sobre el uso responsable del agua. Diseña una estrategia breve para evaluar mientras aprenden, no solamente al final.', 20, 'Aplicación práctica · 4 componentes')}
    <section class="activity-panel"><h2>Construye tu plan de evaluación</h2><p>Completa los cuatro componentes. Escribe respuestas concretas que puedan ponerse en práctica en el aula.</p>
      <form id="practiceForm">
        <div class="form-grid">
          <label class="field">1. ¿Qué aprendizaje u objetivo observarías?<span class="field-help">Ejemplo: explicar con argumentos dos acciones para cuidar el agua.</span><textarea name="objective" required minlength="10" maxlength="700" placeholder="El aprendizaje que quiero observar es…"></textarea></label>
          <label class="field">2. ¿Qué evidencia recogerías durante el proceso?<span class="field-help">Piensa en borradores, conversaciones, mapas, prototipos, diarios, etc.</span><textarea name="evidence" required minlength="10" maxlength="700" placeholder="La evidencia sería…"></textarea></label>
          <label class="field">3. ¿Qué retroalimentación ofrecerías?<span class="field-help">Incluye un logro observable y una orientación específica para avanzar.</span><textarea name="feedback" required minlength="10" maxlength="700" placeholder="Le diría al estudiante…"></textarea></label>
          <label class="field">4. ¿Qué oportunidad de mejora propondrías?<span class="field-help">Explica cómo podría utilizar la retroalimentación.</span><textarea name="nextStep" required minlength="10" maxlength="700" placeholder="Después de recibir la orientación, el estudiante podría…"></textarea></label>
        </div>
        <div class="ai-panel"><h3>✳ Menta IA · Mentor de retroalimentación</h3><p>Solicita una lectura orientadora de tu propuesta antes de enviarla. La IA sugiere mejoras; no reemplaza el criterio docente ni asigna una nota.</p><button class="button button-ghost" type="button" id="askMentorButton">Revisar mi propuesta con IA ↗</button><div id="mentorResponse" class="ai-response" aria-live="polite"></div></div>
        <div class="activity-actions"><p class="muted">Los XP reconocen que diseñaste y completaste la propuesta.</p><button class="button button-primary" type="submit">Guardar desafío <span>→</span></button></div>
      </form><div id="activityResult"></div>
    </section>`;
}

function renderReflection() {
  if (state.completedReflection) return `${activityHero('CIERRE DE MISIÓN / METACOGNICIÓN', 'Tu bitácora de aprendizaje', 'Reflexionar permite reconocer qué cambió en tu manera de comprender la evaluación.', 0, 'Reflexión registrada')}
    <section class="activity-panel result-screen"><div class="result-icon">◎</div><h2>Reflexión guardada</h2><p>Has cerrado la misión. Tus respuestas quedaron registradas como parte de tu proceso de aprendizaje.</p><button class="button button-primary" data-action="back">Volver al tablero →</button></section>`;

  return `${activityHero('CIERRE DE MISIÓN / METACOGNICIÓN', 'Tu bitácora de aprendizaje', 'Antes de finalizar, detente y observa tu propio proceso. No busques una respuesta perfecta: explica qué piensas y por qué.', 10, '3 preguntas · Reflexión')}
    <section class="activity-panel"><h2>Una pausa para pensar</h2><p>Responde con tus propias palabras. Tus ideas ayudan a reconocer cómo puede transformarse la evaluación.</p>
      <form id="reflectionForm">
        <div class="form-grid">
          <label class="field">1. ¿Qué se aprende a través de la evaluación?<textarea name="learned" required minlength="10" maxlength="900" placeholder="A través de la evaluación comprendí que…"></textarea></label>
          <label class="field">2. ¿Cómo debería evaluarse en educación?<textarea name="idealEval" required minlength="10" maxlength="900" placeholder="Considero que una evaluación pertinente debería…"></textarea></label>
          <label class="field">3. ¿De qué manera podrían transformarse las prácticas tradicionales de evaluación?<textarea name="transformation" required minlength="10" maxlength="900" placeholder="Una transformación posible sería…"></textarea></label>
        </div>
        <div class="feedback-box"><strong>RECUERDA</strong><p>Evaluar para aprender implica recoger evidencias, interpretar lo que sucede, retroalimentar y ajustar la enseñanza. La calificación puede comunicar un resultado, pero no reemplaza ese proceso.</p></div>
        <div class="activity-actions"><p class="muted">La reflexión también forma parte del aprendizaje.</p><button class="button button-primary" type="submit">Guardar reflexión <span>→</span></button></div>
      </form><div id="activityResult"></div>
    </section>`;
}

function renderMentorInfo() {
  return `${activityHero('MENTA IA / APOYO AL APRENDIZAJE', 'Un mentor para mejorar, no para calificar', 'Menta IA puede ofrecer sugerencias de mejora a partir de tu diseño práctico. Su función es hacer preguntas, reconocer fortalezas y proponer próximos pasos.', 0, 'IA como apoyo formativo')}
    <section class="activity-panel"><h2>¿Cómo funciona?</h2><p>En el desafío práctico puedes solicitar una revisión orientadora. Cuando se configura Gemini en Apps Script, la plataforma envía una versión de tu propuesta al modelo para generar recomendaciones. La clave permanece en el backend y nunca se incorpora al código del navegador.</p><div class="feedback-box"><strong>CRITERIO PEDAGÓGICO</strong><p>La respuesta de IA es una sugerencia, no una evaluación definitiva. El docente debe revisar la pertinencia de las propuestas y el estudiante debe decidir cómo utilizarlas.</p></div><button class="button button-primary" data-action="back">Volver al tablero →</button></section>`;
}

async function handleMissionSubmit(event) {
  event.preventDefault();
  const form = getFormFromEvent(event, 'missionForm');
  if (!form || form.dataset.submitting === 'true') return;

  const code = String(form.dataset.code || '');
  if (!MISSION_META.some(mission => mission.code === code)) {
    showToast('No se identificó correctamente esta misión. Vuelve al tablero e inténtalo otra vez.');
    return;
  }

  const data = new FormData(form);
  let answers;
  if (code === 'radar') {
    answers = { q1: data.get('q1'), q2: data.get('q2'), q3: data.get('q3') };
    if (Object.values(answers).some(value => !value)) {
      showToast('Responde las tres situaciones antes de enviar la misión.');
      return;
    }
  } else {
    answers = { choice: data.get('choice') };
    if (!answers.choice) {
      showToast('Selecciona una alternativa antes de continuar.');
      return;
    }
  }

  const button = $('button[type="submit"]', form);
  if (!button) {
    console.error('No se encontró el botón de envío de #missionForm.');
    return;
  }

  form.dataset.submitting = 'true';
  button.disabled = true;
  button.textContent = 'Verificando…';

  try {
    const result = await api('completeMission', { code, answers });
    renderActivityResult(result, code);
    // Actualizar puntos/ranking sin ocultar la pantalla de resultados.
    try {
      await refreshState({ navigateToDashboard: false });
    } catch (refreshError) {
      console.warn('La misión se guardó, pero no se pudo actualizar el tablero:', refreshError);
    }
  } catch (error) {
    const holder = $('#activityResult');
    if (holder) holder.innerHTML = `<div class="feedback-box warning"><strong>No se pudo registrar</strong><p>${escapeHTML(error.message)}</p></div>`;
    form.dataset.submitting = 'false';
    button.disabled = false;
    button.textContent = 'Intentar de nuevo';
  }
}

function renderActivityResult(result, code) {
  const details = Array.isArray(result.details) ? result.details : [];
  const detailHtml = details.map(item => `<div class="feedback-box ${item.correct ? 'success' : 'warning'}"><strong>${item.correct ? '✓ Correcto' : '↻ Para revisar'}</strong><p>${escapeHTML(item.feedback || '')}</p></div>`).join('');
  const message = code === 'radar'
    ? 'Has identificado distintas funciones de la evaluación. Recuerda: el propósito depende del momento y del uso que se hace de la información.'
    : code === 'feedback'
      ? 'La retroalimentación formativa aporta información que el estudiante puede utilizar para avanzar.'
      : 'Una decisión formativa conecta evidencias, diálogo, orientación y nuevas oportunidades de aprendizaje.';
  const holder = $('#activityResult');
  if (holder) {
    holder.innerHTML = `<div class="feedback-box success"><strong>MISIÓN REGISTRADA · +${Number(result.points || 0)} XP</strong><p>${escapeHTML(result.message || message)}</p></div>${detailHtml}<div class="result-screen"><div class="result-icon">✦</div><h2>¡Buen trabajo, agente!</h2><div class="result-score">+${Number(result.points || 0)} XP</div><p>${escapeHTML(message)}</p><button class="button button-primary" data-action="back">Continuar misión →</button></div>`;
  }
  const form = $('#missionForm');
  if (form) form.hidden = true;
}

async function handlePracticeSubmit(event) {
  event.preventDefault();
  const form = getFormFromEvent(event, 'practiceForm');
  if (!form || form.dataset.submitting === 'true') return;

  const values = Object.fromEntries(new FormData(form).entries());
  const requiredFields = ['objective', 'evidence', 'feedback', 'nextStep'];
  if (requiredFields.some(key => String(values[key] || '').trim().length < 10)) {
    showToast('Completa los cuatro componentes con al menos 10 caracteres cada uno.');
    return;
  }

  const button = $('button[type="submit"]', form);
  if (!button) return;
  form.dataset.submitting = 'true';
  button.disabled = true;
  button.textContent = 'Guardando…';

  try {
    const result = await api('submitPractice', values);
    form.hidden = true;
    $('#activityResult').innerHTML = `<div class="feedback-box success"><strong>DESAFÍO REGISTRADO · +${Number(result.points || 0)} XP</strong><p>${escapeHTML(result.message || 'Tu propuesta quedó guardada en la bitácora.')}</p></div><div class="result-screen"><div class="result-icon">✎</div><h2>Diseño completado</h2><div class="result-score">+${Number(result.points || 0)} XP</div><p>Has construido una estrategia de evaluación formativa. La puntuación reconoce la elaboración y completitud de tu propuesta; su calidad requiere análisis pedagógico.</p><button class="button button-primary" data-action="back">Volver al tablero →</button></div>`;
    try {
      await refreshState({ navigateToDashboard: false });
    } catch (refreshError) {
      console.warn('El desafío se guardó, pero no se pudo actualizar el tablero:', refreshError);
    }
  } catch (error) {
    $('#activityResult').innerHTML = `<div class="feedback-box warning"><strong>No se pudo guardar</strong><p>${escapeHTML(error.message)}</p></div>`;
    form.dataset.submitting = 'false';
    button.disabled = false;
    button.textContent = 'Guardar desafío →';
  }
}

async function handleReflectionSubmit(event) {
  event.preventDefault();
  const form = getFormFromEvent(event, 'reflectionForm');
  if (!form || form.dataset.submitting === 'true') return;

  const values = Object.fromEntries(new FormData(form).entries());
  const requiredFields = ['learned', 'idealEval', 'transformation'];
  if (requiredFields.some(key => String(values[key] || '').trim().length < 10)) {
    showToast('Responde las tres preguntas con al menos 10 caracteres cada una.');
    return;
  }

  const button = $('button[type="submit"]', form);
  if (!button) return;
  form.dataset.submitting = 'true';
  button.disabled = true;
  button.textContent = 'Guardando…';

  try {
    const result = await api('submitReflection', values);
    form.hidden = true;
    $('#activityResult').innerHTML = `<div class="feedback-box success"><strong>REFLEXIÓN REGISTRADA · +${Number(result.points || 0)} XP</strong><p>${escapeHTML(result.message || 'Tu reflexión quedó guardada.')}</p></div><div class="result-screen"><div class="result-icon">◎</div><h2>Has cerrado tu bitácora</h2><div class="result-score">+${Number(result.points || 0)} XP</div><p>La metacognición permite reconocer qué aprendiste, cómo lo aprendiste y qué podrías hacer de manera diferente la próxima vez.</p><button class="button button-primary" data-action="back">Ver mi progreso →</button></div>`;
    try {
      await refreshState({ navigateToDashboard: false });
    } catch (refreshError) {
      console.warn('La reflexión se guardó, pero no se pudo actualizar el tablero:', refreshError);
    }
  } catch (error) {
    $('#activityResult').innerHTML = `<div class="feedback-box warning"><strong>No se pudo guardar</strong><p>${escapeHTML(error.message)}</p></div>`;
    form.dataset.submitting = 'false';
    button.disabled = false;
    button.textContent = 'Guardar reflexión →';
  }
}

async function askMentor() {
  const form = $('#practiceForm');
  const responseBox = $('#mentorResponse');
  const button = $('#askMentorButton');
  if (!(form instanceof HTMLFormElement) || !responseBox || !button) return;

  const values = Object.fromEntries(new FormData(form).entries());
  if (Object.values(values).some(value => String(value).trim().length < 10)) {
    responseBox.textContent = 'Completa primero los cuatro campos con al menos 10 caracteres para que el mentor pueda revisar tu propuesta.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Menta está pensando…';
  responseBox.textContent = 'Analizando los componentes de tu estrategia…';
  try {
    const result = await api('mentorFeedback', values);
    responseBox.textContent = result.feedback || 'No se recibió una sugerencia. Revisa tu configuración de IA.';
  } catch (error) {
    responseBox.textContent = `No fue posible consultar el mentor: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Revisar mi propuesta con IA ↗';
  }
}

function goBack() {
  $('#activityView').hidden = true;
  $('#appView').hidden = false;
  currentActivity = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function logout() {
  try { await api('logout'); } catch (_) { /* El token local se elimina aunque el servidor no responda. */ }
  state.token = '';
  localStorage.removeItem('misionToken');
  state.user = null;
  showAuth();
  setAuthMode('login');
  showToast('Sesión cerrada. Tu progreso permanece guardado.');
}

function bindEvents() {
  $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode)));
  $('#authForm').addEventListener('submit', handleAuth);
  $('#logoutButton').addEventListener('click', () => { void logout(); });
  $('#backButton').addEventListener('click', goBack);

  $('#missionsGrid').addEventListener('click', event => {
    const card = event.target.closest('[data-open]');
    if (card) openActivity(card.dataset.open);
  });
  $('#missionsGrid').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open]')) {
      event.preventDefault();
      openActivity(event.target.dataset.open);
    }
  });

  $('#closingGrid').addEventListener('click', event => {
    const card = event.target.closest('[data-open]');
    if (card) openActivity(card.dataset.open);
  });
  $('#closingGrid').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-open]')) {
      event.preventDefault();
      openActivity(event.target.dataset.open);
    }
  });

  // Submit bubbles to #activityContent. event.target is the submitted form;
  // event.currentTarget would be the surrounding DIV and must not be used here.
  $('#activityContent').addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === 'missionForm') void handleMissionSubmit(event);
    else if (form.id === 'practiceForm') void handlePracticeSubmit(event);
    else if (form.id === 'reflectionForm') void handleReflectionSubmit(event);
  });

  $('#activityContent').addEventListener('click', event => {
    if (event.target.closest('[data-action="back"]')) goBack();
    if (event.target.closest('#askMentorButton')) void askMentor();
  });

  $('#mentorInfoButton').addEventListener('click', () => openActivity('mentorInfo'));
}

async function init() {
  bindEvents();
  setAuthMode('login');
  if (state.token) {
    try {
      await refreshState();
    } catch (error) {
      state.token = '';
      localStorage.removeItem('misionToken');
      showAuth();
      showToast('Tu sesión expiró. Ingresa nuevamente para continuar.');
    }
  } else {
    showAuth();
  }
}

document.addEventListener('DOMContentLoaded', init);
