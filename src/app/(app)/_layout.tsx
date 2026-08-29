import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="server-profile" />
      <Stack.Screen name="payment-source" />
    </Stack>
  );
}