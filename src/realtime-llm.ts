import OpenAI from 'openai';
import { OpenAIAssistant } from './openai-assistant';
import { TaskType } from "@heygen/streaming-avatar";

interface Window {
  webkitSpeechRecognition: any;
  avatar: any;
}

export class RealtimeLLM {
  private openai: OpenAI;
  private assistant: OpenAIAssistant;
  private recognition: any;
  private isListening: boolean = false;
  private isSpeaking: boolean = false;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistant = new OpenAIAssistant(apiKey, assistantId);
    this.initSpeechRecognition();

    // Слушаем события аватара
    (window as any).avatar?.on('AVATAR_TALKING_MESSAGE', () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Аватар говорит - снижаем чувствительность микрофона`);
      // Здесь можно добавить логику снижения чувствительности
    });

    // Удаляем старые обработчики speaking_started и speaking_ended
    
    // Модифицируем обработку результатов распознавания
    this.recognition.onresult = async (event: any) => {
      const text = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
      console.log(`[${new Date().toLocaleTimeString()}] 🗣 Распознано:`, text);
      
      // Проверяем на ключевое слово
      if (text.includes('ассистент') || text.includes('assistant')) {
        console.log(`[${new Date().toLocaleTimeString()}] 🎯 Обнаружено ключевое слово - начинаем обработку`);
        await this.handleCommand(text);
      }
    };

    this.recognition.onend = () => {
      console.log(`[${new Date().toLocaleTimeString()}] 🎤 Распознавание остановлено`);
      // Всегда перезапускаем распознавание
      setTimeout(() => this.recognition.start(), 100);
    };
  }

  private initSpeechRecognition() {
    try {
      if (!(window as any).webkitSpeechRecognition && !(window as any).SpeechRecognition) {
        console.error('❌ Web Speech API не поддерживается');
        throw new Error('Web Speech API не поддерживается');
      }

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      this.recognition = new SpeechRecognition();
      
      this.recognition.lang = 'ru-RU';
      this.recognition.continuous = true;
      this.recognition.interimResults = false;

      this.recognition.onstart = () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🎤 Распознавание запущено`);
        this.isListening = true;
      };

      this.recognition.onend = () => {
        console.log(`[${new Date().toLocaleTimeString()}] 🎤 Распознавание остановлено`);
        if (this.isListening && !this.isSpeaking) {
          setTimeout(() => this.recognition.start(), 100);
        }
      };

      this.recognition.onresult = async (event: any) => {
        const text = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log(`[${new Date().toLocaleTimeString()}] 🗣 Распознано:`, text);
        
        // Проверяем на ключевое слово
        if (text.includes('ассистент') || text.includes('assistant')) {
          console.log(`[${new Date().toLocaleTimeString()}] 🎯 Обнаружено ключевое слово - начинаем обработку`);
          await this.handleCommand(text);
        }
      };

    } catch (error) {
      console.error('❌ Ошибка инициализации речи:', error);
      throw error;
    }
  }

  private async handleCommand(command: string) {
    try {
      this.isSpeaking = true;
      const cleanCommand = command.replace(/ассистент|assistant/gi, '').trim();
      
      console.log(`[${new Date().toLocaleTimeString()}] 📝 Обрабатываем команду:`, cleanCommand);

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Ты дружелюбный ассистент. Отвечай кратко, без смайликов и спецсимволов, на языке запроса."
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
          text: waitingResponse,
          task_type: TaskType.REPEAT
        });
        console.log(`[${new Date().toLocaleTimeString()}] ✅ Промежуточная фраза озвучена`);
        
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
                text: completePhrase,
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
            text: textBuffer.trim(),
            task_type: TaskType.REPEAT
          });
        }
      } else {
        // Простой ответ - разбиваем по точкам и озвучиваем по частям
        const simpleResponse = response.choices[0]?.message?.content || "Извини, я не смог сформулировать ответ";
        console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Простой ответ:`, simpleResponse);
        
        // Разбиваем на фразы по точкам
        const phrases = simpleResponse.split(/(?<=\.)\s*/);
        let lastSpeakPromise = Promise.resolve();

        for (const phrase of phrases) {
          const cleanPhrase = phrase.trim();
          if (cleanPhrase) {
            console.log(`[${new Date().toLocaleTimeString()}] 🗣️ Озвучиваем фразу:`, cleanPhrase);
            lastSpeakPromise = window.avatar?.speak({
              text: cleanPhrase,
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
      this.isSpeaking = false;
    }
  }

  private async generateWaitingResponse(query: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "ты типа развлекалка: генерируешь одно или два длинных предложение для промежуточного ответа на чистом языке запроса (русский/английский/казахский) без смайликов и специальных символов пока юзер ждет ответ от openai assistant."
        },
        { 
          role: "user", 
          content: `Сгенерируй одно предложение для промежуточной фразы для запроса: "${query}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    const waitingResponse = response.choices[0]?.message?.content?.trim() || "Сейчас посмотрю";
    console.log(`[${new Date().toLocaleTimeString()}] 💭 Сгенерирована промежуточная фраза (${waitingResponse.length} символов):`, waitingResponse);
    return waitingResponse;
  }

  async initialize() {
    await this.assistant.initialize();
    this.startListening();
  }

  startListening() {
    if (!this.isListening) {
      this.recognition.start();
    }
  }

  stopListening() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }

  async cleanup() {
    this.stopListening();
    await this.assistant.cleanup();
  }
} 