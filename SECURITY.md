# Security policy

## Reporting a vulnerability

Do not post vulnerability details, exploit code, private keys, wallet connection
strings, or real message data in public issues or pull requests.

Use [GitHub private vulnerability reporting](https://github.com/codytseng/psstpsst/security/advisories/new)
when it is available. If that page is unavailable, open an issue asking only for
a private security contact, without describing the vulnerability. Wait for a
private channel before sharing technical details.

Include the affected version or commit, platform, reproduction steps, expected
and actual behavior, and likely impact. Use test accounts and sanitized logs.
Report protocol, cryptographic, key-storage, IPC, attachment-handling, and
account-isolation issues through the same private process. Coordinate public
disclosure with the maintainer so a fix can be prepared.

## Versions and fixes

Before the first public release, report issues against `master` and include the
commit hash. After release, fixes target `master` and the latest public release;
older versions do not have a separate backport commitment. Update to the latest
release when fixes become available. There is no guaranteed response or fix
schedule.

## Security review status

This repository does not currently include a published independent security
audit report. Use of Nostr encryption specifications and Noise does not establish
that the complete application has been independently audited.

The [privacy policy](https://psstpsst.chat/privacy/) is maintained on the official
website. The
[architecture guide](docs/ARCHITECTURE.md) and
[protocol documents](docs/protocols/) describe implementation boundaries.
