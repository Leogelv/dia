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

    // Слушаем события аватара
    (window as any).avatar?.on('speaking_started', () => {
      console.log('🗣️ Аватар начал говорить - отключаем микрофон');
      this.stopListening();
    });

    (window as any).avatar?.on('speaking_ended', () => {
      console.log('🤐 Аватар закончил говорить - включаем микрофон');
      // Включаем микрофон только если не обрабатываем команду
      if (!this.isSpeaking) {
        setTimeout(() => this.startListening(), 100);
      }
    });
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
              content: "Ты дружелюбный и энергичный мультиязычный ассистент на выставке Digital Almaty. Ты свободно говоришь на русском, английском и казахском языках. Отвечай на том языке, на котором к тебе обращаются, используя только буквы этого языка без смайликов и специальных символов. Используй функцию get_assistant_response для поиска информации в базе знаний. Отвечай развернуто, с энтузиазмом и харизмой, как настоящий ведущий на технологической выставке. Если видишь технические термины - объясняй их просто и понятно. Используй знаки препинания (запятые, точки) для естественных пауз в речи."
            },
            { role: "user", content: cleanCommand }
          ],
          temperature: 0.7,
          max_tokens: 150,
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

          // Буфер для накопления текста
          let textBuffer = '';
          let lastSpeakPromise = Promise.resolve();
          
          // Собираем и озвучиваем ответ по частям
          for await (const chunk of this.assistant.streamResponse(query)) {
            textBuffer += chunk;
            
            // Проверяем есть ли знаки препинания
            const punctuationMatch = textBuffer.match(/[,.!?]+\s*/);
            
            if (punctuationMatch) {
              const punctuationIndex = punctuationMatch.index! + punctuationMatch[0].length;
              const completePhrase = textBuffer.slice(0, punctuationIndex).trim();
              
              if (completePhrase) {
                console.log('🗣️ Озвучиваем фразу:', completePhrase);
                // Используем Promise для параллельного выполнения
                lastSpeakPromise = window.avatar?.speak({
                  text: completePhrase,
                  task_type: TaskType.REPEAT
                });
              }
              
              // Оставляем в буфере текст после знака препинания
              textBuffer = textBuffer.slice(punctuationIndex);
            }
          }
          
          // Ждем завершения последней фразы
          await lastSpeakPromise;
          
          // Озвучиваем остаток текста, если он есть
          if (textBuffer.trim()) {
            console.log('🗣️ Озвучиваем последнюю фразу:', textBuffer);
            await window.avatar?.speak({
              text: textBuffer.trim(),
              task_type: TaskType.REPEAT
            });
          }

        } else {
          // Если GPT решил ответить сам - стримим его ответ
          const simpleResponse = response.choices[0]?.message?.content || "Извини, я не смог сформулировать ответ";
          
          // Разбиваем ответ на фразы по знакам препинания
          const phrases = simpleResponse.match(/[^,.!?]+[,.!?]+/g) || [simpleResponse];
          
          for (const phrase of phrases) {
            const cleanPhrase = phrase.trim();
            if (cleanPhrase) {
              console.log('🗣️ Озвучиваем фразу:', cleanPhrase);
              await window.avatar?.speak({
                text: cleanPhrase,
                task_type: TaskType.REPEAT
              });
            }
          }
        }

      } finally {
        this.isSpeaking = false;
        // Не включаем микрофон здесь - он включится по событию speaking_ended
      }
    } catch (error) {
      console.error('❌ Ошибка обработки команды:', error);
      this.isSpeaking = false;
      // Не включаем микрофон здесь - он включится по событию speaking_ended
    }
  }

  private async generateWaitingResponse(query: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        {
          role: "system",
          content: "Генерируй ОЧЕНЬ короткую фразу (3-5 слов) для промежуточного ответа на чистом языке запроса (русский/английский/казахский) без смайликов и специальных символов."
        },
        { 
          role: "user", 
          content: `Сгенерируй промежуточную фразу для запроса: "${query}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 20
    });

    return response.choices[0]?.message?.content || "Сейчас посмотрю";
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