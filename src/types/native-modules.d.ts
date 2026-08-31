declare module 'react-native-get-sms-android' {
  const SmsAndroid: {
    list(
      filter: string,
      fail: (error: string) => void,
      success: (count: number, messages: string) => void
    ): void;
  };
  export default SmsAndroid;
}

declare module 'expo-sms-listener' {
  export type SmsEvent = {
    originatingAddress: string;
    body: string;
    date?: string;
  };

  export function requestSmsPermissionAsync(): Promise<string>;
  export function checkSmsPermissionAsync(): Promise<string>;
  export function startSmsListenerServiceAsync(): Promise<void>;
  export function stopSmsListenerServiceAsync(): Promise<void>;
  export function addSmsListener(listener: (event: SmsEvent) => void): { remove: () => void };
  export function useSmsListener(callback: (event: SmsEvent) => void): void;
}
