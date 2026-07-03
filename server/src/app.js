import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import configRoutes from './routes/config.js';
import appraisalRoutes from './routes/appraisal.js';

// The Express app without .listen() so it can run both as a local server
// (src/index.js) and as a Vercel serverless function (api/index.js).
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'RBLI RPAS API' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', configRoutes);
app.use('/api', appraisalRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  const message = /fetch failed/i.test(err.message || '')
    ? 'Cannot reach the database. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment variables.'
    : err.message || 'Something went wrong';
  res.status(err.status || 500).json({ error: message });
});

export default app;
