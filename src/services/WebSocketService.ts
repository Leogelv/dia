export class WebSocketService {
    private ws: WebSocket | null = null;
    private url: string;

    constructor(url: string = import.meta.env.VITE_WEBSOCKET_URL) {
        this.url = url;
        console.log('🔌 WebSocket сервис создан:', url);
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                console.log('🔌 Подключаемся к WebSocket серверу...');
                this.ws = new WebSocket(this.url);
                
                this.ws.onopen = () => {
                    console.log('✅ WebSocket соединение установлено');
                    resolve();
                };
                
                this.ws.onerror = (error) => {
                    console.error('❌ Ошибка WebSocket:', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('🔌 WebSocket соединение закрыто');
                };
                
            } catch (error) {
                console.error('❌ Ошибка при создании WebSocket:', error);
                reject(error);
            }
        });
    }

    onClose(callback: () => void) {
        if (this.ws) {
            this.ws.onclose = () => {
                console.log('🔌 WebSocket соединение закрыто');
                callback();
            };
        }
    }

    onMessage(callback: (data: any) => void) {
        if (this.ws) {
            this.ws.onmessage = (event) => {
                try {
                    const response = JSON.parse(event.data);
                    console.log('📨 Получено сообщение от сервера:', response);
                    callback(response);
                } catch (error) {
                    console.error('❌ Ошибка при обработке сообщения:', error);
                }
            };
        }
    }

    sendAudioData(audioBuffer: ArrayBuffer) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(audioBuffer);
        } else {
            console.warn('⚠️ Попытка отправить данные при закрытом соединении');
        }
    }

    close() {
        if (this.ws) {
            console.log('🔌 Закрываем WebSocket соединение');
            this.ws.close();
            this.ws = null;
        }
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
} 