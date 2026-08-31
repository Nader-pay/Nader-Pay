package com.payverify.agent.workers

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import androidx.work.*
import com.payverify.agent.data.api.ApiClientFactory
import com.payverify.agent.data.api.HeartbeatRequest
import com.payverify.agent.data.api.SyncQueue
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.security.SecureStorage
import com.payverify.agent.services.PaymentNotificationListenerService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * SyncWorker — WorkManager Worker لمزامنة الـ Evidence كل 15 دقيقة
 * يعمل حتى بعد إعادة التشغيل (REQUIRES_NETWORK constraint)
 */
class SyncWorker(appContext: Context, workerParams: WorkerParameters) :
    CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val tag = "SyncWorker"
        val secure = SecureStorage(applicationContext)
        val db     = AgentDatabase.getInstance(applicationContext)
        val apiUrl = secure.apiBaseUrl ?: run {
            Log.w(tag, "لم يتم تهيئة API URL")
            return@withContext Result.retry()
        }

        try {
            val syncQueue = SyncQueue(applicationContext, db, secure, apiUrl)
            val result = syncQueue.processQueue()
            Log.d(tag, "مزامنة: أُرسل ${result.sent} | فشل ${result.failed}")
            if (result.error != null) Result.retry() else Result.success()
        } catch (e: Exception) {
            Log.e(tag, "SyncWorker خطأ: ${e.message}")
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        private const val WORK_NAME = "payverify_sync"

        fun enqueuePeriodicSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun enqueueImmediateSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueue(request)
        }
    }
}

/**
 * HeartbeatWorker — يرسل حالة الجهاز للسيرفر كل 30 دقيقة
 */
class HeartbeatWorker(appContext: Context, workerParams: WorkerParameters) :
    CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val tag = "HeartbeatWorker"
        val secure = SecureStorage(applicationContext)
        val db     = AgentDatabase.getInstance(applicationContext)

        val deviceToken = secure.deviceToken ?: return@withContext Result.failure()
        val deviceId    = secure.deviceId    ?: return@withContext Result.failure()
        val apiUrl      = secure.apiBaseUrl  ?: return@withContext Result.failure()

        try {
            val queueSize = db.evidenceDao().getPendingSync().size
            val battery   = getBatteryLevel()
            val service   = ApiClientFactory.create(apiUrl)

            val response = service.heartbeat(
                deviceToken = "Bearer $deviceToken",
                body = HeartbeatRequest(
                    device_id        = deviceId,
                    status           = "online",
                    listener_enabled = PaymentNotificationListenerService.isConnected,
                    network_type     = "wifi_or_mobile",
                    battery_level    = battery,
                    queue_size       = queueSize,
                    app_version      = getAppVersion(),
                    metadata         = mapOf("sdk_int" to Build.VERSION.SDK_INT)
                )
            )

            if (response.isSuccessful) {
                val body = response.body()
                if (body?.revoked == true) {
                    // السيرفر ألغى الجهاز — مسح البيانات المحلية
                    Log.w(tag, "الجهاز أُلغي من السيرفر — مسح البيانات")
                    secure.clearAll()
                }
                Log.d(tag, "Heartbeat ✓ queue=$queueSize listener=${PaymentNotificationListenerService.isConnected}")
                Result.success()
            } else {
                Log.w(tag, "Heartbeat HTTP ${response.code()}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(tag, "Heartbeat خطأ: ${e.message}")
            Result.retry()
        }
    }

    private fun getBatteryLevel(): Int? {
        val bm = applicationContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    private fun getAppVersion(): String {
        return try {
            applicationContext.packageManager
                .getPackageInfo(applicationContext.packageName, 0).versionName
        } catch (e: Exception) { "1.0.0" }
    }

    companion object {
        private const val WORK_NAME = "payverify_heartbeat"

        fun enqueuePeriodicHeartbeat(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(30, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }
    }
}
