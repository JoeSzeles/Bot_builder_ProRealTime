import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = spawn('node', ['server/index.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env }
});

const vite = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, 'client'),
  stdio: 'inherit',
  env: { ...process.env }
});

process.on('SIGINT', () => {
  server.kill();
  vite.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  server.kill();
  vite.kill();
  process.exit();
});
