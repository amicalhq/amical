# 設計指示書: 誤変換を Claude(ローカルMCP) に判定させ、カスタム辞書へ承認付きで登録する

対象リポジトリ: `amicalhq/amical`
対象パッケージ: `apps/desktop`（Electron デスクトップアプリ）
この文書は**実装者が追加調査なしで着手できること**を目的にしている。
調査済みの事実・写すべき既存パターン・既知の罠をすべて含む。

---

## 1. 目的

Amical のディクテーションで固有名詞や専門用語が誤変換されたとき、現状ユーザーは
設定画面のカスタム辞書に手で登録するしかない。

これを次のワークフローに置き換える。

1. ユーザーが Claude Code で「最近の誤変換を探して」と依頼する（**手動トリガー**）
2. Claude がローカル MCP サーバー経由でディクテーション履歴と既存辞書を読み、
   誤変換を判定して修正案を提案する（自動）
3. 提案が Amical の設定画面に `pending` で溜まる
4. ユーザーが承認する（**手動承認**）
5. 次回のディクテーションから自動的に適用される

**この機能は pull 型である。Claude は自発的には動かない。**
アプリから Claude への能動通知（push / sampling）は実装しない。

---

## 2. 調査で判明済みの前提（再調査不要）

着手前に以下を頭に入れること。README や公式ドキュメントの記述は**古く、誤っている**。

| 一般に言われている状態     | 実際のコードベース                                                                                                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amical Cloud 転写は未実装  | **完全に実装済み。** `src/pipeline/providers/transcription/amical-cloud-provider.ts`（727行）が gRPC 双方向ストリームを本命、HTTP を自動フォールバックとして実装済み。`.proto` も生成コードもテストもある。**復元作業は不要**                                    |
| カスタム辞書は "Planned"   | **完全に実装済み。** DB → tRPC → 設定UI → クラウド同期まで通っている。`apps/www/content/docs/custom-vocabulary.mdx` の "Coming soon" と `README.md` の表記が古いだけ                                                                                             |
| MCP 実装があるかもしれない | **皆無。** `@modelcontextprotocol/sdk` 依存なし、`7878` の記述なし、`http.createServer` / `.listen(` がリポジトリ全体で 0 件。アプリはポートを一切 listen していない（renderer↔main は tRPC over Electron IPC、OAuth コールバックは `amical://` ディープリンク） |

したがって本作業は **「MCP サーバーを新規に建てる」+「承認キューを足す」** の2点のみ。

### 2.1 既存カスタム辞書の仕組み（最重要・ここを理解せずに着手しない）

`vocabulary` テーブルは **1テーブルで2モード** を表現している。
`replacementWord` が null かどうかでモードが決まる。

| モード         | 条件                       | 適用経路                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ヒント語**   | `replacementWord === null` | `selectVocabularyHints()`（`src/utils/vocabulary-hints.ts`、**上限200件**、最新の `dateAdded` 順）が拾い、Whisper の `initial_prompt`（`src/pipeline/providers/transcription/whisper-prompt.ts` の `buildWhisperPrompt`）、LLM整形プロンプトの `<vocabulary>` タグ（`src/pipeline/providers/formatting/formatter-prompt.ts` の `buildVocabInstruction`）、および Amical Cloud のセッションコンテキスト（`src/pipeline/providers/transcription/amical-cloud-provider.ts:613` の `currentVocabulary`）へ流れる |
| **置換ルール** | `replacementWord !== null` | `src/services/transcription/prepare-transcript-text.ts:207` の `applyTextReplacements()` が転写後に適用する。実装は `src/utils/text-replacement.ts`（CJK対応、最長トリガー優先、正規表現エスケープ済み）                                                                                                                                                                                                                                                                                                     |

**「誤変換された表記 → 正しい表記」は後者そのものである。**
承認された提案を `vocabulary` に1行入れるだけで、次回のディクテーションから自動的に効く。

`loadDictationContext()`（`src/services/transcription/load-dictation-context.ts`）が
セッションの最初のチャンク処理時に辞書を読み込むため、**アプリの再起動は不要**。

### 2.2 パイプライン側の変更は一切不要

本作業で転写パイプラインに手を入れる必要は **ない**。
承認された辞書エントリは既存の経路を通って自動的に反映される。

---

## 3. 触ってはいけないもの

以下は本作業の範囲外。変更・リファクタリングしないこと。

- `src/pipeline/` 配下すべて（転写プロバイダ、整形プロバイダ、Amical Cloud 一式）
- `src/services/transcription-service.ts` および `src/services/transcription/` 配下
- `src/main/lifecycle/` 配下（録音の状態機械）
- `src/utils/text-replacement.ts` の `applyTextReplacements()`
- `src/utils/vocabulary-hints.ts` の `selectVocabularyHints()`
- `src/pipeline/providers/transcription/whisper-prompt.ts` の `buildWhisperPrompt()`
- `src/renderer/main/routeTree.gen.ts`（`@tanstack/router-plugin` の自動生成。手で編集しない）

### 紛らわしいので注意

設定に `labs.selfCorrection` という項目が既に存在するが、**本機能とは無関係**。
これは Amical Cloud に `amical-labs: self-correction` という HTTP ヘッダを送るだけの
サーバー側機能（`src/utils/http-client.ts:17` の `AMICAL_LAB_SELF_CORRECTION`）。
流用も改名もしないこと。

---

## 4. 実装手順

以下の順序で進める。各ステップに「写すべき既存ファイル」を示したので、
**自分の記憶やプロジェクト外の慣習ではなく、必ずそのファイルの書き方に合わせること。**

このリポジトリは Effect 4 (rc.115) / TypeScript 7 / Drizzle ORM / tRPC 11 を使っている。
バージョンが新しいため、既存コードの書き方を写すのが唯一確実な方法である。

### ステップ 1: 依存追加

`apps/desktop/package.json` の `dependencies` に `@modelcontextprotocol/sdk` を追加する。

- HTTP サーバーは Node 組み込みの `node:http` を使う。
  **express / fastify / hono などは導入しない**（リポジトリに HTTP サーバーフレームワークは一切入っていない）
- インストールは `pnpm install`（pnpm 10.34.5、corepack 経由）

### ステップ 2: 承認キューのテーブル追加

`src/db/schema.ts` に `vocabularyProposals` を追加する。
既存の `vocabulary` テーブル定義（65行目付近）の直後に置くとよい。

```ts
// Vocabulary proposals — misrecognition fixes suggested by an MCP client,
// held for user approval before they become real vocabulary entries.
export const vocabularyProposals = sqliteTable(
  "vocabulary_proposals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // The misrecognized surface form.
    word: text("word").notNull(),
    // The correct form. NULL means "propose this as a hint word", matching
    // the two-mode convention of the vocabulary table.
    replacementWord: text("replacement_word"),
    // Why the MCP client believes this is a misrecognition.
    rationale: text("rationale"),
    // Transcript excerpt showing the misrecognition in context. Baked in so
    // the proposal stays reviewable after history retention deletes the row.
    contextSnippet: text("context_snippet"),
    // Deliberately NOT a foreign key: history cleanup deletes transcriptions
    // on a retention schedule and must not cascade into pending proposals.
    transcriptionId: integer("transcription_id"),
    source: text("source").notNull().default("mcp"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    // Set on approval: the vocabulary row this proposal produced.
    vocabularyId: text("vocabulary_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
  },
  (table) => [
    index("vocabulary_proposals_status_idx").on(table.status, table.createdAt),
  ],
);
```

ファイル末尾（623行目付近、他の型エクスポートが並んでいる箇所）に型を追加する。

```ts
export type VocabularyProposal = typeof vocabularyProposals.$inferSelect;
export type NewVocabularyProposal = typeof vocabularyProposals.$inferInsert;
```

#### 設計判断の理由（変更しないこと）

- **autoincrement 整数 PK を使う。** `vocabulary` や `snippets` は cuid2 の複合 PK
  （`scopeType` / `scopeId` / `id`）だが、それはクラウド同期対象だから。
  提案テーブルは**ローカル専用で同期しない**ので、`transcriptions` と同じ単純な整数 PK にする。
  これにより `packages/types/src/entity-id.ts` の prefix 定義に触れずに済む
  （あのファイルは Swift / C# のモデル生成に波及する）
- **`recordLocalSyncMutation` を呼ばない。** クラウドに同期されるのは、承認後に作られる
  `vocabulary` の行だけ。提案そのものは端末ローカルに留める
- **`transcriptionId` に外部キーを張らない。** `src/services/history-cleanup-service.ts` が
  保持期間（既定 `never`、設定で `1d`〜`28d`）に従って `transcriptions` を削除する。
  元の転写が消えても提案はレビュー可能であるべきなので、FK は張らず
  `contextSnippet` に抜粋を焼き込んでおく

#### マイグレーション生成

`apps/desktop/` ディレクトリで実行する。

```bash
pnpm db:generate
```

`src/db/migrations/0017_*.sql` と `meta/0017_snapshot.json`、`meta/_journal.json` の更新が
自動生成される。**SQL を手書きしないこと。**
生成されたファイルは必ず中身を確認してからコミットする。

### ステップ 3: DB サービス `src/db/vocabulary-proposals.ts`

**`src/db/vocabulary.ts` のスタイルを写す**（`db` を `"."` から import した素の async 関数群）。
ただし同期しないので `./sync` 系の import と `recordLocalSyncMutation` 呼び出しは含めない。

実装する関数:

| 関数                                          | 役割                                      |
| --------------------------------------------- | ----------------------------------------- |
| `createProposal(data)`                        | 提案を1件 `pending` で作成                |
| `listProposals({ status?, limit?, offset? })` | 一覧。既定は `createdAt` 降順             |
| `countPendingProposals()`                     | UI のバッジ用                             |
| `getProposalById(id)`                         | 単件取得                                  |
| `findPendingProposal(word, replacementWord)`  | 重複提案の検出用                          |
| `rejectProposal(id)`                          | `status = "rejected"`、`decidedAt` を打つ |
| `approveProposal(id)`                         | 下記の通り                                |

#### `approveProposal` の実装（最重要・ここを間違えると本番で例外になる）

`vocabulary` テーブルには **unique 制約** `vocabulary_scope_word_unique`
（`scope_type`, `scope_id`, `word`）がある（`src/db/schema.ts:92`）。
同じ `word` が既に登録済みの状態で素朴に insert すると制約違反で落ちる。

必ず次の分岐を実装すること。

```ts
export async function approveProposal(id: number) {
  const proposal = await getProposalById(id);
  if (!proposal) throw new Error("Proposal not found");
  if (proposal.status !== "pending")
    throw new Error("Proposal already decided");

  // MUST reuse the existing vocabulary helpers: they record the cloud sync
  // mutation in the same transaction. Do not write to the vocabulary table
  // directly from here.
  const existing = await getVocabularyByWord(proposal.word);

  const entry =
    existing && existing.scopeType === "user"
      ? await updateVocabulary(existing.id, {
          replacementWord: proposal.replacementWord,
        })
      : await createVocabularyWord({
          word: proposal.word,
          replacementWord: proposal.replacementWord,
        });

  // then mark the proposal approved, storing entry.id in vocabularyId
}
```

`createVocabularyWord` と `updateVocabulary` は `src/db/vocabulary.ts` の既存関数で、
内部で `db.transaction` を張り `recordLocalSyncMutation` を呼ぶ。
**これらを経由すればクラウド同期は自動的に付いてくる。自前で insert を書かないこと。**

`getVocabularyByWord` は org スコープの行も返しうる。org スコープの辞書は
書き込み権限が別管理（`getWritableOrganizationIdentity()`）なので、
**承認は user スコープのみを対象とする**（上記の `existing.scopeType === "user"` 判定）。

### ステップ 4: MCP サーバーサービス `src/services/mcp-server-service.ts`

**`src/services/history-cleanup-service.ts` を逐語的にテンプレートとして写すこと。**
このリポジトリの Effect 4 レイヤー規約が凝縮されている唯一の短い実例である。

写すべき構造:

- `private constructor(...)` — 「グラフだけがこのサービスを構築できる」ようにするため
- `static readonly Live: Layer.Layer<Tag, never, Deps>` を `Layer.effect(Tag, Effect.gen(function* () { ... }))` で定義
- 依存は `yield* SettingsServiceTag` / `yield* AppScopeTag` の行として書く
- teardown は `yield* addRelease(appScope, "<ログ文言>", "<名前>", () => service.cleanup())`
- 初期化は `yield* step(() => service.initialize())`
- 最後に `up("<名前>")` を呼んで `return service`

ヘルパーは `src/main/runtime/layer-helpers.ts` にある（`addRelease` / `step` / `up` / `down`）。
`addRelease` を使う理由はそのファイルの doc コメントに書いてある
（`Effect.acquireRelease` を layer 内で使うと部分構築失敗時にクラッシュ経路より先に
サービスが落とされてしまう）。**`Effect.acquireRelease` を使わないこと。**

#### サーバーの要件

- `node:http` の `createServer` を使い、**`127.0.0.1` にバインドする**（`0.0.0.0` は禁止）
- パスは `/mcp`
- SDK の `McpServer` + `StreamableHTTPServerTransport` を
  **ステートレスモード**（`sessionIdGenerator: undefined`）で使う。
  公開するのは tool のみなのでセッション管理は不要
- `enableDnsRebindingProtection: true` と
  `allowedHosts: ["127.0.0.1:<port>", "localhost:<port>"]` を設定する
- `Authorization: Bearer <token>` を検証し、不一致・欠落は **401** を返す
- 設定変更イベント（ステップ6）を購読して start / stop / 再バインドする
- **ポート使用中（`EADDRINUSE`）でアプリを落とさないこと。**
  `logger.main.error` に出して静かに諦め、サービス自体は生存させる

#### ロギング

`src/main/logger.ts` の `logger` を使う。`logger.main.*` 系。`console.log` は使わない。

### ステップ 5: レイヤーグラフへの登録

**`src/main/runtime/tags.ts`**: `HistoryCleanupServiceTag`（53行目）の定義を写してタグを足す。

```ts
export class McpServerServiceTag extends Context.Service<
  McpServerServiceTag,
  McpServerService
>()("AmicalApp/McpServerService") {}
```

同ファイル末尾の `AppServices` 合併型（183行目付近）にも追加する。

**`src/main/runtime/layers.ts`**: 295行目付近、`HistoryCleanupService.Live` が入っている
中段の `Layer.mergeAll(...)` ブロックに `McpServerService.Live` を追加する。

```ts
Layer.provideMerge(
  Layer.mergeAll(
    ModelService.Live,
    VADService.Live,
    NativeBridgeLive,
    FeatureFlagService.Live,
    RemoteConfigService.Live,
    HistoryCleanupService.Live,
    McpServerService.Live,   // <- add
  ),
),
```

> **規約:** このファイルの冒頭コメントにある通り、**すべての layer はモジュール定数
> （class static を含む）でなければならない**。Layer のメモ化は参照同一性で行われるため、
> 関数内で `Layer.effect(...)` を毎回作ると多重構築になる。

`HistoryCleanupService` と同じく、`ServiceMap`（`src/main/managers/service-manager.ts`）への
エントリ追加は**不要**。ライフサイクル専用のサービスなので `services()` から引けなくてよい
（同ファイル64行目のコメントがその前例を説明している）。

### ステップ 6: 設定セクションの追加

**`src/db/schema.ts`** の `AppSettingsData` インターフェース（336行目〜）に任意セクションを追加。

```ts
mcpServer?: {
  enabled: boolean;
  port: number;
  token: string;
};
```

**`src/db/app-settings.ts`** の `DEFAULT_SETTINGS`（100行目付近、`labs: { selfCorrection: false }`
の並び）に既定値を追加する。

```ts
mcpServer: {
  enabled: false,   // opens a local port — opt-in only
  port: 7878,
  token: "",
},
```

**`CURRENT_SETTINGS_VERSION`（`src/db/settings-migrations/index.ts:20`、現在 15）は
bump しないこと。** 任意セクションなので、他の任意セクションと同様に読み出し側で
`?? 既定値` を使えばよい。設定マイグレーションの追加は不要。

**`src/services/settings-service.ts`**: `LabsSettings`（120行目付近）と
`getLabsSettings` / `setLabsSettings`（277行目付近）を写して
`McpServerSettings` 型と getter / setter を足す。

setter からは `setHistorySettings`（544行目）と同じ形でイベントを発火する。

```ts
async setMcpServerSettings(next: McpServerSettings): Promise<void> {
  const previous = await this.getMcpServerSettings();
  await updateSettingsSection("mcpServer", next);
  this.emit("mcp-settings-changed", { previous, current: next });
}
```

`updateSettingsSection` は**セクション単位の置換で、深いマージはしない**
（`src/db/app-settings.ts` の doc コメント参照）。必ず完全なセクションを渡すこと。

**`src/trpc/routers/settings.ts`**: `LabsSettingsSchema`（69行目付近）と
`getLabsSettings` / `setLabsSettings` procedure（542行目〜）を写す。
トークン再生成用の mutation も足す（`crypto.randomBytes(32).toString("hex")` 等）。

### ステップ 7: tRPC — 提案用 procedure

**`src/trpc/routers/vocabulary.ts` を拡張する。新しいルーターを作らない**
（承認 UI が辞書ページと同じ場所にあるため）。

- `listProposals` (query)
- `getPendingProposalCount` (query)
- `approveProposal` (mutation)
- `rejectProposal` (mutation)

入力スキーマは同ファイル既存の zod スキーマの書き方に合わせる。
`id` は整数なので `SettingsSyncIdSchema`（cuid2/UUID 用）は**使わない**。`z.number().int()` を使う。

### ステップ 8: UI

#### (a) 承認キュー

**`src/renderer/main/pages/settings/vocabulary/index.tsx` に「提案」カードを追加する。**

- `pending` 件数のバッジ
- 各提案について `word → replacementWord`、`rationale`、`contextSnippet` を表示
- 承認 / 却下ボタン
- 承認後は辞書一覧も更新する:
  `utils.vocabulary.getVocabulary.invalidate()` と提案一覧の invalidate を両方呼ぶ

既存のクエリ／ミューテーションの書き方（`api.vocabulary.*.useQuery` /
`useMutation({ onSuccess, onError })` + `sonner` の `toast`）をそのまま踏襲する。

#### (b) MCP サーバー設定ページ

新規作成する。

| ファイル                                         | 内容                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `src/renderer/main/pages/settings/mcp/index.tsx` | ページ本体。`src/renderer/main/pages/settings/labs/index.tsx` を写す |
| `src/renderer/main/routes/_app/settings/mcp.tsx` | `createFileRoute("/_app/settings/mcp")`                              |
| `src/renderer/main/lib/settings-navigation.ts`   | `SETTINGS_NAV_ITEMS` にエントリ追加                                  |

ページに置くもの: 有効化トグル、ポート入力、トークン再生成ボタン、稼働状態表示、
そして**接続コマンドのコピーボタン**。

```
claude mcp add --transport http amical http://127.0.0.1:7878/mcp --header "Authorization: Bearer <token>"
```

> `routeTree.gen.ts` は `@tanstack/router-plugin` が自動生成する。**手で編集しない。**
> dev サーバー起動時か `pnpm build` 時に再生成される。

#### (c) i18n

**`src/i18n/locales/` の5ファイル全部**（`en.json` / `ja.json` / `es.json` / `de.json` /
`zh-TW.json`）にキーを追加する。1つでも欠けるとそのロケールでキー名が露出する。
文字列のハードコードは禁止（既存ページはすべて `useTranslation()` 経由）。

### ステップ 9: テスト

`apps/desktop/tests/` 配下、Vitest。
`tests/helpers/test-db.ts` の `createTestDatabase()` が実マイグレーションを流した
隔離 DB を作ってくれるので、それを使う（`tests/db/scoped-language-assets.test.ts` が参考例）。

**`tests/db/vocabulary-proposals.test.ts`**

- 提案の作成
- `findPendingProposal` による重複検出
- 却下で `status` と `decidedAt` が更新されること
- **承認時、既存の `word` があれば `updateVocabulary` に、無ければ `createVocabularyWord` に
  分岐すること**（unique 制約の回帰テスト。これは必ず書くこと）
- 承認された行に `vocabularyId` が入ること

**`tests/services/mcp-server-service.test.ts`**

- 各ツールの入出力スキーマ
- `Authorization` ヘッダ無し / 不正トークンが 401 になること
- `propose_vocabulary_entry` が `pending` 行を作り、**`vocabulary` テーブルには書かないこと**
- `EADDRINUSE` でサービスが例外を投げずに生存すること

---

## 5. MCP が公開するもの

### 5.1 ツール

| ツール名                    | 入力                                                                           | 実装に使う既存関数                                                         |
| --------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `list_recent_dictations`    | `limit?` (1-100, 既定20), `sinceHours?`, `search?`                             | `src/db/transcriptions.ts` の `getTranscriptions` / `searchTranscriptions` |
| `get_dictation`             | `id`                                                                           | `getTranscriptionById`                                                     |
| `list_vocabulary`           | `search?`, `limit?`                                                            | `src/db/vocabulary.ts` の `getVocabulary` / `searchVocabulary`             |
| `propose_vocabulary_entry`  | `word`, `replacementWord?`, `rationale`, `transcriptionId?`, `contextSnippet?` | `findPendingProposal` で重複確認 → `createProposal`                        |
| `list_vocabulary_proposals` | `status?`                                                                      | `listProposals`                                                            |

補足:

- `list_recent_dictations` が返すフィールド: `id`, `text`, `timestamp`, `language`,
  `detectedLanguage`, `confidence`, `speechModel`
- `list_vocabulary` は**必須**。これが無いと Claude が既存語を重複提案する
- `list_vocabulary_proposals` は承認／却下の結果を Claude に見せるフィードバックループ。
  却下済みの提案を繰り返さないために要る
- `propose_vocabulary_entry` は重複時に `{ duplicateOf: <id> }` を返し、新規作成しない

### 5.2 プロンプト

MCP prompt を1つ公開する: `review_dictations_for_misrecognitions`

内容は次の手順を記述する。

1. `list_recent_dictations` で最近の転写を読む
2. `list_vocabulary` で既存辞書を読み、登録済みの語を除外する
3. 文脈的に不自然な固有名詞・専門用語・表記ゆれを特定する
4. **確信が持てるものだけ** `propose_vocabulary_entry` で提案する
5. 固有名詞だが誤変換ではないもの（初出の人名など）は
   `replacementWord` を省略してヒント語として提案してよい

サーバーの `instructions` フィールドにも同趣旨を書く。

### 5.3 設計上の制約（守ること）

- **誤変換の検出ロジックをアプリのコードに書かない。**
  信頼度スコアの閾値判定や未知語ヒューリスティックは実装しない。
  判定は Claude が行う。アプリはデータを渡し、提案を受け取るだけ
- **辞書へ直接書き込むツールを公開しない。** 提案のみ。
  `vocabulary` テーブルへの書き込みは、ユーザーが UI で承認したときだけ起きる

---

## 6. セキュリティ要件

ローカルポートを開けるということは、**同じマシンで動く任意のプロセスが
ディクテーション履歴を読めるようになる**ということ。以下は必須。

- `127.0.0.1` にバインドする（`0.0.0.0` / `::` は禁止）
- `Authorization: Bearer <token>` を必須にする。
  トークンは初回有効化時に `crypto.randomBytes(32).toString("hex")` で生成し設定に保存
- `enableDnsRebindingProtection: true` + `allowedHosts` を設定する
  （ブラウザ経由の DNS リバインディング攻撃対策）
- **既定は無効**（`enabled: false`）。ユーザーが明示的にオンにするまでポートを開かない

> なお既存の設定保存は暗号化されていない（`app_settings` テーブルの JSON カラムに
> OpenRouter の API キーや OAuth トークンも平文で入っている）。
> MCP トークンも同じ扱いでよい。ここだけ暗号化を導入しないこと（一貫性が崩れる）。

---

## 7. 検証

### 自動テスト

```bash
cd apps/desktop && pnpm test
```

### 手動 E2E

1. `pnpm dev` でアプリを起動
2. 設定 > MCP で有効化し、接続コマンドをコピー
3. 別ターミナルで `claude mcp add ...` を実行
4. `claude` を起動し `/mcp` でツールが見えることを確認
5. Claude に「最近のディクテーションを読んで誤変換を探して」と依頼
   → `list_recent_dictations` / `list_vocabulary` / `propose_vocabulary_entry` が呼ばれること
6. 設定 > カスタム辞書 に提案が `pending` で出ること
7. 承認 → 辞書一覧に入ること
8. **実際にディクテーションして、誤変換していた語が正しい表記で出力されること**
9. 設定でサーバーを無効化 → `curl http://127.0.0.1:7878/mcp` が接続拒否になること
10. トークン無しでリクエスト → 401 が返ること

### 静的チェック

リポジトリルートで実行する（turbo 経由）。

```bash
pnpm type:check
pnpm lint
pnpm format:check
```

---

## 8. 既知の罠まとめ

着手前にここだけでも読むこと。

1. **`approveProposal` は `vocabulary` の unique 制約
   `(scope_type, scope_id, word)` を考慮すること。** 既存語は update、新規は insert。
   必ず `src/db/vocabulary.ts` の既存関数を経由する（クラウド同期が自動で付く）
2. **Layer はモジュール定数（class static を含む）でなければならない。**
   Layer のメモ化は参照同一性で行われる（`src/main/runtime/layers.ts` 冒頭の規約）
3. **`Effect.acquireRelease` を layer 内で使わない。** `addRelease` を使う
   （理由は `src/main/runtime/layer-helpers.ts` の doc コメント）
4. **`routeTree.gen.ts` は自動生成。手で編集しない**
5. **i18n キーは5ロケール全部に追加する**
6. **`CURRENT_SETTINGS_VERSION` は bump しない**（任意セクションのため）
7. **`updateSettingsSection` は深いマージをしない。** 完全なセクションを渡す
8. **`EADDRINUSE` でアプリを落とさない**
9. **マイグレーション SQL を手書きしない。** `pnpm db:generate` を使う
10. **`labs.selfCorrection` は無関係な既存機能。** 流用しない

---

## 9. 範囲外（別 PR で扱う）

- `apps/www/content/docs/custom-vocabulary.mdx` と `apps/www/content/docs/index.mdx` の
  "Custom Vocabulary ◯ Planned" は実装済みなので表記が誤っている。
  `README.md` の `🔌 MCP integration ◯` も本作業で部分的に ◑ になる
- `trackWordUsage()`（`src/db/vocabulary.ts:330`）は tRPC procedure 以外に呼び出し元が無く、
  `usageCount` が育たない。`src/utils/vocabulary-hints.ts` の TODO
  （「最新200件」ヒューリスティックを使用頻度ベースに改善する）と併せて別途対応する
