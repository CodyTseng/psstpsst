#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("psstpsst-proximity-windows can only run on Windows");
}

#[cfg(target_os = "windows")]
mod windows_runtime {
    use anyhow::{Context, Result, anyhow, bail};
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
    use serde::Deserialize;
    use serde_json::{Value, json};
    use std::{
        collections::{HashMap, HashSet},
        io::{self, Write},
        sync::{
            Arc, Mutex as StdMutex,
            atomic::{AtomicU64, Ordering},
        },
        time::{Duration, Instant},
    };
    use tokio::{
        io::{AsyncBufReadExt, BufReader},
        sync::{Mutex, RwLock, oneshot},
        task::JoinHandle,
    };
    use windows::{
        Devices::Bluetooth::{
            Advertisement::{
                BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
                BluetoothLEAdvertisementWatcherStatus,
                BluetoothLEAdvertisementWatcherStoppedEventArgs, BluetoothLEScanningMode,
            },
            BluetoothAdapter, BluetoothCacheMode, BluetoothConnectionStatus, BluetoothLEDevice,
            GenericAttributeProfile::{
                GattCharacteristic, GattCharacteristicProperties,
                GattClientCharacteristicConfigurationDescriptorValue, GattCommunicationStatus,
                GattDeviceService, GattLocalCharacteristic, GattLocalCharacteristicParameters,
                GattProtectionLevel, GattReadRequestedEventArgs, GattServiceProvider,
                GattServiceProviderAdvertisementStatus,
                GattServiceProviderAdvertisementStatusChangedEventArgs,
                GattServiceProviderAdvertisingParameters, GattSubscribedClient,
                GattValueChangedEventArgs, GattWriteOption, GattWriteRequestedEventArgs,
            },
        },
        Devices::Radios::{Radio, RadioState},
        Foundation::TypedEventHandler,
        Storage::Streams::{DataReader, DataWriter, IBuffer},
        core::{GUID, IInspectable},
    };

    const PROTOCOL_VERSION: u64 = 1;
    const MAXIMUM_WIRE_BYTES: usize = 128 * 1024;
    const MAXIMUM_CHUNK_COUNT: usize = 16_384;
    const MAXIMUM_INBOUND_MESSAGES: usize = 32;
    const MAXIMUM_INBOUND_MESSAGES_PER_ENDPOINT: usize = 4;
    const MAXIMUM_INBOUND_BYTES: usize = 1024 * 1024;
    const MAXIMUM_INBOUND_BYTES_PER_ENDPOINT: usize = 256 * 1024;
    const INBOUND_LIFETIME: Duration = Duration::from_secs(60);
    const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
    const SERVICE_UUID: GUID = GUID::from_u128(0x45D8B02F_6D80_4FC6_914E_B85FCD0440D3);
    const PROFILE_UUID: GUID = GUID::from_u128(0x55980CEE_27E5_48A9_BF1C_AB5DA34B4402);
    const MAILBOX_UUID: GUID = GUID::from_u128(0x86A4C105_9A0E_4144_BCA1_40E7C78A1D93);

    #[derive(Clone)]
    struct Emitter {
        stdout: Arc<StdMutex<io::Stdout>>,
    }

    impl Emitter {
        fn response(&self, id: &str, value: Option<Value>) {
            let mut response = json!({ "type": "response", "id": id, "ok": true });
            if let Some(value) = value {
                response["value"] = value;
            }
            self.write(response);
        }

        fn failure(&self, id: &str, error: &anyhow::Error) {
            self.write(json!({
                "type": "response",
                "id": id,
                "ok": false,
                "error": format!("{error:#}"),
            }));
        }

        fn event(&self, name: &str, value: Value) {
            self.write(json!({ "type": "event", "name": name, "value": value }));
        }

        fn write(&self, value: Value) {
            let Ok(line) = serde_json::to_string(&value) else {
                return;
            };
            let Ok(mut stdout) = self.stdout.lock() else {
                return;
            };
            let _ = writeln!(stdout, "{line}");
            let _ = stdout.flush();
        }
    }

    #[derive(Deserialize)]
    struct Request {
        id: String,
        command: String,
        #[serde(default)]
        args: Value,
    }

    struct Assembly {
        total: usize,
        created_at: Instant,
        decoded_bytes: usize,
        chunks: HashMap<usize, Vec<u8>>,
    }

    #[derive(Default)]
    struct FrameAssembler {
        messages: HashMap<String, Assembly>,
    }

    impl FrameAssembler {
        fn accept(&mut self, endpoint_id: &str, frame: &[u8]) -> Option<Vec<u8>> {
            let now = Instant::now();
            self.messages
                .retain(|_, assembly| now.duration_since(assembly.created_at) <= INBOUND_LIFETIME);
            if frame.len() < 12 {
                return None;
            }
            let packet_id = u64::from_be_bytes(frame[0..8].try_into().ok()?);
            let index = u16::from_be_bytes(frame[8..10].try_into().ok()?) as usize;
            let total = u16::from_be_bytes(frame[10..12].try_into().ok()?) as usize;
            let decoded = frame[12..].to_vec();
            if total == 0
                || total > MAXIMUM_CHUNK_COUNT
                || index >= total
                || (decoded.is_empty() && index + 1 != total)
            {
                return None;
            }
            let key = format!("{endpoint_id}:{packet_id}");
            if !self.messages.contains_key(&key) {
                let prefix = format!("{endpoint_id}:");
                let endpoint_messages = self
                    .messages
                    .keys()
                    .filter(|key| key.starts_with(&prefix))
                    .count();
                if self.messages.len() >= MAXIMUM_INBOUND_MESSAGES
                    || endpoint_messages >= MAXIMUM_INBOUND_MESSAGES_PER_ENDPOINT
                {
                    return None;
                }
                self.messages.insert(
                    key.clone(),
                    Assembly {
                        total,
                        created_at: now,
                        decoded_bytes: 0,
                        chunks: HashMap::new(),
                    },
                );
            }
            let assembly = self.messages.get(&key)?;
            if assembly.total != total {
                self.messages.remove(&key);
                return None;
            }
            if let Some(previous) = assembly.chunks.get(&index) {
                if previous != &decoded {
                    self.messages.remove(&key);
                }
                return None;
            }
            let decoded_bytes = assembly.decoded_bytes.saturating_add(decoded.len());
            let global_bytes = self
                .messages
                .values()
                .map(|assembly| assembly.decoded_bytes)
                .sum::<usize>();
            let prefix = format!("{endpoint_id}:");
            let endpoint_bytes = self
                .messages
                .iter()
                .filter(|(key, _)| key.starts_with(&prefix))
                .map(|(_, assembly)| assembly.decoded_bytes)
                .sum::<usize>();
            if decoded_bytes > MAXIMUM_WIRE_BYTES
                || global_bytes.saturating_add(decoded.len()) > MAXIMUM_INBOUND_BYTES
                || endpoint_bytes.saturating_add(decoded.len()) > MAXIMUM_INBOUND_BYTES_PER_ENDPOINT
            {
                self.messages.remove(&key);
                return None;
            }
            let assembly = self.messages.get_mut(&key)?;
            assembly.decoded_bytes = decoded_bytes;
            assembly.chunks.insert(index, decoded);
            if assembly.chunks.len() != total {
                return None;
            }
            let assembly = self.messages.remove(&key)?;
            let mut output = Vec::with_capacity(assembly.decoded_bytes);
            for index in 0..total {
                output.extend_from_slice(assembly.chunks.get(&index)?);
            }
            Some(output)
        }

        fn clear(&mut self) {
            self.messages.clear();
        }
    }

    fn frames(payload: &[u8], packet_id: u64, maximum_frame_size: usize) -> Result<Vec<Vec<u8>>> {
        if payload.len() > MAXIMUM_WIRE_BYTES {
            bail!("The nearby message is too large");
        }
        let chunk_size = maximum_frame_size.saturating_sub(12).max(1);
        let total = payload.len().div_ceil(chunk_size).max(1);
        if total > MAXIMUM_CHUNK_COUNT {
            bail!("The nearby message needs too many BLE chunks");
        }
        let mut output = Vec::with_capacity(total);
        for index in 0..total {
            let start = index * chunk_size;
            let end = payload.len().min(start + chunk_size);
            let mut frame = Vec::with_capacity(12 + end - start);
            frame.extend_from_slice(&packet_id.to_be_bytes());
            frame.extend_from_slice(&(index as u16).to_be_bytes());
            frame.extend_from_slice(&(total as u16).to_be_bytes());
            frame.extend_from_slice(&payload[start..end]);
            output.push(frame);
        }
        Ok(output)
    }

    fn buffer_from_bytes(bytes: &[u8]) -> Result<IBuffer> {
        let writer = DataWriter::new()?;
        writer.WriteBytes(bytes)?;
        Ok(writer.DetachBuffer()?)
    }

    fn bytes_from_buffer(buffer: &IBuffer) -> Result<Vec<u8>> {
        let reader = DataReader::FromBuffer(buffer)?;
        let mut bytes = vec![0; reader.UnconsumedBufferLength()? as usize];
        reader.ReadBytes(&mut bytes)?;
        Ok(bytes)
    }

    fn endpoint_from_session(
        session: &windows::Devices::Bluetooth::GenericAttributeProfile::GattSession,
    ) -> Result<String> {
        Ok(session.DeviceId()?.Id()?.to_string())
    }

    fn bluetooth_state(state: RadioState) -> &'static str {
        if state == RadioState::On {
            "poweredOn"
        } else {
            "poweredOff"
        }
    }

    #[derive(Clone)]
    struct RemoteEndpoint {
        device: BluetoothLEDevice,
        service: GattDeviceService,
        profile: GattCharacteristic,
        mailbox: GattCharacteristic,
        maximum_frame_size: usize,
        connection_token: i64,
        profile_value_token: Option<i64>,
        mailbox_value_token: i64,
    }

    struct PeripheralResources {
        provider: GattServiceProvider,
        profile: GattLocalCharacteristic,
        mailbox: GattLocalCharacteristic,
        read_token: i64,
        write_token: i64,
        subscribers_token: i64,
        advertisement_token: i64,
    }

    impl PeripheralResources {
        fn close(&self) {
            let _ = self.provider.StopAdvertising();
            let _ = self.profile.RemoveReadRequested(self.read_token);
            let _ = self.mailbox.RemoveWriteRequested(self.write_token);
            let _ = self
                .mailbox
                .RemoveSubscribedClientsChanged(self.subscribers_token);
            let _ = self
                .provider
                .RemoveAdvertisementStatusChanged(self.advertisement_token);
        }
    }

    struct WatcherResources {
        watcher: BluetoothLEAdvertisementWatcher,
        received_token: i64,
        stopped_token: i64,
    }

    impl WatcherResources {
        fn stop(&self) {
            let _ = self.watcher.Stop();
            let _ = self.watcher.RemoveReceived(self.received_token);
            let _ = self.watcher.RemoveStopped(self.stopped_token);
        }
    }

    struct Shared {
        emitter: Emitter,
        profile: RwLock<Vec<u8>>,
        inbound: Mutex<FrameAssembler>,
        remotes: Mutex<HashMap<u64, RemoteEndpoint>>,
        subscribers: Mutex<HashMap<String, GattSubscribedClient>>,
        subscriber_addresses: Mutex<HashMap<String, u64>>,
        connecting: Mutex<HashSet<u64>>,
        suppressed: Mutex<HashSet<u64>>,
        signal_emitted_at: Mutex<HashMap<u64, Instant>>,
        session_generation: AtomicU64,
        next_packet_ids: Mutex<HashMap<String, u64>>,
        connection_generations: Mutex<HashMap<String, u64>>,
        inactive_responder_endpoints: Mutex<HashSet<String>>,
    }

    impl Shared {
        async fn accept_frame(&self, endpoint_id: &str, frame: &[u8]) {
            let reactivate = endpoint_id.starts_with("p:")
                && self
                    .inactive_responder_endpoints
                    .lock()
                    .await
                    .remove(endpoint_id);
            let generation = if reactivate {
                let generation = self.next_connection_generation(endpoint_id).await;
                self.emitter.event(
                    "onConnection",
                    json!({ "endpointId": endpoint_id, "state": "connected", "generation": generation }),
                );
                generation
            } else {
                let generation = self
                    .connection_generations
                    .lock()
                    .await
                    .get(endpoint_id)
                    .copied();
                let Some(generation) = generation else { return };
                generation
            };
            let assembly_endpoint = format!("{endpoint_id}:{generation}");
            if let Some(payload) = self.inbound.lock().await.accept(&assembly_endpoint, frame) {
                self.emitter.event(
                    "onMessage",
                    json!({ "endpointId": endpoint_id, "generation": generation, "payload": BASE64.encode(payload) }),
                );
            }
        }

        async fn next_connection_generation(&self, endpoint_id: &str) -> u64 {
            let mut generations = self.connection_generations.lock().await;
            let next = generations.get(endpoint_id).copied().unwrap_or(0) + 1;
            generations.insert(endpoint_id.to_owned(), next);
            next
        }

        async fn connection_generation(&self, endpoint_id: &str) -> u64 {
            self.connection_generations
                .lock()
                .await
                .get(endpoint_id)
                .copied()
                .unwrap_or(0)
        }

        async fn record_signal(&self, address: u64, rssi: i16) {
            if rssi == 127 {
                return;
            }
            let now = Instant::now();
            let mut emissions = self.signal_emitted_at.lock().await;
            if emissions
                .get(&address)
                .is_some_and(|last| now.duration_since(*last) < Duration::from_secs(1))
            {
                return;
            }
            emissions.insert(address, now);
            self.emitter.event(
                "onSignal",
                json!({ "endpointId": format!("c:{address}"), "rssi": rssi }),
            );
        }
    }

    struct Runtime {
        shared: Arc<Shared>,
        adapter: Option<BluetoothAdapter>,
        radio: Option<Radio>,
        radio_token: Option<i64>,
        peripheral: Option<PeripheralResources>,
        watcher: Option<WatcherResources>,
        scan_timer: Option<JoinHandle<()>>,
        continuous_scan: bool,
    }

    impl Runtime {
        fn new(emitter: Emitter) -> Self {
            Self {
                shared: Arc::new(Shared {
                    emitter,
                    profile: RwLock::new(b"{}".to_vec()),
                    inbound: Mutex::new(FrameAssembler::default()),
                    remotes: Mutex::new(HashMap::new()),
                    subscribers: Mutex::new(HashMap::new()),
                    subscriber_addresses: Mutex::new(HashMap::new()),
                    connecting: Mutex::new(HashSet::new()),
                    suppressed: Mutex::new(HashSet::new()),
                    signal_emitted_at: Mutex::new(HashMap::new()),
                    session_generation: AtomicU64::new(0),
                    next_packet_ids: Mutex::new(HashMap::new()),
                    connection_generations: Mutex::new(HashMap::new()),
                    inactive_responder_endpoints: Mutex::new(HashSet::new()),
                }),
                adapter: None,
                radio: None,
                radio_token: None,
                peripheral: None,
                watcher: None,
                scan_timer: None,
                continuous_scan: false,
            }
        }

        async fn initialize(&mut self) -> Result<()> {
            if self.adapter.is_some() {
                return Ok(());
            }
            let adapter = BluetoothAdapter::GetDefaultAsync()?.await?;
            if !adapter.IsLowEnergySupported()?
                || !adapter.IsCentralRoleSupported()?
                || !adapter.IsPeripheralRoleSupported()?
            {
                bail!("The Bluetooth adapter does not support concurrent BLE roles");
            }
            let radio = adapter.GetRadioAsync()?.await?;
            let emitter = self.shared.emitter.clone();
            let radio_token = radio.StateChanged(
                &TypedEventHandler::<Radio, IInspectable>::new(move |sender, _arguments| {
                    if let Some(sender) = sender.as_ref()
                        && let Ok(state) = sender.State()
                    {
                        emitter.event(
                            "onBluetoothState",
                            json!({ "state": bluetooth_state(state) }),
                        );
                    }
                    Ok(())
                }),
            )?;
            self.shared.emitter.event(
                "onBluetoothState",
                json!({ "state": bluetooth_state(radio.State()?) }),
            );
            self.adapter = Some(adapter);
            self.radio = Some(radio);
            self.radio_token = Some(radio_token);
            Ok(())
        }

        fn ensure_powered_on(&self) -> Result<()> {
            let radio = self.radio.as_ref().context("Bluetooth radio unavailable")?;
            if radio.State()? != RadioState::On {
                bail!("Bluetooth is powered off");
            }
            Ok(())
        }

        async fn request_permissions(&mut self) -> bool {
            let granted = self.initialize().await.is_ok();
            if granted
                && let Some(radio) = self.radio.as_ref()
                && let Ok(state) = radio.State()
            {
                self.shared.emitter.event(
                    "onBluetoothState",
                    json!({ "state": bluetooth_state(state) }),
                );
            }
            granted
        }

        async fn start_advertising(&mut self, profile: String) -> Result<()> {
            self.initialize().await?;
            self.ensure_powered_on()?;
            *self.shared.profile.write().await = BASE64.decode(profile)?;
            self.shared.suppressed.lock().await.clear();
            if let Some(peripheral) = self.peripheral.as_ref() {
                let status = peripheral.provider.AdvertisementStatus()?;
                if status == GattServiceProviderAdvertisementStatus::Started
                    || status
                        == GattServiceProviderAdvertisementStatus::StartedWithoutAllAdvertisementData
                {
                    return Ok(());
                }
            }
            if let Some(peripheral) = self.peripheral.take() {
                peripheral.close();
            }
            let provider_result = GattServiceProvider::CreateAsync(SERVICE_UUID)?.await?;
            if provider_result.Error()? != windows::Devices::Bluetooth::BluetoothError::Success {
                bail!("Unable to create the Windows GATT service provider");
            }
            let provider = provider_result.ServiceProvider()?;
            let service = provider.Service()?;

            let profile_parameters = GattLocalCharacteristicParameters::new()?;
            profile_parameters.SetCharacteristicProperties(
                GattCharacteristicProperties::Read | GattCharacteristicProperties::Notify,
            )?;
            profile_parameters.SetReadProtectionLevel(GattProtectionLevel::Plain)?;
            let profile_result = service
                .CreateCharacteristicAsync(PROFILE_UUID, &profile_parameters)?
                .await?;
            if profile_result.Error()? != windows::Devices::Bluetooth::BluetoothError::Success {
                bail!("Unable to create the nearby profile characteristic");
            }
            let profile_characteristic = profile_result.Characteristic()?;

            let mailbox_parameters = GattLocalCharacteristicParameters::new()?;
            mailbox_parameters.SetCharacteristicProperties(
                GattCharacteristicProperties::Write | GattCharacteristicProperties::Indicate,
            )?;
            mailbox_parameters.SetWriteProtectionLevel(GattProtectionLevel::Plain)?;
            let mailbox_result = service
                .CreateCharacteristicAsync(MAILBOX_UUID, &mailbox_parameters)?
                .await?;
            if mailbox_result.Error()? != windows::Devices::Bluetooth::BluetoothError::Success {
                bail!("Unable to create the nearby mailbox characteristic");
            }
            let mailbox_characteristic = mailbox_result.Characteristic()?;

            let handle = tokio::runtime::Handle::current();
            let shared = self.shared.clone();
            let read_token = profile_characteristic.ReadRequested(&TypedEventHandler::<
                GattLocalCharacteristic,
                GattReadRequestedEventArgs,
            >::new(
                move |_sender, arguments| {
                    let Some(arguments) = arguments.cloned() else {
                        return Ok(());
                    };
                    let shared = shared.clone();
                    handle.spawn(async move {
                        let Ok(deferral) = arguments.GetDeferral() else {
                            return;
                        };
                        let result: Result<()> = async {
                            let request = arguments.GetRequestAsync()?.await?;
                            let offset = request.Offset()? as usize;
                            let profile = shared.profile.read().await;
                            if offset > profile.len() {
                                request.RespondWithProtocolError(0x07)?;
                            } else {
                                request
                                    .RespondWithValue(&buffer_from_bytes(&profile[offset..])?)?;
                            }
                            Ok(())
                        }
                        .await;
                        if let Err(error) = result {
                            eprintln!("[psstpsst-proximity] profile read failed: {error:#}");
                        }
                        let _ = deferral.Complete();
                    });
                    Ok(())
                },
            ))?;

            let handle = tokio::runtime::Handle::current();
            let shared = self.shared.clone();
            let write_token = mailbox_characteristic.WriteRequested(&TypedEventHandler::<
                GattLocalCharacteristic,
                GattWriteRequestedEventArgs,
            >::new(
                move |_sender, arguments| {
                    let Some(arguments) = arguments.cloned() else {
                        return Ok(());
                    };
                    let shared = shared.clone();
                    handle.spawn(async move {
                        let Ok(deferral) = arguments.GetDeferral() else {
                            return;
                        };
                        let result: Result<()> = async {
                            let endpoint_id =
                                format!("p:{}", endpoint_from_session(&arguments.Session()?)?);
                            let request = arguments.GetRequestAsync()?.await?;
                            let bytes = bytes_from_buffer(&request.Value()?)?;
                            if bytes.len() > 1_024 {
                                request.RespondWithProtocolError(0x0d)?;
                            } else {
                                shared.accept_frame(&endpoint_id, &bytes).await;
                                request.Respond()?;
                            }
                            Ok(())
                        }
                        .await;
                        if let Err(error) = result {
                            eprintln!("[psstpsst-proximity] mailbox write failed: {error:#}");
                        }
                        let _ = deferral.Complete();
                    });
                    Ok(())
                },
            ))?;

            let handle = tokio::runtime::Handle::current();
            let shared = self.shared.clone();
            let mailbox_for_subscribers = mailbox_characteristic.clone();
            let subscribers_token =
                mailbox_characteristic.SubscribedClientsChanged(&TypedEventHandler::<
                    GattLocalCharacteristic,
                    IInspectable,
                >::new(
                    move |_sender, _arguments| {
                        let shared = shared.clone();
                        let mailbox = mailbox_for_subscribers.clone();
                        handle.spawn(async move {
                            if let Err(error) = refresh_subscribers(&shared, &mailbox).await {
                                eprintln!(
                                    "[psstpsst-proximity] subscriber refresh failed: {error:#}"
                                );
                            }
                        });
                        Ok(())
                    },
                ))?;

            let advertising = GattServiceProviderAdvertisingParameters::new()?;
            advertising.SetIsConnectable(true)?;
            advertising.SetIsDiscoverable(true)?;
            let (start_sender, start_receiver) = oneshot::channel::<Result<(), String>>();
            let start_sender = Arc::new(StdMutex::new(Some(start_sender)));
            let callback_sender = start_sender.clone();
            let advertisement_token = provider.AdvertisementStatusChanged(&TypedEventHandler::<
                GattServiceProvider,
                GattServiceProviderAdvertisementStatusChangedEventArgs,
            >::new(move |_sender, arguments| {
                let Some(arguments) = arguments.cloned() else {
                    return Ok(());
                };
                let Ok(status) = arguments.Status() else {
                    return Ok(());
                };
                let result = if status == GattServiceProviderAdvertisementStatus::Started
                    || status
                        == GattServiceProviderAdvertisementStatus::StartedWithoutAllAdvertisementData
                {
                    Some(Ok(()))
                } else if status == GattServiceProviderAdvertisementStatus::Aborted
                    || status == GattServiceProviderAdvertisementStatus::Stopped
                {
                    let error = arguments.Error().ok();
                    eprintln!(
                        "[psstpsst-proximity] GATT advertising stopped: status={status:?} error={error:?}"
                    );
                    Some(Err(format!(
                        "Windows GATT advertising failed: status={status:?} error={error:?}"
                    )))
                } else {
                    None
                };
                if let Some(result) = result
                    && let Ok(mut sender) = callback_sender.lock()
                    && let Some(sender) = sender.take()
                {
                    let _ = sender.send(result);
                }
                Ok(())
            }))?;
            provider.StartAdvertisingWithParameters(&advertising)?;
            let status = provider.AdvertisementStatus()?;
            let started = if status == GattServiceProviderAdvertisementStatus::Started
                || status
                    == GattServiceProviderAdvertisementStatus::StartedWithoutAllAdvertisementData
            {
                Ok(())
            } else {
                match tokio::time::timeout(Duration::from_secs(5), start_receiver).await {
                    Ok(Ok(result)) => result.map_err(anyhow::Error::msg),
                    Ok(Err(_)) => Err(anyhow!("Windows GATT advertising status channel closed")),
                    Err(_) => Err(anyhow!("Windows GATT advertising did not start in time")),
                }
            };
            if let Err(error) = started {
                let _ = provider.StopAdvertising();
                let _ = provider.RemoveAdvertisementStatusChanged(advertisement_token);
                let _ = profile_characteristic.RemoveReadRequested(read_token);
                let _ = mailbox_characteristic.RemoveWriteRequested(write_token);
                let _ = mailbox_characteristic.RemoveSubscribedClientsChanged(subscribers_token);
                return Err(error);
            }
            self.peripheral = Some(PeripheralResources {
                provider,
                profile: profile_characteristic,
                mailbox: mailbox_characteristic,
                read_token,
                write_token,
                subscribers_token,
                advertisement_token,
            });
            Ok(())
        }

        async fn update_profile(&self, profile: String) {
            if let Ok(decoded) = BASE64.decode(profile) {
                *self.shared.profile.write().await = decoded.clone();
                if let Some(peripheral) = self.peripheral.as_ref()
                    && let Ok(buffer) = buffer_from_bytes(&decoded)
                    && let Ok(operation) = peripheral.profile.NotifyValueAsync(&buffer)
                    && let Err(error) = operation.await
                {
                    eprintln!("[psstpsst-proximity] profile notification failed: {error:#}");
                }
            }
        }

        async fn start_scan(&mut self, duration_ms: u64) -> Result<()> {
            self.initialize().await?;
            self.ensure_powered_on()?;
            if duration_ms == 0
                && self.continuous_scan
                && self.watcher.as_ref().is_some_and(|resources| {
                    resources.watcher.Status().ok()
                        == Some(BluetoothLEAdvertisementWatcherStatus::Started)
                })
            {
                return Ok(());
            }
            self.stop_scan();
            let watcher = BluetoothLEAdvertisementWatcher::new()?;
            watcher.SetScanningMode(BluetoothLEScanningMode::Active)?;
            watcher
                .AdvertisementFilter()?
                .Advertisement()?
                .ServiceUuids()?
                .Append(SERVICE_UUID)?;
            let shared = self.shared.clone();
            let handle = tokio::runtime::Handle::current();
            let generation = shared.session_generation.load(Ordering::Acquire);
            let received_token =
                watcher.Received(&TypedEventHandler::<
                    BluetoothLEAdvertisementWatcher,
                    BluetoothLEAdvertisementReceivedEventArgs,
                >::new(move |_sender, arguments| {
                    let Some(arguments) = arguments.cloned() else {
                        return Ok(());
                    };
                    let Ok(address) = arguments.BluetoothAddress() else {
                        return Ok(());
                    };
                    let rssi = arguments.RawSignalStrengthInDBm().unwrap_or(127);
                    let shared = shared.clone();
                    handle.spawn(async move {
                        shared.record_signal(address, rssi).await;
                        if shared.suppressed.lock().await.contains(&address)
                            || shared.remotes.lock().await.contains_key(&address)
                        {
                            return;
                        }
                        let mut connecting = shared.connecting.lock().await;
                        if !connecting.insert(address) {
                            return;
                        }
                        drop(connecting);
                        activate_remote(shared, address, generation).await;
                    });
                    Ok(())
                }))?;
            let stopped_token =
                watcher.Stopped(&TypedEventHandler::<
                    BluetoothLEAdvertisementWatcher,
                    BluetoothLEAdvertisementWatcherStoppedEventArgs,
                >::new(move |_sender, arguments| {
                    if let Some(arguments) = arguments.cloned()
                        && let Ok(error) = arguments.Error()
                        && error != windows::Devices::Bluetooth::BluetoothError::Success
                    {
                        eprintln!("[psstpsst-proximity] BLE scan stopped with error: {error:?}");
                    }
                    Ok(())
                }))?;
            watcher.Start()?;
            self.continuous_scan = duration_ms == 0;
            self.watcher = Some(WatcherResources {
                watcher: watcher.clone(),
                received_token,
                stopped_token,
            });
            if duration_ms > 0 {
                let shared = self.shared.clone();
                self.scan_timer = Some(tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(duration_ms.max(1_000))).await;
                    if shared.session_generation.load(Ordering::Acquire) == generation {
                        let _ = watcher.Stop();
                        let _ = watcher.RemoveReceived(received_token);
                        let _ = watcher.RemoveStopped(stopped_token);
                    }
                }));
            }
            Ok(())
        }

        fn stop_scan(&mut self) {
            self.continuous_scan = false;
            if let Some(timer) = self.scan_timer.take() {
                timer.abort();
            }
            if let Some(watcher) = self.watcher.take() {
                watcher.stop();
            }
        }

        async fn prefer_peripheral(&self, endpoint_id: &str) -> Result<()> {
            let address = parse_central_endpoint(endpoint_id)?;
            self.shared.suppressed.lock().await.insert(address);
            if let Some(remote) = self.shared.remotes.lock().await.remove(&address) {
                close_remote(&remote);
            }
            Ok(())
        }

        async fn disconnect(&self, endpoint_id: &str) -> Result<()> {
            self.shared.next_packet_ids.lock().await.remove(endpoint_id);
            if endpoint_id.starts_with("c:") {
                let address = parse_central_endpoint(endpoint_id)?;
                if let Some(remote) = self.shared.remotes.lock().await.remove(&address) {
                    close_remote(&remote);
                }
            } else {
                let raw_endpoint = endpoint_id
                    .strip_prefix("p:")
                    .context("Invalid nearby endpoint")?;
                if let Some(address) = self
                    .shared
                    .subscriber_addresses
                    .lock()
                    .await
                    .get(raw_endpoint)
                    .copied()
                {
                    self.shared.suppressed.lock().await.remove(&address);
                }
                self.shared
                    .inactive_responder_endpoints
                    .lock()
                    .await
                    .insert(endpoint_id.to_owned());
            }
            Ok(())
        }

        async fn refresh_peer_profile(&mut self, endpoint_id: &str) -> Result<()> {
            if endpoint_id.starts_with("p:") {
                let raw_endpoint = endpoint_id
                    .strip_prefix("p:")
                    .context("Invalid nearby endpoint")?;
                if let Some(address) = self
                    .shared
                    .subscriber_addresses
                    .lock()
                    .await
                    .get(raw_endpoint)
                    .copied()
                {
                    self.shared.suppressed.lock().await.remove(&address);
                }
                if !self.continuous_scan {
                    self.start_scan(10_000).await?;
                }
                return Ok(());
            }
            let address = parse_central_endpoint(endpoint_id)?;
            self.shared.suppressed.lock().await.remove(&address);
            let Some(remote) = self.shared.remotes.lock().await.get(&address).cloned() else {
                return Ok(());
            };
            let profile = read_profile(&remote.profile).await?;
            let generation = self.shared.connection_generation(endpoint_id).await;
            self.shared.emitter.event(
                "onPeer",
                json!({ "endpointId": endpoint_id, "generation": generation, "profile": profile, "rssi": 0 }),
            );
            Ok(())
        }

        async fn send(&self, endpoint_id: &str, payload: &str) -> Result<()> {
            let payload = BASE64.decode(payload)?;
            if payload.len() > MAXIMUM_WIRE_BYTES {
                bail!("The nearby message is too large");
            }
            let packet_id = {
                let mut ids = self.shared.next_packet_ids.lock().await;
                let packet_id = *ids.get(endpoint_id).unwrap_or(&0);
                let next = packet_id
                    .checked_add(1)
                    .context("The nearby packet sequence is exhausted")?;
                ids.insert(endpoint_id.to_owned(), next);
                packet_id
            };
            if endpoint_id.starts_with("c:") {
                let address = parse_central_endpoint(endpoint_id)?;
                let remote = self
                    .shared
                    .remotes
                    .lock()
                    .await
                    .get(&address)
                    .cloned()
                    .context("The nearby peer is not connected")?;
                for frame in frames(&payload, packet_id, remote.maximum_frame_size)? {
                    let result = remote
                        .mailbox
                        .WriteValueWithResultAndOptionAsync(
                            &buffer_from_bytes(&frame)?,
                            GattWriteOption::WriteWithResponse,
                        )?
                        .await?;
                    if result.Status()? != GattCommunicationStatus::Success {
                        bail!("The nearby GATT write failed");
                    }
                }
                return Ok(());
            }
            let raw_endpoint = endpoint_id
                .strip_prefix("p:")
                .context("Invalid nearby endpoint")?;
            let client = self
                .shared
                .subscribers
                .lock()
                .await
                .get(raw_endpoint)
                .cloned()
                .context("The nearby peer is not connected")?;
            let mailbox = self
                .peripheral
                .as_ref()
                .map(|resources| resources.mailbox.clone())
                .context("Nearby advertising is not active")?;
            let maximum_frame_size = usize::from(client.MaxNotificationSize()?.max(20));
            for frame in frames(&payload, packet_id, maximum_frame_size)? {
                let result = mailbox
                    .NotifyValueForSubscribedClientAsync(&buffer_from_bytes(&frame)?, &client)?
                    .await?;
                if result.Status()? != GattCommunicationStatus::Success {
                    bail!("The nearby GATT indication failed");
                }
            }
            Ok(())
        }

        async fn stop_session(&mut self) {
            self.stop_scan();
            self.shared
                .session_generation
                .fetch_add(1, Ordering::AcqRel);
            if let Some(peripheral) = self.peripheral.take() {
                peripheral.close();
            }
            self.shared.subscribers.lock().await.clear();
            self.shared.subscriber_addresses.lock().await.clear();
            let remotes = std::mem::take(&mut *self.shared.remotes.lock().await);
            for remote in remotes.into_values() {
                close_remote(&remote);
            }
            self.shared.connecting.lock().await.clear();
            self.shared.suppressed.lock().await.clear();
            self.shared.signal_emitted_at.lock().await.clear();
            self.shared.inbound.lock().await.clear();
            self.shared.next_packet_ids.lock().await.clear();
            self.shared
                .inactive_responder_endpoints
                .lock()
                .await
                .clear();
        }

        fn close(&mut self) {
            if let (Some(radio), Some(token)) = (self.radio.as_ref(), self.radio_token.take()) {
                let _ = radio.RemoveStateChanged(token);
            }
            self.radio = None;
            self.adapter = None;
        }
    }

    async fn refresh_subscribers(
        shared: &Arc<Shared>,
        mailbox: &GattLocalCharacteristic,
    ) -> Result<()> {
        let clients = {
            let clients = mailbox.SubscribedClients()?;
            let mut entries = Vec::with_capacity(clients.Size()? as usize);
            for index in 0..clients.Size()? {
                let client = clients.GetAt(index)?;
                let session = client.Session()?;
                let device_id = session.DeviceId()?.Id()?;
                entries.push((device_id.to_string(), device_id, client));
            }
            entries
        };
        let mut current = HashMap::new();
        let mut addresses = HashMap::new();
        for (endpoint, device_id, client) in clients {
            if let Ok(operation) = BluetoothLEDevice::FromIdAsync(&device_id)
                && let Ok(device) = operation.await
                && let Ok(address) = device.BluetoothAddress()
            {
                addresses.insert(endpoint.clone(), address);
            }
            current.insert(endpoint, client);
        }
        let mut subscribers = shared.subscribers.lock().await;
        for endpoint in current.keys() {
            if !subscribers.contains_key(endpoint) {
                let endpoint_id = format!("p:{endpoint}");
                let generation = shared.next_connection_generation(&endpoint_id).await;
                shared.emitter.event(
                    "onConnection",
                    json!({ "endpointId": endpoint_id, "state": "connected", "generation": generation }),
                );
            }
        }
        for endpoint in subscribers.keys() {
            if !current.contains_key(endpoint) {
                let endpoint_id = format!("p:{endpoint}");
                shared
                    .inactive_responder_endpoints
                    .lock()
                    .await
                    .remove(&endpoint_id);
                let generation = shared.connection_generation(&endpoint_id).await;
                shared.emitter.event(
                    "onConnection",
                    json!({ "endpointId": endpoint_id, "state": "disconnected", "generation": generation }),
                );
            }
        }
        *subscribers = current;
        *shared.subscriber_addresses.lock().await = addresses;
        Ok(())
    }

    async fn activate_remote(shared: Arc<Shared>, address: u64, generation: u64) {
        let result = activate_remote_inner(&shared, address, generation).await;
        shared.connecting.lock().await.remove(&address);
        if let Err(error) = result {
            eprintln!("[psstpsst-proximity] unable to activate {address}: {error:#}");
            let endpoint_id = format!("c:{address}");
            let connection_generation = shared.connection_generation(&endpoint_id).await;
            shared.emitter.event(
                "onConnection",
                json!({ "endpointId": endpoint_id, "state": "disconnected", "generation": connection_generation }),
            );
        }
    }

    async fn activate_remote_inner(
        shared: &Arc<Shared>,
        address: u64,
        generation: u64,
    ) -> Result<()> {
        if shared.session_generation.load(Ordering::Acquire) != generation {
            return Ok(());
        }
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)?.await?;
        let endpoint_id = format!("c:{address}");
        let connection_generation = shared.next_connection_generation(&endpoint_id).await;
        shared.emitter.event(
            "onConnection",
            json!({ "endpointId": endpoint_id, "state": "connected", "generation": connection_generation }),
        );
        let service = {
            let services_result = device.GetGattServicesForUuidAsync(SERVICE_UUID)?.await?;
            if services_result.Status()? != GattCommunicationStatus::Success {
                bail!("Unable to enumerate nearby GATT services");
            }
            let services = services_result.Services()?;
            if services.Size()? == 0 {
                bail!("Nearby GATT service is missing");
            }
            services.GetAt(0)?
        };
        let profile = first_characteristic(&service, PROFILE_UUID).await?;
        let mailbox = first_characteristic(&service, MAILBOX_UUID).await?;
        let profile_value = read_profile(&profile).await?;
        let maximum_frame_size = usize::from(service.Session()?.MaxPduSize()?)
            .saturating_sub(3)
            .max(20);

        let profile_shared = shared.clone();
        let profile_handle = tokio::runtime::Handle::current();
        let profile_value_token =
            profile.ValueChanged(&TypedEventHandler::<
                GattCharacteristic,
                GattValueChangedEventArgs,
            >::new(move |_sender, arguments| {
                let Some(arguments) = arguments.cloned() else {
                    return Ok(());
                };
                let bytes =
                    bytes_from_buffer(&arguments.CharacteristicValue()?).unwrap_or_default();
                let shared = profile_shared.clone();
                profile_handle.spawn(async move {
                    if !shared.remotes.lock().await.contains_key(&address) {
                        return;
                    }
                    let generation = shared.connection_generation(&format!("c:{address}")).await;
                    shared.emitter.event(
                        "onPeer",
                        json!({
                            "endpointId": format!("c:{address}"),
                            "generation": generation,
                            "profile": BASE64.encode(bytes),
                            "rssi": 0,
                        }),
                    );
                });
                Ok(())
            }))?;
        let profile_value_token = match profile
            .WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Notify,
            )?
            .await
        {
            Ok(status) if status == GattCommunicationStatus::Success => Some(profile_value_token),
            _ => {
                let _ = profile.RemoveValueChanged(profile_value_token);
                None
            }
        };

        let value_shared = shared.clone();
        let value_handle = tokio::runtime::Handle::current();
        let mailbox_value_token =
            mailbox.ValueChanged(&TypedEventHandler::<
                GattCharacteristic,
                GattValueChangedEventArgs,
            >::new(move |_sender, arguments| {
                let Some(arguments) = arguments.cloned() else {
                    return Ok(());
                };
                let bytes =
                    bytes_from_buffer(&arguments.CharacteristicValue()?).unwrap_or_default();
                let shared = value_shared.clone();
                value_handle.spawn(async move {
                    shared.accept_frame(&format!("c:{address}"), &bytes).await;
                });
                Ok(())
            }))?;
        let configuration_status = mailbox
            .WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Indicate,
            )?
            .await?;
        if configuration_status != GattCommunicationStatus::Success {
            let _ = mailbox.RemoveValueChanged(mailbox_value_token);
            if let Some(token) = profile_value_token {
                let _ = profile.RemoveValueChanged(token);
            }
            bail!("Unable to subscribe to nearby indications");
        }

        let connection_shared = shared.clone();
        let connection_device = device.clone();
        let connection_handle = tokio::runtime::Handle::current();
        let connection_token = device.ConnectionStatusChanged(&TypedEventHandler::<
            BluetoothLEDevice,
            IInspectable,
        >::new(
            move |_sender, _arguments| {
                if connection_device.ConnectionStatus().ok()
                    != Some(BluetoothConnectionStatus::Disconnected)
                {
                    return Ok(());
                }
                let shared = connection_shared.clone();
                connection_handle.spawn(async move {
                    if let Some(remote) = shared.remotes.lock().await.remove(&address) {
                        close_remote(&remote);
                        shared.emitter.event(
                            "onConnection",
                            json!({
                                "endpointId": format!("c:{address}"),
                                "state": "disconnected",
                                "generation": connection_generation,
                            }),
                        );
                    }
                });
                Ok(())
            },
        ))?;
        if shared.session_generation.load(Ordering::Acquire) != generation
            || shared.suppressed.lock().await.contains(&address)
        {
            let _ = device.RemoveConnectionStatusChanged(connection_token);
            let _ = mailbox.RemoveValueChanged(mailbox_value_token);
            if let Some(token) = profile_value_token {
                let _ = profile.RemoveValueChanged(token);
            }
            let _ = device.Close();
            return Ok(());
        }
        shared.remotes.lock().await.insert(
            address,
            RemoteEndpoint {
                device,
                service,
                profile,
                mailbox,
                maximum_frame_size,
                connection_token,
                profile_value_token,
                mailbox_value_token,
            },
        );
        shared.emitter.event(
            "onPeer",
            json!({
                "endpointId": format!("c:{address}"),
                "generation": connection_generation,
                "profile": profile_value,
                "rssi": 0,
            }),
        );
        Ok(())
    }

    async fn first_characteristic(
        service: &GattDeviceService,
        uuid: GUID,
    ) -> Result<GattCharacteristic> {
        let result = service.GetCharacteristicsForUuidAsync(uuid)?.await?;
        if result.Status()? != GattCommunicationStatus::Success {
            bail!("Unable to enumerate nearby GATT characteristics");
        }
        let characteristics = result.Characteristics()?;
        if characteristics.Size()? == 0 {
            bail!("Nearby GATT characteristic is missing");
        }
        Ok(characteristics.GetAt(0)?)
    }

    async fn read_profile(profile: &GattCharacteristic) -> Result<String> {
        let result = profile
            .ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached)?
            .await?;
        if result.Status()? != GattCommunicationStatus::Success {
            bail!("Unable to read the nearby profile");
        }
        Ok(BASE64.encode(bytes_from_buffer(&result.Value()?)?))
    }

    fn close_remote(remote: &RemoteEndpoint) {
        let _ = remote
            .device
            .RemoveConnectionStatusChanged(remote.connection_token);
        if let Some(token) = remote.profile_value_token {
            let _ = remote.profile.RemoveValueChanged(token);
        }
        let _ = remote
            .mailbox
            .RemoveValueChanged(remote.mailbox_value_token);
        let _ = remote.service.Close();
        let _ = remote.device.Close();
    }

    fn parse_central_endpoint(endpoint_id: &str) -> Result<u64> {
        endpoint_id
            .strip_prefix("c:")
            .context("Invalid nearby central endpoint")?
            .parse()
            .context("Invalid nearby central address")
    }

    fn argument_string(args: &Value, name: &str, maximum_bytes: usize) -> Result<String> {
        let value = args
            .get(name)
            .and_then(Value::as_str)
            .context("Invalid native proximity arguments")?;
        if value.len() > maximum_bytes {
            bail!("Invalid native proximity arguments");
        }
        Ok(value.to_owned())
    }

    pub async fn run() -> Result<()> {
        let emitter = Emitter {
            stdout: Arc::new(StdMutex::new(io::stdout())),
        };
        let mut runtime = Runtime::new(emitter.clone());
        let stdin = BufReader::new(tokio::io::stdin());
        let mut lines = stdin.lines();
        while let Some(line) = lines.next_line().await? {
            if line.len() > 256 * 1024 {
                continue;
            }
            let Ok(request) = serde_json::from_str::<Request>(&line) else {
                continue;
            };
            if request.id.len() > 64 || request.command.len() > 64 {
                continue;
            }
            let command = request.command.clone();
            let result: Result<Option<Value>> = match tokio::time::timeout(COMMAND_TIMEOUT, async {
                match request.command.as_str() {
                    "handshake" => {
                        runtime.initialize().await?;
                        Ok(Some(json!({
                            "protocolVersion": PROTOCOL_VERSION,
                            "implementationVersion": "windows-1",
                            "platform": "win32",
                            "capabilities": {
                                "central": true,
                                "peripheral": true,
                                "concurrentRoles": true,
                            },
                        })))
                    }
                    "requestPermissions" => Ok(Some(json!(runtime.request_permissions().await))),
                    "startAdvertising" => {
                        runtime
                            .start_advertising(argument_string(
                                &request.args,
                                "profile",
                                16 * 1024,
                            )?)
                            .await?;
                        Ok(None)
                    }
                    "updateProfile" => {
                        runtime
                            .update_profile(argument_string(&request.args, "profile", 16 * 1024)?)
                            .await;
                        Ok(None)
                    }
                    "preferPeripheral" => {
                        runtime
                            .prefer_peripheral(&argument_string(&request.args, "endpointId", 256)?)
                            .await?;
                        Ok(None)
                    }
                    "disconnect" => {
                        runtime
                            .disconnect(&argument_string(&request.args, "endpointId", 256)?)
                            .await?;
                        Ok(None)
                    }
                    "startScan" => {
                        let duration = request
                            .args
                            .get("scanDurationMs")
                            .and_then(Value::as_u64)
                            .filter(|duration| *duration <= 300_000)
                            .context("Invalid scan duration")?;
                        runtime.start_scan(duration).await?;
                        Ok(None)
                    }
                    "stopScan" => {
                        runtime.stop_scan();
                        Ok(None)
                    }
                    "stopSession" => {
                        runtime.stop_session().await;
                        Ok(None)
                    }
                    "refreshPeerProfile" => {
                        runtime
                            .refresh_peer_profile(&argument_string(
                                &request.args,
                                "endpointId",
                                256,
                            )?)
                            .await?;
                        Ok(None)
                    }
                    "send" => {
                        runtime
                            .send(
                                &argument_string(&request.args, "endpointId", 256)?,
                                &argument_string(&request.args, "payload", MAXIMUM_WIRE_BYTES * 2)?,
                            )
                            .await?;
                        Ok(None)
                    }
                    _ => Err(anyhow!("Unknown native proximity command")),
                }
            })
            .await
            {
                Ok(result) => result,
                Err(_) => Err(anyhow!("Native proximity command timed out: {command}")),
            };
            match result {
                Ok(value) => emitter.response(&request.id, value),
                Err(error) => emitter.failure(&request.id, &error),
            }
        }
        runtime.stop_session().await;
        runtime.close();
        Ok(())
    }
}

#[cfg(target_os = "windows")]
#[tokio::main(flavor = "current_thread")]
async fn main() {
    use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize};

    if let Err(error) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        eprintln!("[psstpsst-proximity] WinRT initialization failed: {error}");
        std::process::exit(1);
    }
    if let Err(error) = windows_runtime::run().await {
        eprintln!("[psstpsst-proximity] fatal error: {error:#}");
        std::process::exit(1);
    }
}
