import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import configRoutes from './routes/config.js';
import appraisalRoutes from './routes/appraisal.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'RBLI RPAS API' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', configRoutes);
app.use('/api', appraisalRoutes);

// Serve the built React app in production (client/dist)
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

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const message = /fetch failed/i.test(err.message || '')
    ? 'Cannot reach the database. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env.'
    : err.message || 'Something went wrong';
  res.status(err.status || 500).json({ error: message });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`RBLI RPAS API running on http://localhost:${PORT}`));
