# PsstPsst Protocols

This directory contains the wire specifications needed to interoperate with
PsstPsst. Documents here define events, byte formats, validation rules, and
peer-to-peer exchanges. They do not describe database schemas, service classes,
UI behavior, background scheduling, retry workers, or platform adapters.

Compatible clients may choose any local architecture, persistence model, retry
policy, and user experience as long as their observable protocol behavior
matches the relevant specification.

## Specifications

- [`nip4e.md`](./nip4e.md): encryption-key announcement and device
  synchronization.
- [`nip17-extensions.md`](./nip17-extensions.md): split-key envelopes, message
  timestamps, and stable groups.
- [`nearby-messaging.md`](./nearby-messaging.md): authenticated messaging over
  Bluetooth Low Energy.
- [`nearby-file-transfer.md`](./nearby-file-transfer.md): direct and
  resumable file exchange for Nearby peers.
