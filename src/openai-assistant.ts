import OpenAI from 'openai';

export class OpenAIAssistant {
  private openai: OpenAI;
  private assistantId: string;
  private thread: any = null;
  private fileId: string | null = null;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistantId = assistantId;
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

    // Добавляем сообщение пользователя
    await this.openai.beta.threads.messages.create(this.thread.id, {
      role: "user",
      content: message
    });

    // Запускаем ассистента
    const run = await this.openai.beta.threads.runs.create(this.thread.id, {
      assistant_id: this.assistantId
    });

    let lastMessageId = null;

    // Стримим ответ в реальном времени
    while (true) {
      const runStatus = await this.openai.beta.threads.runs.retrieve(
        this.thread.id,
        run.id
      );

      if (runStatus.status === 'completed') {
        break;
      }

      if (runStatus.status === 'failed') {
        throw new Error(`Run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
      }

      // Получаем новые сообщения
      const messages = await this.openai.beta.threads.messages.list(this.thread.id);
      
      // Проверяем новые сообщения
      for (const message of messages.data) {
        if (message.role === 'assistant' && message.id !== lastMessageId) {
          lastMessageId = message.id;
          if (message.content[0]?.type === 'text') {
            yield message.content[0].text.value;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async updateContext(text: string) {
    try {
      // Создаем файл
      const blob = new Blob([text], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('purpose', 'assistants');
      formData.append('file', blob, 'context.txt');

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

      // Если есть старый файл, удаляем его
      if (this.fileId) {
        await this.openai.files.del(this.fileId);
      }

      this.fileId = newFile.id;
    } catch (error) {
      console.error('❌ Ошибка при обновлении контекста:', error);
      throw error;
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