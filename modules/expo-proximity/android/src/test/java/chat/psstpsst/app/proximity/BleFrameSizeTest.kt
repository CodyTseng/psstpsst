package chat.psstpsst.app.proximity

import org.junit.Assert.assertEquals
import org.junit.Test

class BleFrameSizeTest {
  @Test
  fun capsMaximumMtuAtGattAttributeLimit() {
    assertEquals(512, maximumGattFrameSize(517))
  }

  @Test
  fun respectsSmallerNegotiatedMtu() {
    assertEquals(20, maximumGattFrameSize(23))
    assertEquals(244, maximumGattFrameSize(247))
  }
}
