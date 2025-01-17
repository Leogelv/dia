import OpenAI from 'openai';
import { OpenAIAssistant } from './openai-assistant';
import { TaskType } from "@heygen/streaming-avatar";
import { WebSocketService } from './services/WebSocketService';

declare global {
  interface Window {
    avatar: {
      speak: (params: { text: string, task_type: TaskType }) => Promise<void>;
      on: (event: string, callback: () => void) => void;
    };
  }
}

export class RealtimeLLM {
  private openai: OpenAI;
  private assistant: OpenAIAssistant;
  private webSocket: WebSocketService;
  private isListening: boolean = false;
  //private isSpeaking: boolean = false;
  private transcriptBuffer: string[] = [];
  private lastUpdateTime: number = Date.now();
  private readonly UPDATE_INTERVAL = 3 * 60 * 1000; // 3 минуты
  private updateTimer: number | null = null;

  // Аудио компоненты
  private audioContext: AudioContext | null = null;
  private audioStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistant = new OpenAIAssistant(apiKey, assistantId);
    this.webSocket = new WebSocketService();

    // Слушаем события аватара
    window.avatar?.on('AVATAR_TALKING_MESSAGE', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Аватар говорит - снижаем чувствительность микрофона`);
    });
  }

  private async initAudio() {
    try {
      // Получаем доступ к микрофону
      this.audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000
        } 
      });
      
      // Создаем AudioContext
      this.audioContext = new AudioContext({
        sampleRate: 16000
      });

      // Создаем процессор для обработки аудио
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Обработка аудио данных
      this.processor.onaudioprocess = (e) => {
        if (!this.webSocket.isConnected) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        
        // Конвертация float32 в int16
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Отправка аудио данных через WebSocket
        this.webSocket.sendAudioData(pcmData.buffer);
      };

      console.log('🎤 Аудио инициализировано');
    } catch (error) {
      console.error('❌ Ошибка инициализации аудио:', error);
      throw error;
    }
  }

  private cleanupAudio() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.processor = null;
  }

  private async checkAndUpdateContext(text: string) {
    this.transcriptBuffer.push(text);
    console.log('📝 Добавлен текст в буфер, размер:', this.transcriptBuffer.length);

    const now = Date.now();
    if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {
      console.log('⏰ Обновляем контекст...');
      await this.assistant.updateTranscriptFile(this.transcriptBuffer);
      this.lastUpdateTime = now;
    }
  }

  private cleanText(text: string): string {
    // Удаляем ссылки на документы, например 【8:0†transcript.txt】
    return text.replace(/【\d+:\d+†[^】]+】/g, '').trim();
  }

  private async handleCommand(command: string) {
    try {
      //this.isSpeaking = true;
      // Очищаем команду от всех возможных ключевых слов
      const cleanCommand = command.replace(/дия|диа|dia|diya|ассистент|assistant/gi, '').trim();
      
      console.log(`[${new Date().toLocaleTimeString()}] 📝 Обрабатываем команду:`, cleanCommand);

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Ты дружелюбная ассистентка. Твой пол - женский. Отвечай кратко, без смайликов и спецсимволов, на языке запроса."
          },
          { role: "user", content: cleanCommand }
        ],
        temperature: 0.7,
        max_tokens: 150,
        tools: [{
          type: "function",
          function: {
            name: "get_assistant_response",
            description: "Get response from knowledge base",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query"
                }
              },
              required: ["query"]
            }
          }
        }],
        tool_choice: "auto"
      });

      if (response.choices[0]?.message?.tool_calls) {
        // Если нужен поиск в базе знаний
        const toolCall = response.choices[0].message.tool_calls[0];
        const query = JSON.parse(toolCall.function.arguments).query.trim();
        
        console.log(`[${new Date().toLocaleTimeString()}] 🔧 Поиск в базе знаний:`, { query });

        // Запускаем генерацию промежуточного ответа параллельно
        console.log(`[${new Date().toLocaleTimeString()}] 🤔 Генерируем промежуточную фразу...`);
        const waitingResponse = await this.generateWaitingResponse(cleanCommand);

        // Начинаем стримить ответ сразу
        console.log(`[${new Date().toLocaleTimeString()}] 📡 Начинаем стримить основной ответ...`);
        const responseStream = this.assistant.streamResponse(query);
        
        // Озвучиваем промежуточную фразу целиком
        console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Озвучиваем промежуточную фразу целиком`);
        await window.avatar?.speak({
          text: this.cleanText(waitingResponse),
          task_type: TaskType.REPEAT
        });
        
        // Буфер для накопления текста
        let textBuffer = '';
        let lastSpeakPromise = Promise.resolve();
        
        // Собираем и озвучиваем ответ по частям
        for await (const chunk of responseStream) {
          textBuffer += chunk;
          
          // Проверяем есть ли знаки препинания
          const punctuationMatch = textBuffer.match(/[,.!?]+\s*/);
          
          if (punctuationMatch) {
            const punctuationIndex = punctuationMatch.index! + punctuationMatch[0].length;
            const completePhrase = textBuffer.slice(0, punctuationIndex).trim();
            
            if (completePhrase) {
              console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Озвучиваем фразу:`, completePhrase);
              lastSpeakPromise = window.avatar?.speak({
                text: this.cleanText(completePhrase),
                task_type: TaskType.REPEAT
              });
            }
            
            textBuffer = textBuffer.slice(punctuationIndex);
          }
        }
        
        // Ждем завершения последней фразы
        await lastSpeakPromise;
        
        // Озвучиваем остаток текста
        if (textBuffer.trim()) {
          console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Озвучиваем последнюю фразу:`, textBuffer);
          await window.avatar?.speak({
            text: this.cleanText(textBuffer.trim()),
            task_type: TaskType.REPEAT
          });
        }
      } else {
        // Простой ответ - разбиваем по точкам и озвучиваем по частям
        const simpleResponse = response.choices[0]?.message?.content || "Извини, я не смогла сформулировать ответ";
        console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Простой ответ:`, simpleResponse);
        
        // Разбиваем на фразы по точкам
        const phrases = simpleResponse.split(/(?<=\.)\s*/);
        let lastSpeakPromise = Promise.resolve();

        for (const phrase of phrases) {
          const cleanPhrase = phrase.trim();
          if (cleanPhrase) {
            console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Озвучиваем фразу:`, cleanPhrase);
            lastSpeakPromise = window.avatar?.speak({
              text: this.cleanText(cleanPhrase),
              task_type: TaskType.REPEAT
            });
            // Ждем небольшую паузу между фразами
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        // Ждем завершения последней фразы
        await lastSpeakPromise;
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ Ошибка:`, error);
    } finally {
      //this.isSpeaking = false;
    }
  }

  private async generateWaitingResponse(query: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Генерируй одно предложение для промежуточного ответа на языке запроса без смайликов. Твой пол - женский."
        },
        { role: "user", content: `Сгенерируй промежуточную фразу для: "${query}"` }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    return response.choices[0]?.message?.content?.trim() || "Сейчас посмотрю";
  }

  async initialize() {
    await this.assistant.initialize();
    this.startListening();
  }

  startListening() {
    if (!this.isListening) {
      this.isListening = true;
      
      // Подключаемся к WebSocket и инициализируем аудио
      this.webSocket.connect()
        .then(() => this.initAudio())
        .then(() => {
          console.log('✅ Распознавание речи запущено');
          
          // Настраиваем обработчик сообщений
          this.webSocket.onMessage(async (response) => {
            if (response.type === 'final') {
              const text = response.data.text.toLowerCase();
              console.log(`[${new Date().toLocaleTimeString()}] 🗣 Распознано:`, text);
              
              await this.checkAndUpdateContext(text);
              
              // Проверяем ключевые слова на разных языках
              if (text.includes('дия') || 
                  text.includes('диа') || 
                  text.includes('dia') || 
                  text.includes('diya') ||
                  text.includes('ассистент') || 
                  text.includes('assistant')) {
                console.log(`[${new Date().toLocaleTimeString()}] 🎯 Обнаружено ключевое слово:`, text);
                await this.handleCommand(text);
              }
            }
          });

          // Обработчик закрытия соединения
          this.webSocket.onClose(() => {
            console.log('🔌 WebSocket закрыт - останавливаем распознавание');
            this.stopListening();
          });
        })
        .catch(error => {
          console.error('❌ Ошибка запуска распознавания:', error);
          this.isListening = false;
        });

      // Запускаем таймер обновления контекста
      this.updateTimer = setInterval(async () => {
        if (this.transcriptBuffer.length > 0) {
          await this.assistant.updateTranscriptFile(this.transcriptBuffer);
          this.lastUpdateTime = Date.now();
        }
      }, this.UPDATE_INTERVAL);
    }
  }

  stopListening() {
    if (this.isListening) {
      this.isListening = false;
      this.cleanupAudio();
      this.webSocket.close();
      
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }

      console.log('✅ Распознавание речи остановлено');
    }
  }

  async cleanup() {
    this.stopListening();
    await this.assistant.cleanup();
  }
} 