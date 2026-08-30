import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, Server, Trash2, RefreshCw } from 'lucide-react-native';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import { getServerProfiles, deleteServerProfile, setActiveServerProfile, getActiveServerProfile } from '@/services/serverProfileManager';
import { testConnection } from '@/services/backendConnector';
import { updateServerProfileConnectionState } from '@/lib/database';
import { logEvent } from '@/lib/database';
import type { ServerProfile } from '@/types/backend';

export default function ServersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadProfiles();
    }, [])
  );

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const data = await getServerProfiles();
      setProfiles(data);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (id: string) => {
    await setActiveServerProfile(id);
    await loadProfiles();
  };

  const handleDelete = async () => {
    if (!deleteDialog) return;
    await deleteServerProfile(deleteDialog.id);
    setDeleteDialog(null);
    await loadProfiles();
  };

  const handleTest = async (profile: ServerProfile) => {
    setTesting(profile.id);
    try {
      const result = await testConnection(profile);
      const state = result.ok ? 'متصل' : 'فشل الاتصال';
      await updateServerProfileConnectionState(profile.id, {
        isConnected: result.ok,
        lastConnectedAt: new Date().toISOString(),
      });
      await loadProfiles();
      await logEvent('server_test', `Test ${profile.name}: ${state}`, {
        status: result.status,
        endpoint: result.endpoint,
        error: result.error,
      });
    } catch (err) {
      await logEvent('server_test_error', err instanceof Error ? err.message : 'unknown');
    } finally {
      setTesting(null);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <StatusBar style="dark" backgroundColor="#ffffff" />
      <View className="px-5 py-6 flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-foreground">خوادم الدفع</Text>
        <Pressable
          className="flex-row items-center gap-2 bg-primary px-4 py-2 rounded-xl active:opacity-70"
          onPress={() => router.push('/server-profile/new' as any)}
        >
          <Plus size={18} className="text-primary-foreground" />
          <Text className="text-sm font-medium text-primary-foreground">إضافة</Text>
        </Pressable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" className="text-muted-foreground" />
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 pb-6 gap-3"
          renderItem={({ item }) => (
            <View className="border border-border rounded-2xl bg-card p-4 gap-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <Server size={22} className="text-foreground" />
                  <View>
                    <Text className="text-base font-semibold text-foreground">{item.name}</Text>
                    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                      {item.baseUrl}
                    </Text>
                  </View>
                </View>
                {item.isActive && (
                  <View className="flex-row items-center gap-1 bg-primary/10 px-2 py-1 rounded-full">
                    <Check size={12} className="text-primary" />
                    <Text className="text-xs text-primary">نشط</Text>
                  </View>
                )}
              </View>

              <View className="flex-row items-center gap-2">
                <View
                  className={`w-2 h-2 rounded-full ${item.isConnected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                <Text className="text-xs text-muted-foreground">
                  {item.isConnected ? 'متصل' : 'غير متصل'}
                  {item.lastConnectedAt ? ` — ${formatTime(item.lastConnectedAt)}` : ''}
                </Text>
              </View>

              <View className="flex-row gap-2 pt-2">
                {!item.isActive && (
                  <Pressable
                    className="flex-1 items-center py-2 border border-border rounded-xl active:opacity-70"
                    onPress={() => handleActivate(item.id)}
                  >
                    <Text className="text-sm font-medium text-foreground">تنشيط</Text>
                  </Pressable>
                )}
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-2 py-2 border border-border rounded-xl active:opacity-70"
                  onPress={() => handleTest(item)}
                  disabled={testing === item.id}
                >
                  {testing === item.id ? (
                    <ActivityIndicator size="small" className="text-muted-foreground" />
                  ) : (
                    <RefreshCw size={16} className="text-foreground" />
                  )}
                  <Text className="text-sm font-medium text-foreground">اختبار</Text>
                </Pressable>
                <Pressable
                  className="flex-1 flex-row items-center justify-center gap-2 py-2 border border-destructive rounded-xl active:opacity-70"
                  onPress={() => setDeleteDialog({ id: item.id, name: item.name })}
                >
                  <Trash2 size={16} className="text-destructive" />
                  <Text className="text-sm font-medium text-destructive">حذف</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View className="items-center py-12 gap-3 border border-dashed border-border rounded-2xl">
              <Server size={40} className="text-muted-foreground" />
              <Text className="text-sm text-muted-foreground">لا توجد خوادم مضافة</Text>
              <Text className="text-xs text-muted-foreground">أضف خادم الدفع للبدء</Text>
            </View>
          }
        />
      )}

      <AlertDialog open={!!deleteDialog} onOpenChange={(open: boolean) => !open && setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الخادم</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف "{deleteDialog?.name}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => setDeleteDialog(null)}>
              <Text className="text-foreground">إلغاء</Text>
            </AlertDialogCancel>
            <AlertDialogAction onPress={handleDelete} className="bg-destructive">
              <Text className="text-primary-foreground">حذف</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
