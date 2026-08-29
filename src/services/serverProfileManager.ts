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

async function loadCredentials(profile: {
  id: string;
  auth_type: string;
  api_key: string | null;
  token: string | null;
  username: string | null;
  password: string | null;
  custom_headers: string | null;
}): Promise<Partial<Pick<ServerProfile, 'apiKey' | 'token' | 'username' | 'password' | 'customHeaders'>>> {
  const authType = profile.auth_type as AuthType;
  const result: Partial<Pick<ServerProfile, 'apiKey' | 'token' | 'username' | 'password' | 'customHeaders'>> = {};
  if (authType === 'api_key') {
    result.apiKey = (await getSecureItem(credKey(profile.id, 'api_key'))) ?? profile.api_key ?? undefined;
  }
  if (authType === 'bearer') {
    result.token = (await getSecureItem(credKey(profile.id, 'bearer'))) ?? profile.token ?? undefined;
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
  await saveProfileMeta({
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    authType: profile.authType,
    apiKey: profile.authType === 'api_key' ? profile.apiKey : null,
    token: profile.authType === 'bearer' ? profile.token : null,
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
