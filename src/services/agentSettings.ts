import { getSetting, setSetting } from '@/lib/database';
import type { AgentSettings, DeviceState, ProviderConfig } from '@/types/agent';

const DEFAULT_POLLING_MS = 30_000;
const DEFAULT_TOLERANCE = 0.01;
const DEFAULT_SEARCH_WINDOW = 24;
const DEFAULT_MIN_MATCH_SCORE = 70;

function defaultProviderConfig(): ProviderConfig {
  return {
    enabled: false,
    recipientAccount: null,
    sourceRules: [],
    messagePatterns: [],
    parserVersion: '1.0.0',
    validationRules: [
      { field: 'amount', required: true, policy: 'exact' },
      { field: 'sender', required: false, policy: 'fuzzy' },
      { field: 'recipient', required: false, policy: 'fuzzy' },
      { field: 'transaction_id', required: true, policy: 'exact' },
    ],
  };
}

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function parseEnum<T extends string>(v: string | null, allowed: T[], fallback: T): T {
  if (v && allowed.includes(v as T)) return v as T;
  return fallback;
}

export async function loadSettings(): Promise<AgentSettings> {
  const url = await getSetting('supabase_url');
  const key = await getSetting('supabase_anon_key');
  const polling = await getSetting('polling_interval_ms');
  const tolerance = await getSetting('max_amount_tolerance');
  const autoConfirm = await getSetting('auto_confirm');
  const enabled = await getSetting('agent_enabled');
  const searchWindow = await getSetting('max_search_window_hours');
  const autoReject = await getSetting('auto_reject_policy');
  const retryPolicy = await getSetting('retry_policy');
  const retryMax = await getSetting('retry_max_attempts');
  const retryDelay = await getSetting('retry_base_delay_ms');
  const notifications = await getSetting('notifications_enabled');
  const background = await getSetting('background_sync_enabled');
  const requireSource = await getSetting('require_source_verification');
  const minMatchScore = await getSetting('min_match_score');

  return {
    supabaseUrl: url ?? (process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'),
    supabaseAnonKey: key ?? (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder'),
    activeServerProfileId: (await getSetting('active_server_profile_id')) || null,
    pollingIntervalMs: polling ? parseInt(polling, 10) : DEFAULT_POLLING_MS,
    maxAmountTolerance: tolerance ? parseFloat(tolerance) : DEFAULT_TOLERANCE,
    autoConfirm: parseBool(autoConfirm, true),
    enabled: parseBool(enabled, true),
    maxSearchWindowHours: searchWindow ? parseInt(searchWindow, 10) : DEFAULT_SEARCH_WINDOW,
    autoRejectPolicy: parseEnum(autoReject, ['never', 'on_expiry', 'on_mismatch'], 'on_expiry'),
    retryPolicy: parseEnum(retryPolicy, ['none', 'linear', 'exponential'], 'exponential'),
    retryMaxAttempts: retryMax ? parseInt(retryMax, 10) : 5,
    retryBaseDelayMs: retryDelay ? parseInt(retryDelay, 10) : 2000,
    notificationsEnabled: parseBool(notifications, true),
    backgroundSyncEnabled: parseBool(background, true),
    requireSourceVerification: parseBool(requireSource, true),
    minMatchScore: minMatchScore ? parseInt(minMatchScore, 10) : DEFAULT_MIN_MATCH_SCORE,
    providers: {
      vodafone_cash: defaultProviderConfig(),
      orange_cash: defaultProviderConfig(),
      insta_pay: defaultProviderConfig(),
      bank_transfer: defaultProviderConfig(),
      unknown: defaultProviderConfig(),
    },
  };
}

export async function saveSettings(settings: AgentSettings): Promise<void> {
  await Promise.all([
    setSetting('supabase_url', settings.supabaseUrl),
    setSetting('supabase_anon_key', settings.supabaseAnonKey),
    setSetting('active_server_profile_id', settings.activeServerProfileId ?? ''),
    setSetting('polling_interval_ms', String(settings.pollingIntervalMs)),
    setSetting('max_amount_tolerance', String(settings.maxAmountTolerance)),
    setSetting('auto_confirm', String(settings.autoConfirm)),
    setSetting('agent_enabled', String(settings.enabled)),
    setSetting('max_search_window_hours', String(settings.maxSearchWindowHours)),
    setSetting('auto_reject_policy', settings.autoRejectPolicy),
    setSetting('retry_policy', settings.retryPolicy),
    setSetting('retry_max_attempts', String(settings.retryMaxAttempts)),
    setSetting('retry_base_delay_ms', String(settings.retryBaseDelayMs)),
    setSetting('notifications_enabled', String(settings.notificationsEnabled)),
    setSetting('background_sync_enabled', String(settings.backgroundSyncEnabled)),
    setSetting('require_source_verification', String(settings.requireSourceVerification)),
    setSetting('min_match_score', String(settings.minMatchScore)),
  ]);
}

export async function loadDeviceState(): Promise<DeviceState> {
  return {
    deviceId: await getSetting('device_id'),
    deviceName: await getSetting('device_name'),
    deviceToken: await getSetting('device_token'),
    registeredAt: await getSetting('device_registered_at'),
    accountId: await getSetting('device_account_id'),
  };
}

export async function saveDeviceState(state: DeviceState): Promise<void> {
  await Promise.all([
    setSetting('device_id', state.deviceId ?? ''),
    setSetting('device_name', state.deviceName ?? ''),
    setSetting('device_token', state.deviceToken ?? ''),
    setSetting('device_registered_at', state.registeredAt ?? ''),
    setSetting('device_account_id', state.accountId ?? ''),
  ]);
}

export async function clearDeviceState(): Promise<void> {
  await Promise.all([
    setSetting('device_id', ''),
    setSetting('device_name', ''),
    setSetting('device_token', ''),
    setSetting('device_registered_at', ''),
    setSetting('device_account_id', ''),
  ]);
}
