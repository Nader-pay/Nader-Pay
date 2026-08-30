package com.payverify.agent.ui.activity

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.payverify.agent.data.db.SyncStatus
import com.payverify.agent.domain.EvidenceItem
import com.payverify.agent.ui.AgentViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(
    viewModel: AgentViewModel,
    onEvidenceClick: (String) -> Unit,
    onBack: () -> Unit
) {
    val list by viewModel.evidenceList.collectAsState()

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("سجل النشاط", fontWeight = FontWeight.SemiBold, fontSize = 18.sp) },
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
        if (list.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Inbox, null, modifier = Modifier.size(48.dp), tint = MaterialTheme.colorScheme.outline)
                    Text("لا توجد دفعات مكتشفة بعد", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(list, key = { it.evidenceId }) { ev ->
                    EvidenceCard(
                        item    = ev,
                        onClick = { onEvidenceClick(ev.evidenceId) }
                    )
                }
            }
        }
    }
}

@Composable
private fun EvidenceCard(item: EvidenceItem, onClick: () -> Unit) {
    Card(
        modifier  = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape     = MaterialTheme.shapes.medium,
        colors    = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(0.dp),
        border    = ButtonDefaults.outlinedButtonBorder(true)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // مؤشر الحالة
            Surface(
                color = syncColor(item.syncStatus),
                shape = MaterialTheme.shapes.extraSmall,
                modifier = Modifier.size(width = 4.dp, height = 44.dp)
            ) {}

            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(item.providerLabel, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onBackground)
                    Text(
                        "${item.amount?.let { "%.2f".format(it) } ?: "—"} ${item.currency ?: ""}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                if (item.transactionId != null) {
                    Text(
                        "TXN: ${item.transactionId}",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        formatRelative(item.detectedAt),
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        item.syncStatusLabel,
                        fontSize = 11.sp,
                        color = syncColor(item.syncStatus)
                    )
                }
            }

            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun syncColor(status: SyncStatus) = when (status) {
    SyncStatus.SENT               -> MaterialTheme.colorScheme.primary
    SyncStatus.PENDING, SyncStatus.SENDING -> MaterialTheme.colorScheme.tertiary
    SyncStatus.FAILED, SyncStatus.PERMANENTLY_FAILED -> MaterialTheme.colorScheme.error
}

private fun formatRelative(ms: Long): String {
    val diff = System.currentTimeMillis() - ms
    val mins = diff / 60_000
    return when {
        mins < 1  -> "الآن"
        mins < 60 -> "منذ $mins د"
        mins < 1440 -> "منذ ${mins/60} س"
        else -> SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ms))
    }
}
