/**
 * verification-diagnostics.tsx
 * ════════════════════════════════════════════════════════════════
 * شاشة تشخيص محرك التحقق — المرحلة الثانية
 *
 * تعرض:
 *  - إحصائيات شاملة (أدلة، canonical transactions، audit trail)
 *  - صحة Trusted Sources (SMS + Notification)
 *  - آخر 30 إدخال Audit Trail
 *  - آخر 30 canonical transaction
 *  - آخر 30 payment evidence
 * ════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight, RefreshCw, ShieldCheck, ShieldAlert, ShieldX,
  Database, Layers, Activity, Check, X, AlertCircle,
} from 'lucide-react-native';

import {
  getVerificationStats,
  getAuditTrail,
  getRecentCanonicals,
  getRecentEvidences,
} from '@/lib/database';
import { listProviderSources } from '@/services/providerSourceService';
import { getAllNotificationSources } from '@/services/notificationSourceService';

// ─── Types ────────────────────────────────────────────────────────────────────

type Stats = Awaited<ReturnType<typeof getVerificationStats>>;
type AuditEntry = Awaited<ReturnType<typeof getAuditTrail>>[number];
type CanonicalRow = Awaited<ReturnType<typeof getRecentCanonicals>>[number];
type EvidenceRow = Awaited<ReturnType<typeof getRecentEvidences>>[number];

type SourceHealth = {
  smsSourcesCount: number;
  notifSourcesCount: number;
  configuredProviders: string[];
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VerificationDiagnosticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [canonicals, setCanonicals] = useState<CanonicalRow[]>([]);
  const [evidences, setEvidences] = useState<EvidenceRow[]>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'audit' | 'canonicals' | 'evidences'>('overview');

  const load = useCallback(async () => {
    const [s, a, c, e, smsSources, notifSources] = await Promise.all([
      getVerificationStats().catch(() => null),
      getAuditTrail(undefined, 30).catch(() => []),
      getRecentCanonicals(30).catch(() => []),
      getRecentEvidences(30).catch(() => []),
      listProviderSources().catch(() => []),
      getAllNotificationSources().catch(() => []),
    ]);
    setStats(s);
    setAudit(a);
    setCanonicals(c);
    setEvidences(e);

    const configuredProviders = [...new Set([
      ...smsSources.map((s) => s.providerId ?? '').filter(Boolean),
      ...notifSources.map((n) => n.providerId ?? '').filter(Boolean),
    ])];
    setSourceHealth({
      smsSourcesCount: smsSources.length,
      notifSourcesCount: notifSources.length,
      configuredProviders,
    });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    (async () => { await load(); })();
  }, [load]);

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'overview',   label: 'نظرة عامة' },
    { key: 'audit',      label: 'Audit Trail' },
    { key: 'canonicals', label: 'المعاملات' },
    { key: 'evidences',  label: 'الأدلة' },
  ];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* ── رأس الصفحة ── */}
      <View className="flex-row items-center px-5 py-5 gap-3 border-b border-border">
        <Pressable onPress={() => router.back()} className="p-2 border border-border rounded-full active:opacity-70">
          <ArrowRight size={20} color="#374151" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground">تشخيص محرك التحقق</Text>
          <Text className="text-xs text-muted-foreground">المرحلة الثانية — Production Engine</Text>
        </View>
        <Pressable onPress={onRefresh} className="p-2 border border-border rounded-full active:opacity-70">
          <RefreshCw size={18} color="#6b7280" />
        </Pressable>
      </View>

      {/* ── تبويبات ── */}
      <View className="flex-row border-b border-border px-5 gap-1">
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            className="py-3 px-3 active:opacity-70"
          >
            <Text
              className="text-sm font-medium"
              style={{ color: activeTab === tab.key ? '#111827' : '#9ca3af' }}
            >
              {tab.label}
            </Text>
            {activeTab === tab.key && (
              <View className="absolute bottom-0 left-3 right-3 h-0.5 bg-foreground rounded-full" />
            )}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator className="mt-16" />
      ) : (
        <ScrollView
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {activeTab === 'overview' && (
            <OverviewTab stats={stats} sourceHealth={sourceHealth} />
          )}
          {activeTab === 'audit' && (
            <AuditTab entries={audit} />
          )}
          {activeTab === 'canonicals' && (
            <CanonicalTab rows={canonicals} />
          )}
          {activeTab === 'evidences' && (
            <EvidenceTab rows={evidences} />
          )}
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ─── تبويب النظرة العامة ──────────────────────────────────────────────────────

function OverviewTab({ stats, sourceHealth }: { stats: Stats | null; sourceHealth: SourceHealth | null }) {
  if (!stats) {
    return (
      <View className="items-center py-20 gap-3 px-5">
        <AlertCircle size={40} color="#9ca3af" />
        <Text className="text-muted-foreground text-sm">لا توجد بيانات متاحة بعد</Text>
      </View>
    );
  }

  const confirmRate = stats.total_evidences > 0
    ? Math.round((stats.confirmed_evidences / stats.total_evidences) * 100)
    : 0;

  return (
    <View className="px-5 py-5 gap-4">

      {/* ── إحصائيات الأدلة ── */}
      <SectionHeader icon={<Database size={16} color="#6b7280" />} title="إحصائيات الأدلة" />
      <View className="flex-row gap-3 flex-wrap">
        <StatCard label="إجمالي الأدلة" value={String(stats.total_evidences)} color="#3b82f6" />
        <StatCard label="مؤكدة" value={String(stats.confirmed_evidences)} color="#22c55e" />
        <StatCard label="مرفوضة" value={String(stats.rejected_evidences)} color="#ef4444" />
        <StatCard label="معدل التأكيد" value={`${confirmRate}%`} color="#8b5cf6" />
      </View>

      {/* ── إحصائيات canonical ── */}
      <SectionHeader icon={<Layers size={16} color="#6b7280" />} title="المعاملات الكاملة" />
      <View className="flex-row gap-3 flex-wrap">
        <StatCard label="إجمالي المعاملات" value={String(stats.total_canonicals)} color="#3b82f6" />
        <StatCard label="مؤكدة" value={String(stats.confirmed_canonicals)} color="#22c55e" />
        <StatCard label="مكررة محبوطة" value={String(stats.duplicate_count)} color="#a855f7" />
        <StatCard label="بلا تطابق" value={String(stats.no_match_count)} color="#f59e0b" />
      </View>

      {/* ── صحة Trusted Sources ── */}
      <SectionHeader icon={<ShieldCheck size={16} color="#6b7280" />} title="مصادر موثوقة" />
      <View className="border border-border rounded-2xl bg-card px-4 py-4 gap-3">
        {sourceHealth ? (
          <>
            <SourceRow
              label="مصادر SMS"
              count={sourceHealth.smsSourcesCount}
              ok={sourceHealth.smsSourcesCount > 0}
            />
            <SourceRow
              label="مصادر الإشعارات"
              count={sourceHealth.notifSourcesCount}
              ok={sourceHealth.notifSourcesCount > 0}
            />
            {sourceHealth.configuredProviders.length > 0 && (
              <View className="flex-row flex-wrap gap-2 pt-2 border-t border-border">
                {sourceHealth.configuredProviders.map((p) => (
                  <View key={p} className="px-2.5 py-1 rounded-full bg-muted">
                    <Text className="text-xs text-foreground">{providerLabel(p)}</Text>
                  </View>
                ))}
              </View>
            )}
            {sourceHealth.configuredProviders.length === 0 && (
              <View className="flex-row items-center gap-2 pt-2">
                <ShieldAlert size={14} color="#f59e0b" />
                <Text className="text-sm text-muted-foreground">لا توجد مصادر موثوقة مهيأة بعد</Text>
              </View>
            )}
          </>
        ) : (
          <Text className="text-sm text-muted-foreground">لا توجد بيانات</Text>
        )}
      </View>

      {/* ── مؤشر الجاهزية ── */}
      <SectionHeader icon={<Activity size={16} color="#6b7280" />} title="جاهزية المحرك" />
      <View className="border border-border rounded-2xl bg-card px-4 py-4 gap-3">
        <ReadinessRow label="جداول DB (payment_evidences)" ok={stats.total_evidences >= 0} />
        <ReadinessRow label="جداول DB (canonical_transactions)" ok={stats.total_canonicals >= 0} />
        <ReadinessRow label="Audit Trail نشط" ok={stats.total_evidences > 0 || stats.total_canonicals > 0} />
        <ReadinessRow
          label="مصادر SMS موثوقة"
          ok={(sourceHealth?.smsSourcesCount ?? 0) > 0}
          warning={(sourceHealth?.smsSourcesCount ?? 0) === 0}
        />
        <ReadinessRow
          label="مصادر Notification موثوقة"
          ok={(sourceHealth?.notifSourcesCount ?? 0) > 0}
          warning={(sourceHealth?.notifSourcesCount ?? 0) === 0}
        />
      </View>
    </View>
  );
}

// ─── تبويب Audit Trail ────────────────────────────────────────────────────────

function AuditTab({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <View className="items-center py-20 gap-3 px-5">
        <ShieldAlert size={40} color="#9ca3af" />
        <Text className="text-muted-foreground text-sm">لا يوجد سجل audit حتى الآن</Text>
      </View>
    );
  }

  return (
    <View className="px-5 py-5 gap-3">
      <Text className="text-xs text-muted-foreground">آخر {entries.length} إدخال</Text>
      {entries.map((entry) => (
        <View key={entry.id} className="border border-border rounded-2xl bg-card px-4 py-3 gap-2">
          <View className="flex-row justify-between items-start">
            <View className="flex-row items-center gap-1.5 flex-1">
              {entry.final_action === 'confirmed'
                ? <ShieldCheck size={14} color="#22c55e" />
                : entry.final_action === 'duplicate'
                  ? <ShieldX size={14} color="#a855f7" />
                  : entry.final_action === 'review_required'
                    ? <ShieldAlert size={14} color="#f59e0b" />
                    : <ShieldX size={14} color="#ef4444" />}
              <Text className="text-sm font-medium text-foreground">
                {auditActionLabel(entry.final_action)}
              </Text>
            </View>
            <Text className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Badge label={verificationCodeLabel(entry.verification_code)} />
            {entry.match_score != null && (
              <Badge label={`نقاط: ${Math.round(entry.match_score)}`} />
            )}
            {entry.order_id && (
              <Badge label={`طلب: ${entry.order_id.slice(0, 8)}…`} />
            )}
          </View>
          {entry.reason && (
            <Text className="text-xs text-muted-foreground" numberOfLines={2}>{entry.reason}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── تبويب Canonical Transactions ────────────────────────────────────────────

function CanonicalTab({ rows }: { rows: CanonicalRow[] }) {
  if (rows.length === 0) {
    return (
      <View className="items-center py-20 gap-3 px-5">
        <Layers size={40} color="#9ca3af" />
        <Text className="text-muted-foreground text-sm">لا توجد معاملات canonical بعد</Text>
      </View>
    );
  }

  return (
    <View className="px-5 py-5 gap-3">
      <Text className="text-xs text-muted-foreground">آخر {rows.length} معاملة</Text>
      {rows.map((row) => (
        <View key={row.canonical_id} className="border border-border rounded-2xl bg-card px-4 py-3 gap-2">
          <View className="flex-row justify-between items-start">
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-semibold text-foreground">
                {row.amount} {row.currency}
              </Text>
              <Text className="text-xs text-muted-foreground">{providerLabel(row.provider_id)}</Text>
            </View>
            <View className="items-end gap-1">
              <View className="flex-row gap-1">
                {row.has_sms ? <Badge label="SMS" color="#3b82f6" /> : null}
                {row.has_notification ? <Badge label="إشعار" color="#8b5cf6" /> : null}
                {row.is_sufficient ? <Badge label="كافٍ" color="#22c55e" /> : <Badge label="ناقص" color="#f59e0b" />}
              </View>
              <Text className="text-xs text-muted-foreground">{formatDate(row.created_at)}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {row.match_code && <Badge label={verificationCodeLabel(row.match_code)} />}
            {row.match_score != null && <Badge label={`نقاط: ${Math.round(row.match_score)}`} />}
            {row.confirmed_at && <Badge label="مؤكد" color="#22c55e" />}
            {row.matched_order_id && (
              <Badge label={`طلب: ${row.matched_order_id.slice(0, 8)}…`} />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── تبويب Evidences ─────────────────────────────────────────────────────────

function EvidenceTab({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) {
    return (
      <View className="items-center py-20 gap-3 px-5">
        <Database size={40} color="#9ca3af" />
        <Text className="text-muted-foreground text-sm">لا توجد أدلة بعد</Text>
      </View>
    );
  }

  return (
    <View className="px-5 py-5 gap-3">
      <Text className="text-xs text-muted-foreground">آخر {rows.length} دليل</Text>
      {rows.map((row) => (
        <View key={row.evidence_id} className="border border-border rounded-2xl bg-card px-4 py-3 gap-2">
          <View className="flex-row justify-between items-start">
            <View className="flex-1 gap-0.5">
              <View className="flex-row items-center gap-2">
                <Badge
                  label={row.evidence_type === 'sms' ? 'SMS' : 'إشعار'}
                  color={row.evidence_type === 'sms' ? '#3b82f6' : '#8b5cf6'}
                />
                <Text className="text-sm font-medium text-foreground">
                  {row.amount != null ? `${row.amount} EGP` : '—'}
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground">{providerLabel(row.provider_id)}</Text>
            </View>
            <View className="items-end gap-1">
              <StatusBadge status={row.status} />
              <Text className="text-xs text-muted-foreground">{formatDate(row.received_at)}</Text>
            </View>
          </View>
          {row.order_id && (
            <Text className="text-xs text-muted-foreground">طلب: {row.order_id.slice(0, 8)}…</Text>
          )}
          {row.canonical_id && (
            <Text className="text-xs text-muted-foreground">Canonical: {row.canonical_id.slice(0, 12)}…</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── مكونات مساعدة ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View className="flex-row items-center gap-2 mt-2">
      {icon}
      <Text className="text-sm font-semibold text-foreground">{title}</Text>
    </View>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View
      className="flex-1 px-3 py-4 border border-border rounded-2xl bg-card items-center gap-1"
      style={{ minWidth: 80 }}
    >
      <Text className="text-xl font-bold" style={{ color }}>{value}</Text>
      <Text className="text-xs text-muted-foreground text-center">{label}</Text>
    </View>
  );
}

function SourceRow({ label, count, ok }: { label: string; count: number; ok: boolean }) {
  return (
    <View className="flex-row justify-between items-center">
      <Text className="text-sm text-foreground">{label}</Text>
      <View className="flex-row items-center gap-2">
        <Text className="text-xs text-muted-foreground">{count} مصدر</Text>
        {ok
          ? <Check size={14} color="#22c55e" />
          : <AlertCircle size={14} color="#f59e0b" />}
      </View>
    </View>
  );
}

function ReadinessRow({
  label,
  ok,
  warning,
}: {
  label: string;
  ok: boolean;
  warning?: boolean;
}) {
  return (
    <View className="flex-row justify-between items-center">
      <Text className="text-sm text-foreground">{label}</Text>
      {warning
        ? <AlertCircle size={14} color="#f59e0b" />
        : ok
          ? <Check size={14} color="#22c55e" />
          : <X size={14} color="#ef4444" />}
    </View>
  );
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <View
      className="px-2 py-0.5 rounded-full"
      style={{ backgroundColor: color ? `${color}22` : '#f3f4f6' }}
    >
      <Text className="text-xs font-medium" style={{ color: color ?? '#6b7280' }}>{label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: 'معلق', color: '#f59e0b' },
    linked:  { label: 'مرتبط', color: '#22c55e' },
    rejected:{ label: 'مرفوض', color: '#ef4444' },
  };
  const s = map[status] ?? { label: status, color: '#9ca3af' };
  return <Badge label={s.label} color={s.color} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function providerLabel(id: string): string {
  const map: Record<string, string> = {
    vodafone_cash: 'فودافون كاش',
    insta_pay:     'InstaPay',
    orange_cash:   'أورانج كاش',
    bank_transfer: 'تحويل بنكي',
  };
  return map[id] ?? id;
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
    TRANSACTION_TOO_OLD:     'معاملة قديمة',
    TRANSACTION_IN_FUTURE:   'معاملة في المستقبل',
    DUPLICATE_TRANSACTION:   'معاملة مكررة',
    ALREADY_USED:            'تم الاستخدام',
    INVALID_PAYMENT_MESSAGE: 'رسالة غير صالحة',
    UNSUPPORTED_MESSAGE:     'رسالة غير مدعومة',
    INSUFFICIENT_EVIDENCE:   'أدلة غير كافية',
    NO_MATCH:                'لا يوجد تطابق',
  };
  return map[code] ?? code;
}

function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    confirmed:       'تم التأكيد',
    rejected:        'تم الرفض',
    review_required: 'أُحيل للمراجعة',
    duplicate:       'مكرر',
    ignored:         'تم التجاهل',
  };
  return map[action] ?? action;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
