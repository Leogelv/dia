import './style.css';
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
} from "@heygen/streaming-avatar";
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { logger } from './utils/logger';

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

// DOM elements
const videoElement = document.getElementById("avatarVideo") as HTMLVideoElement;
const startButton = document.getElementById("startSession") as HTMLButtonElement;
const endButton = document.getElementById("endSession") as HTMLButtonElement;
const speakButton = document.getElementById("speakButton") as HTMLButtonElement;
const userInput = document.getElementById("userInput") as HTMLInputElement;
const statusText = document.querySelector(".status-text") as HTMLSpanElement;
const downloadLogsButton = document.getElementById("downloadLogs") as HTMLButtonElement;

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let conversationHistory: ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a helpful AI assistant at the Almaty Digital Forum. Keep your responses concise and engaging. Avoid long explanations unless specifically asked."
  }
];

// Helper function to validate API key format
function validateApiKey(apiKey: string): boolean {
  // HeyGen API ключи обычно base64-encoded и содержат дату
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return base64Regex.test(apiKey) && apiKey.length > 20;
}

// Helper function to fetch access token
async function fetchAccessToken(): Promise<string> {
  try {
    logger.info('Fetching HeyGen access token');
    const apiKey = import.meta.env.VITE_HEYGEN_API_KEY;
    
    if (!apiKey) {
      throw new Error('HeyGen API key is not configured');
    }

    if (!validateApiKey(apiKey)) {
      throw new Error('Invalid HeyGen API key format');
    }

    logger.debug('Making API request to HeyGen', { 
      url: 'https://api.heygen.com/v1/streaming.create_token',
      headers: { 'x-api-key': `${apiKey.substring(0, 8)}...` } 
    });

    const response = await fetch(
      "https://api.heygen.com/v1/streaming.create_token",
      {
        method: "POST",
        headers: { "x-api-key": apiKey },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HeyGen API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = await response.json();
    
    if (!data.data?.token) {
      throw new Error('Invalid response format: token not found in response');
    }

    logger.info('Successfully obtained access token');
    return data.data.token;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch access token', { 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      apiKeyPresent: !!import.meta.env.VITE_HEYGEN_API_KEY,
      apiKeyValid: import.meta.env.VITE_HEYGEN_API_KEY ? validateApiKey(import.meta.env.VITE_HEYGEN_API_KEY) : false
    });
    throw error;
  }
}

// Get response from OpenAI
async function getAIResponse(userMessage: string): Promise<string> {
  try {
    statusText.textContent = "AI Thinking...";
    logger.info('Getting AI response', { userMessage });
    
    // Add user message to history
    conversationHistory.push({ role: "user", content: userMessage });
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: conversationHistory,
      max_tokens: 150,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content || "Sorry, I couldn't generate a response.";
    logger.info('Received AI response', { aiResponse });
    
    // Add AI response to history
    conversationHistory.push({ role: "assistant", content: aiResponse });
    
    return aiResponse;
  } catch (error) {
    logger.error('OpenAI Error', error);
    return "Sorry, I encountered an error while processing your request.";
  } finally {
    statusText.textContent = "AI Ready";
  }
}

// Initialize streaming avatar session
async function initializeAvatarSession() {
  try {
    statusText.textContent = "Connecting...";
    logger.info('Initializing avatar session');
    
    const token = await fetchAccessToken();
    logger.debug('Creating StreamingAvatar instance');
    avatar = new StreamingAvatar({ token });

    logger.debug('Starting avatar with configuration', {
      quality: AvatarQuality.High,
      avatarName: "default"
    });

    sessionData = await avatar.createStartAvatar({
      quality: AvatarQuality.High,
      avatarName: "default",
    });

    if (!sessionData) {
      throw new Error('Failed to initialize avatar: No session data received');
    }

    logger.info('Avatar session initialized', { 
      sessionId: sessionData.sessionId,
      avatarId: sessionData.avatarId,
      status: sessionData.status 
    });

    endButton.disabled = false;
    startButton.disabled = true;

    // Подписываемся на события стрима
    avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
    avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
    
    statusText.textContent = "AI Ready";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Session initialization error', { 
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      apiKey: import.meta.env.VITE_HEYGEN_API_KEY ? 'Present' : 'Missing'
    });
    statusText.textContent = "Connection Failed";
    
    // Reset UI state
    endButton.disabled = true;
    startButton.disabled = false;
    avatar = null;
    sessionData = null;
    
    // Show error to user
    alert(`Failed to initialize avatar session: ${errorMessage}. Please check your API key and try again.`);
  }
}

// Handle when avatar stream is ready
function handleStreamReady(event: any) {
  if (event.detail && videoElement) {
    videoElement.srcObject = event.detail;
    videoElement.onloadedmetadata = () => {
      videoElement.play().catch((error) => {
        logger.error('Video playback error', error);
      });
    };
    logger.info('Stream ready, video playing');
  } else {
    logger.error('Stream is not available');
    console.error("Stream is not available");
  }
}

// Handle stream disconnection
function handleStreamDisconnected() {
  logger.info('Stream disconnected');
  if (videoElement) {
    videoElement.srcObject = null;
  }

  startButton.disabled = false;
  endButton.disabled = true;
  statusText.textContent = "Disconnected";
}

// End the avatar session
async function terminateAvatarSession() {
  if (!avatar || !sessionData) return;

  try {
    statusText.textContent = "Disconnecting...";
    logger.info('Terminating avatar session');
    
    await avatar.stopAvatar();
    videoElement.srcObject = null;
    avatar = null;
    conversationHistory = [conversationHistory[0]]; // Keep only the system message
    statusText.textContent = "Disconnected";
    
    logger.info('Avatar session terminated');
  } catch (error) {
    logger.error('Session termination error', error);
  }
}

// Handle speaking event
async function handleSpeak() {
  if (!avatar || !userInput.value) return;

  try {
    speakButton.disabled = true;
    statusText.textContent = "Processing...";
    
    const userMessage = userInput.value;
    userInput.value = ""; // Clear input immediately
    
    logger.info('Processing user input', { userMessage });
    
    const aiResponse = await getAIResponse(userMessage);
    
    statusText.textContent = "Speaking...";
    logger.info('Avatar speaking', { aiResponse });
    
    await avatar.speak({
      text: aiResponse,
    });
    
    statusText.textContent = "AI Ready";
  } catch (error) {
    logger.error('Speaking error', error);
    statusText.textContent = "Error";
  } finally {
    speakButton.disabled = false;
  }
}

// Handle stream error
function handleStreamError(error: any) {
  statusText.textContent = "Error";
  logger.error('Stream error occurred', error);
  
  // Reset UI state
  endButton.disabled = true;
  startButton.disabled = false;
  videoElement.srcObject = null;
  avatar = null;
  sessionData = null;
}

// Event listeners for buttons
startButton.addEventListener("click", initializeAvatarSession);
endButton.addEventListener("click", terminateAvatarSession);
speakButton.addEventListener("click", handleSpeak);
downloadLogsButton.addEventListener("click", () => logger.downloadLogs());

// Handle Enter key in input
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !speakButton.disabled) {
    handleSpeak();
  }
});
