import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Activity, RefreshCw } from 'lucide-react-native';

import { getRecentEvents } from '@/lib/database';

export default function LogsScreen() {
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<{ type: string; message: string; payload: string | null; created_at: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await getRecentEvents(100);
    setEvents(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView
        className="flex-1 px-5"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View className="flex-row items-center justify-between py-6">
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">سجل النشاط</Text>
            <Text className="text-xs text-muted-foreground">آخر 100 حدث</Text>
          </View>
          <Pressable
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            onPress={onRefresh}
          >
            {refreshing ? (
              <ActivityIndicator size="small" className="text-muted-foreground" />
            ) : (
              <RefreshCw size={18} color="#6b7280" />
            )}
          </Pressable>
        </View>

        {events.length === 0 ? (
          <View className="items-center justify-center py-20 gap-3">
            <Activity size={48} color="#9ca3af" />
            <Text className="text-base font-medium text-foreground">لا توجد أحداث</Text>
            <Text className="text-xs text-muted-foreground text-center">سيظهر هنا سجل قراءة SMS والتطابقات والأخطاء</Text>
          </View>
        ) : (
          <View className="gap-3 pb-6">
            {events.map((event, idx) => (
              <View key={idx} className="px-4 py-4 border border-border rounded-2xl bg-card gap-2">
                <View className="flex-row justify-between items-center">
                  <Text className="text-sm font-medium text-foreground">{event.message}</Text>
                  <Text className="text-xs text-muted-foreground">{formatTime(event.created_at)}</Text>
                </View>
                {event.payload && (
                  <Text className="text-xs text-muted-foreground" numberOfLines={3}>
                    {event.payload}
                  </Text>
                )}
                <Text className="text-xs text-muted-foreground">{event.type}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
