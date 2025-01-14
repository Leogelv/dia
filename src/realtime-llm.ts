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

  constructor(apiKey: string, assistantId: string) {
    this.openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });
    this.assistant = new OpenAIAssistant(apiKey, assistantId);
    this.initSpeechRecognition();
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
        console.log('🎤 Распознавание запущено');
        this.isListening = true;
      };

      this.recognition.onend = () => {
        console.log('🎤 Распознавание остановлено');
        if (this.isListening && !this.isSpeaking) {
          setTimeout(() => this.recognition.start(), 100);
        }
      };

      this.recognition.onresult = async (event: any) => {
        const text = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log('🗣 Распознано:', text);
        
        // Проверяем на ключевое слово
        if (text.includes('ассистент') || text.includes('assistant')) {
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
      const cleanCommand = command
        .replace(/ассистент|assistant/gi, '')
        .trim();

      if (!cleanCommand) return;

      this.isSpeaking = true;
      this.recognition.stop();

      try {
        // Первый запрос к GPT для выбора функции
        const response = await this.openai.chat.completions.create({
          model: "gpt-4-1106-preview",
          messages: [
            {
              role: "system",
              content: "Ты дружелюбный и энергичный мультиязычный ассистент на выставке Digital Almaty. Ты свободно говоришь на русском, английском и казахском языках. Отвечай на том языке, на котором к тебе обращаются. Используй функцию get_assistant_response для поиска информации в базе знаний. Отвечай развернуто, с энтузиазмом и харизмой, как настоящий ведущий на технологической выставке. Если видишь технические термины - объясняй их просто и понятно."
            },
            { role: "user", content: cleanCommand }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "get_assistant_response",
                description: "Получает ответ из базы знаний ассистента",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Запрос к базе знаний"
                    }
                  },
                  required: ["query"]
                }
              }
            }
          ],
          tool_choice: "auto"
        });

        const toolCall = response.choices[0]?.message?.tool_calls?.[0];
        
        if (toolCall) {
          // Если GPT хочет использовать функцию
          const args = JSON.parse(toolCall.function.arguments);
          const query = args.query?.trim() || cleanCommand;
          
          // Проверяем что запрос не пустой
          if (!query) {
            console.warn('⚠️ Пустой запрос от GPT, используем оригинальный текст');
            await window.avatar?.speak({
              text: "Извини, я не смог правильно сформулировать запрос к базе знаний. Попробуй переформулировать вопрос.",
              task_type: TaskType.REPEAT
            });
            return;
          }

          console.log('🔧 Вызываем функцию с аргументами:', { query });

          // Промежуточный ответ только при поиске в базе знаний
          const waitingResponse = await this.generateWaitingResponse(cleanCommand);
          await window.avatar?.speak({
            text: waitingResponse,
            task_type: TaskType.REPEAT
          });

          // Собираем ответ из стрима в строку
          let functionResponse = '';
          for await (const chunk of this.assistant.streamResponse(query)) {
            functionResponse += chunk;
          }

          // Проверяем что получили ответ
          if (!functionResponse.trim()) {
            console.warn('⚠️ Пустой ответ от функции');
            await window.avatar?.speak({
              text: "Извини, я не нашел информации по этому запросу в базе знаний. Попробуй спросить по-другому.",
              task_type: TaskType.REPEAT
            });
            return;
          }

          console.log('📝 Ответ от функции:', functionResponse);

          // Отправляем ответ функции аватару
          await window.avatar?.speak({
            text: functionResponse,
            task_type: TaskType.REPEAT
          });

        } else {
          // Если GPT решил ответить сам - сразу отвечаем без промежуточной фразы
          const simpleResponse = response.choices[0]?.message?.content || "Извини, я не смог сформулировать ответ";
          await window.avatar?.speak({
            text: simpleResponse,
            task_type: TaskType.REPEAT
          });
        }

      } finally {
        this.isSpeaking = false;
        if (this.isListening) {
          setTimeout(() => this.recognition.start(), 100);
        }
      }
    } catch (error) {
      console.error('❌ Ошибка обработки команды:', error);
      this.isSpeaking = false;
      if (this.isListening) {
        setTimeout(() => this.recognition.start(), 100);
      }
    }
  }

  private async generateWaitingResponse(query: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: "Ты генерируешь короткую живую фразу (максимум 10-15 слов) для промежуточного ответа, пока идет поиск информации. Фраза должна быть уместной контексту запроса и звучать естественно, как будто человек реально задумался над вопросом. Используй разговорный стиль, можешь добавлять слова типа 'так', 'хм', 'дай подумать'. Не используй стандартные фразы типа 'секундочку' или 'минутку'."
        },
        { 
          role: "user", 
          content: `Сгенерируй промежуточную фразу для запроса: "${query}"`
        }
      ],
      temperature: 0.9,
      max_tokens: 50
    });

    return response.choices[0]?.message?.content || "Хм, интересный вопрос, дай подумаю...";
  }

  async initialize() {
    await this.assistant.initialize();
    this.startListening();
  }

  startListening() {
    if (!this.isListening) {
      this.recognition.start();
    }
  }

  stopListening() {
    if (this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
  }

  async cleanup() {
    this.stopListening();
    await this.assistant.cleanup();
  }
} 