import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="server-profile" />
      <Stack.Screen name="discovery" />
      <Stack.Screen name="notification-sources" />
    </Stack>
  );
}