# المراقبة والتنبيهات

## 1. Metrics

### API Metrics

| المقياس | المصدر | الحد الأدنى |
|---------|--------|-------------|
| API latency | Edge Function logs | P95 < 500ms |
| Error rate | Sentry + Function logs | < 1% |
| Rate limit hits | Edge Function logs | < 0.1% |

### Device Metrics

| المقياس | المصدر | الحد الأدنى |
|---------|--------|-------------|
| offline count | devices heartbeat | يعتمد على fleet size |
| event ingestion rate | evidence endpoint | حسب الحجم |
| queue backlog | Android Agent queue | near 0 |
| parser failure rate | parser logs | < 0.5% |

### Payment Metrics

| المقياس | المصدر | الحد الأدنى |
|---------|--------|-------------|
| verification failures | verification engine | حسب سياسة الحساب |
| duplicate rate | deduplication logs | < 1% |
| webhook failure rate | webhook deliveries | < 2% |
| review rate | review queue | < 10% |
| expired rate | payment requests | < 5% |

## 2. Dashboards

- Grafana/Supabase Analytics dashboard للـ API latency/error rate.
- Dashboard داخلي في التطبيق: offline devices, verification failures, webhook failures, queue backlog.
- Sentry dashboard لأخطاء التطبيق والـ Edge Functions.

## 3. Alerts

| التنبيه | الحالة | الإجراء |
|---------|--------|---------|
| unusual duplicate spike | duplicate rate > 5% / 5m | تحقيق فوري؛ قد يشير لهجوم replay. |
| many devices offline | > 30% من الأجهزة offline | فحص الشبكة/الخدمة. |
| webhook failure spike | فشل > 10% خلال 10 دقائق | فحص URL المستقبل. |
| parser failure spike | > 5% فشل | فحص تنسيق رسائل المزود. |
| authentication anomaly | > 20 طلب فاشل/دقيقة | مراجعة API keys وحظر المفتاح إن لزم. |
| queue backlog | > 100 حدث متراكم | توسيع الـ backend أو فحص الجهاز. |
| high latency | P95 > 2s | توسيع Edge Functions أو تحسين استعلامات. |

## 4. Alert Channels

- Email: ops-team@company.com
- Slack: #alerts-payment-evidence
- PagerDuty: للتنبيهات الحرجة (webhook failure spike, auth anomaly).

## 5. Logs

- Edge Functions logs: 7 أيام.
- Audit events: 2 سنة.
- Sentry: 90 يومًا.

## 6. Health Checks

- `GET /health` — alive/latency.
- `GET /health/db` — database connectivity.
- `GET /health/queue` — queue backlog summary.
