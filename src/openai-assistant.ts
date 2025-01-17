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

  async updateTranscriptFile(transcriptBuffer: string[]) {
    try {
      if (transcriptBuffer.length === 0) {
        console.log('📝 Буфер пуст, пропускаем обновление');
        return;
      }

      const fullTranscript = transcriptBuffer.join('\n');
      console.log('📝 Создаем новый файл транскрипции:', fullTranscript);
      
      const vectorStoreId = import.meta.env.VITE_OPENAI_VECTOR_STORE;
      
      // Создаем файл
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

  async initialize() {
    if (!this.thread) {
      this.thread = await this.openai.beta.threads.create();
      console.log('🧵 Thread created:', this.thread.id);
    }
  }

  private cleanText(text: string): string {
    // Удаляем ссылки на документы, например 【4:0†transcript.txt】
    return text.replace(/【\d+:\d+†[^】]+】/g, '').trim();
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
            // Очищаем текст от ссылок на документы перед отправкой
            const cleanText = this.cleanText(message.content[0].text.value);
            console.log('🤖 Ответ от ассистента:', cleanText);
            
            yield cleanText;
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