import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, LogOut, Save, Server, Smartphone, X, Bell, Battery, Wifi, MessageSquare, Activity, Shield, ChevronLeft } from 'lucide-react-native';

import { useSession } from '@/ctx';
import { useAgent } from '@/contexts/AgentContext';
import { supabase } from '@/client/supabase';
import { logEvent } from '@/lib/database';
import { requestNotificationPermission } from '@/services/notifications';
import type { AgentSettings } from '@/types/agent';

export default function SettingsScreen() {
  const { session } = useSession();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    settings,
    deviceState,
    state,
    saveAgentSettings,
    registerDevice,
    setEnabled,
    reloadSettings,
    requestSmsAccess,
  } = useAgent();

  const [form, setForm] = useState<AgentSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      reloadSettings();
    }, [reloadSettings])
  );

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSave = async () => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await saveAgentSettings(form);
      setMessage('تم حفظ الإعدادات');
      await logEvent('settings_saved', 'تم حفظ إعدادات الوكيل');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterDevice = async () => {
    setError('');
    setMessage('');
    setRegistering(true);
    try {
      await registerDevice();
      setMessage('تم تسجيل الجهاز بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التسجيل');
    } finally {
      setRegistering(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  const handleRequestSms = async () => {
    const granted = await requestSmsAccess();
    setMessage(granted ? 'تم منح صلاحية SMS' : 'تم رفض صلاحية SMS');
  };

  const handleRequestNotifications = async () => {
    const granted = await requestNotificationPermission();
    setMessage(granted ? 'تم منح صلاحية الإشعارات' : 'تم رفض صلاحية الإشعارات');
  };

  const status = state.connectionStatus;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView className="flex-1 px-5" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <View className="py-6 gap-1">
            <Text className="text-2xl font-bold text-foreground">إعدادات الوكيل</Text>
            <Text className="text-xs text-muted-foreground">الربط مع خادم Nader AI</Text>
          </View>

          {message ? (
            <View className="flex-row items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 mb-4">
              <Check size={16} color="#166534" />
              <Text className="text-sm text-emerald-800 flex-1">{message}</Text>
              <Pressable onPress={() => setMessage('')}>
                <X size={16} color="#166534" />
              </Pressable>
            </View>
          ) : null}

          {error ? (
            <View className="flex-row items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 mb-4">
              <X size={16} color="#991b1b" />
              <Text className="text-sm text-red-800 flex-1">{error}</Text>
              <Pressable onPress={() => setError('')}>
                <X size={16} color="#991b1b" />
              </Pressable>
            </View>
          ) : null}

          {/* حالة الاتصال */}
          <View className="px-4 py-4 border border-border rounded-2xl bg-card mb-4 gap-3">
            <View className="flex-row items-center gap-3">
              <Wifi size={20} color="#6b7280" />
              <Text className="text-sm font-semibold text-foreground">حالة الاتصال</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusColor(status) }} />
              <Text className="text-sm text-foreground">{statusLabel(status)}</Text>
            </View>
            {state.lastError && <Text className="text-xs text-destructive">{state.lastError}</Text>}
            <View className="flex-row gap-2">
              <InfoBadge label="آخر تحديث" value={state.lastPollAt ? formatTime(state.lastPollAt) : '—'} />
              <InfoBadge label="مزامنة معلقة" value={String(state.pendingSyncCount)} />
            </View>
          </View>

          {/* تفعيل الوكيل */}
          <View className="flex-row items-center justify-between px-4 py-4 border border-border rounded-2xl bg-card mb-4">
            <View className="flex-row items-center gap-3">
              <Server size={20} color="#6b7280" />
              <Text className="text-sm font-medium text-foreground">تفعيل الوكيل</Text>
            </View>
            <Toggle
              value={form.enabled}
              onChange={(v) => {
                setForm((f) => ({ ...f, enabled: v }));
                setEnabled(v);
              }}
            />
          </View>

          {/* الإعدادات الأساسية */}
          <Section title="إعدادات الخادم">
            <Pressable
              onPress={() => router.push('/(app)/(tabs)/servers' as any)}
              className="flex-row items-center justify-between px-4 py-3 border border-border rounded-xl bg-card active:opacity-70"
            >
              <View className="flex-row items-center gap-3">
                <Server size={18} className="text-foreground" />
                <Text className="text-sm text-foreground">خوادم الدفع</Text>
              </View>
              <ChevronLeft size={18} color="#9ca3af" />
            </Pressable>
            <InputField
              label="فترة التحديث (ثانية)"
              value={String(Math.round(form.pollingIntervalMs / 1000))}
              onChangeText={(v) => setForm((f) => ({ ...f, pollingIntervalMs: (parseInt(v, 10) || 30) * 1000 }))}
              keyboardType="number-pad"
            />
          </Section>

          {/* إعدادات التحقق */}
          <Section title="إعدادات التحقق">
            <InputField
              label="نافذة البحث (ساعة)"
              value={String(form.maxSearchWindowHours)}
              onChangeText={(v) => setForm((f) => ({ ...f, maxSearchWindowHours: parseInt(v, 10) || 24 }))}
              keyboardType="number-pad"
            />
            <InputField
              label="تسامح المبلغ (نسبة)"
              value={String(form.maxAmountTolerance)}
              onChangeText={(v) => setForm((f) => ({ ...f, maxAmountTolerance: parseFloat(v) || 0.01 }))}
              keyboardType="decimal-pad"
            />
            <Row label="تأكيد تلقائي">
              <Toggle value={form.autoConfirm} onChange={(v) => setForm((f) => ({ ...f, autoConfirm: v }))} />
            </Row>
            <Row label="سياسة الرفض التلقائي">
              <Text className="text-xs text-muted-foreground">عند انتهاء الصلاحية</Text>
            </Row>
            <Row label="التحقق من مصدر الرسالة">
              <Toggle value={form.requireSourceVerification} onChange={(v) => setForm((f) => ({ ...f, requireSourceVerification: v }))} />
            </Row>
            <InputField
              label="الحد الأدنى للتطابق (%)"
              value={String(form.minMatchScore)}
              onChangeText={(v) => setForm((f) => ({ ...f, minMatchScore: parseInt(v, 10) || 70 }))}
              keyboardType="number-pad"
            />
          </Section>

          {/* إعدادات إعادة المحاولة */}
          <Section title="إعدادات إعادة المحاولة">
            <Row label="سياسة إعادة المحاولة">
              <Text className="text-xs text-muted-foreground">أسي</Text>
            </Row>
            <InputField
              label="أقصى عدد محاولات"
              value={String(form.retryMaxAttempts)}
              onChangeText={(v) => setForm((f) => ({ ...f, retryMaxAttempts: parseInt(v, 10) || 5 }))}
              keyboardType="number-pad"
            />
            <InputField
              label="التأخير الأساسي (مللي ثانية)"
              value={String(form.retryBaseDelayMs)}
              onChangeText={(v) => setForm((f) => ({ ...f, retryBaseDelayMs: parseInt(v, 10) || 2000 }))}
              keyboardType="number-pad"
            />
          </Section>

          {/* إعدادات التشغيل في الخلفية */}
          <Section title="التشغيل في الخلفية">
            <Row label="المزامنة في الخلفية">
              <Toggle value={form.backgroundSyncEnabled} onChange={(v) => setForm((f) => ({ ...f, backgroundSyncEnabled: v }))} />
            </Row>
            <Row label="الإشعارات">
              <Toggle value={form.notificationsEnabled} onChange={(v) => setForm((f) => ({ ...f, notificationsEnabled: v }))} />
            </Row>
            <Pressable
              onPress={() => Linking.openSettings()}
              className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
            >
              <Battery size={16} color="#6b7280" />
              <Text className="text-sm font-medium text-foreground">تعطيل تحسين البطارية</Text>
            </Pressable>
          </Section>

          <Pressable
            className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary active:opacity-80 mb-3"
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Save size={18} color="#ffffff" />}
            <Text className="text-sm font-semibold text-primary-foreground">حفظ الإعدادات</Text>
          </Pressable>

          {/* حالة الجهاز والصلاحيات */}
          <View className="px-4 py-4 border border-border rounded-2xl bg-card mb-6 gap-3">
            <View className="flex-row items-center gap-3">
              <Smartphone size={20} color="#6b7280" />
              <Text className="text-sm font-semibold text-foreground">حالة الجهاز</Text>
            </View>
            {deviceState.deviceId ? (
              <>
                <Text className="text-xs text-muted-foreground">معرف الجهاز: {deviceState.deviceId.slice(0, 12)}...</Text>
                <Text className="text-xs text-muted-foreground">مسجل في: {deviceState.registeredAt ? formatDate(deviceState.registeredAt) : '—'}</Text>
              </>
            ) : (
              <Text className="text-xs text-muted-foreground">الجهاز غير مسجل بعد</Text>
            )}
            <Pressable
              className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              onPress={handleRegisterDevice}
              disabled={registering}
            >
              {registering ? <ActivityIndicator size="small" className="text-muted-foreground" /> : <Smartphone size={16} color="#6b7280" />}
              <Text className="text-sm font-medium text-foreground">{deviceState.deviceId ? 'إعادة تسجيل الجهاز' : 'تسجيل الجهاز'}</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              onPress={handleRequestSms}
            >
              <MessageSquare size={16} color="#6b7280" />
              <Text className="text-sm font-medium text-foreground">منح صلاحية SMS</Text>
            </Pressable>
            <Pressable
              className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-border active:opacity-70"
              onPress={handleRequestNotifications}
            >
              <Bell size={16} color="#6b7280" />
              <Text className="text-sm font-medium text-foreground">منح صلاحية الإشعارات</Text>
            </Pressable>
            {state.isSmsPermissionGranted === false && (
              <Text className="text-xs text-destructive">صلاحية قراءة SMS مطلوبة. يرجى تفعيلها من إعدادات التطبيق.</Text>
            )}
          </View>

          <Section title="الأدوات">
            <MenuRow icon={Activity} label="تشخيص الوكيل" onPress={() => router.push('/(app)/diagnostics' as any)} />
            <MenuRow icon={Shield} label="صلاحيات الوكيل" onPress={() => router.push('/(app)/permissions' as any)} />
            <MenuRow icon={Battery} label="تحسين البطارية" onPress={() => router.push('/(app)/battery' as any)} />
          </Section>

          <Pressable
            className="flex-row items-center justify-center gap-2 py-3.5 rounded-2xl border border-border active:opacity-70 mb-8"
            onPress={handleSignOut}
          >
            <LogOut size={18} color="#6b7280" />
            <Text className="text-sm font-medium text-foreground">تسجيل الخروج</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-6">
      <Text className="text-sm font-semibold text-foreground mb-3">{title}</Text>
      <View className="gap-3">{children}</View>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between px-1 py-2">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

function MenuRow({
  icon: Icon,
  label,
  onPress,
}: {
  icon: React.ElementType;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-1 py-3 active:opacity-70"
    >
      <View className="flex-row items-center gap-3">
        <Icon size={18} color="#6b7280" />
        <Text className="text-sm text-foreground">{label}</Text>
      </View>
      <ChevronLeft size={18} color="#9ca3af" />
    </Pressable>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 px-3 py-2 border border-border rounded-xl bg-background">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable className="w-12 h-7 rounded-full p-1" style={{ backgroundColor: value ? '#22c55e' : '#d1d5db' }} onPress={() => onChange(!value)}>
      <View className="w-5 h-5 rounded-full bg-white" style={{ transform: [{ translateX: value ? 20 : 0 }] }} />
    </Pressable>
  );
}

function InputField({ label, ...props }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; autoCapitalize?: 'none' | 'sentences'; secureTextEntry?: boolean; keyboardType?: 'default' | 'number-pad' | 'decimal-pad' }) {
  return (
    <View>
      <Text className="text-xs font-medium text-muted-foreground mb-2">{label}</Text>
      <TextInput
        className="border border-border rounded-xl bg-background px-4 py-3 text-sm text-foreground text-right"
        placeholderTextColor="#9ca3af"
        {...props}
      />
    </View>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'ONLINE':
      return '#22c55e';
    case 'OFFLINE':
      return '#ef4444';
    case 'CONNECTING':
    case 'SYNCING':
      return '#3b82f6';
    case 'ERROR':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ONLINE':
      return 'متصل';
    case 'OFFLINE':
      return 'غير متصل';
    case 'CONNECTING':
      return 'جاري الاتصال';
    case 'SYNCING':
      return 'جاري المزامنة';
    case 'ERROR':
      return 'خطأ';
    default:
      return '—';
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
