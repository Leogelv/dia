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

    // Получаем ответ от ассистента
    const assistantResponse = await this.assistant.getResponse(userMessage);
    console.log('📝 Got assistant response:', assistantResponse);

    // Создаем стрим с ответом ассистента
    const stream = await this.openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: "Ты дружелюбный русскоговорящий ассистент. Твоя задача - красиво и грамотно озвучить ответ другого ассистента, разбивая его на удобные для произношения части."
        },
        { 
          role: "user", 
          content: `Озвучь этот ответ ассистента: ${assistantResponse}` 
        }
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 150
    });

    // Стримим ответ по частям
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        console.log('📝 Streaming chunk:', content);
        yield content;
      }
    }
  }

  async cleanup() {
    await this.assistant.cleanup();
  }
} 