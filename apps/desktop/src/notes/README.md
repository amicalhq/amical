# Desktop note bodies

`notes.content` is the authoritative UTF-8 Markdown body when `content_format`
is `markdown-v1`. Lexical is the rich-text editor, not the storage contract.
Local saves use last-write-wins: the last body save processed by SQLite becomes
the stored body. `updated_at` changes for body, title, or icon edits.

## Markdown profile v1

CommonMark blocks and inline syntax: paragraphs, headings 1–6, bold, italic,
ordered/unordered lists with nesting, links (including titles), block quotes,
inline code, fenced code (with optional language), and thematic/horizontal rules.
The explicit GFM extensions are double-tilde strikethrough, task lists, and
literal URL/email autolinks. Tables, images, footnotes and raw HTML rendering are
not part of the profile. Raw HTML is displayed as text. Only `http:`, `https:`
and `mailto:` links can be active; control characters and whitespace in link
URLs are rejected. Pasted unsafe links become plain text.

Soft line breaks are rendered as editor line breaks; edits serialize them as
CommonMark hard breaks. Blank editor paragraphs are Markdown block separators,
not distinct empty blocks. Repeated blank separators may render as one gap.
Opening a note never serializes it, so original Markdown spelling, whitespace,
line endings and timestamps stay unchanged until an actual edit. Inline/code
contents and literal Markdown punctuation are escaped by the serializer. Code
fences expand when needed to contain backticks. There is no local body-size cap.

Migration drops underline, highlight, subscript/superscript, case-conversion
styles, custom CSS, block alignment/indentation, and explicit text direction.
It preserves the underlying text, supported inline formatting, and nested list
structure. Unsafe links become their text labels; code-block styling is removed.
The original styling remains in the retained migration backup. All converted
notes use the same editable Markdown path; there is no legacy rendering mode.
Unknown content-bearing nodes, malformed data, and structures that fail the
semantic round-trip check still require recovery rather than discarding content.
New unsupported format commands are intercepted; unsupported pasted formatting
must be undone before saving. Unreadable legacy data shows a conversion error;
its originals stay in the database. Conversion does not preserve every Lexical style.

## Migration and recovery

The existing data-migration runner visits each legacy note in its own SQLite
transaction. It applies every Yjs update in ascending row-ID order, checks for
unresolved update dependencies, and converts the reconstructed `Y.Text` content.
The old SQL content column is a fallback only when no Yjs rows exist and it
contains a recognizable Lexical document. An empty column without updates is
an empty note. A populated stale column never overrides Yjs. Pre-Lexical plain
Y.Text is recognized only when the old `notesLexical` migration marker is absent;
JSON-looking malformed content remains protected.

A successful transaction stores Markdown, the format marker, and the old SQL
column in `legacy_content`. The preceding ID migration changes each integer note ID to a prefixed CUID2 and remaps
its Yjs foreign keys. The Markdown conversion preserves that ID, title, icon,
creation/edit times, and references. The Yjs rows stay byte-for-byte intact. Failed conversions
store `content_format = 'blocked'` and `migration_error`, leaving the original
body and blobs intact. A crash rolls back the whole note transaction. Reruns
skip converted rows and retry failed rows, including notes blocked by an earlier
formatting policy.
Opening also checks the per-note marker, so it cannot overwrite an edited body.

Recovery data is intentionally not pruned. Work on a database copy: inspect
`legacy_content`, `migration_error`, and all `yjs_updates` rows for the note,
ordered by `id`. After fixing the source or adding a tested converter, rerun
the migration on the copy.
Never reset a successfully migrated note: its Markdown may contain newer edits.
Deleting a note still explicitly deletes its recovery rows through the existing
foreign-key cascade. Malformed blobs that cannot be reconstructed require
recovery from the retained database rows; the UI cannot invent their content.

TODO: Once legacy migration recovery is no longer needed, add a cleanup migration
to remove retained backups and obsolete schema fields/tables, then remove the legacy conversion code.

## Editor and save ordering

The same `NoteEditor` is used by the main notes page and the notes widget.
The local provider reads Markdown. The Lexical plugin imports
with an update tag and ignores that tag and selection-only updates, avoiding
save echoes and normalization on open. There are no new Yjs updates or scheduled
compactions. The obsolete Yjs save IPC rejects old renderers.

Edits debounce for 250 ms. SQLite saves use synchronous Electron IPC after the
debounce and on unmount/beforeunload, so a successful return means the transaction
has committed before close can continue. This briefly blocks the renderer during
the write. Abrupt process termination can lose edits still in the debounce
interval, as with other unsaved input; normal close flushes it.

The main process serializes local writes. A later save replaces the whole body,
even if it came from another window that opened an older version. No save inserts
a missing note, so delayed writes cannot resurrect deleted notes. Body-change
events refresh idle windows without saving. A window with a pending edit finishes
its own save. A separate remote-change marker preserves an incoming remote snapshot as a conflict copy if
an already-open editor then saves a divergent body or title. Local save order
still determines the stored body. Deleted notes stop saving and allow normal close.
A database write error keeps the pending edit available for a retry.

Markdown list items retain paragraph boundaries and block order in the editor.
A small ListItemNode subclass prevents Lexical from merging paragraphs; it is
an editor detail, not an additional persistent note format.

## Cloud sync

Notes use the `note` collection through the existing authenticated sync service.
Bootstrap must advertise `note`; older servers continue to sync vocabulary and
snippets. Organization requests never include notes. Bodies use `markdown-v1`
and map to the version-1 Markdown payload defined by `NoteSyncPayloadSchema` in
[`packages/types/src/schemas/settings-sync.ts`](../../../../packages/types/src/schemas/settings-sync.ts).
Legacy bodies and recovery blobs are never uploaded.

The pending schema migrations run in order: `0011_notes_ids`,
`0012_settings_ids`, `0013_notes_markdown`, then `0014_notes_sync`.
`0017_notes_auto_adoption` removes the obsolete local-only flag. Note primary keys and Yjs note
foreign keys are strings (`nt_` plus a complete 24-character CUID2). The note's `id` is also the cloud `syncId`; there
is no separate sync-ID column or permanent integer-ID mapping. Notes created while signed in belong to that account. Existing
unowned notes automatically join the signed-in account and enter its sync queue
on login or when an existing session resumes, including notes previously kept
on the device. Notes stay local while signed out. Uploads require connectivity
and a server that advertises the `note` collection.
Account-owned notes are hidden after sign-out and from other accounts. Their
outboxes, tombstones, and accepted server state are retained for the owning
account. An already-open editor can finish its pending body save in its original
account even if sign-out has just hidden that note.

Create, body/title/icon edits, and deletion update the note and durable outbox in
one transaction. Pushes use accepted server versions; wall-clock timestamps do
not resolve conflicts. The editor marker advances only on remote changes, not on local
saves or their push acknowledgments. Title autosaves wait for the previous local
save to finish and carry its updated base into the next draft.

Note uploads wait 10 seconds after the latest local mutation for that note. The
deadline is stored in the outbox, so background wakes cannot capture a draft early.
Startup clears existing note deadlines so pending changes can sync immediately;
new edits receive the normal 10-second delay.
An already-captured head can finish while later edits wait; uncaptured edits
coalesce into the latest payload. Vocabulary and snippet edits retain their
750 ms wake debounce. Local body and title saves both use a 250 ms debounce.

Pull application and cursor advancement are atomic.
Divergent pending edits become separate “(conflict copy)” notes before canonical
state replaces or deletes the original. A replay cannot duplicate a committed
conflict copy. A pending editor body can also be recovered after remote deletion,
using a new note ID; the deleted identity is not restored. Local deletion still
rejects delayed saves.

The client checks the 128 KiB UTF-8 JSON payload limit, 1,024-code-unit title,
64-code-unit icon, and Unicode rules. Smaller advertised payload/request limits
also apply. Invalid or oversized drafts remain intact on the device with a sync
error and do not block other items. Editing retries them. Note-containing batches
contain at most three mutations (or a smaller advertised cap); note pages request
at most 20 items. Sync updates refresh the main notes page and widget.

Local timestamps retain the existing SQLite second precision and are explicitly
converted to milliseconds in the wire payload. Network retries use the frozen
outbox payload, including its timestamps.

## Verification

Run the repository scripts:

```sh
pnpm --filter @amical/desktop test tests/notes
pnpm --filter @amical/desktop type:check
SKIP_CODESIGNING=true SKIP_NOTARIZATION=true AMICAL_E2E_PACKAGE=1 pnpm --filter @amical/desktop package
```

The tests use disposable SQLite databases and real Lexical editor components.
They cover conversion, malformed and incomplete updates, rollback/restart,
metadata and backup retention, large notes, editing/reopening, opening without
saving, debounce/close, last-write-wins across windows, deletion, and note service/IPC behavior.

New note, vocabulary, and snippet IDs use `nt_`, `voc_`, and `snp_` prefixes plus
the full 24-character CUID2 output. Migration `0012_settings_ids` rekeys existing
live vocabulary/snippet UUIDs once after clearing their outbox, saved server
state, and pull cursors, including pending deletions. Normal sync enrolls the remaining rows again. Content, timestamps, and scope are preserved locally;
server natural-key dedup may restore the canonical UUID and content. The migration
journal prevents repeatedly rekeying those returned UUIDs. Notes are unaffected
by this settings migration. Both ID formats remain valid. Upgrade the cloud ID contract before
releasing clients that create prefixed IDs. All receiving clients must accept
both formats.
