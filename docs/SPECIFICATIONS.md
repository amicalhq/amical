# 技術仕様書（SPECIFICATIONS）

本ドキュメントは Amical プロジェクトの技術仕様・アーキテクチャを定義する。

---

## 1. プロジェクト構成

### モノレポ構造

```
amical/
├── apps/
│   ├── desktop/          # Electronデスクトップアプリ（メインプロダクト）
│   └── www/              # Next.js 15 ドキュメント/マーケティングサイト
├── packages/
│   ├── types/            # 共有型定義 + Zodスキーマ
│   ├── ui/               # React UIコンポーネントライブラリ
│   ├── y-libsql/         # Yjs永続化プロバイダー (LibSQL)
│   ├── whisper-wrapper/  # ネイティブWhisperバインディング (CMake.js + NAPI)
│   ├── eslint-config/    # 共有ESLint設定
│   ├── typescript-config/ # TypeScript基本設定
│   └── native-helpers/
│       ├── swift-helper/  # macOS Swift統合 (Accessibility API等)
│       └── windows-helper/ # Windows C#統合
├── docs/                 # ドキュメント
├── turbo.json            # Turborepo設定
├── pnpm-workspace.yaml   # pnpmワークスペース定義
└── package.json          # ルートpackage.json
```

### ビルドツールチェーン

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Turborepo | 2.5.3 | モノレポタスクランナー |
| pnpm | 10.15.0 | パッケージマネージャ |
| Node.js | >= 24 | ランタイム |
| TypeScript | 5.8 | 型チェック |
| Vite | 7.1 | バンドラー |
| Electron Forge | 7.8 | Electronパッケージング |

---

## 2. デスクトップアプリ（apps/desktop）

### 技術スタック

| 領域 | 技術 |
|------|------|
| フレームワーク | Electron 38 + React 19 |
| IPC通信 | tRPC (electron-trpc-experimental) |
| データベース | SQLite (LibSQL) + Drizzle ORM |
| 音声認識 | whisper.cpp (ネイティブアドオン) |
| 音声活動検出 | ONNX Runtime (Silero VAD) |
| 状態管理 | TanStack Query + tRPC |
| ルーティング | TanStack Router |
| UI | Tailwind CSS 4 + Radix UI + Shadcn |
| ノート | Yjs (CRDT) + y-libsql |
| 認証 | OAuth2 (amical:// カスタムプロトコル) |
| テレメトリ | PostHog |
| テスト | Vitest 4 |
| i18n | i18next |

### ソースコード構成

```
apps/desktop/src/
├── main/                    # Electronメインプロセス
│   ├── core/
│   │   ├── app-manager.ts   # アプリライフサイクル管理
│   │   ├── window-manager.ts # ウィンドウ管理
│   │   └── windows/          # ウィンドウ定義
│   ├── managers/
│   │   ├── service-manager.ts  # サービスDI・ライフサイクル
│   │   ├── recording-manager.ts # 録音パイプライン
│   │   ├── shortcut-manager.ts  # グローバルホットキー
│   │   └── tray-manager.ts      # システムトレイ
│   ├── services/
│   │   └── auto-updater.ts   # 自動アップデート
│   ├── preload.ts            # Preloadスクリプト (IPC公開)
│   └── logger.ts             # ロギング
├── renderer/                 # Reactレンダラープロセス
│   ├── main/                # メインUI
│   ├── widget/              # フローティングウィジェット
│   ├── notes-widget/        # ノートサイドバー
│   └── onboarding/          # セットアップウィザード
├── services/                 # ビジネスロジック
│   ├── transcription-service.ts # Whisper + フォーマット
│   ├── model-service.ts      # モデル管理・ダウンロード
│   ├── settings-service.ts   # 設定永続化
│   ├── auth-service.ts       # OAuth2認証
│   ├── notes-service.ts      # Yjsベースノート
│   ├── vad-service.ts        # 音声活動検出 (ONNX)
│   ├── telemetry-service.ts  # PostHogアナリティクス
│   ├── feature-flag-service.ts # フィーチャーフラグ
│   └── platform/             # プラットフォーム固有
├── db/                       # データベース層
│   ├── schema.ts             # Drizzleスキーマ
│   ├── index.ts              # DB初期化
│   ├── transcriptions.ts     # 文字起こしCRUD
│   ├── notes.ts              # ノートCRUD
│   ├── vocabulary.ts         # カスタム語彙
│   ├── app-settings.ts       # アプリ設定
│   └── migrations/           # Drizzleマイグレーション
├── pipeline/                 # 音声処理パイプライン
│   ├── core/
│   │   ├── pipeline-types.ts # プロバイダーインターフェース
│   │   └── context.ts        # パイプライン状態
│   └── utils/
│       ├── vad-audio-filter.ts # VADフィルター
│       └── segment-filter.ts   # セグメンテーション
├── trpc/                     # tRPCバックエンド
│   ├── router.ts             # メインルーター
│   ├── context.ts            # コンテキスト (ServiceManager)
│   └── routers/              # 11+サブルーター
├── components/               # Reactコンポーネント
├── hooks/                    # Reactフック
├── utils/                    # ユーティリティ
├── i18n/                     # 多言語対応
└── styles/                   # スタイル
```

### アーキテクチャパターン

#### ServiceManager パターン

シングルトンの `ServiceManager` がすべてのサービスのライフサイクルを管理する。

```
ServiceManager
├── PostHogClient           # アナリティクス
├── TelemetryService        # テレメトリ (→ PostHog)
├── FeatureFlagService      # フィーチャーフラグ (→ PostHog)
├── SettingsService         # 設定永続化
├── AuthService             # OAuth2認証
├── ModelService            # AIモデル管理
├── TranscriptionService    # 音声認識パイプライン
├── VADService              # 音声活動検出
├── NativeBridge            # プラットフォーム統合
├── RecordingManager        # 録音状態マシン
├── ShortcutManager         # グローバルホットキー
├── WindowManager           # ウィンドウ管理
├── OnboardingService       # 初回セットアップ
└── AutoUpdaterService      # 自動アップデート
```

#### tRPC over Electron IPC

メインプロセスとレンダラープロセス間の通信に `electron-trpc-experimental` を使用。

```
Renderer (React)
  ↕ tRPC Client (superjson)
  ↕ Electron IPC
  ↕ tRPC Server (ServiceManager context)
Main Process (Services)
```

サブルーター: transcriptions, notes, models, settings, recording, widget, auth, onboarding, feature-flags, vocabulary, updater

#### 音声処理パイプライン

```
マイク入力 → AudioContext (Web Audio API)
  → Float32Array チャンク
  → VAD Service (ONNX/Silero) - 音声区間検出
  → Segment Filter - セグメンテーション
  → Transcription Service
    ├─ Local Whisper (ネイティブ)
    ├─ OpenRouter API (クラウド)
    └─ Ollama (ローカルLLM)
  → Formatting Service (文法・文脈補正)
  → Vocabulary 置換
  → アクティブアプリへ出力
```

#### CRDT ベースノート

- **Yjs** で協調編集（オフラインファースト）
- **y-libsql** で LibSQL に永続化
- IPC 経由でメインプロセス ↔ レンダラー間の更新伝播

---

## 3. データベーススキーマ

SQLite (LibSQL) + Drizzle ORM を使用。

### テーブル一覧

#### transcriptions
| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER PK | 自動採番 |
| text | TEXT | 文字起こし内容 |
| timestamp | INTEGER | タイムスタンプ |
| language | TEXT | 言語 (ISO 639-1) |
| audioFile | TEXT | 音声ファイルパス |
| confidence | REAL | 信頼度 (0-1) |
| duration | REAL | 秒数 |
| speechModel | TEXT | 使用した音声モデル |
| formattingModel | TEXT | 使用したフォーマットモデル |
| meta | TEXT (JSON) | メタデータ |

#### vocabulary
| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER PK | 自動採番 |
| word | TEXT UNIQUE | 単語 |
| replacementWord | TEXT | 置換先 |
| isReplacement | INTEGER | 置換フラグ |
| usageCount | INTEGER | 使用回数 |

#### appSettings
| カラム | 型 | 説明 |
|--------|-----|------|
| id | INTEGER PK | 自動採番 |
| data | TEXT (JSON) | 設定データ (AppSettingsData型) |
| version | INTEGER | マイグレーションバージョン |

#### models
| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT UNIQUE | モデル識別子 |
| provider | TEXT | "local-whisper" / "openrouter" / "ollama" |
| name | TEXT | モデル名 |
| type | TEXT | "speech" / "language" / "embedding" |
| size | INTEGER | サイズ |

---

## 4. Webサイト（apps/www）

| 項目 | 技術 |
|------|------|
| フレームワーク | Next.js 15.3 |
| ドキュメント | Fumadocs |
| スタイリング | Tailwind CSS 4.1 |
| デプロイ | Cloudflare Workers |
| 出力形式 | 静的エクスポート |
| アナリティクス | Plausible |

---

## 5. ネイティブ統合

### macOS (Swift Helper)
- `@amical/swift-helper`
- Accessibility API を利用したシステム統合
- `swift build` で arm64 / x64 バイナリ生成

### Windows (C# Helper)
- `@amical/windows-helper`
- `dotnet publish` で自己完結型 x64 実行ファイル生成

### Whisper Wrapper
- `@amical/whisper-wrapper`
- whisper.cpp の NAPI バインディング (CMake.js)
- CUDA / Vulkan オプション対応

---

## 6. CI/CD

### CI (`ci.yml`)
- トリガー: PR, 手動
- 環境: macOS latest, Windows 2025
- ステップ: 型チェック → whisper-wrapper ビルド → パッケージング

### Release (`release.yml`)
- トリガー: タグ (v*), 手動
- ビルドマトリクス: macOS arm64, macOS x64, Windows x64
- コード署名 + 公証 (macOS)
- 成果物: DMG, ZIP, EXE, NUPKG

---

## 7. 環境変数

| 変数 | 用途 |
|------|------|
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | テレメトリ |
| `TELEMETRY_ENABLED` | テレメトリ有効化 |
| `AUTH_CLIENT_ID`, `AUTHORIZATION_ENDPOINT`, `AUTH_TOKEN_ENDPOINT`, `AUTH_REDIRECT_URI` | OAuth2認証 |
| `FEEDBACK_SURVEY_ID` | フィードバック |
| `API_ENDPOINT` | APIエンドポイント |
| `AWS_*`, `S3_*` | S3ストレージ |

---

## 8. 開発環境セットアップ

### 前提条件

| ツール | インストール方法 | 備考 |
|--------|-----------------|------|
| Volta | `curl https://get.volta.sh \| bash` | Node/pnpm バージョン管理 |
| Node.js 24 | `volta install node@24` | Volta でピン留め済み |
| pnpm 10.15 | `volta install pnpm@10.15.0` | Volta でピン留め済み |
| cmake | `brew install cmake` | whisper.cpp ネイティブビルドに必要 |

### 初回セットアップ

```bash
# 1. サブモジュール初期化
git submodule update --init --recursive

# 2. 依存インストール（Apple Silicon では GGML_NATIVE=OFF が必須）
GGML_NATIVE=OFF pnpm install

# 3. Whisper ワーカー用 Node バイナリ取得（開発モードで必須）
cd apps/desktop && pnpm download-node
```

> **注意:** Apple Silicon (M1/M2/M3/M4) では `GGML_NATIVE=OFF` を付けないと、
> CMake の SVE 機能テストがハングして `pnpm install` が完了しません。

### 開発コマンド

```bash
# 開発モードでアプリ起動
cd apps/desktop && pnpm start

# 品質チェック
pnpm type:check             # 型チェック（6 タスク）
pnpm lint                   # リント
pnpm test                   # テスト実行
pnpm test:watch             # テストウォッチ

# データベース
cd apps/desktop
pnpm db:generate            # マイグレーション生成
pnpm db:push                # DB反映
pnpm db:migrate             # マイグレーション実行
```

---

## 9. ローカルビルド・署名（macOS）

### DMG ビルド

Apple Developer Program 未登録の場合、コード署名をスキップしてビルドする。

```bash
cd apps/desktop
SKIP_CODESIGNING=true pnpm make:dmg:arm64   # Apple Silicon 用
SKIP_CODESIGNING=true pnpm make:dmg:x64     # Intel Mac 用
```

成果物: `apps/desktop/out/make/Amical-<version>-<arch>.dmg`

### 自己署名証明書の作成（初回のみ）

コード署名なし（ad-hoc 署名）のアプリでは、macOS の TCC がマイクロフォン権限の
付与ダイアログを表示しない。自己署名証明書で署名することで解決する。

**1. 証明書の作成**

キーチェーンアクセスを開き:
1. メニュー → 証明書アシスタント → 証明書を作成
2. 名前: `Amical Dev`
3. 証明書タイプ: `コード署名`
4. 作成後、証明書をダブルクリック → 信頼 → コード署名を「常に信頼」に変更

確認:
```bash
security find-identity -v -p codesigning
# "Amical Dev" が表示されれば OK
```

**2. アプリへの署名**

```bash
cd apps/desktop
codesign --deep --force -s "Amical Dev" out/Amical-darwin-arm64/Amical.app
```

**3. インストール**

```bash
# 既存アプリを削除してからコピー
rm -rf /Applications/Amical.app
cp -R out/Amical-darwin-arm64/Amical.app /Applications/Amical.app
```

**4. 権限のリセット（署名を変更した場合）**

署名が変わると TCC の権限エントリが無効になるため、リセットが必要。

```bash
tccutil reset Microphone com.amical.desktop
tccutil reset Accessibility com.amical.desktop
```

アプリを起動するとマイクロフォン・アクセシビリティの権限ダイアログが表示される。

### 権限の注意事項

| 権限 | 必須 | 備考 |
|------|------|------|
| マイクロフォン | 必須 | 音声入力に必要。自己署名が必要 |
| アクセシビリティ | 必須 | グローバルショートカット、テキスト入力に必要 |
| 入力監視 | 任意 | PTT キー検出に使用 |
