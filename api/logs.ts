import fs from 'fs';
import path from 'path';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const logsDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logsDir, 'app.log');

    // Создаем директорию для логов, если её нет
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Записываем логи в файл
    fs.writeFileSync(logFile, req.body);
    
    res.status(200).json({ message: 'Logs saved successfully' });
  } catch (error) {
    console.error('Error saving logs:', error);
    res.status(500).json({ message: 'Failed to save logs' });
  }
} 