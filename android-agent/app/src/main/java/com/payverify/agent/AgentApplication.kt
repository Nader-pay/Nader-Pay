package com.payverify.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.security.SecureStorage
import com.payverify.agent.workers.HeartbeatWorker
import com.payverify.agent.workers.SyncWorker

class AgentApplication : Application() {

    lateinit var db: AgentDatabase
        private set
    lateinit var secureStorage: SecureStorage
        private set

    override fun onCreate() {
        super.onCreate()
        db = AgentDatabase.getInstance(this)
        secureStorage = SecureStorage(this)
        createNotificationChannels()
        scheduleBackgroundJobs()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // قناة المزامنة (foreground service)
        NotificationChannel(
            CHANNEL_SYNC,
            getString(R.string.channel_sync_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = "حالة مزامنة المدفوعات" }
            .also { nm.createNotificationChannel(it) }

        // قناة التنبيهات
        NotificationChannel(
            CHANNEL_ALERTS,
            getString(R.string.channel_alerts_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "تنبيهات اكتشاف الدفعات"
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        }.also { nm.createNotificationChannel(it) }
    }

    private fun scheduleBackgroundJobs() {
        // لا تُجدوِل إذا لم يكن الجهاز مُسجَّلًا بعد
        if (!secureStorage.isRegistered) return
        SyncWorker.enqueuePeriodicSync(this)
        HeartbeatWorker.enqueuePeriodicHeartbeat(this)
    }

    companion object {
        const val CHANNEL_SYNC   = "payverify_sync"
        const val CHANNEL_ALERTS = "payverify_alerts"
    }
}
