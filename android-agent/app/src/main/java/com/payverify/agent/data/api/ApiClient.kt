package com.payverify.agent.data.api

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

// ─── DTOs ─────────────────────────────────────────────────

data class RegisterDeviceRequest(
    val device_name: String,
    val device_model: String,
    val os_version: String,
    val app_version: String,
    val account_id: String,
    val registration_token: String  // رمز التسجيل الأولي المشفر
)

data class RegisterDeviceResponse(
    val device_id: String,
    val device_token: String,
    val status: String
)

data class HeartbeatRequest(
    val device_id: String,
    val status: String,
    val listener_enabled: Boolean,
    val network_type: String,
    val battery_level: Int?,
    val queue_size: Int,
    val app_version: String,
    val metadata: Map<String, Any>?
)

data class HeartbeatResponse(
    val ok: Boolean,
    val revoked: Boolean = false,
    val config_update: Map<String, Any>? = null
)

data class IngestEventRequest(
    val device_id: String,
    val event_id: String,
    val event_type: String,
    val payload: Map<String, Any?>,
    val occurred_at: String,
    val idempotency_key: String
)

data class IngestEventResponse(
    val ok: Boolean,
    val event_id: String,
    val status: String,
    val duplicate: Boolean = false
)

// ─── Retrofit Service ─────────────────────────────────────
interface DeviceApiService {

    @POST("device-api/register")
    suspend fun registerDevice(
        @Header("Authorization") apiKey: String,
        @Body body: RegisterDeviceRequest
    ): Response<RegisterDeviceResponse>

    @POST("device-api/heartbeat")
    suspend fun heartbeat(
        @Header("X-Device-Token") deviceToken: String,
        @Body body: HeartbeatRequest
    ): Response<HeartbeatResponse>

    @POST("device-api/events/ingest")
    suspend fun ingestEvent(
        @Header("X-Device-Token") deviceToken: String,
        @Body body: IngestEventRequest
    ): Response<IngestEventResponse>
}

// ─── Factory ──────────────────────────────────────────────
object ApiClientFactory {

    fun create(baseUrl: String): DeviceApiService {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl.trimEnd('/') + '/')
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(DeviceApiService::class.java)
    }
}
