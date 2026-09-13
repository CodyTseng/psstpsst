import CoreBluetooth
import ExpoModulesCore
import Foundation

private let serviceUUID = CBUUID(string: "45D8B02F-6D80-4FC6-914E-B85FCD0440D3")
private let profileUUID = CBUUID(string: "55980CEE-27E5-48A9-BF1C-AB5DA34B4402")
private let mailboxUUID = CBUUID(string: "86A4C105-9A0E-4144-BCA1-40E7C78A1D93")
private let maximumWireBytes = 128 * 1024
private let maximumChunkCount = 16_384
private let maximumInboundMessages = 32
private let maximumInboundMessagesPerEndpoint = 4
private let maximumInboundBytes = 1024 * 1024
private let maximumInboundBytesPerEndpoint = 256 * 1024
private let inboundMessageTimeout: TimeInterval = 60
private let maximumIndicationsPerTurn = 16

private struct InboundAssembly {
  let endpointId: String
  let total: Int
  var chunks: [Int: Data]
  var byteCount: Int
  var updatedAt: TimeInterval
}

private struct PendingWrite {
  let frames: [Data]
  var nextIndex: Int
}

public final class ExpoProximityModule: Module {
  private let bluetoothQueue = DispatchQueue(label: "chat.psstpsst.app.proximity.bluetooth")
  private lazy var bluetoothDelegate = ExpoProximityBluetoothDelegate(owner: self)
  private var central: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?
  private var profileData = Data()
  private var profileCharacteristic: CBMutableCharacteristic?
  private var profileNotificationPending = false
  private var mailboxCharacteristic: CBMutableCharacteristic?
  private var peripherals: [String: CBPeripheral] = [:]
  private var profileByEndpoint: [String: CBCharacteristic] = [:]
  private var serviceDiscoveryEndpoints = Set<String>()
  private var mailboxByEndpoint: [String: CBCharacteristic] = [:]
  private var subscribedCentrals: [String: CBCentral] = [:]
  private var peripheralOnlyEndpoints = Set<String>()
  private var rssiByEndpoint: [String: Int] = [:]
  private var signalEmittedAtByEndpoint: [String: TimeInterval] = [:]
  private var inbound: [String: InboundAssembly] = [:]
  private var inboundBytes = 0
  private var inboundMessagesByEndpoint: [String: Int] = [:]
  private var inboundBytesByEndpoint: [String: Int] = [:]
  private var inboundCleanupScheduled = false
  private var inboundCleanupGeneration = 0
  private var pendingWrites: [String: PendingWrite] = [:]
  private var writeResolvers: [String: () -> Void] = [:]
  private var writeRejecters: [String: (Error) -> Void] = [:]
  private var nextPacketIds: [String: UInt64] = [:]
  private var connectionGenerations: [String: UInt64] = [:]
  private var activeConnectionEndpoints = Set<String>()
  private var pendingCentralReconnectEndpoints = Set<String>()
  private var pendingScanDurationMs: Int?
  private var scanIsContinuous = false
  private var scanGeneration = 0
  private var advertisingRequested = false

  private func discoverPeerServices(_ peripheral: CBPeripheral) {
    guard serviceDiscoveryEndpoints.insert(peripheral.identifier.uuidString).inserted else { return }
    peripheral.discoverServices([serviceUUID])
  }

  private func trace(_ message: @autoclosure () -> String) {
    #if DEBUG
    print("[nearby-native] \(message())")
    #endif
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoProximity")
    Events("onPeer", "onSignal", "onMessage", "onConnection", "onBluetoothState")

    AsyncFunction("startAdvertisingAsync") { (profile: String, promise: Promise) in
      self.bluetoothQueue.async {
        guard let profileData = Data(base64Encoded: profile) else {
          promise.reject("ERR_PROXIMITY_PROFILE", "The nearby profile is not valid base64.")
          return
        }
        self.profileData = profileData
        self.peripheralOnlyEndpoints.removeAll()
        self.advertisingRequested = true
        self.ensureManagers()
        self.emitCurrentBluetoothState()
        self.configurePeripheralIfReady()
        promise.resolve()
      }
    }

    AsyncFunction("startScanAsync") { (scanDurationMs: Int, promise: Promise) in
      self.bluetoothQueue.async {
        self.ensureManagers()
        self.emitCurrentBluetoothState()
        self.startScan(durationMs: scanDurationMs)
        promise.resolve()
      }
    }

    AsyncFunction("updateProfileAsync") { (profile: String, promise: Promise) in
      self.bluetoothQueue.async {
        guard let profileData = Data(base64Encoded: profile) else {
          promise.reject("ERR_PROXIMITY_PROFILE", "The nearby profile is not valid base64.")
          return
        }
        self.profileData = profileData
        self.publishProfileUpdate()
        promise.resolve()
      }
    }

    AsyncFunction("stopScanAsync") { (promise: Promise) in
      self.bluetoothQueue.async {
        self.stopScan()
        promise.resolve()
      }
    }

    AsyncFunction("stopSessionAsync") { (promise: Promise) in
      self.bluetoothQueue.async {
        self.advertisingRequested = false
        self.stopScan()
        self.rejectAllWrites(message: "The nearby session stopped.")
        self.clearAllInbound()
        for peripheral in self.peripherals.values { self.central?.cancelPeripheralConnection(peripheral) }
        self.peripheralManager?.stopAdvertising()
        self.peripheralManager?.removeAllServices()
        self.profileCharacteristic = nil
        self.profileNotificationPending = false
        self.mailboxCharacteristic = nil
        self.peripherals.removeAll()
        self.profileByEndpoint.removeAll()
        self.serviceDiscoveryEndpoints.removeAll()
        self.mailboxByEndpoint.removeAll()
        self.subscribedCentrals.removeAll()
        self.peripheralOnlyEndpoints.removeAll()
        self.rssiByEndpoint.removeAll()
        self.signalEmittedAtByEndpoint.removeAll()
        self.nextPacketIds.removeAll()
        self.activeConnectionEndpoints.removeAll()
        self.pendingCentralReconnectEndpoints.removeAll()
        promise.resolve()
      }
    }

    AsyncFunction("preferPeripheralAsync") { (endpointId: String, promise: Promise) in
      self.bluetoothQueue.async {
        let rawEndpoint = endpointId.hasPrefix("c:") ? String(endpointId.dropFirst(2)) : endpointId
        self.peripheralOnlyEndpoints.insert(rawEndpoint)
        self.pendingCentralReconnectEndpoints.remove(rawEndpoint)
        self.activeConnectionEndpoints.remove("c:\(rawEndpoint)")
        if let peripheral = self.peripherals.removeValue(forKey: rawEndpoint) {
          self.central?.cancelPeripheralConnection(peripheral)
        }
        self.profileByEndpoint.removeValue(forKey: rawEndpoint)
        self.serviceDiscoveryEndpoints.remove(rawEndpoint)
        self.mailboxByEndpoint.removeValue(forKey: rawEndpoint)
        self.nextPacketIds.removeValue(forKey: endpointId)
        promise.resolve()
      }
    }

    AsyncFunction("disconnectAsync") { (endpointId: String, promise: Promise) in
      self.bluetoothQueue.async {
        self.nextPacketIds.removeValue(forKey: endpointId)
        self.clearInbound(endpointId: endpointId)
        self.rejectWrite(endpointId: endpointId, message: "The nearby peer disconnected.")
        if endpointId.hasPrefix("c:") {
          self.activeConnectionEndpoints.remove(endpointId)
          let rawEndpoint = String(endpointId.dropFirst(2))
          if let peripheral = self.peripherals.removeValue(forKey: rawEndpoint) {
            self.central?.cancelPeripheralConnection(peripheral)
          }
          self.profileByEndpoint.removeValue(forKey: rawEndpoint)
          self.serviceDiscoveryEndpoints.remove(rawEndpoint)
          self.mailboxByEndpoint.removeValue(forKey: rawEndpoint)
        } else if endpointId.hasPrefix("p:") {
          // CoreBluetooth does not let a Peripheral force-disconnect a
          // subscribed Central. Keep the transport route and reactivate a new
          // logical generation if that Central writes another request.
          self.activeConnectionEndpoints.remove(endpointId)
          self.peripheralOnlyEndpoints.remove(String(endpointId.dropFirst(2)))
          self.trace(
            "logical responder disconnect endpoint=\(endpointId) generation=\(self.connectionGenerations[endpointId] ?? 0) route=\(self.subscribedCentrals[endpointId] != nil)"
          )
        }
        promise.resolve()
      }
    }

    AsyncFunction("refreshPeerProfileAsync") { (endpointId: String, promise: Promise) in
      self.bluetoothQueue.async {
        if endpointId.hasPrefix("p:") {
          let rawEndpoint = String(endpointId.dropFirst(2))
          self.peripheralOnlyEndpoints.remove(rawEndpoint)
          if self.central?.isScanning != true || !self.scanIsContinuous {
            self.startScan(durationMs: 10_000)
          }
          promise.resolve()
          return
        }
        let rawEndpoint = endpointId.hasPrefix("c:") ? String(endpointId.dropFirst(2)) : endpointId
        self.peripheralOnlyEndpoints.remove(rawEndpoint)
        self.pendingCentralReconnectEndpoints.insert(rawEndpoint)
        if self.peripherals[rawEndpoint] == nil,
          let identifier = UUID(uuidString: rawEndpoint),
          let recovered = self.central?.retrievePeripherals(withIdentifiers: [identifier]).first
        {
          self.peripherals[rawEndpoint] = recovered
          recovered.delegate = self.bluetoothDelegate
          self.trace("retrieved Central endpoint=\(endpointId) state=\(recovered.state.rawValue)")
        }
        guard let peripheral = self.peripherals[rawEndpoint] else {
          self.startScan(durationMs: 10_000)
          promise.resolve()
          return
        }
        if peripheral.state == .disconnected {
          self.central?.connect(peripheral)
          promise.resolve()
          return
        }
        guard peripheral.state == .connected else {
          if self.central?.isScanning != true { self.startScan(durationMs: 10_000) }
          promise.resolve()
          return
        }
        if self.activeConnectionEndpoints.contains(endpointId) {
          self.pendingCentralReconnectEndpoints.remove(rawEndpoint)
          if let characteristic = self.profileByEndpoint[rawEndpoint] {
            peripheral.readValue(for: characteristic)
          } else {
            self.discoverPeerServices(peripheral)
          }
          promise.resolve()
          return
        }
        self.activeConnectionEndpoints.remove(endpointId)
        let generation = self.activateConnectionGeneration(endpointId: endpointId)
        self.pendingCentralReconnectEndpoints.remove(rawEndpoint)
        self.sendEvent("onConnection", [
          "endpointId": endpointId, "state": "connected", "generation": generation,
        ])
        if let characteristic = self.profileByEndpoint[rawEndpoint] {
          peripheral.readValue(for: characteristic)
        } else {
          self.discoverPeerServices(peripheral)
        }
        promise.resolve()
      }
    }

    AsyncFunction("sendAsync") { (endpointId: String, payload: String, promise: Promise) in
      self.bluetoothQueue.async {
        guard let bytes = Data(base64Encoded: payload) else {
          promise.reject("ERR_PROXIMITY_PACKET", "The nearby packet is not valid base64.")
          return
        }
        guard bytes.count <= maximumWireBytes else {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message is too large.")
          return
        }
        self.trace(
          "outbound packet endpoint=\(endpointId) generation=\(self.connectionGenerations[endpointId] ?? 0) type=\(bytes.count > 1 ? String(format: "0x%02x", bytes[1]) : "truncated") bytes=\(bytes.count)"
        )
        guard self.pendingWrites[endpointId] == nil else {
          promise.reject("ERR_PROXIMITY_BUSY", "Another nearby message is already being sent to this peer.")
          return
        }
        let maximumFrameSize: Int
        if endpointId.hasPrefix("c:"),
          let peripheral = self.peripherals[String(endpointId.dropFirst(2))],
          peripheral.state == .connected,
          self.mailboxByEndpoint[String(endpointId.dropFirst(2))] != nil
        {
          maximumFrameSize = peripheral.maximumWriteValueLength(for: .withResponse)
        } else if endpointId.hasPrefix("p:"), let central = self.subscribedCentrals[endpointId] {
          maximumFrameSize = central.maximumUpdateValueLength
        } else {
          promise.reject("ERR_PROXIMITY_OFFLINE", "The nearby peer is not connected.")
          return
        }
        let packetId = self.nextPacketIds[endpointId, default: 0]
        guard packetId < UInt64.max else {
          promise.reject("ERR_PROXIMITY_SEQUENCE", "The nearby packet sequence is exhausted.")
          return
        }
        self.nextPacketIds[endpointId] = packetId + 1
        guard let frames = self.frames(payload: bytes, packetId: packetId, maximumFrameSize: maximumFrameSize) else {
          promise.reject("ERR_PROXIMITY_TOO_LARGE", "The nearby message needs too many BLE chunks.")
          return
        }
        self.pendingWrites[endpointId] = PendingWrite(frames: frames, nextIndex: 0)
        self.writeResolvers[endpointId] = { promise.resolve() }
        self.writeRejecters[endpointId] = { error in
          promise.reject("ERR_PROXIMITY_WRITE", error.localizedDescription)
        }
        if endpointId.hasPrefix("c:") {
          let rawEndpoint = String(endpointId.dropFirst(2))
          self.writeNext(
            endpointId: endpointId,
            peripheral: self.peripherals[rawEndpoint]!,
            characteristic: self.mailboxByEndpoint[rawEndpoint]!
          )
        } else {
          self.indicateNext(endpointId: endpointId)
        }
      }
    }
  }

  private func ensureManagers() {
    if central == nil { central = CBCentralManager(delegate: bluetoothDelegate, queue: bluetoothQueue) }
    if peripheralManager == nil {
      peripheralManager = CBPeripheralManager(delegate: bluetoothDelegate, queue: bluetoothQueue)
    }
  }

  private func emitCurrentBluetoothState() {
    if let state = central?.state ?? peripheralManager?.state {
      sendEvent("onBluetoothState", ["state": stateName(state)])
    }
  }

  private func startScan(durationMs: Int) {
    pendingScanDurationMs = durationMs
    guard central?.state == .poweredOn else { return }
    if durationMs <= 0, central?.isScanning == true, scanIsContinuous { return }
    pendingScanDurationMs = nil
    scanIsContinuous = durationMs <= 0
    scanGeneration += 1
    let generation = scanGeneration
    central?.stopScan()
    central?.scanForPeripherals(
      withServices: [serviceUUID],
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: durationMs <= 0]
    )
    if durationMs > 0 {
      bluetoothQueue.asyncAfter(deadline: .now() + .milliseconds(max(1_000, durationMs))) { [weak self] in
        guard let self, self.scanGeneration == generation else { return }
        self.central?.stopScan()
        self.scanIsContinuous = false
      }
    }
  }

  private func stopScan() {
    pendingScanDurationMs = nil
    scanIsContinuous = false
    scanGeneration += 1
    central?.stopScan()
  }

  private func configurePeripheralIfReady() {
    guard advertisingRequested, let manager = peripheralManager, manager.state == .poweredOn else { return }
    manager.stopAdvertising()
    manager.removeAllServices()
    let profile = CBMutableCharacteristic(
      type: profileUUID,
      properties: [.read, .notify],
      value: nil,
      permissions: [.readable]
    )
    let mailbox = CBMutableCharacteristic(
      type: mailboxUUID,
      properties: [.write, .indicate],
      value: nil,
      permissions: [.writeable]
    )
    let service = CBMutableService(type: serviceUUID, primary: true)
    service.characteristics = [profile, mailbox]
    profileCharacteristic = profile
    mailboxCharacteristic = mailbox
    manager.add(service)
  }

  fileprivate func centralManagerDidUpdateState(_ central: CBCentralManager) {
    sendEvent("onBluetoothState", ["state": stateName(central.state)])
    if central.state == .poweredOn, let durationMs = pendingScanDurationMs {
      startScan(durationMs: durationMs)
    }
  }

  fileprivate func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    sendEvent("onBluetoothState", ["state": stateName(peripheral.state)])
    if advertisingRequested {
      if peripheral.state == .poweredOn {
        configurePeripheralIfReady()
      }
    }
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard advertisingRequested, error == nil else { return }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber)
  {
    let endpoint = peripheral.identifier.uuidString
    recordSignal(endpoint: endpoint, rssi: RSSI.intValue)
    let suppressed = peripheralOnlyEndpoints.contains(endpoint)
    trace(
      "discovered endpoint=\(endpoint) state=\(peripheral.state.rawValue) suppressed=\(suppressed) pendingReconnect=\(pendingCentralReconnectEndpoints.contains(endpoint)) rssi=\(RSSI)"
    )
    guard !suppressed else { return }
    peripherals[endpoint] = peripheral
    peripheral.delegate = bluetoothDelegate
    if peripheral.state == .disconnected {
      central.connect(peripheral)
    } else if peripheral.state == .connected,
      profileByEndpoint[endpoint] == nil || mailboxByEndpoint[endpoint] == nil
    {
      if pendingCentralReconnectEndpoints.remove(endpoint) != nil {
        let endpointId = "c:\(endpoint)"
        activeConnectionEndpoints.remove(endpointId)
        let generation = activateConnectionGeneration(endpointId: endpointId)
        trace("reactivated connected Central endpoint=\(endpointId) generation=\(generation)")
        sendEvent("onConnection", [
          "endpointId": endpointId, "state": "connected", "generation": generation,
        ])
      }
      discoverPeerServices(peripheral)
    }
  }

  fileprivate func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let endpoint = peripheral.identifier.uuidString
    let endpointId = "c:\(endpoint)"
    if pendingCentralReconnectEndpoints.remove(endpoint) != nil {
      activeConnectionEndpoints.remove(endpointId)
    }
    let generation = activateConnectionGeneration(endpointId: endpointId)
    sendEvent("onConnection", [
      "endpointId": endpointId, "state": "connected", "generation": generation,
    ])
    discoverPeerServices(peripheral)
  }

  fileprivate func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?)
  {
    let endpoint = peripheral.identifier.uuidString
    profileByEndpoint.removeValue(forKey: endpoint)
    serviceDiscoveryEndpoints.remove(endpoint)
    mailboxByEndpoint.removeValue(forKey: endpoint)
    let endpointId = "c:\(endpoint)"
    let generation = connectionGenerations[endpointId] ?? 0
    activeConnectionEndpoints.remove(endpointId)
    nextPacketIds.removeValue(forKey: endpointId)
    clearInbound(endpointId: endpointId)
    rejectWrite(endpointId: endpointId, message: "The nearby peer disconnected.")
    sendEvent("onConnection", [
      "endpointId": endpointId, "state": "disconnected", "generation": generation,
    ])
    if pendingCentralReconnectEndpoints.contains(endpoint),
      !peripheralOnlyEndpoints.contains(endpoint),
      central.state == .poweredOn
    {
      trace("reconnecting after disconnect endpoint=\(endpoint)")
      peripherals[endpoint] = peripheral
      peripheral.delegate = bluetoothDelegate
      central.connect(peripheral)
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      serviceDiscoveryEndpoints.remove(peripheral.identifier.uuidString)
      return
    }
    for service in peripheral.services ?? [] where service.uuid == serviceUUID {
      peripheral.discoverCharacteristics([profileUUID, mailboxUUID], for: service)
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    guard invalidatedServices.contains(where: { $0.uuid == serviceUUID }) else { return }
    let rawEndpoint = peripheral.identifier.uuidString
    let endpoint = "c:\(rawEndpoint)"
    let generation = connectionGenerations[endpoint] ?? 0
    activeConnectionEndpoints.remove(endpoint)
    profileByEndpoint.removeValue(forKey: rawEndpoint)
    serviceDiscoveryEndpoints.remove(rawEndpoint)
    mailboxByEndpoint.removeValue(forKey: rawEndpoint)
    nextPacketIds.removeValue(forKey: endpoint)
    clearInbound(endpointId: endpoint)
    rejectWrite(endpointId: endpoint, message: "The nearby peer changed its GATT service.")
    central?.cancelPeripheralConnection(peripheral)
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "disconnected", "generation": generation,
    ])
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: Error?)
  {
    guard error == nil else {
      serviceDiscoveryEndpoints.remove(peripheral.identifier.uuidString)
      return
    }
    let endpoint = peripheral.identifier.uuidString
    for characteristic in service.characteristics ?? [] {
      if characteristic.uuid == profileUUID {
        profileByEndpoint[endpoint] = characteristic
        if characteristic.properties.contains(.notify) {
          peripheral.setNotifyValue(true, for: characteristic)
        }
      }
      if characteristic.uuid == mailboxUUID {
        mailboxByEndpoint[endpoint] = characteristic
        peripheral.setNotifyValue(true, for: characteristic)
      }
    }
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?)
  {
    trace(
      "notification state endpoint=c:\(peripheral.identifier.uuidString) notifying=\(characteristic.isNotifying) error=\(error?.localizedDescription ?? "none")"
    )
    guard error == nil, characteristic.uuid == mailboxUUID, characteristic.isNotifying,
      let profile = profileByEndpoint[peripheral.identifier.uuidString]
    else { return }
    peripheral.readValue(for: profile)
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    guard error == nil, let value = characteristic.value else { return }
    let endpoint = "c:\(peripheral.identifier.uuidString)"
    if characteristic.uuid == profileUUID {
      guard mailboxByEndpoint[peripheral.identifier.uuidString]?.isNotifying == true else { return }
      let rawEndpoint = peripheral.identifier.uuidString
      sendEvent("onPeer", [
        "endpointId": endpoint,
        "generation": connectionGenerations[endpoint] ?? 0,
        "profile": value.base64EncodedString(),
        "rssi": rssiByEndpoint[rawEndpoint] ?? 0,
      ])
    } else if characteristic.uuid == mailboxUUID {
      accept(frame: value, endpointId: endpoint)
    }
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard request.characteristic.uuid == profileUUID else {
      peripheral.respond(to: request, withResult: .requestNotSupported)
      return
    }
    let profile = profileData
    guard request.offset <= profile.count else {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = profile.subdata(in: request.offset..<profile.count)
    peripheral.respond(to: request, withResult: .success)
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests where request.characteristic.uuid == mailboxUUID {
      let endpointId = "p:\(request.central.identifier.uuidString)"
      trace(
        "write request endpoint=\(endpointId) bytes=\(request.value?.count ?? 0) active=\(activeConnectionEndpoints.contains(endpointId)) route=\(subscribedCentrals[endpointId] != nil) generation=\(connectionGenerations[endpointId] ?? 0)"
      )
      if let value = request.value {
        accept(
          frame: value,
          endpointId: endpointId,
          central: request.central
        )
      }
      peripheral.respond(to: request, withResult: .success)
    }
  }

  private func accept(frame: Data, endpointId: String, central: CBCentral? = nil) {
    if let central, endpointId.hasPrefix("p:") {
      // The subscription callback is not guaranteed to repeat when the
      // operating system reuses a GATT link. A write itself proves the route
      // is live and supplies the Central needed for the response indication.
      subscribedCentrals[endpointId] = central
    }
    let generation: UInt64
    if endpointId.hasPrefix("p:"),
      central != nil,
      !activeConnectionEndpoints.contains(endpointId)
    {
      generation = activateConnectionGeneration(endpointId: endpointId)
      trace("reactivated responder endpoint=\(endpointId) generation=\(generation)")
      sendEvent("onConnection", [
        "endpointId": endpointId, "state": "connected", "generation": generation,
      ])
    } else {
      guard let currentGeneration = connectionGenerations[endpointId] else { return }
      generation = currentGeneration
    }
    guard frame.count >= 12 else { return }
    let packetId = frame.prefix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    let index = Int(frame[8]) << 8 | Int(frame[9])
    let total = Int(frame[10]) << 8 | Int(frame[11])
    trace(
      "inbound fragment endpoint=\(endpointId) generation=\(generation) packet=\(packetId) fragment=\(index + 1)/\(total) bytes=\(frame.count)"
    )
    guard total > 0, total <= maximumChunkCount, index >= 0, index < total else { return }
    let decoded = frame.subdata(in: 12..<frame.count)
    guard !decoded.isEmpty || index == total - 1 else { return }
    let key = "\(endpointId):\(generation):\(packetId)"
    let now = ProcessInfo.processInfo.systemUptime
    removeExpiredInbound(now: now)

    var assembly: InboundAssembly
    if let existing = inbound[key] {
      guard existing.total == total else {
        removeInbound(key: key)
        return
      }
      if let previous = existing.chunks[index] {
        if previous != decoded { removeInbound(key: key) }
        return
      }
      assembly = existing
    } else {
      guard inbound.count < maximumInboundMessages,
        inboundMessagesByEndpoint[endpointId, default: 0] < maximumInboundMessagesPerEndpoint
      else { return }
      assembly = InboundAssembly(
        endpointId: endpointId,
        total: total,
        chunks: [:],
        byteCount: 0,
        updatedAt: now
      )
    }

    guard assembly.byteCount + decoded.count <= maximumWireBytes,
      inboundBytes + decoded.count <= maximumInboundBytes,
      inboundBytesByEndpoint[endpointId, default: 0] + decoded.count <= maximumInboundBytesPerEndpoint
    else {
      removeInbound(key: key)
      return
    }

    assembly.chunks[index] = decoded
    assembly.byteCount += decoded.count
    assembly.updatedAt = now
    let isNewAssembly = inbound[key] == nil
    inbound[key] = assembly
    inboundBytes += decoded.count
    inboundBytesByEndpoint[endpointId, default: 0] += decoded.count
    if isNewAssembly { inboundMessagesByEndpoint[endpointId, default: 0] += 1 }
    scheduleInboundCleanupIfNeeded()
    guard assembly.chunks.count == total else { return }

    removeInbound(key: key)
    var data = Data()
    data.reserveCapacity(assembly.byteCount)
    for chunkIndex in 0..<total {
      guard let chunk = assembly.chunks[chunkIndex] else { return }
      data.append(chunk)
    }
    trace(
      "inbound packet endpoint=\(endpointId) generation=\(generation) packet=\(packetId) type=\(data.count > 1 ? String(format: "0x%02x", data[1]) : "truncated") bytes=\(data.count)"
    )
    sendEvent("onMessage", [
      "endpointId": endpointId,
      "generation": generation,
      "payload": data.base64EncodedString(),
    ])
  }

  private func scheduleInboundCleanupIfNeeded() {
    guard !inbound.isEmpty, !inboundCleanupScheduled else { return }
    inboundCleanupScheduled = true
    let generation = inboundCleanupGeneration
    let now = ProcessInfo.processInfo.systemUptime
    let delay = inbound.values.reduce(inboundMessageTimeout) { partial, assembly in
      min(partial, max(0, assembly.updatedAt + inboundMessageTimeout - now))
    }
    bluetoothQueue.asyncAfter(deadline: .now() + .milliseconds(max(1, Int(delay * 1_000)))) { [weak self] in
      guard let self, self.inboundCleanupGeneration == generation else { return }
      self.inboundCleanupScheduled = false
      self.removeExpiredInbound(now: ProcessInfo.processInfo.systemUptime)
      self.scheduleInboundCleanupIfNeeded()
    }
  }

  private func removeExpiredInbound(now: TimeInterval) {
    let keys = inbound.compactMap { key, assembly in
      now - assembly.updatedAt >= inboundMessageTimeout ? key : nil
    }
    for key in keys { removeInbound(key: key) }
  }

  private func removeInbound(key: String) {
    guard let assembly = inbound.removeValue(forKey: key) else { return }
    inboundBytes = max(0, inboundBytes - assembly.byteCount)
    let endpointBytes = max(0, inboundBytesByEndpoint[assembly.endpointId, default: 0] - assembly.byteCount)
    if endpointBytes == 0 {
      inboundBytesByEndpoint.removeValue(forKey: assembly.endpointId)
    } else {
      inboundBytesByEndpoint[assembly.endpointId] = endpointBytes
    }
    let endpointMessages = max(0, inboundMessagesByEndpoint[assembly.endpointId, default: 0] - 1)
    if endpointMessages == 0 {
      inboundMessagesByEndpoint.removeValue(forKey: assembly.endpointId)
    } else {
      inboundMessagesByEndpoint[assembly.endpointId] = endpointMessages
    }
  }

  private func clearInbound(endpointId: String) {
    let keys = inbound.compactMap { key, assembly in assembly.endpointId == endpointId ? key : nil }
    for key in keys { removeInbound(key: key) }
  }

  private func clearAllInbound() {
    inbound.removeAll()
    inboundBytes = 0
    inboundMessagesByEndpoint.removeAll()
    inboundBytesByEndpoint.removeAll()
    inboundCleanupScheduled = false
    inboundCleanupGeneration += 1
  }

  private func rejectWrite(endpointId: String, message: String) {
    pendingWrites.removeValue(forKey: endpointId)
    writeResolvers.removeValue(forKey: endpointId)
    writeRejecters.removeValue(forKey: endpointId)?(
      NSError(domain: "ExpoProximity", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    )
  }

  private func rejectAllWrites(message: String) {
    for endpointId in Array(writeRejecters.keys) {
      rejectWrite(endpointId: endpointId, message: message)
    }
    pendingWrites.removeAll()
    writeResolvers.removeAll()
  }

  private func writeNext(endpointId: String, peripheral: CBPeripheral, characteristic: CBCharacteristic) {
    guard var pending = pendingWrites[endpointId], pending.nextIndex < pending.frames.count else {
      pendingWrites.removeValue(forKey: endpointId)
      writeResolvers.removeValue(forKey: endpointId)?()
      writeRejecters.removeValue(forKey: endpointId)
      return
    }
    let frame = pending.frames[pending.nextIndex]
    pending.nextIndex += 1
    pendingWrites[endpointId] = pending
    peripheral.writeValue(frame, for: characteristic, type: .withResponse)
  }

  fileprivate func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    let endpoint = "c:\(peripheral.identifier.uuidString)"
    if let error {
      pendingWrites.removeValue(forKey: endpoint)
      writeResolvers.removeValue(forKey: endpoint)
      writeRejecters.removeValue(forKey: endpoint)?(error)
      return
    }
    writeNext(endpointId: endpoint, peripheral: peripheral, characteristic: characteristic)
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic)
  {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    subscribedCentrals[endpoint] = central
    let generation = activateConnectionGeneration(endpointId: endpoint)
    trace("subscribed endpoint=\(endpoint) generation=\(generation)")
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "connected", "generation": generation,
    ])
  }

  fileprivate func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic)
  {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    let generation = connectionGenerations[endpoint] ?? 0
    trace("unsubscribed endpoint=\(endpoint) generation=\(generation)")
    activeConnectionEndpoints.remove(endpoint)
    subscribedCentrals.removeValue(forKey: endpoint)
    nextPacketIds.removeValue(forKey: endpoint)
    clearInbound(endpointId: endpoint)
    rejectWrite(endpointId: endpoint, message: "The nearby peer disconnected.")
    sendEvent("onConnection", [
      "endpointId": endpoint, "state": "disconnected", "generation": generation,
    ])
  }

  fileprivate func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    if profileNotificationPending { publishProfileUpdate() }
    for endpoint in Array(pendingWrites.keys) where endpoint.hasPrefix("p:") {
      indicateNext(endpointId: endpoint)
    }
  }

  private func publishProfileUpdate() {
    guard let manager = peripheralManager, let characteristic = profileCharacteristic else {
      return
    }
    profileNotificationPending = !manager.updateValue(
      profileData,
      for: characteristic,
      onSubscribedCentrals: nil
    )
  }

  private func indicateNext(endpointId: String) {
    guard let manager = peripheralManager, let characteristic = mailboxCharacteristic,
      let central = subscribedCentrals[endpointId]
    else { return }
    var sent = 0
    while sent < maximumIndicationsPerTurn {
      guard var pending = pendingWrites[endpointId] else { return }
      guard pending.nextIndex < pending.frames.count else {
        pendingWrites.removeValue(forKey: endpointId)
        writeResolvers.removeValue(forKey: endpointId)?()
        writeRejecters.removeValue(forKey: endpointId)
        return
      }
      let frame = pending.frames[pending.nextIndex]
      guard manager.updateValue(frame, for: characteristic, onSubscribedCentrals: [central]) else { return }
      pending.nextIndex += 1
      pendingWrites[endpointId] = pending
      sent += 1
    }
    bluetoothQueue.async { [weak self] in self?.indicateNext(endpointId: endpointId) }
  }

  private func frames(payload: Data, packetId: UInt64, maximumFrameSize: Int) -> [Data]? {
    let chunkSize = max(1, maximumFrameSize - 12)
    let total = max(1, Int(ceil(Double(payload.count) / Double(chunkSize))))
    guard total <= maximumChunkCount else { return nil }
    var frames: [Data] = []
    frames.reserveCapacity(total)
    for index in 0..<total {
      let start = index * chunkSize
      let end = min(payload.count, start + chunkSize)
      var frame = Data()
      var packet = packetId.bigEndian
      var fragmentIndex = UInt16(index).bigEndian
      var fragmentCount = UInt16(total).bigEndian
      withUnsafeBytes(of: &packet) { frame.append(contentsOf: $0) }
      withUnsafeBytes(of: &fragmentIndex) { frame.append(contentsOf: $0) }
      withUnsafeBytes(of: &fragmentCount) { frame.append(contentsOf: $0) }
      frame.append(payload.subdata(in: start..<end))
      frames.append(frame)
    }
    return frames
  }

  private func stateName(_ state: CBManagerState) -> String {
    switch state {
    case .poweredOn: return "poweredOn"
    case .poweredOff: return "poweredOff"
    case .unauthorized: return "unauthorized"
    case .unsupported: return "unsupported"
    case .resetting: return "resetting"
    default: return "unknown"
    }
  }

  private func activateConnectionGeneration(endpointId: String) -> UInt64 {
    if activeConnectionEndpoints.contains(endpointId) {
      return connectionGenerations[endpointId] ?? 0
    }
    activeConnectionEndpoints.insert(endpointId)
    let next = (connectionGenerations[endpointId] ?? 0) + 1
    connectionGenerations[endpointId] = next
    return next
  }

  private func recordSignal(endpoint: String, rssi: Int) {
    guard rssi != 127 else { return }
    rssiByEndpoint[endpoint] = rssi
    let now = ProcessInfo.processInfo.systemUptime
    if let lastEmission = signalEmittedAtByEndpoint[endpoint], now - lastEmission < 1 { return }
    signalEmittedAtByEndpoint[endpoint] = now
    sendEvent("onSignal", ["endpointId": "c:\(endpoint)", "rssi": rssi])
  }

}

private final class ExpoProximityBluetoothDelegate: NSObject, CBCentralManagerDelegate,
  CBPeripheralManagerDelegate, CBPeripheralDelegate
{
  private weak var owner: ExpoProximityModule?

  init(owner: ExpoProximityModule) {
    self.owner = owner
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    owner?.centralManagerDidUpdateState(central)
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    owner?.peripheralManagerDidUpdateState(peripheral)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    owner?.peripheralManager(peripheral, didAdd: service, error: error)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber)
  {
    owner?.centralManager(central, didDiscover: peripheral, advertisementData: advertisementData, rssi: RSSI)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    owner?.centralManager(central, didConnect: peripheral)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?)
  {
    owner?.centralManager(central, didDisconnectPeripheral: peripheral, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    owner?.peripheral(peripheral, didDiscoverServices: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
    owner?.peripheral(peripheral, didModifyServices: invalidatedServices)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService,
    error: Error?)
  {
    owner?.peripheral(peripheral, didDiscoverCharacteristicsFor: service, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    owner?.peripheral(peripheral, didUpdateValueFor: characteristic, error: error)
  }

  func peripheral(_ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?)
  {
    owner?.peripheral(
      peripheral,
      didUpdateNotificationStateFor: characteristic,
      error: error
    )
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    owner?.peripheralManager(peripheral, didReceiveRead: request)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    owner?.peripheralManager(peripheral, didReceiveWrite: requests)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic)
  {
    owner?.peripheralManager(peripheral, central: central, didSubscribeTo: characteristic)
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic)
  {
    owner?.peripheralManager(peripheral, central: central, didUnsubscribeFrom: characteristic)
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
    owner?.peripheralManagerIsReady(toUpdateSubscribers: peripheral)
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic,
    error: Error?)
  {
    owner?.peripheral(peripheral, didWriteValueFor: characteristic, error: error)
  }
}
