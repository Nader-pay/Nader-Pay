// شاشة قسم التكامل الرئيسية — Integration Hub
import { ScrollView, View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Key, Webhook, BookOpen, FileDown, Code2, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type CardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onPress: () => void;
};

function IntegrationCard({ icon, title, description, badge, onPress }: CardProps) {
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-70"
      style={{ borderCurve: 'continuous' }}
    >
      <View
        className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4 flex-row items-center gap-4"
        style={{ borderCurve: 'continuous' }}
      >
        <View className="w-11 h-11 rounded-xl bg-[#F8F9FB] items-center justify-center">
          {icon}
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-[15px] font-semibold text-[#111827]">{title}</Text>
            {badge ? (
              <View className="bg-[#EEF2FF] rounded-full px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-[#4338CA]">{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text className="text-[13px] text-[#6B7280] mt-0.5 leading-5">{description}</Text>
        </View>
        <ChevronRight size={16} color="#9CA3AF" />
      </View>
    </Pressable>
  );
}

function StepBadge({ step, label }: { step: number; label: string }) {
  return (
    <View className="flex-row items-center gap-3 py-2.5">
      <View className="w-7 h-7 rounded-full bg-[#111827] items-center justify-center">
        <Text className="text-[11px] font-bold text-white">{step}</Text>
      </View>
      <Text className="text-[14px] text-[#374151] flex-1">{label}</Text>
      <CheckCircle2 size={15} color="#D1D5DB" />
    </View>
  );
}

export default function IntegrationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-[#F8F9FB]"
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View className="px-6 pt-2 pb-6">
        <Text className="text-[11px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-2">
          للمطوّرين
        </Text>
        <Text className="text-[26px] font-bold text-[#111827] leading-8">
          التكامل مع نادر باي
        </Text>
        <Text className="text-[14px] text-[#6B7280] mt-2 leading-6">
          اربط موقعك أو تطبيقك ببوابة الدفع في دقائق. كل ما تحتاجه في مكان واحد.
        </Text>
      </View>

      {/* خطوات سريعة */}
      <View className="mx-6 mb-6">
        <View
          className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-4"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-3">
            خطوات البدء السريع
          </Text>
          <View className="gap-0">
            <StepBadge step={1} label="أنشئ مفتاح API من قسم المفاتيح" />
            <View className="h-px bg-[#F3F4F6] mx-1" />
            <StepBadge step={2} label="أضف Base URL في إعدادات موقعك" />
            <View className="h-px bg-[#F3F4F6] mx-1" />
            <StepBadge step={3} label="أرسل طلب الدفع بصيغة JSON" />
            <View className="h-px bg-[#F3F4F6] mx-1" />
            <StepBadge step={4} label="استقبل تأكيد الدفع عبر Webhook" />
            <View className="h-px bg-[#F3F4F6] mx-1" />
            <StepBadge step={5} label="اختبر الاتصال وابدأ الاستقبال" />
          </View>
        </View>
      </View>

      {/* بطاقات الأقسام */}
      <View className="px-6 gap-3">
        <Text className="text-[12px] font-semibold text-[#9CA3AF] tracking-widest uppercase mb-1">
          أدوات التكامل
        </Text>

        <IntegrationCard
          icon={<Key size={20} color="#111827" />}
          title="مفاتيح API"
          description="أنشئ وأدِر مفاتيح الوصول لموقعك"
          badge="مطلوب"
          onPress={() => router.push('/(app)/integration/api-keys' as never)}
        />

        <IntegrationCard
          icon={<BookOpen size={20} color="#111827" />}
          title="دليل التكامل"
          description="شرح خطوة بخطوة مع أكواد جاهزة"
          onPress={() => router.push('/(app)/integration/guide' as never)}
        />

        <IntegrationCard
          icon={<Webhook size={20} color="#111827" />}
          title="إعداد Webhook"
          description="استقبل تأكيد الدفع فور حدوثه"
          onPress={() => router.push('/(app)/integration/webhook' as never)}
        />

        <IntegrationCard
          icon={<Code2 size={20} color="#111827" />}
          title="مثال بوابة الدفع"
          description="كود HTML/JS جاهز لإضافة بوابة في موقعك"
          onPress={() => router.push('/(app)/integration/payment-form' as never)}
        />

        <IntegrationCard
          icon={<FileDown size={20} color="#111827" />}
          title="تنزيل ملف التكامل"
          description="ملف JSON شامل بكل إعدادات الربط"
          onPress={() => router.push('/(app)/integration/download' as never)}
        />
      </View>

      {/* تنبيه أمان */}
      <View className="mx-6 mt-6">
        <View
          className="border border-[#FEE2E2] bg-[#FFF7F7] rounded-2xl px-4 py-3"
          style={{ borderCurve: 'continuous' }}
        >
          <Text className="text-[12px] font-semibold text-[#DC2626] mb-1">⚠️ تنبيه أمان مهم</Text>
          <Text className="text-[12px] text-[#7F1D1D] leading-5">
            لا تشارك مفاتيح API مع أحد ولا تضعها في كود Frontend مكشوف. استخدم دائماً متغيرات البيئة أو الخادم.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
