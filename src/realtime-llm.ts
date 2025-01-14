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
      if (!this.isSpeaking) {
        this.startListening();
        this.isListening = true;
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
        // Быстрый промежуточный ответ без запроса к GPT
        const quickResponse = "Хм, сейчас посмотрю...";
        await window.avatar?.speak({
          text: quickResponse,
          task_type: TaskType.REPEAT
        });

        // Сразу начинаем стримить ответ от ассистента
        let textBuffer = '';
        let isFirstChunk = true;
        
        for await (const chunk of this.assistant.streamResponse(cleanCommand)) {
          textBuffer += chunk;
          
          // Проверяем есть ли знаки препинания
          const punctuationMatch = textBuffer.match(/[,.!?]+\s*/);
          
          if (punctuationMatch || isFirstChunk) {
            const punctuationIndex = punctuationMatch ? punctuationMatch.index! + punctuationMatch[0].length : textBuffer.length;
            const completePhrase = textBuffer.slice(0, punctuationIndex).trim();
            
            if (completePhrase) {
              console.log('🗣️ Озвучиваем фразу:', completePhrase);
              await window.avatar?.speak({
                text: completePhrase,
                task_type: TaskType.REPEAT
              });
            }
            
            // Оставляем в буфере текст после знака препинания
            textBuffer = textBuffer.slice(punctuationIndex);
            isFirstChunk = false;
          }
        }
        
        // Озвучиваем остаток текста, если он есть
        if (textBuffer.trim()) {
          console.log('🗣️ Озвучиваем последнюю фразу:', textBuffer);
          await window.avatar?.speak({
            text: textBuffer.trim(),
            task_type: TaskType.REPEAT
          });
        }

      } finally {
        this.isSpeaking = false;
        // Микрофон включится автоматически по событию speaking_ended
      }
    } catch (error) {
      console.error('❌ Ошибка обработки команды:', error);
      this.isSpeaking = false;
      // Микрофон включится автоматически по событию speaking_ended
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
      console.log('🎤 Включаем микрофон');
      this.recognition.start();
      this.isListening = true;
    }
  }

  stopListening() {
    if (this.isListening) {
      console.log('🎤 Выключаем микрофон');
      this.recognition.stop();
      this.isListening = false;
    }
  }

  async cleanup() {
    this.stopListening();
    await this.assistant.cleanup();
  }
} 