import { startServer, httpServer } from './server.js';

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)));
process.on('SIGINT',  () => httpServer.close(() => process.exit(0)));

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  httpServer.close(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  httpServer.close(() => process.exit(1));
});

startServer();
