import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Bell, MessageSquare, RefreshCw, Server } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { requestSmsPermission } from '@/services/smsReader';
import { requestNotificationPermission } from '@/services/notifications';

export default function PermissionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, runDiagnostics } = useAgent();
  const [checking, setChecking] = useState(false);

  const d = state.diagnostics;

  useFocusEffect(
    useCallback(() => {
      runDiagnostics();
    }, [runDiagnostics])
  );

  const handleRefresh = async () => {
    setChecking(true);
    try {
      await runDiagnostics();
    } finally {
      setChecking(false);
    }
  };

  const handleSmsPermission = async () => {
    const granted = await requestSmsPermission();
    if (!granted) {
      Linking.openSettings();
    }
    await runDiagnostics();
  };

  const handleNotificationPermission = async () => {
    const granted = await requestNotificationPermission();
    if (!granted) {
      Linking.openSettings();
    }
    await runDiagnostics();
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        <View className="flex-row items-center py-6 gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">صلاحيات الوكيل</Text>
        </View>

        <PermissionCard
          icon={MessageSquare}
          title="قراءة SMS"
          description="لقراءة رسائل التحويلات الواردة وتحليلها تلقائيًا."
          granted={d.smsReady}
          onPress={handleSmsPermission}
        />

        <PermissionCard
          icon={Bell}
          title="الإشعارات"
          description="لإرسال تنبيهات عند التطابقات والأخطاء."
          granted={d.notifications}
          onPress={handleNotificationPermission}
        />

        <PermissionCard
          icon={Server}
          title="المزامنة في الخلفية"
          description="للمزامنة الدورية والعمل عند عدم فتح التطبيق."
          granted={d.backgroundAgent}
          onPress={() => Linking.openSettings()}
        />

        <Pressable
          onPress={handleRefresh}
          disabled={checking}
          className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl border border-border active:opacity-70 mb-8"
        >
          <RefreshCw size={18} color="#6b7280" />
          <Text className="text-sm font-medium text-foreground">تحديث الحالة</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PermissionCard({
  icon: Icon,
  title,
  description,
  granted,
  onPress,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  granted: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-5 border border-border rounded-2xl bg-card mb-4 active:opacity-70"
    >
      <Icon size={22} color={granted ? '#22c55e' : '#ef4444'} />
      <View className="flex-1 gap-1">
        <Text className="text-sm font-semibold text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground leading-4">{description}</Text>
      </View>
      <View
        className="px-2.5 py-1 rounded-full"
        style={{ backgroundColor: granted ? '#dcfce7' : '#fee2e2' }}
      >
        <Text className="text-xs font-medium" style={{ color: granted ? '#166534' : '#991b1b' }}>
          {granted ? 'ممنوح' : 'مطلوب'}
        </Text>
      </View>
    </Pressable>
  );
}
