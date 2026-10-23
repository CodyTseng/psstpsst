package chat.psstpsst.app.napplet

import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject

internal fun publicAddress(address: InetAddress): Boolean {
  if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
  val b = address.address.map { it.toInt() and 255 }
  if (b.size == 16) return (b[0] and 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 1 && b[2] == 0x0d && b[3] == 0xb8)
  return b.size == 4 && b[0] != 0 && b[0] < 224 && !(b[0] == 100 && b[1] in 64..127) && !(b[0] == 198 && b[1] in 18..19)
}

/** Fake-IP VPN DNS may return private addresses for public names. Resolve those
 * names independently, then pin OkHttp to public answers with normal hostname TLS.
 * Neither the proxy's synthetic address nor private DoH answers are ever admitted.
 */
internal class PublicDns(
  private val system: Dns = Dns.SYSTEM,
  private val fallback: Dns = PublicHttpsDns(),
) : Dns {
  override fun lookup(hostname: String): List<InetAddress> {
    val addresses = system.lookup(hostname)
    if (addresses.isNotEmpty() && addresses.all(::publicAddress)) return addresses
    // Never turn an explicit private IP into a query to a public resolver.
    if (hostname.contains(':') || hostname.matches(Regex("[0-9.]+")))
      throw UnknownHostException("blocked-by-policy")
    return fallback.lookup(hostname).also { resolved ->
      if (resolved.isEmpty() || !resolved.all(::publicAddress))
        throw UnknownHostException("blocked-by-policy")
    }
  }
}

private class PublicHttpsDns : Dns {
  private data class Cached(val addresses: List<InetAddress>, val expires: Long)
  private val cache = LinkedHashMap<String, Cached>()
  private val resolvers = listOf(
    "https://cloudflare-dns.com/dns-query" to listOf("1.1.1.1", "1.0.0.1"),
    "https://dns.google/resolve" to listOf("8.8.8.8", "8.8.4.4"),
  ).map { (endpoint, bootstrap) ->
    val host = endpoint.toHttpUrl().host
    val client = OkHttpClient.Builder()
      .proxy(Proxy.NO_PROXY)
      .followRedirects(false).followSslRedirects(false)
      .connectTimeout(3, TimeUnit.SECONDS).callTimeout(5, TimeUnit.SECONDS)
      .dns(object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
          require(hostname == host) { "blocked-by-policy" }
          return bootstrap.map { InetAddress.getByName(it) }
        }
      }).build()
    endpoint to client
  }

  override fun lookup(hostname: String): List<InetAddress> {
    val now = android.os.SystemClock.elapsedRealtime()
    synchronized(cache) { cache[hostname]?.takeIf { it.expires > now }?.let { return it.addresses } }
    for ((endpoint, client) in resolvers) {
      try {
        val url = endpoint.toHttpUrl().newBuilder()
          .addQueryParameter("name", hostname).addQueryParameter("type", "A").build()
        client.newCall(Request.Builder().url(url).header("Accept", "application/dns-json").build())
          .execute().use { response ->
            if (response.code != 200) return@use
            val body = response.body ?: return@use
            // Bound even chunked responses before parsing untrusted DNS JSON.
            val bytes = body.byteStream().use { input ->
              val output = java.io.ByteArrayOutputStream()
              val buffer = ByteArray(4096)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                require(output.size() + count <= 32768) { "DNS response too large" }
                output.write(buffer, 0, count)
              }
              output.toByteArray()
            }
            val json = JSONObject(String(bytes, Charsets.UTF_8))
            if (json.optInt("Status", -1) != 0 || json.optBoolean("TC")) return@use
            val answer = json.optJSONArray("Answer") ?: return@use
            val resolved = mutableListOf<InetAddress>()
            var ttl = 60
            for (index in 0 until answer.length().coerceAtMost(64)) {
              val record = answer.optJSONObject(index) ?: continue
              if (record.optInt("type") != 1) continue
              val value = record.optString("data")
              if (!value.matches(Regex("(?:[0-9]{1,3}\\.){3}[0-9]{1,3}"))) continue
              val address = InetAddress.getByName(value)
              require(publicAddress(address)) { "blocked-by-policy" }
              resolved.add(address)
              ttl = minOf(ttl, record.optInt("TTL", 0).coerceAtLeast(0))
            }
            if (resolved.isEmpty()) return@use
            val unique = resolved.distinct()
            synchronized(cache) {
              if (cache.size >= 64) cache.remove(cache.keys.first())
              cache[hostname] = Cached(unique, android.os.SystemClock.elapsedRealtime() + ttl * 1000L)
            }
            return unique
          }
      } catch (_: Exception) { /* Try the other pinned resolver; never use the private answer. */ }
    }
    throw UnknownHostException("blocked-by-policy: no public DNS answer for $hostname")
  }
}
