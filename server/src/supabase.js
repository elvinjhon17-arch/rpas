import 'dotenv/config';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}

// ws transport is required on Node < 22 (no native WebSocket)
export const db = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

// Unwraps a supabase response or throws a friendly error
export function must({ data, error }) {
  if (error) {
    const err = new Error(error.message);
    err.status = 400;
    throw err;
  }
  return data;
}
