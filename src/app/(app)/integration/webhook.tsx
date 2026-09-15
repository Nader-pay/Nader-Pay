// شاشة Webhook Config — إعداد + سجلات التسليم
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { Copy, CheckCircle2, ChevronLeft, Webhook, RefreshCw, AlertCircle, XCircle, Clock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/client/supabase';

type WebhookEndpoint = {
  id: string;
  url: string;
  status: 'active' | 'inactive';
  auth_mode: string;
  health_status: string | null;
  last_test_at: string | null;
  created_at: string;
};

type WebhookDelivery = {
  id: string;
  status: 'delivered' | 'failed' | 'pending';
  http_status: number | null;
  event_type: string | null;
  attempts: number;
  created_at: string;
};

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View className="bg-[#0F172A] rounded-xl px-4 py-3 mt-1">
      <Pressable onPress={handleCopy} className="absolute top-2.5 right-3 active:opacity-60 z-10">
        {copied
          ? <CheckCircle2 size={16} color="#4ADE80" />
          : <Copy size={16} color="#94A3B8" />}
      </Pressable>
      <Text className="text-[11px] font-mono text-[#E2E8F0] leading-[18px] pr-6">{code}</Text>
    </View>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return `منذ ${Math.floor(h / 24)} ي`;
}

export default function WebhookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      };

      // جلب endpoints + deliveries بالتوازي
      const [epRes, statsRes] = await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/integration-status`, { headers }),
        fetch(`${supabaseUrl}/functions/v1/integration-status`, { headers }),
      ]);

      if (epRes.ok) {
        const json = await epRes.json();
        // استخرج webhook_endpoints من integrations
        const eps: WebhookEndpoint[] = [];
        const integrations: Array<{ webhook_endpoints?: WebhookEndpoint[] }> = json.integrations ?? [];
        integrations.forEach((i) => {
          if (Array.isArray(i.webhook_endpoints)) eps.push(...i.webhook_endpoints);
        });
        setEndpoints(eps);
      }
      if (statsRes.ok) {
        const json = await statsRes.json();
        const allDeliveries: WebhookDelivery[] = [];
        const integrations: Array<{ webhook_deliveries?: WebhookDelivery[] }> = json.integrations ?? [];
        integrations.forEach((i) => {
          if (Array.isArray(i.webhook_deliveries)) {
            allDeliveries.push(...i.webhook_deliveries);
          }
        });
        setDeliveries(allDeliveries);
      }
    } catch { /* تجاهل */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [supabaseUrl]);

  useFocusEffect(useCallback(() => { (async () => { await fetchAll(); })(); }, [fetchAll]));

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  const handleSave = async () => {
    if (!url.trim() || !url.startsWith('http')) {
      setError('أدخل عنوان URL صالحاً يبدأ بـ https://');
      return;
    }
    setSaving(true); setError(null); setSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('يجب تسجيل الدخول');

      const res = await fetch(`${supabaseUrl}/functions/v1/integrations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'update-webhook', url: url.trim() }),
      });
      if (res.ok) {
        setSuccess('تم إضافة Webhook بنجاح');
        setUrl('');
        await fetchAll();
      } else {
        const json = await res.json();
        throw new Error(json?.error?.message ?? 'فشل الحفظ');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setSaving(false);
    }
  };

  const copyText = async (text: string, id: string) => {
    await Clipboard.setStringAsync(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  function deliveryStatusIcon(s: string) {
    if (s === 'delivered') return <CheckCircle2 size={14} color="#15803D" />;
    if (s === 'failed')    return <XCircle size={14} color="#DC2626" />;
    return <Clock size={14} color="#9CA3AF" />;
  }

  return (
    <View className="flex-1 bg-[#F8F9FB]">
      {/* Header */}
      <View
        className="bg-white border-b border-[#E5E7EB] px-5 flex-row items-center gap-3"
        style={{ paddingTop: insets.top + 12, paddingBottom: 14 }}
      >
        <Pressable onPress={() => router.back()} className="active:opacity-60 p-1">
          <ChevronLeft size={22} color="#111827" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[17px] font-bold text-[#111827]">إعداد Webhook</Text>
          <Text className="text-[12px] text-[#9CA3AF]">استقبل تأكيد الدفع فورياً</Text>
        </View>
        <Pressable onPress={onRefresh} className="active:opacity-60 p-1">
          <RefreshCw size={18} color="#6B7280" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* كيف يعمل Webhook */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <Text className="text-[13px] font-semibold text-[#111827] mb-3">كيف يعمل Webhook؟</Text>
          <View className="gap-2.5">
            {[
              { step: '1', text: 'عميلك يدفع عبر محفظة / InstaPay' },
              { step: '2', text: 'محرّك التحقق يطابق رسالة SMS أو التحويل' },
              { step: '3', text: 'يُرسل POST موقّع بـ HMAC-SHA256 إلى موقعك' },
              { step: '4', text: 'موقعك يتحقق من التوقيع ويُحدّث الطلب' },
            ].map((item) => (
              <View key={item.step} className="flex-row items-center gap-3">
                <View className="w-6 h-6 rounded-full bg-[#F3F4F6] items-center justify-center">
                  <Text className="text-[11px] font-bold text-[#374151]">{item.step}</Text>
                </View>
                <Text className="text-[13px] text-[#374151]">{item.text}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* إضافة endpoint جديد */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center gap-2 mb-3">
            <Webhook size={15} color="#374151" />
            <Text className="text-[14px] font-semibold text-[#111827]">أضف Webhook موقعك</Text>
          </View>
          <Text className="text-[12px] text-[#9CA3AF] mb-3 leading-5">
            الرابط يجب أن يكون HTTPS ويستقبل POST requests.
          </Text>

          <Text className="text-[12px] font-medium text-[#374151] mb-1.5">Webhook URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://yoursite.com/webhooks/naderpay"
            placeholderTextColor="#9CA3AF"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-[#E5E7EB] rounded-xl px-4 py-3 text-[13px] text-[#111827] bg-[#F9FAFB] mb-4"
          />

          {error && (
            <View className="flex-row items-center gap-2 mb-2">
              <AlertCircle size={13} color="#DC2626" />
              <Text className="text-[12px] text-red-500 flex-1">{error}</Text>
            </View>
          )}
          {success && <Text className="text-[12px] text-green-600 mb-2">✅ {success}</Text>}

          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="bg-[#111827] rounded-xl py-3.5 items-center active:opacity-70"
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text className="text-[14px] font-semibold text-white">حفظ العنوان</Text>}
          </Pressable>
        </View>

        {/* Endpoints المضافة */}
        {!loading && endpoints.length > 0 && (
          <View className="gap-2">
            <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase">
              العناوين المضافة
            </Text>
            {endpoints.map((ep) => (
              <View
                key={ep.id}
                className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
                style={{ borderCurve: 'continuous' }}
              >
                <View className="flex-row items-center gap-2 mb-1.5">
                  <View className={`w-2 h-2 rounded-full ${ep.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <Text className="text-[11px] text-[#9CA3AF]">{ep.status === 'active' ? 'فعّال' : 'معطّل'}</Text>
                  {ep.auth_mode && (
                    <View className="bg-[#F3F4F6] rounded px-1.5 py-0.5">
                      <Text className="text-[9px] text-[#6B7280]">{ep.auth_mode}</Text>
                    </View>
                  )}
                  {ep.health_status && (
                    <View className={`rounded px-1.5 py-0.5 ${ep.health_status === 'healthy' ? 'bg-[#F0FDF4]' : 'bg-[#FEF2F2]'}`}>
                      <Text className={`text-[9px] font-medium ${ep.health_status === 'healthy' ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
                        {ep.health_status}
                      </Text>
                    </View>
                  )}
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 text-[12px] font-mono text-[#374151]" numberOfLines={1}>{ep.url}</Text>
                  <Pressable onPress={() => copyText(ep.url, ep.id)} className="active:opacity-60">
                    {copiedId === ep.id
                      ? <CheckCircle2 size={15} color="#15803D" />
                      : <Copy size={15} color="#9CA3AF" />}
                  </Pressable>
                </View>
                {ep.last_test_at && (
                  <Text className="text-[11px] text-[#9CA3AF] mt-1.5">آخر اختبار: {formatRelative(ep.last_test_at)}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* سجلات التسليم */}
        {deliveries.length > 0 && (
          <View className="gap-2">
            <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase">
              سجل التسليم الأخير
            </Text>
            <View className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
              {deliveries.slice(0, 8).map((d, i) => (
                <View
                  key={d.id}
                  className={`flex-row items-center gap-3 px-5 py-3 ${i > 0 ? 'border-t border-[#F3F4F6]' : ''}`}
                >
                  {deliveryStatusIcon(d.status)}
                  <View className="flex-1">
                    <Text className="text-[12px] font-medium text-[#374151]">
                      {d.event_type ?? 'webhook.event'}
                    </Text>
                    <Text className="text-[11px] text-[#9CA3AF]">
                      {d.attempts > 1 ? `${d.attempts} محاولات · ` : ''}{formatRelative(d.created_at)}
                    </Text>
                  </View>
                  {d.http_status && (
                    <View className={`rounded-lg px-2 py-1 ${d.http_status === 200 ? 'bg-[#F0FDF4]' : 'bg-[#FEF2F2]'}`}>
                      <Text className={`text-[10px] font-bold ${d.http_status === 200 ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
                        {d.http_status}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* التحقق من التوقيع */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <Text className="text-[13px] font-semibold text-[#111827] mb-1">التحقق من توقيع HMAC</Text>
          <Text className="text-[12px] text-[#6B7280] mb-3 leading-5">
            كل طلب Webhook يحمل توقيع HMAC-SHA256 في header. تحقق منه لضمان أن المُرسِل هو NaderPay.
          </Text>
          <CodeBlock code={`HMAC-SHA256(webhook_secret, raw_request_body)
→ sha256=EXPECTED_HASH

// قارن مع: X-NaderPay-Signature
// استخدم timingSafeEqual لمقارنة آمنة`} />
          <View className="mt-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3">
            <Text className="text-[12px] text-[#92400E] leading-5">
              ⚠️ استخدم <Text className="font-bold">Raw Body</Text> (Buffer) بدون JSON.parse. أي تعديل على الـ body يُبطل التوقيع.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

