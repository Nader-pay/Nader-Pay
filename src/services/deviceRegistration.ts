import * as Device from 'expo-device';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import {
  registerDeviceWithBackend,
  sendHeartbeat as sendHeartbeatBackend,
  postOrderAction,
} from '@/services/backendConnector';
import type { DeviceState } from '@/types/agent';

export type RegisterDeviceResult = {
  success: boolean;
  deviceId?: string;
  deviceToken?: string;
  error?: string;
};

export async function registerDevice(): Promise<RegisterDeviceResult> {
  const profile = await getActiveServerProfile();
  if (!profile) {
    return { success: false, error: 'لم يتم تكوين خادم نشط' };
  }

  // نحضر user JWT من جلسة Supabase — device-api/register-with-auth يتطلبه
  let userJwt: string | null = null;
  try {
    const { supabase } = await import('@/client/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    userJwt = session?.access_token ?? null;
  } catch { /* نتجاهل أخطاء جلب الجلسة */ }

  const deviceName = [Device.deviceName, Device.brand, Device.modelName]
    .filter(Boolean)
    .join(' - ') || 'NaderPay Agent';

  try {
    const result = await registerDeviceWithBackend(profile, {
      deviceName,
      platform: 'android',
      appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '2.0.0',
      androidVersion: String(Device.osVersion ?? ''),
      installationId: Device.osBuildFingerprint ?? undefined,
      userJwt: userJwt ?? undefined,
    });

    if (!result.ok) {
      return { success: false, error: result.error || 'فشل تسجيل الجهاز' };
    }
    if (!result.deviceId || !result.deviceToken) {
      return { success: false, error: 'استجابة غير مكتملة من الخادم' };
    }

    return {
      success: true,
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
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
  queueSize: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const profile = await getActiveServerProfile();
    if (!profile) {
      return { ok: false, error: 'لم يتم تكوين خادم نشط' };
    }

    return sendHeartbeatBackend(profile, deviceState.deviceId, deviceState.deviceToken, {
      listenerStatus,
      queueSize,
      appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '2.0.0',
      androidVersion: String(Device.osVersion ?? ''),
    });
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
    orderId?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const profile = await getActiveServerProfile();
    if (!profile) {
      return { ok: false, error: 'لم يتم تكوين خادم نشط' };
    }

    const orderId = event.orderId ?? event.transactionId;
    const result = await postOrderAction(profile, 'confirm', orderId, {
      device_id: deviceState.deviceId,
      device_token: deviceState.deviceToken,
      event_id: event.eventId,
      event_type: 'payment_evidence_detected',
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
      idempotency_key: `${event.eventId}-${event.transactionId}`,
    });

    if (!result.ok) {
      return { ok: false, error: result.error || 'فشل إرسال تأكيد الدفع' };
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
  orderId: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!deviceState.deviceId || !deviceState.deviceToken) {
      return { ok: false, error: 'الجهاز غير مسجل' };
    }

    const profile = await getActiveServerProfile();
    if (!profile) {
      return { ok: false, error: 'لم يتم تكوين خادم نشط' };
    }

    const result = await postOrderAction(profile, 'reject', orderId, {
      device_id: deviceState.deviceId,
      device_token: deviceState.deviceToken,
      event_id: `${orderId}-reject-${Date.now()}`,
      event_type: 'payment_rejected',
      payment_request_id: orderId,
      rejection_reason: reason,
      idempotency_key: `${orderId}-reject`,
    });

    if (!result.ok) {
      return { ok: false, error: result.error || 'فشل إرسال الرفض' };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
    };
  }
}
