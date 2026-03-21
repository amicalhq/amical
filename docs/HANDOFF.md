# 引き継ぎ書（HANDOFF）

最終更新: 2026-03-21

---

## 現在の状態

- **ブランチ**: `feat/microphone-priority-list`（`main` から派生）
- **バージョン**: v1.0.4（upstream v1.0.4 を取り込み済み）
- **ステータス**: マイク優先度リスト機能を実装中、動作確認済み

---

## 直近の作業内容

### 完了（2026-03-21）
- upstream（amicalhq/amical）v1.0.4 までの変更を main に取り込み済み
  - `git remote add upstream https://github.com/amicalhq/amical.git` 設定済み
  - merge 済み、origin/main に push 済み
- Escape キー録音キャンセル機能（main にコミット・push 済み）
  - `recording-manager.ts`: `TerminationCode` に `"cancelled"` 追加、`cancelRecording()` メソッド追加
  - `shortcut-manager.ts`: Escape キー検出ロジック追加（ハードコード、修飾キー併用時は無視）
  - 既存の `handleFinalChunk()` の破棄パス（`code && code !== "dismissed"`）で自動処理
  - コミット: `83e6a6b`
- マイク優先度リスト機能（`feat/microphone-priority-list` ブランチ）
  - `db/schema.ts`: `microphonePriorityList?: string[]` 追加
  - `trpc/routers/settings.ts`: `setMicrophonePriorityList` ミューテーション追加
  - `hooks/useAudioCapture.ts`: 優先度リストから接続中デバイスを順に選択するロジック
    - **重要**: ウィジェットウィンドウとメインウィンドウ間の tRPC キャッシュ不整合を回避するため、`utils.settings.getSettings.fetch()` で録音開始時に毎回最新設定を取得
  - `MicrophoneSettings.tsx`: `@dnd-kit` によるドラッグ＆ドロップ並べ替え UI
  - `OnboardingMicrophoneSelect.tsx`: 優先度リスト API に移行（Select UI は維持）
  - `en.json` / `ja.json`: 新ラベル追加
  - コミット: `b74a470`
- no_audio / empty_transcript ウィジェット通知の非表示化
  - `recording-manager.ts`: `widget-notification` emit を削除、ログのみ残す
  - 動作（no_audio 時の自動キャンセル等）はそのまま維持
  - コミット: `39aba13`
- 文字起こし結果のクリップボードコピー機能
  - `db/schema.ts`: `preferences` に `copyToClipboard?: boolean` 追加
  - `services/settings-service.ts`: `AppPreferences` に `copyToClipboard` 追加（デフォルト: false）
  - `trpc/routers/settings.ts`: Zod スキーマに追加
  - `recording-manager.ts`: `pasteTranscription` 内で Electron `clipboard.writeText()` を呼び出し
  - `preferences/index.tsx`: ON/OFF トグル UI 追加
  - `en.json` / `ja.json`: ラベル追加

### 以前の完了分
- フォーク元（amicalhq/amical）からフォーク
- プロジェクト構造・技術仕様の調査
- docs/ 配下のドキュメント整備
- 開発環境のセットアップ
  - Volta による Node 24 + pnpm 10.15.0 のピン留め
  - cmake インストール（Homebrew）
  - whisper.cpp サブモジュール初期化
  - `GGML_NATIVE=OFF pnpm install` でネイティブビルド完了
  - `pnpm download-node` で Whisper ワーカー用 Node バイナリ取得
- Issue #88: 日本語句読点の修正（main にコミット・push 済み）
- ターミナルアプリ（iTerm2等）での句読点欠落の修正（main にコミット・push 済み）

### WIP（未完成）
- カスタムシステムプロンプト機能（`wip/custom-system-prompt` ブランチに退避）
  - UI・i18n・サービス層の変更あり、型エラーが残っている
  - フォーマット機能が有効でないと UI 表示の確認ができない

### 未着手
- upstream への PR 作成（Issue #88 修正、Escape キャンセル、マイク優先度リスト等）
- カスタムプロンプト機能の完成

---

## ブランチ構成

| ブランチ | 状態 | 内容 |
|---------|------|------|
| `main` | push 済み | upstream v1.0.4 + Issue #88 + Escape キャンセル |
| `feat/microphone-priority-list` | ローカルのみ | マイク優先度リスト + 通知非表示 |
| `wip/custom-system-prompt` | ローカルのみ | カスタムシステムプロンプト（WIP、型エラーあり） |

---

## 既知の課題・注意点

- `pnpm-workspace.yaml` で `apps/www` が除外されている（`!apps/www`）
- Node.js >= 24 が必要（通常環境より高いバージョン要件）
- ネイティブビルド（whisper-wrapper）にはプラットフォーム固有の依存がある
- Apple Silicon では `GGML_NATIVE=OFF pnpm install` が必要（SVE テストがハングするため）
- 開発モードで Whisper を使うには `pnpm download-node` の実行が必須
- DMG ビルドには `SKIP_CODESIGNING=true` が必要（Apple Developer 証明書なしの場合）
- マイクロフォン権限の付与には自己署名証明書での署名が必要（手順は `docs/SPECIFICATIONS.md` §9 参照）
- `tests/services/transcriptions.test.ts` が既存バグ（`ServiceManager.createInstance is not a function`）で全件失敗する
- `useAudioCapture` はウィジェットウィンドウで動作するため、メインウィンドウの設定変更を反映するには tRPC キャッシュのバイパスが必要

---

## 次のアクション

1. `feat/microphone-priority-list` の最終動作確認 → main にマージ → push
2. upstream への PR 作成
3. カスタムプロンプト機能の再開（`wip/custom-system-prompt`）
