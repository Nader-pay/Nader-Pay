package com.payverify.agent.data.api

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.util.Log
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.db.EvidenceEntity
import com.payverify.agent.data.db.SyncStatus
import com.payverify.agent.data.security.SecureStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * SyncQueue — مسؤول عن إرسال Evidence للسيرفر
 * Logic:
 * 1. سحب pending/failed records
 * 2. فحص الإنترنت
 * 3. إرسال بالترتيب مع idempotency_key
 * 4. تحديث الحالة المحلية
 * لا يُحذف Evidence المحلي قبل تأكيد السيرفر
 */
class SyncQueue(
    private val context: Context,
    private val db: AgentDatabase,
    private val secureStorage: SecureStorage,
    private val apiBaseUrl: String
) {
    private val dao = db.evidenceDao()
    private val tag = "SyncQueue"

    val queueSizeFlow: Flow<Int> = dao.observeQueueSize()

    suspend fun processQueue(): SyncResult = withContext(Dispatchers.IO) {
        if (!isNetworkAvailable()) {
            Log.d(tag, "لا يوجد اتصال بالإنترنت — تأجيل المزامنة")
            return@withContext SyncResult(skipped = true)
        }

        val deviceToken = secureStorage.deviceToken
            ?: return@withContext SyncResult(error = "لم يتم تسجيل الجهاز")

        val service = ApiClientFactory.create(apiBaseUrl)
        val pending = dao.getPendingSync()

        if (pending.isEmpty()) return@withContext SyncResult(sent = 0)

        var sent = 0; var failed = 0
        for (ev in pending) {
            try {
                val response = service.ingestEvent(
                    deviceToken = "Bearer $deviceToken",
                    body = ev.toIngestRequest()
                )
                when {
                    response.isSuccessful -> {
                        val body = response.body()
                        if (body?.duplicate == true) {
                            // مكرر — نعتبره مُرسَلًا
                            dao.markSent(ev.evidenceId, System.currentTimeMillis())
                            Log.d(tag, "evidence مكرر على السيرفر: ${ev.eventId}")
                        } else {
                            dao.markSent(ev.evidenceId, System.currentTimeMillis())
                        }
                        sent++
                    }
                    response.code() == 409 -> {
                        // Duplicate — سيرفر أعاد 409
                        dao.markSent(ev.evidenceId, System.currentTimeMillis())
                        sent++
                    }
                    response.code() in 400..499 -> {
                        // خطأ دائم (4xx) — تحويل لـ permanently_failed
                        dao.updateSyncStatus(ev.evidenceId, SyncStatus.PERMANENTLY_FAILED, "HTTP ${response.code()}")
                        failed++
                    }
                    else -> {
                        val newStatus = if (ev.attempts >= MAX_ATTEMPTS) SyncStatus.PERMANENTLY_FAILED else SyncStatus.FAILED
                        dao.updateSyncStatus(ev.evidenceId, newStatus, "HTTP ${response.code()}")
                        failed++
                    }
                }
            } catch (e: Exception) {
                val newStatus = if (ev.attempts >= MAX_ATTEMPTS) SyncStatus.PERMANENTLY_FAILED else SyncStatus.FAILED
                dao.updateSyncStatus(ev.evidenceId, newStatus, e.message)
                failed++
                Log.e(tag, "فشل إرسال ${ev.evidenceId}: ${e.message}")
            }
        }

        Log.d(tag, "المزامنة: أُرسل $sent، فشل $failed")
        SyncResult(sent = sent, failed = failed)
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val capabilities = cm.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun EvidenceEntity.toIngestRequest(): IngestEventRequest {
        val occurredAt = DateTimeFormatter.ISO_INSTANT.format(Instant.ofEpochMilli(occurredAt))
        return IngestEventRequest(
            device_id  = secureStorage.deviceId ?: "",
            event_id   = eventId,
            event_type = "payment.evidence",
            payload    = buildMap {
                put("provider", provider)
                put("amount", amount)
                put("currency", currency)
                put("sender_phone", senderPhone)
                put("sender_name", senderName)
                put("recipient_wallet", recipientWallet)
                put("transaction_id", transactionId)
                put("confidence", confidence)
                put("parser_version", parserVersion)
                put("normalized_message", normalizedMessage)
                put("message_hash", messageHash)
                put("package_name", packageName)
                put("raw_message", rawMessage)
            },
            occurred_at      = occurredAt,
            idempotency_key  = eventId
        )
    }

    data class SyncResult(
        val sent: Int = 0,
        val failed: Int = 0,
        val skipped: Boolean = false,
        val error: String? = null
    )

    companion object {
        const val MAX_ATTEMPTS = 5
    }
}
