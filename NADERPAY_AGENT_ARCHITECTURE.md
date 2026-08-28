# Nader Pay Agent — Architecture

## Purpose

Nader Pay Android is a verification **agent** (not a payment gateway). It is paired with a single Nader AI account, reads Vodafone Cash SMS messages, matches them against shipping payment requests, and reports evidence back to Nader AI.

## High-level flow

```
Nader AI
   │ creates payment_requests (payment_type='wallet')
   │
   ▼ (HTTP polling every 30 s)
Nader Pay Android Agent
   │ reads SMS (expo-sms-listener)
   │ parses Vodafone Cash messages
   │ matches amount / sender / recipient / date window
   │ reports evidence or rejection to Nader AI
   │
   ▼
Local SQLite cache + offline queue + verification logs
```

## Key components

| File | Responsibility |
|------|----------------|
| `src/contexts/AgentContext.tsx` | Central orchestrator: polling, connection state, offline queue, SMS processing, notifications, device registration |
| `src/services/smsParser.ts` | Detects and parses Vodafone Cash SMS with Arabic normalization |
| `src/services/matchingEngine.ts` | Scores candidate orders with 24-hour window, amount/phone/name/wallet rules |
| `src/services/deviceRegistration.ts` | Registers device, sends heartbeats, evidence events, and rejection events |
| `src/services/naderAiClient.ts` | Supabase client factory used for edge functions and DB reads |
| `src/services/notifications.ts` | Local notification channel and scheduling |
| `src/lib/database.ts` | SQLite schema: orders, processed transactions, offline queue, verification logs, agent events |

## Connection state machine

`ONLINE | OFFLINE | CONNECTING | SYNCING | ERROR`

- Network checked via `expo-network`.
- Polling starts only when device is registered, accountId exists, and agent enabled.
- When offline, evidence/reject actions are enqueued in `offline_queue` with exponential retry.

## Order lifecycle

```
new → scanning → matched → confirmed
                → rejected
                → expired
                → sync_pending
                → error
```

## Local SQLite schema

```sql
orders_cache
  id, account_id, external_reference, order_reference, payment_type,
  amount, currency, expected_sender_phone, expected_sender_name, expected_recipient_wallet,
  status, expires_at, created_at, updated_at,
  local_status, match_score, evidence_id, sync_status,
  raw_sms, matched_transaction, verification_payload, cached_at

processed_transactions
  transaction_id, provider, order_id, status, processed_at

offline_queue
  id, order_id, action, payload, attempts, status, created_at

verification_logs
  id, order_id, transaction_id, action, result, reason, payload, created_at

agent_events
  id, type, message, payload, created_at
```

## Edge Functions

- `device-api/register-with-auth` — registers a device with a user JWT
- `device-api/{deviceId}/events` — receives `payment_evidence_detected` and `payment_rejected` events
- `verification-engine` — Nader AI-side verification logic

## Notifications

Uses `expo-notifications` on Android for:
- new orders from Nader AI
- partial match requiring review
- confirmed / rejected payments
- offline/online transitions

## Background execution

- `expo-sms-listener` plugin is declared in `app.json` and runs a background service on Android.
- Battery optimization button opens device settings to improve background reliability.

## Validation

- Build checks:
  - `npm run lint` ✅
  - `npx tsc --noEmit` ✅
  - `npx expo prebuild --platform android --clean` ✅
