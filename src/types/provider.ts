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

export type SourceType = 'phone' | 'sender_name' | 'short_code' | 'unknown';

export type ProviderSourceStatus =
  | 'unverified'
  | 'discovering'
  | 'selected'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'revoked';

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

export type SourceMetadata = {
  label?: string;
  displayName?: string;
  examples?: string[];
  [key: string]: unknown;
};

export type ProviderSource = {
  id?: number;
  providerId: ProviderName;
  sourceId: string;
  sourceType: SourceType;
  sourceMetadata: SourceMetadata;
  verified: boolean;
  enabled: boolean;
  lastVerificationAt: string | null;
  lastVerificationResult: string | null;
  lastMessageAt: string | null;
  lastMessageSummary: string | null;
  parserVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceVerificationResult =
  | { ok: true; provider: ProviderName; sourceId?: string }
  | { ok: false; reason: string; provider?: ProviderName; sourceId?: string };

export type SourceVerificationLog = {
  id?: number;
  providerId: ProviderName;
  sourceId: string;
  action: string;
  result: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type DiscoveredSmsSource = {
  sourceId: string;
  sourceType: SourceType;
  label: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessagePreview: string;
  parserConfidence: number;
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
