# توثيق API التكامل

## نظرة عامة

Base URL: `https://<project-ref>.supabase.co/functions/v1/`

Content-Type: `application/json`

## 1. Authentication

كل طلب يجب أن يتضمن:

- `x-api-key` — API key الخاصة بالحساب.
- `x-timestamp` — Unix timestamp بالثواني.
- `x-nonce` — قيمة عشوائية فريدة (UUID). يُمنع تكرارها خلال 24 ساعة.
- `x-signature` — HMAC-SHA256 لـ request body أو timestamp+nonce إذا لم يوجد body.

### حساب التوقيع

```text
signature = HMAC-SHA256(
  key = API_SECRET,
  message = "<method>\n<path>\n<timestamp>\n<nonce>\n<body>"
)
```

إذا لم يوجد body: `body` = `""`.

### مثال cURL

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/payment-requests \
  -H "Content-Type: application/json" \
  -H "x-api-key: apikey_xxx" \
  -H "x-timestamp: 1700000000" \
  -H "x-nonce: uuid-v4" \
  -H "x-signature: <hmac>" \
  -d '{"amount":100,"currency":"SAR","provider":"bank_x","external_ref":"order_123"}'
```

### أخطاء المصادقة

| HTTP | الرمز | الشرح |
|------|------|-------|
| 401 | AUTH_MISSING | API key أو توقيع أو timestamp أو nonce مفقود. |
| 401 | AUTH_INVALID_KEY | API key غير موجودة أو موقوفة. |
| 401 | AUTH_INVALID_SIGNATURE | توقيع HMAC غير صحيح. |
| 401 | AUTH_REPLAY | nonce مكرر أو timestamp قديم (>60s) أو مستقبلي. |
| 429 | RATE_LIMIT | تجاوزت الحد الأقصى للطلبات. |

## 2. Payment Requests

### 2.1 إنشاء طلب

`POST /payment-requests`

#### Request body

| الحقل | النوع | مطلوب | الوصف |
|-------|------|-------|-------|
| amount | number | نعم | المبلغ المتوقع. |
| currency | string | نعم | رمز العملة (SAR, USD, ...). |
| provider | string | نعم | مزود الدفع (bank_x, wallet_y). |
| external_ref | string | نعم | مرجع الطلب الخارجي (فريد داخل الحساب). |
| sender_name | string | لا | اسم المرسل المتوقع. |
| sender_phone | string | لا | رقم هاتف المرسل. |
| recipient_account | string | لا | الحساب المستقبل. |
| expires_at | string | لا | ISO 8601 — الوقت النهائي للقبول. |
| metadata | object | لا | أي بيانات إضافية. |

#### Response 201

```json
{
  "id": "pr_xxx",
  "status": "PENDING",
  "amount": 100,
  "currency": "SAR",
  "provider": "bank_x",
  "external_ref": "order_123",
  "expires_at": "2026-08-26T12:00:00Z",
  "created_at": "2026-08-26T10:00:00Z"
}
```

### 2.2 جلب طلب

`GET /payment-requests/:id`

Response:

```json
{
  "id": "pr_xxx",
  "status": "CONFIRMED",
  "amount": 100,
  "detected_amount": 100,
  "verification": {
    "amount_match": true,
    "sender_name_match": true,
    "sender_phone_match": true,
    "recipient_match": true,
    "is_unique": true,
    "time_valid": true,
    "provider_valid": true,
    "confidence_score": 1.0
  }
}
```

### 2.3 إلغاء طلب

`POST /payment-requests/:id/cancel`

Response:

```json
{"status":"CANCELLED"}
```

### 2.4 حالة الطلب

`GET /payment-requests/:id/status`

Response:

```json
{
  "id": "pr_xxx",
  "status": "CONFIRMED",
  "confirmed_at": "2026-08-26T10:05:00Z"
}
```

### 2.5 أخطاء Payment Requests

| HTTP | الرمز | الشرح |
|------|------|-------|
| 400 | VALIDATION_ERROR | حقل مفقود أو غير صالح. |
| 404 | NOT_FOUND | الطلب غير موجود أو لا ينتمي للحساب. |
| 409 | DUPLICATE_EXTERNAL_REF | external_ref مستخدم مسبقًا. |
| 409 | INVALID_STATE | الإلغاء لا ينطبق على الحالة الحالية. |

## 3. Webhooks

### 3.1 أنواع الأحداث

- `payment_request.created`
- `payment_request.confirmed`
- `payment_request.rejected`
- `payment_request.review_required`
- `payment_request.expired`
- `payment_request.cancelled`
- `device.offline`
- `device.online`

### 3.2 Payload

```json
{
  "event": "payment_request.confirmed",
  "timestamp": "2026-08-26T10:05:00Z",
  "delivery_id": "dl_xxx",
  "data": {
    "id": "pr_xxx",
    "status": "CONFIRMED",
    "amount": 100,
    "currency": "SAR",
    "external_ref": "order_123",
    "confirmed_at": "2026-08-26T10:05:00Z"
  }
}
```

### 3.3 توقيع Webhook

```text
signature = HMAC-SHA256(
  key = webhook_secret,
  message = "<timestamp>.<delivery_id>.<body>"
)
```

يُرسل في الهيدر `x-webhook-signature`.

### 3.4 Retries

- First delivery: فورًا.
- Retries: 5 مرات بفترات متزايدة: 30s, 2m, 5m, 15m, 30m.
- بعد الاستنزاف: يُحفظ في failed deliveries.

### 3.5 Idempotency

استخدم `delivery_id` لتجاهل التكرار. يُعتبر كل `delivery_id` فريدًا لمدة 72 ساعة.

## 4. Devices

### 4.1 تسجيل جهاز

`POST /devices/register`

```json
{
  "device_name": "Store Tablet #1",
  "public_key": "..."
}
```

Response:

```json
{
  "device_id": "dev_xxx",
  "access_token": "jwt",
  "refresh_token": "jwt"
}
```

### 4.2 Heartbeat

`POST /devices/heartbeat`

```json
{"device_id":"dev_xxx"}
```

يجب إرساله كل 60 ثانية.

### 4.3 إرسال evidence

`POST /devices/evidence`

```json
{
  "device_id": "dev_xxx",
  "request_id": "pr_xxx",
  "raw_message": "...",
  "message_hash": "sha256",
  "source_package": "com.bank.app",
  "received_at": "2026-08-26T10:05:00Z"
}
```

## 5. SDK Examples

### Node.js

```javascript
const crypto = require('crypto');

const API_KEY = 'apikey_xxx';
const API_SECRET = 'secret_xxx';
const BASE = 'https://<project-ref>.supabase.co/functions/v1';

function sign(method, path, timestamp, nonce, body = '') {
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}`;
  return crypto.createHmac('sha256', API_SECRET).update(message).digest('hex');
}

async function createRequest(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const body = JSON.stringify(payload);
  const signature = sign('POST', '/payment-requests', timestamp, nonce, body);

  const res = await fetch(`${BASE}/payment-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'x-timestamp': String(timestamp),
      'x-nonce': nonce,
      'x-signature': signature,
    },
    body,
  });
  return res.json();
}
```

### Python

```python
import hmac, hashlib, time, uuid, json, requests

API_KEY = 'apikey_xxx'
API_SECRET = 'secret_xxx'
BASE = 'https://<project-ref>.supabase.co/functions/v1'

def sign(method, path, timestamp, nonce, body=''):
    msg = f"{method}\n{path}\n{timestamp}\n{nonce}\n{body}"
    return hmac.new(API_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()

payload = {"amount":100,"currency":"SAR","provider":"bank_x","external_ref":"order_123"}
timestamp = int(time.time())
nonce = str(uuid.uuid4())
body = json.dumps(payload)
headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    'x-timestamp': str(timestamp),
    'x-nonce': nonce,
    'x-signature': sign('POST', '/payment-requests', timestamp, nonce, body),
}
res = requests.post(f"{BASE}/payment-requests", data=body, headers=headers)
print(res.json())
```

### PHP

```php
<?php
$apiKey = 'apikey_xxx';
$secret = 'secret_xxx';
$base = 'https://<project-ref>.supabase.co/functions/v1';
$payload = json_encode(['amount'=>100,'currency'=>'SAR','provider'=>'bank_x','external_ref'=>'order_123']);
$timestamp = time();
$nonce = bin2hex(random_bytes(16));
$message = "POST\n/payment-requests\n$timestamp\n$nonce\n$payload";
$signature = hash_hmac('sha256', $message, $secret);
$ch = curl_init("$base/payment-requests");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  "Content-Type: application/json",
  "x-api-key: $apiKey",
  "x-timestamp: $timestamp",
  "x-nonce: $nonce",
  "x-signature: $signature"
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
echo $response;
```

### cURL

```bash
#!/bin/bash
API_KEY="apikey_xxx"
API_SECRET="secret_xxx"
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)
BODY='{"amount":100,"currency":"SAR","provider":"bank_x","external_ref":"order_123"}'
SIG=$(printf "POST\n/payment-requests\n$TIMESTAMP\n$NONCE\n$BODY" | openssl dgst -sha256 -hmac "$API_SECRET" | sed 's/^.* //')

curl -X POST "https://<project-ref>.supabase.co/functions/v1/payment-requests" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-timestamp: $TIMESTAMP" \
  -H "x-nonce: $NONCE" \
  -H "x-signature: $SIG" \
  -d "$BODY"
```
