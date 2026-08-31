package com.payverify.agent.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.payverify.agent.workers.HeartbeatWorker
import com.payverify.agent.workers.SyncWorker

/**
 * BootReceiver — يستأنف WorkManager jobs بعد:
 * - BOOT_COMPLETED
 * - MY_PACKAGE_REPLACED (تحديث التطبيق)
 * - QUICKBOOT_POWERON (بعض أجهزة Huawei/Xiaomi)
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON" -> {
                Log.i("BootReceiver", "إعادة جدولة المهام بعد: ${intent.action}")
                SyncWorker.enqueuePeriodicSync(context)
                HeartbeatWorker.enqueuePeriodicHeartbeat(context)
            }
        }
    }
}
