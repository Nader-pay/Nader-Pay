import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Search,
  XCircle,
} from 'lucide-react-native';

import { analyzeMessageForProvider, type TestLabResult } from '@/services/verificationTestLab';
import { searchDeviceMessages, type DeviceMessageMatch } from '@/services/deviceMessageSearch';
import { getVerifiedSourceForProvider } from '@/services/providerSourceService';
import { getParserInfo } from '@/services/providers';
import type { ProviderName } from '@/types/agent';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  vodafone_cash: 'Vodafone Cash',
  insta_pay: 'InstaPay / Banque Misr',
  orange_cash: 'Orange Cash',
  bank_transfer: 'تحويل بنكي',
  unknown: 'غير معروف',
};

const FIELD_LABELS: Record<string, string> = {
  transactionId:            'رقم العملية',
  transactionType:          'نوع المعاملة',
  amount:                   'المبلغ',
  currency:                 'العملة',
  senderPhone:              'رقم المُرسِل',
  senderName:               'اسم المُرسِل',
  recipientWallet:          'محفظة المستلم',
  recipientAccount:         'حساب المستلم',
  balanceAfterTransaction:  'الرصيد بعد العملية',
  transactionDate:          'تاريخ العملية',
  transferMethod:           'طريقة التحويل',
  occurredAt:               'وقت العملية',
  parserId:                 'Parser ID',
  parserVersion:            'إصدار الـ Parser',
};

function parseProvider(raw: string | undefined): ProviderName {
  const valid: ProviderName[] = ['vodafone_cash', 'insta_pay', 'orange_cash', 'bank_transfer'];
  return valid.includes(raw as ProviderName) ? (raw as ProviderName) : 'vodafone_cash';
}

export default function TestLabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { provider: rawProvider } = useLocalSearchParams<{ provider?: string }>();
  const provider = parseProvider(rawProvider);
  const parserInfo = getParserInfo(provider);

  const [message, setMessage] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<TestLabResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [deviceMatches, setDeviceMatches] = useState<DeviceMessageMatch[] | null>(null);
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!message.trim()) return;
    setAnalyzing(true);
    setResult(null);
    setDeviceMatches(null);
    try {
      const src = await getVerifiedSourceForProvider(provider);
      const res = analyzeMessageForProvider(message.trim(), provider, src?.sourceId ?? null);
      setResult(res);
    } finally {
      setAnalyzing(false);
    }
  }, [message, provider]);

  const handleSearchDevice = useCallback(async () => {
    if (!result?.valid || !result.extractedFields) return;
    setSearching(true);
    setDeviceMatches(null);
    try {
      const { parseMessageWithProvider } = await import('@/services/providers');
      const parsed = parseMessageWithProvider(message.trim(), provider);
      if (!parsed) { setDeviceMatches([]); return; }
      const matches = await searchDeviceMessages({ provider, parsed, maxMessages: 300 });
      setDeviceMatches(matches);
    } finally {
      setSearching(false);
    }
  }, [result, message, provider]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />

      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 py-4 border-b border-border">
        <Pressable
          onPress={() => router.back()}
          className="w-9 h-9 items-center justify-center rounded-full bg-muted active:opacity-70"
        >
          <ArrowLeft size={18} color="#374151" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground">اختبار المصدر</Text>
          <Text className="text-xs text-muted-foreground">{PROVIDER_LABELS[provider]}</Text>
        </View>
        <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted">
          <FlaskConical size={13} color="#6b7280" />
          <Text className="text-xs text-muted-foreground">
            {parserInfo?.parserVersion ?? '—'}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1 px-5"
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {/* Parser info */}
          <View className="mt-5 mb-4 px-4 py-3 rounded-xl bg-muted border border-border gap-1.5">
            <Row label="Parser ID" value={parserInfo?.parserId ?? '—'} mono />
            <Row label="الإصدار" value={parserInfo?.parserVersion ?? '—'} />
            <Row label="Provider" value={PROVIDER_LABELS[provider]} />
          </View>

          {/* Message input */}
          <Text className="text-sm font-semibold text-foreground mb-2">الصق رسالة حقيقية</Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            placeholder={
              provider === 'vodafone_cash'
                ? 'تم استلام مبلغ 400 جنيه من رقم 01030951228...'
                : 'تم اضافة مبلغ 300EGP الى حساب رقم xxx4449...'
            }
            placeholderTextColor="#9ca3af"
            textAlignVertical="top"
            className="border border-border rounded-xl p-4 text-sm text-foreground bg-card leading-6"
            style={{ minHeight: 120 }}
          />

          <Pressable
            onPress={handleAnalyze}
            disabled={!message.trim() || analyzing}
            className="mt-3 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70 disabled:opacity-40"
          >
            {analyzing
              ? <ActivityIndicator size={16} color="#ffffff" />
              : <FlaskConical size={16} color="#ffffff" />}
            <Text className="text-sm font-semibold text-primary-foreground">تحليل الرسالة</Text>
          </Pressable>

          {/* نتيجة التحليل */}
          {result && (
            <View className="mt-5 gap-3">
              {/* حالة الرسالة */}
              <View
                className={`flex-row items-center gap-2.5 px-4 py-3 rounded-xl border ${
                  result.valid
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                {result.valid
                  ? <CheckCircle2 size={20} color="#16a34a" />
                  : <XCircle size={20} color="#dc2626" />}
                <View className="flex-1">
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: result.valid ? '#15803d' : '#b91c1c' }}
                  >
                    {result.valid ? 'رسالة صالحة لهذا الـ Provider' : 'رسالة غير صالحة'}
                  </Text>
                  {result.transactionType && (
                    <Text className="text-xs" style={{ color: result.valid ? '#16a34a' : '#dc2626' }}>
                      {result.transactionType === 'incoming_payment' ? 'استلام أموال' : result.transactionType}
                    </Text>
                  )}
                </View>
              </View>

              {/* سبب الرفض */}
              {!result.valid && result.rejectionReason && (
                <View className="px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                  <Text className="text-xs font-semibold text-red-700 mb-1">سبب الرفض</Text>
                  <Text className="text-sm text-red-700 leading-5">{result.rejectionReason}</Text>
                </View>
              )}

              {/* الحقول المستخرجة */}
              {result.valid && Object.keys(result.extractedFields).length > 0 && (
                <View className="px-4 py-4 rounded-xl border border-border bg-card gap-2">
                  <Text className="text-sm font-semibold text-foreground mb-1">الحقول المستخرجة</Text>
                  {Object.entries(result.extractedFields).map(([k, v]) => (
                    <Row
                      key={k}
                      label={FIELD_LABELS[k] ?? k}
                      value={String(v)}
                      mono={['transactionId', 'parserId', 'recipientWallet', 'recipientAccount', 'senderPhone'].includes(k)}
                      success
                    />
                  ))}
                  {/* Source */}
                  {result.sourceIdentifier && (
                    <Row label="المصدر المستخدم" value={result.sourceIdentifier} mono />
                  )}
                </View>
              )}

              {/* الحقول المفقودة */}
              {result.missingFields.length > 0 && (
                <View className="px-4 py-4 rounded-xl border border-border bg-card gap-2">
                  <Text className="text-sm font-semibold text-muted-foreground mb-1">
                    الحقول غير المتوفرة في هذه الرسالة
                  </Text>
                  {result.missingFields.map((f) => (
                    <View key={f} className="flex-row items-center gap-2">
                      <View className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                      <Text className="text-xs text-muted-foreground">
                        {FIELD_LABELS[f] ?? f}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* زر البحث في الهاتف */}
              {result.valid && (
                <Pressable
                  onPress={handleSearchDevice}
                  disabled={searching}
                  className="flex-row items-center justify-center gap-2 py-3 rounded-xl border border-primary active:opacity-70 disabled:opacity-40"
                >
                  {searching
                    ? <ActivityIndicator size={15} color="#1d4ed8" />
                    : <Search size={15} color="#1d4ed8" />}
                  <Text className="text-sm font-semibold text-primary">البحث في رسائل الهاتف</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* نتائج البحث في الهاتف */}
          {deviceMatches !== null && (
            <View className="mt-4 gap-3 pb-10">
              <Text className="text-sm font-semibold text-foreground">
                {deviceMatches.length === 0
                  ? 'لم يُعثر على رسائل مطابقة في الهاتف'
                  : `وُجد ${deviceMatches.length} رسالة مطابقة`}
              </Text>
              {deviceMatches.map((m, i) => (
                <View key={i} className="border border-border rounded-xl bg-card overflow-hidden">
                  {/* رأس النتيجة */}
                  <Pressable
                    onPress={() => setExpandedMatch(expandedMatch === i ? null : i)}
                    className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
                  >
                    <View className="flex-row items-center gap-2 flex-1">
                      <MatchBadge strength={m.matchStrength} />
                      <Text className="text-xs font-medium text-foreground flex-1" numberOfLines={1}>
                        {m.sender}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1">
                      <Text className="text-xs text-muted-foreground">{formatDate(m.receivedAt)}</Text>
                      {expandedMatch === i
                        ? <ChevronUp size={14} color="#9ca3af" />
                        : <ChevronDown size={14} color="#9ca3af" />}
                    </View>
                  </Pressable>

                  {/* تفاصيل التطابق */}
                  {expandedMatch === i && (
                    <View className="px-4 pb-4 gap-3 border-t border-border">
                      {/* أسباب التطابق */}
                      <View className="flex-row flex-wrap gap-1.5 mt-3">
                        {m.matchReasons.map((r, j) => (
                          <View key={j} className="px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
                            <Text className="text-xs text-green-700">{r}</Text>
                          </View>
                        ))}
                      </View>
                      {/* الرسالة الأصلية كاملة */}
                      <View className="mt-1">
                        <Text className="text-xs font-semibold text-muted-foreground mb-1.5">الرسالة الأصلية</Text>
                        <View className="p-3 rounded-lg bg-muted border border-border">
                          <Text className="text-xs text-foreground leading-5 font-mono">
                            {m.originalBody}
                          </Text>
                        </View>
                      </View>
                      {/* بيانات العملية */}
                      <View className="gap-1.5 mt-1">
                        <Row label="المبلغ" value={`${m.parsedTransaction.amount} ${m.parsedTransaction.currency}`} success />
                        {m.parsedTransaction.senderPhone && (
                          <Row label="رقم المُرسِل" value={m.parsedTransaction.senderPhone} mono />
                        )}
                        {m.parsedTransaction.senderName && (
                          <Row label="اسم المُرسِل" value={m.parsedTransaction.senderName} />
                        )}
                        {m.parsedTransaction.recipientAccount && (
                          <Row label="الحساب المستلم" value={m.parsedTransaction.recipientAccount} mono />
                        )}
                        {m.parsedTransaction.recipientWallet && (
                          <Row label="المحفظة" value={m.parsedTransaction.recipientWallet} mono />
                        )}
                        <Row label="وقت الاستلام" value={formatDate(m.receivedAt)} />
                        {m.parsedTransaction.occurredAt && (
                          <Row label="وقت العملية" value={formatDate(m.parsedTransaction.occurredAt)} />
                        )}
                      </View>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── مكونات مساعدة ─────────────────────────────────────────────────────────

function Row({
  label, value, mono, success,
}: {
  label: string; value: string; mono?: boolean; success?: boolean;
}) {
  return (
    <View className="flex-row items-start justify-between py-1 border-b border-border/40 last:border-b-0">
      <Text className="text-xs text-muted-foreground flex-shrink-0 mr-3">{label}</Text>
      <Text
        className={`text-xs font-medium text-right flex-1 ${mono ? 'font-mono' : ''}`}
        style={{ color: success ? '#15803d' : '#111827' }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function MatchBadge({ strength }: { strength: 'exact' | 'strong' | 'partial' }) {
  const cfg = {
    exact:   { label: 'تطابق تام', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    strong:  { label: 'قوي',       color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    partial: { label: 'جزئي',      color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  }[strength];
  return (
    <View
      className="px-2 py-0.5 rounded-full border"
      style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}
    >
      <Text className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return iso; }
}
