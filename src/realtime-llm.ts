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
  private transcriptBuffer: string[] = [];

  private lastUpdateTime: number = Date.now();

  private readonly UPDATE_INTERVAL = 3 * 60 * 1000; // 5 минут

  private fileId: string | null = null;

  private updateTimer: NodeJS.Timer | null = null;

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
      console.log(`[${new Date().toLocaleTimeString()}] 🗣 Распознано1:`, text);
      // Добавляем текст в буфер

      await this.checkAndUpdateContext(text);
      
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
  
  private async checkAndUpdateContext(text: string) {

    this.transcriptBuffer.push(text);

    console.log('📝 Добавлен текст в буфер, размер:', this.transcriptBuffer.length);



    const now = Date.now();

    if (now - this.lastUpdateTime >= this.UPDATE_INTERVAL) {

      console.log('⏰ Обновляем контекст...');

      await this.updateTranscriptFile();

      this.lastUpdateTime = now;

    }

  }
  private async updateTranscriptFile() {
    try {
      if (this.transcriptBuffer.length === 0) {
        console.log('📝 Буфер пуст, пропускаем обновление');
        return;
      }

      const fullTranscript = this.transcriptBuffer.join('\n');
      console.log('📝 Создаем новый файл транскрипции:', fullTranscript);
      
      const vectorStoreId = import.meta.env.VITE_OPENAI_VECTOR_STORE;
      
      // Создаем файлРаспознано
      const blob = new Blob([fullTranscript], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('purpose', 'assistants');
      formData.append('file', blob, 'transcript.txt');

      const response = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openai.apiKey}`,
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const newFile = await response.json();
      console.log('✅ Новый файл создан:', newFile.id);

      // Если есть старый файл, удаляем его
      if (this.fileId) {
        console.log('🗑️ Удаляем старый файл из vector store:', this.fileId);
        await this.openai.beta.vectorStores.files.del(
          vectorStoreId,
          this.fileId
        );
        await this.openai.files.del(this.fileId);
      }

      // Добавляем новый файл в vector store
      await this.openai.beta.vectorStores.files.create(
        vectorStoreId,
        {
          file_id: newFile.id
        }
      );

      this.fileId = newFile.id;
      console.log('✅ Контекст успешно обновлен');
    } catch (error) {
      console.error('❌ Ошибка при обновлении контекста:', error);
      throw error;
    }
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
        console.log(`[${new Date().toLocaleTimeString()}] 🗣 Распознано2:`, text);
        
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
      this.updateTimer = setInterval(async () => {

          if (this.transcriptBuffer.length > 0) {

            await this.updateTranscriptFile();

            this.lastUpdateTime = Date.now();

          }

        }, this.UPDATE_INTERVAL);
    }
  }

  stopListening() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
    }
  }

  async cleanup() {
    this.stopListening();
    await this.assistant.cleanup();
  }
} 