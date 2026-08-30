import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react-native';

import { supabase } from '@/client/supabase';

export default function SignIn() {
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignIn = async () => {
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      let msg = 'بيانات الدخول غير صحيحة. يرجى المحاولة مرة أخرى.';
      if (authError.message.includes('Email not confirmed')) {
        msg = 'لم يتم تأكيد البريد الإلكتروني. يرجى التحقق من بريدك أو إنشاء حساب جديد.';
      } else if (authError.message.includes('Invalid login credentials')) {
        msg = 'بريد إلكتروني أو كلمة مرور غير صحيحة.';
      }
      setError(msg);
      return;
    }
    router.replace('/');
  };

  return (
    <>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 bg-background"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-6 py-12"
          keyboardShouldPersistTaps="handled"
        >
          {/* الشعار والعنوان */}
          <View className="items-center mb-12 gap-2">
            <Text className="text-4xl font-bold text-foreground tracking-tight">Nader Pay</Text>
            <Text className="text-sm text-muted-foreground">لوحة تحكم التحقق من المدفوعات</Text>
          </View>

          {/* نموذج الدخول */}
          <View className="gap-4">
            {/* البريد الإلكتروني */}
            <View>
              <Text className="text-xs font-medium text-muted-foreground mb-2 text-right">
                البريد الإلكتروني
              </Text>
              <View className="flex-row-reverse items-center border border-border rounded-xl bg-background px-4 h-12 gap-3">
                <Mail size={16} color="#6b7280" />
                <TextInput
                  className="flex-1 text-foreground text-sm text-right"
                  placeholder="admin@example.com"
                  placeholderTextColor="#9ca3af"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>

            {/* كلمة المرور */}
            <View>
              <Text className="text-xs font-medium text-muted-foreground mb-2 text-right">
                كلمة المرور
              </Text>
              <View className="flex-row-reverse items-center border border-border rounded-xl bg-background px-4 h-12 gap-3">
                <Lock size={16} color="#6b7280" />
                <TextInput
                  ref={passwordRef}
                  className="flex-1 text-foreground text-sm text-right"
                  placeholder="••••••••"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} className="active:opacity-60">
                  {showPassword ? (
                    <EyeOff size={16} color="#6b7280" />
                  ) : (
                    <Eye size={16} color="#6b7280" />
                  )}
                </Pressable>
              </View>
            </View>

            {/* رسالة الخطأ */}
            {error ? (
              <Text className="text-destructive text-xs text-right">{error}</Text>
            ) : null}

            {/* زر الدخول */}
            <Pressable
              className="bg-primary rounded-xl h-12 items-center justify-center mt-2 active:opacity-80"
              onPress={handleSignIn}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-primary-foreground font-semibold text-sm">تسجيل الدخول</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
