// لوحة تحكم التكامل — Integration Overview مُبسَّطة
import { ScrollView, View, Text, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  Key, Webhook, BookOpen, FileDown, Code2, ChevronRight,
  Plus, Globe, Activity, Zap, AlertCircle, CheckCircle2,
  Clock, RefreshCw, FlaskConical, Rocket, ArrowRight,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/client/supabase';

// ─── أنواع البيانات ───────────────────────────────────────────
type IntegrationSummary = {
  total_integrations: number;
  active_integrations: number;
  active_api_keys: number;
  total_requests: number;
  confirmed_requests: number;
  pending_requests: number;
  webhook_success_24h: number;
  webhook_fail_24h: number;
};

type IntegrationItem = {
  id: string;
  name: string;
  type: string;
  website_url: string | null;
  environment: 'sandbox' | 'live';
  status: string;
  last_activity_at: string | null;
  created_at: string;
  api_credentials: Array<{ id: string; key_id: string; status: string; last_used_at: string | null }>;
  webhook_endpoints: Array<{ id: string; url: string; status: string; health_status: string | null }>;
};

type LastRequest = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  external_reference: string;
  created_at: string;
} | null;

// ─── مكوّنات مساعدة ───────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View className="flex-1 bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 items-center" style={{ borderCurve: 'continuous' }}>
      <Text className="text-[20px] font-bold" style={{ color }}>{value}</Text>
      <Text className="text-[11px] text-[#9CA3AF] text-center mt-0.5" numberOfLines={1}>{label}</Text>
    </View>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <View className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
  );
}

function IntegrationCard({ icon, title, description, badge, onPress }: {
  icon: React.ReactNode; title: string; description: string; badge?: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="active:opacity-70">
      <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4 flex-row items-center gap-4" style={{ borderCurve: 'continuous' }}>
        <View className="w-10 h-10 rounded-xl bg-[#F8F9FB] items-center justify-center">{icon}</View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-[14px] font-semibold text-[#111827]">{title}</Text>
            {badge && (
              <View className="bg-[#EEF2FF] rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-[#4338CA]">{badge}</Text>
              </View>
            )}
          </View>
          <Text className="text-[12px] text-[#6B7280] mt-0.5 leading-5">{description}</Text>
        </View>
        <ChevronRight size={16} color="#9CA3AF" />
      </View>
    </Pressable>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return `منذ ${Math.floor(h / 24)} ي`;
}

function statusColor(s: string) {
  if (s === 'CONFIRMED') return '#15803D';
  if (s === 'REJECTED' || s === 'DUPLICATE') return '#DC2626';
  if (s === 'EXPIRED' || s === 'CANCELLED') return '#6B7280';
  return '#4338CA';
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    CREATED: 'جديد', CONFIRMED: 'مؤكد', REJECTED: 'مرفوض',
    EXPIRED: 'منتهي', CANCELLED: 'ملغى', DUPLICATE: 'مكرر',
  };
  return m[s] ?? s;
}

// ─── Quick Connect Banner ────────────────────────────────────
function QuickConnectBanner({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mx-6 mb-5 active:opacity-70"
    >
      <View
        className="bg-[#111827] rounded-2xl px-5 py-5"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="flex-row items-center gap-2 mb-2">
          <Rocket size={16} color="#FCD34D" />
          <Text className="text-[12px] font-semibold text-[#FCD34D] tracking-wide uppercase">ربط سريع</Text>
        </View>
        <Text className="text-[18px] font-bold text-white mb-1 leading-6">
          اربط موقعك في دقيقتين
        </Text>
        <Text className="text-[13px] text-[#9CA3AF] leading-5 mb-4">
          أدخل اسم موقعك ورابط الـ Webhook — وسنولّد لك كل الكود جاهزاً تلقائياً.
        </Text>
        <View className="flex-row items-center gap-2 bg-white/10 self-start rounded-xl px-4 py-2">
          <Text className="text-[13px] font-semibold text-white">ابدأ الآن</Text>
          <ArrowRight size={14} color="#fff" />
        </View>
      </View>
    </Pressable>
  );
}

// ─── الشاشة الرئيسية ──────────────────────────────────────────
export default function IntegrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<IntegrationSummary | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [lastRequest, setLastRequest] = useState<LastRequest>(null);
  const [error, setError] = useState<string | null>(null);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const res = await fetch(`${supabaseUrl}/functions/v1/integration-status`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
      });
      if (res.ok) {
        const json = await res.json();
        setSummary(json.summary ?? null);
        setIntegrations(json.integrations ?? []);
        setLastRequest(json.last_request ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabaseUrl]);

  useFocusEffect(useCallback(() => { (async () => { await fetchData(); })(); }, [fetchData]));

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const hasIntegrations = integrations.length > 0;

  return (
    <ScrollView
      className="flex-1 bg-[#F8F9FB]"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* ─── Header ─── */}
      <View className="px-6 pt-2 pb-5 flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-1">للمطوّرين</Text>
          <Text className="text-[24px] font-bold text-[#111827] leading-8">نظام التكامل</Text>
          <Text className="text-[13px] text-[#6B7280] mt-1 leading-5">
            اربط موقعك بمحرّك التحقق التلقائي
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/(app)/integration/create' as never)}
          className="bg-[#111827] rounded-xl px-4 py-2.5 flex-row items-center gap-1.5 active:opacity-70"
        >
          <Plus size={15} color="#fff" />
          <Text className="text-[13px] font-semibold text-white">جديد</Text>
        </Pressable>
      </View>

      {/* ─── خطأ تحميل ─── */}
      {error && (
        <View className="mx-6 mb-4 bg-[#FEF2F2] border border-[#FECACA] rounded-2xl px-4 py-3 flex-row items-center gap-2">
          <AlertCircle size={16} color="#DC2626" />
          <Text className="text-[12px] text-red-600 flex-1">{error}</Text>
          <Pressable onPress={fetchData} className="active:opacity-60">
            <RefreshCw size={14} color="#DC2626" />
          </Pressable>
        </View>
      )}

      {loading ? (
        <View className="items-center justify-center py-16">
          <ActivityIndicator size="large" color="#111827" />
          <Text className="text-[13px] text-[#9CA3AF] mt-3">جاري تحميل البيانات…</Text>
        </View>
      ) : (
        <>
          {/* ─── Quick Connect Banner (دائماً ظاهر) ─── */}
          <QuickConnectBanner onPress={() => router.push('/(app)/integration/create' as never)} />

          {/* ─── إحصائيات سريعة ─── */}
          {summary && (
            <View className="px-6 mb-5">
              <View className="flex-row gap-3 mb-3">
                <StatCard label="التكاملات" value={summary.total_integrations} color="#111827" />
                <StatCard label="المفاتيح الفعّالة" value={summary.active_api_keys} color="#4338CA" />
                <StatCard label="طلبات معلقة" value={summary.pending_requests} color="#92400E" />
              </View>
              <View className="flex-row gap-3">
                <StatCard label="إجمالي الطلبات" value={summary.total_requests} color="#374151" />
                <StatCard label="مؤكدة" value={summary.confirmed_requests} color="#15803D" />
                <StatCard label="Webhook ✓ (24س)" value={summary.webhook_success_24h} color="#0369A1" />
              </View>
            </View>
          )}

          {/* ─── آخر طلب دفع ─── */}
          {lastRequest && (
            <View className="mx-6 mb-5">
              <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-2">آخر طلب دفع</Text>
              <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4 flex-row items-center gap-3" style={{ borderCurve: 'continuous' }}>
                <View className="w-9 h-9 rounded-xl bg-[#F8F9FB] items-center justify-center">
                  <Activity size={17} color="#374151" />
                </View>
                <View className="flex-1">
                  <Text className="text-[13px] font-semibold text-[#111827]">
                    {lastRequest.amount} {lastRequest.currency}
                  </Text>
                  <Text className="text-[11px] text-[#9CA3AF]" numberOfLines={1}>
                    {lastRequest.external_reference} · {formatRelative(lastRequest.created_at)}
                  </Text>
                </View>
                <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: statusColor(lastRequest.status) + '18' }}>
                  <Text className="text-[10px] font-bold" style={{ color: statusColor(lastRequest.status) }}>
                    {statusLabel(lastRequest.status)}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* ─── قائمة التكاملات ─── */}
          {hasIntegrations ? (
            <View className="mx-6 mb-5">
              <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-2">تكاملاتك</Text>
              <View className="gap-3">
                {integrations.map((int) => {
                  const activeKey = int.api_credentials?.find((c) => c.status === 'active');
                  const webhook = int.webhook_endpoints?.[0];
                  const isActive = int.status === 'active';
                  return (
                    <Pressable
                      key={int.id}
                      onPress={() => router.push({ pathname: '/(app)/integration/detail', params: { id: int.id } } as never)}
                      className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4 active:opacity-70"
                      style={{ borderCurve: 'continuous' }}
                    >
                      {/* رأس البطاقة */}
                      <View className="flex-row items-start gap-3 mb-3">
                        <View className="w-10 h-10 rounded-xl bg-[#F8F9FB] items-center justify-center">
                          <Globe size={18} color={isActive ? '#111827' : '#9CA3AF'} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-[14px] font-semibold text-[#111827]">{int.name}</Text>
                          {int.website_url && (
                            <Text className="text-[11px] text-[#9CA3AF]" numberOfLines={1}>{int.website_url}</Text>
                          )}
                        </View>
                        <View className="items-end gap-1">
                          <View className={`rounded-full px-2 py-0.5 ${int.environment === 'live' ? 'bg-[#FEF3C7]' : 'bg-[#EEF2FF]'}`}>
                            <Text className={`text-[9px] font-bold ${int.environment === 'live' ? 'text-[#92400E]' : 'text-[#4338CA]'}`}>
                              {int.environment === 'live' ? 'LIVE' : 'SANDBOX'}
                            </Text>
                          </View>
                          <View className="flex-row items-center gap-1">
                            <StatusDot active={isActive} />
                            <Text className="text-[10px] text-[#9CA3AF]">{isActive ? 'فعّال' : 'معطّل'}</Text>
                          </View>
                        </View>
                      </View>

                      {/* مؤشرات */}
                      <View className="flex-row gap-2">
                        <View className={`flex-1 rounded-xl px-3 py-2 flex-row items-center gap-1.5 ${activeKey ? 'bg-[#F0FDF4]' : 'bg-[#F9FAFB]'}`}>
                          <Key size={12} color={activeKey ? '#15803D' : '#9CA3AF'} />
                          <Text className={`text-[11px] font-medium ${activeKey ? 'text-[#15803D]' : 'text-[#9CA3AF]'}`}>
                            {activeKey ? 'API Key فعّال' : 'لا يوجد مفتاح'}
                          </Text>
                        </View>
                        <View className={`flex-1 rounded-xl px-3 py-2 flex-row items-center gap-1.5 ${webhook?.status === 'active' ? 'bg-[#EFF6FF]' : 'bg-[#F9FAFB]'}`}>
                          <Zap size={12} color={webhook?.status === 'active' ? '#1D4ED8' : '#9CA3AF'} />
                          <Text className={`text-[11px] font-medium ${webhook?.status === 'active' ? 'text-[#1D4ED8]' : 'text-[#9CA3AF]'}`}>
                            {webhook?.status === 'active' ? 'Webhook نشط' : 'لا يوجد Webhook'}
                          </Text>
                        </View>
                      </View>

                      {/* آخر نشاط */}
                      {int.last_activity_at && (
                        <View className="flex-row items-center gap-1.5 mt-2.5">
                          <Clock size={11} color="#9CA3AF" />
                          <Text className="text-[11px] text-[#9CA3AF]">
                            آخر نشاط: {formatRelative(int.last_activity_at)}
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            /* حالة فارغة */
            <View className="mx-6 mb-5 bg-white border border-[#E5E7EB] rounded-2xl px-6 py-8 items-center" style={{ borderCurve: 'continuous' }}>
              <View className="w-14 h-14 rounded-2xl bg-[#F3F4F6] items-center justify-center mb-4">
                <Globe size={26} color="#9CA3AF" />
              </View>
              <Text className="text-[15px] font-semibold text-[#111827] mb-2">لا يوجد تكامل بعد</Text>
              <Text className="text-[13px] text-[#6B7280] text-center leading-5 mb-5">
                أنشئ أول تكامل لبدء استقبال طلبات التحقق من موقعك
              </Text>
              <Pressable
                onPress={() => router.push('/(app)/integration/create' as never)}
                className="bg-[#111827] rounded-xl px-6 py-3 flex-row items-center gap-2 active:opacity-70"
              >
                <Plus size={15} color="#fff" />
                <Text className="text-[14px] font-semibold text-white">إنشاء تكامل جديد</Text>
              </Pressable>
            </View>
          )}

          {/* ─── أدوات التكامل ─── */}
          <View className="px-6 gap-3">
            <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-1">أدوات التكامل</Text>

            <IntegrationCard
              icon={<Key size={18} color="#111827" />}
              title="مفاتيح API"
              description="أنشئ وأدِر مفاتيح الوصول"
              badge="مطلوب"
              onPress={() => router.push('/(app)/integration/api-keys' as never)}
            />
            <IntegrationCard
              icon={<BookOpen size={18} color="#111827" />}
              title="دليل التكامل"
              description="API Docs حقيقية خطوة بخطوة"
              onPress={() => router.push('/(app)/integration/guide' as never)}
            />
            <IntegrationCard
              icon={<Webhook size={18} color="#111827" />}
              title="إعداد Webhook"
              description="استقبل تأكيد الدفع فور حدوثه"
              onPress={() => router.push('/(app)/integration/webhook' as never)}
            />
            <IntegrationCard
              icon={<FlaskConical size={18} color="#111827" />}
              title="اختبار التكامل"
              description="تقرير E2E خطوة بخطوة"
              onPress={() => router.push('/(app)/integration/test' as never)}
            />
            <IntegrationCard
              icon={<Code2 size={18} color="#111827" />}
              title="أمثلة الطلبات"
              description="كود جاهز Node.js / PHP / Python"
              onPress={() => router.push('/(app)/integration/payment-form' as never)}
            />
            <IntegrationCard
              icon={<FileDown size={18} color="#111827" />}
              title="ملف التكامل JSON"
              description="حزمة التوثيق الكاملة للمطوّر"
              onPress={() => router.push('/(app)/integration/download' as never)}
            />
          </View>

          {/* ─── تنبيه أمان ─── */}
          <View className="mx-6 mt-5">
            <View className="border border-[#FEE2E2] bg-[#FFF7F7] rounded-2xl px-4 py-3" style={{ borderCurve: 'continuous' }}>
              <View className="flex-row items-center gap-2 mb-1">
                <AlertCircle size={13} color="#DC2626" />
                <Text className="text-[12px] font-semibold text-[#DC2626]">تنبيه أمان مهم</Text>
              </View>
              <Text className="text-[12px] text-[#7F1D1D] leading-5">
                لا تضع API Secret في كود Frontend. استخدم متغيرات البيئة في Backend فقط. موقعك → Backend → NaderPay API.
              </Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
