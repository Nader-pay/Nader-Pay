import * as Device from 'expo-device';
import { createNaderAiClient } from '@/services/naderAiClient';
import type { AgentSettings, DeviceState } from '@/types/agent';

export type RegisterDeviceResult = {
  success: boolean;
  deviceId?: string;
  deviceToken?: string;
  accountId?: string;
  error?: string;
};

export async function getAccountId(sessionAccessToken: string, settings: AgentSettings): Promise<string | null> {
  try {
    const client = createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey);
    const { data, error } = await client
      .from('profiles')
      .select('account_id')
      .eq('id', sessionAccessToken)
      .maybeSingle();

    if (error || !data?.account_id) return null;
    return data.account_id as string;
  } catch {
    return null;
  }
}

export async function fetchProfile(
  client: ReturnType<typeof createNaderAiClient>,
  userId: string
): Promise<{ account_id: string | null }> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('account_id')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data?.account_id) return { account_id: null };
    return { account_id: data.account_id as string };
  } catch {
    return { account_id: null };
  }
}

export async function registerDevice(
  sessionAccessToken: string,
  settings: AgentSettings,
  userId?: string
): Promise<RegisterDeviceResult> {
  try {
    const client = createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey);

    const deviceName = [Device.deviceName, Device.brand, Device.modelName]
      .filter(Boolean)
      .join(' - ')
      || 'NaderPay Agent';

    const { data, error } = await client.functions.invoke('device-api/register-with-auth', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionAccessToken}`,
      },
      body: {
        device_name: deviceName,
        platform: 'android',
        app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? '2.0.0',
        android_version: String(Device.osVersion ?? ''),
        installation_id: Device.osBuildFingerprint ?? null,
      },
    });

    if (error) {
      return {
        success: false,
        error: typeof error === 'string' ? error : error.message || 'فشل تسجيل الجهاز',
      };
    }

    if (!data?.device_id || !data?.device_token) {
      return { success: false, error: 'استجابة غير مكتملة من الخادم' };
    }

    let accountId: string | null = null;
    if (userId) {
      const profile = await fetchProfile(client, userId);
      accountId = profile.account_id;
    }

    return {
      success: true,
      deviceId: data.device_id,
      deviceToken: data.device_token,
      accountId: accountId ?? undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
    };
  }
}

export async function sendHeartbeat(
  deviceState: DeviceState,
  listenerStatus: 'running' | 'stopped' | 'error',
  queueSize: number,
  settings: AgentSettings
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const client = createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey);
    const { error } = await client.functions.invoke(`device-api/${deviceState.deviceId}/heartbeat`, {
      method: 'POST',
      headers: {
        'x-device-token': deviceState.deviceToken,
      },
      body: {
        app_version: process.env.EXPO_PUBLIC_APP_VERSION ?? '2.0.0',
        android_version: String(Device.osVersion ?? ''),
        listener_status: listenerStatus,
        sync_queue_size: queueSize,
      },
    });

    if (error) {
      return {
        ok: false,
        error: typeof error === 'string' ? error : error.message || 'فشل نبضة الجهاز',
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
    };
  }
}

export async function sendEvidenceEvent(
  deviceState: DeviceState,
  event: {
    eventId: string;
    provider: string;
    transactionId: string;
    amount: number;
    currency: string;
    senderPhone: string | null;
    senderName: string | null;
    recipientWallet: string | null;
    occurredAt: string;
    rawMessage: string;
    normalizedMessage: string;
    messageHash: string;
  },
  settings: AgentSettings
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const client = createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey);
    const { error } = await client.functions.invoke(`device-api/${deviceState.deviceId}/events`, {
      method: 'POST',
      headers: {
        'x-device-token': deviceState.deviceToken,
      },
      body: {
        event_type: 'payment_evidence_detected',
        event_id: event.eventId,
        provider: event.provider,
        transaction_id: event.transactionId,
        amount: event.amount,
        currency: event.currency,
        sender_phone: event.senderPhone,
        sender_name: event.senderName,
        recipient_wallet: event.recipientWallet,
        occurred_at: event.occurredAt,
        raw_message: event.rawMessage,
        normalized_message: event.normalizedMessage,
        message_hash: event.messageHash,
        source_package: 'expo-sms-listener',
      },
    });

    if (error) {
      return {
        ok: false,
        error: typeof error === 'string' ? error : error.message || 'فشل إرسال الدليل',
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
    };
  }
}

export async function sendRejectEvent(
  deviceState: DeviceState,
  paymentRequestId: string,
  reason: string,
  settings: AgentSettings
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const client = createNaderAiClient(settings.supabaseUrl, settings.supabaseAnonKey);
    const { error } = await client.functions.invoke(`device-api/${deviceState.deviceId}/events`, {
      method: 'POST',
      headers: {
        'x-device-token': deviceState.deviceToken,
      },
      body: {
        event_type: 'payment_rejected',
        event_id: `${paymentRequestId}-reject-${Date.now()}`,
        payment_request_id: paymentRequestId,
        rejection_reason: reason,
      },
    });

    if (error) {
      return {
        ok: false,
        error: typeof error === 'string' ? error : error.message || 'فشل إرسال الرفض',
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
    };
  }
}

