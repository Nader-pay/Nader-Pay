# اختبارات محلل المزود (Provider Parser Fixtures)

## 1. بنية كل Fixture

```json
{
  "provider": "bank_x",
  "id": "bank_x_transfer_001",
  "description": "Transfer confirmation exact match",
  "input": {
    "title": "...",
    "text": "...",
    "package": "com.bank_x.app",
    "post_time": "2026-08-26T10:05:00Z"
  },
  "expected_parsed": {
    "amount": 100.00,
    "currency": "SAR",
    "sender_name": "Ahmed",
    "sender_phone": "+966500000001",
    "recipient_account": "SA03...",
    "transaction_id": "TXN123456",
    "transaction_time": "2026-08-26T10:05:00Z"
  },
  "expected_normalized": {
    "amount": 10000,
    "sender_phone": "966500000001",
    "recipient_account_hash": "sha256...",
    "transaction_id": "TXN123456"
  },
  "expected_validation": {
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

## 2. Fixtures لـ Bank X

### 2.1 bank_x_transfer_001 — exact match

- input: رسالة تحويل كاملة.
- expected: كل القيم تطابق.
- confidence: 1.0

### 2.2 bank_x_transfer_002 — amount mismatch

- input: رسالة بمبلغ 200 بدل 100.
- expected_validation: `amount_match: false`, confidence < 0.8.

### 2.3 bank_x_transfer_003 — sender mismatch

- input: رقم مرسل مختلف.
- expected_validation: `sender_phone_match: false`.

### 2.4 bank_x_transfer_004 — name mismatch

- input: اسم المرسل "Khalid" بدل "Ahmed".
- expected_validation: `sender_name_match: false`.

### 2.5 bank_x_transfer_005 — missing name

- input: رسالة لا تحتوي على اسم المرسل.
- expected_validation: `sender_name_match: false`.

### 2.6 bank_x_transfer_006 — duplicate transaction

- input: نفس `transaction_id` مرتين.
- expected_validation: `is_unique: false`, `REJECTED`.

### 2.7 bank_x_transfer_007 — duplicate message

- input: نفس النص مرتين مع transaction_id مختلف.
- expected_validation: `is_unique: false`.

### 2.8 bank_x_transfer_008 — expired request

- input: رسالة بعد `expires_at`.
- expected_validation: `time_valid: false`, `EXPIRED`.

### 2.9 bank_x_transfer_009 — old transaction

- input: وقت المعاملة قبل `created_at`.
- expected_validation: `time_valid: false`.

## 3. Fixtures لـ Wallet Y

### 3.1 wallet_y_cashin_001 — exact match

- input: رسالة إيداع نقدي.
- expected: كل القيم تطابق.

### 3.2 wallet_y_cashin_002 — amount mismatch

- input: مبلغ أعلى.
- expected_validation: `amount_match: false`.

### 3.3 wallet_y_cashin_003 — missing reference

- input: لا تحتوي على رقم مرجع.
- expected_validation: confidence منخفض.

## 4. إرشادات التنقية

- أزل الأرقام الوطنية والبطاقات ورقم الحساب الكامل.
- استبدل الأسماء بأسماء وهمية.
- احتفظ بالتنسيق الأصلي للرسالة.
- لا تنشر fixtures في مستودع public.

## 5. تشغيل الاختبارات

```bash
npm run test:parser
```

يجب أن تمر كل fixtures قبل أي تغيير في parser.
