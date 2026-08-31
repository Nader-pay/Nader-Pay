import { fetch } from 'expo/fetch';
import Constants from 'expo-constants';

import { getSecureItem, setSecureItem } from '@/lib/secureStore';

const GITHUB_OWNER = 'Nader-pay';
const GITHUB_REPO = 'Nader-Pay';
const LAST_VERSION_KEY = '@nader_pay_agent:last_version';

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  updateRequired: boolean;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

export function getAppVersion(): string {
  // استخدام نسخة التطبيق من إعدادات البناء
  try {
    return Constants.expoConfig?.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export async function checkLatestVersion(): Promise<VersionInfo | null> {
  const currentVersion = getAppVersion();

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'nader-pay-agent',
        },
      }
    );

    if (!response.ok) {
      console.warn('[VersionCheck] GitHub API error:', response.status);
      return null;
    }

    const release: GitHubRelease = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, '');

    // البحث عن ملف APK بالاسم المحدد
    const apkAsset = release.assets.find(
      (asset) => asset.name.startsWith('nader-pay-agent-v') && asset.name.endsWith('.apk')
    );

    const downloadUrl =
      apkAsset?.browser_download_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

    const updateRequired = compareVersions(latestVersion, currentVersion) > 0;

    return {
      currentVersion,
      latestVersion,
      downloadUrl,
      releaseNotes: release.body || '',
      updateRequired,
    };
  } catch (err) {
    console.warn('[VersionCheck] failed:', err);
    return null;
  }
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = b.split('.').map((n) => parseInt(n, 10) || 0);

  const maxLength = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLength; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA > partB) return 1;
    if (partA < partB) return -1;
  }

  return 0;
}

export async function getStoredVersion(): Promise<string | null> {
  try {
    return await getSecureItem(LAST_VERSION_KEY);
  } catch {
    return null;
  }
}

export async function setStoredVersion(version: string): Promise<void> {
  try {
    await setSecureItem(LAST_VERSION_KEY, version);
  } catch {
    // ignore
  }
}

export async function shouldRunMigration(): Promise<boolean> {
  const currentVersion = getAppVersion();
  const storedVersion = await getStoredVersion();

  if (!storedVersion) return true;
  return compareVersions(currentVersion, storedVersion) > 0;
}

export async function runCleanMigration(): Promise<void> {
  const currentVersion = getAppVersion();

  // مسح الكاش والبيانات المؤقتة الغير الضرورية
  // من المهم عدم مسح Server Profiles وprovider sources وسجلات الطلبات
  // هنا نمسح فقط مفاتيح مؤقتة لم تعد مستخدمة
  try {
    // في المستقبل يمكن إضافة مفاتيح كاش محددة
    const legacyKeys = [
      '@cache_pending_orders',
      '@cache_last_poll',
      '@cache_dashboard_stats',
      '@temp_migration_status',
    ];
    await Promise.all(legacyKeys.map(async (key) => {
      try {
        await setSecureItem(key, '');
      } catch {
        // ignore
      }
    }));
  } catch {
    // ignore
  }

  await setStoredVersion(currentVersion);
}
