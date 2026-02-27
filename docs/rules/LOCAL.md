# 開発ルール（LOCAL）

このファイルは、本プロジェクト固有の開発ルール・補足事項を定義する。
共通ルールは `docs/rules/CORE.md` を参照し、本ファイルは **例外・追加・具体化のみ** を扱う。

※ CORE.md と矛盾する内容を書いてはならない。

---

## 1. プロジェクト概要（前提条件）

- プロジェクト種別：Electronデスクトップアプリ + Next.js Webサイト（モノレポ）
- 主な目的：ローカルファーストのAI音声入力（ディクテーション）＆ノートアプリ
- 想定ユーザー：公開（MIT ライセンス、OSS）
- フォーク元：[amicalhq/amical](https://github.com/amicalhq/amical)（本リポジトリはフォークであり、独自機能追加を行う）

---

## 2. プロジェクト固有の制約・方針

CORE.md では一般化できない、このプロジェクト特有の前提を書く。

- 対象OS：macOS (arm64 / x64), Windows (x64)
- ランタイム：Node.js >= 24, Electron 38, pnpm 10.15
- ビルドシステム：Turborepo + Vite 7 + Electron Forge
- パフォーマンス制約：
  - 音声処理はリアルタイム性が求められる（VAD + Whisper推論）
  - ネイティブバインディング（whisper.cpp, ONNX Runtime）に依存
- セキュリティ・権限周りの注意点：
  - マイクアクセス権限が必須（macOS: Accessibility API も利用）
  - OAuth2 認証（`amical://` カスタムプロトコル）
  - Keytar によるクレデンシャル安全保管
  - プライバシーファースト設計（ローカル処理優先）
- テスト：Vitest 4（Node環境、シーケンシャル実行）
- データベース：SQLite (LibSQL) + Drizzle ORM

---

## 3. プロジェクト固有の Definition of Done（DoD）

CORE.md の共通DoDに **追加で満たすべき条件** を定義する。

### 追加DoD
- [ ] `pnpm type:check` がエラーなく通ること
- [ ] `pnpm lint` がエラーなく通ること
- [ ] `pnpm test` が通ること（該当テストがある場合）
- [ ] macOS でのビルド・起動が確認できること

※ CORE.md の DoD を緩めてはいけない。

