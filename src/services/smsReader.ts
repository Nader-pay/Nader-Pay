/* eslint-disable no-undef */
import type { SmsMessage } from '@/types/agent';
import { detectProvider } from './providers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const require: (id: string) => any;

const IS_ANDROID = process.env.EXPO_OS === 'android';

export async function requestSmsPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  // expo-sms-listener يتولى طلب الأذونات عبر plugin
  const listener = await getSmsListenerModule();
  if (listener?.requestSmsPermissionAsync) {
    const status = await listener.requestSmsPermissionAsync();
    return status === 'granted';
  }
  return false;
}

export async function checkSmsPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  const listener = await getSmsListenerModule();
  if (listener?.checkSmsPermissionAsync) {
    const status = await listener.checkSmsPermissionAsync();
    return status === 'granted';
  }
  return false;
}

export async function readExistingVodafoneCashMessages(): Promise<SmsMessage[]> {
  return readExistingPaymentMessages();
}

export async function readExistingPaymentMessages(maxCount = 100): Promise<SmsMessage[]> {
  if (!IS_ANDROID) return [];

  const SmsAndroid = await getSmsAndroidModule();
  if (!SmsAndroid) return [];

  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({
        box: 'inbox',
        readState: -1,
        maxCount,
      }),
      (fail: string) => {
        reject(new Error(fail));
      },
      (count: number, messages: string) => {
        const parsed = parseSmsList(messages);
        const filtered = parsed.filter((m) => detectProvider(m.body) !== 'unknown');
        resolve(filtered);
      }
    );
  });
}

export async function incrementalScan(lastIndexedAt?: string | null): Promise<SmsMessage[]> {
  const messages = await readExistingPaymentMessages(100);
  if (!lastIndexedAt) return messages;
  const lastTs = new Date(lastIndexedAt).getTime();
  return messages.filter((m) => new Date(m.date).getTime() > lastTs);
}

async function getSmsAndroidModule(): Promise<{
  list: (
    filter: string,
    fail: (error: string) => void,
    success: (count: number, messages: string) => void
  ) => void;
} | null> {
  try {
    return require('react-native-get-sms-android');
  } catch {
    return null;
  }
}

async function getSmsListenerModule(): Promise<{
  requestSmsPermissionAsync: () => Promise<string>;
  checkSmsPermissionAsync: () => Promise<string>;
} | null> {
  try {
    return require('expo-sms-listener');
  } catch {
    return null;
  }
}

function parseSmsList(json: string): SmsMessage[] {
  try {
    const messages = JSON.parse(json);
    if (!Array.isArray(messages)) return [];
    return messages.map((m) => ({
      id: String(m._id ?? m.id ?? Math.random().toString(36).slice(2)),
      originatingAddress: String(m.address ?? m.originatingAddress ?? ''),
      body: String(m.body ?? ''),
      date: new Date(Number(m.date ?? Date.now())).toISOString(),
      readState: Number(m.read ?? 1),
      threadId: Number(m.thread_id ?? m.threadId ?? 0),
      protocol: String(m.protocol ?? ''),
    }));
  } catch {
    return [];
  }
}
