import './style.css';
import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
} from "@heygen/streaming-avatar";
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

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

let avatar: StreamingAvatar | null = null;
let sessionData: any = null;
let conversationHistory: ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a helpful AI assistant at the Almaty Digital Forum. Keep your responses concise and engaging. Avoid long explanations unless specifically asked."
  }
];

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

// Get response from OpenAI
async function getAIResponse(userMessage: string): Promise<string> {
  try {
    statusText.textContent = "AI Thinking...";
    
    // Add user message to history
    conversationHistory.push({ role: "user", content: userMessage });
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: conversationHistory,
      max_tokens: 150,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content || "Sorry, I couldn't generate a response.";
    
    // Add AI response to history
    conversationHistory.push({ role: "assistant", content: aiResponse });
    
    return aiResponse;
  } catch (error) {
    console.error("OpenAI Error:", error);
    return "Sorry, I encountered an error while processing your request.";
  } finally {
    statusText.textContent = "AI Ready";
  }
}

// Initialize streaming avatar session
async function initializeAvatarSession() {
  try {
    statusText.textContent = "Connecting...";
    const token = await fetchAccessToken();
    avatar = new StreamingAvatar({ token });

    sessionData = await avatar.createStartAvatar({
      quality: AvatarQuality.High,
      avatarName: "default",
    });

    console.log("Session data:", sessionData);

    endButton.disabled = false;
    startButton.disabled = true;

    avatar.on(StreamingEvents.STREAM_READY, handleStreamReady);
    avatar.on(StreamingEvents.STREAM_DISCONNECTED, handleStreamDisconnected);
    
    statusText.textContent = "AI Ready";
  } catch (error) {
    console.error("Session Error:", error);
    statusText.textContent = "Connection Failed";
  }
}

// Handle when avatar stream is ready
function handleStreamReady(event: any) {
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
  console.log("Stream disconnected");
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
    await avatar.stopAvatar();
    videoElement.srcObject = null;
    avatar = null;
    conversationHistory = [conversationHistory[0]]; // Keep only the system message
    statusText.textContent = "Disconnected";
  } catch (error) {
    console.error("Termination Error:", error);
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
    
    const aiResponse = await getAIResponse(userMessage);
    
    statusText.textContent = "Speaking...";
    await avatar.speak({
      text: aiResponse,
    });
    
    statusText.textContent = "AI Ready";
  } catch (error) {
    console.error("Speaking Error:", error);
    statusText.textContent = "Error";
  } finally {
    speakButton.disabled = false;
  }
}

// Event listeners for buttons
startButton.addEventListener("click", initializeAvatarSession);
endButton.addEventListener("click", terminateAvatarSession);
speakButton.addEventListener("click", handleSpeak);

// Handle Enter key in input
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !speakButton.disabled) {
    handleSpeak();
  }
});
