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
  private thread: any;
  private recognition: any;
  private isListening: boolean = false;
  private transcriptBuffer: string[] = [];
  private lastUpdateTime: number = Date.now();
  private readonly UPDATE_INTERVAL = 1 * 60 * 1000; // 1 минута
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

      const grammar = '#JSGF V1.0; grammar keywords; public <keyword> = дия | диа | дія | dia | diya;';
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
        
        const keywords = ['дия', 'diya', 'диа', 'dia', 'дія'];
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
      const text = command.toLowerCase();
      const keywords = ['дия', 'diya', 'диа', 'dia', 'дія'];
      
      const hasKeyword = keywords.some(keyword => text.includes(keyword));
      if (!hasKeyword) {
        console.log('🤖 Игнорирую команду без ключевого слова');
        return;
      }

      const cleanCommand = text
        .replace(/дия|diya|диа|dia|дія/gi, '')
        .trim();

      if (!cleanCommand) {
        console.log('🤖 Пустая команда после удаления ключевого слова');
        return;
      }

      console.log('🤖 Отправка голосовой команды ассистенту:', cleanCommand);
      
      // Временно останавливаем распознавание во время обработки команды
      this.recognition.stop();
      
      if (window.llm) {
        let textBuffer = '';
        const sentenceEnd = /[.!?]\s+/;

        for await (const chunk of window.llm.streamResponse(cleanCommand)) {
          textBuffer += chunk;
          
          if (sentenceEnd.test(textBuffer) || textBuffer.length > 150) {
            const sentences = textBuffer.split(sentenceEnd);
            
            textBuffer = sentences.pop() || '';
            
            for (const sentence of sentences) {
              if (sentence.trim()) {
                await window.avatar.speak({
                  text: sentence.trim(),
                  task_type: TaskType.REPEAT
                });
              }
            }
          }
        }

        if (textBuffer.trim()) {
          await window.avatar.speak({
            text: textBuffer.trim(),
            task_type: TaskType.REPEAT
          });
        }
      }
      
      // Перезапускаем распознавание после обработки команды
      if (this.isListening) {
        console.log('🎤 Перезапуск распознавания после команды...');
        setTimeout(() => {
          try {
            this.recognition.start();
          } catch (error) {
            console.error('❌ Ошибка при перезапуске распознавания:', error);
          }
        }, 100);
      }
    } catch (error) {
      console.error('❌ Ошибка при обработке голосовой команды:', error);
      // Убедимся, что распознавание перезапустится даже при ошибке
      if (this.isListening) {
        setTimeout(() => {
          try {
            this.recognition.start();
          } catch (error) {
            console.error('❌ Ошибка при перезапуске распознавания после ошибки:', error);
          }
        }, 100);
      }
    }
  }

  public async startListening() {
    if (!this.isListening) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());

        console.log('✅ Доступ к микрофону получен');
        
        await this.initialize();
        console.log('▶️ Запуск прослушивания...');
        
        // Запускаем таймер обновления контекста
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
    this.thread = await this.openai.beta.threads.create();
    console.log('🧵 Thread created:', this.thread.id);
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

      if (run.status === 'completed') {
        const messages = await this.openai.beta.threads.messages.list(
          this.thread.id
        );
        
        const lastMessage = messages.data
          .filter(msg => msg.role === 'assistant')[0];
          
        if (lastMessage && lastMessage.content[0].type === 'text') {
          return lastMessage.content[0].text.value;
        }
        return 'No response';
      }

      if (run.status === 'failed') {
        throw new Error('Assistant run failed');
      }

      await new Promise(resolve => setTimeout(resolve, 500));
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
      
      // Создаем файл и FormData
      const blob = new Blob([fullTranscript], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('purpose', 'assistants');
      formData.append('file', blob, 'transcript.txt');

      // Отправляем запрос напрямую через fetch
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

      if (this.fileId) {
        console.log('🗑️ Удаляем старый файл:', this.fileId);
        try {
          await this.openai.files.del(this.fileId);
          console.log('✅ Старый файл удален');
        } catch (error) {
          console.error('⚠️ Ошибка при удалении старого файла:', error);
        }
      }

      console.log('🔄 Обновляем ассистента с новым файлом...');
      await this.openai.beta.assistants.update(this.assistantId, {
        file_ids: [newFile.id]
      });

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
} 