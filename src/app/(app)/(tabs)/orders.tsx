import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClipboardList, RefreshCw, ChevronLeft } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import type { Order } from '@/types/agent';

export default function OrdersScreen() {
  const { state, refreshOrders } = useAgent();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshOrders();
    }, [refreshOrders])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshOrders();
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders]);

  const activeOrders = state.pendingOrders.filter(
    (o) => o.localStatus && ['new', 'scanning', 'matched', 'sync_pending'].includes(o.localStatus)
  );

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
            <Text className="text-2xl font-bold text-foreground">طلبات الشحن</Text>
            <Text className="text-xs text-muted-foreground">
              {activeOrders.length} طلب نشط • {state.pendingOrders.length} إجمالي
            </Text>
          </View>
          <Pressable
            className="w-10 h-10 items-center justify-center border border-border rounded-full active:opacity-70"
            onPress={onRefresh}
          >
            {state.isPolling ? (
              <ActivityIndicator size="small" className="text-muted-foreground" />
            ) : (
              <RefreshCw size={18} color="#6b7280" />
            )}
          </Pressable>
        </View>

        {state.pendingOrders.length === 0 ? (
          <View className="items-center justify-center py-20 gap-3">
            <ClipboardList size={48} color="#9ca3af" />
            <Text className="text-base font-medium text-foreground">لا توجد طلبات</Text>
            <Text className="text-xs text-muted-foreground text-center">
              ستظهر هنا طلبات الشحن الجديدة الصادرة من Nader AI
            </Text>
          </View>
        ) : (
          <View className="gap-3 pb-6">
            {state.pendingOrders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function OrderCard({ order }: { order: Order }) {
  const status = orderStatusMeta(order);

  return (
    <Link href={`/(app)/orders/${order.id}`} asChild>
      <Pressable onPress={() => {}} className="px-4 py-4 border border-border rounded-2xl bg-card gap-3 active:opacity-70">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 min-w-0">
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
              {order.external_reference}
            </Text>
            <Text className="text-xs text-muted-foreground mt-1">
              {order.order_reference || order.payment_type || '—'}
            </Text>
          </View>
          <View
            className="px-2.5 py-1 rounded-full"
            style={{ backgroundColor: status.bgColor }}
          >
            <Text className="text-xs font-medium" style={{ color: status.textColor }}>
              {status.label}
            </Text>
          </View>
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-foreground">
            {order.amount} {order.currency}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {order.expected_sender_phone || 'لا يوجد رقم مرسل'}
          </Text>
        </View>

        {order.expected_sender_name && (
          <Text className="text-xs text-muted-foreground">{order.expected_sender_name}</Text>
        )}

        <View className="flex-row items-center justify-between pt-2 border-t border-border">
          {order.matchScore !== undefined && order.matchScore !== null ? (
            <Text className="text-xs text-muted-foreground">نقاط التطابق: {order.matchScore}</Text>
          ) : (
            <View />
          )}
          <ChevronLeft size={16} color="#9ca3af" />
        </View>
      </Pressable>
    </Link>
  );
}

function orderStatusMeta(order: Order): {
  label: string;
  bgColor: string;
  textColor: string;
} {
  switch (order.localStatus) {
    case 'confirmed':
      return { label: 'مؤكد', bgColor: '#dcfce7', textColor: '#166534' };
    case 'rejected':
      return { label: 'مرفوض', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'expired':
      return { label: 'منتهي', bgColor: '#f3f4f6', textColor: '#374151' };
    case 'matched':
      return { label: 'مطابق', bgColor: '#fef3c7', textColor: '#92400e' };
    case 'scanning':
      return { label: 'جاري البحث', bgColor: '#dbeafe', textColor: '#1e40af' };
    case 'sync_pending':
      return { label: 'بانتظار المزامنة', bgColor: '#e0e7ff', textColor: '#3730a3' };
    case 'error':
      return { label: 'خطأ', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'new':
    default:
      return { label: 'جديد', bgColor: '#f3f4f6', textColor: '#374151' };
  }
}
