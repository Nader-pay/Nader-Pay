package com.payverify.agent.data.parser

// ─── مدخل الـ Parser ──────────────────────────────────────
data class NotificationInput(
    val packageName: String,
    val title: String?,
    val text: String?,
    val subText: String?,
    val bigText: String?,
    val timestampMs: Long
)

// ─── نتيجة الـ Parser ─────────────────────────────────────
data class ParsedEvidence(
    val provider: String,
    val amount: Double,
    val currency: String,
    val senderPhone: String?,
    val senderName: String?,
    val recipientWallet: String?,
    val transactionId: String?,
    val occurredAtMs: Long,
    val confidence: Confidence,
    val parserVersion: String,
    val normalizedMessage: String
) {
    enum class Confidence { HIGH, MEDIUM, LOW, UNKNOWN }
}

// ─── واجهة الـ Parser ──────────────────────────────────────
interface ProviderParser {
    /** قائمة package names المدعومة */
    val supportedPackages: Set<String>

    /** تحليل الإشعار — يُعيد null إذا لم يكن مطابقًا */
    fun parse(input: NotificationInput): ParsedEvidence?
}

// ─── مسجّل الـ Parsers ────────────────────────────────────
object ParserRegistry {
    private val parsers: List<ProviderParser> = listOf(
        VodafoneCashParser()
        // يمكن إضافة parsers أخرى هنا: EtisalatParser(), OrangeMoneyParser()
    )

    fun parse(input: NotificationInput): ParsedEvidence? {
        return parsers
            .filter { input.packageName in it.supportedPackages }
            .firstNotNullOfOrNull { it.parse(input) }
    }

    fun isAllowedPackage(pkg: String): Boolean =
        parsers.any { pkg in it.supportedPackages }
}
