package com.payverify.agent.services

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.db.EvidenceEntity
import com.payverify.agent.data.db.SyncStatus
import com.payverify.agent.data.parser.NotificationInput
import com.payverify.agent.data.parser.ParsedEvidence
import com.payverify.agent.data.parser.ParserRegistry
import com.payverify.agent.data.security.SecureStorage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/**
 * PaymentNotificationListenerService
 *
 * Pipeline:
 * 1. تحقق من package (allowlist)
 * 2. استخرج الحقول
 * 3. normalize
 * 4. مرر لـ ProviderParser
 * 5. فحص الـ duplicates محليًا
 * 6. احفظ في Room
 * 7. أضف للـ SyncQueue
 */
class PaymentNotificationListenerService : NotificationListenerService() {

    private val tag = "PayNLS"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // حالة الـ Listener (تُشارَك مع UI)
    companion object {
        @Volatile var isConnected: Boolean = false
        @Volatile var lastNotificationMs: Long = 0L
    }

    private lateinit var db: AgentDatabase
    private lateinit var secureStorage: SecureStorage

    override fun onCreate() {
        super.onCreate()
        db = AgentDatabase.getInstance(applicationContext)
        secureStorage = SecureStorage(applicationContext)
        Log.i(tag, "Notification Listener Service بدأ")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        isConnected = true
        Log.i(tag, "Listener متصل")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        isConnected = false
        Log.w(tag, "Listener قُطع الاتصال — محاولة إعادة الاتصال")
        requestRebind(componentName)  // محاولة تلقائية
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName ?: return

        // 1. تحقق من allowlist
        if (!ParserRegistry.isAllowedPackage(pkg)) return

        val notif = sbn.notification ?: return
        val extras = notif.extras ?: return

        // 2. استخرج الحقول
        val title    = extras.getString(Notification.EXTRA_TITLE)
        val text     = extras.getString(Notification.EXTRA_TEXT)
        val subText  = extras.getString(Notification.EXTRA_SUB_TEXT)
        val bigText  = extras.getString(Notification.EXTRA_BIG_TEXT)?.toString()
        val tsMs     = sbn.postTime

        Log.d(tag, "إشعار من $pkg | title=$title | text=$text")
        lastNotificationMs = System.currentTimeMillis()

        val input = NotificationInput(pkg, title, text, subText, bigText, tsMs)

        scope.launch {
            processNotification(input)
        }
    }

    private suspend fun processNotification(input: NotificationInput) {
        // 3. مرر لـ Parser
        val parsed = ParserRegistry.parse(input) ?: run {
            Log.d(tag, "Parser: لم يُعثر على بيانات مالية")
            return
        }

        val raw  = listOfNotNull(input.bigText, input.text, input.subText, input.title).joinToString(" ")
        val hash = sha256(parsed.normalizedMessage)
        val eventId = buildEventId(parsed)

        // 4. فحص الـ duplicates محليًا
        val dao = db.evidenceDao()
        if (dao.countByEventId(eventId) > 0) {
            Log.d(tag, "مكرر (event_id): $eventId")
            return
        }
        if (dao.countByMessageHash(hash) > 0) {
            Log.d(tag, "مكرر (hash): $hash")
            return
        }
        parsed.transactionId?.let {
            if (dao.countByTransactionId(it, parsed.provider) > 0) {
                Log.d(tag, "مكرر (txn_id): $it")
                return
            }
        }

        // 5. بناء EvidenceEntity
        val evidence = EvidenceEntity(
            evidenceId        = UUID.randomUUID().toString(),
            eventId           = eventId,
            provider          = parsed.provider,
            packageName       = input.packageName,
            rawMessage        = raw,
            title             = input.title,
            normalizedMessage = parsed.normalizedMessage,
            messageHash       = hash,
            amount            = parsed.amount,
            currency          = parsed.currency,
            senderPhone       = parsed.senderPhone,
            senderName        = parsed.senderName,
            recipientWallet   = parsed.recipientWallet,
            transactionId     = parsed.transactionId,
            occurredAt        = parsed.occurredAtMs,
            detectedAt        = System.currentTimeMillis(),
            confidence        = parsed.confidence.name.lowercase(),
            parserVersion     = parsed.parserVersion,
            syncStatus        = SyncStatus.PENDING,
            attempts          = 0,
            lastError         = null,
            sentAt            = null,
            createdAt         = System.currentTimeMillis()
        )

        // 6. حفظ
        val rowId = dao.insert(evidence)
        if (rowId == -1L) {
            Log.w(tag, "فشل الحفظ أو مكرر في Room")
            return
        }

        Log.i(tag, "✓ Evidence محفوظ: ${evidence.evidenceId} | مبلغ=${parsed.amount} ${parsed.currency}")

        // 7. إشعار المستخدم (اختياري حسب إعداداته)
        notifyUser(parsed)
    }

    private fun buildEventId(parsed: ParsedEvidence): String {
        val key = "${parsed.provider}:${parsed.transactionId ?: parsed.normalizedMessage}:${parsed.occurredAtMs}"
        return sha256(key).take(32)
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun notifyUser(parsed: ParsedEvidence) {
        // إشعار "تم الكشف عن دفعة" — لا يعرض البيانات الحساسة على lock screen
        Log.d(tag, "دفعة مكتشفة: ${parsed.amount} ${parsed.currency} من ${parsed.provider}")
        // TODO: NotificationManager.notify() مع visibility=PRIVATE
    }
}
