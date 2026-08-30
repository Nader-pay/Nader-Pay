import { createClient, SupabaseClient } from '@supabase/supabase-js';
import 'expo-sqlite/localStorage/install';

const DEFAULT_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const DEFAULT_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

let cachedClient: SupabaseClient | null = null;
let cachedUrl = '';
let cachedKey = '';

export function createNaderAiClient(url: string, anonKey: string): SupabaseClient {
  if (cachedClient && cachedUrl === url && cachedKey === anonKey) {
    return cachedClient;
  }

  cachedClient = createClient(url, anonKey, {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  cachedUrl = url;
  cachedKey = anonKey;
  return cachedClient;
}

export function getDefaultClient(): SupabaseClient {
  return createNaderAiClient(DEFAULT_URL, DEFAULT_KEY);
}

export function resetCachedClient(): void {
  cachedClient = null;
  cachedUrl = '';
  cachedKey = '';
}
