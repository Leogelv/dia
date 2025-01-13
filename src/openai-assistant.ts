import OpenAI from 'openai';

export class OpenAIAssistant {
  private openai: OpenAI;
  private assistantId: string;
  private thread: any = null;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistantId = assistantId;
  }

  async initialize() {
    // Создаем или получаем ассистента
    const assistant = await this.openai.beta.assistants.create({
      name: "Russian Speaking Assistant",
      instructions: "Ты дружелюбный русскоговорящий ассистент. Отвечай кратко, по делу и в разговорном стиле.",
      model: "gpt-4o",
    });
    this.assistantId = assistant.id;
    console.log('🤖 Assistant created:', this.assistantId);

    // Создаем тред
    this.thread = await this.openai.beta.threads.create();
    console.log('🔄 Thread created:', this.thread.id);
  }

  async *streamResponse(userMessage: string) {
    if (!this.thread) {
      throw new Error('Assistant not initialized');
    }

    console.log('🚀 Начинаем стриминг для сообщения:', userMessage);

    // Добавляем сообщение пользователя
    await this.openai.beta.threads.messages.create(this.thread.id, {
      role: "user",
      content: userMessage
    });
    console.log('✅ Сообщение добавлено в тред');

    // Запускаем ассистента
    const run = await this.openai.beta.threads.runs.create(this.thread.id, {
      assistant_id: this.assistantId,
      model: "gpt-4o",
      instructions: "Отвечай кратко и по делу. Используй разговорный стиль."
    });
    console.log('🤖 Запущен run:', run.id);

    // Стримим ответ в реальном времени
    let response = await this.openai.beta.threads.runs.retrieve(this.thread.id, run.id);
    console.log('📡 Статус:', response.status);
    let lastMessageId = null;

    while (response.status === 'queued' || response.status === 'in_progress') {
      // Получаем новые сообщения
      const messages = await this.openai.beta.threads.messages.list(this.thread.id);
      console.log('📨 Получено сообщений:', messages.data.length);
      
      // Проверяем новые сообщения
      for (const message of messages.data) {
        console.log('👀 Проверяем сообщение:', message.id, message.role);
        if (message.role === 'assistant' && message.id !== lastMessageId) {
          lastMessageId = message.id;
          if (message.content[0]?.type === 'text') {
            console.log('🎯 Новый чанк:', message.content[0].text.value);
            yield message.content[0].text.value;
          }
        }
      }

      // Маленькая задержка между проверками
      await new Promise(resolve => setTimeout(resolve, 100));
      response = await this.openai.beta.threads.runs.retrieve(this.thread.id, run.id);
      console.log('📡 Новый статус:', response.status);
    }

    console.log('🏁 Стриминг завершен');
  }

  async cleanup() {
    if (this.thread) {
      this.thread = null;
    }
  }
} 