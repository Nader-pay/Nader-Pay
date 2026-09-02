// دليل التكامل التفاعلي — 5 خطوات مع أكواد قابلة للنسخ
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Copy, CheckCircle2, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

const BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co'}/functions/v1`;

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
      title: 'Base URL',
      subtitle: 'عنوان API الرئيسي',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            كل الطلبات تُرسل إلى هذا العنوان الأساسي. احفظه في متغيرات البيئة الخاصة بموقعك.
          </Text>
          <CodeBlock
            copyKey="baseurl"
            code={`NADERPAY_BASE_URL="${BASE_URL}"`}
          />
          <Note text="لا تضع هذا العنوان مباشرةً في كود JavaScript للمتصفح — ضعه في Backend أو .env" />
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
      subtitle: 'POST /payment-requests',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            أرسل طلب POST لإنشاء طلب دفع جديد. يجب تضمين الحقول المطلوبة:
          </Text>

          {/* جدول الحقول */}
          <View className="border border-[#E5E7EB] rounded-xl overflow-hidden">
            <View className="bg-[#F8F9FB] px-4 py-2.5 flex-row border-b border-[#E5E7EB]">
              <Text className="text-[11px] font-semibold text-[#6B7280] w-32">الحقل</Text>
              <Text className="text-[11px] font-semibold text-[#6B7280] w-16">النوع</Text>
              <Text className="text-[11px] font-semibold text-[#6B7280] flex-1">الوصف</Text>
            </View>
            {[
              { field: 'external_reference', type: 'string', required: true, desc: 'رقم الطلب في موقعك' },
              { field: 'amount', type: 'number', required: true, desc: 'المبلغ (موجب)' },
              { field: 'currency', type: 'string', required: true, desc: 'العملة (مثال: EGP)' },
              { field: 'destination.wallet_number', type: 'string', required: false, desc: 'رقم المحفظة المستقبِلة' },
              { field: 'destination.provider', type: 'string', required: false, desc: 'instapay / vodafone' },
              { field: 'customer.name', type: 'string', required: false, desc: 'اسم العميل' },
              { field: 'customer.phone', type: 'string', required: false, desc: 'رقم هاتف العميل' },
              { field: 'expires_at', type: 'ISO date', required: false, desc: 'انتهاء صلاحية الطلب' },
            ].map((row, i) => (
              <View
                key={row.field}
                className={`px-4 py-2.5 flex-row items-start ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}
              >
                <View className="w-32 flex-row gap-1 items-center flex-wrap">
                  <Text className="text-[10px] font-mono text-[#374151]">{row.field}</Text>
                  {row.required && (
                    <Text className="text-[10px] text-red-500 font-bold">*</Text>
                  )}
                </View>
                <Text className="text-[10px] text-[#9CA3AF] w-16 font-mono">{row.type}</Text>
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
      "Content-Type": "application/json"
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
      ).toISOString()
    })
  }
);

const data = await response.json();
console.log(data.payment_request_id); // احفظ هذا`}
          />

          {/* استجابة ناجحة */}
          <Text className="text-[12px] font-semibold text-[#374151] mt-2">الاستجابة الناجحة (201):</Text>
          <CodeBlock
            copyKey="response"
            code={`{
  "payment_request_id": "uuid-xxx",
  "status": "CREATED",
  "amount": 150.00,
  "currency": "EGP",
  "external_reference": "ORDER-001",
  "created_at": "2024-01-01T12:00:00Z",
  "expires_at": "2024-01-01T12:30:00Z"
}`}
          />
          <Note text='احفظ payment_request_id لاستخدامه في استعلام الحالة والـ Webhook.' />
        </View>
      ),
    },
    {
      id: 4,
      title: 'استعلام حالة الطلب',
      subtitle: 'GET /payment-requests/{id}',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            استعلم عن حالة طلب الدفع في أي وقت باستخدام الـ ID الذي حصلت عليه عند الإنشاء.
          </Text>
          <CodeBlock
            copyKey="get-status"
            code={`// استعلام الحالة
const res = await fetch(
  \`\${NADERPAY_BASE_URL}/payment-requests/\${paymentRequestId}\`,
  {
    headers: {
      "x-api-key": process.env.NADERPAY_API_KEY
    }
  }
);
const data = await res.json();
// data.status: CREATED | CONFIRMED | REJECTED | EXPIRED`}
          />

          {/* حالات الطلب */}
          <Text className="text-[12px] font-semibold text-[#374151] mt-2">حالات الطلب الممكنة:</Text>
          <View className="gap-1.5">
            {[
              { status: 'CREATED', color: '#EEF2FF', text: '#4338CA', desc: 'تم الإنشاء، بانتظار الدفع' },
              { status: 'CONFIRMED', color: '#DCFCE7', text: '#15803D', desc: 'تم تأكيد الدفع بنجاح' },
              { status: 'REJECTED', color: '#FEE2E2', text: '#DC2626', desc: 'مرفوض أو غير متطابق' },
              { status: 'EXPIRED', color: '#F3F4F6', text: '#6B7280', desc: 'انتهت الصلاحية' },
              { status: 'CANCELLED', color: '#FFF7ED', text: '#EA580C', desc: 'ملغى يدوياً' },
            ].map((s) => (
              <View key={s.status} className="flex-row items-center gap-3 bg-[#FAFAFA] border border-[#E5E7EB] rounded-xl px-3 py-2.5">
                <View className={`rounded-full px-2.5 py-1`} style={{ backgroundColor: s.color }}>
                  <Text className="text-[10px] font-bold" style={{ color: s.text }}>{s.status}</Text>
                </View>
                <Text className="text-[12px] text-[#374151] flex-1">{s.desc}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },
    {
      id: 5,
      title: 'Webhook — استقبال التأكيد',
      subtitle: 'إشعار فوري عند تأكيد الدفع',
      content: (
        <View className="gap-2">
          <Text className="text-[13px] text-[#374151] leading-6">
            سيُرسل التطبيق إشعاراً تلقائياً إلى موقعك فور تأكيد الدفع. أضف endpoint في إعدادات Webhook.
          </Text>

          <Text className="text-[12px] font-semibold text-[#374151] mt-1">Headers التي تصلك:</Text>
          <CodeBlock
            copyKey="webhook-headers"
            code={`X-NaderPay-Signature: sha256=abc123...
X-NaderPay-Timestamp: 1700000000
X-Webhook-Event-Id: evt_uuid`}
          />

          <Text className="text-[12px] font-semibold text-[#374151] mt-2">التحقق من التوقيع (موصى به):</Text>
          <CodeBlock
            copyKey="webhook-verify"
            code={`// Node.js — التحقق من HMAC
const crypto = require('crypto');

function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return \`sha256=\${expected}\` === signature;
}

// في Express:
app.post('/webhook/naderpay', (req, res) => {
  const sig = req.headers['x-naderpay-signature'];
  const isValid = verifyWebhook(
    req.rawBody,       // body خام بدون parse
    sig,
    process.env.WEBHOOK_SECRET
  );

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  // event.status === 'CONFIRMED' → حدّث طلبك
  res.json({ received: true });
});`}
          />

          <Text className="text-[12px] font-semibold text-[#374151] mt-2">مثال على البيانات الواردة:</Text>
          <CodeBlock
            copyKey="webhook-body"
            code={`{
  "event_type": "payment_request.confirmed",
  "payment_request_id": "uuid-xxx",
  "external_reference": "ORDER-001",
  "status": "CONFIRMED",
  "amount": 150.00,
  "currency": "EGP",
  "timestamp": "2024-01-01T12:15:00Z"
}`}
          />
          <Note text="أعد دائماً HTTP 200 فور استقبال الـ Webhook. المعالجة الثقيلة تكون في background." />
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
