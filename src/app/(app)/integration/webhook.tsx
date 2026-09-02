// شاشة Webhook Config — إعداد واستقبال إشعارات الدفع
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';
import { Copy, CheckCircle2, ChevronLeft, Webhook, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/client/supabase';

type WebhookEndpoint = {
  id: string;
  url: string;
  secret: string;
  status: 'active' | 'inactive';
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

export default function WebhookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const webhookReceiverUrl = `${supabaseUrl}/functions/v1/naderpay-webhook`;

  const fetchEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const res = await fetch(
        `${supabaseUrl}/functions/v1/naderpay-admin/webhook-endpoints`,
        { headers: { Authorization: `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! } }
      );
      if (res.ok) {
        const json = await res.json();
        setEndpoints(json.endpoints ?? []);
      }
    } catch { /* تجاهل */ }
    finally { setLoading(false); }
  }, [supabaseUrl]);

  useFocusEffect(useCallback(() => { (async () => { await fetchEndpoints(); })(); }, [fetchEndpoints]));

  const handleSave = async () => {
    if (!url.trim() || !url.startsWith('http')) {
      setError('أدخل عنوان URL صالحاً يبدأ بـ https://');
      return;
    }
    setSaving(true); setError(null); setSuccess(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('يجب تسجيل الدخول');

      const res = await fetch(
        `${supabaseUrl}/functions/v1/naderpay-admin/webhook-endpoints`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: url.trim() }),
        }
      );
      if (res.ok) {
        setSuccess('تم إضافة Webhook بنجاح');
        setUrl('');
        await fetchEndpoints();
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
        <Pressable onPress={fetchEndpoints} className="active:opacity-60 p-1">
          <RefreshCw size={18} color="#6B7280" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* كيف يعمل Webhook */}
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[13px] font-semibold text-[#111827] mb-3">كيف يعمل Webhook؟</Text>
          <View className="gap-3">
            {[
              { step: '1', text: 'عميلك يدفع عبر التطبيق' },
              { step: '2', text: 'التطبيق يتحقق من الدفع ويؤكده' },
              { step: '3', text: 'يُرسل طلب POST تلقائي إلى عنوان Webhook موقعك' },
              { step: '4', text: 'موقعك يستقبل البيانات ويحدّث حالة الطلب' },
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

        {/* عنوان Webhook الخاص بالتطبيق */}
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[13px] font-semibold text-[#111827] mb-1">
            عنوان Webhook المُرسِل (من التطبيق)
          </Text>
          <Text className="text-[12px] text-[#6B7280] mb-3 leading-5">
            هذا العنوان يُرسل إشعارات Webhook. أضفه في whitelist موقعك إذا كان لديك firewall.
          </Text>
          <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 flex-row items-center gap-2">
            <Text className="flex-1 text-[11px] font-mono text-[#374151]" numberOfLines={2}>
              {webhookReceiverUrl}
            </Text>
            <Pressable onPress={() => copyText(webhookReceiverUrl, 'recv_url')} className="active:opacity-60">
              {copiedId === 'recv_url'
                ? <CheckCircle2 size={16} color="#15803D" />
                : <Copy size={16} color="#9CA3AF" />}
            </Pressable>
          </View>
        </View>

        {/* إضافة endpoint */}
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[14px] font-semibold text-[#111827] mb-1">
            أضف عنوان موقعك لاستقبال الإشعارات
          </Text>
          <Text className="text-[12px] text-[#9CA3AF] mb-4 leading-5">
            أدخل عنوان الـ endpoint في موقعك الذي سيستقبل إشعارات الدفع.
          </Text>

          <Text className="text-[12px] font-medium text-[#374151] mb-1.5">عنوان Webhook موقعك</Text>
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

          {error && <Text className="text-[12px] text-red-500 mb-2">{error}</Text>}
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

        {/* عناوين محفوظة */}
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
                <View className="flex-row items-center gap-2 mb-1">
                  <View className={`w-2 h-2 rounded-full ${ep.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <Text className="text-[11px] text-[#9CA3AF]">{ep.status === 'active' ? 'فعّال' : 'معطّل'}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 text-[12px] font-mono text-[#374151]" numberOfLines={1}>{ep.url}</Text>
                  <Pressable onPress={() => copyText(ep.url, ep.id)} className="active:opacity-60">
                    {copiedId === ep.id
                      ? <CheckCircle2 size={15} color="#15803D" />
                      : <Copy size={15} color="#9CA3AF" />}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* التحقق من التوقيع */}
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[13px] font-semibold text-[#111827] mb-1">
            التحقق من توقيع Webhook (HMAC)
          </Text>
          <Text className="text-[12px] text-[#6B7280] mb-3 leading-5">
            كل طلب Webhook يحمل توقيعاً في header. تحقق منه لضمان أن الإشعار حقيقي وليس مزيفاً.
          </Text>

          <View
            className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 mb-3"
          >
            <Text className="text-[11px] text-[#6B7280] mb-1">Header التوقيع:</Text>
            <Text className="text-[12px] font-mono text-[#374151]">
              X-NaderPay-Signature: sha256=HASH
            </Text>
          </View>

          <Text className="text-[12px] text-[#374151] mb-1 font-medium">خوارزمية التحقق:</Text>
          <CodeBlock code={`HMAC-SHA256(webhook_secret, raw_request_body)
= expected_signature

// قارن expected_signature مع X-NaderPay-Signature`} />

          <View className="mt-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3">
            <Text className="text-[12px] text-[#92400E] leading-5">
              ⚠️ استخدم <Text className="font-semibold">Raw Body</Text> (بدون JSON.parse) عند حساب التوقيع. أي تعديل على الـ body يُبطل التحقق.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
