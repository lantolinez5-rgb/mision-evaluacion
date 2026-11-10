/**
 * MISIÓN EVALUACIÓN — Backend Google Apps Script
 * Base de datos: Google Sheets. Autenticación: contraseña con hash SHA-256 + salt.
 * Configura en Project Settings > Script properties:
 *   API_SECRET     = el mismo secreto definido en Cloudflare Pages
 *   SPREADSHEET_ID = se escribe automáticamente al ejecutar setupDatabase()
 *   GEMINI_API_KEY = (opcional) clave de Google AI Studio para Menta IA
 *   GEMINI_MODEL   = (opcional) modelo Gemini; default: gemini-3.8-flash
 */

const APP_NAME = 'Misión Evaluación';
const SESSION_TTL_SECONDS = 21600; // 6 horas
const USERS_SHEET = 'Usuarios';
const ATTEMPTS_SHEET = 'Intentos';
const PRACTICE_SHEET = 'Aplicaciones';
const REFLECTIONS_SHEET = 'Reflexiones';

function doGet() {
  return jsonOutput_({ ok: true, app: APP_NAME, status: 'Backend disponible. Utiliza POST desde la aplicación.' });
}

function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const payload = JSON.parse(raw);
    const configuredSecret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!configuredSecret || !safeEquals_(String(payload.secret || ''), configuredSecret)) {
      return jsonOutput_({ ok: false, message: 'Solicitud no autorizada.' });
    }
    const action = String(payload.action || '');
    const result = dispatch_(action, payload);
    return jsonOutput_(Object.assign({ ok: true }, result || {}));
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonOutput_({ ok: false, message: friendlyError_(error) });
  }
}

function dispatch_(action, payload) {
  switch (action) {
    case 'register': return registerUser_(payload);
    case 'login': return loginUser_(payload);
    case 'state': return getState_(payload.token);
    case 'logout': return logoutUser_(payload.token);
    case 'completeMission': return completeMission_(payload);
    case 'submitPractice': return submitPractice_(payload);
    case 'submitReflection': return submitReflection_(payload);
    case 'mentorFeedback': return mentorFeedback_(payload);
    default: throw new Error('La acción solicitada no existe.');
  }
}

/** Ejecutar una sola vez desde el editor de Apps Script. */
function setupDatabase() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('Misión Evaluación — Base de datos');
    spreadsheetId = spreadsheet.getId();
    props.setProperty('SPREADSHEET_ID', spreadsheetId);
  }
  ensureSheet_(spreadsheet, USERS_SHEET, [
    'userId', 'nombre', 'correo', 'salt', 'passwordHash', 'puntos', 'misionesCompletadasJson',
    'fechaRegistro', 'ultimoAcceso', 'desafioCompletado', 'reflexionCompletada', 'desglosePuntosJson'
  ]);
  ensureSheet_(spreadsheet, ATTEMPTS_SHEET, [
    'attemptId', 'userId', 'tipo', 'codigo', 'respuestasJson', 'puntosIntento', 'retroalimentacionJson', 'fecha'
  ]);
  ensureSheet_(spreadsheet, PRACTICE_SHEET, [
    'submissionId', 'userId', 'objetivo', 'evidencia', 'retroalimentacion', 'siguientePaso', 'puntos', 'fecha'
  ]);
  ensureSheet_(spreadsheet, REFLECTIONS_SHEET, [
    'reflectionId', 'userId', 'queAprendio', 'comoEvaluar', 'comoTransformar', 'puntos', 'fecha'
  ]);
  console.log('Base de datos lista: ' + spreadsheet.getUrl());
  console.log('ID de la hoja: ' + spreadsheetId);
  return spreadsheet.getUrl();
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#17243a').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('La base de datos aún no está configurada. Ejecuta setupDatabase() en Apps Script.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('No se encontró la pestaña ' + name + '. Ejecuta setupDatabase().');
  return sheet;
}

function registerUser_(payload) {
  const name = cleanText_(payload.name, 40);
  const email = cleanEmail_(payload.email);
  const password = String(payload.password || '');
  if (name.length < 2) throw new Error('Escribe un nombre o alias de al menos 2 caracteres.');
  validateEmail_(email);
  validatePassword_(password);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_(USERS_SHEET);
    if (findUserByEmail_(email)) throw new Error('Ya existe una cuenta con ese correo. Inicia sesión.');
    const userId = Utilities.getUuid();
    const salt = Utilities.getUuid();
    const passwordHash = hashPassword_(password, salt);
    const now = new Date();
    sheet.appendRow([userId, name, email, salt, passwordHash, 0, '[]', now, now, false, false, '{}']);
    const token = createSession_(userId);
    return { token: token, user: { id: userId, name: name, points: 0 } };
  } finally {
    lock.releaseLock();
  }
}

function loginUser_(payload) {
  const email = cleanEmail_(payload.email);
  const password = String(payload.password || '');
  validateEmail_(email);
  if (!password) throw new Error('Escribe tu contraseña.');
  const cache = CacheService.getScriptCache();
  const throttleKey = 'login_fail_' + digestKey_(email);
  const blockedKey = 'login_block_' + digestKey_(email);
  if (cache.get(blockedKey)) throw new Error('Demasiados intentos. Espera 10 minutos antes de volver a ingresar.');
  const user = findUserByEmail_(email);
  if (!user || !safeEquals_(hashPassword_(password, user.salt), user.passwordHash)) {
    const failures = Number(cache.get(throttleKey) || 0) + 1;
    cache.put(throttleKey, String(failures), 600);
    if (failures >= 5) cache.put(blockedKey, '1', 600);
    throw new Error('Correo o contraseña incorrectos.');
  }
  cache.remove(throttleKey);
  const sheet = getSheet_(USERS_SHEET);
  sheet.getRange(user.rowIndex, 9).setValue(new Date());
  return { token: createSession_(user.id), user: { id: user.id, name: user.name, points: user.points } };
}

function getState_(token) {
  const userId = requireSession_(token);
  const user = findUserById_(userId);
  if (!user) throw new Error('No se encontró el perfil de usuario. Vuelve a iniciar sesión.');
  const completed = parseJsonArray_(user.completedJson);
  const breakdown = parseJsonObject_(user.scoreBreakdownJson);
  return {
    user: {
      id: user.id,
      name: user.name,
      points: Number(user.points || 0),
      completedMissions: completed,
      completedPractice: Boolean(user.practiceDone),
      completedReflection: Boolean(user.reflectionDone),
      scoreBreakdown: breakdown
    },
    leaderboard: getLeaderboard_()
  };
}

function getLeaderboard_() {
  const sheet = getSheet_(USERS_SHEET);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues() : [];
  return rows
    .filter(row => row[0])
    .map(row => ({ userId: String(row[0]), name: String(row[1] || 'Agente'), points: Number(row[5] || 0) }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function completeMission_(payload) {
  const userId = requireSession_(payload.token);
  const code = String(payload.code || '');
  const answers = payload.answers || {};
  const scoring = scoreMission_(code, answers);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = findUserById_(userId);
    if (!user) throw new Error('No se encontró tu perfil.');
    const completed = parseJsonArray_(user.completedJson);
    const breakdown = parseJsonObject_(user.scoreBreakdownJson);
    const previousBest = Number(breakdown[code] || 0);
    const bestScore = Math.max(previousBest, scoring.score);
    const earnedNow = Math.max(0, bestScore - previousBest);
    breakdown[code] = bestScore;
    if (!completed.includes(code)) completed.push(code);
    const newTotal = Number(user.points || 0) + earnedNow;
    updateUser_(user, {
      points: newTotal,
      completedJson: JSON.stringify(completed),
      scoreBreakdownJson: JSON.stringify(breakdown)
    });
    getSheet_(ATTEMPTS_SHEET).appendRow([
      Utilities.getUuid(), userId, 'mision', code, JSON.stringify(answers), scoring.score,
      JSON.stringify(scoring.details), new Date()
    ]);
    return {
      points: earnedNow,
      bestScore: bestScore,
      totalPoints: newTotal,
      message: earnedNow > 0 ? 'Tu resultado quedó registrado. Puedes revisar la retroalimentación y volver a intentarlo para mejorar tu mejor puntuación.' : 'Tu intento quedó registrado. Ya conservas tu mejor puntuación en esta misión.',
      details: scoring.details
    };
  } finally {
    lock.releaseLock();
  }
}

function scoreMission_(code, answers) {
  const answerKey = {
    radar: {
      q1: { expected: 'diagnostica', explanation: 'Es diagnóstica porque explora los saberes previos y las necesidades antes de iniciar la enseñanza.' },
      q2: { expected: 'formativa', explanation: 'Es formativa porque recoge evidencias durante el proceso y permite ajustar el trabajo antes de finalizar.' },
      q3: { expected: 'sumativa', explanation: 'Es sumativa porque valora los resultados al cierre de un periodo o unidad.' }
    },
    feedback: {
      choice: { expected: 'C', explanation: 'La opción C reconoce evidencias concretas, propone una mejora específica y abre la posibilidad de revisar el trabajo. Las opciones A y B no ofrecen información suficiente para avanzar.' }
    },
    decision: {
      choice: { expected: 'B', explanation: 'La opción B conecta las evidencias con el diálogo, la orientación y una nueva oportunidad para demostrar el aprendizaje. La nota por sí sola no explica qué necesita fortalecer la estudiante.' }
    }
  };
  if (!answerKey[code]) throw new Error('La misión solicitada no es válida.');
  let score = 0;
  const details = [];
  Object.keys(answerKey[code]).forEach(key => {
    const item = answerKey[code][key];
    const correct = String(answers[key] || '') === item.expected;
    if (correct) score += code === 'radar' ? 10 : 20;
    details.push({ correct: correct, feedback: item.explanation });
  });
  return { score: score, details: details };
}

function submitPractice_(payload) {
  const userId = requireSession_(payload.token);
  const fields = {
    objective: cleanText_(payload.objective, 700),
    evidence: cleanText_(payload.evidence, 700),
    feedback: cleanText_(payload.feedback, 700),
    nextStep: cleanText_(payload.nextStep, 700)
  };
  if (Object.keys(fields).some(key => fields[key].length < 10)) throw new Error('Completa los cuatro componentes con al menos 10 caracteres cada uno.');
  const score = Object.keys(fields).reduce((total, key) => {
    const length = fields[key].length;
    return total + (length >= 50 ? 5 : length >= 20 ? 4 : 3);
  }, 0);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = findUserById_(userId);
    if (!user) throw new Error('No se encontró tu perfil.');
    if (user.practiceDone) throw new Error('El desafío práctico ya fue registrado.');
    const breakdown = parseJsonObject_(user.scoreBreakdownJson);
    breakdown.practice = score;
    updateUser_(user, { points: Number(user.points || 0) + score, practiceDone: true, scoreBreakdownJson: JSON.stringify(breakdown) });
    getSheet_(PRACTICE_SHEET).appendRow([
      Utilities.getUuid(), userId, fields.objective, fields.evidence, fields.feedback, fields.nextStep, score, new Date()
    ]);
    return { points: score, message: 'Tu diseño fue guardado. La puntuación reconoce que completaste los componentes de la propuesta; no equivale a una valoración automática de su calidad pedagógica.' };
  } finally {
    lock.releaseLock();
  }
}

function submitReflection_(payload) {
  const userId = requireSession_(payload.token);
  const fields = {
    learned: cleanText_(payload.learned, 900),
    idealEval: cleanText_(payload.idealEval, 900),
    transformation: cleanText_(payload.transformation, 900)
  };
  if (Object.keys(fields).some(key => fields[key].length < 10)) throw new Error('Responde las tres preguntas con al menos 10 caracteres cada una.');
  const score = Object.keys(fields).reduce((total, key) => {
    const length = fields[key].length;
    return total + (length >= 40 ? 3 : length >= 20 ? 2 : 1);
  }, 0) + (Object.keys(fields).every(key => fields[key].length >= 20) ? 1 : 0);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const user = findUserById_(userId);
    if (!user) throw new Error('No se encontró tu perfil.');
    if (user.reflectionDone) throw new Error('La reflexión final ya fue registrada.');
    const breakdown = parseJsonObject_(user.scoreBreakdownJson);
    breakdown.reflection = score;
    updateUser_(user, { points: Number(user.points || 0) + score, reflectionDone: true, scoreBreakdownJson: JSON.stringify(breakdown) });
    getSheet_(REFLECTIONS_SHEET).appendRow([
      Utilities.getUuid(), userId, fields.learned, fields.idealEval, fields.transformation, score, new Date()
    ]);
    return { points: score, message: 'Tu reflexión quedó guardada. Las ideas que expresaste permiten reconocer tu comprensión del sentido formativo de la evaluación.' };
  } finally {
    lock.releaseLock();
  }
}

function mentorFeedback_(payload) {
  const userId = requireSession_(payload.token);
  const fields = {
    objective: cleanText_(payload.objective, 700),
    evidence: cleanText_(payload.evidence, 700),
    feedback: cleanText_(payload.feedback, 700),
    nextStep: cleanText_(payload.nextStep, 700)
  };
  if (Object.keys(fields).some(key => fields[key].length < 10)) throw new Error('Completa primero los cuatro componentes de tu propuesta.');
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return {
      enabled: false,
      feedback: 'Menta IA aún no tiene una clave de Gemini configurada. Mientras tanto, utiliza esta guía de autoevaluación:\n\n1. Alineación: ¿la evidencia permite observar el objetivo que escribiste?\n2. Especificidad: ¿tu retroalimentación señala un logro y una acción concreta para mejorar?\n3. Oportunidad: ¿el siguiente paso permite aplicar la orientación y revisar el aprendizaje?\n\nConfigura GEMINI_API_KEY en las propiedades del proyecto de Apps Script para activar la sugerencia generativa.'
    };
  }
  const prompt = [
    'Actúa como mentor pedagógico experto en evaluación formativa para educación media en Colombia.',
    'Analiza la propuesta del estudiante y responde en español, con tono respetuoso, claro y concreto.',
    'No asignes notas ni porcentajes. No sustituyas el criterio del docente. No inventes información.',
    'Entrega: (1) una fortaleza específica, (2) dos oportunidades de mejora, (3) una pregunta metacognitiva y (4) un siguiente paso factible.',
    'Máximo 180 palabras. Distingue sugerencias de afirmaciones y evita elogios genéricos.',
    '\nOBJETIVO: ' + fields.objective,
    '\nEVIDENCIA: ' + fields.evidence,
    '\nRETROALIMENTACIÓN: ' + fields.feedback,
    '\nSIGUIENTE PASO: ' + fields.nextStep
  ].join('\n');
  // Interactions API: interfaz recomendada por Google para nuevos proyectos.
  // El modelo se puede cambiar desde las propiedades del script sin editar código.
  const model = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || 'gemini-3.8-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      model: model,
      input: prompt,
      system_instruction: 'Eres un mentor pedagógico experto en evaluación formativa. Tu función es orientar, no calificar. Responde en español, con respeto, precisión y propuestas accionables.',
      store: false,
      generation_config: { temperature: 0.35, max_output_tokens: 450 }
    }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const rawResponse = response.getContentText() || '{}';
  let data = {};
  try { data = JSON.parse(rawResponse); } catch (_) { data = {}; }
  if (status < 200 || status >= 300) {
    console.error('Gemini Interactions API error ' + status + ': ' + rawResponse);
    throw new Error('El mentor IA no pudo generar la respuesta. Verifica la clave y el identificador del modelo configurado.');
  }
  const outputSteps = (data.steps || []).filter(step => step.type === 'model_output');
  const feedback = outputSteps
    .flatMap(step => step.content || [])
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join('\n')
    .trim();
  if (!feedback) throw new Error('El mentor IA respondió sin texto. Intenta nuevamente.');
  return { enabled: true, model: model, feedback: feedback };
}

function logoutUser_(token) {
  if (token) CacheService.getScriptCache().remove('session:' + String(token));
  return { message: 'Sesión cerrada.' };
}

function createSession_(userId) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('session:' + token, userId, SESSION_TTL_SECONDS);
  return token;
}

function requireSession_(token) {
  if (!token) throw new Error('Tu sesión no es válida. Inicia sesión nuevamente.');
  const userId = CacheService.getScriptCache().get('session:' + String(token));
  if (!userId) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
  return userId;
}

function findUserByEmail_(email) {
  const sheet = getSheet_(USERS_SHEET);
  if (sheet.getLastRow() < 2) return null;
  const found = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).createTextFinder(email).matchEntireCell(true).findNext();
  if (!found) return null;
  return userFromRow_(found.getRow(), sheet.getRange(found.getRow(), 1, 1, 12).getValues()[0]);
}

function findUserById_(id) {
  const sheet = getSheet_(USERS_SHEET);
  if (sheet.getLastRow() < 2) return null;
  const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) return null;
  return userFromRow_(found.getRow(), sheet.getRange(found.getRow(), 1, 1, 12).getValues()[0]);
}

function userFromRow_(rowIndex, row) {
  return {
    rowIndex: rowIndex,
    id: String(row[0]),
    name: String(row[1] || ''),
    email: String(row[2] || ''),
    salt: String(row[3] || ''),
    passwordHash: String(row[4] || ''),
    points: Number(row[5] || 0),
    completedJson: String(row[6] || '[]'),
    practiceDone: row[9] === true || String(row[9]).toLowerCase() === 'true',
    reflectionDone: row[10] === true || String(row[10]).toLowerCase() === 'true',
    scoreBreakdownJson: String(row[11] || '{}')
  };
}

function updateUser_(user, changes) {
  const sheet = getSheet_(USERS_SHEET);
  if (Object.prototype.hasOwnProperty.call(changes, 'points')) sheet.getRange(user.rowIndex, 6).setValue(changes.points);
  if (Object.prototype.hasOwnProperty.call(changes, 'completedJson')) sheet.getRange(user.rowIndex, 7).setValue(changes.completedJson);
  if (Object.prototype.hasOwnProperty.call(changes, 'practiceDone')) sheet.getRange(user.rowIndex, 10).setValue(changes.practiceDone);
  if (Object.prototype.hasOwnProperty.call(changes, 'reflectionDone')) sheet.getRange(user.rowIndex, 11).setValue(changes.reflectionDone);
  if (Object.prototype.hasOwnProperty.call(changes, 'scoreBreakdownJson')) sheet.getRange(user.rowIndex, 12).setValue(changes.scoreBreakdownJson);
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(digest);
}

function safeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function digestKey_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)).replace(/=+$/g, '');
}

function cleanEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail_(email) {
  if (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo electrónico válido.');
}

function validatePassword_(password) {
  if (password.length < 8 || password.length > 72) throw new Error('La contraseña debe tener entre 8 y 72 caracteres.');
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function parseJsonArray_(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch (_) { return []; }
}

function parseJsonObject_(value) {
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch (_) { return {}; }
}

function jsonOutput_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function friendlyError_(error) {
  const message = error && error.message ? error.message : String(error || 'Error desconocido.');
  return message.length > 240 ? message.slice(0, 240) : message;
}
