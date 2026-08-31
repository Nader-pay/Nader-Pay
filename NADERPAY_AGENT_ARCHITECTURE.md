# Nader Pay Agent — Architecture (Phase 3)

## Purpose

Nader Pay Android is a **Generic Payment Verification Agent** (not a payment gateway). It connects to any compatible backend using a configurable API contract, reads payment SMS messages from multiple providers (Vodafone Cash, Orange Cash, InstaPay, Bank Transfer), matches them against pending orders, and reports evidence back to the configured backend.

## High-level flow

```
User Backend (any compatible API)
   │ creates/returns payment/shipment orders
   │
   ▼ (auto-discovery → device registration → polling / realtime)
Nader Pay Android Agent
   │ connects using Base URL + API credentials
   │ discovers API contract from /config or OpenAPI
   │ registers device with backend
   │ listens for SMS via expo-sms-listener
   │ indexes all payment SMS into local SQLite DB
   │ parses multi-provider messages
   │ matches amount / sender / recipient / date window
   │ reports evidence or rejection to configured backend
   │
   ▼
Local SQLite cache + offline queue + verification logs + order timeline + server profiles
```

## Key components

| File | Responsibility |
|------|----------------|
| `src/contexts/AgentContext.tsx` | Central orchestrator: Connect → Authenticate → Discover → Register → Sync, polling, connection state, offline queue, SMS processing, notifications, diagnostics |
| `src/services/backendConnector.ts` | Generic HTTP connector for any backend; auth header building, Supabase Edge Function proxy, request metadata |
| `src/services/apiDiscovery.ts` | Discovers API contract from `/.well-known/naderpay-agent`, `/config`, or OpenAPI metadata |
| `src/services/serverProfileManager.ts` | Stores multiple server profiles, activates a profile, saves credentials securely |
| `src/services/orderNormalizer.ts` | Converts any backend order payload to a unified `NormalizedOrder` while preserving raw payload |
| `src/services/syncEngine.ts` | Fetches pending orders from active backend, processes offline queue, idempotent confirm/reject |
| `src/services/deviceRegistration.ts` | Registers device and sends heartbeats/confirm/reject events via backend connector |
| `src/services/providers/` | Provider registry, Vodafone/Orange/InstaPay/BankTransfer parsers and source validators |
| `src/services/smsReader.ts` | Reads SMS inbox, incremental scans, multi-provider filtering |
| `src/services/localSmsIndex.ts` | Stores parsed SMS in a dedicated SQLite index, supports SMS-before-order matching |
| `src/services/matchingEngine.ts` | Scores candidate orders with configurable window, tolerance, source verification penalty |
| `src/services/backgroundAgent.ts` | Registers 15-minute background sync task, boot recovery, network callbacks |
| `src/services/agentSettings.ts` | Loads/saves agent settings including `activeServerProfileId` |
| `src/services/notifications.ts` | Local notification channel and scheduling |
| `src/lib/database.ts` | SQLite schema: orders_cache, processed_transactions, offline_queue, verification_logs, agent_events, order_timelines, server_profiles |
| `supabase/functions/backend-proxy/index.ts` | Edge Function proxy for secure third-party API calls; credentials are not exposed client-side |

## Status state machine

Order statuses: `new → scanning → matched → review_required → confirmed/confirmed_local → syncing → synced`

Manual review can produce `review_required` when the match score is below the configured threshold or the source is unverified. Confirm/reject may go through `confirmed_local`/`rejected_local` while offline, then `syncing`, then `synced`.

## Connection state machine

`ONLINE | OFFLINE | CONNECTING | SYNCING | ERROR`

- Network checked via `expo-network`.
- `SYNCING` is set while `syncEngine` processes the offline queue.
- `ERROR` is set when a network call fails.
- `OFFLINE` queues confirm/reject actions and sets `confirmed_local`/`rejected_local`.

## Diagnostics

The `AgentContext` exposes `state.diagnostics` with real-time values:
- agentRunning
- network (ONLINE/OFFLINE)
- smsReady
- notifications
- backgroundAgent
- deviceRegistered
- databaseReady
- batteryOptimization
- pendingSyncCount
- activeOrders
- lastSmsAt / lastScanAt / lastSyncAt / lastError
- activeServerProfile
- backendStatus (online/offline/error/unknown)
- lastBackendStatus / lastBackendEndpoint / lastBackendMethod / lastBackendRequestId / lastBackendResponse / lastBackendError
- realtimeStatus (connected/polling/unavailable/unknown)

The Diagnostics screen also displays the last HTTP request/response metadata for backend troubleshooting.

## Background agent

- Registered via `expo-background-task` every 15 minutes.
- Runs `syncEngine` + incremental SMS scan.
- Recovery on boot is handled by the OS scheduling the registered task.
- Battery optimization may restrict execution; the app provides a `battery.tsx` screen to guide the user.

## Security & privacy

- SMS is read locally; only parsed evidence is sent to the configured backend.
- Backend credentials are stored in `expo-secure-store` and never logged or shipped in the app binary.
- Third-party backend calls are routed through a Supabase Edge Function proxy so the actual API keys stay server-side.
- Device token is stored in `expo-secure-store`.
- No raw SMS body is logged remotely.
- Service Role Keys / Supabase secrets are not embedded in the application source code.

## Quality gates

- TypeScript: `npx tsc --noEmit` — PASSED
- Lint: `npm run lint` — PASSED
- Android build: Not attempted in this environment (no Android SDK / Gradle).
