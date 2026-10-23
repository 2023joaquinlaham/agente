// Referencias a elementos del DOM usando los nombres indicados
const zonaDeChat = document.getElementById('zona-de-chat');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');

// Variables de estado anti-spam y control de peticiones
let isSending = false;
const COOLDOWN_TIME = 2000; // 2 segundos entre envíos
const TIMEOUT_LIMIT = 10000; // 10 segundos tiempo límite

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
 * Función principal para gestionar el envío de mensajes
 */
async function enviarMensaje() {
  const mensaje = userInput.value.trim();

  // Validaciones previas
  if (!mensaje || isSending) return;

  // Bloquear interfaz para evitar múltiples envíos
  bloquearInterfaz(true);
  
  // 1. Mostrar mensaje del usuario en la zona de chat
  agregarMensajeAlDOM(mensaje, 'user');
  limpiarInput();

  // 2. Mostrar estado visual de 'cargando'
  const loadingElement = mostrarIndicadorCarga();

  // 3. Preparar AbortController para timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_LIMIT);

  try {
    // Petición asíncrona al Webhook configurado
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: mensaje }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status}`);
    }

    const data = await response.json();
    
    // Remover indicador de carga
    removerElemento(loadingElement);

    // 4. Mostrar respuesta exitosa del agente
    const respuestaAgente = data.reply || data.message || "Solicitud procesada correctamente.";
    agregarMensajeAlDOM(respuestaAgente, 'bot');

  } catch (error) {
    clearTimeout(timeoutId);
    removerElemento(loadingElement);

    // Manejo de errores visual en el DOM
    if (error.name === 'AbortError') {
      agregarMensajeAlDOM("La consulta tardó demasiado tiempo en responder. Intente nuevamente.", 'error');
    } else {
      // Simulación de respuesta cuando el webhook de prueba falla o no existe
      console.warn("Error en la conexión con el Webhook. Generando respuesta simulada para pruebas:", error.message);
      
      const respuestaSimulada = obtenerRespuestaSimulada(mensaje);
      agregarMensajeAlDOM(respuestaSimulada, 'bot');
    }
  } finally {
    // Aplicar temporizador de espera (cooldown) antes de rehabilitar
    setTimeout(() => {
      bloquearInterfaz(false);
    }, COOLDOWN_TIME);
  }
}

/**
 * Agrega burbujas de mensaje a la zona de chat
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
  loadingDiv.innerHTML = `
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  `;
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

/**
 * Función fallback para simular respuestas médicas mientras se integra el webhook real
 */
function obtenerRespuestaSimulada(consulta) {
  const texto = consulta.toLowerCase();
  if (texto.includes('turno') || texto.includes('cita')) {
    return "Para solicitar un turno, necesitás presentar tu DNI y carnet de cobertura en recepción, o realizarlo desde el portal web en la sección 'Mis Turnos'.";
  } else if (texto.includes('receta') || texto.includes('medicamento')) {
    return "Las recetas digitales tienen una validez de 30 días desde su fecha de emisión. Podés consultarlas en la app oficial.";
  }
  return `He recibido tu consulta sobre: "${consulta}". Recordá que para trámites presenciales el horario de atención es de 08:00 a 16:00 hs.`;
}
