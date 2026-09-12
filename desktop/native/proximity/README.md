# Desktop proximity native modules

Electron launches one platform-owned `psstpsst-proximity` helper from
`bin/<node-platform>/`. Each helper uses the operating system Bluetooth stack
directly and implements both BLE Central and Peripheral roles:

- macOS: CoreBluetooth (`CBCentralManager` and `CBPeripheralManager`)
- Windows: WinRT (`BluetoothLEAdvertisementWatcher` and `GattServiceProvider`)
- Linux: BlueZ D-Bus through the official BlueR Rust bindings

Build the helper for the current host with `npm run electron:build:native`.
macOS produces a universal arm64/x64 executable. Windows and Linux build their
locked Rust projects and copy the release executable into
`bin/<node-platform>/`. Generated binaries are ignored by Git and packaged
through Electron Builder's `extraResources` rule.

The helper reads one JSON object per line from stdin:

```json
{"id":"1","command":"startScan","args":{"scanDurationMs":10000}}
```

It answers on stdout with either a response or an unsolicited transport event:

```json
{"type":"response","id":"1","ok":true}
{"type":"event","name":"onPeer","value":{"endpointId":"c:...","profile":"...","rssi":-50}}
```

Commands and events exactly mirror `ProximityTransportPort`. Binary Profiles
and logical packets are base64 only while crossing the JSON-lines RPC; BLE
carries their decoded bytes. Packets use the common 12-byte binary fragment
header and the same bounds and UUIDs as `modules/expo-proximity`; changing that
protocol requires updating every native implementation together. A helper
must answer `handshake` before Electron exposes the capability. The handshake
includes protocol and implementation versions plus the required Central,
Peripheral, and concurrent-role flags.

Stdout is reserved for JSON-lines RPC. Diagnostics go to stderr. Native code
does not receive account secrets or perform Nearby authentication; it transports
the already-encrypted wire payload and the public discovery profile only.

Windows ships through NSIS as an unpackaged desktop application. Nearby remains
available only when the Windows Bluetooth APIs and the local adapter support
both BLE roles; release verification must cover scanning, GATT service hosting,
and advertising on an NSIS installation. Linux requires BlueZ with local GATT
and LE advertising support, plus an adapter capable of using both roles. The
helper never bypasses BlueZ, disables `bluetoothd`, or runs as root.
