import * as SecureStore from 'expo-secure-store';

const IS_WEB = process.env.EXPO_OS === 'web';

export async function getSecureItem(key: string): Promise<string | null> {
  if (IS_WEB) {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (IS_WEB) {
    localStorage.setItem(key, value);
    return;
  }
  return SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (IS_WEB) {
    localStorage.removeItem(key);
    return;
  }
  return SecureStore.deleteItemAsync(key);
}
