// دليل التكامل التفاعلي — API Contract الحقيقي
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Copy, CheckCircle2, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

const BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co'}/functions/v1`;
const PR_URL = `${BASE_URL}/payment-requests`;

type Step = {
  id: number;
  title: string;
  subtitle: string;
  content: React.ReactNode;
};

function CodeBlock({ code, copyKey }: { code: string; copyKey: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <View className="bg-[#0F172A] rounded-xl px-4 py-3 mt-2 relative">
      <Pressable onPress={handleCopy} className="absolute top-2.5 right-3 active:opacity-60 z-10">
        {copied
          ? <CheckCircle2 size={16} color="#4ADE80" />
          : <Copy size={16} color="#94A3B8" />}
      </Pressable>
      <Text className="text-[11px] font-mono text-[#E2E8F0] leading-[18px] pr-6">{code}</Text>
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3 mt-3">
      <Text className="text-[12px] text-[#92400E] leading-5">💡 {text}</Text>
    </View>
  );
}

export default function GuideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [openStep, setOpenStep] = useState<number>(1);

  const steps: Step[] = [
    {
      id: 1,
      title: 'Base URL والإعداد',
      subtitle: 'عنوان API الحقيقي + متغيرات البيئة',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            كل الطلبات تُرسل إلى هذا العنوان. احفظه مع API Key في متغيرات البيئة (ENV) في Backend موقعك.
          </Text>
          <CodeBlock
            copyKey="baseurl"
            code={`# متغيرات البيئة في Backend موقعك
NADERPAY_BASE_URL="${BASE_URL}"
NADERPAY_API_KEY="KEY_ID:SECRET"
NADERPAY_WEBHOOK_SECRET="whsec_..."`}
          />
          <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 gap-2 mt-1">
            <Text className="text-[12px] font-semibold text-[#374151]">Endpoints الرئيسية:</Text>
            {[
              { method: 'POST', path: '/payment-requests', desc: 'إنشاء طلب دفع جديد' },
              { method: 'GET',  path: '/payment-requests', desc: 'قائمة طلبات الدفع' },
              { method: 'GET',  path: '/payment-requests/{id}', desc: 'حالة طلب محدد' },
              { method: 'POST', path: '/payment-requests/{id}/cancel', desc: 'إلغاء طلب' },
              { method: 'POST', path: '/payment-requests/{id}/status', desc: 'تحديث الحالة' },
            ].map(({ method, path, desc }) => (
              <View key={path} className="flex-row items-center gap-2">
                <View className={`rounded px-1.5 py-0.5 ${method === 'POST' ? 'bg-[#EEF2FF]' : 'bg-[#F0FDF4]'}`}>
                  <Text className={`text-[9px] font-bold ${method === 'POST' ? 'text-[#4338CA]' : 'text-[#15803D]'}`}>{method}</Text>
                </View>
                <Text className="text-[10px] font-mono text-[#374151] flex-1">{path}</Text>
                <Text className="text-[10px] text-[#9CA3AF]">{desc}</Text>
              </View>
            ))}
          </View>
          <Note text="لا تضع API Key في كود Frontend المتصفح. الطريقة الصحيحة: موقعك → Backend → NaderPay API" />
        </View>
      ),
    },
    {
      id: 2,
      title: 'المصادقة (Authentication)',
      subtitle: 'إضافة مفتاح API لكل طلب',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            أضف مفتاح API في Header لكل طلب. المفتاح يتكون من جزأين مفصولين بنقطة:
          </Text>
          <View className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl px-4 py-3 gap-2">
            <View className="flex-row gap-2">
              <View className="bg-[#EEF2FF] rounded-lg px-2 py-1">
                <Text className="text-[10px] font-semibold text-[#4338CA]">KEY_ID</Text>
              </View>
              <Text className="text-[12px] text-[#374151]">معرّف المفتاح (ظاهر في التطبيق)</Text>
            </View>
            <View className="flex-row gap-2">
              <View className="bg-[#FEF3C7] rounded-lg px-2 py-1">
                <Text className="text-[10px] font-semibold text-[#92400E]">SECRET</Text>
              </View>
              <Text className="text-[12px] text-[#374151]">السر (يُعرض مرة واحدة فقط)</Text>
            </View>
          </View>
          <CodeBlock
            copyKey="auth"
            code={`// JavaScript / Node.js
const headers = {
  "x-api-key": "pk_abc123.yoursecrethere",
  "Content-Type": "application/json"
};`}
          />
          <CodeBlock
            copyKey="auth-php"
            code={`# PHP
$headers = [
  "x-api-key: pk_abc123.yoursecrethere",
  "Content-Type: application/json"
];`}
          />
          <Note text="لا تشارك السر مع أحد. إذا تسرّب، قم بإلغائه وإنشاء مفتاح جديد فوراً." />
        </View>
      ),
    },
    {
      id: 3,
      title: 'إنشاء طلب دفع',
      subtitle: 'POST /payment-requests — الحقول الحقيقية',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            الحقول المطلوبة مستخرجة مباشرة من <Text className="font-bold">validateRequestBody</Text> في محرّك التحقق:
          </Text>

          {/* جدول الحقول */}
          <View className="border border-[#E5E7EB] rounded-xl overflow-hidden">
            <View className="bg-[#F8F9FB] px-4 py-2.5 flex-row border-b border-[#E5E7EB]">
              <Text className="text-[11px] font-semibold text-[#6B7280] w-32">الحقل</Text>
              <Text className="text-[11px] font-semibold text-[#6B7280] w-12">إلزامي</Text>
              <Text className="text-[11px] font-semibold text-[#6B7280] flex-1">الوصف</Text>
            </View>
            {[
              { field: 'external_reference', required: true,  desc: 'رقم الطلب في موقعك (فريد)' },
              { field: 'amount',             required: true,  desc: 'المبلغ (رقم موجب)' },
              { field: 'currency',           required: true,  desc: 'العملة (EGP, USD…)' },
              { field: 'destination',        required: false, desc: 'wallet_number + provider' },
              { field: 'customer',           required: false, desc: 'name + phone للمشتري' },
              { field: 'verification',       required: false, desc: 'expected_message أو transaction_id' },
              { field: 'expires_at',         required: false, desc: 'ISO8601 — افتراضي 24 ساعة' },
              { field: 'order_reference',    required: false, desc: 'مرجع إضافي اختياري' },
              { field: 'metadata',           required: false, desc: 'بيانات حرة JSON' },
            ].map((row, i) => (
              <View
                key={row.field}
                className={`px-4 py-2.5 flex-row items-start ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
              >
                <Text className="text-[10px] font-mono text-[#374151] w-32">{row.field}</Text>
                <View className="w-12 items-center">
                  {row.required
                    ? <View className="bg-[#FEE2E2] rounded px-1.5 py-0.5"><Text className="text-[9px] font-bold text-[#DC2626]">نعم</Text></View>
                    : <Text className="text-[10px] text-[#9CA3AF]">—</Text>}
                </View>
                <Text className="text-[11px] text-[#6B7280] flex-1 leading-4">{row.desc}</Text>
              </View>
            ))}
          </View>

          <CodeBlock
            copyKey="post-request"
            code={`// Node.js — إنشاء طلب دفع
const response = await fetch(
  \`\${NADERPAY_BASE_URL}/payment-requests\`,
  {
    method: "POST",
    headers: {
      "x-api-key": process.env.NADERPAY_API_KEY,
      "Content-Type": "application/json",
      // لمنع الإرسال المزدوج (Idempotency):
      "x-idempotency-key": "ORDER-001-attempt-1"
    },
    body: JSON.stringify({
      external_reference: "ORDER-001",
      amount: 150.00,
      currency: "EGP",
      destination: {
        wallet_number: "01XXXXXXXXX",
        provider: "instapay"
      },
      customer: {
        name: "أحمد محمد",
        phone: "01XXXXXXXXX"
      },
      expires_at: new Date(
        Date.now() + 30 * 60 * 1000
      ).toISOString(),
      metadata: { order_type: "product", source: "website" }
    })
  }
);

// 201 Created = نجاح
// 409 Conflict = external_reference مكرر
const data = await response.json();
// احفظ: data.payment_request_id`}
          />

          <Text className="text-[12px] font-semibold text-[#374151] mt-2">الاستجابة الناجحة (201):</Text>
          <CodeBlock
            copyKey="response"
            code={`{
  "payment_request_id": "uuid-xxx",
  "status": "CREATED",
  "amount": 150.00,
  "currency": "EGP",
  "external_reference": "ORDER-001",
  "created_at": "2025-01-01T12:00:00Z",
  "expires_at": "2025-01-01T12:30:00Z"
}`}
          />
          <Note text='x-idempotency-key يمنع إنشاء طلبَين متطابقَين عند الإعادة. احفظ payment_request_id في قاعدة بياناتك.' />
        </View>
      ),
    },
    {
      id: 4,
      title: 'حالات الطلب',
      subtitle: 'CREATED / CONFIRMED / REJECTED / EXPIRED / CANCELLED / DUPLICATE',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            محرّك التحقق يحدّث الحالة تلقائياً عند مطابقة رسالة SMS أو تحويل بنكي.
          </Text>

          <View className="gap-1.5">
            {[
              { status: 'CREATED',   bg: '#EEF2FF', fg: '#4338CA', desc: 'تم الإنشاء — بانتظار دفع العميل' },
              { status: 'CONFIRMED', bg: '#DCFCE7', fg: '#15803D', desc: 'الدفع تم وتُحقق منه بنجاح' },
              { status: 'REJECTED',  bg: '#FEE2E2', fg: '#DC2626', desc: 'لم تتطابق بيانات الدفع' },
              { status: 'DUPLICATE', bg: '#FEE2E2', fg: '#B91C1C', desc: 'عملية دفع مكررة بنفس المرجع' },
              { status: 'EXPIRED',   bg: '#F3F4F6', fg: '#6B7280', desc: 'انتهت صلاحية الطلب (24 س افتراضياً)' },
              { status: 'CANCELLED', bg: '#FFF7ED', fg: '#EA580C', desc: 'ملغى يدوياً عبر API' },
            ].map((s) => (
              <View key={s.status} className="flex-row items-center gap-3 bg-[#FAFAFA] border border-[#E5E7EB] rounded-xl px-3 py-2.5">
                <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: s.bg }}>
                  <Text className="text-[10px] font-bold" style={{ color: s.fg }}>{s.status}</Text>
                </View>
                <Text className="text-[12px] text-[#374151] flex-1">{s.desc}</Text>
              </View>
            ))}
          </View>

          <CodeBlock
            copyKey="get-status"
            code={`// استعلام حالة طلب محدد
const res = await fetch(
  \`\${NADERPAY_BASE_URL}/payment-requests/\${id}\`,
  { headers: { "x-api-key": process.env.NADERPAY_API_KEY } }
);
const { status } = await res.json();
// CONFIRMED → اعتمد الطلب في قاعدة بياناتك`}
          />

          <CodeBlock
            copyKey="cancel"
            code={`// إلغاء طلب
await fetch(
  \`\${NADERPAY_BASE_URL}/payment-requests/\${id}/cancel\`,
  { method: "POST",
    headers: { "x-api-key": process.env.NADERPAY_API_KEY } }
);`}
          />
        </View>
      ),
    },
    {
      id: 5,
      title: 'Webhook — استقبال التأكيد',
      subtitle: 'HMAC-SHA256 · إعادة محاولة تلقائية',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            NaderPay يرسل POST إلى endpoint موقعك فور تأكيد الدفع، موقّعاً بـ HMAC-SHA256.
            النظام يعيد المحاولة تلقائياً عند الفشل.
          </Text>

          <Text className="text-[12px] font-semibold text-[#374151] mt-1">Headers الواردة:</Text>
          <CodeBlock
            copyKey="webhook-headers"
            code={`X-NaderPay-Signature: sha256=abc123...
X-NaderPay-Timestamp: 1700000000
X-Webhook-Event-Id: evt_uuid
Content-Type: application/json`}
          />

          <Text className="text-[12px] font-semibold text-[#374151] mt-2">التحقق من HMAC (إلزامي في Production):</Text>
          <CodeBlock
            copyKey="webhook-verify"
            code={`// Node.js / Express
const crypto = require('crypto');

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)          // Raw Buffer — لا JSON.parse!
    .digest('hex');
  // مقارنة آمنة زمنياً (timing-safe)
  return crypto.timingSafeEqual(
    Buffer.from(\`sha256=\${expected}\`),
    Buffer.from(signature)
  );
}

app.post('/webhooks/naderpay',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['x-naderpay-signature'];
    if (!verifyWebhook(req.body, sig, process.env.NADERPAY_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const event = JSON.parse(req.body);
    if (event.event_type === 'payment.confirmed') {
      // حدّث قاعدة بياناتك هنا
    }
    res.json({ received: true }); // أعِد 200 فوراً
  }
);`}
          />

          <Text className="text-[12px] font-semibold text-[#374151] mt-2">البيانات الواردة (payload):</Text>
          <CodeBlock
            copyKey="webhook-body"
            code={`{
  "event_type": "payment.confirmed",
  "payment_request_id": "uuid-xxx",
  "external_reference": "ORDER-001",
  "status": "CONFIRMED",
  "amount": 150.00,
  "currency": "EGP",
  "timestamp": "2025-01-01T12:15:00Z",
  "metadata": { "order_type": "product" }
}
// الأحداث: payment.confirmed | payment.rejected
//          payment.expired  | payment.duplicate`}
          />
          <Note text="أعِد HTTP 200 فور استقبال الحدث. المعالجة الثقيلة (بريد، مخزون…) تكون في queue في الخلفية." />
        </View>
      ),
    },
  ];

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
          <Text className="text-[17px] font-bold text-[#111827]">دليل التكامل</Text>
          <Text className="text-[12px] text-[#9CA3AF]">خطوة بخطوة للربط مع موقعك</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {steps.map((step) => {
          const isOpen = openStep === step.id;
          return (
            <View
              key={step.id}
              className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden"
              style={{ borderCurve: 'continuous' }}
            >
              <Pressable
                onPress={() => setOpenStep(isOpen ? 0 : step.id)}
                className="flex-row items-center gap-4 px-5 py-4 active:opacity-70"
              >
                <View className={`w-8 h-8 rounded-full items-center justify-center ${isOpen ? 'bg-[#111827]' : 'bg-[#F3F4F6]'}`}>
                  <Text className={`text-[13px] font-bold ${isOpen ? 'text-white' : 'text-[#6B7280]'}`}>{step.id}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold text-[#111827]">{step.title}</Text>
                  <Text className="text-[12px] text-[#9CA3AF]">{step.subtitle}</Text>
                </View>
                {isOpen
                  ? <ChevronDown size={18} color="#9CA3AF" />
                  : <ChevronRight size={18} color="#D1D5DB" />}
              </Pressable>
              {isOpen && (
                <View className="px-5 pb-5 border-t border-[#F3F4F6]">
                  <View className="pt-4">{step.content}</View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
