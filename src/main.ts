import './style.css';
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskType,
} from "@heygen/streaming-avatar";
import { RealtimeLLM } from './realtime-llm';
import { logger } from './utils/logger';
import { OpenAIAssistant } from './openai-assistant';

// В начале файла
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  console.log('✅ Браузер поддерживает Web Speech API');
} else {
  console.error('❌ Браузер не поддерживает Web Speech API');
}

// Конфигурация
const CONFIG = {
  ASSISTANT_ID: import.meta.env.VITE_OPENAI_ASSISTANT_ID || '',
  OPENAI_API_KEY: import.meta.env.VITE_OPENAI_API_KEY || '',
  DEBUG: true
};

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
const startButton = document.getElementById("startSession") as HTMLButtonElement;
const endButton = document.getElementById("endSession") as HTMLButtonElement;
const statusText = document.querySelector(".status-text") as HTMLSpanElement;
const downloadLogsButton = document.getElementById("downloadLogs") as HTMLButtonElement;

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let llm: RealtimeLLM | null = null;
let openAIAssistant: OpenAIAssistant | null = null;

// Улучшенное логирование
function debugLog(message: string, data?: any) {
  if (CONFIG.DEBUG) {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] 🔄 ${message}`, data || '');
    logger.debug(message, data);
  }
}

// Функция для переключения видимости кнопок
function toggleSessionButtons(sessionStarted: boolean) {
  if (sessionStarted) {
    startButton.classList.add('hidden');
    endButton.classList.remove('hidden');
  } else {
    startButton.classList.remove('hidden');
    endButton.classList.add('hidden');
  }
}

// Функция для завершения всех активных сессий
async function terminateAllSessions() {
  try {
    debugLog('🧹 Завершаем все активные сессии');
    
    // Создаем временный инстанс для завершения сессий
    const token = await fetchAccessToken();
    const tempAvatar = new StreamingAvatar({ token });
    await tempAvatar.stopAvatar();
    
    debugLog('✅ Все сессии завершены');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Ждем 2 секунды
  } catch (error) {
    debugLog('❌ Ошибка при завершении сессий:', error);
    // Игнорируем ошибку, так как это не критично
    console.warn('Non-critical error during session termination:', error);
  }
}

// Initialize streaming avatar session
async function initializeAvatarSession() {
  try {
    debugLog('🚀 Начинаем инициализацию');
    statusText.textContent = "Подключение...";
    
    // Принудительно завершаем ВСЕ сессии перед стартом
    await terminateAllSessions();
    
    // Инициализируем OpenAI Assistant для голосового управления
    debugLog('🎤 Инициализация голосового ассистента');
    openAIAssistant = new OpenAIAssistant(CONFIG.OPENAI_API_KEY, CONFIG.ASSISTANT_ID);
    await openAIAssistant.initialize();
    openAIAssistant.startListening();
    
    // Инициализируем LLM
    debugLog('🤖 Инициализация LLM');
    llm = new RealtimeLLM(CONFIG.OPENAI_API_KEY, CONFIG.ASSISTANT_ID);
    await llm.initialize();
    
    debugLog('🎫 Получаем токен доступа для аватара');
    const token = await fetchAccessToken();
    
    // Пробуем создать аватара с несколькими попытками
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        debugLog('🎭 Создаем экземпляр StreamingAvatar (попытка ${retryCount + 1}/${maxRetries})');
        avatar = new StreamingAvatar({ token });

        // Добавляем слушатели событий стрима
        avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
        avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
        avatar.on('speaking_started', () => debugLog('🗣️ Аватар начал говорить'));
        avatar.on('speaking_ended', () => debugLog('🤐 Аватар закончил говорить'));
        avatar.on('error', (error) => debugLog('❌ Ошибка стрима:', error));
        avatar.on('closed', () => debugLog('🚫 Стрим закрыт'));

        debugLog('⚙️ Настраиваем конфигурацию аватара');
        sessionData = await avatar.createStartAvatar({
          quality: AvatarQuality.High,
          avatarName: "default",
          language: "Russian",
        });

        if (!sessionData) {
          throw new Error('Failed to initialize avatar: No session data received');
        }

        // Если дошли сюда, значит всё ок
        break;
      } catch (error) {
        retryCount++;
        if (error.message?.includes('Concurrent limit reached') && retryCount < maxRetries) {
          debugLog(`⚠️ Concurrent limit error, retrying... (${retryCount}/${maxRetries})`);
          await terminateAllSessions();
          await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // Увеличиваем задержку с каждой попыткой
        } else {
          throw error;
        }
      }
    }

    debugLog('✅ Инициализация завершена', sessionData);

    toggleSessionButtons(true);
    avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
    avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
    
    statusText.textContent = "ИИ Активен";

    window.avatar = avatar;
    window.llm = llm;
  } catch (error) {
    debugLog('❌ Ошибка инициализации:', error);
    handleError(error);
  }
}

// Handle when avatar stream is ready
function handleStreamReady(event: any) {
  debugLog('🎥 Стрим готов');
  if (event.detail && videoElement) {
    videoElement.srcObject = event.detail;
    videoElement.onloadedmetadata = () => {
      videoElement.play().catch(console.error);
    };
  } else {
    console.error("Stream is not available");
  }
}

// Handle stream disconnection
function handleStreamDisconnected() {
  debugLog('📴 Стрим отключен');
  if (videoElement) {
    videoElement.srcObject = null;
  }
  toggleSessionButtons(false);
  statusText.textContent = "ИИ Готов";
}

// End the avatar session
async function terminateAvatarSession() {
  if (!avatar || !sessionData) return;

  try {
    debugLog('🛑 Завершаем сессию');
    statusText.textContent = "Отключение...";
    
    // Останавливаем голосовое распознавание
    if (openAIAssistant) {
      openAIAssistant.stopListening();
      await openAIAssistant.cleanup();
      openAIAssistant = null;
    }
    
    if (llm) {
      await llm.cleanup();
      llm = null;
    }
    
    await avatar.stopAvatar();
    videoElement.srcObject = null;
    avatar = null;
    sessionData = null;
    
    statusText.textContent = "Отключено";
    toggleSessionButtons(false);
    
    debugLog('✅ Сессия завершена');
  } catch (error) {
    debugLog('❌ Ошибка при завершении сессии:', error);
    handleError(error);
  }
}

// Helper function to fetch access token
async function fetchAccessToken(): Promise<string> {
  const apiKey = import.meta.env.VITE_HEYGEN_API_KEY;
  const response = await fetch(
    "https://api.heygen.com/v1/streaming.create_token",
    {
      method: "POST",
      headers: { "x-api-key": apiKey },
    }
  );

  const { data } = await response.json();
  return data.token;
}

// Event listeners
startButton.addEventListener("click", initializeAvatarSession);
endButton.addEventListener("click", terminateAvatarSession);
downloadLogsButton.addEventListener("click", () => logger.downloadLogs());

// Функция обработки ошибок
function handleError(error: any) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  logger.error('Error occurred', { 
    error: errorMessage,
    stack: error instanceof Error ? error.stack : undefined
  });
  statusText.textContent = "Ошибка";
  alert(`Произошла ошибка: ${errorMessage}`);
}
