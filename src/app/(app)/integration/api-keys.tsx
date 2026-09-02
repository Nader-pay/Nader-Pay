// شاشة مفاتيح API — عرض + إنشاء + نسخ + إلغاء
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Copy, Plus, Trash2, CheckCircle2, ChevronLeft, RefreshCw, KeyRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '@/client/supabase';

type ApiCredential = {
  id: string;
  key_id: string;
  label: string;
  status: 'active' | 'revoked';
  environment: 'live' | 'sandbox';
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
};

function StatusPill({ env, status }: { env: string; status: string }) {
  const isLive = env === 'live';
  const isActive = status === 'active';
  return (
    <View className="flex-row gap-1.5">
      <View className={`rounded-full px-2 py-0.5 ${isLive ? 'bg-[#FEF3C7]' : 'bg-[#EEF2FF]'}`}>
        <Text className={`text-[10px] font-semibold ${isLive ? 'text-[#92400E]' : 'text-[#4338CA]'}`}>
          {isLive ? 'Live' : 'Sandbox'}
        </Text>
      </View>
      <View className={`rounded-full px-2 py-0.5 ${isActive ? 'bg-[#DCFCE7]' : 'bg-[#F3F4F6]'}`}>
        <Text className={`text-[10px] font-semibold ${isActive ? 'text-[#15803D]' : 'text-[#6B7280]'}`}>
          {isActive ? 'فعّال' : 'ملغى'}
        </Text>
      </View>
    </View>
  );
}

export default function ApiKeysScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newEnv, setNewEnv] = useState<'sandbox' | 'live'>('sandbox');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ key_id: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('يجب تسجيل الدخول أولاً'); setLoading(false); return; }

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api-credentials`,
        { headers: { Authorization: `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! } }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'فشل جلب المفاتيح');
      setCredentials(json.credentials ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { (async () => { await fetchCredentials(); })(); }, [fetchCredentials]));

  const handleCreate = async () => {
    if (!newLabel.trim()) { setError('أدخل اسماً للمفتاح'); return; }
    setCreating(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('يجب تسجيل الدخول');

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api-credentials`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            label: newLabel.trim(),
            environment: newEnv,
            scopes: ['payment_requests'],
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? 'فشل إنشاء المفتاح');

      // عرض السر مرة واحدة فقط
      if (json.key_id && json.secret) {
        setRevealedSecret({ key_id: json.key_id, secret: json.secret });
      }
      setNewLabel(''); setShowCreate(false);
      await fetchCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/api-credentials/${id}/revoke`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
        }
      );
      await fetchCredentials();
    } catch { /* تجاهل */ }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await Clipboard.setStringAsync(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

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
          <Text className="text-[17px] font-bold text-[#111827]">مفاتيح API</Text>
          <Text className="text-[12px] text-[#9CA3AF]">مفاتيح الوصول لربط موقعك</Text>
        </View>
        <Pressable onPress={fetchCredentials} className="active:opacity-60 p-1">
          <RefreshCw size={18} color="#6B7280" />
        </Pressable>
        <Pressable
          onPress={() => { setShowCreate(true); setError(null); }}
          className="active:opacity-70 flex-row items-center gap-1.5 bg-[#111827] rounded-xl px-3 py-2"
        >
          <Plus size={14} color="#fff" />
          <Text className="text-[12px] font-semibold text-white">جديد</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* السر الجديد — يُعرض مرة واحدة */}
        {revealedSecret && (
          <View
            className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-2xl px-5 py-4"
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-[12px] font-bold text-[#15803D] mb-1">✅ احفظ هذا السر الآن — لن يُعرض مرة أخرى</Text>
            <Text className="text-[11px] text-[#166534] mb-3 leading-5">
              انسخ المفتاح كاملاً والصقه في إعدادات موقعك. لن تتمكن من رؤيته لاحقاً.
            </Text>
            <View className="bg-white border border-[#D1FAE5] rounded-xl px-4 py-3 flex-row items-center gap-2 mb-2">
              <Text className="flex-1 text-[11px] font-mono text-[#111827]" numberOfLines={1}>
                {revealedSecret.key_id}.{revealedSecret.secret}
              </Text>
              <Pressable
                onPress={() => copyToClipboard(`${revealedSecret.key_id}.${revealedSecret.secret}`, 'new')}
                className="active:opacity-60"
              >
                {copiedId === 'new'
                  ? <CheckCircle2 size={18} color="#15803D" />
                  : <Copy size={18} color="#6B7280" />}
              </Pressable>
            </View>
            <Pressable onPress={() => setRevealedSecret(null)}>
              <Text className="text-[12px] text-[#15803D] font-semibold text-center">لقد حفظته — إغلاق</Text>
            </Pressable>
          </View>
        )}

        {/* نموذج الإنشاء */}
        {showCreate && (
          <View
            className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
            style={{ borderCurve: 'continuous' }}
          >
            <Text className="text-[14px] font-semibold text-[#111827] mb-4">مفتاح جديد</Text>

            <Text className="text-[12px] font-medium text-[#374151] mb-1.5">الاسم / الوصف</Text>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="مثال: موقع المتجر الرئيسي"
              placeholderTextColor="#9CA3AF"
              className="border border-[#E5E7EB] rounded-xl px-4 py-3 text-[14px] text-[#111827] bg-[#F9FAFB] mb-4"
            />

            <Text className="text-[12px] font-medium text-[#374151] mb-2">البيئة</Text>
            <View className="flex-row gap-2 mb-5">
              {(['sandbox', 'live'] as const).map((env) => (
                <Pressable
                  key={env}
                  onPress={() => setNewEnv(env)}
                  className={`flex-1 py-2.5 rounded-xl border items-center ${newEnv === env ? 'bg-[#111827] border-[#111827]' : 'bg-white border-[#E5E7EB]'}`}
                >
                  <Text className={`text-[13px] font-semibold ${newEnv === env ? 'text-white' : 'text-[#374151]'}`}>
                    {env === 'sandbox' ? '🧪 تجريبي' : '🚀 إنتاج'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error && <Text className="text-[12px] text-red-500 mb-3">{error}</Text>}

            <View className="flex-row gap-2">
              <Pressable
                onPress={() => { setShowCreate(false); setError(null); }}
                className="flex-1 py-3 border border-[#E5E7EB] rounded-xl items-center active:opacity-70"
              >
                <Text className="text-[13px] font-semibold text-[#6B7280]">إلغاء</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={creating}
                className="flex-1 py-3 bg-[#111827] rounded-xl items-center active:opacity-70"
              >
                {creating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text className="text-[13px] font-semibold text-white">إنشاء المفتاح</Text>}
              </Pressable>
            </View>
          </View>
        )}

        {/* قائمة المفاتيح */}
        {loading ? (
          <View className="items-center py-12">
            <ActivityIndicator size="large" color="#111827" />
            <Text className="text-[13px] text-[#9CA3AF] mt-3">جاري التحميل…</Text>
          </View>
        ) : credentials.length === 0 ? (
          <View className="items-center py-16">
            <View className="w-16 h-16 rounded-full bg-[#F3F4F6] items-center justify-center mb-4">
              <KeyRound size={28} color="#D1D5DB" />
            </View>
            <Text className="text-[15px] font-semibold text-[#374151] mb-1">لا توجد مفاتيح بعد</Text>
            <Text className="text-[13px] text-[#9CA3AF]">أنشئ أول مفتاح API للبدء</Text>
          </View>
        ) : (
          credentials.map((cred) => (
            <View
              key={cred.id}
              className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
              style={{ borderCurve: 'continuous' }}
            >
              <View className="flex-row items-start justify-between mb-2">
                <View className="flex-1 mr-2">
                  <Text className="text-[15px] font-semibold text-[#111827]">{cred.label}</Text>
                  <StatusPill env={cred.environment} status={cred.status} />
                </View>
                {cred.status === 'active' && (
                  <Pressable
                    onPress={() => handleRevoke(cred.id)}
                    className="active:opacity-60 p-1"
                  >
                    <Trash2 size={16} color="#EF4444" />
                  </Pressable>
                )}
              </View>

              {/* Key ID */}
              <View className="bg-[#F8F9FB] rounded-xl px-3 py-2.5 flex-row items-center gap-2 mt-2">
                <Text className="text-[10px] font-semibold text-[#9CA3AF] w-14">KEY ID</Text>
                <Text className="flex-1 text-[12px] font-mono text-[#374151]" numberOfLines={1}>
                  {cred.key_id}
                </Text>
                <Pressable onPress={() => copyToClipboard(cred.key_id, cred.id + '_kid')} className="active:opacity-60">
                  {copiedId === cred.id + '_kid'
                    ? <CheckCircle2 size={15} color="#15803D" />
                    : <Copy size={15} color="#9CA3AF" />}
                </Pressable>
              </View>

              <View className="flex-row items-center justify-between mt-2.5">
                <Text className="text-[11px] text-[#9CA3AF]">
                  {cred.last_used_at
                    ? `آخر استخدام: ${new Date(cred.last_used_at).toLocaleDateString('ar-EG')}`
                    : 'لم يُستخدم بعد'}
                </Text>
                <Text className="text-[11px] text-[#9CA3AF]">
                  {new Date(cred.created_at).toLocaleDateString('ar-EG')}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* شرح الاستخدام */}
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4 mt-2"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[13px] font-semibold text-[#374151] mb-2">كيف تستخدم المفتاح؟</Text>
          <Text className="text-[12px] text-[#6B7280] leading-5 mb-3">
            أضف المفتاح في header كل طلب بهذا الشكل:
          </Text>
          <View className="bg-[#0F172A] rounded-xl px-4 py-3">
            <Text className="text-[11px] font-mono text-[#A5F3FC] leading-5">
              {'x-api-key: {KEY_ID}.{SECRET}'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
