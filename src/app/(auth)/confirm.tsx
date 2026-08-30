import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MailCheck, AlertTriangle } from 'lucide-react-native';

import { supabase } from '@/client/supabase';

export default function ConfirmEmail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; type?: string; error?: string }>();
  const { token, type, error } = params;

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [message, setMessage] = useState('جاري التحقق من رابط التأكيد...');

  useEffect(() => {
    if (error) {
      setStatus('error');
      setMessage('رابط التأكيد غير صالح أو انتهت صلاحيته.');
      return;
    }
    if (token && type === 'signup') {
      (async () => {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: 'signup',
        });
        if (verifyError || !data.session) {
          setStatus('error');
          setMessage(verifyError?.message || 'فشل التحقق من الرابط.');
        } else {
          setStatus('success');
          setMessage('تم تأكيد البريد الإلكتروني. جاري الدخول...');
          setTimeout(() => router.replace('/'), 800);
        }
      })();
    } else {
      setStatus('error');
      setMessage('رابط غير مكتمل. يرجى التأكد من فتح الرابط من البريد.');
    }
  }, [token, type, error, router]);

  return (
    <>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <View className="flex-1 items-center justify-center bg-background px-8">
        <View className="items-center gap-5">
          <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center">
            {status === 'error' ? (
              <AlertTriangle size={28} color="#ef4444" />
            ) : (
              <MailCheck size={28} color="hsl(222 47% 25%)" />
            )}
          </View>
          <View className="items-center gap-2">
            <Text className="text-xl font-bold text-foreground text-center">تأكيد البريد الإلكتروني</Text>
            {status === 'verifying' && <ActivityIndicator size="small" color="hsl(222 47% 25%)" />}
            <Text className="text-sm text-muted-foreground text-center leading-6">{message}</Text>
          </View>
          {status === 'error' && (
            <Pressable
              className="bg-primary px-8 py-3 rounded-2xl active:opacity-80"
              onPress={() => router.push('/(auth)/sign-in')}
            >
              <Text className="text-primary-foreground font-medium text-sm">تسجيل الدخول</Text>
            </Pressable>
          )}
        </View>
      </View>
    </>
  );
}
