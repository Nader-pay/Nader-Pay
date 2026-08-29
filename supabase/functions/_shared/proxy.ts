// مساعد لإعادة توجيه طلب Edge Function إلى Edge Function آخر داخل نفس المشروع
import { CORS, jsonOk, jsonErr } from './auth.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';

export async function forwardRequest(req: Request, targetPath: string): Promise<Response> {
  const url = new URL(`${supabaseUrl}/functions/v1/${targetPath}`);
  if (req.method === 'GET') {
    const incoming = new URL(req.url);
    incoming.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  }

  const headers = new Headers(req.headers);
  headers.set('host', url.host);

  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  try {
    const resp = await fetch(url.toString(), {
      method: req.method,
      headers,
      body,
    });
    return new Response(await resp.arrayBuffer(), {
      status: resp.status,
      headers: { ...CORS, 'Content-Type': resp.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch (e) {
    return jsonErr('PROXY_ERROR', e instanceof Error ? e.message : 'forward failed', 502, crypto.randomUUID());
  }
}
