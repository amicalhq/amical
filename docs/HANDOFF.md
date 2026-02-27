# 引き継ぎ書（HANDOFF）

最終更新: 2026-02-27

---

## 現在の状態

- **ブランチ**: `main`
- **バージョン**: v1.0.1
- **ステータス**: 開発環境構築完了、Issue #88 修正済み + ターミナル句読点修正済み（未プッシュ）

---

## 直近の作業内容

### 完了
- フォーク元（amicalhq/amical）からフォーク
- プロジェクト構造・技術仕様の調査
- docs/ 配下のドキュメント整備
  - `docs/rules/LOCAL.md` - プロジェクト固有ルールの記入
  - `docs/SPECIFICATIONS.md` - 技術仕様書の作成
  - `docs/HANDOFF.md` - 本ファイルの作成
- 開発環境のセットアップ
  - Volta による Node 24 + pnpm 10.15.0 のピン留め
  - cmake インストール（Homebrew）
  - whisper.cpp サブモジュール初期化
  - `GGML_NATIVE=OFF pnpm install` でネイティブビルド完了
  - `pnpm download-node` で Whisper ワーカー用 Node バイナリ取得
- Issue #88: 日本語句読点の修正
  - 設計書: `docs/plans/2026-02-27-japanese-punctuation-design.md`
  - 実装計画: `docs/plans/2026-02-27-japanese-punctuation-plan.md`
  - 実装: 言語別デフォルトプロンプト (`whisper-prompt-utils.ts`)
  - コミット: `de0b75e`, `ae0e67a`（ローカルのみ、未プッシュ）
  - 動作確認済み
- ターミナルアプリ（iTerm2等）での句読点欠落の修正
  - 設計書: `docs/plans/2026-02-27-terminal-punctuation-design.md`
  - 実装計画: `docs/plans/2026-02-27-terminal-punctuation-plan.md`
  - 実装: `isTerminalApp()` によるターミナル判定、`preSelectionText` スキップ
  - dev モード + DMG パッケージ版で動作確認済み

### 未着手
- upstream への PR 作成またはプッシュ
- カスタムプロンプト機能の設計・実装（Issue #90 準拠）

---

## 既知の課題・注意点

- フォーク元の upstream との同期方針は未決定
- `pnpm-workspace.yaml` で `apps/www` が除外されている（`!apps/www`）
- Node.js >= 24 が必要（通常環境より高いバージョン要件）
- ネイティブビルド（whisper-wrapper）にはプラットフォーム固有の依存がある
- Apple Silicon では `GGML_NATIVE=OFF pnpm install` が必要（SVE テストがハングするため）
- 開発モードで Whisper を使うには `pnpm download-node` の実行が必須
- DMG ビルドには `SKIP_CODESIGNING=true` が必要（Apple Developer 証明書なしの場合）
- マイクロフォン権限の付与には自己署名証明書での署名が必要（手順は `docs/SPECIFICATIONS.md` §9 参照）

---

## 次のアクション

1. Issue #88 の変更をプッシュ / PR 作成
2. 追加したい機能の要件定義
3. feature ブランチの作成と開発開始
