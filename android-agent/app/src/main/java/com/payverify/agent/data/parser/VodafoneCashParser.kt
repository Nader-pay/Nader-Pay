package com.payverify.agent.data.parser

/**
 * Vodafone Cash Parser — نسخة v2
 *
 * يدعم أشكال رسائل متعددة بدون إصدار التطبيق عبر PATTERNS list.
 * أضف pattern جديد في القائمة فقط مع رقم إصدار config.
 *
 * نموذج رسالة:
 * "تم استلام 400.00 جنيه من Wessam A Ahmed Ali 01030951228
 *  إلى محفظتك 01097273680
 *  رقم العملية: 022896233255"
 */
class VodafoneCashParser : ProviderParser {

    override val supportedPackages: Set<String> = setOf(
        "com.vodafone.myvodafone",
        "com.vodafone.android",
        "com.vfeg.vodafonecash"
    )

    // ─── تعريف الأنماط (قابل للتوسع بدون recompile) ──────
    private data class ParserPattern(
        val version: String,
        val amountRegex: Regex,
        val senderPhoneRegex: Regex?,
        val senderNameRegex: Regex?,
        val recipientRegex: Regex?,
        val transactionIdRegex: Regex?,
        val currencyGroup: Int = 2,
        val confidence: ParsedEvidence.Confidence = ParsedEvidence.Confidence.HIGH
    )

    private val patterns: List<ParserPattern> = listOf(
        // ─── v2: صيغة "تم استلام X جنيه من NAME PHONE إلى WALLET رقم العملية: TXN"
        ParserPattern(
            version = "vf_v2",
            amountRegex = Regex("""(?:تم\s+)?(?:استلام|إيداع|تحويل)\s+([\d,.]+)\s*(جنيه|EGP|LE)""", RegexOption.IGNORE_CASE),
            senderPhoneRegex = Regex("""من\s+(?:[^0-9\n]+?\s+)?(0[0-9]{10})"""),
            senderNameRegex  = Regex("""من\s+([^\d\n]{3,50}?)\s+0[0-9]{10}"""),
            recipientRegex   = Regex("""(?:إلى\s+محفظتك|محفظة)\s+(0[0-9]{10})"""),
            transactionIdRegex = Regex("""(?:رقم العملية|رقم\s+المعاملة)[:\s]+([\d]+)"""),
        ),
        // ─── v1: صيغة إنجليزية "You received EGP X from NAME (PHONE)"
        ParserPattern(
            version = "vf_v1",
            amountRegex = Regex("""(?:received|sent|transferred)\s+(?:EGP|LE|جنيه)\s*([\d,.]+)""", RegexOption.IGNORE_CASE),
            senderPhoneRegex = Regex("""\(?(0[0-9]{10})\)?"""),
            senderNameRegex  = Regex("""from\s+([A-Za-z][A-Za-z\s]{2,40}?)\s+(?:\(|0[0-9])""", RegexOption.IGNORE_CASE),
            recipientRegex   = Regex("""to\s+wallet\s+(0[0-9]{10})""", RegexOption.IGNORE_CASE),
            transactionIdRegex = Regex("""(?:Ref|TxnId|Transaction ID)[.:\s]+([\d]+)""", RegexOption.IGNORE_CASE),
            currencyGroup = 1,
            confidence = ParsedEvidence.Confidence.HIGH
        ),
    )

    override fun parse(input: NotificationInput): ParsedEvidence? {
        // دمج النصوص المتاحة
        val fullText = listOfNotNull(
            input.bigText, input.text, input.subText, input.title
        ).joinToString(" \n ")

        if (fullText.isBlank()) return null

        // تحقق من وجود كلمات مفتاحية لتصفية سريعة
        val isPaymentNotification = PAYMENT_KEYWORDS.any { fullText.contains(it, ignoreCase = true) }
        if (!isPaymentNotification) return null

        // جرب كل نمط بالترتيب
        for (pattern in patterns) {
            val result = tryPattern(pattern, fullText, input.timestampMs)
            if (result != null) return result
        }

        return null
    }

    private fun tryPattern(
        pattern: ParserPattern,
        fullText: String,
        fallbackTimestampMs: Long
    ): ParsedEvidence? {
        // المبلغ (مطلوب)
        val amountMatch = pattern.amountRegex.find(fullText) ?: return null
        val amountStr   = amountMatch.groupValues[1].replace(",", "")
        val amount      = amountStr.toDoubleOrNull() ?: return null
        if (amount <= 0) return null

        val currency = if (amountMatch.groupValues.size > pattern.currencyGroup)
            normalizeCurrency(amountMatch.groupValues[pattern.currencyGroup])
        else "EGP"

        val senderPhone    = pattern.senderPhoneRegex?.find(fullText)?.groupValues?.getOrNull(1)?.let { normalizePhone(it) }
        val senderName     = pattern.senderNameRegex?.find(fullText)?.groupValues?.getOrNull(1)?.trim()?.takeIf { it.length >= 3 }
        val recipientWallet = pattern.recipientRegex?.find(fullText)?.groupValues?.getOrNull(1)?.let { normalizePhone(it) }
        val transactionId  = pattern.transactionIdRegex?.find(fullText)?.groupValues?.getOrNull(1)?.trim()

        // بناء الرسالة المُعيَّرة
        val normalized = buildNormalized(amount, currency, senderPhone, senderName, recipientWallet, transactionId)

        return ParsedEvidence(
            provider        = "vodafone_cash",
            amount          = amount,
            currency        = currency,
            senderPhone     = senderPhone,
            senderName      = senderName,
            recipientWallet = recipientWallet,
            transactionId   = transactionId,
            occurredAtMs    = fallbackTimestampMs,
            confidence      = if (senderPhone != null) pattern.confidence else ParsedEvidence.Confidence.MEDIUM,
            parserVersion   = pattern.version,
            normalizedMessage = normalized
        )
    }

    // ─── مساعدات ──────────────────────────────────────────

    private fun normalizePhone(raw: String): String {
        var p = raw.replace(Regex("""[\s\-\(\)]"""), "")
        if (p.startsWith("+20")) p = "0" + p.substring(3)
        if (p.startsWith("20") && p.length == 12) p = "0" + p.substring(2)
        return p
    }

    private fun normalizeCurrency(raw: String): String = when (raw.trim().lowercase()) {
        "جنيه", "le", "egp", "جنيه مصري" -> "EGP"
        else -> raw.uppercase().trim().ifEmpty { "EGP" }
    }

    private fun buildNormalized(
        amount: Double, currency: String,
        senderPhone: String?, senderName: String?,
        recipientWallet: String?, transactionId: String?
    ): String = buildString {
        append("PAYMENT:$currency:$amount")
        senderPhone?.let { append("|FROM:$it") }
        senderName?.let  { append("|NAME:$it") }
        recipientWallet?.let { append("|TO:$it") }
        transactionId?.let { append("|TXN:$it") }
    }

    companion object {
        private val PAYMENT_KEYWORDS = listOf(
            "تم استلام", "تم إيداع", "تحويل", "received", "sent", "transferred",
            "فودافون كاش", "vodafone cash", "دفع", "payment"
        )
    }
}
