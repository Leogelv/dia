export class YandexSpeechRecognition {
  private socket: WebSocket | null = null;
  private isListening: boolean = false;
  private apiKey: string;
  private onResultCallback: ((text: string) => void) | null = null;
  private onErrorCallback: ((error: any) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public async start() {
    if (this.isListening) {
      console.log('🎤 Распознавание уже запущено');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await this.connectWebSocket();
    } catch (error) {
      console.error('❌ Ошибка при запуске распознавания:', error);
      this.cleanup();
      this.onErrorCallback?.(error);
    }
  }

  private async connectWebSocket() {
    const url = 'wss://stt.api.cloud.yandex.net/speech/v1/stt:streaming';
    
    this.socket = new WebSocket(url);
    
    this.socket.onopen = () => {
      console.log('🎤 Yandex SpeechKit подключен');
      
      const config = {
        specification: {
          language_code: 'ru-RU',
          model: 'general',
          partial_results: true,
          audio_encoding: 'LINEAR16_PCM',
          sample_rate_hertz: 16000,
          audio_channels_count: 1,
          language_restriction: {
            restriction_type: 'WHITELIST',
            language_code: ['ru-RU', 'kk-KK', 'en-US']
          }
        }
      };

      this.socket?.send(JSON.stringify(config));
      this.initializeAudioProcessing();
      this.isListening = true;
      this.reconnectAttempts = 0;
    };

    this.socket.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.result && response.result.final) {
          this.onResultCallback?.(response.result.alternatives[0].text);
        }
      } catch (error) {
        console.error('❌ Ошибка при обработке ответа:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('❌ Ошибка WebSocket:', error);
      this.onErrorCallback?.(error);
    };

    this.socket.onclose = async () => {
      console.log('🎤 WebSocket закрыт');
      
      if (this.isListening && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.connectWebSocket();
      } else {
        this.cleanup();
      }
    };
  }

  private initializeAudioProcessing() {
    if (!this.stream) return;

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = inputData[i] * 0x7fff;
        }
        this.socket.send(pcmData.buffer);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  public stop() {
    console.log('🛑 Остановка распознавания');
    this.isListening = false;
    this.cleanup();
  }

  private cleanup() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public onResult(callback: (text: string) => void) {
    this.onResultCallback = callback;
  }

  public onError(callback: (error: any) => void) {
    this.onErrorCallback = callback;
  }
} 