# チケット: 誤変換 → Claude(MCP) 判定 → カスタム辞書 承認付き登録

設計指示書: [`mcp-vocabulary-correction.md`](./mcp-vocabulary-correction.md)
**着手前に設計指示書を最後まで読むこと。** 特に「2.1 既存カスタム辞書の仕組み」と
「8. 既知の罠まとめ」は必読。

作業ディレクトリ: `apps/desktop`（特記ない限り）

---

## 進め方

上から順に潰す。各タスクの受入条件を満たしてから次へ進むこと。
ステップ 2 → 3 → 4 は依存関係があるので順序を入れ替えないこと。

---

## Phase 1: 土台

### - [x] 1. 依存追加

- [x] `apps/desktop/package.json` の `dependencies` に `@modelcontextprotocol/sdk` を追加
- [x] `pnpm install` を実行

**受入条件**

- `pnpm install` が成功する
- express / fastify / hono などの HTTP フレームワークを追加して**いない**
- `pnpm-lock.yaml` の差分が `@modelcontextprotocol/sdk` とその依存のみ

---

### - [x] 2. `vocabulary_proposals` テーブル追加

- [x] `src/db/schema.ts` に `vocabularyProposals` を定義（設計指示書 4章ステップ2 の定義をそのまま使う）
- [x] 同ファイル末尾に `VocabularyProposal` / `NewVocabularyProposal` 型をエクスポート
- [x] `pnpm db:generate` でマイグレーション生成
- [x] 生成された `0017_*.sql` の中身を目視確認

**受入条件**

- autoincrement 整数 PK である（cuid2 複合 PK では**ない**）
- `transcriptionId` に外部キー制約が**張られていない**
- `vocabulary_proposals_status_idx` インデックスがある
- `src/db/migrations/0017_*.sql` と `meta/0017_snapshot.json`、`meta/_journal.json` が生成されている
- SQL を手書きして**いない**

---

### - [x] 3. DB サービス `src/db/vocabulary-proposals.ts`

- [x] `createProposal` / `listProposals` / `countPendingProposals` / `getProposalById`
      / `findPendingProposal` / `rejectProposal` / `approveProposal` を実装

**受入条件**

- `src/db/vocabulary.ts` と同じスタイル（`db` を `"."` から import した素の async 関数群）
- `recordLocalSyncMutation` および `./sync` 系の import が**含まれていない**
- `approveProposal` が `getVocabularyByWord` で既存行を確認し、
  **user スコープの既存行があれば `updateVocabulary`、無ければ `createVocabularyWord`** に分岐する
- `approveProposal` が `vocabulary` テーブルに**直接 insert していない**
- `approveProposal` が承認済み提案に `vocabularyId` と `decidedAt` を記録する
- 既に `pending` でない提案の承認／却下がエラーになる

> ⚠️ ここが本チケット最大の事故ポイント。`vocabulary` には unique 制約
> `(scope_type, scope_id, word)` があり、素朴な insert は制約違反で落ちる。

---

## Phase 2: MCP サーバー

### - [x] 4. `src/services/mcp-server-service.ts`

- [x] `src/services/history-cleanup-service.ts` を**テンプレートとして写す**
- [x] `node:http` で `127.0.0.1` にバインド、パス `/mcp`
- [x] `McpServer` + `StreamableHTTPServerTransport`（`sessionIdGenerator: undefined`）
- [x] Bearer トークン検証（不一致・欠落は 401）
- [x] `enableDnsRebindingProtection: true` + `allowedHosts`
- [x] 設定変更イベントを購読して start / stop / 再バインド
- [x] `EADDRINUSE` を握って落ちないようにする

**受入条件**

- `private constructor` + `static readonly Live` + `Layer.effect` の形になっている
- teardown が `addRelease` で登録されている（`Effect.acquireRelease` を使って**いない**）
- 初期化が `step()` でラップされ、最後に `up()` を呼んでいる
- `0.0.0.0` や `::` にバインドして**いない**
- `console.log` を使わず `logger.main.*` を使っている
- ポート使用中でもアプリが起動し、サービスが例外を投げない

---

### - [x] 5. MCP ツールとプロンプトの実装

- [x] `list_recent_dictations`（`limit?` 1-100 既定20, `sinceHours?`, `search?`）
- [x] `get_dictation`（`id`）
- [x] `list_vocabulary`（`search?`, `limit?`）
- [x] `propose_vocabulary_entry`（`word`, `replacementWord?`, `rationale`,
      `transcriptionId?`, `contextSnippet?`）
- [x] `list_vocabulary_proposals`（`status?`）
- [x] MCP prompt `review_dictations_for_misrecognitions`
- [x] サーバーの `instructions` を設定

**受入条件**

- **辞書へ直接書き込むツールが公開されていない**（提案のみ）
- **誤変換検出のヒューリスティック（信頼度閾値・未知語判定など）が
  アプリのコードに実装されていない**（判定は Claude 側）
- `propose_vocabulary_entry` が重複時に `{ duplicateOf }` を返し、新規作成しない
- すべて既存の DB 関数を再利用している（新しいクエリを書き起こしていない）

---

### - [x] 6. レイヤーグラフへの登録

- [x] `src/main/runtime/tags.ts` に `McpServerServiceTag` を追加
- [x] 同ファイルの `AppServices` 合併型にも追加
- [x] `src/main/runtime/layers.ts` の中段 `Layer.mergeAll`（`HistoryCleanupService.Live` の並び）に追加

**受入条件**

- Layer がモジュール定数（class static）になっている
- `ServiceMap`（`src/main/managers/service-manager.ts`）には追加して**いない**
  （ライフサイクル専用サービスのため。`HistoryCleanupService` と同じ扱い）
- アプリが正常に起動し、ログに `[layers] mcpServerService up` が出る

---

## Phase 3: 設定と UI

### - [x] 7. 設定セクション `mcpServer`

- [x] `src/db/schema.ts` の `AppSettingsData` に任意セクション追加
- [x] `src/db/app-settings.ts` の `DEFAULT_SETTINGS` に既定値
      （`enabled: false`, `port: 7878`, `token: ""`）
- [x] `src/services/settings-service.ts` に `McpServerSettings` 型と getter / setter
- [x] setter から `mcp-settings-changed` イベントを発火
- [x] `src/trpc/routers/settings.ts` に zod スキーマと procedure、トークン再生成 mutation

**受入条件**

- `CURRENT_SETTINGS_VERSION`（現在 15）を bump して**いない**
- 設定マイグレーション（`src/db/settings-migrations/v16.ts`）を追加して**いない**
- 既定で `enabled: false`
- `updateSettingsSection` に完全なセクションを渡している（部分オブジェクトでない）

---

### - [x] 8. tRPC 提案用 procedure

- [x] `src/trpc/routers/vocabulary.ts` に `listProposals` / `getPendingProposalCount`
      / `approveProposal` / `rejectProposal` を追加

**受入条件**

- 新しいルーターファイルを作って**いない**（既存の `vocabularyRouter` を拡張）
- `id` の入力スキーマが `z.number().int()`（`SettingsSyncIdSchema` では**ない**）
- `src/trpc/router.ts` の変更が不要であること

---

### - [x] 9. 承認キュー UI

- [x] `src/renderer/main/pages/settings/vocabulary/index.tsx` に「提案」カードを追加
- [x] pending 件数バッジ、`word → replacementWord`、`rationale`、`contextSnippet` を表示
- [x] 承認 / 却下ボタン

**受入条件**

- 承認後に辞書一覧と提案一覧の両方が invalidate される
- 既存ページの作法に従っている（`api.vocabulary.*.useQuery` /
  `useMutation({ onSuccess, onError })` + `sonner` の `toast`）
- 文字列がハードコードされていない

---

### - [x] 10. MCP 設定ページ

- [x] `src/renderer/main/pages/settings/mcp/index.tsx`（`pages/settings/labs/index.tsx` を写す）
- [x] `src/renderer/main/routes/_app/settings/mcp.tsx`
- [x] `src/renderer/main/lib/settings-navigation.ts` の `SETTINGS_NAV_ITEMS` にエントリ追加
- [x] 有効化トグル / ポート / トークン再生成 / 稼働状態 / 接続コマンドのコピーボタン

**受入条件**

- `routeTree.gen.ts` を手で編集して**いない**（自動生成に任せる）
- コピーされるコマンドが実際に動く形式:
  `claude mcp add --transport http amical http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`

---

### - [x] 11. i18n

- [x] `src/i18n/locales/en.json`
- [x] `src/i18n/locales/ja.json`
- [x] `src/i18n/locales/es.json`
- [x] `src/i18n/locales/de.json`
- [x] `src/i18n/locales/zh-TW.json`

**受入条件**

- **5ファイル全部**に同じキー構造で追加されている（1つでも欠けるとキー名が露出する）

---

## Phase 4: 検証

### - [x] 12. テスト

- [x] `tests/db/vocabulary-proposals.test.ts`
  - [x] 提案の作成
  - [x] `findPendingProposal` による重複検出
  - [x] 却下で `status` / `decidedAt` が更新される
  - [x] **承認時、既存 `word` があれば update・無ければ insert に分岐する**（unique 制約の回帰）
  - [x] 承認行に `vocabularyId` が入る
- [x] `tests/services/mcp-server-service.test.ts`
  - [x] 各ツールの入出力スキーマ
  - [x] トークン無し / 不正トークンが 401
  - [x] `propose_vocabulary_entry` が pending 行を作り `vocabulary` には書かない
  - [x] `EADDRINUSE` でサービスが生存する

**受入条件**

- `tests/helpers/test-db.ts` の `createTestDatabase()` を使っている
- `cd apps/desktop && pnpm test` が全部通る

---

### - [ ] 13. 手動 E2E

- [ ] `pnpm dev` でアプリ起動
- [ ] 設定 > MCP で有効化、接続コマンドをコピー
- [ ] `claude mcp add ...` を実行
- [ ] `claude` を起動し `/mcp` でツールが見える
- [ ] Claude に誤変換探索を依頼 → ツールが呼ばれる
- [ ] 設定 > カスタム辞書 に提案が pending で出る
- [ ] 承認 → 辞書一覧に入る
- [ ] **実際にディクテーションして、誤変換していた語が正しい表記で出力される**
- [ ] サーバー無効化 → `curl http://127.0.0.1:7878/mcp` が接続拒否
- [ ] トークン無しリクエスト → 401

---

### - [x] 14. 静的チェック

リポジトリルートで実行する。

- [x] `pnpm type:check`（クリーン）
- [x] `pnpm lint`（下記の注記を参照）
- [x] `pnpm format:check`（下記の注記を参照）

> **注記:** `apps/desktop` 単体の `eslint --ext .ts,.tsx .` は 0 エラー（既存の警告
> 282件のみ、新規ファイルに警告なし）。リポジトリルートの `pnpm lint` /
> `pnpm format:check` は turbo のタスク依存により、本チケットと無関係な
> 既存9ファイル（`src/db/migrations/meta/0006_snapshot.json` 等、mainブランチの
> 時点で既に未フォーマット）が原因で失敗する。本チケットで触れたファイルは
> すべて prettier 準拠。

---

## 完了の定義

- [x] Phase 1、2、3、4(タスク12・14) のチェックが埋まっている。タスク13（手動E2E）は
      実機での対話操作が要るため未実施のまま残す
- [x] `src/pipeline/` / `src/services/transcription*` / `src/main/lifecycle/` に**差分が無い**
- [x] `applyTextReplacements` / `selectVocabularyHints` / `buildWhisperPrompt` に**差分が無い**
- [x] `routeTree.gen.ts` の差分が自動生成によるものだけである
