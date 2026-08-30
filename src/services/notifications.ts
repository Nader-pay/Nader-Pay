import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createHash } from '@/lib/hash';
import {
  addInAppNotification,
  getUnreadNotificationCount as getUnreadDbCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/database';

const AGENT_CHANNEL_ID = 'naderpay-agent';

const seenEventIds = new Set<string>();

export async function setupNotifications(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(AGENT_CHANNEL_ID, {
      name: 'Nader Pay Agent',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
      showBadge: true,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return false;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });

  return true;
}

export async function checkNotificationPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getUnreadNotificationCount(): Promise<number> {
  return getUnreadDbCount();
}

export async function markNotificationsAsRead(): Promise<void> {
  await markAllNotificationsRead();
}

export async function markSingleNotificationRead(id: string): Promise<void> {
  await markNotificationRead(id);
}

export function clearNotificationHistory(): void {
  seenEventIds.clear();
}

export async function showAgentNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  eventId?: string
) {
  const normalizedEventId = eventId ?? createHash(`${title}:${body}:${Date.now()}`);
  if (seenEventIds.has(normalizedEventId)) {
    return;
  }
  seenEventIds.add(normalizedEventId);

  if (seenEventIds.size > 500) {
    const first = seenEventIds.values().next().value;
    if (first) seenEventIds.delete(first);
  }

  await persistInAppNotification({
    title,
    body,
    data,
    eventId: normalizedEventId,
  });

  if (process.env.EXPO_OS === 'web') return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
      sound: 'default',
    },
    trigger: null,
  });
}

type NotificationInput = {
  type?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  eventId?: string;
  relatedOrderId?: string;
  relatedProviderId?: string;
  deepLink?: string;
};

export async function persistInAppNotification(input: NotificationInput): Promise<void> {
  const eventId = input.eventId ?? createHash(`${input.title}:${input.body}:${Date.now()}`);
  await addInAppNotification({
    id: createHash(eventId),
    eventId,
    type: input.type ?? 'system',
    title: input.title,
    body: input.body,
    payload: input.data,
    relatedOrderId: input.relatedOrderId,
    relatedProviderId: input.relatedProviderId,
    deepLink: input.deepLink,
  });
}

export { AGENT_CHANNEL_ID };
