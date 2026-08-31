import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Network from 'expo-network';
import { runSyncEngine } from './syncEngine';
import { readExistingPaymentMessages } from './smsReader';
import { indexSmsMessage } from './localSmsIndex';
import { logEvent } from '@/lib/database';

const BACKGROUND_SYNC_TASK = 'naderpay-background-sync';

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
