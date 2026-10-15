package chat.psstpsst.app.napplet

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns
import org.junit.Assert.*
import org.junit.Test

class PublicDnsTest {
  private fun addresses(vararg values: String) = values.map(InetAddress::getByName)
  private fun resolver(answer: List<InetAddress>) = object : Dns {
    override fun lookup(hostname: String) = answer
  }

  @Test fun publicSystemAnswersDoNotUseFallback() {
    val public = addresses("159.198.46.2")
    val dns = PublicDns(resolver(public), object : Dns {
      override fun lookup(hostname: String): List<InetAddress> = error("Unexpected fallback")
    })
    assertEquals(public, dns.lookup("blossom.napplet.soy"))
  }

  @Test fun fakeIpDnsUsesIndependentlyResolvedPublicAddress() {
    val public = addresses("159.198.46.2")
    val dns = PublicDns(resolver(addresses("172.19.4.66")), resolver(public))
    assertEquals(public, dns.lookup("blossom.napplet.soy"))
  }

  @Test fun privateAndMixedFallbackAnswersAreRejected() {
    for (answer in listOf(addresses("127.0.0.1"), addresses("1.1.1.1", "192.168.1.1"), emptyList())) {
      val dns = PublicDns(resolver(addresses("172.19.4.66")), resolver(answer))
      assertThrows(UnknownHostException::class.java) { dns.lookup("blossom.napplet.soy") }
    }
  }

  @Test fun privateIpLiteralsNeverUseFallback() {
    val dns = PublicDns(resolver(addresses("127.0.0.1")), object : Dns {
      override fun lookup(hostname: String): List<InetAddress> = error("Unexpected fallback")
    })
    assertThrows(UnknownHostException::class.java) { dns.lookup("127.0.0.1") }
    assertThrows(UnknownHostException::class.java) { dns.lookup("::1") }
  }
}
