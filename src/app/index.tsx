import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

export default function LandingScreen() {
  const router = useRouter();

  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <View className="items-center gap-6">
        <View className="items-center gap-3">
          <Text className="text-3xl font-bold text-foreground tracking-tight">Nader Pay Agent</Text>
          <Text className="text-sm text-muted-foreground text-center leading-6">
            وكيل Android للتحقق من تحويلات Vodafone Cash على طلبات الشحن
          </Text>
        </View>

        <Pressable
          className="bg-primary px-8 py-3 rounded-2xl active:opacity-80"
          onPress={() => router.push('/(auth)/sign-in')}
        >
          <Text className="text-primary-foreground font-medium text-sm">تسجيل الدخول</Text>
        </Pressable>
      </View>
    </View>
  );
}
