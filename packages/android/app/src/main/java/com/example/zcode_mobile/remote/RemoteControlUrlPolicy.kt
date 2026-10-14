package com.example.zcode_mobile.remote

import android.net.Uri
import com.example.zcode_mobile.BuildConfig

private const val ZCODE_REMOTE_SCHEME = "zcode"
private const val ZCODE_REMOTE_HOST = "remote"

// Polaris：生产远控域由上游 zcode.z.ai 改指自有域名（与 shared 的
// DEFAULT_ZCODE_ENDPOINT_ORIGIN 同源；`/remote/v3` 由该域拼出）。
// 深链 scheme `zcode://remote` 是协议标识（二维码之外的自有入口），与域名无关，不改。
private const val POLARIS_REMOTE_HOST = "nimbus.bitlesu.com"

object RemoteControlUrlPolicy {
    fun resolve(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) {
            return null
        }

        val uri = runCatching { Uri.parse(trimmed) }.getOrNull() ?: return null
        return resolve(uri)
    }

    fun resolve(uri: Uri?): String? {
        if (uri == null) {
            return null
        }

        if (uri.scheme == ZCODE_REMOTE_SCHEME && uri.host == ZCODE_REMOTE_HOST) {
            return buildDefaultRemoteUrl(uri)
        }

        if (isAllowedRemoteUrl(uri)) {
            return uri.toString()
        }

        return null
    }

    fun isAllowedRemoteUrl(raw: String?): Boolean {
        val uri = runCatching { Uri.parse(raw?.trim().orEmpty()) }.getOrNull() ?: return false
        return isAllowedRemoteUrl(uri)
    }

    private fun buildDefaultRemoteUrl(uri: Uri): String {
        val base = Uri.parse(BuildConfig.REMOTE_CONTROL_DEFAULT_URL).buildUpon()
        uri.encodedQuery?.let { base.encodedQuery(it) }
        uri.encodedFragment?.let { base.encodedFragment(it) }
        return base.build().toString()
    }

    private fun isAllowedRemoteUrl(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase().orEmpty()
        val path = uri.path.orEmpty()

        if (scheme == "https" && host == POLARIS_REMOTE_HOST && path.startsWith("/remote")) {
            return true
        }

        if (!BuildConfig.DEBUG) {
            return false
        }

        // Bugfix: 开发机真机调试时二维码会指向局域网 Vite 地址。
        // 生产包仍只允许自有远控域，debug 包才放开测试域、本机和局域网 http/https，避免远控壳变成任意浏览器。
        if (!path.startsWith("/remote")) {
            return false
        }
        if (host == POLARIS_REMOTE_HOST) {
            return scheme == "https"
        }
        return (scheme == "http" || scheme == "https") && isDebugHost(host)
    }

    private fun isDebugHost(host: String): Boolean {
        if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") {
            return true
        }
        if (host.endsWith(".local")) {
            return true
        }
        if (host.startsWith("192.168.") || host.startsWith("10.")) {
            return true
        }
        return Regex("^172\\.(1[6-9]|2\\d|3[0-1])\\.").containsMatchIn(host)
    }
}
