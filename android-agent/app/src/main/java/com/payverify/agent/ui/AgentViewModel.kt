package com.payverify.agent.ui

import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.payverify.agent.data.api.ApiClientFactory
import com.payverify.agent.data.api.SyncQueue
import com.payverify.agent.data.db.AgentDatabase
import com.payverify.agent.data.security.SecureStorage
import com.payverify.agent.domain.EvidenceItem
import com.payverify.agent.domain.SystemStatus
import com.payverify.agent.domain.toDomain
import com.payverify.agent.services.PaymentNotificationListenerService
import com.payverify.agent.workers.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class AgentViewModel(
    private val context: Context,
    private val db: AgentDatabase,
    private val secureStorage: SecureStorage
) : ViewModel() {

    // ─── Evidence List ────────────────────────────────────
    val evidenceList: StateFlow<List<EvidenceItem>> = db.evidenceDao()
        .observeAll(50, 0)
        .map { list -> list.map { it.toDomain() } }
        .stateIn(viewModelScope, SharingStarted.Lazily, emptyList())

    // ─── Queue Size ───────────────────────────────────────
    val queueSize: StateFlow<Int> = db.evidenceDao()
        .observeQueueSize()
        .stateIn(viewModelScope, SharingStarted.Lazily, 0)

    // ─── System Status ────────────────────────────────────
    private val _systemStatus = MutableStateFlow(buildStatus())
    val systemStatus: StateFlow<SystemStatus> = _systemStatus.asStateFlow()

    private val _lastSyncMs = MutableStateFlow<Long?>(null)
    private val _todayCount = MutableStateFlow(0)

    init {
        refreshStatus()
        // تحديث دوري كل 30 ثانية
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(30_000)
                refreshStatus()
            }
        }
    }

    fun refreshStatus() {
        viewModelScope.launch(Dispatchers.IO) {
            val midnight = System.currentTimeMillis() - (System.currentTimeMillis() % TimeUnit.DAYS.toMillis(1))
            val today = db.evidenceDao().countSince(midnight)
            _todayCount.value = today

            _systemStatus.value = SystemStatus(
                serverConnected   = isNetworkAvailable(),
                listenerActive    = PaymentNotificationListenerService.isConnected,
                queueSize         = queueSize.value,
                todayCount        = today,
                lastSyncMs        = _lastSyncMs.value,
                deviceRegistered  = secureStorage.isRegistered
            )
        }
    }

    // ─── Manual Sync ──────────────────────────────────────
    private val _syncLoading = MutableStateFlow(false)
    val syncLoading: StateFlow<Boolean> = _syncLoading.asStateFlow()

    fun triggerSync() {
        viewModelScope.launch(Dispatchers.IO) {
            _syncLoading.value = true
            try {
                val apiUrl = secureStorage.apiBaseUrl ?: return@launch
                val queue  = SyncQueue(context, db, secureStorage, apiUrl)
                queue.processQueue()
                _lastSyncMs.value = System.currentTimeMillis()
                SyncWorker.enqueueImmediateSync(context)
            } finally {
                _syncLoading.value = false
                refreshStatus()
            }
        }
    }

    // ─── Evidence Detail ──────────────────────────────────
    suspend fun getEvidence(id: String): EvidenceItem? =
        db.evidenceDao().getById(id)?.toDomain()

    private fun buildStatus() = SystemStatus(
        serverConnected  = false,
        listenerActive   = PaymentNotificationListenerService.isConnected,
        queueSize        = 0,
        todayCount       = 0,
        lastSyncMs       = null,
        deviceRegistered = secureStorage.isRegistered
    )

    private fun isNetworkAvailable(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val cap = cm.getNetworkCapabilities(net) ?: return false
        return cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    // ─── Factory ──────────────────────────────────────────
    class Factory(
        private val context: Context,
        private val db: AgentDatabase,
        private val secureStorage: SecureStorage
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T =
            AgentViewModel(context.applicationContext, db, secureStorage) as T
    }
}
