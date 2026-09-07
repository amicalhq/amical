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
column in `legacy_content`. It never changes the ID, title, icon, creation/edit
times, or references. The Yjs rows stay byte-for-byte intact. Failed conversions
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
its own save. There are no revision comparisons, conflict dialogs, draft downloads,
or session recovery copies. Deleted notes stop saving and allow normal close.
A database write error keeps the pending edit available for a retry.

Markdown list items retain paragraph boundaries and block order in the editor.
A small ListItemNode subclass prevents Lexical from merging paragraphs; it is
an editor detail, not an additional persistent note format.

A later adapter can read `getNoteById()` for the complete body and metadata. It
must use only `markdown-v1` bodies and must not interpret legacy or blocked content
as Markdown. This change adds no cloud sync behavior.

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

Note IDs use `nt_` plus the full 24-character CUID2 output. Migration
`0011_notes_ids` replaces integer primary keys and updates Yjs foreign keys
before `0013_notes_markdown` runs. The note ID is used throughout IPC and UI.

Migration `0012_settings_ids` clears vocabulary/snippet outbox entries, saved
server state, and pull cursors, including pending deletions, then replaces live
UUIDs with `voc_` and `snp_` plus full 24-character CUID2 IDs. Normal sync enrolls
the remaining rows again. Content and metadata stay unchanged locally. Server
natural-key dedup can restore existing UUIDs and content; the migration runs once.
