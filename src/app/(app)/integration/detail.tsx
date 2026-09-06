// تفاصيل تكامل محدد — Integration Detail
import { View, Text, ScrollView, Pressable, ActivityIndicator, Switch } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ChevronLeft, Key, Webhook, Globe, Activity, Clock,
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Copy,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/client/supabase';

type IntegrationDetail = {
  id: string;
  name: string;
  type: string;
  website_url: string | null;
  environment: 'sandbox' | 'live';
  status: string;
  last_activity_at: string | null;
  created_at: string;
  enabled_events: string[];
  api_credentials: Array<{
    id: string; key_id: string; status: string;
    environment: string; last_used_at: string | null;
  }>;
  webhook_endpoints: Array<{
    id: string; url: string; status: string;
    auth_mode: string; health_status: string | null;
    last_test_at: string | null;
  }>;
};

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

export default function IntegrationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

  const [integration, setIntegration] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const res = await fetch(`${supabaseUrl}/functions/v1/integrations/${id}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
      });
      if (res.ok) {
        const json = await res.json();
        setIntegration(json.integration ?? json);
      } else {
        setError('تعذّر تحميل بيانات التكامل');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [id, supabaseUrl]);

  useFocusEffect(useCallback(() => { (async () => { await fetchDetail(); })(); }, [fetchDetail]));

  const handleToggle = async () => {
    if (!integration) return;
    setToggling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('غير مصادق');

      const action = integration.status === 'active' ? 'disable' : 'enable';
      const res = await fetch(`${supabaseUrl}/functions/v1/integrations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, integration_id: integration.id }),
      });
      if (res.ok) await fetchDetail();
    } catch { /* تجاهل */ }
    finally { setToggling(false); }
  };

  const copyText = async (text: string, key: string) => {
    await Clipboard.setStringAsync(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-[#F8F9FB] items-center justify-center">
        <ActivityIndicator size="large" color="#111827" />
      </View>
    );
  }

  if (!integration) {
    return (
      <View className="flex-1 bg-[#F8F9FB] items-center justify-center px-6">
        <AlertCircle size={32} color="#9CA3AF" />
        <Text className="text-[15px] text-[#374151] mt-3">{error ?? 'التكامل غير موجود'}</Text>
        <Pressable onPress={() => router.back()} className="mt-4 active:opacity-60">
          <Text className="text-[14px] text-[#4338CA]">العودة</Text>
        </Pressable>
      </View>
    );
  }

  const isActive = integration.status === 'active';
  const activeKey = integration.api_credentials?.find((c) => c.status === 'active');
  const webhook = integration.webhook_endpoints?.[0];
  const baseUrl = `${supabaseUrl}/functions/v1`;

  return (
    <View className="flex-1 bg-[#F8F9FB]">
      {/* Header */}
      <View
        className="bg-white border-b border-[#E5E7EB] px-5 flex-row items-center gap-3"
        style={{ paddingTop: insets.top + 12, paddingBottom: 14 }}
      >
        <Pressable onPress={() => router.back()} className="active:opacity-60 p-1">
          <ChevronLeft size={22} color="#111827" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-[17px] font-bold text-[#111827]" numberOfLines={1}>{integration.name}</Text>
          <Text className="text-[12px] text-[#9CA3AF]">
            {integration.environment === 'live' ? 'Live' : 'Sandbox'} · {isActive ? 'فعّال' : 'معطّل'}
          </Text>
        </View>
        <Pressable onPress={fetchDetail} className="active:opacity-60 p-1">
          <RefreshCw size={17} color="#6B7280" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* حالة التكامل */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[14px] font-semibold text-[#111827]">حالة التكامل</Text>
            {toggling
              ? <ActivityIndicator size="small" color="#4338CA" />
              : <Switch
                  value={isActive}
                  onValueChange={handleToggle}
                  trackColor={{ false: '#E5E7EB', true: '#111827' }}
                />}
          </View>
          <View className="flex-row gap-2">
            <View className={`flex-1 rounded-xl px-3 py-2.5 flex-row items-center gap-1.5 ${isActive ? 'bg-[#F0FDF4]' : 'bg-[#F9FAFB]'}`}>
              {isActive ? <CheckCircle2 size={14} color="#15803D" /> : <XCircle size={14} color="#9CA3AF" />}
              <Text className={`text-[12px] font-medium ${isActive ? 'text-[#15803D]' : 'text-[#9CA3AF]'}`}>
                {isActive ? 'يستقبل الطلبات' : 'موقوف مؤقتاً'}
              </Text>
            </View>
            <View className={`rounded-xl px-3 py-2.5 ${integration.environment === 'live' ? 'bg-[#FFFBEB]' : 'bg-[#EEF2FF]'}`}>
              <Text className={`text-[12px] font-bold ${integration.environment === 'live' ? 'text-[#92400E]' : 'text-[#4338CA]'}`}>
                {integration.environment === 'live' ? 'LIVE' : 'SANDBOX'}
              </Text>
            </View>
          </View>
          {integration.last_activity_at && (
            <View className="flex-row items-center gap-1.5 mt-2.5">
              <Clock size={11} color="#9CA3AF" />
              <Text className="text-[11px] text-[#9CA3AF]">آخر نشاط: {formatRelative(integration.last_activity_at)}</Text>
            </View>
          )}
        </View>

        {/* بيانات الاتصال */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center gap-2 mb-3">
            <Globe size={15} color="#374151" />
            <Text className="text-[14px] font-semibold text-[#111827]">بيانات الاتصال</Text>
          </View>
          <View className="gap-3">
            {[
              { label: 'Base URL', value: baseUrl },
              { label: 'Endpoint الدفع', value: `${baseUrl}/payment-requests` },
              { label: 'رابط الموقع', value: integration.website_url ?? '—' },
              { label: 'معرّف التكامل', value: integration.id },
            ].map(({ label, value }) => (
              <Pressable key={label} onPress={() => copyText(value, label)} className="active:opacity-60">
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Text className="text-[11px] text-[#9CA3AF] mb-0.5">{label}</Text>
                    <Text className="text-[12px] font-mono text-[#374151]" numberOfLines={1}>{value}</Text>
                  </View>
                  {copiedId === label
                    ? <CheckCircle2 size={14} color="#15803D" />
                    : <Copy size={14} color="#D1D5DB" />}
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* API Key */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Key size={15} color="#4338CA" />
              <Text className="text-[14px] font-semibold text-[#111827]">مفتاح API</Text>
            </View>
            <Pressable
              onPress={() => router.push('/(app)/integration/api-keys' as never)}
              className="active:opacity-60"
            >
              <Text className="text-[12px] text-[#4338CA] font-medium">إدارة المفاتيح</Text>
            </Pressable>
          </View>
          {activeKey ? (
            <View className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-4 py-3">
              <View className="flex-row items-center gap-2 mb-1">
                <CheckCircle2 size={13} color="#15803D" />
                <Text className="text-[12px] font-medium text-[#15803D]">مفتاح فعّال</Text>
              </View>
              <Text className="text-[11px] font-mono text-[#374151]">{activeKey.key_id}</Text>
              {activeKey.last_used_at && (
                <Text className="text-[11px] text-[#6B7280] mt-1">آخر استخدام: {formatRelative(activeKey.last_used_at)}</Text>
              )}
            </View>
          ) : (
            <View className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3">
              <View className="flex-row items-center gap-2">
                <AlertCircle size={13} color="#DC2626" />
                <Text className="text-[12px] font-medium text-red-600">لا يوجد مفتاح API فعّال</Text>
              </View>
              <Text className="text-[11px] text-[#6B7280] mt-1">أنشئ مفتاحاً من قسم "إدارة المفاتيح"</Text>
            </View>
          )}
        </View>

        {/* Webhook */}
        <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Webhook size={15} color="#1D4ED8" />
              <Text className="text-[14px] font-semibold text-[#111827]">Webhook</Text>
            </View>
            <Pressable
              onPress={() => router.push('/(app)/integration/webhook' as never)}
              className="active:opacity-60"
            >
              <Text className="text-[12px] text-[#4338CA] font-medium">الإعدادات</Text>
            </Pressable>
          </View>
          {webhook ? (
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <View className={`w-2 h-2 rounded-full ${webhook.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                <Text className="text-[12px] text-[#374151]" numberOfLines={1}>{webhook.url}</Text>
              </View>
              <View className="flex-row gap-2">
                <View className="bg-[#F8F9FB] rounded-lg px-2.5 py-1">
                  <Text className="text-[10px] text-[#6B7280]">{webhook.auth_mode}</Text>
                </View>
                {webhook.health_status && (
                  <View className={`rounded-lg px-2.5 py-1 ${webhook.health_status === 'healthy' ? 'bg-[#F0FDF4]' : 'bg-[#FEF2F2]'}`}>
                    <Text className={`text-[10px] font-medium ${webhook.health_status === 'healthy' ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
                      {webhook.health_status}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <View className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-4 py-3">
              <Text className="text-[12px] text-[#92400E]">لا يوجد Webhook مضبوط — أضفه من قسم "الإعدادات"</Text>
            </View>
          )}
        </View>

        {/* الأحداث المفعّلة */}
        {integration.enabled_events?.length > 0 && (
          <View className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4" style={{ borderCurve: 'continuous' }}>
            <View className="flex-row items-center gap-2 mb-3">
              <Activity size={15} color="#374151" />
              <Text className="text-[14px] font-semibold text-[#111827]">الأحداث المفعّلة</Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {integration.enabled_events.map((ev) => (
                <View key={ev} className="bg-[#EEF2FF] rounded-full px-3 py-1">
                  <Text className="text-[11px] font-mono text-[#4338CA]">{ev}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* أزرار سريعة */}
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => router.push('/(app)/integration/test' as never)}
            className="flex-1 bg-[#111827] rounded-2xl py-3.5 items-center active:opacity-70"
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-[13px] font-semibold text-white">اختبار</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(app)/integration/guide' as never)}
            className="flex-1 border border-[#E5E7EB] bg-white rounded-2xl py-3.5 items-center active:opacity-70"
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-[13px] font-semibold text-[#374151]">الدليل</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
