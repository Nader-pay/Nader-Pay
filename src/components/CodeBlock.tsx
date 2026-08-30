import { Pressable, Text, View } from 'react-native';
import { Copy, Check } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View className="bg-card border border-border rounded-2xl overflow-hidden">
      <View className="flex-row-reverse items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        {title ? (
          <Text className="text-sm font-semibold text-foreground text-right">{title}</Text>
        ) : (
          <View />
        )}
        <Pressable className="flex-row-reverse items-center gap-1 active:opacity-60" onPress={handleCopy}>
          {copied ? (
            <>
              <Check size={14} color="#16a34a" />
              <Text className="text-xs text-green-600 font-medium">تم النسخ</Text>
            </>
          ) : (
            <>
              <Copy size={14} color="#6b7280" />
              <Text className="text-xs text-muted-foreground font-medium">نسخ</Text>
            </>
          )}
        </Pressable>
      </View>
      <Text className="px-4 py-4 text-xs text-foreground font-mono text-left leading-5" selectable>
        {code}
      </Text>
    </View>
  );
}
