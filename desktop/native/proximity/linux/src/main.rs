#[cfg(not(target_os = "linux"))]
fn main() {
    eprintln!("psstpsst-proximity-linux can only run on Linux");
}

#[cfg(target_os = "linux")]
mod linux {
    use anyhow::{Context, Result, anyhow, bail};
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
    use bluer::{
        Adapter, AdapterEvent, AdapterProperty, Address, Device, DiscoveryFilter,
        DiscoveryTransport, Session,
        adv::{Advertisement, AdvertisementHandle},
        gatt::{
            local::{
                Application, ApplicationHandle, Characteristic, CharacteristicControlEvent,
                CharacteristicNotify, CharacteristicNotifyMethod, CharacteristicRead,
                CharacteristicWrite, CharacteristicWriteMethod, ReqError, Service,
                characteristic_control,
            },
            remote::Characteristic as RemoteCharacteristic,
        },
    };
    use futures::{FutureExt, StreamExt};
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
        sync::{Mutex, RwLock, mpsc, oneshot},
        task::JoinHandle,
    };
    use uuid::Uuid;

    const PROTOCOL_VERSION: u64 = 1;
    const MAXIMUM_WIRE_BYTES: usize = 128 * 1024;
    const MAXIMUM_CHUNK_COUNT: usize = 16_384;
    const MAXIMUM_INBOUND_MESSAGES: usize = 32;
    const MAXIMUM_INBOUND_MESSAGES_PER_ENDPOINT: usize = 4;
    const MAXIMUM_INBOUND_BYTES: usize = 1024 * 1024;
    const MAXIMUM_INBOUND_BYTES_PER_ENDPOINT: usize = 256 * 1024;
    const INBOUND_LIFETIME: Duration = Duration::from_secs(60);
    const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
    const SERVICE_UUID: Uuid = Uuid::from_u128(0x45D8B02F_6D80_4FC6_914E_B85FCD0440D3);
    const PROFILE_UUID: Uuid = Uuid::from_u128(0x55980CEE_27E5_48A9_BF1C_AB5DA34B4402);
    const MAILBOX_UUID: Uuid = Uuid::from_u128(0x86A4C105_9A0E_4144_BCA1_40E7C78A1D93);

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

    #[derive(Clone)]
    struct RemoteEndpoint {
        device: Device,
        profile: RemoteCharacteristic,
        mailbox: RemoteCharacteristic,
        mtu: usize,
    }

    struct NotifySend {
        frames: Vec<Vec<u8>>,
        reply: oneshot::Sender<Result<()>>,
    }

    #[derive(Clone)]
    struct LocalSubscriber {
        sender: mpsc::Sender<NotifySend>,
        maximum_frame_size: usize,
    }

    struct Shared {
        emitter: Emitter,
        profile: RwLock<Vec<u8>>,
        inbound: Mutex<FrameAssembler>,
        remotes: Mutex<HashMap<Address, RemoteEndpoint>>,
        subscribers: Mutex<HashMap<Address, LocalSubscriber>>,
        profile_subscribers: Mutex<HashMap<Address, mpsc::Sender<Vec<u8>>>>,
        connecting: Mutex<HashSet<Address>>,
        suppressed: Mutex<HashSet<Address>>,
        signal_emitted_at: Mutex<HashMap<Address, Instant>>,
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

        async fn record_signal(&self, address: Address, rssi: i16) {
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
        session: Option<Session>,
        adapter: Option<Adapter>,
        adapter_task: Option<JoinHandle<()>>,
        scan_task: Option<JoinHandle<()>>,
        advertisement: Option<AdvertisementHandle>,
        application: Option<ApplicationHandle>,
        notify_control_task: Option<JoinHandle<()>>,
        profile_notify_control_task: Option<JoinHandle<()>>,
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
                    profile_subscribers: Mutex::new(HashMap::new()),
                    connecting: Mutex::new(HashSet::new()),
                    suppressed: Mutex::new(HashSet::new()),
                    signal_emitted_at: Mutex::new(HashMap::new()),
                    session_generation: AtomicU64::new(0),
                    next_packet_ids: Mutex::new(HashMap::new()),
                    connection_generations: Mutex::new(HashMap::new()),
                    inactive_responder_endpoints: Mutex::new(HashSet::new()),
                }),
                session: None,
                adapter: None,
                adapter_task: None,
                scan_task: None,
                advertisement: None,
                application: None,
                notify_control_task: None,
                profile_notify_control_task: None,
                continuous_scan: false,
            }
        }

        async fn initialize(&mut self) -> Result<()> {
            if self.adapter.is_some() {
                return Ok(());
            }
            let session = Session::new().await.context("Unable to connect to BlueZ")?;
            let adapter = session
                .default_adapter()
                .await
                .context("No Bluetooth adapter is available")?;
            adapter
                .supported_advertising_instances()
                .await
                .context("The Bluetooth adapter cannot advertise BLE services")?;
            let powered = adapter.is_powered().await.unwrap_or(false);
            self.shared.emitter.event(
                "onBluetoothState",
                json!({ "state": if powered { "poweredOn" } else { "poweredOff" } }),
            );
            let mut events = adapter
                .events()
                .await
                .context("Unable to monitor the Bluetooth adapter")?;
            let emitter = self.shared.emitter.clone();
            self.adapter_task = Some(tokio::spawn(async move {
                while let Some(event) = events.next().await {
                    if let AdapterEvent::PropertyChanged(AdapterProperty::Powered(powered)) = event
                    {
                        emitter.event(
                            "onBluetoothState",
                            json!({ "state": if powered { "poweredOn" } else { "poweredOff" } }),
                        );
                        if !powered {
                            eprintln!(
                                "[psstpsst-proximity] Bluetooth powered off; restarting the helper is required"
                            );
                            std::process::exit(2);
                        }
                    }
                }
                eprintln!(
                    "[psstpsst-proximity] Bluetooth adapter event stream ended; restarting the helper is required"
                );
                std::process::exit(2);
            }));
            self.session = Some(session);
            self.adapter = Some(adapter);
            Ok(())
        }

        async fn request_permissions(&mut self) -> bool {
            if self.initialize().await.is_err() {
                return false;
            }
            let powered = match self.adapter.as_ref() {
                Some(adapter) => adapter.is_powered().await.unwrap_or(false),
                None => false,
            };
            self.shared.emitter.event(
                "onBluetoothState",
                json!({ "state": if powered { "poweredOn" } else { "poweredOff" } }),
            );
            true
        }

        async fn start_advertising(&mut self, profile: String) -> Result<()> {
            self.initialize().await?;
            *self.shared.profile.write().await = BASE64.decode(profile)?;
            self.shared.suppressed.lock().await.clear();
            if self.application.is_some() && self.advertisement.is_some() {
                return Ok(());
            }
            let adapter = self
                .adapter
                .as_ref()
                .context("Bluetooth adapter unavailable")?;
            if !adapter.is_powered().await? {
                bail!("Bluetooth is powered off");
            }
            let profile_shared = self.shared.clone();
            let inbound = self.shared.clone();
            let (mut profile_notify_control, profile_notify_handle) = characteristic_control();
            let (mut notify_control, notify_handle) = characteristic_control();
            let application = Application {
                services: vec![Service {
                    uuid: SERVICE_UUID,
                    primary: true,
                    characteristics: vec![
                        Characteristic {
                            uuid: PROFILE_UUID,
                            read: Some(CharacteristicRead {
                                read: true,
                                fun: Box::new(move |request| {
                                    let profile_shared = profile_shared.clone();
                                    async move {
                                        let value = profile_shared.profile.read().await;
                                        let offset = usize::from(request.offset);
                                        if offset > value.len() {
                                            return Err(ReqError::InvalidOffset);
                                        }
                                        Ok(value[offset..].to_vec())
                                    }
                                    .boxed()
                                }),
                                ..Default::default()
                            }),
                            notify: Some(CharacteristicNotify {
                                notify: true,
                                method: CharacteristicNotifyMethod::Io,
                                ..Default::default()
                            }),
                            control_handle: profile_notify_handle,
                            ..Default::default()
                        },
                        Characteristic {
                            uuid: MAILBOX_UUID,
                            write: Some(CharacteristicWrite {
                                write: true,
                                method: CharacteristicWriteMethod::Fun(Box::new(
                                    move |value, request| {
                                        let inbound = inbound.clone();
                                        async move {
                                            if value.len() > 1_024 {
                                                return Err(ReqError::InvalidValueLength);
                                            }
                                            inbound
                                                .accept_frame(
                                                    &format!("p:{}", request.device_address),
                                                    &value,
                                                )
                                                .await;
                                            Ok(())
                                        }
                                        .boxed()
                                    },
                                )),
                                ..Default::default()
                            }),
                            notify: Some(CharacteristicNotify {
                                indicate: true,
                                method: CharacteristicNotifyMethod::Io,
                                ..Default::default()
                            }),
                            control_handle: notify_handle,
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                }],
                ..Default::default()
            };
            let application_handle = adapter
                .serve_gatt_application(application)
                .await
                .context("Unable to register the local GATT service")?;
            let advertisement_handle = match adapter
                .advertise(Advertisement {
                    service_uuids: [SERVICE_UUID].into_iter().collect(),
                    discoverable: Some(true),
                    ..Default::default()
                })
                .await
            {
                Ok(handle) => handle,
                Err(error) => {
                    drop(application_handle);
                    return Err(error).context("Unable to advertise the nearby service");
                }
            };
            let shared = self.shared.clone();
            self.profile_notify_control_task = Some(tokio::spawn(async move {
                while let Some(event) = profile_notify_control.next().await {
                    let CharacteristicControlEvent::Notify(writer) = event else {
                        continue;
                    };
                    let address = writer.device_address();
                    let (sender, mut receiver) = mpsc::channel::<Vec<u8>>(4);
                    shared
                        .profile_subscribers
                        .lock()
                        .await
                        .insert(address, sender.clone());
                    let shared = shared.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::select! {
                                value = receiver.recv() => {
                                    let Some(value) = value else { break };
                                    if writer.send(&value).await.is_err() { break; }
                                }
                                _ = writer.closed() => break,
                            }
                        }
                        let mut subscribers = shared.profile_subscribers.lock().await;
                        if subscribers
                            .get(&address)
                            .is_some_and(|current| current.same_channel(&sender))
                        {
                            subscribers.remove(&address);
                        }
                    });
                }
            }));
            let shared = self.shared.clone();
            self.notify_control_task = Some(tokio::spawn(async move {
                while let Some(event) = notify_control.next().await {
                    let CharacteristicControlEvent::Notify(writer) = event else {
                        continue;
                    };
                    let address = writer.device_address();
                    let endpoint_id = format!("p:{address}");
                    let connection_generation =
                        shared.next_connection_generation(&endpoint_id).await;
                    shared
                        .inactive_responder_endpoints
                        .lock()
                        .await
                        .remove(&endpoint_id);
                    let maximum_frame_size = writer.mtu().max(20);
                    let (sender, mut receiver) = mpsc::channel::<NotifySend>(8);
                    shared.subscribers.lock().await.insert(
                        address,
                        LocalSubscriber {
                            sender: sender.clone(),
                            maximum_frame_size,
                        },
                    );
                    shared.emitter.event(
                        "onConnection",
                        json!({ "endpointId": endpoint_id.clone(), "state": "connected", "generation": connection_generation }),
                    );
                    let shared = shared.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::select! {
                                message = receiver.recv() => {
                                    let Some(message) = message else { break };
                                    let result: Result<()> = async {
                                        for frame in message.frames {
                                            writer.send(&frame).await?;
                                        }
                                        Ok(())
                                    }.await;
                                    let _ = message.reply.send(result);
                                }
                                result = writer.closed() => {
                                    if let Err(error) = result {
                                        eprintln!("[psstpsst-proximity] notification session failed: {error}");
                                    }
                                    break;
                                }
                            }
                        }
                        let mut subscribers = shared.subscribers.lock().await;
                        if subscribers
                            .get(&address)
                            .is_some_and(|current| current.sender.same_channel(&sender))
                        {
                            subscribers.remove(&address);
                            shared
                                .inactive_responder_endpoints
                                .lock()
                                .await
                                .remove(&endpoint_id);
                            shared.emitter.event(
                                "onConnection",
                                json!({ "endpointId": endpoint_id, "state": "disconnected", "generation": connection_generation }),
                            );
                        }
                    });
                }
            }));
            self.application = Some(application_handle);
            self.advertisement = Some(advertisement_handle);
            Ok(())
        }

        async fn update_profile(&self, profile: String) {
            if let Ok(decoded) = BASE64.decode(profile) {
                *self.shared.profile.write().await = decoded.clone();
                let subscribers = self
                    .shared
                    .profile_subscribers
                    .lock()
                    .await
                    .values()
                    .cloned()
                    .collect::<Vec<_>>();
                for subscriber in subscribers {
                    let _ = subscriber.send(decoded.clone()).await;
                }
            }
        }

        async fn start_scan(&mut self, duration_ms: u64) -> Result<()> {
            self.initialize().await?;
            if duration_ms == 0
                && self.continuous_scan
                && self.scan_task.as_ref().is_some_and(|t| !t.is_finished())
            {
                return Ok(());
            }
            self.stop_scan();
            let adapter = self
                .adapter
                .as_ref()
                .context("Bluetooth adapter unavailable")?
                .clone();
            if !adapter.is_powered().await? {
                bail!("Bluetooth is powered off");
            }
            adapter
                .set_discovery_filter(DiscoveryFilter {
                    uuids: [SERVICE_UUID].into_iter().collect(),
                    transport: DiscoveryTransport::Le,
                    duplicate_data: duration_ms == 0,
                    ..Default::default()
                })
                .await?;
            let mut devices = adapter.discover_devices_with_changes().await?;
            let shared = self.shared.clone();
            let generation = shared.session_generation.load(Ordering::Acquire);
            self.continuous_scan = duration_ms == 0;
            self.scan_task = Some(tokio::spawn(async move {
                let deadline = async move {
                    if duration_ms == 0 {
                        futures::future::pending::<()>().await;
                    } else {
                        tokio::time::sleep(Duration::from_millis(duration_ms.max(1_000))).await;
                    }
                };
                tokio::pin!(deadline);
                loop {
                    tokio::select! {
                        event = devices.next() => {
                            let address = match event {
                                Some(AdapterEvent::DeviceAdded(address)) => address,
                                Some(_) => continue,
                                None => break,
                            };
                            let Ok(device) = adapter.device(address) else { continue; };
                            let Ok(Some(rssi)) = device.rssi().await else { continue; };
                            shared.record_signal(address, rssi).await;
                            let has_service = device
                                .uuids()
                                .await
                                .ok()
                                .flatten()
                                .is_some_and(|uuids| uuids.contains(&SERVICE_UUID));
                            if !has_service
                                || shared.suppressed.lock().await.contains(&address)
                                || shared.remotes.lock().await.contains_key(&address)
                            {
                                continue;
                            }
                            let mut connecting = shared.connecting.lock().await;
                            if !connecting.insert(address) { continue; }
                            drop(connecting);
                            tokio::spawn(activate_remote(shared.clone(), device, generation));
                        }
                        () = &mut deadline => break,
                    }
                }
            }));
            Ok(())
        }

        fn stop_scan(&mut self) {
            self.continuous_scan = false;
            if let Some(task) = self.scan_task.take() {
                task.abort();
            }
        }

        async fn prefer_peripheral(&self, endpoint_id: &str) -> Result<()> {
            let address = parse_endpoint(endpoint_id)?;
            self.shared.suppressed.lock().await.insert(address);
            if let Some(remote) = self.shared.remotes.lock().await.remove(&address) {
                let _ = remote.device.disconnect().await;
            }
            Ok(())
        }

        async fn disconnect(&self, endpoint_id: &str) -> Result<()> {
            let address = parse_endpoint(endpoint_id)?;
            self.shared.next_packet_ids.lock().await.remove(endpoint_id);
            if endpoint_id.starts_with("c:") {
                if let Some(remote) = self.shared.remotes.lock().await.remove(&address) {
                    let _ = remote.device.disconnect().await;
                }
            } else {
                self.shared.suppressed.lock().await.remove(&address);
                self.shared
                    .inactive_responder_endpoints
                    .lock()
                    .await
                    .insert(endpoint_id.to_owned());
            }
            Ok(())
        }

        async fn refresh_peer_profile(&mut self, endpoint_id: &str) -> Result<()> {
            let address = parse_endpoint(endpoint_id)?;
            if endpoint_id.starts_with("p:") {
                self.shared.suppressed.lock().await.remove(&address);
                if !self.continuous_scan {
                    self.start_scan(10_000).await?;
                }
                return Ok(());
            }
            self.shared.suppressed.lock().await.remove(&address);
            let Some(remote) = self.shared.remotes.lock().await.get(&address).cloned() else {
                return Ok(());
            };
            let profile = BASE64.encode(remote.profile.read().await?);
            let rssi = remote.device.rssi().await?.unwrap_or_default();
            let generation = self.shared.connection_generation(endpoint_id).await;
            self.shared.emitter.event(
                "onPeer",
                json!({ "endpointId": endpoint_id, "generation": generation, "profile": profile, "rssi": rssi }),
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
            let address = parse_endpoint(endpoint_id)?;
            if endpoint_id.starts_with("c:") {
                let remote = self
                    .shared
                    .remotes
                    .lock()
                    .await
                    .get(&address)
                    .cloned()
                    .context("The nearby peer is not connected")?;
                for frame in frames(&payload, packet_id, remote.mtu)? {
                    remote.mailbox.write(&frame).await?;
                }
                return Ok(());
            }
            let subscriber = self
                .shared
                .subscribers
                .lock()
                .await
                .get(&address)
                .cloned()
                .context("The nearby peer is not connected")?;
            let (reply, receive) = oneshot::channel();
            subscriber
                .sender
                .send(NotifySend {
                    frames: frames(&payload, packet_id, subscriber.maximum_frame_size)?,
                    reply,
                })
                .await
                .context("The nearby peer disconnected")?;
            receive.await.context("The nearby peer disconnected")??;
            Ok(())
        }

        async fn stop_session(&mut self) {
            self.stop_scan();
            self.shared
                .session_generation
                .fetch_add(1, Ordering::AcqRel);
            self.advertisement.take();
            self.application.take();
            if let Some(task) = self.notify_control_task.take() {
                task.abort();
            }
            if let Some(task) = self.profile_notify_control_task.take() {
                task.abort();
            }
            self.shared.subscribers.lock().await.clear();
            self.shared.profile_subscribers.lock().await.clear();
            let remotes = std::mem::take(&mut *self.shared.remotes.lock().await);
            for remote in remotes.into_values() {
                let _ = remote.device.disconnect().await;
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
    }

    async fn activate_remote(shared: Arc<Shared>, device: Device, generation: u64) {
        let address = device.address();
        let result = activate_remote_inner(&shared, &device, generation).await;
        shared.connecting.lock().await.remove(&address);
        if let Err(error) = result {
            eprintln!("[psstpsst-proximity] unable to activate {address}: {error:#}");
            let _ = device.disconnect().await;
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
        device: &Device,
        generation: u64,
    ) -> Result<()> {
        let address = device.address();
        if shared.session_generation.load(Ordering::Acquire) != generation {
            return Ok(());
        }
        if !device.is_connected().await? {
            device.connect().await?;
        }
        let endpoint_id = format!("c:{address}");
        let connection_generation = shared.next_connection_generation(&endpoint_id).await;
        shared.emitter.event(
            "onConnection",
            json!({ "endpointId": endpoint_id, "state": "connected", "generation": connection_generation }),
        );
        let mut profile = None;
        let mut mailbox = None;
        for service in device.services().await? {
            if service.uuid().await? != SERVICE_UUID {
                continue;
            }
            for characteristic in service.characteristics().await? {
                match characteristic.uuid().await? {
                    PROFILE_UUID => profile = Some(characteristic),
                    MAILBOX_UUID => mailbox = Some(characteristic),
                    _ => {}
                }
            }
        }
        let profile = profile.context("Nearby profile characteristic is missing")?;
        let mailbox = mailbox.context("Nearby mailbox characteristic is missing")?;
        let mtu = mailbox.mtu().await?.max(20);
        let profile_value = BASE64.encode(profile.read().await?);
        let rssi = device.rssi().await?.unwrap_or_default();
        let profile_notifications = profile.notify().await.ok();
        let notifications = mailbox.notify().await?;
        if shared.session_generation.load(Ordering::Acquire) != generation
            || shared.suppressed.lock().await.contains(&address)
        {
            return Ok(());
        }
        shared.remotes.lock().await.insert(
            address,
            RemoteEndpoint {
                device: device.clone(),
                profile,
                mailbox,
                mtu,
            },
        );
        shared.emitter.event(
            "onPeer",
            json!({
                "endpointId": format!("c:{address}"),
                "generation": connection_generation,
                "profile": profile_value,
                "rssi": rssi,
            }),
        );
        if let Some(profile_notifications) = profile_notifications {
            let shared = shared.clone();
            tokio::spawn(async move {
                futures::pin_mut!(profile_notifications);
                while let Some(value) = profile_notifications.next().await {
                    shared.emitter.event(
                        "onPeer",
                        json!({
                            "endpointId": format!("c:{address}"),
                            "generation": connection_generation,
                            "profile": BASE64.encode(value),
                            "rssi": 0,
                        }),
                    );
                }
            });
        }
        let shared = shared.clone();
        tokio::spawn(async move {
            futures::pin_mut!(notifications);
            while let Some(frame) = notifications.next().await {
                shared.accept_frame(&format!("c:{address}"), &frame).await;
            }
            shared.remotes.lock().await.remove(&address);
            shared.emitter.event(
                "onConnection",
                json!({ "endpointId": format!("c:{address}"), "state": "disconnected", "generation": connection_generation }),
            );
        });
        Ok(())
    }

    fn parse_endpoint(endpoint_id: &str) -> Result<Address> {
        let raw = endpoint_id
            .strip_prefix("c:")
            .or_else(|| endpoint_id.strip_prefix("p:"))
            .context("Invalid nearby endpoint")?;
        raw.parse().context("Invalid nearby endpoint address")
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
                            "implementationVersion": "linux-1",
                            "platform": "linux",
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
        Ok(())
    }
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() {
    if let Err(error) = linux::run().await {
        eprintln!("[psstpsst-proximity] fatal error: {error:#}");
        std::process::exit(1);
    }
}
