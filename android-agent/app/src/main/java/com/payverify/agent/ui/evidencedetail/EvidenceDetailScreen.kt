package com.payverify.agent.ui.evidencedetail

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.db.EvidenceEntity
import com.payverify.agent.domain.EvidenceItem
import com.payverify.agent.domain.toDomain
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

/**
 * Evidence Detail Screen
 * يعرض الرسالة الأصلية فقط للمستخدم المُصرَّح له (داخل التطبيق)
 * يحظر عرض البيانات المالية الحساسة على lock screen
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EvidenceDetailScreen(
    evidenceId: String,
    db: AgentDatabase,
    onBack: () -> Unit
) {
    var item by remember { mutableStateOf<EvidenceItem?>(null) }
    var rawMessage by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var showRaw by remember { mutableStateOf(false) }

    LaunchedEffect(evidenceId) {
        withContext(Dispatchers.IO) {
            val entity = db.evidenceDao().getById(evidenceId)
            item = entity?.toDomain()
            rawMessage = entity?.rawMessage
            loading = false
        }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("تفاصيل الدفعة", fontWeight = FontWeight.SemiBold, fontSize = 18.sp) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "رجوع")
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize().padding(padding)) {
            when {
                loading -> CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                item == null -> Text("لم يُعثر على Evidence", modifier = Modifier.align(Alignment.Center))
                else -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 20.dp, vertical = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        val ev = item!!

                        DetailCard(title = "معلومات الدفعة") {
                            DetailRow("مزود الخدمة", ev.providerLabel)
                            ev.amount?.let { DetailRow("المبلغ", "%.2f ${ev.currency ?: "EGP"}".format(it)) }
                            ev.senderPhone?.let { DetailRow("رقم المُرسِل", it) }
                            ev.senderName?.let { DetailRow("اسم المُرسِل", it) }
                            ev.recipientWallet?.let { DetailRow("المحفظة المستقبِلة", it) }
                            ev.transactionId?.let { DetailRow("رقم العملية", it) }
                        }

                        DetailCard(title = "حالة المزامنة") {
                            DetailRow("الحالة", ev.syncStatusLabel)
                            DetailRow("المحاولات", ev.attempts.toString())
                            DetailRow("وقت الاكتشاف", formatFull(ev.detectedAt))
                            DetailRow("الثقة", confidenceLabel(ev.confidence))
                            DetailRow("نسخة الـ Parser", ev.syncStatus.name)
                        }

                        // ─── الرسالة الأصلية (محمية) ──────────────────────
                        DetailCard(title = "الرسالة الأصلية") {
                            if (!showRaw) {
                                Text(
                                    "اضغط لعرض الرسالة الأصلية",
                                    fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Spacer(Modifier.height(4.dp))
                                OutlinedButton(
                                    onClick = { showRaw = true },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(Icons.Default.Visibility, null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("عرض المحتوى", fontSize = 13.sp)
                                }
                            } else {
                                Text(
                                    rawMessage ?: "—",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.onBackground,
                                    lineHeight = 20.sp
                                )
                                Spacer(Modifier.height(4.dp))
                                TextButton(
                                    onClick = { showRaw = false },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("إخفاء", fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier  = Modifier.fillMaxWidth(),
        shape     = MaterialTheme.shapes.medium,
        colors    = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            content()
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onBackground)
    }
}

private fun formatFull(ms: Long) =
    SimpleDateFormat("d MMM yyyy  HH:mm", Locale.getDefault()).format(Date(ms))

private fun confidenceLabel(c: String) = when (c.lowercase()) {
    "high"   -> "عالية"
    "medium" -> "متوسطة"
    "low"    -> "منخفضة"
    else     -> "غير معروف"
}
