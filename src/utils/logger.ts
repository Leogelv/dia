type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private static instance: Logger;
  private logs: string[] = [];
  private readonly maxLogs = 1000;
  private readonly logFile = 'app.log';

  private constructor() {
    // При создании логгера пытаемся загрузить существующие логи
    this.loadLogs();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\nData: ${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${dataStr}`;
  }

  private async loadLogs() {
    try {
      const response = await fetch(this.logFile);
      if (response.ok) {
        const text = await response.text();
        this.logs = text.split('\n').filter(Boolean);
        if (this.logs.length > this.maxLogs) {
          this.logs = this.logs.slice(-this.maxLogs);
        }
      }
    } catch (error) {
      console.warn('Failed to load logs:', error);
    }
  }

  private addLog(formattedMessage: string) {
    this.logs.push(formattedMessage);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(formattedMessage);
    this.saveToFile();
  }

  private async saveToFile() {
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: this.logs.join('\n'),
      });

      if (!response.ok) {
        throw new Error(`Failed to save logs: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to save logs:', error);
    }
  }

  info(message: string, data?: any) {
    const formattedMessage = this.formatMessage('info', message, data);
    this.addLog(formattedMessage);
  }

  warn(message: string, data?: any) {
    const formattedMessage = this.formatMessage('warn', message, data);
    this.addLog(formattedMessage);
  }

  error(message: string, data?: any) {
    const formattedMessage = this.formatMessage('error', message, data);
    this.addLog(formattedMessage);
  }

  debug(message: string, data?: any) {
    if (import.meta.env.DEV) {
      const formattedMessage = this.formatMessage('debug', message, data);
      this.addLog(formattedMessage);
    }
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  downloadLogs() {
    const blob = new Blob([this.logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'avatar-app.log';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const logger = Logger.getInstance(); 