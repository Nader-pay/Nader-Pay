# دليل التكامل الشامل لنظام نادر باي (NaderPay Integration Guide)

دليل كامل لأصحاب المواقع والمطورين لربط أي موقع إلكتروني أو تطبيق بنظام نادر باي لإدارة المدفوعات والتحقق التلقائي من المعاملات.

---

## 1. نظرة عامة (Overview)
نظام **نادر باي (NaderPay)** يتيح لموقعك:
1. إنشاء طلبات دفع برمز معاملة فريد (`reference_id`).
2. ربط محافظ فودافون كاش، أورنج كاش، إتصالات كاش، إنستاباي.
3. قراءة وتأكيد الرسائل البنكية تلقائياً عبر تطبيق الأندرويد.
4. إرسال Webhook تلقائي وفوري لموقعك عند تأكيد الدفع مع توقيع أمني HMAC-SHA256.

---

## 2. الإعدادات الأساسية (Base Configuration)
- **رابط الـ API الأساسي (Edge Functions):**
  `https://hbldhnpduoczneoyfzyz.supabase.co/functions/v1`
- **الترويسات الإلزامية (Required Headers):**
  - `Content-Type: application/json`
  - `x-api-key: YOUR_MERCHANT_API_KEY` (أو Bearer token)

---

## 3. إنشاء طلب دفع (Create Payment Request)
- **Endpoint:** `POST /create-payment-request`

### جسم الطلب (Request Body):
```json
{
  "amount": 150.00,
  "currency": "EGP",
  "method": "vodafone_cash",
  "order_id": "ORD-98231",
  "customer_phone": "01012345678",
  "webhook_url": "https://your-website.com/api/naderpay-webhook",
  "redirect_url": "https://your-website.com/checkout/success"
}
```

### الاستجابة الناجحة (Success Response - 200 OK):
```json
{
  "status": "success",
  "data": {
    "payment_id": "pay_98231a4f",
    "reference_id": "NP-8831",
    "amount": 150.00,
    "target_wallet": "01099887766",
    "checkout_url": "https://naderpay.com/pay/pay_98231a4f",
    "expires_at": "2026-09-15T20:30:00Z"
  }
}
```

---

## 4. التحقق من حالة الدفع (Check Payment Status)
- **Endpoint:** `GET /payment-status?payment_id=pay_98231a4f`

### الاستجابة:
```json
{
  "status": "success",
  "data": {
    "payment_id": "pay_98231a4f",
    "order_id": "ORD-98231",
    "state": "CONFIRMED",
    "amount": 150.00,
    "received_amount": 150.00,
    "sender_phone": "01012345678",
    "confirmed_at": "2026-09-15T19:42:10Z"
  }
}
```

---

## 5. استقبال إشعارات الدفع (Webhook Verification)
عند تأكيد الدفع من تطبيق الأندرويد، يُرسل النظام إشعار `POST` إلى `webhook_url` المسجل لديك.

### ترويسة التوقيع:
- `X-Signature: <HMAC_SHA256_HEX>`

### بيانات الـ Webhook:
```json
{
  "event": "payment.confirmed",
  "payment_id": "pay_98231a4f",
  "order_id": "ORD-98231",
  "amount": 150.00,
  "method": "vodafone_cash",
  "status": "COMPLETED",
  "timestamp": 1789501330
}
```

### مثال التحقق في PHP:
```php
<?php
$secret = "YOUR_WEBHOOK_SECRET";
$payload = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_SIGNATURE'] ?? '';

$expected = hash_hmac('sha256', $payload, $secret);

if (hash_equals($expected, $signature)) {
    $data = json_decode($payload, true);
    if ($data['event'] === 'payment.confirmed') {
        $orderId = $data['order_id'];
        // قم بتفعيل الطلب أو شحن الرصيد للعميل هنا
        http_response_code(200);
        echo json_encode(["status" => "success"]);
        exit;
    }
} else {
    http_response_code(401);
    echo "Invalid Signature";
}
?>
```

### مثال التحقق في Node.js / Express:
```javascript
const crypto = require('crypto');
const express = require('express');
const app = express();

app.post('/api/naderpay-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-signature'];
  const secret = process.env.NADERPAY_WEBHOOK_SECRET;
  
  const hmac = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (hmac !== signature) {
    return res.status(401).send('Unauthorized');
  }

  const event = JSON.parse(req.body.toString());
  if (event.event === 'payment.confirmed') {
    console.log(`Order ${event.order_id} has been paid successfully!`);
    // شحن الرصيد أو تفعيل الطلب
  }

  res.status(200).json({ received: true });
});
```

---

## 6. حالات الطلب (Payment States)
- `PENDING`: بانتظار تحويل العميل للرصيد.
- `DETECTED`: تم استلام إشعار أو رسالة SMS برقم المعاملة.
- `CONFIRMED`: تم مطابقة وتأكيد المبلغ وتحديث رصيد الحساب.
- `EXPIRED`: انتهت مهلة السداد (15 دقيقة افتراضياً).
- `FAILED`: فشل التحقق أو رفضت العملية.
