import { useEffect, useRef } from 'react';
import { useSmsListener } from 'expo-sms-listener';
import type { SmsMessage } from '@/types/agent';

export interface AgentSmsListenerProps {
  onMessage: (message: SmsMessage) => void;
}

export default function AgentSmsListener({ onMessage }: AgentSmsListenerProps) {
  const lastId = useRef<string | null>(null);

  useSmsListener((event) => {
    const message: SmsMessage = {
      id: `${event.originatingAddress}-${event.date ?? Date.now()}-${event.body.slice(0, 20)}`,
      originatingAddress: event.originatingAddress ?? '',
      body: event.body ?? '',
      date: event.date ?? new Date().toISOString(),
      readState: 0,
      threadId: 0,
      protocol: '',
    };

    // منع الإرسال المكرر لنفس الرسالة
    if (lastId.current === message.id) return;
    lastId.current = message.id;

    onMessage(message);
  });

  useEffect(() => {
    return () => {
      lastId.current = null;
    };
  }, []);

  return null;
}
