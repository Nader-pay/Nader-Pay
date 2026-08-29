import { Stack } from 'expo-router';

export default function PaymentSourceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" />
      <Stack.Screen name="discover" />
    </Stack>
  );
}
