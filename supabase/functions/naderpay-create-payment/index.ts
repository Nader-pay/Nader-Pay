// إنشاء طلب دفع Nader Pay — يعيد التوجيه إلى payment-requests
import { CORS } from '../_shared/auth.ts';
import { forwardRequest } from '../_shared/proxy.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  return forwardRequest(req, 'payment-requests');
});
