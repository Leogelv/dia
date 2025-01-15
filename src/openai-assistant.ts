import OpenAI from 'openai';
import { YandexSpeechRecognition } from './yandex-speechkit';

export class OpenAIAssistant {
  private openai: OpenAI;
  private assistantId: string;
  private thread: any = null;
  private recognition: YandexSpeechRecognition;
  private isListening: boolean = false;
  private transcriptBuffer: string[] = [];
  private lastUpdateTime: number = Date.now();
  private readonly UPDATE_INTERVAL = 0.5 * 60 * 1000; // 5 минут
  private fileId: string | null = null;
  private updateTimer: NodeJS.Timer | null = null;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistantId = assistantId;
    
    this.recognition = new YandexSpeechRecognition(
      import.meta.env.VITE_YANDEX_API_KEY
    );

    this.recognition.onResult(async (text) => {
      console.log('🗣 Распознанный текст:', text);
      
      // Добавляем текст в буфер
      await this.checkAndUpdateContext(text);
      
      const keywords = ['ассистент', 'assistant'];
      const hasKeyword = keywords.some(keyword => text.toLowerCase().includes(keyword));
      
      if (hasKeyword) {
        await this.processVoiceCommand(text);
      }
    });

    this.recognition.onError((error) => {
      console.error('❌ Ошибка распознавания речи:', error);
    });
  }

  private async checkAndUpdateContext(text: string) {
    this.transcriptBuffer.push(text);
    console.log('📝 Добавлен текст в буфер, размер:', this.transcriptBuffer.length);

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    console.log(`⏱ Время с последнего обновления: ${Math.round(timeSinceLastUpdate / 1000)}с`);

    if (timeSinceLastUpdate >= this.UPDATE_INTERVAL) {
      console.log('⏰ Обновляем контекст...');
      await this.updateTranscriptFile();
      this.lastUpdateTime = now;
      // Очищаем буфер после успешного обновления
      this.transcriptBuffer = [];
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
      formData.append('purpose', 'file-search');
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

  public async startListening() {
    if (!this.isListening) {
      try {
        await this.recognition.start();
        this.isListening = true;
        console.log('✅ Распознавание речи запущено');
        
        // Запускаем таймер обновления контекста
        this.updateTimer = setInterval(async () => {
          if (this.transcriptBuffer.length > 0) {
            await this.updateTranscriptFile();
            this.lastUpdateTime = Date.now();
          }
        }, this.UPDATE_INTERVAL);
        
      } catch (error) {
        console.error('❌ Ошибка при запуске распознавания:', error);
        this.isListening = false;
        throw error;
      }
    }
  }

  public stopListening() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
      
      if (this.updateTimer) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
      }
      
      console.log('✅ Распознавание речи остановлено');
    }
  }

  async initialize() {
    if (!this.thread) {
      this.thread = await this.openai.beta.threads.create();
      console.log('🧵 Thread created:', this.thread.id);
    }
  }

  async *streamResponse(message: string) {
    if (!this.thread) {
      throw new Error('Assistant not initialized');
    }

    // Получаем текущие сообщения до запроса
    const beforeMessages = await this.openai.beta.threads.messages.list(this.thread.id);
    const beforeMessageIds = new Set(beforeMessages.data.map(m => m.id));

    // Добавляем сообщение пользователя
    await this.openai.beta.threads.messages.create(this.thread.id, {
      role: "user",
      content: message
    });

    // Запускаем ассистента
    const run = await this.openai.beta.threads.runs.create(this.thread.id, {
      assistant_id: this.assistantId,
    });

    // Ждем завершения
    while (true) {
      const runStatus = await this.openai.beta.threads.runs.retrieve(
        this.thread.id,
        run.id
      );

      if (runStatus.status === 'completed') {
        // Получаем все сообщения после завершения
        const afterMessages = await this.openai.beta.threads.messages.list(this.thread.id);
        
        // Фильтруем только новые сообщения
        const newMessages = afterMessages.data.filter(m => !beforeMessageIds.has(m.id));
        
        // Возвращаем текст из новых сообщений
        for (const message of newMessages) {
          if (message.role === 'assistant' && message.content[0]?.type === 'text') {
            console.log('🤖 Ответ от ассистента:', message.content[0].text.value);
            
            yield message.content[0].text.value;
          }
        }
        break;
      }

      if (runStatus.status === 'failed') {
        throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async cleanup() {
    if (this.thread) {
      try {
        await this.openai.beta.threads.del(this.thread.id);
      } catch (error) {
        console.error('Error deleting thread:', error);
      }
    }
    
    if (this.fileId) {
      try {
        await this.openai.files.del(this.fileId);
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }
  }
} 