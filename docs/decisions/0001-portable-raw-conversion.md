# ADR-0001: Restore portable conversion

## Status

Accepted

## Context

Version 1 read CDB files through `better-sqlite3` on every supported Node
platform. Version 2 made both input reading and output writing depend on a
Linux-only native module, which made the published CLI non-functional on
macOS and Windows.

## Decision

Use ordinary Node filesystem operations for the public raw, card, source, and
legacy compatibility paths. The Linux native implementation remains opt-in
through `CDB_USE_NATIVE_READER=1` and `CDB_USE_NATIVE_DESTINATION=1`; it is
not required for normal conversion.

## Consequences

Raw conversion, file output, and split-directory output work on macOS, Linux,
and Windows. Card and source conversion work for one input database to stdout
or a single file on those platforms. The public path no longer claims
descriptor-relative filesystem hardening.
