/* eslint-disable no-undef */
import { PermissionsAndroid } from 'react-native';
import type { SmsMessage } from '@/types/agent';
import { detectProvider } from './providers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const require: (id: string) => any;

const IS_ANDROID = process.env.EXPO_OS === 'android';

export async function requestSmsPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  // أولاً: جرّب expo-sms-listener
  const listener = await getSmsListenerModule();
  if (listener?.requestSmsPermissionAsync) {
    try {
      const status = await listener.requestSmsPermissionAsync();
      if (status === 'granted') return true;
    } catch {
      // fallback إلى PermissionsAndroid
    }
  }

  // ثانياً: fallback مباشر لـ PermissionsAndroid (Android فقط)
  if (IS_ANDROID) {
    try {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      ]);
      return (
        results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch {
      return false;
    }
  }
  return false;
}

export async function checkSmsPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  // أولاً: expo-sms-listener
  const listener = await getSmsListenerModule();
  if (listener?.checkSmsPermissionAsync) {
    try {
      const status = await listener.checkSmsPermissionAsync();
      if (status === 'granted') return true;
    } catch {
      // fallback
    }
  }

  // ثانياً: PermissionsAndroid.check
  if (IS_ANDROID) {
    try {
      return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    } catch {
      return false;
    }
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
        // فلترة رسائل الدفع المعروفة فقط — للاستخدام في Runtime
        const filtered = parsed.filter((m) => detectProvider(m.body) !== 'unknown');
        resolve(filtered);
      }
    );
  });
}

/**
 * قراءة جميع الرسائل من inbox بدون فلترة — للاستخدام في Source Discovery.
 * لا تفلتر بـ Provider لأن الهدف اكتشاف المصادر وليس معالجة الدفعات.
 */
export async function readAllInboxMessages(maxCount = 500): Promise<SmsMessage[]> {
  if (!IS_ANDROID) return [];
  const SmsAndroid = await getSmsAndroidModule();
  if (!SmsAndroid) return [];

  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify({ box: 'inbox', readState: -1, maxCount }),
      (fail: string) => reject(new Error(fail)),
      (_count: number, messages: string) => {
        resolve(parseSmsList(messages));
      }
    );
  });
}

/**
 * قراءة الرسائل من مصادر محددة. تُستخدم بعد التوثيق لمعالجة الرسائل من مصادر موثقة فقط.
 */
export async function readMessagesFromSources(sourceIds: string[], maxCount = 100): Promise<SmsMessage[]> {
  const all = await readExistingPaymentMessages(maxCount);
  const normalized = sourceIds.map((s) => normalizeSender(s));
  return all.filter((m) => normalized.includes(normalizeSender(m.originatingAddress)));
}

export async function incrementalScan(lastIndexedAt?: string | null): Promise<SmsMessage[]> {
  const messages = await readExistingPaymentMessages(100);
  if (!lastIndexedAt) return messages;
  const lastTs = new Date(lastIndexedAt).getTime();
  return messages.filter((m) => new Date(m.date).getTime() > lastTs);
}

function normalizeSender(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, '');
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
