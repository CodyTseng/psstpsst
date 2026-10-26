# Napplet manifest formats

PsstPsst reads NIP-5D kinds `35129` (named), `15129` (root), and `5129`
(snapshot), including legacy single-file publications. The legacy reader follows
the format transition documented by [napplet-soy](https://github.com/zeSchlausKwab/napplet-soy/blob/68ecb09c020097cbb4d45bdf344283e9becce038/docs/NIP5D-MIGRATION.md).

| Field | Standalone | Legacy |
| --- | --- | --- |
| HTML hash | One two-element `x` tag | One `path` tag containing `/index.html` and its SHA-256 |
| Description | Nonempty plain-text `content` | Optional `description` tag |
| Required domains | Repeated `R` tags | Repeated `requires` tags |
| Optional domains | Repeated `O` tags | None inferred |
| Aggregate | Unused | Optional on roots/named apps; required on snapshots |

A two-element `x` selects standalone validation. Otherwise, a `path` or
aggregate-labelled `x` selects legacy validation. Selection precedes validation:
a malformed standalone event cannot fall back to legacy parsing. Standalone
manifests cannot mix legacy fields; legacy manifests cannot mix `R`/`O` fields.

Only a single self-contained `/index.html` path is supported. A legacy aggregate
`x` must equal the SHA-256 of the UTF-8 line `<HTML hash> /index.html\n`, including
the final newline, and must carry `aggregate` as its third element. Duplicate
paths, mismatched aggregates, ambiguous descriptions, and invalid required-domain
declarations are rejected.

The original event signature and id are verified without rewriting signed fields.
Downloaded HTML bytes are verified against the raw HTML hash, never against the
legacy aggregate. Required domains remain mandatory across both formats; format
compatibility does not imply implementation or authorization of those domains.
