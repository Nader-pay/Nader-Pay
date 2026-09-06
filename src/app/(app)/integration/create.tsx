// إنشاء تكامل جديد — Create Integration Wizard
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ChevronLeft, Globe, Key, Webhook, CheckCircle2,
  Eye, EyeOff, Copy, AlertCircle,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/client/supabase';

type Env = 'sandbox' | 'live';

type CreatedResult = {
  integration_id: string;
  name: string;
  environment: Env;
  api_key: string | null;
  webhook_secret: string;
  webhook_url: string;
  auth_mode: string;
  warning: string;
};

function SectionHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <View className="flex-row items-start gap-3 mb-4">
      <View className="w-7 h-7 rounded-full bg-[#111827] items-center justify-center mt-0.5">
        <Text className="text-[12px] font-bold text-white">{step}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-[#111827]">{title}</Text>
        <Text className="text-[12px] text-[#9CA3AF] leading-4 mt-0.5">{subtitle}</Text>
      </View>
    </View>
  );
}

function SecretReveal({ label, value }: { label: string; value: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <View className="mb-3">
      <Text className="text-[12px] font-semibold text-[#374151] mb-1.5">{label}</Text>
      <View className="bg-[#0F172A] rounded-xl px-4 py-3 flex-row items-center gap-2">
        <Text className="flex-1 text-[11px] font-mono text-[#E2E8F0]" numberOfLines={1}>
          {visible ? value : '•'.repeat(Math.min(value.length, 36))}
        </Text>
        <Pressable onPress={() => setVisible((v) => !v)} className="active:opacity-60 p-1">
          {visible ? <EyeOff size={15} color="#64748B" /> : <Eye size={15} color="#64748B" />}
        </Pressable>
        <Pressable onPress={handleCopy} className="active:opacity-60 p-1">
          {copied ? <CheckCircle2 size={15} color="#4ADE80" /> : <Copy size={15} color="#64748B" />}
        </Pressable>
      </View>
    </View>
  );
}

export default function CreateIntegrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

  // حقول النموذج
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [environment, setEnvironment] = useState<Env>('sandbox');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedResult | null>(null);

  const validate = (): string | null => {
    if (!name.trim()) return 'أدخل اسم التكامل';
    if (!websiteUrl.trim() || !websiteUrl.startsWith('http')) return 'أدخل رابط الموقع (يبدأ بـ https://)';
    if (!webhookUrl.trim() || !webhookUrl.startsWith('https://')) return 'Webhook URL يجب أن يبدأ بـ https://';
    return null;
  };

  const handleCreate = async () => {
    const validErr = validate();
    if (validErr) { setError(validErr); return; }

    setCreating(true);
    setError(null);
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
        body: JSON.stringify({
          name: name.trim(),
          type: 'website',
          website_url: websiteUrl.trim(),
          environment,
          api_key_option: 'new',
          webhook_url: webhookUrl.trim(),
          webhook_events: ['payment.confirmed', 'payment.rejected', 'payment.expired'],
          auth_mode: 'hmac',
          create_webhook_secret: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? `خطأ ${res.status}`);

      const int = json.integration;
      setResult({
        integration_id: int.id,
        name: int.name,
        environment: int.environment,
        api_key: int.api_key ?? null,
        webhook_secret: int.webhook_secret ?? '',
        webhook_url: int.webhook_url,
        auth_mode: int.auth_mode,
        warning: json.warning ?? '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setCreating(false);
    }
  };

  // ─── نتيجة بعد الإنشاء ────────────────────────────────────
  if (result) {
    const baseUrl = `${supabaseUrl}/functions/v1`;
    return (
      <View className="flex-1 bg-[#F8F9FB]">
        <View
          className="bg-white border-b border-[#E5E7EB] px-5 flex-row items-center gap-3"
          style={{ paddingTop: insets.top + 12, paddingBottom: 14 }}
        >
          <View className="w-8 h-8 rounded-full bg-[#DCFCE7] items-center justify-center">
            <CheckCircle2 size={18} color="#15803D" />
          </View>
          <View className="flex-1">
            <Text className="text-[17px] font-bold text-[#111827]">تم إنشاء التكامل!</Text>
            <Text className="text-[12px] text-[#9CA3AF]">{result.name}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* تحذير: احفظ الآن */}
          <View className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
            <View className="flex-row items-center gap-2 mb-1.5">
              <AlertCircle size={15} color="#92400E" />
              <Text className="text-[13px] font-bold text-[#92400E]">احفظ هذه البيانات الآن</Text>
            </View>
            <Text className="text-[12px] text-[#78350F] leading-5">{result.warning}</Text>
          </View>

          {/* API Key */}
          {result.api_key && (
            <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
              <View className="flex-row items-center gap-2 mb-3">
                <Key size={16} color="#4338CA" />
                <Text className="text-[14px] font-semibold text-[#111827]">مفتاح API</Text>
                <View className="bg-[#EEF2FF] rounded-full px-2 py-0.5">
                  <Text className="text-[10px] font-bold text-[#4338CA]">يظهر مرة واحدة فقط</Text>
                </View>
              </View>
              <SecretReveal label="API Key (KEY_ID:SECRET)" value={result.api_key} />
              <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 gap-1">
                <Text className="text-[11px] text-[#6B7280] font-semibold">الاستخدام في Backend موقعك:</Text>
                <Text className="text-[10px] font-mono text-[#374151]">
                  {`x-api-key: ${result.api_key}`}
                </Text>
              </View>
            </View>
          )}

          {/* Webhook Secret */}
          {result.webhook_secret && (
            <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
              <View className="flex-row items-center gap-2 mb-3">
                <Webhook size={16} color="#1D4ED8" />
                <Text className="text-[14px] font-semibold text-[#111827]">Webhook Secret</Text>
                <View className="bg-[#EEF2FF] rounded-full px-2 py-0.5">
                  <Text className="text-[10px] font-bold text-[#4338CA]">يظهر مرة واحدة فقط</Text>
                </View>
              </View>
              <SecretReveal label="WEBHOOK_SECRET" value={result.webhook_secret} />
              <Text className="text-[12px] text-[#6B7280] leading-5">
                استخدمه للتحقق من توقيع HMAC-SHA256 على كل Webhook وارد إلى موقعك.
              </Text>
            </View>
          )}

          {/* Base URL */}
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
            <Text className="text-[14px] font-semibold text-[#111827] mb-3">بيانات الاتصال</Text>
            <View className="gap-3">
              {[
                { label: 'Base URL', value: baseUrl },
                { label: 'Endpoint إنشاء طلب', value: `${baseUrl}/payment-requests` },
                { label: 'Webhook URL موقعك', value: result.webhook_url },
                { label: 'البيئة', value: result.environment === 'live' ? 'Live (إنتاج)' : 'Sandbox (تجريبي)' },
              ].map(({ label, value }) => (
                <View key={label}>
                  <Text className="text-[11px] text-[#9CA3AF] mb-0.5">{label}</Text>
                  <Text className="text-[12px] font-mono text-[#374151]" numberOfLines={1}>{value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* الخطوات التالية */}
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
            <Text className="text-[14px] font-semibold text-[#111827] mb-3">الخطوات التالية</Text>
            <View className="gap-2.5">
              {[
                'احفظ API Key و Webhook Secret في متغيرات البيئة (ENV) في Backend موقعك',
                'أرسل POST /payment-requests عند كل عملية دفع في موقعك',
                'احفظ payment_request_id من الاستجابة في قاعدة بياناتك',
                'أضف endpoint في موقعك لاستقبال Webhook وتحقق من توقيع HMAC',
                'اضغط "اختبار التكامل" للتأكد من أن كل شيء يعمل',
              ].map((step, i) => (
                <View key={i} className="flex-row items-start gap-2.5">
                  <View className="w-5 h-5 rounded-full bg-[#F3F4F6] items-center justify-center mt-0.5">
                    <Text className="text-[10px] font-bold text-[#374151]">{i + 1}</Text>
                  </View>
                  <Text className="flex-1 text-[13px] text-[#374151] leading-5">{step}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* أزرار */}
          <View className="gap-3">
            <Pressable
              onPress={() => router.push('/(app)/integration/test' as never)}
              className="bg-[#111827] rounded-2xl py-4 items-center active:opacity-70"
              style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-[15px] font-semibold text-white">اختبار التكامل</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/integration/guide' as never)}
              className="border border-[#E5E7EB] bg-white rounded-2xl py-4 items-center active:opacity-70"
              style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-[15px] font-semibold text-[#374151]">فتح دليل التكامل</Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              className="py-3 items-center active:opacity-60"
            >
              <Text className="text-[14px] text-[#9CA3AF]">العودة إلى التكامل</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ─── نموذج الإنشاء ─────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      className="flex-1"
    >
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
            <Text className="text-[17px] font-bold text-[#111827]">إنشاء تكامل جديد</Text>
            <Text className="text-[12px] text-[#9CA3AF]">اربط موقعك بمحرّك التحقق</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 20 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ─── القسم 1: معلومات التكامل ─── */}
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-5" style={{ borderCurve: 'continuous' }}>
            <SectionHeader step={1} title="معلومات التكامل" subtitle="اسم وبيئة التكامل" />

            <Text className="text-[12px] font-semibold text-[#374151] mb-1.5">اسم التكامل</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="مثال: متجر نادر — تكامل المدفوعات"
              placeholderTextColor="#9CA3AF"
              className="border border-[#E5E7EB] rounded-xl px-4 py-3 text-[13px] text-[#111827] bg-[#F9FAFB] mb-4"
              returnKeyType="next"
            />

            <Text className="text-[12px] font-semibold text-[#374151] mb-1.5">رابط الموقع</Text>
            <TextInput
              value={websiteUrl}
              onChangeText={setWebsiteUrl}
              placeholder="https://yourstore.com"
              placeholderTextColor="#9CA3AF"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              className="border border-[#E5E7EB] rounded-xl px-4 py-3 text-[13px] text-[#111827] bg-[#F9FAFB] mb-4"
              returnKeyType="next"
            />

            <Text className="text-[12px] font-semibold text-[#374151] mb-2">البيئة</Text>
            <View className="flex-row gap-3">
              {(['sandbox', 'live'] as Env[]).map((env) => (
                <Pressable
                  key={env}
                  onPress={() => setEnvironment(env)}
                  className={`flex-1 rounded-xl border py-3 items-center active:opacity-70 ${
                    environment === env
                      ? env === 'live' ? 'border-[#F59E0B] bg-[#FFFBEB]' : 'border-[#6366F1] bg-[#EEF2FF]'
                      : 'border-[#E5E7EB] bg-white'
                  }`}
                >
                  <Text className={`text-[13px] font-semibold ${
                    environment === env
                      ? env === 'live' ? 'text-[#92400E]' : 'text-[#4338CA]'
                      : 'text-[#6B7280]'
                  }`}>
                    {env === 'live' ? '🔴 Live' : '🧪 Sandbox'}
                  </Text>
                  <Text className="text-[10px] text-[#9CA3AF] mt-0.5">
                    {env === 'live' ? 'إنتاج حقيقي' : 'اختبار فقط'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ─── القسم 2: إعدادات Webhook ─── */}
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-5" style={{ borderCurve: 'continuous' }}>
            <SectionHeader
              step={2}
              title="Webhook موقعك"
              subtitle="الرابط الذي سيستقبل إشعارات الدفع"
            />

            <Text className="text-[12px] font-semibold text-[#374151] mb-1.5">Webhook URL</Text>
            <TextInput
              value={webhookUrl}
              onChangeText={setWebhookUrl}
              placeholder="https://yoursite.com/webhooks/naderpay"
              placeholderTextColor="#9CA3AF"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              className="border border-[#E5E7EB] rounded-xl px-4 py-3 text-[13px] text-[#111827] bg-[#F9FAFB] mb-3"
            />
            <View className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl px-4 py-3">
              <Text className="text-[12px] text-[#0369A1] leading-5">
                💡 هذا العنوان يجب أن يكون موجوداً في <Text className="font-bold">Backend موقعك</Text>.
                NaderPay سيرسل POST إليه عند تأكيد أي دفع.
              </Text>
            </View>
          </View>

          {/* ─── القسم 3: مفتاح API ─── */}
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-5" style={{ borderCurve: 'continuous' }}>
            <SectionHeader
              step={3}
              title="مفتاح API"
              subtitle="سيتم إنشاؤه تلقائياً وعرضه مرة واحدة"
            />
            <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3">
              <View className="flex-row items-center gap-2 mb-1">
                <Key size={14} color="#4338CA" />
                <Text className="text-[12px] font-semibold text-[#374151]">API Key جديد</Text>
              </View>
              <Text className="text-[12px] text-[#6B7280] leading-5">
                سيتم إنشاء KEY_ID و SECRET جديدَين لهذا التكامل. احتفظ بالـ Secret في متغيرات البيئة في Backend موقعك.
              </Text>
            </View>
          </View>

          {/* ─── خطأ ─── */}
          {error && (
            <View className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl px-4 py-3 flex-row items-center gap-2">
              <AlertCircle size={15} color="#DC2626" />
              <Text className="text-[13px] text-red-600 flex-1">{error}</Text>
            </View>
          )}

          {/* ─── زر الإنشاء ─── */}
          <Pressable
            onPress={handleCreate}
            disabled={creating}
            className="bg-[#111827] rounded-2xl py-4 flex-row items-center justify-center gap-2.5 active:opacity-70"
            style={{ borderCurve: 'continuous' }}
          >
            {creating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Globe size={18} color="#fff" />}
            <Text className="text-[15px] font-semibold text-white">
              {creating ? 'جاري الإنشاء…' : 'إنشاء التكامل'}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
