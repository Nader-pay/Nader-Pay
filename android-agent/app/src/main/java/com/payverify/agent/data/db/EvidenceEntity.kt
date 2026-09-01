package com.payverify.agent.data.db

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// ─── حالات المزامنة ───────────────────────────────────────
enum class SyncStatus { PENDING, SENDING, SENT, FAILED, PERMANENTLY_FAILED }

// ─── Evidence Entity ──────────────────────────────────────
@Entity(
    tableName = "evidence",
    indices = [
        Index(value = ["event_id"], unique = true),
        Index(value = ["message_hash"]),
        Index(value = ["transaction_id"]),
        Index(value = ["sync_status"]),
    ]
)
data class EvidenceEntity(
    @PrimaryKey val evidenceId: String,         // UUID محلي
    val eventId: String,                         // event_id مرسل للسيرفر
    val provider: String,
    val packageName: String,
    val rawMessage: String,
    val title: String?,
    val normalizedMessage: String?,
    val messageHash: String,
    val amount: Double?,
    val currency: String?,
    val senderPhone: String?,
    val senderName: String?,
    val recipientWallet: String?,
    val transactionId: String?,
    val occurredAt: Long,                        // epoch ms
    val detectedAt: Long,
    val confidence: String,                      // high / medium / low / unknown
    val parserVersion: String,
    val syncStatus: SyncStatus,
    val attempts: Int,
    val lastError: String?,
    val sentAt: Long?,
    val createdAt: Long
)

// ─── DAO ──────────────────────────────────────────────────
@Dao
interface EvidenceDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(evidence: EvidenceEntity): Long

    @Query("SELECT * FROM evidence ORDER BY detectedAt DESC LIMIT :limit OFFSET :offset")
    fun observeAll(limit: Int = 50, offset: Int = 0): Flow<List<EvidenceEntity>>

    @Query("SELECT * FROM evidence WHERE syncStatus IN ('PENDING','FAILED') ORDER BY detectedAt ASC LIMIT 20")
    suspend fun getPendingSync(): List<EvidenceEntity>

    @Query("UPDATE evidence SET syncStatus = :status, attempts = attempts + 1, lastError = :error WHERE evidenceId = :id")
    suspend fun updateSyncStatus(id: String, status: SyncStatus, error: String? = null)

    @Query("UPDATE evidence SET syncStatus = 'SENT', sentAt = :sentAt, attempts = attempts + 1, lastError = NULL WHERE evidenceId = :id")
    suspend fun markSent(id: String, sentAt: Long)

    @Query("SELECT COUNT(*) FROM evidence WHERE syncStatus = 'PENDING' OR syncStatus = 'FAILED'")
    fun observeQueueSize(): Flow<Int>

    @Query("SELECT COUNT(*) FROM evidence WHERE detectedAt >= :since")
    suspend fun countSince(since: Long): Int

    // Deduplication checks
    @Query("SELECT COUNT(*) FROM evidence WHERE eventId = :eventId")
    suspend fun countByEventId(eventId: String): Int

    @Query("SELECT COUNT(*) FROM evidence WHERE messageHash = :hash")
    suspend fun countByMessageHash(hash: String): Int

    @Query("SELECT COUNT(*) FROM evidence WHERE transactionId = :txId AND provider = :provider")
    suspend fun countByTransactionId(txId: String, provider: String): Int

    @Query("SELECT * FROM evidence WHERE evidenceId = :id")
    suspend fun getById(id: String): EvidenceEntity?

    @Query("SELECT * FROM evidence ORDER BY detectedAt DESC LIMIT :limit OFFSET :offset")
    suspend fun getPage(limit: Int, offset: Int): List<EvidenceEntity>

    // تنظيف السجلات القديمة المرسلة (أقدم من 30 يومًا)
    @Query("DELETE FROM evidence WHERE syncStatus = 'SENT' AND sentAt < :before")
    suspend fun deleteOldSent(before: Long)
}
