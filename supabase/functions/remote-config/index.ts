/**
 * remote-config Edge Function
 * ══════════════════════════════════════════════════════════════════
 * قراءة عامة (بدون auth) لجدول remote_config.
 * يُستخدَم من الـ app عند بدء التشغيل وكل 30 دقيقة.
 *
 * GET /remote-config          → { configs: Record<string,string>, updated_at: string }
 * GET /remote-config?cat=balance → نفس الشيء مُفلتَر بـ category
 *
 * لا يقبل WRITE — القراءة فقط — التعديل عبر Supabase Dashboard أو Admin API.
 * ══════════════════════════════════════════════════════════════════
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const url = new URL(req.url);
    const category = url.searchParams.get('cat');

    let query = supabase
      .from('remote_config')
      .select('key, value, value_type, category, updated_at')
      .order('key');

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[remote-config] DB error:', error.message);
      return new Response(JSON.stringify({ error: 'Database error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // تحويل القائمة إلى Record<key, value> للسهولة في الـ client
    const configs: Record<string, string> = {};
    const meta: Record<string, { type: string; category: string }> = {};
    let latestUpdated = '';

    for (const row of data ?? []) {
      configs[row.key] = row.value;
      meta[row.key] = { type: row.value_type, category: row.category };
      if (row.updated_at > latestUpdated) latestUpdated = row.updated_at;
    }

    return new Response(
      JSON.stringify({
        configs,
        meta,
        updated_at: latestUpdated,
        count: data?.length ?? 0,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Cache-Control: قابل للتخزين المؤقت لـ 5 دقائق
          'Cache-Control': 'public, max-age=300',
        },
      }
    );
  } catch (err) {
    console.error('[remote-config] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
