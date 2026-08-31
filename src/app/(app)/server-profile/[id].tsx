import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, Server } from 'lucide-react-native';

import { getServerProfileById, saveServerProfile, normalizeBaseUrl } from '@/services/serverProfileManager';
import { discoverApi } from '@/services/apiDiscovery';
import { sendBackendRequest, testConnection } from '@/services/backendConnector';
import { getLastBackendRequestMeta } from '@/services/backendConnector';
import { logEvent } from '@/lib/database';
import { loadSettings, saveSettings } from '@/services/agentSettings';
import type { ServerProfile, AuthType, BackendApiContract, ConnectionTestResult } from '@/types/backend';

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api_key', label: 'API Key' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'custom', label: 'Custom Headers' },
];

export default function ServerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isNew = id === 'new';

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [normalizedUrl, setNormalizedUrl] = useState('');
  const [authType, setAuthType] = useState<AuthType>('bearer');
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [customHeaders, setCustomHeaders] = useState('');
  const [discoveryUrl, setDiscoveryUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      const profile = await getServerProfileById(id);
      if (profile) {
        setName(profile.name);
        setBaseUrl(profile.baseUrl);
        setNormalizedUrl(normalizeBaseUrl(profile.baseUrl));
        setAuthType(profile.authType);
        setApiKey(profile.apiKey || '');
        setToken(profile.token || '');
        setUsername(profile.username || '');
        setPassword(profile.password || '');
        setCustomHeaders(profile.customHeaders ? JSON.stringify(profile.customHeaders, null, 2) : '');
        setDiscoveryUrl(profile.discoveryUrl || '');
      }
    })();
  }, [id]);

  useEffect(() => {
    setNormalizedUrl(normalizeBaseUrl(baseUrl));
  }, [baseUrl]);

  const buildProfile = useCallback((): ServerProfile => {
    const profile: ServerProfile = {
      id: isNew ? generateId() : id,
      name: name.trim() || 'خادم بدون اسم',
      baseUrl: normalizeBaseUrl(baseUrl.trim()),
      authType,
      isActive: true,
      isConnected: false,
      discoveryUrl: discoveryUrl.trim() || '/config',
      apiKey: apiKey || undefined,
      token: token || undefined,
      username: username || undefined,
      password: password || undefined,
      customHeaders: authType === 'custom' ? parseCustomHeaders(customHeaders) : undefined,
    };
    return profile;
  }, [id, isNew, name, baseUrl, authType, apiKey, token, username, password, customHeaders, discoveryUrl]);

  const handleTest = async () => {
    const profile = buildProfile();
    setLoading(true);
    setTestResult(null);
    try {
      let result = await testConnection(profile);
      if (result.ok) {
        const discovery = await discoverApi(profile, async (url, method = 'GET') => {
          const res = await sendBackendRequest(profile, { url, method });
          return res;
        });
        if (discovery.contract) {
          profile.apiContract = discovery.contract;
        }
      }
      setTestResult(result);
      await logEvent('server_profile_test', `Test ${profile.name}`, {
        ok: result.ok,
        status: result.status,
        endpoint: result.endpoint,
      });
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'خطأ غير متوقع' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const profile = buildProfile();
      if (!profile.apiContract) {
        // Try auto-discovery before save
        const discovery = await discoverApi(profile, async (url, method = 'GET') => {
          const res = await sendBackendRequest(profile, { url, method });
          return res;
        });
        if (discovery.contract) {
          profile.apiContract = discovery.contract;
        }
      }
      await saveServerProfile(profile);

      // Activate this profile if no other active
      const settings = await loadSettings();
      await saveSettings({ ...settings, activeServerProfileId: profile.id });

      await logEvent('server_profile_saved', `Saved ${profile.name}`, {
        id: profile.id,
        baseUrl: profile.baseUrl,
      });
      router.back();
    } catch (err) {
      await logEvent('server_profile_save_error', err instanceof Error ? err.message : 'unknown');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 py-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-row items-center gap-3 mb-2">
            <Pressable onPress={() => router.back()} className="p-2 -mr-2 active:opacity-70">
              <ArrowLeft size={24} className="text-foreground" />
            </Pressable>
            <Text className="text-2xl font-bold text-foreground">
              {isNew ? 'إضافة خادم' : 'تعديل خادم'}
            </Text>
          </View>

          <View className="border border-border rounded-2xl bg-card p-4 gap-4">
            <SectionTitle icon={Server} title="معلومات الخادم" />
            <Input label="الاسم" value={name} onChangeText={setName} placeholder="مثال: Nader Pay" />
            <Input label="Base URL" value={baseUrl} onChangeText={setBaseUrl} placeholder="https://ccimllgqdxuvymdeikmn.supabase.co/functions/v1/backend-proxy" autoCapitalize="none" />
            {baseUrl.trim() && baseUrl.trim() !== normalizedUrl && (
              <View className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                <Text className="text-xs text-amber-800">
                  سيتم إصلاح الرابط تلقائيًا إلى: {normalizedUrl}
                </Text>
              </View>
            )}
            <Input
              label="Discovery URL (اختياري — اتركه فارغاً)"
              value={discoveryUrl}
              onChangeText={setDiscoveryUrl}
              placeholder="/config"
              autoCapitalize="none"
            />
            <Text className="text-xs text-muted-foreground -mt-2">
              إذا تركت Discovery URL فارغاً، سيتم إرسال health check مباشرة إلى backend-proxy للتأكد من الاتصال.
            </Text>

            <Text className="text-sm font-semibold text-foreground mt-2">نوع المصادقة</Text>
            <View className="flex-row flex-wrap gap-2">
              {AUTH_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setAuthType(t.value)}
                  className={`px-4 py-2 rounded-full border ${authType === t.value ? 'bg-primary border-primary' : 'bg-card border-border'}`}
                >
                  <Text className={`text-sm font-medium ${authType === t.value ? 'text-primary-foreground' : 'text-foreground'}`}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {authType === 'bearer' && (
              <Input label="Token" value={token} onChangeText={setToken} placeholder="Bearer token" secure />
            )}
            {authType === 'api_key' && (
              <Input label="API Key" value={apiKey} onChangeText={setApiKey} placeholder="API key" secure />
            )}
            {authType === 'basic' && (
              <>
                <Input label="Username" value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
                <Input label="Password" value={password} onChangeText={setPassword} placeholder="Password" secure />
              </>
            )}
            {authType === 'custom' && (
              <>
                <Text className="text-xs text-muted-foreground">أدخل رؤوس HTTP بتنسيق JSON</Text>
                <TextInput
                  value={customHeaders}
                  onChangeText={setCustomHeaders}
                  multiline
                  className="border border-border rounded-xl bg-background p-3 text-foreground text-sm"
                  style={{ minHeight: 80, textAlignVertical: 'top' }}
                  placeholder='{"x-api-key": "..."}'
                  autoCapitalize="none"
                />
              </>
            )}
          </View>

          {testResult && (
            <View className="border border-border rounded-2xl bg-card p-4 gap-2">
              <Text className="text-sm font-semibold text-foreground">نتيجة الاختبار</Text>
              <Text className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                {testResult.ok ? 'نجح الاتصال' : testResult.error || 'فشل الاتصال'}
              </Text>
              {testResult.status !== undefined && (
                <Text className="text-xs text-muted-foreground">HTTP {testResult.status} {testResult.method}</Text>
              )}
              {testResult.endpoint && (
                <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                  {testResult.endpoint}
                </Text>
              )}
              {testResult.responseBody !== undefined && (
                <Text className="text-xs text-muted-foreground" numberOfLines={4}>
                  {JSON.stringify(testResult.responseBody)}
                </Text>
              )}
              {testResult.requestId && (
                <Text className="text-xs text-muted-foreground">Request ID: {testResult.requestId}</Text>
              )}
              {!testResult.ok && (
                <Text className="text-xs text-muted-foreground">
                  Auth: {testResult.authOk === false ? 'فشل المصادقة' : 'غير محدد'}
                </Text>
              )}
            </View>
          )}

          <View className="flex-row gap-3 pt-4">
            <Pressable
              onPress={handleTest}
              disabled={loading || !baseUrl}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 border border-border rounded-xl active:opacity-70"
            >
              {loading ? (
                <ActivityIndicator size="small" className="text-muted-foreground" />
              ) : (
                <Check size={18} className="text-foreground" />
              )}
              <Text className="text-sm font-semibold text-foreground">اختبار الاتصال</Text>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={saving || !baseUrl || !name}
              className="flex-1 flex-row items-center justify-center gap-2 py-3 bg-primary rounded-xl active:opacity-70"
            >
              {saving ? (
                <ActivityIndicator size="small" className="text-primary-foreground" />
              ) : (
                <Check size={18} className="text-primary-foreground" />
              )}
              <Text className="text-sm font-semibold text-primary-foreground">حفظ</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={18} className="text-foreground" />
      <Text className="text-base font-semibold text-foreground">{title}</Text>
    </View>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  autoCapitalize,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs text-muted-foreground">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        className="border border-border rounded-xl bg-background px-3 py-2.5 text-foreground text-sm"
        style={multiline ? { minHeight: 80, textAlignVertical: 'top' } : undefined}
      />
    </View>
  );
}

function parseCustomHeaders(text: string): Record<string, string> | undefined {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, string>;
  } catch {
    // ignore
  }
  return undefined;
}

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
