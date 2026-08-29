import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const AGENT_CHANNEL_ID = 'naderpay-agent';

export async function setupNotifications(): Promise<boolean> {
  if (process.env.EXPO_OS === 'web') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(AGENT_CHANNEL_ID, {
      name: 'Nader Pay Agent',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
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
      shouldSetBadge: false,
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

export async function showAgentNotification(title: string, body: string, data?: Record<string, unknown>) {
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

export { AGENT_CHANNEL_ID };
