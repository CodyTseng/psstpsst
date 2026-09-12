package chat.psstpsst.app.proximity

import android.annotation.SuppressLint
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

private val SERVICE_UUID: UUID = UUID.fromString("45d8b02f-6d80-4fc6-914e-b85fcd0440d3")
private val PROFILE_UUID: UUID = UUID.fromString("55980cee-27e5-48a9-bf1c-ab5da34b4402")
private val MAILBOX_UUID: UUID = UUID.fromString("86a4c105-9a0e-4144-bca1-40e7c78a1d93")
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
private const val DEFAULT_ATT_MTU = 23
private const val MAXIMUM_ATT_MTU = 517
private const val ATT_CHARACTERISTIC_OVERHEAD_BYTES = 3
private const val GATT_MAXIMUM_ATTRIBUTE_VALUE_BYTES = 512
private const val FRAME_HEADER_BYTES = 12
private const val MAXIMUM_WIRE_BYTES = 128 * 1024
private const val MAXIMUM_CHUNK_COUNT = 16_384
private const val MAXIMUM_INBOUND_MESSAGES = 32
private const val MAXIMUM_INBOUND_MESSAGES_PER_ENDPOINT = 4
private const val MAXIMUM_INBOUND_BYTES = 1024 * 1024
private const val MAXIMUM_INBOUND_BYTES_PER_ENDPOINT = 256 * 1024
private const val INBOUND_MESSAGE_TIMEOUT_MS = 60_000L

internal fun maximumGattFrameSize(mtu: Int): Int = min(
  GATT_MAXIMUM_ATTRIBUTE_VALUE_BYTES,
  mtu - ATT_CHARACTERISTIC_OVERHEAD_BYTES,
)

private data class InboundAssembly(
  val endpoint: String,
  val total: Int,
  val chunks: MutableMap<Int, ByteArray> = mutableMapOf(),
  var byteCount: Int = 0,
  var updatedAtMs: Long,
)

@SuppressLint("MissingPermission")
class ExpoProximityModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var profileBytes = ByteArray(0)
  private var gattServer: BluetoothGattServer? = null
  private var serverProfile: BluetoothGattCharacteristic? = null
  private var serverMailbox: BluetoothGattCharacteristic? = null
  private val gatts = mutableMapOf<String, BluetoothGatt>()
  private val profiles = mutableMapOf<String, BluetoothGattCharacteristic>()
  private val mailboxes = mutableMapOf<String, BluetoothGattCharacteristic>()
  private val mailboxReadyEndpoints = mutableSetOf<String>()
  private val subscribedDevices = mutableMapOf<String, android.bluetooth.BluetoothDevice>()
  private val profileSubscribedDevices = mutableMapOf<String, android.bluetooth.BluetoothDevice>()
  private val profileNotificationsInFlight = mutableSetOf<String>()
  private val pendingProfileNotifications = mutableSetOf<String>()
  private val peripheralOnlyEndpoints = mutableSetOf<String>()
  private val mtuByEndpoint = mutableMapOf<String, Int>()
  private val rssiByEndpoint = mutableMapOf<String, Int>()
  private val signalEmittedAtByEndpoint = mutableMapOf<String, Long>()
  private val inbound = mutableMapOf<String, InboundAssembly>()
  private var inboundBytes = 0
  private var inboundCleanupScheduled = false
  private val writeQueues = mutableMapOf<String, ArrayDeque<ByteArray>>()
  private val writePromises = mutableMapOf<String, Promise>()
  private val nextPacketIds = mutableMapOf<String, Long>()
  private val connectionGenerations = mutableMapOf<String, Long>()
  private val activeConnectionEndpoints = mutableSetOf<String>()
  private var scanStopRunnable: Runnable? = null
  private var isScanning = false
  private var isAdvertising = false

  private val manager: BluetoothManager?
    get() = appContext.reactContext?.getSystemService(BluetoothManager::class.java)
  private val adapter get() = manager?.adapter

  override fun definition() = ModuleDefinition {
    Name("ExpoProximity")
    Events("onPeer", "onSignal", "onMessage", "onConnection", "onBluetoothState")

    AsyncFunction("startAdvertisingAsync") { profile: String, promise: Promise ->
      handler.post {
        try {
          profileBytes = Base64.decode(profile, Base64.NO_WRAP)
          peripheralOnlyEndpoints.clear()
          openServerAndAdvertise()
          promise.resolve()
        } catch (error: Exception) {
          promise.reject("ERR_PROXIMITY_START", error.message, error)
        }
      }
    }

    AsyncFunction("startScanAsync") { scanDurationMs: Int, promise: Promise ->
      handler.post {
        try {
          openServerAndAdvertise()
          startScan(scanDurationMs)
          promise.resolve()
        } catch (error: Exception) {
          promise.reject("ERR_PROXIMITY_SCAN", error.message, error)
        }
      }
    }

    AsyncFunction("updateProfileAsync") { profile: String, promise: Promise ->
      handler.post {
        try {
          profileBytes = Base64.decode(profile, Base64.NO_WRAP)
          scheduleProfileNotifications()
          promise.resolve()
        } catch (error: IllegalArgumentException) {
          promise.reject("ERR_PROXIMITY_PROFILE", "The nearby profile is not valid base64.", error)
        }
      }
    }

    AsyncFunction("stopScanAsync") { promise: Promise ->
      handler.post {
        stopScan()
        promise.resolve()
      }
    }

    AsyncFunction("stopSessionAsync") { promise: Promise ->
      handler.post {
        stopScan()
        rejectAllWrites("ERR_PROXIMITY_STOPPED", "The nearby session stopped.")
        clearAllInbound()
        adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        gatts.values.forEach { it.close() }
        gatts.clear()
        profiles.clear()
        mailboxes.clear()
        mailboxReadyEndpoints.clear()
        subscribedDevices.clear()
        profileSubscribedDevices.clear()
        profileNotificationsInFlight.clear()
        pendingProfileNotifications.clear()
        peripheralOnlyEndpoints.clear()
        serverProfile = null
        serverMailbox = null
        mtuByEndpoint.clear()
        rssiByEndpoint.clear()
        signalEmittedAtByEndpoint.clear()
        nextPacketIds.clear()
        activeConnectionEndpoints.clear()
        gattServer?.close()
        gattServer = null
        promise.resolve()
      }
    }

    AsyncFunction("preferPeripheralAsync") { endpointId: String, promise: Promise ->
      handler.post {
        val rawEndpoint = endpointId.removePrefix("c:")
        peripheralOnlyEndpoints.add(rawEndpoint)
        activeConnectionEndpoints.remove("c:$rawEndpoint")
        profiles.remove(rawEndpoint)
        mailboxes.remove(rawEndpoint)
        mailboxReadyEndpoints.remove(rawEndpoint)
        nextPacketIds.remove(endpointId)
        gatts.remove(rawEndpoint)?.let {
          it.disconnect()
          it.close()
        }
        promise.resolve()
      }
    }

    AsyncFunction("disconnectAsync") { endpointId: String, promise: Promise ->
      handler.post {
        val rawEndpoint = endpointId.drop(2)
        nextPacketIds.remove(endpointId)
        clearInbound(endpointId)
        rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        if (endpointId.startsWith("c:")) {
          activeConnectionEndpoints.remove(endpointId)
          profiles.remove(rawEndpoint)
          mailboxes.remove(rawEndpoint)
          mailboxReadyEndpoints.remove(rawEndpoint)
          gatts.remove(rawEndpoint)?.let {
            it.disconnect()
            it.close()
          }
        } else if (endpointId.startsWith("p:")) {
          peripheralOnlyEndpoints.remove(rawEndpoint)
          subscribedDevices.remove(endpointId)?.let { device ->
            gattServer?.cancelConnection(device)
          }
        }
        promise.resolve()
      }
    }

    AsyncFunction("refreshPeerProfileAsync") { endpointId: String, promise: Promise ->
      handler.post {
        if (endpointId.startsWith("p:")) {
          peripheralOnlyEndpoints.remove(endpointId.removePrefix("p:"))
          try {
            if (!isScanning || scanStopRunnable != null) startScan(10_000)
            promise.resolve()
          } catch (error: Exception) {
            promise.reject("ERR_PROXIMITY_READ", error.message, error)
          }
          return@post
        }
        val rawEndpoint = endpointId.removePrefix("c:")
        peripheralOnlyEndpoints.remove(rawEndpoint)
        val gatt = gatts[rawEndpoint]
        val profile = profiles[rawEndpoint]
        if (gatt == null || profile == null) {
          promise.resolve()
          return@post
        }
        if (!gatt.readCharacteristic(profile)) {
          promise.reject("ERR_PROXIMITY_READ", "The nearby profile could not be read.", null)
          return@post
        }
        promise.resolve()
      }
    }

    AsyncFunction("sendAsync") { endpointId: String, payload: String, promise: Promise ->
      handler.post {
        val bytes = try {
          Base64.decode(payload, Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
          promise.reject("ERR_PROXIMITY_PACKET", "The nearby packet is not valid base64.", error)
          return@post
        }
        if (bytes.size > MAXIMUM_WIRE_BYTES) {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message is too large.", null)
          return@post
        }
        if (endpointId in writeQueues || endpointId in writePromises) {
          promise.reject("ERR_PROXIMITY_BUSY", "Another nearby message is already being sent to this peer.", null)
          return@post
        }
        val rawEndpoint = endpointId.drop(2)
        val negotiatedMtu = mtuByEndpoint[rawEndpoint] ?: DEFAULT_ATT_MTU
        val maximumFrameSize = maximumGattFrameSize(negotiatedMtu)
        if (maximumFrameSize <= FRAME_HEADER_BYTES) {
          promise.reject("ERR_PROXIMITY_MTU", "The negotiated BLE MTU is too small.", null)
          return@post
        }
        val chunkSize = maximumFrameSize - FRAME_HEADER_BYTES
        val total = max(1, ceil(bytes.size.toDouble() / chunkSize).toInt())
        if (total > MAXIMUM_CHUNK_COUNT) {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message needs too many BLE chunks.", null)
          return@post
        }
        val packetId = nextPacketIds[endpointId] ?: 0L
        if (packetId == Long.MAX_VALUE) {
          promise.reject("ERR_PROXIMITY_SEQUENCE", "The nearby packet sequence is exhausted.", null)
          return@post
        }
        nextPacketIds[endpointId] = packetId + 1
        val queue = ArrayDeque<ByteArray>()
        for (index in 0 until total) {
          val start = index * chunkSize
          val end = min(bytes.size, start + chunkSize)
          val header = ByteBuffer.allocate(FRAME_HEADER_BYTES).order(ByteOrder.BIG_ENDIAN)
            .putLong(packetId)
            .putShort(index.toShort())
            .putShort(total.toShort())
            .array()
          queue.add(header + bytes.copyOfRange(start, end))
        }
        writeQueues[endpointId] = queue
        writePromises[endpointId] = promise
        if (endpointId.startsWith("c:")) {
          val gatt = gatts[rawEndpoint]
          val mailbox = mailboxes[rawEndpoint]
          if (gatt == null || mailbox == null) {
            writeQueues.remove(endpointId)
            writePromises.remove(endpointId)
            promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
            return@post
          }
          writeNext(endpointId, gatt, mailbox)
        } else if (endpointId.startsWith("p:") && subscribedDevices[endpointId] != null) {
          indicateNext(endpointId)
        } else {
          writeQueues.remove(endpointId)
          writePromises.remove(endpointId)
          promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
        }
      }
    }
  }

  private fun openServerAndAdvertise() {
    val bluetoothManager = manager ?: error("Bluetooth is unavailable")
    val bluetoothAdapter = adapter ?: error("Bluetooth is unavailable")
    sendEvent("onBluetoothState", mapOf("state" to if (bluetoothAdapter.isEnabled) "poweredOn" else "poweredOff"))
    if (!bluetoothAdapter.isEnabled) error("Bluetooth is powered off")
    if (gattServer == null) {
      val server = bluetoothManager.openGattServer(appContext.reactContext, serverCallback)
      val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val profile = BluetoothGattCharacteristic(
        PROFILE_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
        BluetoothGattCharacteristic.PERMISSION_READ,
      )
      profile.addDescriptor(
        BluetoothGattDescriptor(
          CCCD_UUID,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        ),
      )
      service.addCharacteristic(profile)
      val mailbox = BluetoothGattCharacteristic(
        MAILBOX_UUID,
        BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_INDICATE,
        BluetoothGattCharacteristic.PERMISSION_WRITE,
      )
      mailbox.addDescriptor(
        BluetoothGattDescriptor(
          CCCD_UUID,
          BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
        ),
      )
      service.addCharacteristic(mailbox)
      serverProfile = profile
      serverMailbox = mailbox
      if (!server.addService(service)) error("Unable to publish the nearby GATT service")
      gattServer = server
    }
    if (isAdvertising) return

    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
      .setConnectable(true)
      .build()
    val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val advertiser = bluetoothAdapter.bluetoothLeAdvertiser ?: error("BLE advertising is unavailable")
    advertiser.stopAdvertising(advertiseCallback)
    advertiser.startAdvertising(settings, data, advertiseCallback)
  }

  private fun startScan(durationMs: Int) {
    val bluetoothAdapter = adapter ?: error("Bluetooth is unavailable")
    if (!bluetoothAdapter.isEnabled) return
    if (durationMs <= 0 && isScanning && scanStopRunnable == null) return
    val scanner = bluetoothAdapter.bluetoothLeScanner ?: error("BLE scanning is unavailable")
    scanStopRunnable?.let(handler::removeCallbacks)
    scanStopRunnable = null
    scanner.stopScan(scanCallback)
    isScanning = false
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder()
      .setScanMode(
        if (durationMs <= 0) ScanSettings.SCAN_MODE_LOW_LATENCY
        else ScanSettings.SCAN_MODE_LOW_POWER,
      )
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .build()
    scanner.startScan(listOf(filter), settings, scanCallback)
    isScanning = true
    if (durationMs > 0) {
      val stop = Runnable {
        scanner.stopScan(scanCallback)
        isScanning = false
        scanStopRunnable = null
      }
      scanStopRunnable = stop
      handler.postDelayed(stop, max(1_000, durationMs).toLong())
    }
  }

  private fun stopScan() {
    if (!isScanning) return
    scanStopRunnable?.let(handler::removeCallbacks)
    scanStopRunnable = null
    adapter?.bluetoothLeScanner?.stopScan(scanCallback)
    isScanning = false
  }

  private val advertiseCallback = object : AdvertiseCallback() {
    override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
      handler.post {
        isAdvertising = true
      }
    }

    override fun onStartFailure(errorCode: Int) {
      handler.post {
        isAdvertising = false
      }
    }
  }

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val endpoint = result.device.address
      recordSignal(endpoint, result.rssi)
      if (endpoint in peripheralOnlyEndpoints) return
      if (gatts[endpoint] == null) {
        val context = appContext.reactContext ?: return
        gatts[endpoint] = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          result.device.connectGatt(context, false, clientCallback, android.bluetooth.BluetoothDevice.TRANSPORT_LE)
        } else {
          result.device.connectGatt(context, false, clientCallback)
        }
      }
    }
  }

  private val clientCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      val endpoint = gatt.device.address
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        gatts[endpoint] = gatt
        val endpointId = "c:$endpoint"
        val generation = activateConnectionGeneration(endpointId)
        sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "connected", "generation" to generation))
        if (!gatt.requestMtu(MAXIMUM_ATT_MTU)) gatt.discoverServices()
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        profiles.remove(endpoint)
        mailboxes.remove(endpoint)
        mailboxReadyEndpoints.remove(endpoint)
        mtuByEndpoint.remove(endpoint)
        gatts.remove(endpoint)
        gatt.close()
        val endpointId = "c:$endpoint"
        val generation = connectionGenerations[endpointId] ?: 0
        activeConnectionEndpoints.remove(endpointId)
        nextPacketIds.remove(endpointId)
        clearInbound(endpointId)
        rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "disconnected", "generation" to generation))
      }
    }

    override fun onServiceChanged(gatt: BluetoothGatt) {
      val endpoint = gatt.device.address
      val endpointId = "c:$endpoint"
      val generation = connectionGenerations[endpointId] ?: 0
      activeConnectionEndpoints.remove(endpointId)
      profiles.remove(endpoint)
      mailboxes.remove(endpoint)
      mailboxReadyEndpoints.remove(endpoint)
      mtuByEndpoint.remove(endpoint)
      gatts.remove(endpoint)
      nextPacketIds.remove(endpointId)
      clearInbound(endpointId)
      rejectWrite(endpointId, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer changed its GATT service.")
      gatt.disconnect()
      gatt.close()
      sendEvent("onConnection", mapOf("endpointId" to endpointId, "state" to "disconnected", "generation" to generation))
    }

    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
      mtuByEndpoint[gatt.device.address] =
        if (status == BluetoothGatt.GATT_SUCCESS) mtu else DEFAULT_ATT_MTU
      gatt.discoverServices()
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) return
      val service = gatt.getService(SERVICE_UUID) ?: return
      val endpoint = gatt.device.address
      val profile = service.getCharacteristic(PROFILE_UUID)
      val mailbox = service.getCharacteristic(MAILBOX_UUID)
      profiles[endpoint] = profile
      mailboxes[endpoint] = mailbox
      val profileDescriptor = profile.getDescriptor(CCCD_UUID)
      if (
        profile.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0 &&
        profileDescriptor != null
      ) {
        gatt.setCharacteristicNotification(profile, true)
        if (!writeDescriptor(gatt, profileDescriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
          gatt.disconnect()
        }
      } else if (!subscribeToMailbox(gatt, mailbox)) {
        gatt.disconnect()
      }
    }

    override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
      if (descriptor.uuid != CCCD_UUID) return
      if (descriptor.characteristic.uuid == PROFILE_UUID) {
        val mailbox = mailboxes[gatt.device.address] ?: return
        if (!subscribeToMailbox(gatt, mailbox)) gatt.disconnect()
      } else if (
        descriptor.characteristic.uuid == MAILBOX_UUID &&
        status == BluetoothGatt.GATT_SUCCESS
      ) {
        mailboxReadyEndpoints.add(gatt.device.address)
        profiles[gatt.device.address]?.let(gatt::readCharacteristic)
      }
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == PROFILE_UUID) {
        emitProfile("c:${gatt.device.address}", characteristic.value)
      }
    }

    override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) {
      if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == PROFILE_UUID) {
        emitProfile("c:${gatt.device.address}", value)
      }
    }

    @Deprecated("Deprecated in Android 13")
    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
      when (characteristic.uuid) {
        PROFILE_UUID -> if (gatt.device.address in mailboxReadyEndpoints) {
          emitProfile("c:${gatt.device.address}", characteristic.value)
        }
        MAILBOX_UUID -> emitMailbox("c:${gatt.device.address}", characteristic.value)
      }
    }

    override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
      when (characteristic.uuid) {
        PROFILE_UUID -> if (gatt.device.address in mailboxReadyEndpoints) {
          emitProfile("c:${gatt.device.address}", value)
        }
        MAILBOX_UUID -> emitMailbox("c:${gatt.device.address}", value)
      }
    }

    override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
      val endpoint = "c:${gatt.device.address}"
      if (status != BluetoothGatt.GATT_SUCCESS) {
        writeQueues.remove(endpoint)
        writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE write failed ($status).", null)
        return
      }
      writeNext(endpoint, gatt, characteristic)
    }
  }

  private fun emitProfile(endpoint: String, value: ByteArray?) {
    val profile = value?.let { Base64.encodeToString(it, Base64.NO_WRAP) } ?: return
    val rawEndpoint = endpoint.removePrefix("c:").removePrefix("p:")
    sendEvent(
      "onPeer",
      mapOf(
        "endpointId" to endpoint,
        "generation" to (connectionGenerations[endpoint] ?: 0),
        "profile" to profile,
        "rssi" to (rssiByEndpoint[rawEndpoint] ?: 0),
      ),
    )
  }

  private fun recordSignal(endpoint: String, rssi: Int) {
    if (rssi == 127) return
    rssiByEndpoint[endpoint] = rssi
    val now = SystemClock.elapsedRealtime()
    val lastEmission = signalEmittedAtByEndpoint[endpoint]
    if (lastEmission != null && now - lastEmission < 1_000) return
    signalEmittedAtByEndpoint[endpoint] = now
    sendEvent("onSignal", mapOf("endpointId" to "c:$endpoint", "rssi" to rssi))
  }

  private fun emitMailbox(endpoint: String, value: ByteArray?) {
    val frame = value ?: return
    acceptFrame(endpoint, frame)
  }

  private fun subscribeToMailbox(
    gatt: BluetoothGatt,
    mailbox: BluetoothGattCharacteristic,
  ): Boolean {
    gatt.setCharacteristicNotification(mailbox, true)
    val descriptor = mailbox.getDescriptor(CCCD_UUID) ?: return false
    return writeDescriptor(gatt, descriptor, BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
  }

  private fun writeDescriptor(
    gatt: BluetoothGatt,
    descriptor: BluetoothGattDescriptor,
    value: ByteArray,
  ): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      gatt.writeDescriptor(descriptor, value) == BluetoothGatt.GATT_SUCCESS
    } else {
      @Suppress("DEPRECATION")
      run {
        descriptor.value = value
        gatt.writeDescriptor(descriptor)
      }
    }
  }

  /** Recent Android versions reject oversized characteristic values by throwing
   * on the caller thread instead of reporting a failed GATT status. */
  private inline fun safelyStartGattOperation(operation: () -> Boolean): Boolean {
    return try {
      operation()
    } catch (_: IllegalArgumentException) {
      false
    }
  }

  private fun writeNext(endpoint: String, gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
    val queue = writeQueues[endpoint]
    val frame = queue?.removeFirstOrNull()
    if (frame == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.resolve()
      return
    }
    characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
    val started = safelyStartGattOperation {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeCharacteristic(characteristic, frame, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          characteristic.value = frame
          gatt.writeCharacteristic(characteristic)
        }
      }
    }
    if (!started) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE write could not start.", null)
    }
  }

  private val serverCallback = object : BluetoothGattServerCallback() {
    override fun onConnectionStateChange(device: android.bluetooth.BluetoothDevice, status: Int, newState: Int) {
      val endpoint = "p:${device.address}"
      if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        val generation = connectionGenerations[endpoint] ?: 0
        activeConnectionEndpoints.remove(endpoint)
        subscribedDevices.remove(endpoint)
        profileSubscribedDevices.remove(endpoint)
        profileNotificationsInFlight.remove(endpoint)
        pendingProfileNotifications.remove(endpoint)
        nextPacketIds.remove(endpoint)
        clearInbound(endpoint)
        rejectWrite(endpoint, "ERR_PROXIMITY_DISCONNECTED", "The nearby peer disconnected.")
        sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "disconnected", "generation" to generation))
      }
    }

    override fun onMtuChanged(device: android.bluetooth.BluetoothDevice, mtu: Int) {
      mtuByEndpoint[device.address] = mtu
    }

    override fun onCharacteristicReadRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
      if (characteristic.uuid != PROFILE_UUID) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null)
        return
      }
      val profile = profileBytes
      if (offset > profile.size) {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
        return
      }
      gattServer?.sendResponse(
        device,
        requestId,
        BluetoothGatt.GATT_SUCCESS,
        offset,
        profile.copyOfRange(offset, profile.size),
      )
    }

    override fun onCharacteristicWriteRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (characteristic.uuid == MAILBOX_UUID) {
        val endpoint = "p:${device.address}"
        subscribedDevices[endpoint] = device
        if (endpoint !in activeConnectionEndpoints) {
          val generation = activateConnectionGeneration(endpoint)
          sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "connected", "generation" to generation))
        }
        acceptFrame(endpoint, value)
      }
      if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onDescriptorWriteRequest(device: android.bluetooth.BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray) {
      if (descriptor.uuid == CCCD_UUID) {
        val endpoint = "p:${device.address}"
        when (descriptor.characteristic.uuid) {
          PROFILE_UUID -> {
            if (value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
              profileSubscribedDevices[endpoint] = device
            } else {
              profileSubscribedDevices.remove(endpoint)
              profileNotificationsInFlight.remove(endpoint)
              pendingProfileNotifications.remove(endpoint)
            }
          }
          MAILBOX_UUID -> {
            if (value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)) {
              subscribedDevices[endpoint] = device
              val generation = activateConnectionGeneration(endpoint)
              sendEvent("onConnection", mapOf("endpointId" to endpoint, "state" to "connected", "generation" to generation))
            } else {
              subscribedDevices.remove(endpoint)
            }
          }
        }
        @Suppress("DEPRECATION")
        run { descriptor.value = value }
      }
      if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
    }

    override fun onNotificationSent(device: android.bluetooth.BluetoothDevice, status: Int) {
      val endpoint = "p:${device.address}"
      if (profileNotificationsInFlight.remove(endpoint)) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
          pendingProfileNotifications.add(endpoint)
          return
        }
        notifyProfileSubscribers()
        return
      }
      if (status != BluetoothGatt.GATT_SUCCESS) {
        writeQueues.remove(endpoint)
        writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE indication failed ($status).", null)
        return
      }
      indicateNext(endpoint)
    }
  }

  private fun scheduleProfileNotifications() {
    pendingProfileNotifications.addAll(profileSubscribedDevices.keys)
    notifyProfileSubscribers()
  }

  private fun notifyProfileSubscribers() {
    val server = gattServer ?: return
    val characteristic = serverProfile ?: return
    for (endpoint in pendingProfileNotifications.toList()) {
      val device = profileSubscribedDevices[endpoint] ?: continue
      if (endpoint in profileNotificationsInFlight || endpoint in writeQueues) continue
      val started = safelyStartGattOperation {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          server.notifyCharacteristicChanged(device, characteristic, false, profileBytes) ==
            BluetoothGatt.GATT_SUCCESS
        } else {
          @Suppress("DEPRECATION")
          run {
            characteristic.value = profileBytes
            server.notifyCharacteristicChanged(device, characteristic, false)
          }
        }
      }
      if (started) {
        pendingProfileNotifications.remove(endpoint)
        profileNotificationsInFlight.add(endpoint)
      }
    }
  }

  private fun indicateNext(endpoint: String) {
    val device = subscribedDevices[endpoint]
    val characteristic = serverMailbox
    val frame = writeQueues[endpoint]?.removeFirstOrNull()
    if (device == null || characteristic == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.", null)
      return
    }
    if (frame == null) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.resolve()
      notifyProfileSubscribers()
      return
    }
    val started = safelyStartGattOperation {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gattServer?.notifyCharacteristicChanged(device, characteristic, true, frame) == BluetoothGatt.GATT_SUCCESS
      } else {
        @Suppress("DEPRECATION")
        run {
          characteristic.value = frame
          gattServer?.notifyCharacteristicChanged(device, characteristic, true) == true
        }
      }
    }
    if (!started) {
      writeQueues.remove(endpoint)
      writePromises.remove(endpoint)?.reject("ERR_PROXIMITY_WRITE", "BLE indication could not start.", null)
    }
  }

  private fun acceptFrame(endpoint: String, frame: ByteArray) {
    val generation = connectionGenerations[endpoint] ?: return
    if (frame.size < FRAME_HEADER_BYTES) return
    val header = ByteBuffer.wrap(frame, 0, FRAME_HEADER_BYTES).order(ByteOrder.BIG_ENDIAN)
    val packetId = header.long
    val index = header.short.toInt() and 0xffff
    val total = header.short.toInt() and 0xffff
    if (packetId < 0 || total !in 1..MAXIMUM_CHUNK_COUNT || index !in 0 until total) return
    val bytes = frame.copyOfRange(FRAME_HEADER_BYTES, frame.size)
    if (bytes.isEmpty() && index != total - 1) return
    val key = "$endpoint:$generation:$packetId"
    val now = SystemClock.elapsedRealtime()
    removeExpiredInbound(now)

    val assembly = inbound[key]?.also { existing ->
      if (existing.total != total) {
        removeInbound(key)
        return
      }
      existing.chunks[index]?.let { previous ->
        if (!previous.contentEquals(bytes)) removeInbound(key)
        return
      }
    } ?: run {
      val endpointAssemblies = inbound.values.count { it.endpoint == endpoint }
      if (
        inbound.size >= MAXIMUM_INBOUND_MESSAGES ||
        endpointAssemblies >= MAXIMUM_INBOUND_MESSAGES_PER_ENDPOINT
      ) return
      InboundAssembly(endpoint = endpoint, total = total, updatedAtMs = now)
    }
    val endpointBytes = inbound.values.sumOf { if (it.endpoint == endpoint) it.byteCount else 0 }
    if (
      assembly.byteCount + bytes.size > MAXIMUM_WIRE_BYTES ||
      inboundBytes + bytes.size > MAXIMUM_INBOUND_BYTES ||
      endpointBytes + bytes.size > MAXIMUM_INBOUND_BYTES_PER_ENDPOINT
    ) {
      removeInbound(key)
      return
    }

    assembly.chunks[index] = bytes
    assembly.byteCount += bytes.size
    assembly.updatedAtMs = now
    inbound[key] = assembly
    inboundBytes += bytes.size
    scheduleInboundCleanupIfNeeded()
    if (assembly.chunks.size != total) return

    removeInbound(key)
    val payload = ByteArray(assembly.byteCount)
    var offset = 0
    for (chunkIndex in 0 until total) {
      val chunk = assembly.chunks[chunkIndex] ?: return
      chunk.copyInto(payload, destinationOffset = offset)
      offset += chunk.size
    }
    sendEvent(
      "onMessage",
      mapOf(
        "endpointId" to endpoint,
        "generation" to generation,
        "payload" to Base64.encodeToString(payload, Base64.NO_WRAP),
      ),
    )
  }

  private fun activateConnectionGeneration(endpoint: String): Long {
    if (endpoint in activeConnectionEndpoints) return connectionGenerations[endpoint] ?: 0
    activeConnectionEndpoints.add(endpoint)
    val next = (connectionGenerations[endpoint] ?: 0) + 1
    connectionGenerations[endpoint] = next
    return next
  }

  private val inboundCleanupRunnable = Runnable {
    inboundCleanupScheduled = false
    removeExpiredInbound(SystemClock.elapsedRealtime())
    scheduleInboundCleanupIfNeeded()
  }

  private fun scheduleInboundCleanupIfNeeded() {
    if (inbound.isEmpty() || inboundCleanupScheduled) return
    inboundCleanupScheduled = true
    val now = SystemClock.elapsedRealtime()
    val delay = inbound.values.minOf {
      max(1L, it.updatedAtMs + INBOUND_MESSAGE_TIMEOUT_MS - now)
    }
    handler.postDelayed(inboundCleanupRunnable, delay)
  }

  private fun removeExpiredInbound(nowMs: Long) {
    val expired = inbound.filterValues { nowMs - it.updatedAtMs >= INBOUND_MESSAGE_TIMEOUT_MS }.keys.toList()
    expired.forEach(::removeInbound)
  }

  private fun removeInbound(key: String) {
    val assembly = inbound.remove(key) ?: return
    inboundBytes = max(0, inboundBytes - assembly.byteCount)
  }

  private fun clearInbound(endpoint: String) {
    val keys = inbound.filterValues { it.endpoint == endpoint }.keys.toList()
    keys.forEach(::removeInbound)
  }

  private fun clearAllInbound() {
    handler.removeCallbacks(inboundCleanupRunnable)
    inboundCleanupScheduled = false
    inbound.clear()
    inboundBytes = 0
  }

  private fun rejectWrite(endpoint: String, code: String, message: String) {
    writeQueues.remove(endpoint)
    writePromises.remove(endpoint)?.reject(code, message, null)
  }

  private fun rejectAllWrites(code: String, message: String) {
    val promises = writePromises.values.toList()
    writePromises.clear()
    writeQueues.clear()
    promises.forEach { it.reject(code, message, null) }
  }
}
