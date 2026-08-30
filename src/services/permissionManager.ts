import { checkSmsPermission, requestSmsPermission } from './smsReader';
import { checkNotificationPermission, requestNotificationPermission } from './notifications';

export type PermissionState = 'granted' | 'denied' | 'permanently_denied' | 'restricted' | 'not_required';

export type PermissionSnapshot = {
  sms: PermissionState;
  notifications: PermissionState;
};

/**
 * Permission Manager موحّد: يجمع حالات الصلاحيات الأساسية في مكان واحد
 * ويمنع تضارب الحالات عبر الشاشات.
 */
export async function getPermissionSnapshot(): Promise<PermissionSnapshot> {
  return {
    sms: (await checkSmsPermission()) ? 'granted' : 'denied',
    notifications: (await checkNotificationPermission()) ? 'granted' : 'denied',
  };
}

export async function requestSmsAccess(): Promise<boolean> {
  return requestSmsPermission();
}

export async function requestNotificationAccess(): Promise<boolean> {
  return requestNotificationPermission();
}

export { requestSmsPermission, requestNotificationPermission };

export function permissionStateToReadable(state: PermissionState): string {
  switch (state) {
    case 'granted':
      return 'ممنوحة';
    case 'denied':
      return 'مرفوضة';
    case 'permanently_denied':
      return 'مرفوضة دائمًا';
    case 'restricted':
      return 'مقيّدة';
    case 'not_required':
      return 'غير مطلوبة';
    default:
      return 'غير معروفة';
  }
}
