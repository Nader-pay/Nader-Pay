import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight, Check, RefreshCw, X, MessageSquare, FileText,
  AlertCircle, History, ShieldAlert, Shield, CheckCircle2, XCircle,
  Loader, Clock, ShieldCheck, ShieldX, Eye,
} from 'lucide-react-native';

import { useAgent } from '@/contexts/AgentContext';
import { getOrderById, getVerificationLogs, getOrderTimeline, getAuditTrail } from '@/lib/database';
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
    sender_phone: string | null;
    receiver_phone: string | null;
    transaction_id: string | null;
    transaction_reference: string | null;
    message_received_at: string | null;
    status: string;
    expires_at: string | null;
    created_at: string;
    local_status: string | null;
    raw_sms: string | null;
    match_score: number | null;
    matched_transaction: string | null;
  } | null>(null);

  const [verified, setVerified] = useState<{
    amount: number | null;
    currency: string | null;
    senderPhone: string | null;
    receiverPhone: string | null;
    transactionId: string | null;
    transactionReference: string | null;
    rawMessage: string | null;
    sourceVerified: boolean;
    duplicate: boolean;
  } | null>(null);

  const [logs, setLogs] = useState<{ action: string; result: string | null; reason: string | null; created_at: string }[]>([]);
  const [timeline, setTimeline] = useState<{ stage: string; status: string; reason: string | null; created_at: string }[]>([]);
  const [auditTrail, setAuditTrail] = useState<{
    id: string; verification_code: string; match_score: number | null;
    final_action: string; reason: string | null; created_at: string;
  }[]>([]);
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
        sender_phone: null,
        receiver_phone: null,
        transaction_id: null,
        transaction_reference: null,
        message_received_at: null,
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
        local_status: row.local_status,
        raw_sms: row.raw_sms,
        match_score: row.match_score,
        matched_transaction: row.matched_transaction,
      });

      let parsed: Record<string, unknown> | null = null;
      if (row.matched_transaction) {
        try {
          parsed = JSON.parse(row.matched_transaction);
        } catch {
          parsed = null;
        }
      }
      setVerified(parsed ? {
        amount: typeof parsed.amount === 'number' ? parsed.amount : null,
        currency: typeof parsed.currency === 'string' ? parsed.currency : null,
        senderPhone: typeof parsed.senderPhone === 'string' ? parsed.senderPhone : null,
        receiverPhone: typeof parsed.receiverPhone === 'string' ? parsed.receiverPhone : null,
        transactionId: typeof parsed.transactionId === 'string' ? parsed.transactionId : null,
        transactionReference: typeof parsed.transactionReference === 'string' ? parsed.transactionReference : null,
        rawMessage: typeof parsed.rawMessage === 'string' ? parsed.rawMessage : null,
        sourceVerified: Boolean(parsed.sourceVerified),
        duplicate: Boolean(parsed.duplicate),
      } : null);
      const [logRows, timelineRows, auditRows] = await Promise.all([
        getVerificationLogs(id),
        getOrderTimeline(id),
        getAuditTrail(id, 20),
      ]);
      setLogs(logRows.map((l) => ({ action: l.action, result: l.result, reason: l.reason, created_at: l.created_at })));
      setTimeline(timelineRows.map((t) => ({ stage: t.stage, status: t.status, reason: t.reason, created_at: t.created_at })));
      setAuditTrail(auditRows);
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

  // حالة التحقق من المرحلة الثانية
  const verificationCode = (order as any)?.verification_code as string | undefined;
  const verificationScore = (order as any)?.verification_score as number | undefined;

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

            {/* ── شريط حالة التحقق — المرحلة الثانية ── */}
            <VerificationStatusBar
              localStatus={order.local_status}
              verificationCode={verificationCode}
              matchScore={verificationScore ?? order.match_score ?? undefined}
            />

            {/* ── بيانات الطلب الأساسية ── */}
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
                {verificationCode && (
                  <InfoRow label="كود التحقق" value={verificationCodeLabel(verificationCode)} />
                )}
                {(verificationScore ?? order.match_score) != null && (
                  <InfoRow label="درجة المطابقة" value={`${Math.round((verificationScore ?? order.match_score ?? 0) * 10) / 10} / 100`} />
                )}
              </View>
            </View>

            {/* ── الرسالة المطابقة ── */}
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

            {/* ── فحوصات التحقق ── */}
            {verified && (
              <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                <View className="flex-row items-center gap-2">
                  <Shield size={18} color="#6b7280" />
                  <Text className="text-sm font-semibold text-foreground">فحوصات التحقق</Text>
                </View>
                <CheckRow label="المبلغ" ok={order.amount === verified.amount} expected={String(order.amount)} actual={String(verified.amount) ?? '—'} />
                <CheckRow label="العملة" ok={order.currency === verified.currency} expected={order.currency} actual={verified.currency ?? '—'} />
                <CheckRow label="المرسل" ok={checkPhoneMatch(order.expected_sender_phone, verified.senderPhone)} expected={order.expected_sender_phone || '—'} actual={verified.senderPhone || '—'} />
                <CheckRow label="المستلم" ok={checkPhoneMatch(order.expected_recipient_wallet, verified.receiverPhone)} expected={order.expected_recipient_wallet || '—'} actual={verified.receiverPhone || '—'} />
                <CheckRow label="رقم العملية" ok={Boolean(verified.transactionId)} expected={order.transaction_id || order.transaction_reference || '—'} actual={verified.transactionId || verified.transactionReference || '—'} />
                <CheckRow label="مصدر الرسالة" ok={verified.sourceVerified} expected="موثوق" actual={verified.sourceVerified ? 'موثوق' : 'غير موثوق'} />
                <CheckRow label="التكرار" ok={!verified.duplicate} expected="غير مكرر" actual={verified.duplicate ? 'مكرر' : 'غير مكرر'} />
                <Text className="text-xs text-muted-foreground mt-1">
                  وقت استلام الرسالة: {order.message_received_at ? formatDate(order.message_received_at) : '—'}
                </Text>
              </View>
            )}

            {/* ── مراجعة يدوية ── */}
            {order.local_status === 'review_required' && (
              <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                <View className="flex-row items-center gap-2">
                  <ShieldAlert size={18} color="#f59e0b" />
                  <Text className="text-sm font-semibold text-foreground">مراجعة يدوية</Text>
                </View>
                <Text className="text-sm text-muted-foreground leading-5">
                  هذا الطلب يتطلب مراجعة يدوية. تأكد من استلام المبلغ قبل الموافقة.
                </Text>
                {verificationCode && (
                  <View className="px-3 py-2 rounded-xl" style={{ backgroundColor: '#fff7ed' }}>
                    <Text className="text-xs font-medium" style={{ color: '#9a3412' }}>
                      سبب الإحالة: {verificationCodeLabel(verificationCode)}
                    </Text>
                  </View>
                )}
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

            {/* ── سجل Audit Trail (المرحلة الثانية) ── */}
            {auditTrail.length > 0 && (
              <View className="px-4 py-5 border border-border rounded-2xl bg-card gap-3">
                <View className="flex-row items-center gap-2">
                  <Eye size={18} color="#6b7280" />
                  <Text className="text-sm font-semibold text-foreground">سجل محرك التحقق</Text>
                </View>
                <View className="gap-3">
                  {auditTrail.map((entry) => (
                    <View key={entry.id} className="flex-row justify-between gap-3 pb-3 border-b border-border last:border-b-0">
                      <View className="flex-1 gap-0.5">
                        <View className="flex-row items-center gap-1.5">
                          {entry.final_action === 'confirmed'
                            ? <ShieldCheck size={13} color="#22c55e" />
                            : entry.final_action === 'duplicate'
                              ? <ShieldX size={13} color="#a855f7" />
                              : entry.final_action === 'review_required'
                                ? <ShieldAlert size={13} color="#f59e0b" />
                                : <ShieldX size={13} color="#ef4444" />}
                          <Text className="text-sm text-foreground">{auditActionLabel(entry.final_action)}</Text>
                        </View>
                        <Text className="text-xs text-muted-foreground">{verificationCodeLabel(entry.verification_code)}</Text>
                        {entry.match_score != null && (
                          <Text className="text-xs text-muted-foreground">نقاط: {Math.round(entry.match_score)}</Text>
                        )}
                        {entry.reason && (
                          <Text className="text-xs text-muted-foreground" numberOfLines={2}>{entry.reason}</Text>
                        )}
                      </View>
                      <Text className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── سجل التحقق التقليدي ── */}
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

            {/* ── الخط الزمني ── */}
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
                        <View className="w-3 h-3 rounded-full" style={{ backgroundColor: stageColor(t.status) }} />
                        {idx < timeline.length - 1 && <View className="w-px flex-1 bg-border" />}
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

            {/* ── أزرار الإجراءات ── */}
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

function checkPhoneMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = a.replace(/\D/g, '');
  const nb = b.replace(/\D/g, '');
  if (!na || !nb) return false;
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

function CheckRow({
  label,
  ok,
  expected,
  actual,
}: {
  label: string;
  ok: boolean;
  expected: string;
  actual: string;
}) {
  return (
    <View className="flex-row items-center justify-between py-1 border-b border-border last:border-b-0">
      <View className="flex-row items-center gap-2">
        {ok ? <CheckCircle2 size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}
        <Text className="text-sm text-foreground">{label}</Text>
      </View>
      <View className="flex-1 items-end">
        <Text className="text-xs text-muted-foreground">متوقع: {expected}</Text>
        <Text className={`text-xs font-medium ${ok ? 'text-green-600' : 'text-destructive'}`}>فعلي: {actual}</Text>
      </View>
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
      return { label: 'تم اكتشاف معاملة', bgColor: '#fef3c7', textColor: '#92400e' };
    case 'review_required':
      return { label: 'بحاجة إلى مراجعة', bgColor: '#ffedd5', textColor: '#9a3412' };
    case 'scanning':
      return { label: 'جاري التحقق', bgColor: '#dbeafe', textColor: '#1e40af' };
    case 'sync_pending':
      return { label: 'بانتظار المزامنة', bgColor: '#e0e7ff', textColor: '#3730a3' };
    case 'error':
      return { label: 'تم رفض التحقق', bgColor: '#fee2e2', textColor: '#991b1b' };
    case 'duplicate':
      return { label: 'مكرر', bgColor: '#f3e8ff', textColor: '#6b21a8' };
    case 'new':
    default:
      return { label: 'جديد', bgColor: '#f3f4f6', textColor: '#374151' };
  }
}

// مكوّن شريط حالة التحقق — المرحلة الثانية
function VerificationStatusBar({
  localStatus,
  verificationCode,
  matchScore,
}: {
  localStatus: string | null;
  verificationCode?: string;
  matchScore?: number;
}) {
  const steps: { key: string; label: string }[] = [
    { key: 'scanning',         label: 'جاري التحقق' },
    { key: 'matched',          label: 'تم اكتشاف معاملة' },
    { key: 'confirmed_local',  label: 'تم التحقق' },
    { key: 'confirmed',        label: 'تم التأكيد' },
  ];

  const specialStates: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
    review_required: { label: 'بحاجة إلى مراجعة', icon: <ShieldAlert size={14} color="#9a3412" />, bg: '#ffedd5', text: '#9a3412' },
    rejected:        { label: 'تم رفض التحقق',    icon: <ShieldX    size={14} color="#991b1b" />, bg: '#fee2e2', text: '#991b1b' },
    rejected_local:  { label: 'تم الرفض محليًا',  icon: <ShieldX    size={14} color="#991b1b" />, bg: '#fee2e2', text: '#991b1b' },
    error:           { label: 'تم رفض التحقق',    icon: <ShieldX    size={14} color="#991b1b" />, bg: '#fee2e2', text: '#991b1b' },
    duplicate:       { label: 'معاملة مكررة',      icon: <ShieldX    size={14} color="#6b21a8" />, bg: '#f3e8ff', text: '#6b21a8' },
  };

  if (localStatus && specialStates[localStatus]) {
    const s = specialStates[localStatus];
    return (
      <View className="px-4 py-4 rounded-2xl border border-border" style={{ backgroundColor: s.bg }}>
        <View className="flex-row items-center gap-2">
          {s.icon}
          <Text className="text-sm font-semibold" style={{ color: s.text }}>{s.label}</Text>
        </View>
        {verificationCode && (
          <Text className="text-xs mt-1" style={{ color: s.text }}>{verificationCodeLabel(verificationCode)}</Text>
        )}
      </View>
    );
  }

  const stepIndex = steps.findIndex((s) => s.key === localStatus);
  const activeIndex = stepIndex >= 0 ? stepIndex : 0;

  return (
    <View className="px-4 py-4 border border-border rounded-2xl bg-card">
      <Text className="text-xs text-muted-foreground mb-3">مسار التحقق</Text>
      <View className="flex-row items-center">
        {steps.map((step, idx) => (
          <View key={step.key} className="flex-row items-center flex-1">
            <View className="items-center gap-1 flex-1">
              <View
                className="w-6 h-6 rounded-full items-center justify-center"
                style={{
                  backgroundColor: idx < activeIndex ? '#22c55e'
                    : idx === activeIndex ? '#3b82f6'
                    : '#e5e7eb',
                }}
              >
                {idx < activeIndex
                  ? <Check size={12} color="#fff" />
                  : idx === activeIndex
                    ? <Loader size={12} color="#fff" />
                    : <Clock size={12} color="#9ca3af" />}
              </View>
              <Text className="text-xs text-center" style={{ color: idx <= activeIndex ? '#111827' : '#9ca3af' }} numberOfLines={2}>
                {step.label}
              </Text>
            </View>
            {idx < steps.length - 1 && (
              <View className="h-px flex-1 mx-1 mb-4" style={{ backgroundColor: idx < activeIndex ? '#22c55e' : '#e5e7eb' }} />
            )}
          </View>
        ))}
      </View>
      {matchScore != null && (
        <Text className="text-xs text-muted-foreground mt-2 text-center">
          درجة المطابقة: {Math.round(matchScore)} / 100
        </Text>
      )}
    </View>
  );
}

function verificationCodeLabel(code: string): string {
  const map: Record<string, string> = {
    EXACT_MATCH:             'تطابق دقيق',
    PARTIAL_MATCH:           'تطابق جزئي',
    AMOUNT_MISMATCH:         'المبلغ غير متطابق',
    ACCOUNT_MISMATCH:        'الحساب غير متطابق',
    SENDER_MISMATCH:         'المرسل غير متطابق',
    PROVIDER_MISMATCH:       'المزود غير متطابق',
    SOURCE_NOT_TRUSTED:      'المصدر غير موثوق',
    TRANSACTION_TOO_OLD:     'المعاملة قديمة جداً',
    TRANSACTION_IN_FUTURE:   'المعاملة في المستقبل',
    DUPLICATE_TRANSACTION:   'معاملة مكررة',
    ALREADY_USED:            'تم استخدام المعاملة',
    INVALID_PAYMENT_MESSAGE: 'رسالة دفع غير صالحة',
    UNSUPPORTED_MESSAGE:     'رسالة غير مدعومة',
    INSUFFICIENT_EVIDENCE:   'أدلة غير كافية',
    NO_MATCH:                'لا يوجد تطابق',
  };
  return map[code] ?? code;
}

function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    confirmed:        'تم التأكيد',
    rejected:         'تم الرفض',
    review_required:  'أُحيل للمراجعة',
    duplicate:        'مكرر',
    ignored:          'تم التجاهل',
  };
  return map[action] ?? action;
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
