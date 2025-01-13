import OpenAI from 'openai';

export class OpenAIAssistant {
  private openai: OpenAI;
  private assistantId: string;
  private thread: any;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistantId = assistantId;
  }

  async initialize() {
    this.thread = await this.openai.beta.threads.create();
    console.log('🧵 Thread created:', this.thread.id);
  }

  async getResponse(message: string): Promise<string> {
    // Добавляем сообщение в тред
    await this.openai.beta.threads.messages.create(this.thread.id, {
      role: "user",
      content: message
    });

    // Запускаем выполнение
    const run = await this.openai.beta.threads.runs.create(this.thread.id, {
      assistant_id: this.assistantId
    });

    // Ждем завершения
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
        
        // Получаем последнее сообщение ассистента
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

      // Ждем немного перед следующей проверкой
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
  }
} 