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
