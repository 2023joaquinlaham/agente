// Referencias a elementos del DOM
const zonaDeChat = document.getElementById('zona-de-chat');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');

// Variables de estado anti-spam y control de peticiones
let isSending = false;
const COOLDOWN_TIME = 1500; // 1,5 segundos entre envíos
const TIMEOUT_LIMIT = 30000; // 30 segundos tiempo límite
const MAX_CARACTERES = 500;

// Identificador único de sesión
const sessionId = obtenerSessionId();

/**
 * Obtiene o genera un identificador de sesión persistente
 */
function obtenerSessionId() {
  const claveStorage = 'promptin_session_id';
  let idGuardado = null;

  try {
    idGuardado = localStorage.getItem(claveStorage);
  } catch (e) {
    // Almacenamiento no disponible
  }

  if (idGuardado) return idGuardado;

  const nuevoId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (e) {
    // Continuar usando la variable en memoria
  }

  return nuevoId;
}

// Auto-ajuste de altura para el textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = `${userInput.scrollHeight}px`;
});

// Evento de envío con Enter
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    enviarMensaje();
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarMensaje();
});

/**
 * Detecta y devuelve la URL del webhook desde config.js
 */
function obtenerUrlWebhook() {
  // Buscar en variables globales comunes por si se modificó el nombre en config.js
  const posiblesVariables = [
    typeof WEBHOOK_URL !== 'undefined' ? WEBHOOK_URL : null,
    typeof webhookUrl !== 'undefined' ? webhookUrl : null,
    typeof URL_WEBHOOK !== 'undefined' ? URL_WEBHOOK : null,
    typeof MAKE_WEBHOOK_URL !== 'undefined' ? MAKE_WEBHOOK_URL : null,
    window.WEBHOOK_URL,
    window.webhookUrl
  ];

  for (const valor of posiblesVariables) {
    if (typeof valor === 'string') {
      const urlLimpia = valor.trim();
      const esPlaceholder = urlLimpia.includes('ACA VA') || urlLimpia.includes('ejemplo-webhook-prueba');
      
      if (urlLimpia.startsWith('http') && !esPlaceholder) {
        return urlLimpia;
      }
    }
  }

  return null;
}

/**
 * Función principal para gestionar el envío de mensajes
 */
async function enviarMensaje() {
  const mensaje = userInput.value.trim();

  // Validaciones previas
  if (!mensaje || isSending) return;

  if (mensaje.length > MAX_CARACTERES) {
    agregarMensajeAlDOM(`El mensaje supera el límite de ${MAX_CARACTERES} caracteres.`, 'error');
    return;
  }

  // Obtener y validar la URL desde config.js
  const urlDestino = obtenerUrlWebhook();
  if (!urlDestino) {
    agregarMensajeAlDOM('No se encontró una URL válida en config.js. Revisá que la constante sea const WEBHOOK_URL = "https://..." y recargá la página con Ctrl + F5.', 'error');
    return;
  }

  // Bloquear interfaz para evitar múltiples envíos
  bloquearInterfaz(true);

  // 1. Mostrar mensaje del usuario en la zona de chat
  agregarMensajeAlDOM(mensaje, 'user');
  limpiarInput();

  // 2. Mostrar estado visual de 'cargando'
  const loadingElement = mostrarIndicadorCarga();

  // 3. Preparar AbortController para timeout de 30s
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_LIMIT);

  try {
    const payload = {
      sessionId: sessionId,
      mensaje: mensaje,
      fecha: new Date().toISOString()
    };

    const response = await fetch(urlDestino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const textoCrudo = (await response.text()).trim();

    if (!response.ok) {
      const errorServidor = new Error(`Make respondió con error (código ${response.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`);
      errorServidor.esErrorServidor = true;
      throw errorServidor;
    }

    const textoFinal = procesarRespuestaMake(textoCrudo);
    agregarMensajeAlDOM(textoFinal, 'bot');

  } catch (error) {
    if (error.name === 'AbortError') {
      agregarMensajeAlDOM('La consulta tardó demasiado tiempo en responder (más de 30 segundos). Intentá nuevamente.', 'error');
    } else if (error.esErrorServidor) {
      agregarMensajeAlDOM(error.message, 'error');
    } else {
      agregarMensajeAlDOM('No se pudo conectar con el servidor. Revisá tu conexión a internet o la URL en config.js.', 'error');
    }
  } finally {
    clearTimeout(timeoutId);
    removerElemento(loadingElement);

    // Pausa mínima de 1,5 segundos antes de rehabilitar
    setTimeout(() => {
      bloquearInterfaz(false);
    }, COOLDOWN_TIME);
  }
}

/**
 * Analiza y limpia la respuesta de Make tolerando Markdown o saltos de línea sin escapar
 */
function procesarRespuestaMake(texto) {
  if (!texto) {
    return '(respuesta vacía)';
  }

  // Quitar posibles envoltorios de bloque de código Markdown
  let limpio = texto
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!limpio) {
    return '(respuesta vacía)';
  }

  const camposPrioridad = ['response', 'respuesta', 'message', 'mensaje'];
  let datos = null;
  let parseadoOk = false;

  try {
    datos = JSON.parse(limpio);
    parseadoOk = true;
  } catch (e) {
    // Si parece un objeto JSON, intentar reparar saltos de línea crudos dentro de strings
    if (limpio.startsWith('{') && limpio.endsWith('}')) {
      try {
        const reparado = limpio.replace(/"((?:[^"\\]|\\.)*)"/gs, (match, contenido) => {
          const escapado = contenido
            .replace(/\r\n/g, '\\n')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
          return `"${escapado}"`;
        });
        datos = JSON.parse(reparado);
        parseadoOk = true;
      } catch (e2) {
        // Extraer por expresión regular como último recurso
        for (const campo of camposPrioridad) {
          const regex = new RegExp(`"${campo}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\})`, 'i');
          const coincidencia = limpio.match(regex);
          if (coincidencia && coincidencia[1].trim()) {
            return coincidencia[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
          }
        }
      }
    }
  }

  // Si se logró analizar el JSON
  if (parseadoOk) {
    if (datos !== null && typeof datos === 'object' && !Array.isArray(datos)) {
      for (const campo of camposPrioridad) {
        if (typeof datos[campo] === 'string' && datos[campo].trim() !== '') {
          return datos[campo];
        }
      }
      return 'Make respondió, pero sin el campo response';
    }
    // Si es número, booleano, null, array o string suelto entre comillas
    return limpio;
  }

  // Texto plano real
  return limpio;
}

/**
 * Agrega burbujas de mensaje a la zona de chat usando textContent
 */
function agregarMensajeAlDOM(texto, tipo) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', `message-${tipo}`);
  msgDiv.textContent = texto;

  zonaDeChat.appendChild(msgDiv);
  hacerScrollAlFinal();
}

/**
 * Muestra animación de cargando
 */
function mostrarIndicadorCarga() {
  const loadingDiv = document.createElement('div');
  loadingDiv.classList.add('message', 'message-bot', 'loading-indicator');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.classList.add('dot');
    loadingDiv.appendChild(dot);
  }
  zonaDeChat.appendChild(loadingDiv);
  hacerScrollAlFinal();
  return loadingDiv;
}

function removerElemento(elem) {
  if (elem && elem.parentNode) {
    elem.parentNode.removeChild(elem);
  }
}

function hacerScrollAlFinal() {
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

function limpiarInput() {
  userInput.value = '';
  userInput.style.height = 'auto';
}

function bloquearInterfaz(bloquear) {
  isSending = bloquear;
  sendBtn.disabled = bloquear;
  userInput.disabled = bloquear;
  if (!bloquear) {
    userInput.focus();
  }
}
