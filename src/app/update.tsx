import { useEffect } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Download, RefreshCw, AlertTriangle } from 'lucide-react-native';
import * as Linking from 'expo-linking';

import { useVersionCheck } from '@/hooks/useVersionCheck';

export default function UpdateScreen() {
  const router = useRouter();
  const { versionInfo, loading, error, recheck } = useVersionCheck();

  useEffect(() => {
    // منع زر الرجوع من إغلاق شاشة التحديث
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, []);

  const handleUpdate = async () => {
    if (versionInfo?.downloadUrl) {
      const canOpen = await Linking.canOpenURL(versionInfo.downloadUrl);
      if (canOpen) {
        await Linking.openURL(versionInfo.downloadUrl);
      }
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <StatusBar style="dark" backgroundColor="#ffffff" />
        <RefreshCw size={32} className="text-primary animate-spin" />
        <Text className="text-base text-foreground mt-4">جاري التحقق من التحديثات...</Text>
      </View>
    );
  }

  const currentVersion = versionInfo?.currentVersion || '—';
  const latestVersion = versionInfo?.latestVersion || '—';

  return (
    <View className="flex-1 bg-background">
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-6"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="justify-center min-h-full"
      >
        <View className="items-center mb-8">
          <View className="w-20 h-20 rounded-2xl bg-primary/10 items-center justify-center mb-4">
            <Download size={40} className="text-primary" />
          </View>
          <Text className="text-2xl font-bold text-foreground text-center">يتوفر إصدار جديد</Text>
          <Text className="text-sm text-muted-foreground text-center mt-2">
            يجب تحديث التطبيق للمتابعة
          </Text>
        </View>

        <View className="border border-border rounded-2xl bg-card p-5 mb-6 gap-4">
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted-foreground">الإصدار الحالي</Text>
            <Text className="text-sm font-semibold text-foreground">v{currentVersion}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted-foreground">الإصدار الجديد</Text>
            <Text className="text-sm font-semibold text-primary">v{latestVersion}</Text>
          </View>
          {error ? (
            <View className="flex-row items-center gap-2 mt-2">
              <AlertTriangle size={16} className="text-destructive" />
              <Text className="text-sm text-destructive flex-1">{error}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={handleUpdate}
          className="bg-primary py-4 rounded-2xl items-center active:opacity-80 mb-3"
        >
          <Text className="text-primary-foreground font-semibold text-base">تحديث الآن</Text>
        </Pressable>

        <Pressable
          onPress={recheck}
          className="border border-border py-4 rounded-2xl items-center active:opacity-70"
        >
          <Text className="text-foreground font-medium text-sm">إعادة التحقق</Text>
        </Pressable>

        <Text className="text-xs text-muted-foreground text-center mt-6">
          بعد تنزيل الإصدار الجديد وتثبيته، افتح التطبيق مرة أخرى.
        </Text>
      </ScrollView>
    </View>
  );
}
