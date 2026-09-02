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
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Hash,
  Phone,
  Search,
  XCircle,
} from 'lucide-react-native';

import {
  analyzeMessageForProvider,
  enrichTestLabResult,
  searchByTxIdInDevice,
  searchByPhoneInDevice,
  type TestLabResult,
  type TxIdLabResult,
  type PhoneLabResult,
} from '@/services/verificationTestLab';
import type { BalanceEvidence, BalanceDiagnosticInfo } from '@/services/balanceBeforeEnricher';
import { searchDeviceMessages, type DeviceMessageMatch } from '@/services/deviceMessageSearch';
import { getVerifiedSourceForProvider } from '@/services/providerSourceService';
import { getParserInfo } from '@/services/providers';
import type { ProviderName } from '@/types/agent';

// ─── ثوابت ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<ProviderName, string> = {
  vodafone_cash: 'Vodafone Cash',
  insta_pay: 'InstaPay / Banque Misr',
  orange_cash: 'Orange Cash',
  bank_transfer: 'تحويل بنكي',
  unknown: 'غير معروف',
};

const FIELD_LABELS: Record<string, string> = {
  transactionId:           'رقم العملية',
  transactionType:         'نوع المعاملة',
  amount:                  'المبلغ',
  currency:                'العملة',
  senderPhone:             'رقم المُرسِل',
  senderName:              'اسم المُرسِل',
  recipientWallet:         'محفظة المستلم',
  recipientAccount:        'حساب المستلم',
  balanceAfterTransaction: 'الرصيد بعد العملية',
  transactionDate:         'تاريخ العملية',
  transferMethod:          'طريقة التحويل',
  occurredAt:              'وقت العملية',
  parserId:                'Parser ID',
  parserVersion:           'إصدار الـ Parser',
};

type SearchMode = 'message' | 'txid' | 'phone';

function parseProvider(raw: string | undefined): ProviderName {
  const valid: ProviderName[] = ['vodafone_cash', 'insta_pay', 'orange_cash', 'bank_transfer'];
  return valid.includes(raw as ProviderName) ? (raw as ProviderName) : 'vodafone_cash';
}

// ─── الشاشة الرئيسية ─────────────────────────────────────────────────────────

export default function TestLabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { provider: rawProvider } = useLocalSearchParams<{ provider?: string }>();
  const provider = parseProvider(rawProvider);
  const parserInfo = getParserInfo(provider);

  // وضع البحث الحالي
  const [mode, setMode] = useState<SearchMode>('message');

  // حالة وضع الرسالة الكاملة
  const [message, setMessage] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<TestLabResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [deviceMatches, setDeviceMatches] = useState<DeviceMessageMatch[] | null>(null);
  const [expandedMatch, setExpandedMatch] = useState<number | null>(null);

  // حالة وضع رقم العملية
  const [txId, setTxId] = useState('');
  const [txSearching, setTxSearching] = useState(false);
  const [txResult, setTxResult] = useState<TxIdLabResult | null>(null);

  // حالة وضع رقم الهاتف
  const [phone, setPhone] = useState('');
  const [phoneSearching, setPhoneSearching] = useState(false);
  const [phoneResult, setPhoneResult] = useState<PhoneLabResult | null>(null);
  const [expandedPhoneMatch, setExpandedPhoneMatch] = useState<number | null>(null);

  // ── وضع 1: تحليل رسالة كاملة ─────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!message.trim()) return;
    setAnalyzing(true);
    setResult(null);
    setDeviceMatches(null);
    try {
      const src = await getVerifiedSourceForProvider(provider);
      const raw = analyzeMessageForProvider(message.trim(), provider, src?.sourceId ?? null);
      // نمرر null كـ messageReceivedAt حتى يستخدم enrichTestLabResult
      // الـ occurredAt المستخرج من نص الرسالة كمرجع زمني صحيح.
      // استخدام new Date() هنا خطأ جذري — يجعل النظام يبحث عن رسائل
      // سابقة لـ "الآن" بدلاً من سابقة لوقت العملية الفعلي.
      const enriched = await enrichTestLabResult(
        raw,
        src?.sourceId ?? null,
        null,   // currentMessageId — غير متاح لرسالة يدوية
        null    // messageReceivedAt — null → fallback لـ occurredAt من نص الرسالة
      );
      setResult(enriched);
    } finally {
      setAnalyzing(false);
    }
  }, [message, provider]);

  const handleSearchDevice = useCallback(async () => {
    if (!result?.valid || !result.extractedFields) return;
    setSearching(true);
    setDeviceMatches(null);
    try {
      const src = await getVerifiedSourceForProvider(provider);
      const { parseMessageWithProvider } = await import('@/services/providers');
      const parsed = parseMessageWithProvider(message.trim(), provider);
      if (!parsed) { setDeviceMatches([]); return; }
      const matches = await searchDeviceMessages({
        provider,
        parsed,
        trustedSourceId: src?.sourceId ?? null,
        maxMessages: 300,
      });
      setDeviceMatches(matches);
    } finally {
      setSearching(false);
    }
  }, [result, message, provider]);

  // ── وضع 2: البحث برقم العملية ─────────────────────────────────────────────

  const handleSearchTxId = useCallback(async () => {
    if (!txId.trim()) return;
    setTxSearching(true);
    setTxResult(null);
    try {
      const src = await getVerifiedSourceForProvider(provider);
      const res = await searchByTxIdInDevice(txId.trim(), provider, src?.sourceId ?? null);
      setTxResult(res);
    } finally {
      setTxSearching(false);
    }
  }, [txId, provider]);

  // ── وضع 3: البحث برقم الهاتف ──────────────────────────────────────────────

  const handleSearchPhone = useCallback(async () => {
    if (!phone.trim()) return;
    setPhoneSearching(true);
    setPhoneResult(null);
    setExpandedPhoneMatch(null);
    try {
      const src = await getVerifiedSourceForProvider(provider);
      const res = await searchByPhoneInDevice(phone.trim(), provider, src?.sourceId ?? null);
      setPhoneResult(res);
    } finally {
      setPhoneSearching(false);
    }
  }, [phone, provider]);

  // ─── Reset عند تغيير الوضع ────────────────────────────────────────────────

  const switchMode = useCallback((newMode: SearchMode) => {
    setMode(newMode);
    setResult(null); setDeviceMatches(null);
    setTxResult(null);
    setPhoneResult(null); setExpandedPhoneMatch(null);
  }, []);

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
          <Text className="text-xs text-muted-foreground">{parserInfo?.parserVersion ?? '—'}</Text>
        </View>
      </View>

      {/* Tabs الثلاثة */}
      <View className="flex-row gap-1 px-4 py-3 border-b border-border">
        <ModeTab label="رسالة" icon="msg" active={mode === 'message'} onPress={() => switchMode('message')} />
        <ModeTab label="رقم العملية" icon="hash" active={mode === 'txid'} onPress={() => switchMode('txid')} />
        <ModeTab label="رقم الهاتف" icon="phone" active={mode === 'phone'} onPress={() => switchMode('phone')} />
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

          {/* ── وضع 1: رسالة كاملة ─────────────────────────────────────────── */}
          {mode === 'message' && (
            <>
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

              {result && (
                <View className="mt-5 gap-3">
                  <AnalysisResultCard result={result} />
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

              {deviceMatches !== null && (
                <View className="mt-4 gap-3 pb-10">
                  <Text className="text-sm font-semibold text-foreground">
                    {deviceMatches.length === 0
                      ? 'لم يُعثر على رسائل مطابقة في الهاتف'
                      : `وُجد ${deviceMatches.length} رسالة مطابقة`}
                  </Text>
                  {deviceMatches.map((m, i) => (
                    <DeviceMatchCard
                      key={i}
                      match={m}
                      index={i}
                      expanded={expandedMatch === i}
                      onToggle={() => setExpandedMatch(expandedMatch === i ? null : i)}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── وضع 2: رقم العملية ─────────────────────────────────────────── */}
          {mode === 'txid' && (
            <>
              <Text className="text-sm font-semibold text-foreground mb-2">رقم العملية</Text>
              <TextInput
                value={txId}
                onChangeText={setTxId}
                placeholder="مثال: 022896233255"
                placeholderTextColor="#9ca3af"
                keyboardType="numeric"
                className="border border-border rounded-xl px-4 py-3.5 text-sm text-foreground bg-card"
              />
              <Pressable
                onPress={handleSearchTxId}
                disabled={!txId.trim() || txSearching}
                className="mt-3 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70 disabled:opacity-40"
              >
                {txSearching
                  ? <ActivityIndicator size={16} color="#ffffff" />
                  : <Hash size={16} color="#ffffff" />}
                <Text className="text-sm font-semibold text-primary-foreground">
                  بحث برقم العملية
                </Text>
              </Pressable>

              {txResult && (
                <View className="mt-5 gap-3 pb-10">
                  <TxIdResultCard result={txResult} />
                  {txResult.found && txResult.match && (
                    <AnalysisResultCard result={txResult.match} />
                  )}
                </View>
              )}
            </>
          )}

          {/* ── وضع 3: رقم الهاتف ──────────────────────────────────────────── */}
          {mode === 'phone' && (
            <>
              <Text className="text-sm font-semibold text-foreground mb-2">رقم هاتف المُرسِل</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="مثال: 01030951228"
                placeholderTextColor="#9ca3af"
                keyboardType="phone-pad"
                className="border border-border rounded-xl px-4 py-3.5 text-sm text-foreground bg-card"
              />
              <Pressable
                onPress={handleSearchPhone}
                disabled={!phone.trim() || phoneSearching}
                className="mt-3 flex-row items-center justify-center gap-2 py-3 rounded-xl bg-primary active:opacity-70 disabled:opacity-40"
              >
                {phoneSearching
                  ? <ActivityIndicator size={16} color="#ffffff" />
                  : <Phone size={16} color="#ffffff" />}
                <Text className="text-sm font-semibold text-primary-foreground">
                  بحث برقم الهاتف
                </Text>
              </Pressable>

              {phoneResult && (
                <View className="mt-5 gap-3 pb-10">
                  <PhoneResultBanner result={phoneResult} />
                  {phoneResult.found && phoneResult.matches.map((m, i) => (
                    <View key={i} className="border border-border rounded-xl bg-card overflow-hidden">
                      <Pressable
                        onPress={() => setExpandedPhoneMatch(expandedPhoneMatch === i ? null : i)}
                        className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
                      >
                        <Text className="text-sm font-medium text-foreground">
                          {`عملية ${i + 1}`}
                          {m.extractedFields.amount != null
                            ? ` — ${String(m.extractedFields.amount)} جنيه`
                            : ''}
                        </Text>
                        {expandedPhoneMatch === i
                          ? <ChevronUp size={14} color="#9ca3af" />
                          : <ChevronDown size={14} color="#9ca3af" />}
                      </Pressable>
                      {expandedPhoneMatch === i && (
                        <View className="border-t border-border px-4 pb-4">
                          <AnalysisResultCard result={m} compact />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── مكونات مساعدة ───────────────────────────────────────────────────────────

function ModeTab({
  label, active, onPress, icon,
}: {
  label: string; active: boolean; onPress: () => void; icon: 'msg' | 'hash' | 'phone';
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-lg active:opacity-70 ${
        active ? 'bg-primary' : 'bg-muted'
      }`}
    >
      {icon === 'msg'   && <FlaskConical size={13} color={active ? '#ffffff' : '#6b7280'} />}
      {icon === 'hash'  && <Hash size={13} color={active ? '#ffffff' : '#6b7280'} />}
      {icon === 'phone' && <Phone size={13} color={active ? '#ffffff' : '#6b7280'} />}
      <Text className={`text-xs font-semibold ${active ? 'text-primary-foreground' : 'text-muted-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function AnalysisResultCard({ result, compact }: { result: TestLabResult; compact?: boolean }) {  return (
    <View className={`gap-3 ${compact ? 'mt-3' : ''}`}>
      {/* حالة الرسالة */}
      <View
        className={`flex-row items-center gap-2.5 px-4 py-3 rounded-xl border ${
          result.valid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
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

      {/* الرصيد قبل + بعد + Balance Evidence */}
      {result.valid && (result.balanceBefore !== null || result.balanceAfter !== null || result.amount !== null) && (
        <View className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 gap-2">
          <Text className="text-xs font-semibold text-blue-800 mb-0.5">الرصيد والتحقق</Text>

          {/* Amount */}
          {result.amount !== null && (
            <Row label="المبلغ" value={`${result.amount.toFixed(2)} جنيه`} />
          )}

          {/* Balance Before */}
          {result.balanceBefore !== null ? (
            <Row label="الرصيد قبل العملية" value={`${result.balanceBefore.toFixed(2)} جنيه`} success />
          ) : (
            <View className="flex-row items-start justify-between py-1 border-b border-blue-200/60">
              <Text className="text-xs text-blue-700">الرصيد قبل العملية</Text>
              <Text className="text-xs text-muted-foreground italic">لا يوجد دليل سابق موثوق</Text>
            </View>
          )}

          {/* Balance After */}
          {result.balanceAfter !== null && (
            <Row label="الرصيد بعد العملية" value={`${result.balanceAfter.toFixed(2)} جنيه`} success />
          )}

          {/* Balance Flow Validation */}
          {result.balanceBefore !== null && result.balanceAfter !== null && result.amount !== null && (
            <View className="mt-1 pt-1 border-t border-blue-200/60">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-blue-700">
                  {`${result.balanceBefore.toFixed(2)} + ${result.amount.toFixed(2)} = ${(result.balanceBefore + result.amount).toFixed(2)}`}
                </Text>
                <FlowBadge validation={result.flowValidation} />
              </View>
            </View>
          )}

          {/* Balance Evidence Details */}
          {result.balanceEvidence && (
            <View className="mt-2 pt-2 border-t border-blue-200/60 gap-1.5">
              <Text className="text-xs font-semibold text-blue-800">دليل الرصيد السابق</Text>
              {/* نص مقتطف الرصيد */}
              <View className="p-2.5 rounded-lg bg-white/70 border border-blue-200">
                <Text className="text-xs text-blue-900 leading-5 italic">
                  {`"${result.balanceEvidence.balanceEvidenceText}"`}
                </Text>
              </View>
              <Row label="وقت الرسالة" value={formatDate(result.balanceEvidence.sourceMessageReceivedAt)} />
              <Row label="المُرسِل" value={result.balanceEvidence.sourceSender} mono />
              <Row
                label="نوع الرسالة"
                value={
                  result.balanceEvidence.balanceEvidenceType === 'incoming_payment' ? 'استلام أموال' :
                  result.balanceEvidence.balanceEvidenceType === 'outgoing_payment' ? 'إرسال أموال' :
                  result.balanceEvidence.balanceEvidenceType === 'recharge' ? 'شحن رصيد' :
                  result.balanceEvidence.balanceEvidenceType === 'balance_update' ? 'تحديث رصيد (BALANCE_UPDATE)' :
                  'رسالة مالية'
                }
              />
              {/* سبب الاختيار بنص عربي احترافي */}
              <View className="flex-row items-start justify-between py-1 border-b border-blue-200/60">
                <Text className="text-xs text-blue-700 flex-shrink-0 ml-2">سبب الاختيار</Text>
                <Text className="text-xs text-blue-900 text-right flex-1 leading-4 font-medium">
                  {`أقرب رسالة صالحة قبل العملية (${formatDistance(result.balanceEvidence.distanceSeconds)} فارق زمني)`}
                </Text>
              </View>
              {/* [spec §4] distance = transactionReceivedAt - evidenceReceivedAt */}
              <Row
                label="المسافة الزمنية"
                value={formatDistance(result.balanceEvidence.distanceSeconds)}
              />
              {/* ID رسالة الدليل — للتحقق التقني */}
              <Row label="ID رسالة الدليل" value={result.balanceEvidence.sourceMessageId} mono />

              {/* [spec §11] Debug Panel — قابل للطي، يفصل Internal Codes */}
              <DebugPanel evidence={result.balanceEvidence} diagnosticInfo={result.diagnosticInfo} />
            </View>
          )}

          {/* لا يوجد دليل سابق — قسم مستقل احترافي */}
          {result.valid && result.balanceBefore === null && result.balanceAfter !== null && (
            <View className="mt-2 pt-2 border-t border-blue-200/60 gap-1.5">
              <View className="flex-row items-center gap-1.5">
                <AlertCircle size={13} color="#b45309" />
                <Text className="text-xs font-semibold text-amber-700">الرصيد قبل العملية</Text>
              </View>
              {/* السبب العربي الاحترافي */}
              <View className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                <Text className="text-xs text-amber-800 leading-5">
                  {result.noEvidenceReason ?? 'لم يُعثر على رسالة سابقة تحتوي رصيداً صالحاً للتحقق'}
                </Text>
              </View>
              {/* إحصائيات البحث التشخيصية */}
              {result.diagnosticInfo && (
                <View className="gap-1 mt-0.5">
                  <Row
                    label="رسائل قُرئت"
                    value={String(result.diagnosticInfo.totalMessagesRead)}
                  />
                  <Row
                    label="سابقة للعملية"
                    value={String(result.diagnosticInfo.messagesBeforeTransaction)}
                  />
                  <Row
                    label="مرفوضة"
                    value={String(result.diagnosticInfo.rejectedCount)}
                  />
                  {/* أسباب الرفض تأتي من evidence.rejectedCandidates (BalanceEvidence) لا من diagnosticInfo */}
                </View>
              )}
            </View>
          )}
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
              <Text className="text-xs text-muted-foreground">{FIELD_LABELS[f] ?? f}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── DebugPanel — قسم تشخيصي قابل للطي يفصل الـ Internal Codes ──────────────

function DebugPanel({
  evidence,
  diagnosticInfo,
}: {
  evidence: BalanceEvidence;
  diagnosticInfo: BalanceDiagnosticInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const rejected = evidence.rejectedCandidates ?? [];

  // ترجمة سبب الاختيار من كود داخلي إلى نص عربي
  const reasonArabic = evidence.reason.startsWith('NEAREST_PREVIOUS_VALID_BALANCE')
    ? `أقرب رسالة مالية سابقة صالحة (${formatDistance(evidence.distanceSeconds)} قبل العملية)`
    : evidence.reason;

  return (
    <View className="mt-1.5">
      {/* سبب الاختيار — نص عربي واضح */}
      <View className="flex-row items-start justify-between py-1">
        <Text className="text-xs text-blue-700 flex-shrink-0 ml-2">سبب الاختيار</Text>
        <Text className="text-xs text-blue-900 text-right flex-1 leading-4">{reasonArabic}</Text>
      </View>

      {/* زر فتح/إغلاق Debug */}
      <Pressable
        onPress={() => setOpen(!open)}
        className="flex-row items-center gap-1.5 mt-1.5 py-1.5 px-2.5 rounded-lg bg-blue-100/60 active:opacity-70"
      >
        {open ? <ChevronUp size={12} color="#1d4ed8" /> : <ChevronDown size={12} color="#1d4ed8" />}
        <Text className="text-xs font-semibold text-blue-700">
          {open ? 'إخفاء تفاصيل التشخيص' : `تفاصيل تقنية (${rejected.length} مرفوض)`}
        </Text>
      </Pressable>

      {open && (
        <View className="mt-2 gap-2">
          {/* diagnosticInfo */}
          {diagnosticInfo && (
            <View className="p-2.5 rounded-lg bg-white/50 border border-blue-200 gap-1">
              <Text className="text-xs font-semibold text-blue-800 mb-0.5">إحصائيات البحث</Text>
              <Text className="text-xs text-blue-900 font-mono leading-5">
                {`رسائل مقروءة: ${diagnosticInfo.totalMessagesRead}`}
              </Text>
              <Text className="text-xs text-blue-900 font-mono leading-5">
                {`سابقة للعملية: ${diagnosticInfo.messagesBeforeTransaction} · لاحقة: ${diagnosticInfo.messagesAfterOrSame}`}
              </Text>
              <Text className="text-xs text-blue-900 font-mono leading-5">
                {`مرشحون صالحون: ${diagnosticInfo.validCandidatesCount} · مرفوضون: ${diagnosticInfo.rejectedCount}`}
              </Text>
              <Text className="text-xs text-blue-900 font-mono leading-5">
                {`المرجع: ${diagnosticInfo.referenceSource === 'messageReceivedAt' ? 'وقت استلام الرسالة' : 'وقت العملية المستخرج'}`}
              </Text>
            </View>
          )}

          {/* المرشحون المرفوضون — Internal Codes في قسم منفصل */}
          {rejected.length > 0 && (
            <View className="p-2.5 rounded-lg bg-white/50 border border-blue-200">
              <Text className="text-xs font-semibold text-blue-800 mb-1.5">
                {`رسائل مرفوضة كـ Evidence (${rejected.length})`}
              </Text>
              {rejected.slice(0, 8).map((rc, i) => (
                <View key={i} className="flex-row items-start py-0.5 gap-1.5">
                  <Text className="text-xs text-red-500 font-mono shrink-0">✗</Text>
                  <View className="flex-1">
                    {rc.ts != null && (
                      <Text className="text-xs text-blue-800 font-mono leading-4">
                        {formatDate(new Date(rc.ts).toISOString())}
                        {rc.balance != null ? ` — ${rc.balance.toFixed(2)} جنيه` : ''}
                      </Text>
                    )}
                    <Text className="text-xs text-red-700 leading-4 font-mono">{rc.reason}</Text>
                  </View>
                </View>
              ))}
              {rejected.length > 8 && (
                <Text className="text-xs text-muted-foreground italic mt-1">
                  {`... و${rejected.length - 8} رسالة مرفوضة أخرى`}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function TxIdResultCard({ result }: { result: TxIdLabResult }) {
  const success = result.found;
  return (
    <View
      className={`flex-row items-center gap-2.5 px-4 py-3 rounded-xl border ${
        success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}
    >
      {success
        ? <CheckCircle2 size={20} color="#16a34a" />
        : <XCircle size={20} color="#dc2626" />}
      <View className="flex-1">
        <Text
          className="text-sm font-semibold"
          style={{ color: success ? '#15803d' : '#b91c1c' }}
        >
          {success ? 'وُجدت الرسالة في الهاتف' : 'لم يُعثر على رقم العملية'}
        </Text>
        <Text className="text-xs" style={{ color: success ? '#16a34a' : '#dc2626' }}>
          {result.reason}
        </Text>
      </View>
    </View>
  );
}

function PhoneResultBanner({ result }: { result: PhoneLabResult }) {
  const success = result.found;
  return (
    <View
      className={`flex-row items-center gap-2.5 px-4 py-3 rounded-xl border ${
        success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}
    >
      {success
        ? <CheckCircle2 size={20} color="#16a34a" />
        : <XCircle size={20} color="#dc2626" />}
      <View className="flex-1">
        <Text
          className="text-sm font-semibold"
          style={{ color: success ? '#15803d' : '#b91c1c' }}
        >
          {success ? `${result.matches.length} عملية من ${result.senderPhone}` : 'لم يُعثر على رسائل'}
        </Text>
        <Text className="text-xs" style={{ color: success ? '#16a34a' : '#dc2626' }}>
          {result.reason}
        </Text>
      </View>
    </View>
  );
}

function DeviceMatchCard({
  match, index, expanded, onToggle,
}: {
  match: DeviceMessageMatch; index: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <View className="border border-border rounded-xl bg-card overflow-hidden">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
      >
        <View className="flex-row items-center gap-2 flex-1">
          <MatchBadge strength={match.matchStrength} />
          <Text className="text-xs font-medium text-foreground flex-1" numberOfLines={1}>
            {match.sender}
          </Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{formatDate(match.receivedAt)}</Text>
          {expanded
            ? <ChevronUp size={14} color="#9ca3af" />
            : <ChevronDown size={14} color="#9ca3af" />}
        </View>
      </Pressable>

      {expanded && (
        <View className="px-4 pb-4 gap-3 border-t border-border">
          <View className="flex-row flex-wrap gap-1.5 mt-3">
            {match.matchReasons.map((r, j) => (
              <View key={j} className="px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
                <Text className="text-xs text-green-700">{r}</Text>
              </View>
            ))}
          </View>
          <View className="mt-1">
            <Text className="text-xs font-semibold text-muted-foreground mb-1.5">الرسالة الأصلية</Text>
            <View className="p-3 rounded-lg bg-muted border border-border">
              <Text className="text-xs text-foreground leading-5">{match.originalBody}</Text>
            </View>
          </View>
          <View className="gap-1.5 mt-1">
            <Row label="المبلغ" value={`${match.parsedTransaction.amount} ${match.parsedTransaction.currency}`} success />
            {match.parsedTransaction.senderPhone && (
              <Row label="رقم المُرسِل" value={match.parsedTransaction.senderPhone} mono />
            )}
            {match.parsedTransaction.senderName && (
              <Row label="اسم المُرسِل" value={match.parsedTransaction.senderName} />
            )}
            {match.parsedTransaction.recipientAccount && (
              <Row label="الحساب المستلم" value={match.parsedTransaction.recipientAccount} mono />
            )}
            {match.parsedTransaction.recipientWallet && (
              <Row label="المحفظة" value={match.parsedTransaction.recipientWallet} mono />
            )}
            <Row label="وقت الاستلام" value={formatDate(match.receivedAt)} />
            {match.parsedTransaction.occurredAt && (
              <Row label="وقت العملية" value={formatDate(match.parsedTransaction.occurredAt)} />
            )}
          </View>
        </View>
      )}
    </View>
  );
}

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
    <View className="px-2 py-0.5 rounded-full border" style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}>
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

function formatDistance(seconds: number): string {
  if (seconds < 60) return `${seconds} ثانية`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} دقيقة`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} ساعة`;
  return `${Math.round(seconds / 86400)} يوم`;
}

function FlowBadge({ validation }: { validation: string }) {
  if (validation === 'BALANCE_FLOW_VALID') {
    return (
      <View className="px-2 py-0.5 rounded-full bg-green-100 border border-green-300">
        <Text className="text-xs font-semibold text-green-700">✓ متطابق</Text>
      </View>
    );
  }
  if (validation === 'BALANCE_FLOW_MISMATCH') {
    return (
      <View className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300">
        <Text className="text-xs font-semibold text-amber-700">≠ غير متطابق</Text>
      </View>
    );
  }
  return (
    <View className="px-2 py-0.5 rounded-full bg-muted border border-border">
      <Text className="text-xs text-muted-foreground">غير محدد</Text>
    </View>
  );
}
