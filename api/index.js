// Vercel serverless entry point - all /api/* requests are rewritten here
// (see vercel.json) and handled by the shared Express app.
import app from '../server/src/app.js';

export default app;
