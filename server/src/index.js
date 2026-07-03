import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import app from './app.js';

// Serve the built React app when running as a plain Node server (client/dist).
// On Vercel the static files are served by the CDN instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(clientDist, 'index.html'));
    }
    next();
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`RBLI RPAS API running on http://localhost:${PORT}`));
