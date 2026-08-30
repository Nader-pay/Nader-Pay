// أنواع مصادر SMS والتحقق منها

export type SourceType = 'phone' | 'short_code' | 'sender_name';

export type ProviderSourceStatus =
  | 'verified'    // تم التوثيق بنجاح
  | 'failed'      // فشل التوثيق
  | 'unverified'  // لم يتم التوثيق بعد
  | 'discovering' // جاري الاستكشاف
  | 'verifying'   // جاري التحقق
  | 'selected'    // تم الاختيار، في انتظار التوثيق
  | 'revoked';    // تم إلغاؤه

export type ProviderSource = {
  id: number;
  provider_id: string;       // مثل 'vodafone_cash'
  source_id: string;         // الرقم أو الاسم الموحّد
  source_type: SourceType;
  display_name: string | null;
  verified: boolean;
  enabled: boolean;
  last_message_at: string | null;
  last_verification_at: string | null;
  last_verification_result: string | null;
  verification_attempts: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SourceVerificationResult = {
  ok: boolean;
  provider?: string;
  sourceId?: string;
  reason?: string;
};

export type SourceVerificationLog = {
  id: number;
  provider_source_id: number | null;
  provider_id: string;
  source_id: string;
  action: string;
  result: string | null;
  reason: string | null;
  message_count_tested: number | null;
  message_count_passed: number | null;
  created_at: string;
};

export type DiscoveredSmsSource = {
  sourceId: string;
  sourceType: SourceType;
  displayName: string;
  messageCount: number;
  matchedCount: number;
  confidence: number; // 0-100
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  isCurrentlyVerified: boolean;
};

// أننواع المزودات ونظام تحليل الرسائل (Generic Payment Providers)

export type ProviderName =
  | 'vodafone_cash'
  | 'orange_cash'
  | 'insta_pay'
  | 'bank_transfer'
  | 'unknown';

export type SourceVerificationStatus =
  | 'verified'
  | 'partial'
  | 'unverified'
  | 'not_applicable';

export type ProviderConfig = {
  enabled: boolean;
  recipientAccount: string | null;
  sourceRules: SourceRule[];
  messagePatterns: string[];
  parserVersion: string;
  validationRules: ValidationRule[];
};

export type SourceRule = {
  type: 'phone' | 'sender_name' | 'app_package' | 'short_code';
  value: string;
  match: 'exact' | 'prefix' | 'contains';
};

export type ValidationRule = {
  field: 'amount' | 'sender' | 'recipient' | 'transaction_id' | 'timestamp';
  required: boolean;
  policy?: 'exact' | 'fuzzy' | 'none';
};

export type ProviderParseResult = {
  provider: ProviderName;
  transactionId: string;
  amount: number;
  currency: string;
  senderPhone: string | null;
  senderName: string | null;
  recipientWallet: string | null;
  recipientAccount: string | null;
  occurredAt: string;
  rawMessage: string;
  normalizedMessage: string;
  sourceVerification: SourceVerificationStatus;
};

export type ProviderParser = {
  name: ProviderName;
  detect: (body: string) => boolean;
  parse: (body: string) => ProviderParseResult | null;
  verifySource: (body: string, originatingAddress?: string) => SourceVerificationStatus;
};

export type ProviderDetectContext = {
  originatingAddress?: string;
};
