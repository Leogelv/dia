import { defineConfig } from 'vite';
import type { Connect } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [{
    name: 'handle-logs',
    configureServer(server) {
      server.middlewares.use('/api/logs', ((req, res, next) => {
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const data = Buffer.concat(chunks).toString();
            const logsDir = path.join(process.cwd(), 'logs');
            const logFile = path.join(logsDir, 'app.log');

            // Создаем директорию для логов, если её нет
            if (!fs.existsSync(logsDir)) {
              fs.mkdirSync(logsDir, { recursive: true });
            }

            // Записываем логи в файл
            fs.writeFileSync(logFile, data);
            
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ message: 'Logs saved successfully' }));
          });
        } else if (req.method === 'GET') {
          const logFile = path.join(process.cwd(), 'logs', 'app.log');
          if (fs.existsSync(logFile)) {
            const logs = fs.readFileSync(logFile, 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(logs);
          } else {
            res.statusCode = 404;
            res.end('No logs found');
          }
        } else {
          res.statusCode = 405;
          res.end('Method not allowed');
        }
      }) as Connect.NextHandleFunction);
    },
  }],
}); 