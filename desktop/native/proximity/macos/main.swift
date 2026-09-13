@preconcurrency import CoreBluetooth
import Darwin
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
private let inboundLifetime: TimeInterval = 60
private let writeTimeout: TimeInterval = 12
private let maximumIndicationsPerTurn = 16

private enum ProximityError: LocalizedError {
  case invalidRequest
  case invalidArguments
  case offline
  case busy
  case tooLarge
  case writeFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidRequest: return "Invalid native proximity request."
    case .invalidArguments: return "Invalid native proximity arguments."
    case .offline: return "The nearby peer is not connected."
    case .busy: return "A write is already active for this nearby peer."
    case .tooLarge: return "The nearby message is too large."
    case .writeFailed(let message): return message
    }
  }
}

private final class JSONEmitter: @unchecked Sendable {
  private let lock = NSLock()

  func response(id: String, value: Any? = nil) {
    var object: [String: Any] = ["type": "response", "id": id, "ok": true]
    if let value { object["value"] = value }
    write(object)
  }

  func failure(id: String, error: Error) {
    write([
      "type": "response",
      "id": id,
      "ok": false,
      "error": error.localizedDescription,
    ])
  }

  func event(name: String, value: [String: Any]) {
    write(["type": "event", "name": name, "value": value])
  }

  func log(_ message: String) {
    FileHandle.standardError.write(Data("[psstpsst-proximity] \(message)\n".utf8))
  }

  private func write(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object)
    else { return }
    lock.lock()
    defer { lock.unlock() }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
  }
}

private struct InboundAssembly {
  let total: Int
  let createdAt: TimeInterval
  var decodedBytes: Int
  var chunks: [Int: Data]
}

private struct PendingWrite {
  let frames: [Data]
  var nextIndex: Int
}

private final class MacOSProximityTransport: NSObject, CBCentralManagerDelegate,
  CBPeripheralManagerDelegate, CBPeripheralDelegate
{
  private let emitter: JSONEmitter
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
  private var pendingWrites: [String: PendingWrite] = [:]
  private var writeCompletions: [String: (Result<Void, Error>) -> Void] = [:]
  private var writeGenerations: [String: UInt64] = [:]
  private var nextWriteGeneration: UInt64 = 0
  private var nextPacketIds: [String: UInt64] = [:]
  private var connectionGenerations: [String: UInt64] = [:]
  private var activeConnectionEndpoints = Set<String>()
  private var pendingCentralReconnectEndpoints = Set<String>()
  private var permissionReplies: [(Bool) -> Void] = []
  private var permissionPollScheduled = false
  private var pendingScanDurationMs: Int?
  private var scanIsContinuous = false
  private var scanGeneration = 0
  private var advertisingRequested = false
  private var lastBluetoothState: String?

  private func discoverPeerServices(_ peripheral: CBPeripheral) {
    guard serviceDiscoveryEndpoints.insert(peripheral.identifier.uuidString).inserted else { return }
    peripheral.discoverServices([serviceUUID])
  }

  private func trace(_ message: @autoclosure () -> String) {
    #if DEBUG
    print("[nearby-native] \(message())")
    #endif
  }

  init(emitter: JSONEmitter) {
    self.emitter = emitter
    super.init()
  }

  func requestPermissions(reply: @escaping (Bool) -> Void) {
    switch CBManager.authorization {
    case .allowedAlways:
      ensureManagers()
      emitCurrentBluetoothState(force: true)
      reply(true)
    case .denied, .restricted:
      reply(false)
    case .notDetermined:
      permissionReplies.append(reply)
      ensureManagers()
      schedulePermissionResolution()
    @unknown default:
      reply(false)
    }
  }

  func startAdvertising(profile: String) {
    guard let data = Data(base64Encoded: profile) else { return }
    profileData = data
    peripheralOnlyEndpoints.removeAll()
    advertisingRequested = true
    ensureManagers()
    emitCurrentBluetoothState(force: true)
    configurePeripheralIfReady()
  }

  func updateProfile(_ profile: String) {
    guard let data = Data(base64Encoded: profile) else { return }
    profileData = data
    publishProfileUpdate()
  }

  func preferPeripheral(endpointId: String) {
    let rawEndpoint = endpointId.hasPrefix("c:") ? String(endpointId.dropFirst(2)) : endpointId
    peripheralOnlyEndpoints.insert(rawEndpoint)
    pendingCentralReconnectEndpoints.remove(rawEndpoint)
    activeConnectionEndpoints.remove("c:\(rawEndpoint)")
    if let peripheral = peripherals.removeValue(forKey: rawEndpoint) {
      central?.cancelPeripheralConnection(peripheral)
    }
    profileByEndpoint.removeValue(forKey: rawEndpoint)
    serviceDiscoveryEndpoints.remove(rawEndpoint)
    mailboxByEndpoint.removeValue(forKey: rawEndpoint)
    nextPacketIds.removeValue(forKey: endpointId)
  }

  func startScan(durationMs: Int) {
    ensureManagers()
    emitCurrentBluetoothState(force: true)
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
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    if durationMs > 0 {
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(1_000, durationMs))) {
        [weak self] in
        guard let self, self.scanGeneration == generation else { return }
        self.central?.stopScan()
        self.scanIsContinuous = false
      }
    }
  }

  func stopScan() {
    pendingScanDurationMs = nil
    scanIsContinuous = false
    scanGeneration += 1
    central?.stopScan()
  }

  func stopSession() {
    advertisingRequested = false
    stopScan()
    for peripheral in peripherals.values { central?.cancelPeripheralConnection(peripheral) }
    peripheralManager?.stopAdvertising()
    peripheralManager?.removeAllServices()
    profileCharacteristic = nil
    profileNotificationPending = false
    mailboxCharacteristic = nil
    peripherals.removeAll()
    profileByEndpoint.removeAll()
    serviceDiscoveryEndpoints.removeAll()
    mailboxByEndpoint.removeAll()
    subscribedCentrals.removeAll()
    peripheralOnlyEndpoints.removeAll()
    rssiByEndpoint.removeAll()
    signalEmittedAtByEndpoint.removeAll()
    nextPacketIds.removeAll()
    activeConnectionEndpoints.removeAll()
    pendingCentralReconnectEndpoints.removeAll()
    writeGenerations.removeAll()
    inbound.removeAll()
    failAllWrites(ProximityError.offline)
  }

  func disconnect(endpointId: String) {
    nextPacketIds.removeValue(forKey: endpointId)
    clearInbound(endpointId: endpointId)
    failWrite(endpointId: endpointId, error: ProximityError.offline)
    if endpointId.hasPrefix("c:") {
      activeConnectionEndpoints.remove(endpointId)
      let rawEndpoint = String(endpointId.dropFirst(2))
      if let peripheral = peripherals.removeValue(forKey: rawEndpoint) {
        central?.cancelPeripheralConnection(peripheral)
      }
      profileByEndpoint.removeValue(forKey: rawEndpoint)
      serviceDiscoveryEndpoints.remove(rawEndpoint)
      mailboxByEndpoint.removeValue(forKey: rawEndpoint)
    } else if endpointId.hasPrefix("p:") {
      // CoreBluetooth cannot force-disconnect a subscribed Central. Keep the
      // transport route so its next write can start a new logical generation.
      activeConnectionEndpoints.remove(endpointId)
      peripheralOnlyEndpoints.remove(String(endpointId.dropFirst(2)))
    }
  }

  func refreshPeerProfile(endpointId: String) throws {
    if endpointId.hasPrefix("p:") {
      let rawEndpoint = String(endpointId.dropFirst(2))
      peripheralOnlyEndpoints.remove(rawEndpoint)
      if central?.isScanning != true || !scanIsContinuous { startScan(durationMs: 10_000) }
      return
    }
    let rawEndpoint = endpointId.hasPrefix("c:") ? String(endpointId.dropFirst(2)) : endpointId
    peripheralOnlyEndpoints.remove(rawEndpoint)
    pendingCentralReconnectEndpoints.insert(rawEndpoint)
    if peripherals[rawEndpoint] == nil, let identifier = UUID(uuidString: rawEndpoint),
      let recovered = central?.retrievePeripherals(withIdentifiers: [identifier]).first
    {
      peripherals[rawEndpoint] = recovered
      recovered.delegate = self
      trace("retrieved Central endpoint=\(endpointId) state=\(recovered.state.rawValue)")
    }
    guard let peripheral = peripherals[rawEndpoint] else {
      startScan(durationMs: 10_000)
      return
    }
    if peripheral.state == .disconnected {
      central?.connect(peripheral)
      return
    }
    guard peripheral.state == .connected else {
      if central?.isScanning != true { startScan(durationMs: 10_000) }
      return
    }
    if activeConnectionEndpoints.contains(endpointId) {
      pendingCentralReconnectEndpoints.remove(rawEndpoint)
      if let characteristic = profileByEndpoint[rawEndpoint] {
        peripheral.readValue(for: characteristic)
      } else {
        discoverPeerServices(peripheral)
      }
      return
    }
    activeConnectionEndpoints.remove(endpointId)
    let generation = activateConnectionGeneration(endpointId: endpointId)
    pendingCentralReconnectEndpoints.remove(rawEndpoint)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpointId, "state": "connected", "generation": generation]
    )
    if let characteristic = profileByEndpoint[rawEndpoint] {
      peripheral.readValue(for: characteristic)
    } else {
      discoverPeerServices(peripheral)
    }
  }

  func send(endpointId: String, payload: String, completion: @escaping (Result<Void, Error>) -> Void) {
    guard writeCompletions[endpointId] == nil else {
      completion(.failure(ProximityError.busy))
      return
    }
    guard let payloadBytes = Data(base64Encoded: payload) else {
      completion(.failure(ProximityError.invalidArguments))
      return
    }
    guard payloadBytes.count <= maximumWireBytes else {
      completion(.failure(ProximityError.tooLarge))
      return
    }
    trace(
      "outbound packet endpoint=\(endpointId) generation=\(connectionGenerations[endpointId] ?? 0) type=\(payloadBytes.count > 1 ? String(format: "0x%02x", payloadBytes[1]) : "truncated") bytes=\(payloadBytes.count)"
    )
    let maximumFrameSize: Int
    if endpointId.hasPrefix("c:"),
      let peripheral = peripherals[String(endpointId.dropFirst(2))],
      peripheral.state == .connected,
      mailboxByEndpoint[String(endpointId.dropFirst(2))] != nil
    {
      maximumFrameSize = peripheral.maximumWriteValueLength(for: .withResponse)
    } else if endpointId.hasPrefix("p:"), let central = subscribedCentrals[endpointId] {
      maximumFrameSize = central.maximumUpdateValueLength
    } else {
      completion(.failure(ProximityError.offline))
      return
    }
    let packetId = nextPacketIds[endpointId, default: 0]
    guard packetId < UInt64.max else {
      completion(.failure(ProximityError.tooLarge))
      return
    }
    nextPacketIds[endpointId] = packetId + 1
    guard let frames = frames(payload: payloadBytes, packetId: packetId, maximumFrameSize: maximumFrameSize) else {
      completion(.failure(ProximityError.tooLarge))
      return
    }
    pendingWrites[endpointId] = PendingWrite(frames: frames, nextIndex: 0)
    writeCompletions[endpointId] = completion
    nextWriteGeneration &+= 1
    let writeGeneration = nextWriteGeneration
    writeGenerations[endpointId] = writeGeneration
    DispatchQueue.main.asyncAfter(deadline: .now() + writeTimeout) { [weak self] in
      guard let self, self.writeGenerations[endpointId] == writeGeneration,
        self.writeCompletions[endpointId] != nil
      else { return }
      self.trace("write timeout endpoint=\(endpointId) generation=\(self.connectionGenerations[endpointId] ?? 0)")
      self.failWrite(endpointId: endpointId, error: ProximityError.offline)
      self.disconnect(endpointId: endpointId)
      self.emitter.event(
        name: "onConnection",
        value: ["endpointId": endpointId, "state": "disconnected"]
      )
    }
    if endpointId.hasPrefix("c:") {
      let rawEndpoint = String(endpointId.dropFirst(2))
      writeNext(
        endpointId: endpointId,
        peripheral: peripherals[rawEndpoint]!,
        characteristic: mailboxByEndpoint[rawEndpoint]!
      )
    } else {
      indicateNext(endpointId: endpointId)
    }
  }

  private func ensureManagers() {
    if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
    if peripheralManager == nil { peripheralManager = CBPeripheralManager(delegate: self, queue: .main) }
  }

  private func resolvePermissionReplies() {
    guard CBManager.authorization != .notDetermined else { return }
    let granted = CBManager.authorization == .allowedAlways
    emitCurrentBluetoothState()
    let replies = permissionReplies
    permissionReplies.removeAll()
    for reply in replies { reply(granted) }
  }

  private func schedulePermissionResolution() {
    guard !permissionPollScheduled, !permissionReplies.isEmpty else { return }
    permissionPollScheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(200)) { [weak self] in
      guard let self else { return }
      self.permissionPollScheduled = false
      self.resolvePermissionReplies()
      if !self.permissionReplies.isEmpty { self.schedulePermissionResolution() }
    }
  }

  private func emitCurrentBluetoothState(force: Bool = false) {
    if let state = central?.state ?? peripheralManager?.state {
      emitBluetoothState(state, force: force)
    }
  }

  private func emitBluetoothState(_ state: CBManagerState, force: Bool = false) {
    let name = stateName(state)
    guard force || name != lastBluetoothState else { return }
    lastBluetoothState = name
    emitter.event(name: "onBluetoothState", value: ["state": name])
  }

  private func configurePeripheralIfReady() {
    guard advertisingRequested, let manager = peripheralManager, manager.state == .poweredOn else {
      return
    }
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

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    emitBluetoothState(central.state)
    resolvePermissionReplies()
    if central.state == .poweredOn, let durationMs = pendingScanDurationMs {
      startScan(durationMs: durationMs)
    }
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    emitCurrentBluetoothState()
    resolvePermissionReplies()
    if advertisingRequested { configurePeripheralIfReady() }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard advertisingRequested else { return }
    if let error {
      emitter.log("Unable to add GATT service: \(error.localizedDescription)")
      return
    }
    peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceUUID]])
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let endpoint = peripheral.identifier.uuidString
    recordSignal(endpoint: endpoint, rssi: RSSI.intValue)
    let suppressed = peripheralOnlyEndpoints.contains(endpoint)
    trace(
      "discovered endpoint=\(endpoint) state=\(peripheral.state.rawValue) suppressed=\(suppressed) pendingReconnect=\(pendingCentralReconnectEndpoints.contains(endpoint)) rssi=\(RSSI)"
    )
    guard !suppressed else { return }
    peripherals[endpoint] = peripheral
    peripheral.delegate = self
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
        emitter.event(
          name: "onConnection",
          value: ["endpointId": endpointId, "state": "connected", "generation": generation]
        )
      }
      discoverPeerServices(peripheral)
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let endpoint = peripheral.identifier.uuidString
    let endpointId = "c:\(endpoint)"
    if pendingCentralReconnectEndpoints.remove(endpoint) != nil {
      activeConnectionEndpoints.remove(endpointId)
    }
    let generation = activateConnectionGeneration(endpointId: endpointId)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpointId, "state": "connected", "generation": generation]
    )
    discoverPeerServices(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager,
    didFailToConnect peripheral: CBPeripheral,
    error: Error?
  ) {
    disconnected(peripheral)
  }

  func centralManager(
    _ central: CBCentralManager,
    didDisconnectPeripheral peripheral: CBPeripheral,
    error: Error?
  ) {
    disconnected(peripheral)
  }

  private func disconnected(_ peripheral: CBPeripheral) {
    let rawEndpoint = peripheral.identifier.uuidString
    let endpoint = "c:\(rawEndpoint)"
    let generation = connectionGenerations[endpoint] ?? 0
    activeConnectionEndpoints.remove(endpoint)
    profileByEndpoint.removeValue(forKey: rawEndpoint)
    serviceDiscoveryEndpoints.remove(rawEndpoint)
    mailboxByEndpoint.removeValue(forKey: rawEndpoint)
    nextPacketIds.removeValue(forKey: endpoint)
    clearInbound(endpointId: endpoint)
    failWrite(endpointId: endpoint, error: ProximityError.offline)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpoint, "state": "disconnected", "generation": generation])
    if pendingCentralReconnectEndpoints.contains(rawEndpoint),
      !peripheralOnlyEndpoints.contains(rawEndpoint),
      central?.state == .poweredOn
    {
      trace("reconnecting after disconnect endpoint=\(rawEndpoint)")
      peripherals[rawEndpoint] = peripheral
      peripheral.delegate = self
      central?.connect(peripheral)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didModifyServices invalidatedServices: [CBService]) {
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
    failWrite(endpointId: endpoint, error: ProximityError.offline)
    central?.cancelPeripheralConnection(peripheral)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpoint, "state": "disconnected", "generation": generation])
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard error == nil else {
      serviceDiscoveryEndpoints.remove(peripheral.identifier.uuidString)
      return
    }
    for service in peripheral.services ?? [] where service.uuid == serviceUUID {
      peripheral.discoverCharacteristics([profileUUID, mailboxUUID], for: service)
    }
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didDiscoverCharacteristicsFor service: CBService,
    error: Error?
  ) {
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

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateNotificationStateFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    trace(
      "notification state endpoint=c:\(peripheral.identifier.uuidString) notifying=\(characteristic.isNotifying) error=\(error?.localizedDescription ?? "none")"
    )
    guard error == nil, characteristic.uuid == mailboxUUID, characteristic.isNotifying,
      let profile = profileByEndpoint[peripheral.identifier.uuidString]
    else { return }
    peripheral.readValue(for: profile)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didUpdateValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    guard error == nil, let value = characteristic.value else { return }
    let rawEndpoint = peripheral.identifier.uuidString
    let endpoint = "c:\(rawEndpoint)"
    if characteristic.uuid == profileUUID {
      guard mailboxByEndpoint[rawEndpoint]?.isNotifying == true else { return }
      emitter.event(
        name: "onPeer",
        value: [
          "endpointId": endpoint,
          "generation": connectionGenerations[endpoint] ?? 0,
          "profile": value.base64EncodedString(),
          "rssi": rssiByEndpoint[rawEndpoint] ?? 0,
        ]
      )
    } else if characteristic.uuid == mailboxUUID {
      trace(
        "notification value endpoint=\(endpoint) bytes=\(value.count) generation=\(connectionGenerations[endpoint] ?? 0)"
      )
      accept(frame: value, endpointId: endpoint)
    }
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
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

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
    for request in requests {
      guard request.characteristic.uuid == mailboxUUID else {
        peripheral.respond(to: request, withResult: .requestNotSupported)
        continue
      }
      if let value = request.value {
        accept(
          frame: value,
          endpointId: "p:\(request.central.identifier.uuidString)",
          central: request.central
        )
      }
      peripheral.respond(to: request, withResult: .success)
    }
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didSubscribeTo characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    subscribedCentrals[endpoint] = central
    let generation = activateConnectionGeneration(endpointId: endpoint)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpoint, "state": "connected", "generation": generation])
  }

  func peripheralManager(
    _ peripheral: CBPeripheralManager,
    central: CBCentral,
    didUnsubscribeFrom characteristic: CBCharacteristic
  ) {
    guard characteristic.uuid == mailboxUUID else { return }
    let endpoint = "p:\(central.identifier.uuidString)"
    let generation = connectionGenerations[endpoint] ?? 0
    activeConnectionEndpoints.remove(endpoint)
    subscribedCentrals.removeValue(forKey: endpoint)
    nextPacketIds.removeValue(forKey: endpoint)
    clearInbound(endpointId: endpoint)
    failWrite(endpointId: endpoint, error: ProximityError.offline)
    emitter.event(
      name: "onConnection",
      value: ["endpointId": endpoint, "state": "disconnected", "generation": generation])
  }

  func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
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

  private func accept(frame: Data, endpointId: String, central: CBCentral? = nil) {
    if let central, endpointId.hasPrefix("p:") {
      // A reused GATT subscription may deliver writes without another
      // didSubscribe callback. The request still carries the live reply route.
      subscribedCentrals[endpointId] = central
    }
    let generation: UInt64
    if endpointId.hasPrefix("p:"), central != nil,
      !activeConnectionEndpoints.contains(endpointId)
    {
      generation = activateConnectionGeneration(endpointId: endpointId)
      emitter.event(
        name: "onConnection",
        value: ["endpointId": endpointId, "state": "connected", "generation": generation]
      )
    } else {
      guard let currentGeneration = connectionGenerations[endpointId] else { return }
      generation = currentGeneration
    }
    let now = ProcessInfo.processInfo.systemUptime
    inbound = inbound.filter { now - $0.value.createdAt <= inboundLifetime }
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
    if inbound[key] == nil {
      let endpointPrefix = "\(endpointId):"
      let endpointMessages = inbound.keys.filter { $0.hasPrefix(endpointPrefix) }.count
      guard inbound.count < maximumInboundMessages,
        endpointMessages < maximumInboundMessagesPerEndpoint
      else { return }
      inbound[key] = InboundAssembly(
        total: total, createdAt: now, decodedBytes: 0, chunks: [:])
    }
    guard var assembly = inbound[key], assembly.total == total else {
      inbound.removeValue(forKey: key)
      return
    }
    if let previous = assembly.chunks[index] {
      if previous != decoded { inbound.removeValue(forKey: key) }
      return
    }
    let decodedBytes = assembly.decodedBytes + decoded.count
    let globalBytes = inbound.values.reduce(0) { $0 + $1.decodedBytes }
    let endpointPrefix = "\(endpointId):"
    let endpointBytes = inbound.reduce(0) { total, entry in
      entry.key.hasPrefix(endpointPrefix) ? total + entry.value.decodedBytes : total
    }
    guard decodedBytes <= maximumWireBytes,
      globalBytes + decoded.count <= maximumInboundBytes,
      endpointBytes + decoded.count <= maximumInboundBytesPerEndpoint
    else {
      inbound.removeValue(forKey: key)
      return
    }
    assembly.decodedBytes = decodedBytes
    assembly.chunks[index] = decoded
    inbound[key] = assembly
    guard assembly.chunks.count == total else { return }
    inbound.removeValue(forKey: key)
    var data = Data(capacity: assembly.decodedBytes)
    for chunkIndex in 0..<total {
      guard let chunk = assembly.chunks[chunkIndex] else { return }
      data.append(chunk)
    }
    trace(
      "inbound packet endpoint=\(endpointId) generation=\(generation) packet=\(packetId) type=\(data.count > 1 ? String(format: "0x%02x", data[1]) : "truncated") bytes=\(data.count)"
    )
    emitter.event(
      name: "onMessage",
      value: [
        "endpointId": endpointId,
        "generation": generation,
        "payload": data.base64EncodedString(),
      ]
    )
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

  private func clearInbound(endpointId: String) {
    let prefix = "\(endpointId):"
    inbound = inbound.filter { !$0.key.hasPrefix(prefix) }
  }

  private func writeNext(
    endpointId: String,
    peripheral: CBPeripheral,
    characteristic: CBCharacteristic
  ) {
    guard var pending = pendingWrites[endpointId], pending.nextIndex < pending.frames.count else {
      finishWrite(endpointId: endpointId)
      return
    }
    let frame = pending.frames[pending.nextIndex]
    pending.nextIndex += 1
    pendingWrites[endpointId] = pending
    peripheral.writeValue(frame, for: characteristic, type: .withResponse)
  }

  func peripheral(
    _ peripheral: CBPeripheral,
    didWriteValueFor characteristic: CBCharacteristic,
    error: Error?
  ) {
    let endpoint = "c:\(peripheral.identifier.uuidString)"
    if let error {
      trace("write response endpoint=\(endpoint) error=\(error.localizedDescription)")
      failWrite(endpointId: endpoint, error: ProximityError.writeFailed(error.localizedDescription))
      return
    }
    trace("write response endpoint=\(endpoint) success=true")
    writeNext(endpointId: endpoint, peripheral: peripheral, characteristic: characteristic)
  }

  private func indicateNext(endpointId: String) {
    guard let manager = peripheralManager, let characteristic = mailboxCharacteristic,
      let central = subscribedCentrals[endpointId]
    else {
      failWrite(endpointId: endpointId, error: ProximityError.offline)
      return
    }
    var sent = 0
    while sent < maximumIndicationsPerTurn {
      guard var pending = pendingWrites[endpointId] else { return }
      guard pending.nextIndex < pending.frames.count else {
        finishWrite(endpointId: endpointId)
        return
      }
      let frame = pending.frames[pending.nextIndex]
      guard manager.updateValue(frame, for: characteristic, onSubscribedCentrals: [central]) else {
        return
      }
      pending.nextIndex += 1
      pendingWrites[endpointId] = pending
      sent += 1
    }
    DispatchQueue.main.async { [weak self] in self?.indicateNext(endpointId: endpointId) }
  }

  private func finishWrite(endpointId: String) {
    pendingWrites.removeValue(forKey: endpointId)
    writeGenerations.removeValue(forKey: endpointId)
    writeCompletions.removeValue(forKey: endpointId)?(.success(()))
  }

  private func failWrite(endpointId: String, error: Error) {
    pendingWrites.removeValue(forKey: endpointId)
    writeGenerations.removeValue(forKey: endpointId)
    writeCompletions.removeValue(forKey: endpointId)?(.failure(error))
  }

  private func failAllWrites(_ error: Error) {
    let endpoints = Array(writeCompletions.keys)
    for endpoint in endpoints { failWrite(endpointId: endpoint, error: error) }
  }

  private func frames(payload: Data, packetId: UInt64, maximumFrameSize: Int) -> [Data]? {
    let chunkSize = max(1, maximumFrameSize - 12)
    let total = max(1, Int(ceil(Double(payload.count) / Double(chunkSize))))
    guard total <= maximumChunkCount else { return nil }
    var output: [Data] = []
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
      output.append(frame)
    }
    return output
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

  private func recordSignal(endpoint: String, rssi: Int) {
    guard rssi != 0, rssi != 127 else { return }
    rssiByEndpoint[endpoint] = rssi
    let now = ProcessInfo.processInfo.systemUptime
    if let last = signalEmittedAtByEndpoint[endpoint], now - last < 1 { return }
    signalEmittedAtByEndpoint[endpoint] = now
    emitter.event(name: "onSignal", value: ["endpointId": "c:\(endpoint)", "rssi": rssi])
  }

}

private final class RPCHost {
  private let emitter: JSONEmitter
  private let transport: MacOSProximityTransport

  init(emitter: JSONEmitter) {
    self.emitter = emitter
    transport = MacOSProximityTransport(emitter: emitter)
  }

  func accept(line: String) {
    guard let data = line.data(using: .utf8), data.count <= 256 * 1024,
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let id = object["id"] as? String, id.utf8.count <= 64,
      let command = object["command"] as? String, command.utf8.count <= 64,
      let args = object["args"] as? [String: Any]
    else { return }

    do {
      switch command {
      case "handshake":
        emitter.response(
          id: id,
          value: [
            "protocolVersion": 1,
            "implementationVersion": "macos-1",
            "platform": "darwin",
            "capabilities": [
              "central": true,
              "peripheral": true,
              "concurrentRoles": true,
            ],
          ]
        )
      case "requestPermissions":
        transport.requestPermissions { [emitter] granted in emitter.response(id: id, value: granted) }
      case "startAdvertising":
        let profile = try string(args, "profile", maximumBytes: 16 * 1024)
        transport.startAdvertising(profile: profile)
        emitter.response(id: id)
      case "updateProfile":
        let profile = try string(args, "profile", maximumBytes: 16 * 1024)
        transport.updateProfile(profile)
        emitter.response(id: id)
      case "preferPeripheral":
        transport.preferPeripheral(endpointId: try string(args, "endpointId", maximumBytes: 256))
        emitter.response(id: id)
      case "disconnect":
        transport.disconnect(endpointId: try string(args, "endpointId", maximumBytes: 256))
        emitter.response(id: id)
      case "startScan":
        guard let duration = args["scanDurationMs"] as? Int, duration >= 0, duration <= 300_000
        else { throw ProximityError.invalidArguments }
        transport.startScan(durationMs: duration)
        emitter.response(id: id)
      case "stopScan":
        transport.stopScan()
        emitter.response(id: id)
      case "stopSession":
        transport.stopSession()
        emitter.response(id: id)
      case "refreshPeerProfile":
        try transport.refreshPeerProfile(
          endpointId: string(args, "endpointId", maximumBytes: 256)
        )
        emitter.response(id: id)
      case "send":
        let endpointId = try string(args, "endpointId", maximumBytes: 256)
        let payload = try string(args, "payload", maximumBytes: maximumWireBytes * 2)
        transport.send(endpointId: endpointId, payload: payload) { [emitter] result in
          switch result {
          case .success: emitter.response(id: id)
          case .failure(let error): emitter.failure(id: id, error: error)
          }
        }
      default:
        throw ProximityError.invalidRequest
      }
    } catch {
      emitter.failure(id: id, error: error)
    }
  }

  func shutdown() {
    transport.stopSession()
  }

  private func string(
    _ args: [String: Any],
    _ key: String,
    maximumBytes: Int
  ) throws -> String {
    guard let value = args[key] as? String, value.utf8.count <= maximumBytes else {
      throw ProximityError.invalidArguments
    }
    return value
  }
}

private let emitter = JSONEmitter()
private let host = RPCHost(emitter: emitter)
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine(strippingNewline: true) {
    DispatchQueue.main.async { host.accept(line: line) }
  }
  DispatchQueue.main.async {
    host.shutdown()
    Darwin.exit(0)
  }
}
RunLoop.main.run()
