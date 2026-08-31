import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, Link, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ClipboardList,
  RefreshCw,
  ChevronLeft,
  Search,
  X,
  ArrowUpDown,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import type { AgentOrderStatus, Order, ProviderName } from '@/types/agent';

type StatusFilter = 'all' | AgentOrderStatus | 'offline';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'scanning', label: 'جاري الفحص' },
  { key: 'confirmed', label: 'مؤكد' },
  { key: 'rejected', label: 'مرفوض' },
  { key: 'duplicate', label: 'مكرر' },
  { key: 'review_required', label: 'مراجعة' },
  { key: 'offline', label: 'Offline / بانتظار' },
];

export default function OrdersScreen() {
  const { state, refreshOrders } = useAgent();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ status?: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [providerFilter, setProviderFilter] = useState<ProviderName | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    if (params.status) {
      const requested = params.status as StatusFilter;
      const valid = STATUS_FILTERS.some((f) => f.key === requested);
      setStatusFilter(valid ? requested : 'all');
    }
  }, [params.status]);

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

  const providers = useMemo<ProviderName[]>(() => {
    const set = new Set<ProviderName>();
    state.pendingOrders.forEach((o) => set.add(o.provider ?? 'unknown'));
    return Array.from(set);
  }, [state.pendingOrders]);

  const filtered = useMemo(() => {
    let list = [...state.pendingOrders];

    if (statusFilter !== 'all') {
      if (statusFilter === 'offline') {
        list = list.filter((o) =>
          ['sync_pending', 'confirmed_local', 'rejected_local', 'syncing'].includes(o.localStatus ?? '')
        );
      } else {
        list = list.filter((o) => o.localStatus === statusFilter);
      }
    }

    if (providerFilter !== 'all') {
      list = list.filter((o) => (o.provider ?? 'unknown') === providerFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.external_reference.toLowerCase().includes(q) ||
          (o.order_id ?? '').toLowerCase().includes(q) ||
          (o.order_reference ?? '').toLowerCase().includes(q) ||
          (o.expected_sender_phone ?? '').toLowerCase().includes(q) ||
          (o.expected_sender_name ?? '').toLowerCase().includes(q) ||
          (o.transaction_id ?? '').toLowerCase().includes(q) ||
          (o.transaction_reference ?? '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return sortDesc ? bTime - aTime : aTime - bTime;
    });

    return list;
  }, [state.pendingOrders, statusFilter, providerFilter, search, sortDesc]);

  const activeCount = state.pendingOrders.filter((o) =>
    ['new', 'scanning', 'matched', 'review_required'].includes(o.localStatus ?? 'new')
  ).length;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-5 pb-6"
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View className="pt-6 pb-3 gap-4">
            <View className="flex-row items-center justify-between">
              <View className="gap-1">
                <Text className="text-2xl font-bold text-foreground">طلبات الشحن</Text>
                <Text className="text-xs text-muted-foreground">
                  {activeCount} طلب نشط • {state.pendingOrders.length} إجمالي
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

            {/* Search */}
            <View className="flex-row items-center gap-2 px-4 py-3 border border-border rounded-2xl bg-card">
              <Search size={18} color="#9ca3af" />
              <TextInput
                className="flex-1 text-sm text-foreground"
                placeholder="بحث بالرقم أو المرجع أو الرقم التعريفي..."
                placeholderTextColor="#9ca3af"
                value={search}
                onChangeText={setSearch}
                accessibilityLabel="بحث"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')}>
                  <X size={18} color="#9ca3af" />
                </Pressable>
              )}
            </View>

            {/* Status filters */}
            <FlatList
              data={STATUS_FILTERS}
              keyExtractor={(item) => item.key}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="gap-2"
              renderItem={({ item }) => {
                const active = statusFilter === item.key;
                return (
                  <Pressable
                    onPress={() => setStatusFilter(item.key)}
                    className={`px-4 py-2 rounded-full border ${
                      active ? 'bg-primary border-primary' : 'bg-card border-border'
                    } active:opacity-70`}
                  >
                    <Text className={`text-xs font-medium ${active ? 'text-primary-foreground' : 'text-foreground'}`}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
            />

            {/* Provider filter & sort */}
            <View className="flex-row items-center justify-between">
              <FlatList
                data={[{ key: 'all', label: 'كل المزودين' }, ...providers.map((p) => ({ key: p, label: providerLabel(p) }))]}
                keyExtractor={(item) => item.key}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-2"
                renderItem={({ item }) => {
                  const active = providerFilter === item.key;
                  return (
                    <Pressable
                      onPress={() => setProviderFilter(item.key as ProviderName | 'all')}
                      className={`px-3 py-1.5 rounded-full border ${
                        active ? 'bg-secondary border-secondary' : 'bg-card border-border'
                      } active:opacity-70`}
                    >
                      <Text className={`text-xs ${active ? 'text-secondary-foreground' : 'text-foreground'}`}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                }}
              />
              <Pressable
                onPress={() => setSortDesc((s) => !s)}
                className="flex-row items-center gap-1 px-3 py-1.5 border border-border rounded-full bg-card active:opacity-70"
              >
                <ArrowUpDown size={14} color="#6b7280" />
                <Text className="text-xs text-foreground">{sortDesc ? 'الأحدث' : 'الأقدم'}</Text>
              </Pressable>
            </View>

            {filtered.length > 0 && (
              <Text className="text-xs text-muted-foreground">
                {filtered.length} نتيجة
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-20 gap-3">
            <ClipboardList size={48} color="#9ca3af" />
            <Text className="text-base font-medium text-foreground">لا توجد طلبات</Text>
            <Text className="text-xs text-muted-foreground text-center">
              ستظهر هنا طلبات الدفع الجديدة الصادرة من الخادم
            </Text>
          </View>
        }
        renderItem={({ item }) => <OrderCard order={item} />}
      />
    </View>
  );
}

function OrderCard({ order }: { order: Order }) {
  const status = orderStatusMeta(order);

  return (
    <Link href={`/(app)/orders/${order.id}`} asChild>
      <Pressable onPress={() => {}} className="px-4 py-4 border border-border rounded-2xl bg-card gap-3 active:opacity-70 mb-3">
        <View className="flex-row justify-between items-start">
          <View className="flex-1 min-w-0">
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
              {order.external_reference}
            </Text>
            <Text className="text-xs text-muted-foreground mt-1">
              {order.order_reference || order.order_id || order.payment_type || '—'}
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

        {order.provider && order.provider !== 'unknown' && (
          <Text className="text-xs text-muted-foreground">{providerLabel(order.provider)}</Text>
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
    case 'confirmed_local':
      return { label: 'مؤكد محليًا', bgColor: '#dcfce7', textColor: '#166534' };
    case 'rejected':
      return { label: 'مرفوض', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'rejected_local':
      return { label: 'مرفوض محليًا', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'expired':
      return { label: 'منتهي', bgColor: '#f3f4f6', textColor: '#374151' };
    case 'matched':
      return { label: 'مطابق', bgColor: '#fef3c7', textColor: '#92400e' };
    case 'scanning':
      return { label: 'جاري البحث', bgColor: '#dbeafe', textColor: '#1e40af' };
    case 'sync_pending':
    case 'syncing':
      return { label: 'بانتظار المزامنة', bgColor: '#e0e7ff', textColor: '#3730a3' };
    case 'review_required':
      return { label: 'يتطلب مراجعة', bgColor: '#ffedd5', textColor: '#9a3412' };
    case 'error':
      return { label: 'خطأ', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'duplicate':
      return { label: 'مكرر', bgColor: '#f3e8ff', textColor: '#6b21a8' };
    case 'new':
    default:
      return { label: 'جديد', bgColor: '#f3f4f6', textColor: '#374151' };
  }
}

function providerLabel(provider: ProviderName): string {
  const map: Record<ProviderName, string> = {
    vodafone_cash: 'Vodafone Cash',
    orange_cash: 'Orange Cash',
    insta_pay: 'InstaPay',
    bank_transfer: 'تحويل بنكي',
    unknown: 'غير معروف',
  };
  return map[provider] ?? provider;
}
