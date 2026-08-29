import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Check, RefreshCw, X, MessageSquare, FileText, AlertCircle, History, ShieldAlert } from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getOrderById, getVerificationLogs, getOrderTimeline } from '@/lib/database';
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
    provider: string | null;
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
  const [timeline, setTimeline] = useState<{ stage: string; status: string; reason: string | null; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'confirm' | 'reject' | 'rescan' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const row = await getOrderById(id);
    if (row) {
      setOrder({
        id: row.id,
        external_reference: row.external_reference,
        order_reference: row.order_reference,
        provider: row.provider,
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
      const timelineRows = await getOrderTimeline(id);
      setTimeline(timelineRows.map((t) => ({ stage: t.stage, status: t.status, reason: t.reason, created_at: t.created_at })));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load, state.pendingOrders]);

  const handleConfirm = async () => {
    if (!id) return;
    setActionLoading('confirm');
    await confirmOrder(id as string, 'manual', reviewNote || 'manual_approve');
    await refreshOrders();
    await load();
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!id) return;
    setActionLoading('reject');
    await rejectOrder(id as string, rejectReason || 'manual_reject', 'manual');
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
                <InfoRow label="مزود الدفع" value={order.provider || '—'} />
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

            {order.local_status === 'review_required' && (
              <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                <View className="flex-row items-center gap-2">
                  <ShieldAlert size={18} color="#f59e0b" />
                  <Text className="text-sm font-semibold text-foreground">مراجعة يدوية</Text>
                </View>
                <Text className="text-sm text-muted-foreground leading-5">
                  هذا الطلب يتطلب مراجعة يدوية. تأكد من استلام المبلغ قبل الموافقة.
                </Text>
                <TextInput
                  value={reviewNote}
                  onChangeText={setReviewNote}
                  placeholder="ملاحظة المراجعة (اختياري)"
                  className="px-4 py-3 border border-border rounded-xl text-sm text-foreground"
                  placeholderTextColor="#9ca3af"
                />
                <View className="flex-row gap-3">
                  <Pressable
                    onPress={handleConfirm}
                    disabled={actionLoading !== null}
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70"
                  >
                    {actionLoading === 'confirm' ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Check size={18} color="#ffffff" />
                        <Text className="text-sm font-semibold text-primary-foreground">موافقة</Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={handleReject}
                    disabled={actionLoading !== null}
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border border-destructive active:opacity-70"
                  >
                    {actionLoading === 'reject' ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <>
                        <X size={18} color="#ef4444" />
                        <Text className="text-sm font-semibold text-destructive">رفض</Text>
                      </>
                    )}
                  </Pressable>
                </View>
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

            <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
              <View className="flex-row items-center gap-2">
                <History size={18} color="#6b7280" />
                <Text className="text-sm font-semibold text-foreground">الخط الزمني</Text>
              </View>
              {timeline.length === 0 ? (
                <Text className="text-sm text-muted-foreground">لا يوجد خط زمني بعد</Text>
              ) : (
                <View className="gap-4">
                  {timeline.map((t, idx) => (
                    <View key={idx} className="flex-row gap-3">
                      <View className="items-center gap-1">
                        <View
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: stageColor(t.status) }}
                        />
                        {idx < timeline.length - 1 && (
                          <View className="w-px flex-1 bg-border" />
                        )}
                      </View>
                      <View className="flex-1 pb-2">
                        <Text className="text-sm text-foreground">{stageLabel(t.stage)}</Text>
                        {t.reason && <Text className="text-xs text-muted-foreground mt-0.5">{t.reason}</Text>}
                        <Text className="text-xs text-muted-foreground mt-1">{formatDate(t.created_at)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View className="gap-3">
              {(order.local_status === 'matched' || order.local_status === 'review_required') && (
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
    case 'confirmed_local':
      return { label: status === 'confirmed' ? 'مؤكد' : 'مؤكد محليًا', bgColor: '#dcfce7', textColor: '#166534' };
    case 'rejected':
    case 'rejected_local':
      return { label: status === 'rejected' ? 'مرفوض' : 'مرفوض محليًا', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'expired':
      return { label: 'منتهي', bgColor: '#f3f4f6', textColor: '#374151' };
    case 'matched':
      return { label: 'مطابق', bgColor: '#fef3c7', textColor: '#92400e' };
    case 'review_required':
      return { label: 'يتطلب مراجعة', bgColor: '#ffedd5', textColor: '#9a3412' };
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

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    ORDER_RECEIVED: 'استلام الطلب',
    SMS_INDEXED: 'فهرسة SMS',
    PARSING: 'تحليل الرسالة',
    VALIDATING: 'التحقق من التطابق',
    DUPLICATE_CHECK: 'فحص التكرار',
    VERIFICATION_COMPLETE: 'اكتمال التحقق',
    REVIEW_REQUIRED: 'يتطلب مراجعة',
    MANUAL_REVIEW: 'مراجعة يدوية',
    CONFIRMED_LOCAL: 'تأكيد محلي',
    REJECTED_LOCAL: 'رفض محلي',
    SYNC_PENDING: 'بانتظار المزامنة',
    SYNCED: 'تمت المزامنة',
    SCANNING: 'إعادة المسح',
  };
  return map[stage] || stage;
}

function stageColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#22c55e';
    case 'current':
      return '#3b82f6';
    case 'error':
      return '#ef4444';
    default:
      return '#9ca3af';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
