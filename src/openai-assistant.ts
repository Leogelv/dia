import OpenAI from 'openai';
import { TaskType } from "@heygen/streaming-avatar";

interface Window {
  webkitSpeechRecognition: any;
  avatar: any;
  llm: any;
}

export class OpenAIAssistant {
  private openai: OpenAI;
  private assistantId: string;
  private thread: any = null;
  private recognition: any;
  private isListening: boolean = false;
  private transcriptBuffer: string[] = [];
  private lastUpdateTime: number = Date.now();
  private readonly UPDATE_INTERVAL = 5 * 60 * 1000;
  private fileId: string | null = null;
  private updateTimer: NodeJS.Timer | null = null;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistantId = assistantId;
    this.initSpeechRecognition();
  }

  private initSpeechRecognition() {
    try {
      if (!(window as any).webkitSpeechRecognition && !(window as any).SpeechRecognition) {
        console.error('❌ Web Speech API не поддерживается в этом браузере');
        throw new Error('Web Speech API не поддерживается в этом браузере');
      }

      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      console.log('✅ Web Speech API доступен');

      this.recognition = new SpeechRecognition();
      console.log('✅ Создан экземпляр SpeechRecognition');
      
      this.recognition.lang = 'ru-RU';
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 3;

      const grammar = '#JSGF V1.0; grammar keywords; public <keyword> = ассистент | assistant;';
      const speechRecognitionList = new (window as any).webkitSpeechGrammarList();
      speechRecognitionList.addFromString(grammar, 1);
      this.recognition.grammars = speechRecognitionList;

      this.recognition.onstart = () => {
        console.log('🎤 Голосовое распознавание запущено');
        this.isListening = true;
      };

      this.recognition.onend = () => {
        console.log('🎤 Голосовое распознавание остановлено');
        if (this.isListening) {
          console.log('🔄 Перезапуск распознавания...');
          setTimeout(() => {
            try {
              this.recognition.start();
            } catch (error) {
              console.error('❌ Ошибка при перезапуске распознавания:', error);
            }
          }, 100);
        }
      };

      this.recognition.onresult = async (event: any) => {
        const last = event.results.length - 1;
        const text = event.results[last][0].transcript.trim();
        console.log('🗣 Распознанный текст:', text);
        
        await this.checkAndUpdateContext(text);
        
        const keywords = ['ассистент', 'assistant'];
        const hasKeyword = keywords.some(keyword => text.toLowerCase().includes(keyword));
        
        if (hasKeyword) {
          await this.processVoiceCommand(text);
        }
      };

      this.recognition.onerror = (event: any) => {
        console.error('❌ Ошибка распознавания речи:', event.error);
        if (event.error === 'not-allowed') {
          console.error('🚫 Доступ к микрофону не получен');
          this.isListening = false;
        }
      };

      console.log('✅ Обработчики событий установлены');

    } catch (error) {
      console.error('❌ Ошибка при инициализации распознавания речи:', error);
      throw error;
    }
  }

  private async processVoiceCommand(command: string) {
    try {
      const startTime = Date.now();
      console.time('🕒 Полное время обработки команды');
      
      const text = command.toLowerCase();
      const keywords = ['ассистент', 'assistant'];
      
      const hasKeyword = keywords.some(keyword => text.includes(keyword));
      if (!hasKeyword) return;

      const cleanCommand = text
        .replace(/ассистент|assistant/gi, '')
        .trim();

      if (!cleanCommand) return;

      console.log('🤖 Отправка команды:', cleanCommand);
      this.recognition.stop();
      
      // Создаем сообщение
      console.time('🕒 Создание сообщения');
      await this.openai.beta.threads.messages.create(this.thread.id, {
        role: "user",
        content: cleanCommand
      });
      console.timeEnd('🕒 Создание сообщения');

      // Запускаем run
      console.time('🕒 Запуск run');
      const run = await this.openai.beta.threads.runs.create(this.thread.id, {
        assistant_id: this.assistantId
      });
      console.timeEnd('🕒 Запуск run');

      let lastMessageId: string | null = null;
      let textBuffer = '';

      // Стримим ответ
      while (true) {
        console.time('🕒 Итерация получения ответа');
        const messages = await this.openai.beta.threads.messages.list(this.thread.id);
        const runStatus = await this.openai.beta.threads.runs.retrieve(
          this.thread.id,
          run.id
        );

        // Проверяем новые сообщения
        for (const message of messages.data) {
          if (message.role === 'assistant' && message.id !== lastMessageId) {
            lastMessageId = message.id;
            if (message.content[0]?.type === 'text') {
              const newText = message.content[0].text.value;
              console.log(`📝 Новый текст (${Date.now() - startTime}мс):`, newText);
              
              // Сразу отправляем в HeyGen
              await window.avatar.speak({
                text: newText.trim(),
                task_type: TaskType.REPEAT
              });
            }
          }
        }

        console.timeEnd('🕒 Итерация получения ответа');

        if (runStatus.status === 'completed') {
          console.log(`✅ Выполнение завершено через ${Date.now() - startTime}мс`);
          break;
        }
        if (runStatus.status === 'failed') {
          throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (this.isListening) {
        setTimeout(() => this.recognition.start(), 100);
      }

      console.timeEnd('🕒 Полное время обработки команды');
    } catch (error) {
      console.error('❌ Ошибка:', error);
      if (this.isListening) {
        setTimeout(() => this.recognition.start(), 100);
      }
    }
  }

  public async startListening() {
    if (!this.isListening) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        console.log('✅ Доступ к микрофону получен');
        
        console.log('▶️ Запуск прослушивания...');
        
        this.updateTimer = setInterval(async () => {
          if (this.transcriptBuffer.length > 0) {
            console.log('⏰ Таймер: обновляем контекст...');
            await this.updateTranscriptFile();
            this.lastUpdateTime = Date.now();
          }
        }, this.UPDATE_INTERVAL);
        
        this.recognition.start();
        console.log('✅ Команда на запуск распознавания отправлена');
      } catch (error) {
        console.error('❌ Ошибка при запуске прослушивания:', error);
        this.isListening = false;
        throw error;
      }
    }
  }

  public stopListening() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      
      // Останавливаем таймер
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
    }
  }

  async initialize() {
    if (!this.thread) {
      this.thread = await this.openai.beta.threads.create();
      console.log('🧵 Thread created:', this.thread.id);
    }
  }

  async getResponse(message: string): Promise<string> {
    await this.openai.beta.threads.messages.create(this.thread.id, {
      role: "user",
      content: message
    });

    const run = await this.openai.beta.threads.runs.create(this.thread.id, {
      assistant_id: this.assistantId
    });

    let response = await this.waitForResponse(run.id);
    return response;
  }

  private async waitForResponse(runId: string): Promise<string> {
    while (true) {
      const run = await this.openai.beta.threads.runs.retrieve(
        this.thread.id,
        runId
      );

      console.log('🔄 Статус выполнения:', run.status);

      switch (run.status) {
        case 'completed':
          const messages = await this.openai.beta.threads.messages.list(
            this.thread.id
          );
          
          const lastMessage = messages.data
            .filter(msg => msg.role === 'assistant')[0];
            
          if (lastMessage && lastMessage.content[0].type === 'text') {
            return lastMessage.content[0].text.value;
          }
          return 'No response';

        case 'failed':
          console.error('❌ Run failed:', {
            error: run.last_error,
            status: run.status,
            id: run.id
          });
          throw new Error(`Assistant run failed: ${run.last_error?.message || 'Unknown error'}`);

        case 'requires_action':
          console.log('⚡ Run requires action:', run.required_action);
          // Здесь можно добавить обработку required_action если нужно
          break;

        case 'expired':
          throw new Error('Assistant run expired');

        case 'cancelled':
          throw new Error('Assistant run was cancelled');

        case 'in_progress':
        case 'queued':
          // Продолжаем ждать
          await new Promise(resolve => setTimeout(resolve, 500));
          break;

        default:
          console.warn('⚠️ Неизвестный статус:', run.status);
          await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async cleanup() {
    if (this.thread) {
      try {
        await this.openai.beta.threads.del(this.thread.id);
        console.log('🧹 Thread deleted:', this.thread.id);
      } catch (error) {
        console.error('Error deleting thread:', error);
      }
    }
    
    if (this.fileId) {
      try {
        //await this.openai.files.del(this.fileId);
        //console.log('🧹 File deleted:', this.fileId);
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }
  }

  private async updateTranscriptFile() {
    try {
      const fullTranscript = this.transcriptBuffer.join('\n');
      console.log('📝 Создаем новый файл транскрипции...');
      console.log("КОНТЕНТ ФАЙЛА:", fullTranscript);
      
      // Создаем файл
      const blob = new Blob([fullTranscript], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('purpose', 'assistants');
      formData.append('file', blob, 'transcript.txt');

      const response = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openai.apiKey}`,
          "OpenAI-Beta": `assistants=v2`
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const newFile = await response.json();
      console.log('✅ Новый файл создан:', newFile.id);

      const vectorStoreId = import.meta.env.VITE_OPENAI_VECTOR_STORE;

      // Если есть старый файл, удаляем его из vector store и OpenAI
      if (this.fileId) {
        console.log('🗑️ Удаляем старый файл из vector store:', this.fileId);
        try {
          await this.openai.beta.vectorStores.files.del(
            vectorStoreId,
            this.fileId
          );
          console.log('✅ Файл удален из vector store');
          
          await this.openai.files.del(this.fileId);
          console.log('✅ Файл удален из OpenAI');
        } catch (error) {
          console.error('⚠️ Ошибка при удалении старого файла:', error);
        }
      }

      // Добавляем новый файл в vector store
      console.log('📥 Добавляем файл в vector store...');
      await this.openai.beta.vectorStores.files.create(
        vectorStoreId,
        {
          file_id: newFile.id
        }
      );
      console.log('✅ Файл добавлен в vector store');

      this.fileId = newFile.id;
      console.log('✅ Контекст успешно обновлен, новый файл:', newFile.id);
    } catch (error) {
      console.error('❌ Ошибка при обновлении файла контекста:', error);
      throw error;
    }
  }

  private async checkAndUpdateContext(newText: string) {
    this.transcriptBuffer.push(newText);
    console.log('📝 Добавлен новый текст, всего в буфере:', this.transcriptBuffer.length);
  }

  async *streamResponse(userMessage: string) {
    // Сразу начинаем проверять новые сообщения
    while (response.status === 'queued' || response.status === 'in_progress') {
      const messages = await this.openai.beta.threads.messages.list(this.thread.id);
      
      // Отдаем каждое новое сообщение сразу через yield
      for (const message of messages.data) {
        if (message.role === 'assistant' && message.id !== lastMessageId) {
          lastMessageId = message.id;
          if (message.content[0]?.type === 'text') {
            yield message.content[0].text.value;
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      response = await this.openai.beta.threads.runs.retrieve(this.thread.id, run.id);
    }
  }
} 