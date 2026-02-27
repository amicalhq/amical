# 設計: ターミナルアプリでの句読点欠落の修正

## 背景

Issue #88 の修正（言語別デフォルトプロンプト）はブラウザ等では正常に動作するが、
iTerm2 等のターミナルアプリでは句読点が出力されない。

## 原因

`whisper-provider.ts` の `generateInitialPrompt()` の優先順位:

1. `aggregatedTranscription`（前回の文字起こし）
2. `preSelectionText`（カーソル前のテキスト）← ターミナルではここが問題
3. 言語別デフォルトプロンプト（Issue #88 修正）

ターミナルアプリの場合、アクセシビリティ API が画面内容（英語コマンド、ANSI エスケープシーケンス、
null 文字等）を `preSelectionText` として返す。このテキストが句読点を含まないため、
Whisper がそのスタイルに合わせて句読点なしで出力する。

## アプローチ

`generateInitialPrompt()` 内でターミナルアプリを判定し、`preSelectionText` をスキップする。
これにより言語別デフォルトプロンプトにフォールバックし、句読点が正しく出力される。

## 変更箇所

- `apps/desktop/src/pipeline/providers/transcription/whisper-prompt-utils.ts`
  - `isTerminalApp(bundleId)` 関数を追加
  - 対象: iTerm2, Terminal.app, Alacritty, Kitty, Warp, WezTerm, Hyper, Windows Terminal, VS Code Terminal 等

- `apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts`
  - `generateInitialPrompt()` で `isTerminalApp()` を使い、ターミナルの場合 `preSelectionText` をスキップ

## ターミナル判定対象

```typescript
const TERMINAL_BUNDLE_IDS = [
  "com.googlecode.iterm2",
  "com.apple.Terminal",
  "io.alacritty",
  "net.kovidgoyal.kitty",
  "dev.warp.Warp-Stable",
  "com.github.wez.wezterm",
  "co.zeit.hyper",
];
```

注: VS Code (`com.microsoft.VSCode`) はエディタ部分もあるため除外。
ターミナル embedded のアプリは将来的に `windowInfo` 等で判定精度を上げる余地がある。

## リスク

- 低: ターミナルの `preSelectionText` は Whisper の初期プロンプトとして有用でない
  （コマンド、パス、ログ等の内容のため）
- `aggregatedTranscription`（優先度1）は引き続き使用されるため、
  2回目以降の発話では前回の句読点付きテキストが引き継がれる
