import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Battery, Info, CheckCircle } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { openAppSettings } from '@/lib/linking';

export default function BatteryOptimizationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useAgent();
  const [status, setStatus] = useState<string>('unknown');

  useFocusEffect(
    useCallback(() => {
      setStatus(state.diagnostics.batteryOptimization || 'unknown');
    }, [state.diagnostics.batteryOptimization])
  );

  const openBatterySettings = () => {
    openAppSettings();
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        <View className="flex-row items-center py-6 gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">تحسين البطارية</Text>
        </View>

        <View className="px-4 py-5 border border-border rounded-2xl bg-card mb-6 gap-4">
          <View className="flex-row items-center gap-3">
            <Battery size={24} color={status === 'restricted' ? '#ef4444' : '#22c55e'} />
            <Text className="text-base font-semibold text-foreground">
              {status === 'restricted' ? 'التطبيق مقيد' : 'التطبيق غير مقيد'}
            </Text>
          </View>
          <Text className="text-sm text-muted-foreground leading-5">
            {status === 'restricted'
              ? 'تحسين البطارية مفعل لدى Nader Pay. قد يمنع الوكيل من العمل في الخلفية ويؤخر المزامنة.'
              : 'لا يوجد قيود معروفة. يمكن للوكيل المزامنة في الخلفية.'}
          </Text>
        </View>

        <View className="px-4 py-5 border border-border rounded-2xl bg-card mb-6 gap-3">
          <Text className="text-sm font-semibold text-foreground">لماذا يحتاج الوكيل لتجاوز تحسين البطارية؟</Text>
          <View className="flex-row items-start gap-3">
            <CheckCircle size={18} color="#22c55e" />
            <Text className="text-sm text-muted-foreground flex-1 leading-5">
              مراقبة الرسائل الواردة بشكل سريع لتحديد عمليات الدفع.
            </Text>
          </View>
          <View className="flex-row items-start gap-3">
            <CheckCircle size={18} color="#22c55e" />
            <Text className="text-sm text-muted-foreground flex-1 leading-5">
              مزامنة النتائج المحلية مع الخادم عند عودة الاتصال.
            </Text>
          </View>
          <View className="flex-row items-start gap-3">
            <CheckCircle size={18} color="#22c55e" />
            <Text className="text-sm text-muted-foreground flex-1 leading-5">
              استعادة الخدمة بعد إعادة تشغيل الجهاز.
            </Text>
          </View>
        </View>

        <View className="px-4 py-5 border border-border rounded-2xl bg-card mb-6 gap-3">
          <View className="flex-row items-center gap-2">
            <Info size={18} color="#6b7280" />
            <Text className="text-sm font-semibold text-foreground">الخطوات</Text>
          </View>
          <Text className="text-sm text-muted-foreground leading-5">
            1. افتح إعدادات التطبيق{'\n'}
            2. اختر البطارية أو استخدام البطارية{'\n'}
            3. عطّل "تحسين البطارية" أو اختر "غير محسّن"
          </Text>
        </View>

        <Pressable
          onPress={openBatterySettings}
          className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary active:opacity-80 mb-8"
        >
          <Text className="text-sm font-semibold text-primary-foreground">فتح إعدادات التطبيق</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
