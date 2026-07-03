import 'dotenv/config';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Locally: copy server/.env.example to server/.env and fill it in. On Vercel: add them under Project Settings > Environment Variables and redeploy.'
  );
}

// Created lazily so a missing configuration fails per-request with a clear
// JSON error instead of killing the process (fatal on serverless, where
// exiting at import time makes every request a bare 500).
let client = null;
function getClient() {
  if (!url || !key) {
    const err = new Error(
      'Server is not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. On Vercel, add them in Project Settings > Environment Variables and redeploy.'
    );
    err.status = 500;
    throw err;
  }
  if (!client) {
    // ws transport is required on Node < 22 (no native WebSocket)
    client = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws }
    });
  }
  return client;
}

export const db = new Proxy(
  {},
  {
    get(_, prop) {
      const value = getClient()[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    }
  }
);

// Unwraps a supabase response or throws a friendly error
export function must({ data, error }) {
  if (error) {
    const err = new Error(error.message);
    err.status = 400;
    throw err;
  }
  return data;
}
