package com.payverify.agent.ui.dashboard

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.payverify.agent.domain.SystemStatus
import com.payverify.agent.ui.AgentViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: AgentViewModel,
    onNavigateToActivity: () -> Unit
) {
    val status     by viewModel.systemStatus.collectAsState()
    val queueSize  by viewModel.queueSize.collectAsState()
    val syncLoading by viewModel.syncLoading.collectAsState()

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        "PayVerify Agent",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 18.sp
                    )
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {

            // ─── اتصال السيرفر ────────────────────────────
            StatusRow(
                icon  = if (status.serverConnected) Icons.Default.CloudDone else Icons.Default.CloudOff,
                label = if (status.serverConnected) "متصل بالسيرفر" else "غير متصل بالسيرفر",
                color = if (status.serverConnected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            )

            // ─── مستمع الإشعارات ──────────────────────────
            StatusRow(
                icon  = if (status.listenerActive) Icons.Default.NotificationsActive else Icons.Default.NotificationsOff,
                label = if (status.listenerActive) "مستمع الإشعارات نشط" else "مستمع الإشعارات غير نشط",
                color = if (status.listenerActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            )

            // ─── تسجيل الجهاز ────────────────────────────
            StatusRow(
                icon  = if (status.deviceRegistered) Icons.Default.PhoneAndroid else Icons.Default.PhoneLocked,
                label = if (status.deviceRegistered) "الجهاز مُسجَّل" else "الجهاز غير مُسجَّل",
                color = if (status.deviceRegistered) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
            )

            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            // ─── بطاقات الإحصاء ──────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    value    = queueSize.toString(),
                    label    = "في الطابور",
                    icon     = Icons.Default.Pending
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    value    = status.todayCount.toString(),
                    label    = "اليوم",
                    icon     = Icons.Default.CheckCircle
                )
            }

            // ─── آخر مزامنة ───────────────────────────────
            if (status.lastSyncMs != null) {
                Text(
                    text = "آخر مزامنة: ${formatTime(status.lastSyncMs!!)}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // ─── زر المزامنة اليدوية ──────────────────────
            Button(
                onClick  = { viewModel.triggerSync() },
                enabled  = !syncLoading && status.serverConnected,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape    = MaterialTheme.shapes.medium
            ) {
                if (syncLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color    = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(Icons.Default.Sync, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("مزامنة الآن", fontWeight = FontWeight.Medium)
                }
            }

            // ─── رابط النشاط ─────────────────────────────
            OutlinedButton(
                onClick  = onNavigateToActivity,
                modifier = Modifier.fillMaxWidth().height(50.dp),
                shape    = MaterialTheme.shapes.medium
            ) {
                Icon(Icons.Default.History, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("عرض سجل النشاط", fontWeight = FontWeight.Medium)
            }

            // ─── تحذير الصلاحيات ─────────────────────────
            if (!status.listenerActive) {
                WarningCard("مستمع الإشعارات غير نشط — لن يتم اكتشاف الدفعات تلقائيًا")
            }
            if (!status.deviceRegistered) {
                WarningCard("الجهاز غير مُسجَّل — يرجى تسجيل الجهاز أولًا من الإعدادات")
            }
        }
    }
}

@Composable
private fun StatusRow(icon: ImageVector, label: String, color: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(icon, null, tint = color, modifier = Modifier.size(20.dp))
        Text(label, fontSize = 14.sp, color = MaterialTheme.colorScheme.onBackground)
    }
}

@Composable
private fun StatCard(modifier: Modifier, value: String, label: String, icon: ImageVector) {
    Card(
        modifier = modifier,
        colors   = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape    = MaterialTheme.shapes.medium,
        elevation = CardDefaults.cardElevation(0.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(icon, null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
            Text(value, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun WarningCard(message: String) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.size(18.dp))
            Text(message, fontSize = 13.sp, color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
}

private fun formatTime(ms: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))
