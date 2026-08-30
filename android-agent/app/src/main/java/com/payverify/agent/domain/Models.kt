package com.payverify.agent.domain

import com.payverify.agent.data.db.EvidenceEntity
import com.payverify.agent.data.db.SyncStatus

// ─── نموذج Domain لـ Evidence ────────────────────────────
data class EvidenceItem(
    val evidenceId: String,
    val provider: String,
    val amount: Double?,
    val currency: String?,
    val senderPhone: String?,
    val senderName: String?,
    val recipientWallet: String?,
    val transactionId: String?,
    val detectedAt: Long,
    val confidence: String,
    val syncStatus: SyncStatus,
    val attempts: Int
) {
    val providerLabel: String get() = when (provider) {
        "vodafone_cash" -> "Vodafone Cash"
        "etisalat_cash" -> "Etisalat Cash"
        "orange_money"  -> "Orange Money"
        "fawry"         -> "Fawry"
        else            -> provider.replaceFirstChar { it.uppercase() }
    }

    val syncStatusLabel: String get() = when (syncStatus) {
        SyncStatus.PENDING            -> "قيد الإرسال"
        SyncStatus.SENDING            -> "جاري الإرسال"
        SyncStatus.SENT               -> "تم الإرسال"
        SyncStatus.FAILED             -> "فشل الإرسال"
        SyncStatus.PERMANENTLY_FAILED -> "فشل دائم"
    }

    val isSent: Boolean get() = syncStatus == SyncStatus.SENT
}

fun EvidenceEntity.toDomain() = EvidenceItem(
    evidenceId      = evidenceId,
    provider        = provider,
    amount          = amount,
    currency        = currency,
    senderPhone     = senderPhone,
    senderName      = senderName,
    recipientWallet = recipientWallet,
    transactionId   = transactionId,
    detectedAt      = detectedAt,
    confidence      = confidence,
    syncStatus      = syncStatus,
    attempts        = attempts
)

// ─── حالة النظام ─────────────────────────────────────────
data class SystemStatus(
    val serverConnected: Boolean,
    val listenerActive: Boolean,
    val queueSize: Int,
    val todayCount: Int,
    val lastSyncMs: Long?,
    val deviceRegistered: Boolean
)
