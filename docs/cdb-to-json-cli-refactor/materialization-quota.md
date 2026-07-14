# Private SQLite materialization quota proof

This note is normative for Revision-12 `maxSnapshotBytes` enforcement. A
post-`VACUUM INTO` inventory or an injected callback is not a pre-write quota.
The source handle must admit a complete finite bound before opening the copied
bundle writable.

## Bound inputs

Read these values without writing: SQLite file header page size and page count
from `main`, WAL header page size, WAL frame count, each validated frame page
number, and the committed WAL end mark. Reject malformed headers, unsupported
page sizes, checksum failures, arithmetic overflow, or an unknown SQLite build
as `CDB_OPEN_FAILED` rather than guessing.

Let `P` be the validated page size, `N` the maximum committed database page
number across the main header and WAL frames, `F` the number of committed WAL
frames, and `H` the fixed SQLite header sizes for the pinned build. Bounds use
checked unsigned arithmetic:

- materialized main: `Bmain = N * P + H.database`;
- rollback journal: `Bjournal = N * P + H.journal + P`;
- WAL: `Bwal = F * (P + H.walFrame) + H.walHeader`;
- SHM/index: `Bshm = H.shmBase + ceil(N / H.shmPagesPerIndex) * H.shmIndexPage`;
- temporary sibling: `Btemp = N * P + H.temp + P`.

The implementation reserves the sum of the bounds for files that the selected
private SQLite configuration can create. If a mode is disabled, its bound is
zero; if SQLite can create it, the bound is included. The bound is intentionally
conservative and may reject a valid database. It is not permissible to replace
an unknown bound with the observed file size after the operation.

The proof relies on SQLite's page-oriented file format: the materialized image
contains no page number above `N`; a journal/WAL frame carries at most one
`P`-byte page plus its fixed header; the SHM index has a bounded number of index
pages for `N`; and fixed headers/slack are included above. The tests pin the
SQLite version used by `better-sqlite3`, exercise the maximum supported page
size and a high-page WAL, and fail if the generated private file exceeds its
admitted bound.

## Enforcement sequence

1. Capture source members and charge their actual copied bytes to both counters.
2. Compute these bounds from the copied bundle and reserve the complete bound
   against the remaining `maxSnapshotBytes` and `maxStagingBytes` before a
   writable SQLite open or `VACUUM INTO` call.
3. Run private WAL replay/materialization only after the reservation succeeds.
   Inventory every private SQLite sibling during cleanup and reconcile actual
   sizes against its individual bound and the reservation.
4. On an unexpected file or bound violation, close SQLite first, emit
   `RESOURCE_LIMIT_EXCEEDED`, and remove/retain no published output. A
   violation is never converted into a successful post-write warning.
5. Release the single physical-file reservation only after the FD is closed and
   the file is removed or safely handed off to the next lifecycle owner.

The sparse/high-page fixture proves the important negative: a small source
bundle with a large possible materialized image is rejected before writable
SQLite work, so no SQLite-internal write can cross the selected limit. The
real under-bound WAL fixture proves the positive path and cleanup. If a future
SQLite update invalidates the proof, the reader must fail closed until these
bounds and vectors are revised.
