import { getSecureItem, setSecureItem, deleteSecureItem } from '@/lib/secureStore';
import {
  saveServerProfile as saveProfileMeta,
  getServerProfiles as getProfileMetas,
  getServerProfileById as getProfileMetaById,
  getActiveServerProfile as getActiveProfileMeta,
  setActiveServerProfile as setActiveProfileMeta,
  deleteServerProfile as deleteProfileMeta,
  updateServerProfileConnectionState,
} from '@/lib/database';
import type { ServerProfile, AuthType, BackendApiContract } from '@/types/backend';

const CRED_PREFIX = 'np_server_cred_';

function credKey(profileId: string, type: string) {
  return `${CRED_PREFIX}${profileId}_${type}`;
}

const DEFAULT_NADERPAY_ANON_TOKEN = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGRobnBkdW9jem5lb3lmenl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MzM2NzksImV4cCI6MjEwMzMwOTY3OX0.uT0Oy_AYcMIQe1VNrWLTnPCSiE141MntZbp3IgFLpxE';

async function loadCredentials(profile: {
  id: string;
  auth_type: string;
  base_url?: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
}): Promise<Partial<Pick<ServerProfile, 'apiKey' | 'token' | 'username' | 'password' | 'customHeaders'>>> {
  const authType = profile.auth_type as AuthType;
  const result: Partial<Pick<ServerProfile, 'apiKey' | 'token' | 'username' | 'password' | 'customHeaders'>> = {};
  if (authType === 'api_key') {
    result.apiKey = (await getSecureItem(credKey(profile.id, 'api_key'))) ?? profile.api_key ?? (profile.base_url?.includes('supabase.co') ? DEFAULT_NADERPAY_ANON_TOKEN : undefined);
  }
  if (authType === 'bearer') {
    result.token = (await getSecureItem(credKey(profile.id, 'bearer'))) ?? profile.token ?? (profile.base_url?.includes('supabase.co') ? DEFAULT_NADERPAY_ANON_TOKEN : undefined);
  }
  if (authType === 'basic') {
    result.username = (await getSecureItem(credKey(profile.id, 'basic_username'))) ?? profile.username ?? undefined;
    result.password = (await getSecureItem(credKey(profile.id, 'basic_password'))) ?? profile.password ?? undefined;
  }
  if (authType === 'custom') {
    result.customHeaders = parseCustomHeaders(profile.custom_headers);
  }
  return result;
}

async function saveCredentials(profile: ServerProfile): Promise<void> {
  if (profile.authType === 'api_key' && profile.apiKey) {
    await setSecureItem(credKey(profile.id, 'api_key'), profile.apiKey);
  }
  if (profile.authType === 'bearer' && profile.token) {
    await setSecureItem(credKey(profile.id, 'bearer'), profile.token);
  }
  if (profile.authType === 'basic') {
    if (profile.username) await setSecureItem(credKey(profile.id, 'basic_username'), profile.username);
    if (profile.password) await setSecureItem(credKey(profile.id, 'basic_password'), profile.password);
  }
}

async function deleteCredentials(profileId: string): Promise<void> {
  const types: AuthType[] = ['api_key', 'bearer', 'basic', 'custom'];
  await Promise.all(
    types.flatMap((t) => {
      const keys = t === 'basic'
        ? [credKey(profileId, 'basic_username'), credKey(profileId, 'basic_password')]
        : [credKey(profileId, t)];
      return keys.map((k) => deleteSecureItem(k));
    })
  );
}

function parseCustomHeaders(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return undefined;
}

function serializeCustomHeaders(headers?: Record<string, string>): string | null {
  if (!headers) return null;
  return JSON.stringify(headers);
}

function parseApiContract(raw: string | null): BackendApiContract | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as BackendApiContract;
  } catch {
    return undefined;
  }
}

/** تصحيح رابط الخادم للتأكد من استخدام backend-proxy كـ Edge Function رئيسية */
export function normalizeBaseUrl(url: string): string {
  let normalized = url.trim().replace(/\/$/, '');
  // إذا المستخدم أدخل function اسمها بالغلط， نصححها تلقائيًا
  normalized = normalized.replace(/\/functions\/v1\/[^/]+$/i, '/functions/v1/backend-proxy');
  return normalized;
}

/** التحقق مما إذا كان الرابط يشير إلى backend-proxy أم لا */
export function validateServerBaseUrl(url: string): { ok: boolean; normalized?: string; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Base URL مطلوب' };
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return { ok: false, error: 'Base URL يجب أن يبدأ بـ http:// أو https://' };
  }
  try {
    new URL(trimmed);
  } catch {
    return { ok: false, error: 'Base URL غير صالح' };
  }
  const normalized = normalizeBaseUrl(trimmed);
  const usesBackendProxy = /\/functions\/v1\/backend-proxy$/i.test(normalized);
  if (!usesBackendProxy) {
    return {
      ok: false,
      error: 'يجب أن ينتهي الرابط بـ /functions/v1/backend-proxy',
      normalized,
    };
  }
  return { ok: true, normalized };
}

async function hydrateProfile(meta: {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
  api_contract: string | null;
  discovery_url: string | null;
  is_active: number;
  is_connected: number;
  last_connected_at: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}): Promise<ServerProfile> {
  const credentials = await loadCredentials(meta);
  return {
    id: meta.id,
    name: meta.name,
    baseUrl: meta.base_url,
    authType: meta.auth_type as AuthType,
    apiKey: credentials.apiKey,
    token: credentials.token,
    username: credentials.username,
    password: credentials.password,
    customHeaders: credentials.customHeaders,
    apiContract: parseApiContract(meta.api_contract),
    discoveryUrl: meta.discovery_url ?? undefined,
    isActive: Boolean(meta.is_active),
    isConnected: Boolean(meta.is_connected),
    lastConnectedAt: meta.last_connected_at ?? undefined,
    lastSyncAt: meta.last_sync_at ?? undefined,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
  };
}

export async function saveServerProfile(profile: ServerProfile): Promise<void> {
  const normalized = normalizeBaseUrl(profile.baseUrl);
  await saveProfileMeta({
    id: profile.id,
    name: profile.name,
    baseUrl: normalized,
    authType: profile.authType,
    apiKey: profile.authType === 'api_key' ? profile.apiKey : null,
    token: profile.token ?? null,
    username: profile.authType === 'basic' ? profile.username : null,
    password: profile.authType === 'basic' ? profile.password : null,
    customHeaders: serializeCustomHeaders(profile.customHeaders),
    apiContract: profile.apiContract,
    discoveryUrl: profile.discoveryUrl,
    isActive: profile.isActive,
    isConnected: profile.isConnected,
    lastConnectedAt: profile.lastConnectedAt,
    lastSyncAt: profile.lastSyncAt,
  });
  await saveCredentials(profile);
}

export async function getServerProfiles(): Promise<ServerProfile[]> {
  const metas = await getProfileMetas();
  return Promise.all(metas.map(hydrateProfile));
}

export async function getServerProfileById(id: string): Promise<ServerProfile | null> {
  const meta = await getProfileMetaById(id);
  if (!meta) return null;
  return hydrateProfile(meta);
}

export async function getActiveServerProfile(): Promise<ServerProfile | null> {
  const meta = await getActiveProfileMeta();
  if (!meta) return null;
  return hydrateProfile(meta);
}

export async function setActiveServerProfile(id: string): Promise<void> {
  await setActiveProfileMeta(id);
}

export async function deleteServerProfile(id: string): Promise<void> {
  await deleteProfileMeta(id);
  await deleteCredentials(id);
}

export async function updateServerProfileStatus(
  id: string,
  status: { isConnected?: boolean; lastConnectedAt?: string; lastSyncAt?: string }
): Promise<void> {
  await updateServerProfileConnectionState(id, status);
}
