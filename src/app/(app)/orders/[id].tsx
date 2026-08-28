import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Check, RefreshCw, X, MessageSquare, FileText, AlertCircle } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getOrderById, getVerificationLogs } from '@/lib/database';
import type { AgentOrderStatus } from '@/types/agent';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, confirmOrder, rejectOrder, rescanOrder, refreshOrders } = useAgent();

  const [order, setOrder] = useState<{
    id: string;
    external_reference: string;
    order_reference: string | null;
    amount: number;
    currency: string;
    expected_sender_phone: string | null;
    expected_sender_name: string | null;
    expected_recipient_wallet: string | null;
    status: string;
    expires_at: string | null;
    created_at: string;
    local_status: string | null;
    raw_sms: string | null;
    match_score: number | null;
  } | null>(null);

  const [logs, setLogs] = useState<{ action: string; result: string | null; reason: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'confirm' | 'reject' | 'rescan' | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const row = await getOrderById(id);
    if (row) {
      setOrder({
        id: row.id,
        external_reference: row.external_reference,
        order_reference: row.order_reference,
        amount: row.amount,
        currency: row.currency,
        expected_sender_phone: row.expected_sender_phone,
        expected_sender_name: row.expected_sender_name,
        expected_recipient_wallet: row.expected_recipient_wallet,
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
        local_status: row.local_status,
        raw_sms: row.raw_sms,
        match_score: row.match_score,
      });
      const logRows = await getVerificationLogs(id);
      setLogs(logRows.map((l) => ({ action: l.action, result: l.result, reason: l.reason, created_at: l.created_at })));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, state.pendingOrders]);

  const handleConfirm = async () => {
    if (!id) return;
    setActionLoading('confirm');
    await confirmOrder(id as string);
    await refreshOrders();
    await load();
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!id) return;
    setActionLoading('reject');
    await rejectOrder(id as string, rejectReason || 'manual_reject');
    await refreshOrders();
    await load();
    setActionLoading(null);
  };

  const handleRescan = async () => {
    if (!id) return;
    setActionLoading('rescan');
    await rescanOrder(id as string);
    await refreshOrders();
    await load();
    setActionLoading(null);
  };

  const status = orderStatusMeta(order?.local_status as AgentOrderStatus);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic">
        <View className="flex-row items-center py-6 gap-3">
          <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
            <ArrowRight size={20} color="#374151" />
          </Pressable>
          <Text className="text-xl font-bold text-foreground">تفاصيل الطلب</Text>
        </View>

        {loading ? (
          <ActivityIndicator className="mt-12" />
        ) : !order ? (
          <View className="items-center py-20 gap-3">
            <AlertCircle size={48} color="#9ca3af" />
            <Text className="text-muted-foreground">الطلب غير موجود</Text>
          </View>
        ) : (
          <View className="gap-5 pb-8">
            <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
              <View className="flex-row justify-between items-start">
                <View>
                  <Text className="text-sm text-muted-foreground">المرجع</Text>
                  <Text className="text-base font-semibold text-foreground">{order.external_reference}</Text>
                </View>
                <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: status.bgColor }}>
                  <Text className="text-xs font-medium" style={{ color: status.textColor }}>
                    {status.label}
                  </Text>
                </View>
              </View>

              <View className="flex-row justify-between items-center">
                <Text className="text-2xl font-bold text-foreground">
                  {order.amount} {order.currency}
                </Text>
                <Text className="text-xs text-muted-foreground">{formatDate(order.created_at)}</Text>
              </View>

              <View className="gap-2 pt-3 border-t border-border">
                <InfoRow label="رقم المرسل" value={order.expected_sender_phone || '—'} />
                <InfoRow label="اسم المرسل" value={order.expected_sender_name || '—'} />
                <InfoRow label="محفظة المستلم" value={order.expected_recipient_wallet || '—'} />
                {order.match_score !== null && order.match_score !== undefined && (
                  <InfoRow label="نقاط التطابق" value={String(order.match_score)} />
                )}
              </View>
            </View>

            {order.raw_sms && (
              <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                <View className="flex-row items-center gap-2">
                  <MessageSquare size={18} color="#6b7280" />
                  <Text className="text-sm font-semibold text-foreground">الرسالة المطابقة</Text>
                </View>
                <Text className="text-sm text-muted-foreground leading-5" selectable>
                  {order.raw_sms}
                </Text>
              </View>
            )}

            <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
              <View className="flex-row items-center gap-2">
                <FileText size={18} color="#6b7280" />
                <Text className="text-sm font-semibold text-foreground">سجل التحقق</Text>
              </View>
              {logs.length === 0 ? (
                <Text className="text-sm text-muted-foreground">لا توجد سجلات بعد</Text>
              ) : (
                <View className="gap-3">
                  {logs.map((log, idx) => (
                    <View key={idx} className="flex-row justify-between gap-3">
                      <View className="flex-1">
                        <Text className="text-sm text-foreground">{actionLabel(log.action)}</Text>
                        {log.reason && (
                          <Text className="text-xs text-muted-foreground mt-0.5">{log.reason}</Text>
                        )}
                      </View>
                      <Text className="text-xs text-muted-foreground">{formatDate(log.created_at)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View className="gap-3">
              {order.local_status === 'matched' && (
                <>
                  <Pressable
                    onPress={handleConfirm}
                    disabled={actionLoading !== null}
                    className="flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70"
                  >
                    {actionLoading === 'confirm' ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Check size={18} color="#ffffff" />
                        <Text className="text-sm font-semibold text-primary-foreground">تأكيد الدفع</Text>
                      </>
                    )}
                  </Pressable>

                  <View className="gap-2">
                    <TextInput
                      value={rejectReason}
                      onChangeText={setRejectReason}
                      placeholder="سبب الرفض (اختياري)"
                      className="px-4 py-3 border border-border rounded-xl text-sm text-foreground"
                      placeholderTextColor="#9ca3af"
                    />
                    <Pressable
                      onPress={handleReject}
                      disabled={actionLoading !== null}
                      className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-destructive active:opacity-70"
                    >
                      {actionLoading === 'reject' ? (
                        <ActivityIndicator size="small" color="#ef4444" />
                      ) : (
                        <>
                          <X size={18} color="#ef4444" />
                          <Text className="text-sm font-semibold text-destructive">رفض الطلب</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </>
              )}

              <Pressable
                onPress={handleRescan}
                disabled={actionLoading !== null}
                className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              >
                {actionLoading === 'rescan' ? (
                  <ActivityIndicator size="small" color="#6b7280" />
                ) : (
                  <>
                    <RefreshCw size={18} color="#6b7280" />
                    <Text className="text-sm font-semibold text-muted-foreground">إعادة المسح</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm text-foreground font-medium" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function orderStatusMeta(status: AgentOrderStatus | undefined) {
  switch (status) {
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

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    match: 'تطابق',
    confirm: 'تأكيد',
    reject: 'رفض',
    rescan: 'إعادة المسح',
    partial_match: 'تطابق جزئي',
    confirm_skipped: 'تم تخطي التأكيد',
    sms_no_match: 'لا يوجد تطابق',
    sync_failed: 'فشل المزامنة',
  };
  return map[action] || action;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
