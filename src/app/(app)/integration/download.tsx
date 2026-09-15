// شاشة تنزيل ملف التكامل الشامل — مع روابط PDF و GitHub مباشرة
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FileDown, Copy, CheckCircle2, ChevronLeft, Share2, ExternalLink, FileText } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { cacheDirectory, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from '@/client/supabase';

// ─── روابط ثابتة من GitHub Releases ───────────────────────────
const PDF_URL = 'https://github.com/Nader-pay/Nader-Pay/raw/main/docs/NaderPay_Integration_Guide.pdf';
const GUIDE_URL = 'https://github.com/Nader-pay/Nader-Pay/blob/main/docs/INTEGRATION_GUIDE.md';
const APK_URL = 'https://github.com/Nader-pay/Nader-Pay/releases/download/v1.0.191/nader-pay-agent-v1.0.191.apk';

function LinkRow({ icon, label, url, color = '#111827' }: {
  icon: React.ReactNode; label: string; url: string; color?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 mb-3" style={{ borderCurve: 'continuous' as 'continuous' }}>
      <View className="flex-row items-center gap-2 mb-2">
        {icon}
        <Text className="text-[13px] font-semibold" style={{ color }}>{label}</Text>
      </View>
      <View className="bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 flex-row items-center gap-2">
        <Text className="flex-1 text-[10px] font-mono text-[#374151]" numberOfLines={1}>{url}</Text>
        <Pressable onPress={handleCopy} className="active:opacity-60">
          {copied
            ? <CheckCircle2 size={14} color="#15803D" />
            : <Copy size={14} color="#9CA3AF" />}
        </Pressable>
      </View>
      <Pressable
        onPress={() => Linking.openURL(url)}
        className="mt-2 flex-row items-center gap-1.5 self-start active:opacity-60"
      >
        <ExternalLink size={12} color="#4338CA" />
        <Text className="text-[11px] font-semibold text-[#4338CA]">فتح / تحميل</Text>
      </Pressable>
    </View>
  );
}

export default function DownloadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co';
  const baseUrl = `${supabaseUrl}/functions/v1`;

  const buildIntegrationFile = async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();

    // جلب أول مفتاح API فعّال
    let apiKeyExample = 'pk_YOUR_KEY_ID.YOUR_SECRET';
    if (session) {
      try {
        const res = await fetch(`${baseUrl}/api-credentials`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
        });
        if (res.ok) {
          const json = await res.json();
          const active = (json.credentials ?? []).find((c: { status: string; key_id: string }) => c.status === 'active');
          if (active) apiKeyExample = `${active.key_id}.YOUR_SECRET_HERE`;
        }
      } catch { /* تجاهل */ }
    }

    const integrationDoc = {
      _comment: 'ملف التكامل مع نادر باي — احتفظ به في مكان آمن',
      version: '1.0',
      generated_at: new Date().toISOString(),
      integration: {
        provider: 'NaderPay',
        description: 'بوابة الدفع عبر المحافظ الإلكترونية (InstaPay / Vodafone Cash)',
        docs_url: 'https://naderpay.app/docs',
      },
      api: {
        base_url: baseUrl,
        version: 'v1',
        endpoints: {
          create_payment_request: {
            method: 'POST',
            path: '/payment-requests',
            full_url: `${baseUrl}/payment-requests`,
            description: 'إنشاء طلب دفع جديد',
            required_fields: ['external_reference', 'amount', 'currency'],
            optional_fields: ['destination', 'customer', 'expires_at', 'metadata'],
          },
          get_payment_request: {
            method: 'GET',
            path: '/payment-requests/{id}',
            description: 'جلب تفاصيل طلب دفع',
          },
          list_payment_requests: {
            method: 'GET',
            path: '/payment-requests',
            description: 'جلب قائمة الطلبات',
            query_params: ['status', 'since', 'limit'],
          },
          cancel_payment_request: {
            method: 'POST',
            path: '/payment-requests/{id}/cancel',
            description: 'إلغاء طلب دفع',
          },
        },
        authentication: {
          type: 'API Key',
          header: 'x-api-key',
          format: '{KEY_ID}.{SECRET}',
          your_key: apiKeyExample,
          security_note: 'احتفظ بالسر في متغيرات البيئة — لا تضعه في كود Frontend',
        },
      },
      webhook: {
        description: 'إشعارات فورية عند تأكيد الدفع أو رفضه',
        receiver_url: `${baseUrl}/naderpay-webhook`,
        your_endpoint: 'https://YOUR_SITE.com/webhooks/naderpay',
        signature_header: 'X-NaderPay-Signature',
        signature_format: 'sha256=HMAC_SHA256(webhook_secret, raw_body)',
        timestamp_header: 'X-NaderPay-Timestamp',
        tolerance_seconds: 300,
        event_types: [
          'payment_request.confirmed',
          'payment_request.rejected',
          'payment_request.expired',
          'payment_request.cancelled',
        ],
        sample_payload: {
          event_type: 'payment_request.confirmed',
          payment_request_id: 'uuid-xxx',
          external_reference: 'ORDER-001',
          status: 'CONFIRMED',
          amount: 150.00,
          currency: 'EGP',
          timestamp: new Date().toISOString(),
        },
      },
      payment_statuses: {
        CREATED: 'تم الإنشاء، بانتظار الدفع',
        CONFIRMED: 'تم تأكيد الدفع بنجاح',
        REJECTED: 'مرفوض أو غير متطابق',
        EXPIRED: 'انتهت صلاحية الطلب',
        CANCELLED: 'ملغى يدوياً',
        DUPLICATE: 'دفع مكرر',
      },
      example_request: {
        _comment: 'مثال كامل لإنشاء طلب دفع',
        method: 'POST',
        url: `${baseUrl}/payment-requests`,
        headers: {
          'x-api-key': apiKeyExample,
          'Content-Type': 'application/json',
          'x-idempotency-key': 'unique-request-id-001',
        },
        body: {
          external_reference: 'ORDER-001',
          amount: 150.00,
          currency: 'EGP',
          payment_type: 'wallet',
          destination: {
            wallet_number: '01XXXXXXXXX',
            provider: 'instapay',
          },
          customer: {
            name: 'أحمد محمد',
            phone: '01XXXXXXXXX',
            email: 'customer@example.com',
          },
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          metadata: {
            product_name: 'اسم المنتج',
            order_source: 'website',
          },
        },
        expected_response: {
          payment_request_id: 'uuid-generated-by-server',
          status: 'CREATED',
          amount: 150.00,
          currency: 'EGP',
          external_reference: 'ORDER-001',
          created_at: 'ISO8601',
          expires_at: 'ISO8601',
        },
      },
      error_codes: {
        UNAUTHORIZED: { status: 401, message: 'مفتاح API غير صالح' },
        FORBIDDEN: { status: 403, message: 'لا تملك الصلاحية المطلوبة' },
        VALIDATION_ERROR: { status: 422, message: 'بيانات غير صحيحة' },
        NOT_FOUND: { status: 404, message: 'الطلب غير موجود' },
        INVALID_STATE: { status: 409, message: 'لا يمكن تنفيذ العملية في الحالة الحالية' },
      },
      quick_start_steps: [
        '1. أنشئ مفتاح API من قسم مفاتيح API في التطبيق',
        '2. احفظ KEY_ID و SECRET في متغيرات البيئة (ENV) في موقعك',
        '3. أضف Base URL في إعدادات موقعك',
        '4. عند الدفع: أرسل POST /payment-requests مع بيانات الطلب',
        '5. احفظ payment_request_id في قاعدة بياناتك',
        '6. أضف Webhook endpoint في التطبيق لاستقبال إشعار التأكيد',
        '7. تحقق من توقيع HMAC في كل Webhook واردة',
        '8. عند استقبال status=CONFIRMED → حدّث حالة الطلب في موقعك',
      ],
    };

    return JSON.stringify(integrationDoc, null, 2);
  };

  const handlePreview = async () => {
    setLoading(true); setError(null);
    try {
      const content = await buildIntegrationFile();
      setPreview(content);
      setShowJson(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في توليد الملف');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    setLoading(true); setError(null);
    try {
      const content = preview ?? await buildIntegrationFile();
      if (!preview) setPreview(content);
      await Clipboard.setStringAsync(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في النسخ');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    setLoading(true); setError(null);
    try {
      const content = preview ?? await buildIntegrationFile();
      if (!preview) setPreview(content);
      const fileUri = `${cacheDirectory ?? ''}naderpay-integration.json`;
      await writeAsStringAsync(fileUri, content);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'تصدير ملف التكامل',
          UTI: 'public.json',
        });
      } else {
        await Clipboard.setStringAsync(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في التصدير');
    } finally {
      setLoading(false);
    }
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
          <Text className="text-[17px] font-bold text-[#111827]">ملفات التكامل</Text>
          <Text className="text-[12px] text-[#9CA3AF]">حمّل أو انسخ — كل ما يحتاجه المطوّر</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── قسم التحميل المباشر ─── */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-5" style={{ borderCurve: 'continuous' as 'continuous' }}>
          <Text className="text-[15px] font-bold text-[#111827] mb-1">📥 تحميل مباشر</Text>
          <Text className="text-[12px] text-[#6B7280] leading-5 mb-4">
            انسخ الرابط أو اضغط "فتح / تحميل" مباشرة من المتصفح
          </Text>

          <LinkRow
            icon={<FileText size={15} color="#DC2626" />}
            label="دليل التكامل — PDF"
            url={PDF_URL}
            color="#DC2626"
          />
          <LinkRow
            icon={<FileDown size={15} color="#1D4ED8" />}
            label="دليل التكامل — Markdown (GitHub)"
            url={GUIDE_URL}
            color="#1D4ED8"
          />
          <LinkRow
            icon={<ExternalLink size={15} color="#059669" />}
            label="تحميل تطبيق الأندرويد APK v1.0.191"
            url={APK_URL}
            color="#059669"
          />
        </View>

        {/* ─── ملف JSON ديناميكي ─── */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-5" style={{ borderCurve: 'continuous' as 'continuous' }}>
          <View className="flex-row items-center gap-2 mb-2">
            <FileDown size={18} color="#374151" />
            <Text className="text-[15px] font-bold text-[#111827]">ملف JSON الديناميكي</Text>
          </View>
          <Text className="text-[12px] text-[#6B7280] leading-5 mb-4">
            يُولَّد تلقائياً بمفتاح API الخاص بك — شاركه مع المطوّر مباشرةً.
          </Text>
          <View className="gap-2 mb-4">
            {[
              'Base URL و Endpoints الكاملة',
              'مفتاح API (KEY_ID) مدمج تلقائياً',
              'مثال كامل لإنشاء طلب دفع',
              'إعدادات Webhook + التحقق HMAC',
              'أكواد الأخطاء وحالات الطلبات',
            ].map((item, i) => (
              <View key={i} className="flex-row items-center gap-2">
                <CheckCircle2 size={13} color="#15803D" />
                <Text className="text-[12px] text-[#374151]">{item}</Text>
              </View>
            ))}
          </View>

          {/* أزرار JSON */}
          <Pressable
            onPress={handleShare}
            disabled={loading}
            className="bg-[#111827] rounded-xl py-3.5 flex-row items-center justify-center gap-2 active:opacity-70 mb-2"
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Share2 size={16} color="#fff" />}
            <Text className="text-[13px] font-semibold text-white">
              {loading ? 'جاري التوليد…' : 'تصدير / مشاركة JSON'}
            </Text>
          </Pressable>

          <View className="flex-row gap-2">
            <Pressable
              onPress={handleCopy}
              disabled={loading}
              className="flex-1 border border-[#E5E7EB] bg-[#F8F9FB] rounded-xl py-3 flex-row items-center justify-center gap-1.5 active:opacity-70"
            >
              {copied ? <CheckCircle2 size={14} color="#15803D" /> : <Copy size={14} color="#374151" />}
              <Text className={`text-[12px] font-semibold ${copied ? 'text-green-700' : 'text-[#374151]'}`}>
                {copied ? 'تم النسخ!' : 'نسخ JSON'}
              </Text>
            </Pressable>
            <Pressable
              onPress={handlePreview}
              disabled={loading}
              className="flex-1 border border-[#E5E7EB] bg-[#F8F9FB] rounded-xl py-3 items-center justify-center active:opacity-70"
            >
              <Text className="text-[12px] font-semibold text-[#374151]">
                {showJson ? 'إخفاء المعاينة' : 'معاينة'}
              </Text>
            </Pressable>
          </View>
        </View>

        {error && (
          <View className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3">
            <Text className="text-[12px] text-red-600">{error}</Text>
          </View>
        )}

        {/* معاينة JSON */}
        {showJson && preview && (
          <View className="bg-[#0F172A] rounded-2xl overflow-hidden" style={{ borderCurve: 'continuous' as 'continuous' }}>
            <View className="px-4 py-3 border-b border-[#1E293B] flex-row items-center justify-between">
              <Text className="text-[11px] font-mono text-[#64748B]">naderpay-integration.json</Text>
              <Pressable onPress={handleCopy} className="active:opacity-60 flex-row items-center gap-1">
                {copied ? <CheckCircle2 size={13} color="#4ADE80" /> : <Copy size={13} color="#64748B" />}
                <Text className="text-[10px] text-[#64748B] ml-1">{copied ? 'تم' : 'نسخ'}</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text
                className="text-[10px] font-mono text-[#94A3B8] leading-[16px]"
                style={{ padding: 16, minWidth: 340 }}
                numberOfLines={60}
              >
                {preview.slice(0, 3000)}{preview.length > 3000 ? '\n\n// … (اضغط "تصدير" للملف الكامل)' : ''}
              </Text>
            </ScrollView>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
