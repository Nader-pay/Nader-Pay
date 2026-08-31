package com.payverify.agent.data.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * SecureStorage — تخزين آمن باستخدام Android Keystore
 * يُستخدم لـ: device_token, device_id, api credentials
 */
class SecureStorage(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "payverify_secure_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    // ─── Device Identity ──────────────────────────────────

    var deviceId: String?
        get()  = prefs.getString(KEY_DEVICE_ID, null)
        set(v) = prefs.edit().apply {
            if (v == null) remove(KEY_DEVICE_ID) else putString(KEY_DEVICE_ID, v)
        }.apply()

    var deviceToken: String?
        get()  = prefs.getString(KEY_DEVICE_TOKEN, null)
        set(v) = prefs.edit().apply {
            if (v == null) remove(KEY_DEVICE_TOKEN) else putString(KEY_DEVICE_TOKEN, v)
        }.apply()

    var accountId: String?
        get()  = prefs.getString(KEY_ACCOUNT_ID, null)
        set(v) = prefs.edit().apply {
            if (v == null) remove(KEY_ACCOUNT_ID) else putString(KEY_ACCOUNT_ID, v)
        }.apply()

    var apiBaseUrl: String?
        get()  = prefs.getString(KEY_API_BASE_URL, null)
        set(v) = prefs.edit().apply {
            if (v == null) remove(KEY_API_BASE_URL) else putString(KEY_API_BASE_URL, v)
        }.apply()

    /** هل الجهاز مُسجَّل بالسيرفر */
    val isRegistered: Boolean
        get() = deviceId != null && deviceToken != null

    /** مسح جميع البيانات (عند revoke) */
    fun clearAll() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_DEVICE_ID    = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_ACCOUNT_ID   = "account_id"
        private const val KEY_API_BASE_URL = "api_base_url"
    }
}
