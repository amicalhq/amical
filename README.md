## Get Started

### Prerequisites

- Node.js >= 24
- pnpm 10.15.0
- CMake (`brew install cmake`)

### Setup

```bash
git clone --recursive https://github.com/kousaku-maron/amical.git
cd amical
pnpm install
```

`--recursive` により whisper.cpp のサブモジュールも取得される。既にクローン済みの場合は `git submodule update --init --recursive` を実行する。

### Build native modules (macOS)

```bash
pnpm turbo run build:native --filter=@amical/swift-helper --filter=@amical/whisper-wrapper
```

Swift ヘルパー（macOS アクセシビリティ）と whisper.cpp（音声認識）をビルドする。

### Download Node.js binary

```bash
cd apps/desktop && pnpm download-node
```

Whisper の文字起こしは Electron とは別の Node.js プロセスで実行される。このバイナリがないと文字起こしが動作しない。

### Run in development mode

```bash
pnpm dev
```

### Build DMG locally (unsigned)

```bash
cd apps/desktop
SKIP_CODESIGNING=true SKIP_NOTARIZATION=true pnpm make:dmg:arm64
```

インストール後、マイク権限を得るためにアドホック署名を行う:

```bash
codesign --force --deep --sign - "/Applications/Vox.app"
```

> **Note:** macOS Sequoia 以降では、未署名のアプリに対して マイク許可ダイアログが表示されない。マイクやカメラなどのプライバシー権限をテストする場合は、署名ありでビルドすること。

## Dev Build (GitHub Actions)

`vox-alpha` ブランチへの push、または手動実行（workflow_dispatch）で未署名の macOS arm64 DMG をビルドする。

1. GitHub リポジトリの **Actions** タブを開く
2. **Dev Build (Unsigned)** を選択して実行（または `vox-alpha` への push で自動実行）
3. 完了後、ワークフロー実行ページ下部の **Artifacts** から `vox-dev-macos-arm64` をダウンロード

### Install the downloaded DMG

ダウンロードした DMG を開いてアプリを `/Applications` にコピーした後、以下の 2 つのコマンドを実行する:

```bash
xattr -cr /Applications/Vox.app
codesign --force --deep --sign - "/Applications/Vox.app"
```

- `xattr -cr` — ダウンロード時に付与される macOS の検疫属性を除去する
- `codesign --force --deep --sign -` — アドホック署名を行い、マイク等のシステム権限を取得できるようにする

## License

Released under [MIT][license].

<!-- REFERENCE LINKS -->

[fork]: https://github.com/amicalhq/amical
