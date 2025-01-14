import React, { useEffect, useState } from 'react';
import { OpenAIAssistant } from '../openai-assistant';
import './AssistantControl.css';

interface AssistantControlProps {
  apiKey: string;
  assistantId: string;
}

export const AssistantControl: React.FC<AssistantControlProps> = ({ apiKey, assistantId }) => {
  const [assistant, setAssistant] = useState<OpenAIAssistant | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);

  useEffect(() => {
    const initAssistant = async () => {
      try {
        console.log('🚀 Инициализация ассистента...');
        const newAssistant = new OpenAIAssistant(apiKey, assistantId);
        await newAssistant.initialize();
        console.log('✅ Ассистент успешно инициализирован');
        setAssistant(newAssistant);
      } catch (error) {
        console.error('❌ Ошибка при инициализации ассистента:', error);
      }
    };

    initAssistant();

    return () => {
      if (assistant) {
        console.log('🧹 Очистка ресурсов ассистента');
        assistant.cleanup();
        assistant.stopListening();
      }
    };
  }, [apiKey, assistantId]);

  const handleStartSession = async () => {
    if (assistant && !isSessionActive) {
      try {
        console.log('▶️ Запуск сессии...');
        await assistant.startListening();
        setIsSessionActive(true);
        console.log('✅ Сессия успешно запущена');
      } catch (error) {
        console.error('❌ Ошибка при запуске сессии:', error);
        setIsSessionActive(false);
      }
    }
  };

  const handleStopSession = () => {
    if (assistant && isSessionActive) {
      console.log('⏹️ Остановка сессии...');
      assistant.stopListening();
      setIsSessionActive(false);
      console.log('✅ Сессия остановлена');
    }
  };

  return (
    <div className="assistant-control">
      <button 
        onClick={isSessionActive ? handleStopSession : handleStartSession}
        className={`control-button ${isSessionActive ? 'active' : ''}`}
      >
        {isSessionActive ? 'Остановить сессию' : 'Начать сессию'}
      </button>
    </div>
  );
} 