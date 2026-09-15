# دليل تكامل NaderPay للمطوّرين (Integration Guide)

> هذا الدليل يشرح كيفية ربط موقعك الخارجي أو متجرك ببوابة الدفع **NaderPay** عبر الـ API والـ Webhook بشكل صحيح لتجنب أخطاء الاتصال و CORS.

---

## 1. بيانات الاتصال الأساسية (Endpoints & Credentials)

| البيان | القيمة |
|---|---|
| **Base URL** | `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1` |
| **Webhook Endpoint** | `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/naderpay-webhook` |
| **Create Request Endpoint** | `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/integrations/requests` |
| **طريقة المصادقة** | Header: `x-api-key: pk_XXXXX:secret_XXXXX` |
| **نوع المحتوى** | `Content-Type: application/json` |

---

## 2. سبب خطأ `Failed to fetch` في اختبار الاتصال وكيفية حله

### سبب المشكلة:
عند فحص الاتصال من لوحة تحكم الموقع عبر المتصفح (Browser Fetch)، السيرفر يتطلب وجود Header مخصص للاختبار. بدون هذا الـ Header يرفض السيرفر الطلب بدون إرجاع ترويسات CORS المسموحة للمتصفح، فيظهر الخطأ كـ `Failed to fetch`.

### الحل:
إضافة الـ Header التالي في طلب فحص الاتصال:
```http
X-Webhook-Test: true
```

---

## 3. كود اختبار الاتصال الصحيح (JavaScript / Frontend)

```javascript
// دالة فحص الاتصال من لوحة تحكم موقعك
async function testNaderPayConnection(apiKey) {
  try {
    const response = await fetch('https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/naderpay-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,          // الصيغة: pk_XXXXX:secret_XXXXX
        'X-Webhook-Test': 'true'       // ← ضروري جداً لاجتياز اختبار الاتصال و CORS
      },
      body: JSON.stringify({
        test: true,
        timestamp: new Date().toISOString()
      })
    });

    const result = await response.json();
    
    if (response.ok && result.auth_verified) {
      console.log('✅ تم الاتصال بنجاح:', result.message);
      return { success: true, data: result };
    } else {
      console.error('❌ فشل الاتصال:', result);
      return { success: false, error: result.error || 'فشل التحقق من المفتاح' };
    }
  } catch (err) {
    console.error('❌ خطأ في الشبكة:', err);
    return { success: false, error: err.message };
  }
}
```

---

## 4. كود اختبار الاتصال (PHP / cURL)

```php
<?php
function testNaderPayConnection(string $apiKey): array {
    $url = 'https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/naderpay-webhook';
    
    $payload = json_encode([
        'test' => true,
        'timestamp' => date('c')
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $apiKey,
            'X-Webhook-Test: true' // ← ضروري للاختبار
        ],
        CURLOPT_TIMEOUT        => 15
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $result = json_decode($response, true);
    return [
        'code' => $httpCode,
        'success' => ($httpCode === 200 && ($result['auth_verified'] ?? false)),
        'data' => $result
    ];
}

// مثال الاستخدام:
// $test = testNaderPayConnection('pk_97c6b2d1...:772e65e...');
// print_r($test);
?>
```

---

## 5. كود إرسال Webhook حقيقي (Node.js / Backend)

عند تأكيد عملية دفع أو إرسال حدث حقيقي من السيرفر:

```javascript
const crypto = require('crypto');

async function sendNaderPayWebhook({ apiKey, webhookSecret, event, data }) {
  const eventId = crypto.randomUUID();
  const timestamp = Date.now().toString();
  
  const payload = {
    event: event, // مثال: 'payment.created' أو 'payment.confirmed'
    data: data,
    timestamp: new Date().toISOString()
  };
  
  const bodyString = JSON.stringify(payload);
  
  // توليد التوقيع الرقمي HMAC-SHA256
  const signature = 'sha256=' + crypto
    .createHmac('sha256', webhookSecret)
    .update(bodyString)
    .digest('hex');

  const response = await fetch('https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/naderpay-webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'X-Webhook-Event-Id': eventId,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': signature
    },
    body: bodyString
  });

  return await response.json();
}
```

---

## 6. استجابة السيرفر المتوقعة عند النجاح (Expected Response)

```json
{
  "received": true,
  "test": true,
  "auth_verified": true,
  "message": "اتصال ناجح — NaderPay Webhook جاهز لاستقبال الأحداث",
  "endpoint": "naderpay-webhook",
  "timestamp": "2026-09-15T22:45:00.000Z"
}
```

---

## 7. خطوات الربط السريعة

1. افتح تطبيق **NaderPay** واذهب إلى قسم **التكامل** ثم افتح تفاصيل التكامل الخاص بك.
2. انسخ **مفتاح API** كاملاً بصيغة `pk_XXXXX:secret_XXXXX`.
3. في إعدادات موقعك الخارجي:
   - ضع المفتاح في خانة **API Key**.
   - ضع نفس المفتاح في خانة **API Secret** (أو حسب بنية الموقع).
   - ضع رابط الـ Webhook: `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1/naderpay-webhook`.
   - ضع **Webhook Signing Secret** إذا كان متاحاً في التطبيق.
4. اضغط **حفظ** ثم اضغط **فحص الاتصال**.
