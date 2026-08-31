package com.payverify.agent.data.parser

import org.junit.Assert.*
import org.junit.Test

/**
 * اختبارات VodafoneCash Parser — تغطي:
 * - رسائل v2 عربية
 * - رسائل v1 إنجليزية
 * - رسائل بدون transactionId
 * - رسائل غير مالية (يجب أن تُرجع null)
 * - تطبيع أرقام الهاتف
 */
class VodafoneCashParserTest {

    private val parser = VodafoneCashParser()

    private fun input(text: String, title: String? = null, pkg: String = "com.vodafone.myvodafone") =
        NotificationInput(pkg, title, text, null, null, System.currentTimeMillis())

    // ─── v2 Arabic ────────────────────────────────────────

    @Test
    fun `parse standard arabic v2 message`() {
        val result = parser.parse(input(
            "تم استلام 400.00 جنيه من Wessam A Ahmed Ali 01030951228 إلى محفظتك 01097273680 رقم العملية: 022896233255"
        ))
        assertNotNull(result)
        assertEquals(400.0, result!!.amount, 0.01)
        assertEquals("EGP", result.currency)
        assertEquals("01030951228", result.senderPhone)
        assertEquals("01097273680", result.recipientWallet)
        assertEquals("022896233255", result.transactionId)
        assertEquals("vodafone_cash", result.provider)
        assertEquals(ParsedEvidence.Confidence.HIGH, result.confidence)
    }

    @Test
    fun `parse arabic v2 without transaction id`() {
        val result = parser.parse(input(
            "تم استلام 150 جنيه من محمد أحمد 01012345678 إلى محفظتك 01097273680"
        ))
        assertNotNull(result)
        assertEquals(150.0, result!!.amount, 0.01)
        assertNull(result.transactionId)
        assertEquals(ParsedEvidence.Confidence.HIGH, result.confidence)
    }

    @Test
    fun `parse arabic v2 amount with comma`() {
        val result = parser.parse(input(
            "تم استلام 1,250.50 جنيه من علي حسن 01156789012 إلى محفظتك 01097273680 رقم العملية: 998877665"
        ))
        assertNotNull(result)
        assertEquals(1250.50, result!!.amount, 0.01)
    }

    // ─── v1 English ───────────────────────────────────────

    @Test
    fun `parse english v1 received message`() {
        val result = parser.parse(input(
            "You received EGP 200 from John Doe (01098765432) to wallet 01097273680 Ref: 112233445"
        ))
        assertNotNull(result)
        assertEquals(200.0, result!!.amount, 0.01)
        assertEquals("01098765432", result.senderPhone)
        assertEquals("01097273680", result.recipientWallet)
        assertEquals("112233445", result.transactionId)
    }

    // ─── Phone normalization ──────────────────────────────

    @Test
    fun `phone with country code +20 is normalized`() {
        val result = parser.parse(input(
            "تم استلام 100 جنيه من Ahmed +201030951228 إلى محفظتك 01097273680"
        ))
        assertNotNull(result)
        assertEquals("01030951228", result!!.senderPhone)
    }

    // ─── Non-payment messages ─────────────────────────────

    @Test
    fun `non-payment notification returns null`() {
        val result = parser.parse(input("مرحبًا! تحقق من عرضنا الجديد على الإنترنت"))
        assertNull(result)
    }

    @Test
    fun `wrong package returns null from registry`() {
        val input = NotificationInput("com.example.other", null, "تم استلام 100 جنيه", null, null, System.currentTimeMillis())
        val result = ParserRegistry.parse(input)
        assertNull(result)
    }

    @Test
    fun `valid vodafone package passes registry`() {
        val input = NotificationInput(
            "com.vodafone.myvodafone",
            "فودافون كاش",
            "تم استلام 300.00 جنيه من سارة 01098765432 إلى محفظتك 01097273680 رقم العملية: 555444333",
            null, null, System.currentTimeMillis()
        )
        val result = ParserRegistry.parse(input)
        assertNotNull(result)
        assertEquals(300.0, result!!.amount, 0.01)
    }

    // ─── Normalized message format ────────────────────────

    @Test
    fun `normalized message contains all fields`() {
        val result = parser.parse(input(
            "تم استلام 400.00 جنيه من Wessam 01030951228 إلى محفظتك 01097273680 رقم العملية: 022896233255"
        ))
        assertNotNull(result)
        assertTrue(result!!.normalizedMessage.contains("PAYMENT:EGP:400.0"))
        assertTrue(result.normalizedMessage.contains("FROM:01030951228"))
        assertTrue(result.normalizedMessage.contains("TO:01097273680"))
        assertTrue(result.normalizedMessage.contains("TXN:022896233255"))
    }
}
