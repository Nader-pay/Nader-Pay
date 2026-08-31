// حالة طلب دفع Nader Pay — يعيد التوجيه إلى payment-requests/{id}
import { CORS } from '../_shared/auth.ts';
import { forwardRequest } from '../_shared/proxy.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const pathParts = url.pathname.replace(/^\/naderpay-payment-status\/?/, '').split('/').filter(Boolean);
  if (req.method !== 'GET' || pathParts.length === 0) {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const targetPath = `payment-requests/${pathParts[0]}`;
  return forwardRequest(req, targetPath);
});
