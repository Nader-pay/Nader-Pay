import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Bell, Check, Trash2 } from 'lucide-react-native';

import { getInAppNotifications, markAllNotificationsRead } from '@/lib/database';
import { markNotificationsAsRead } from '@/services/notifications';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<{
    id: string;
    event_id: string;
    type: string;
    title: string;
    body: string;
    payload: string | null;
    read: number;
    related_order_id: string | null;
    deep_link: string | null;
    created_at: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await getInAppNotifications(200);
    setItems(rows);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      markNotificationsAsRead().catch(() => undefined);
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    await markAllNotificationsRead();
    setRefreshing(false);
  }, [load]);

  const clearAll = async () => {
    await markAllNotificationsRead();
    setItems((prev) => prev.map((i) => ({ ...i, read: 1 })));
  };

  const renderItem = ({
    item,
  }: {
    item: {
      id: string;
      title: string;
      body: string;
      read: number;
      created_at: string;
      related_order_id: string | null;
      deep_link: string | null;
    };
  }) => (
    <Pressable
      onPress={() => {
        if (item.related_order_id) {
          router.push(`/(app)/orders/${item.related_order_id}` as any);
        }
      }}
      className="p-4 border-b border-border gap-2 active:opacity-70"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Bell size={16} color={item.read ? '#6b7280' : '#22c55e'} />
          <Text className={`text-sm font-semibold ${item.read ? 'text-muted-foreground' : 'text-foreground'}`}>
            {item.title}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground">{formatDate(item.created_at)}</Text>
      </View>
      <Text className="text-sm text-foreground leading-5">{item.body}</Text>
      {item.related_order_id ? (
        <Text className="text-xs text-primary">طلب: {item.related_order_id}</Text>
      ) : null}
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <View className="flex-row items-center justify-between px-5 py-6">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">مركز الإشعارات</Text>
        </View>
        <Pressable onPress={clearAll} className="flex-row items-center gap-1 px-3 py-2 border border-border rounded-full active:opacity-70">
          <Check size={16} color="#6b7280" />
          <Text className="text-xs text-muted-foreground">تحديد الكل مقروء</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-12" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View className="items-center mt-20 gap-3">
              <Trash2 size={40} color="#d1d5db" />
              <Text className="text-sm text-muted-foreground">لا توجد إشعارات</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
