import { Linking } from 'react-native';

export function openAppSettings() {
  if (typeof Linking.openSettings === 'function') {
    Linking.openSettings();
  }
}
