import { useCallback, useEffect, useState } from 'react';

import { checkLatestVersion, VersionInfo } from '@/services/versionCheck';

export function useVersionCheck() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const check = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const info = await checkLatestVersion();
      if (info) {
        setVersionInfo(info);
      } else {
        setError('تعذر التحقق من التحديثات. يرجى المحاولة لاحقاً.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل التحقق من التحديثات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return {
    versionInfo,
    loading,
    error,
    recheck: check,
  };
}
