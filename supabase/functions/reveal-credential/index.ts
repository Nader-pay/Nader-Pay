// One-time credential reveal — service-role protected, used to decrypt & return live API secret
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const adminClient = () => createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function deriveKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.digest('SHA-256', enc.encode(serviceKey));
  return crypto.subtle.importKey('raw', base, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function decryptSecret(encrypted: string): Promise<string> {
  const [ivB64, cipherB64] = encrypted.split('.');
  if (!ivB64 || !cipherB64) throw new Error('bad format');
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
  const key = await deriveKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Must present service role key
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const db = adminClient();
  let body: { credential_id: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'BAD_JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { data: cred } = await db.from('api_credentials')
    .select('id, key_id, encrypted_secret, status, environment, label')
    .eq('id', body.credential_id)
    .maybeSingle();

  if (!cred) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!cred.encrypted_secret) return new Response(JSON.stringify({ error: 'NO_ENCRYPTED_SECRET' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const secret = await decryptSecret(cred.encrypted_secret);

  return new Response(JSON.stringify({
    id: cred.id,
    key_id: cred.key_id,
    secret,
    api_key: `${cred.key_id}:${secret}`,
    status: cred.status,
    environment: cred.environment,
    label: cred.label,
  }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
