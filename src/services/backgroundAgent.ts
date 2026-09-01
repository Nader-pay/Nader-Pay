import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Network from 'expo-network';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { runSyncEngine } from './syncEngine';
import { readExistingPaymentMessages } from './smsReader';
import { indexSmsMessage } from './localSmsIndex';
import { logEvent } from '@/lib/database';

const BACKGROUND_SYNC_TASK = 'naderpay-background-sync';
const FOREGROUND_CHANNEL_ID = 'naderpay-foreground';
const FOREGROUND_NOTIFICATION_ID = 'naderpay-fg-service';

// ─── إعداد قناة إشعار الـ Foreground Service ───────────────────────────────
async function ensureForegroundChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(FOREGROUND_CHANNEL_ID, {
    name: 'وكيل المدفوعات',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    showBadge: false,
    description: 'إشعار دائم يُبقي الوكيل نشطاً في الخلفية',
  });
}

/**
 * تشغيل Foreground Service — يُظهر إشعاراً دائماً يمنع Android من قتل العملية.
 * يجب استدعاؤه بعد حصول التطبيق على إذن POST_NOTIFICATIONS.
 */
export async function startForegroundService(label?: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ensureForegroundChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: FOREGROUND_NOTIFICATION_ID,
      content: {
        title: 'Nader Pay Agent',
        body: label ?? 'الوكيل يعمل في الخلفية ويراقب المدفوعات',
        data: { type: 'foreground_service' },
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      } as Notifications.NotificationContentInput,
      trigger: null, // فوري
    });
  } catch (err) {
    await logEvent('foreground_service_start_error', err instanceof Error ? err.message : 'unknown');
  }
}

/**
 * تحديث نص الإشعار الدائم (مثلاً عند معالجة طلب).
 */
export async function updateForegroundServiceLabel(label: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: FOREGROUND_NOTIFICATION_ID,
      content: {
        title: 'Nader Pay Agent',
        body: label,
        data: { type: 'foreground_service' },
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      } as Notifications.NotificationContentInput,
      trigger: null,
    });
  } catch {
    // تجاهل هادئ — الإشعار القديم يبقى
  }
}

/**
 * إيقاف Foreground Service وإزالة الإشعار الدائم.
 */
export async function stopForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.dismissNotificationAsync(FOREGROUND_NOTIFICATION_ID);
  } catch {
    // ignore
  }
}

// ─── Background Task ────────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const isOnline = await Network.getNetworkStateAsync().then((s) => Boolean(s.isConnected));
    await logEvent('background_task', 'Background sync task started', { online: isOnline });

    if (isOnline) {
      const result = await runSyncEngine();
      await logEvent('background_sync', 'Background sync completed', { result });
    }

    try {
      const messages = await readExistingPaymentMessages();
      for (const m of messages) {
        await indexSmsMessage(m);
      }
      await logEvent('background_scan', `Indexed ${messages.length} SMS messages`);
    } catch (err) {
      await logEvent('background_scan_error', err instanceof Error ? err.message : 'unknown');
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    await logEvent('background_task_error', err instanceof Error ? err.message : 'unknown');
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) return true;
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 60 * 15, // 15 minutes
    });
    return true;
  } catch (err) {
    await logEvent('background_register_error', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  try {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  } catch {
    // ignore
  }
}

export async function getBackgroundTaskStatus(): Promise<{ registered: boolean }> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    return { registered };
  } catch {
    return { registered: false };
  }
}

export async function requestBackgroundSyncPermission(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    return status === BackgroundTask.BackgroundTaskStatus.Available;
  } catch {
    return false;
  }
}
