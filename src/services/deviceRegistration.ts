import * as Device from 'expo-device';
import { getActiveServerProfile } from '@/services/serverProfileManager';
import {
  registerDeviceWithBackend,
  sendHeartbeat as sendHeartbeatBackend,
  postOrderAction,
} from '@/services/backendConnector';
import { loadDeviceState } from '@/services/agentSettings';
import { logEvent } from '@/lib/database';
import type { DeviceState } from '@/types/agent';

export type RegisterDeviceResult = {
  success: boolean;
  deviceId?: string;
  deviceToken?: string;
  error?: string;
  /** هل الجهاز كان مسجلاً مسبقاً (idempotent re-register) */
  alreadyRegistered?: boolean;
};

export async function registerDevice(): Promise<RegisterDeviceResult> {
  // 1. تحقق idempotent — إذا كان الجهاز مسجلاً مسبقاً لا نُعيد التسجيل
  try {
    const existingState = await loadDeviceState();
    if (existingState.deviceId && existingState.deviceToken) {
      await logEvent('device_register_skip', 'الجهاز مسجل مسبقاً — تم تخطي إعادة التسجيل', {
        deviceId: existingState.deviceId,
      });
      return {
        success: true,
        deviceId: existingState.deviceId,
        deviceToken: existingState.deviceToken,
        alreadyRegistered: true,
      };
    }
  } catch (err) {
    // خطأ في قراءة الحالة المحلية لا يمنع التسجيل
    await logEvent('device_register_state_read_warn', err instanceof Error ? err.message : 'unknown');
  }

  // 2. تحقق من وجود خادم نشط
  const profile = await getActiveServerProfile();
  if (!profile) {
    return { success: false, error: 'لم يتم تكوين خادم نشط' };
  }
  await logEvent('device_register_start', 'بدء تسجيل الجهاز', { profileId: profile.id });

  // 3. نحضر user JWT من جلسة Supabase — device-api/register-with-auth يتطلبه
  let userJwt: string | null = null;
  try {
    const { supabase } = await import('@/client/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    userJwt = session?.access_token ?? null;
    await logEvent('device_register_jwt', userJwt ? 'JWT موجود' : 'لا يوجد JWT - سيتم التسجيل كـ anon');
  } catch (err) {
    await logEvent('device_register_jwt_warn', err instanceof Error ? err.message : 'فشل جلب الجلسة');
  }

  const deviceName = [Device.deviceName, Device.brand, Device.modelName]
    .filter(Boolean)
    .join(' - ') || 'NaderPay Agent';

  // 4. التسجيل مع Backend
  let backendResult: { ok: boolean; deviceId?: string; deviceToken?: string; error?: string };
  try {
    backendResult = await registerDeviceWithBackend(profile, {
      deviceName,
      platform: 'android',
      appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '2.0.0',
      androidVersion: String(Device.osVersion ?? ''),
      installationId: Device.osBuildFingerprint ?? undefined,
      userJwt: userJwt ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    await logEvent('device_register_backend_error', msg);
    return { success: false, error: msg };
  }

  if (!backendResult.ok) {
    await logEvent('device_register_backend_fail', backendResult.error || 'فشل غير محدد');
    return { success: false, error: backendResult.error || 'فشل تسجيل الجهاز' };
  }

  if (!backendResult.deviceId || !backendResult.deviceToken) {
    await logEvent('device_register_incomplete', 'استجابة Backend ناقصة');
    return { success: false, error: 'استجابة غير مكتملة من الخادم' };
  }

  // 5. Backend نجح — الآن نحفظ في DB المحلية
  // خطأ DB هنا لا يُعتبر فشل backend — نُعيد النجاح مع تسجيل الخطأ المحلي
  try {
    // نحفظ في DB عبر saveDeviceState في AgentContext بعد عودة النتيجة
    await logEvent('device_register_backend_ok', 'تسجيل Backend ناجح', {
      deviceId: backendResult.deviceId,
    });
  } catch (dbErr) {
    // خطأ تسجيل log — لا يؤثر على النتيجة
  }

  return {
    success: true,
    deviceId: backendResult.deviceId,
    deviceToken: backendResult.deviceToken,
    alreadyRegistered: false,
  };
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
