import OpenAI from 'openai';
import { OpenAIAssistant } from './openai-assistant';

export class RealtimeLLM {
  private openai: OpenAI;
  private assistant: OpenAIAssistant;

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistant = new OpenAIAssistant(apiKey, assistantId);
  }

  async initialize() {
    await this.assistant.initialize();
  }

  async *streamResponse(userMessage: string) {
    console.log('🚀 Starting realtime stream for:', userMessage);

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "getAssistantResponse",
          description: "Получить ответ от основного ассистента HeyGen",
          parameters: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "Сообщение для отправки ассистенту"
              }
            },
            required: ["message"]
          }
        }
      }
    ];

    const stream = await this.openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: `Ты дружелюбный русскоговорящий ассистент. 
          ВАЖНО: Если пользователь спрашивает про ассистента или просит обратиться к нему - 
          ВСЕГДА используй функцию getAssistantResponse и передай сообщение пользователя.
          В остальных случаях отвечай сам кратко и по делу.`
        },
        { role: "user", content: userMessage }
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 150,
      tools: tools,
      tool_choice: {
        type: "function",
        function: { name: "getAssistantResponse" }
      }
    });

    let currentMessage = '';
    let isToolCallStarted = false;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        console.log('📝 Streaming chunk:', content);
        yield content;
      }

      // Проверяем вызов функции
      const toolCall = chunk.choices[0]?.delta?.tool_calls?.[0];
      if (toolCall?.type === 'function' && 
          toolCall.function?.name === 'getAssistantResponse' && 
          toolCall.function?.arguments && 
          !isToolCallStarted) {
        try {
          isToolCallStarted = true;
          const args = JSON.parse(toolCall.function.arguments);
          console.log('🔄 Calling assistant with message:', args.message);
          const response = await this.assistant.streamResponse(args.message);
          for await (const assistantChunk of response) {
            console.log('🤖 Assistant chunk:', assistantChunk);
            yield assistantChunk;
          }
        } catch (error) {
          console.error('Error calling assistant:', error);
          throw new Error('Ошибка при вызове ассистента');
        }
      }
    }
  }

  async cleanup() {
    await this.assistant.cleanup();
  }
} 