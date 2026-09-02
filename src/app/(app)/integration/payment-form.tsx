// شاشة مثال بوابة الدفع — HTML/JS/PHP جاهز للنسخ
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Copy, CheckCircle2, ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

type TabKey = 'html' | 'node' | 'php';

const BASE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co'}/functions/v1`;

const examples: Record<TabKey, { title: string; lang: string; code: string }> = {
  html: {
    title: 'HTML + JavaScript',
    lang: 'html',
    code: `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>بوابة الدفع — نادر باي</title>
  <style>
    body { font-family: sans-serif; max-width: 480px;
           margin: 40px auto; padding: 20px; }
    .btn { background: #111827; color: #fff;
           border: none; padding: 14px 28px;
           border-radius: 10px; cursor: pointer;
           font-size: 16px; width: 100%; }
    .btn:disabled { opacity: 0.5; }
    .status { margin-top: 16px; padding: 12px;
              border-radius: 8px; text-align: center; }
    .success { background: #dcfce7; color: #15803d; }
    .error   { background: #fee2e2; color: #dc2626; }
  </style>
</head>
<body>
  <h2>إتمام الدفع</h2>
  <p>المبلغ: <strong id="amount">150 جنيه</strong></p>

  <button class="btn" id="payBtn" onclick="createPayment()">
    ادفع الآن عبر نادر باي
  </button>
  <div id="status" class="status" style="display:none"></div>

  <script>
    // ⚠️ لا تضع API KEY هنا في الـ Frontend
    // اتصل بـ Backend الخاص بموقعك أولاً

    async function createPayment() {
      const btn = document.getElementById('payBtn');
      const statusDiv = document.getElementById('status');
      btn.disabled = true;
      btn.textContent = 'جاري الإرسال…';

      try {
        // أرسل لـ backend موقعك الذي يتصل بـ NaderPay
        const res = await fetch('/api/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: 'ORDER-' + Date.now(),
            amount: 150,
            currency: 'EGP',
            customer_name: 'اسم العميل',
            customer_phone: '01XXXXXXXXX'
          })
        });

        const data = await res.json();

        if (data.payment_request_id) {
          statusDiv.style.display = 'block';
          statusDiv.className = 'status success';
          statusDiv.innerHTML =
            '✅ تم إرسال طلب الدفع!<br>' +
            '<small>رقم الطلب: ' + data.payment_request_id + '</small>';
        } else {
          throw new Error(data.error || 'فشل الإرسال');
        }
      } catch (err) {
        statusDiv.style.display = 'block';
        statusDiv.className = 'status error';
        statusDiv.textContent = '❌ ' + err.message;
        btn.disabled = false;
        btn.textContent = 'ادفع الآن عبر نادر باي';
      }
    }
  </script>
</body>
</html>`,
  },
  node: {
    title: 'Node.js (Backend)',
    lang: 'javascript',
    code: `// server.js — Express.js Backend
// هذا الكود يعمل على الـ Server، لا المتصفح
const express = require('express');
const app = express();
app.use(express.json());

const NADERPAY_BASE_URL = '${BASE_URL}';
const NADERPAY_API_KEY = process.env.NADERPAY_API_KEY;

// إنشاء طلب دفع
app.post('/api/create-payment', async (req, res) => {
  const { order_id, amount, currency,
          customer_name, customer_phone } = req.body;

  try {
    const response = await fetch(
      \`\${NADERPAY_BASE_URL}/payment-requests\`,
      {
        method: 'POST',
        headers: {
          'x-api-key': NADERPAY_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          external_reference: order_id,
          amount: amount,
          currency: currency,
          customer: {
            name: customer_name,
            phone: customer_phone,
          },
          expires_at: new Date(
            Date.now() + 30 * 60 * 1000
          ).toISOString(),
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// استقبال Webhook من نادر باي
app.post(
  '/webhook/naderpay',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['x-naderpay-signature'];
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', process.env.WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');

    if (\`sha256=\${expected}\` !== sig) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body);
    console.log('Payment event:', event.status);

    if (event.status === 'CONFIRMED') {
      // حدّث قاعدة بياناتك هنا
      // updateOrderStatus(event.external_reference, 'paid');
    }

    res.json({ received: true });
  }
);

app.listen(3000, () => console.log('Server running on :3000'));`,
  },
  php: {
    title: 'PHP',
    lang: 'php',
    code: `<?php
// create_payment.php — Backend PHP

define('NADERPAY_BASE_URL', '${BASE_URL}');
define('NADERPAY_API_KEY', getenv('NADERPAY_API_KEY'));

function createPaymentRequest(array $order): array {
    $payload = json_encode([
        'external_reference' => $order['order_id'],
        'amount'   => $order['amount'],
        'currency' => $order['currency'],
        'customer' => [
            'name'  => $order['customer_name'],
            'phone' => $order['customer_phone'],
        ],
        'expires_at' => date('c', strtotime('+30 minutes')),
    ]);

    $ch = curl_init(NADERPAY_BASE_URL . '/payment-requests');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'x-api-key: ' . NADERPAY_API_KEY,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    return json_decode($response, true);
}

// استخدام
$result = createPaymentRequest([
    'order_id'      => 'ORDER-' . time(),
    'amount'        => 150.00,
    'currency'      => 'EGP',
    'customer_name' => 'أحمد محمد',
    'customer_phone'=> '01XXXXXXXXX',
]);

echo json_encode($result);


// ──────────────────────────────────────────
// webhook.php — استقبال إشعار الدفع
// ──────────────────────────────────────────

$rawBody  = file_get_contents('php://input');
$sig      = $_SERVER['HTTP_X_NADERPAY_SIGNATURE'] ?? '';
$secret   = getenv('WEBHOOK_SECRET');
$expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);

if (!hash_equals($expected, $sig)) {
    http_response_code(401);
    exit('Invalid signature');
}

$event = json_decode($rawBody, true);

if ($event['status'] === 'CONFIRMED') {
    // حدّث قاعدة البيانات
    // updateOrder($event['external_reference'], 'paid');
}

http_response_code(200);
echo json_encode(['received' => true]);`,
  },
};

export default function PaymentFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('html');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(examples[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          <Text className="text-[17px] font-bold text-[#111827]">مثال بوابة الدفع</Text>
          <Text className="text-[12px] text-[#9CA3AF]">كود جاهز لموقعك</Text>
        </View>
        <Pressable
          onPress={handleCopy}
          className="active:opacity-70 flex-row items-center gap-1.5 border border-[#E5E7EB] bg-white rounded-xl px-3 py-2"
        >
          {copied
            ? <CheckCircle2 size={14} color="#15803D" />
            : <Copy size={14} color="#374151" />}
          <Text className="text-[12px] font-semibold text-[#374151]">
            {copied ? 'تم النسخ' : 'نسخ الكل'}
          </Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View className="bg-white border-b border-[#E5E7EB] px-5">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 0 }}>
          <View className="flex-row gap-0">
            {(Object.keys(examples) as TabKey[]).map((key) => (
              <Pressable
                key={key}
                onPress={() => setActiveTab(key)}
                className={`px-4 py-3 border-b-2 ${activeTab === key ? 'border-[#111827]' : 'border-transparent'}`}
              >
                <Text className={`text-[13px] font-semibold ${activeTab === key ? 'text-[#111827]' : 'text-[#9CA3AF]'}`}>
                  {examples[key].title}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* تحذير */}
        <View
          className="bg-[#FFF7ED] border border-[#FED7AA] rounded-xl px-4 py-3 mb-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[12px] text-[#92400E] leading-5">
            ⚠️ <Text className="font-semibold">مهم:</Text> مفتاح API يجب أن يكون في Backend فقط. لا تضعه في HTML أو JavaScript للمتصفح.
          </Text>
        </View>

        {/* الكود */}
        <View className="bg-[#0F172A] rounded-2xl overflow-hidden" style={{ borderCurve: 'continuous' }}>
          <View className="px-4 py-3 border-b border-[#1E293B] flex-row items-center justify-between">
            <Text className="text-[11px] font-mono text-[#64748B]">{examples[activeTab].lang}</Text>
            <Pressable onPress={handleCopy} className="active:opacity-60 flex-row items-center gap-1.5">
              {copied
                ? <CheckCircle2 size={14} color="#4ADE80" />
                : <Copy size={14} color="#64748B" />}
              <Text className="text-[11px] text-[#64748B]">{copied ? 'تم' : 'نسخ'}</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              className="text-[11px] font-mono text-[#E2E8F0] leading-[18px]"
              style={{ padding: 16, minWidth: 360 }}
            >
              {examples[activeTab].code}
            </Text>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}
