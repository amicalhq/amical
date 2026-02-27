# 設計: 日本語句読点の自動挿入 (Issue #88)

## 背景

日本語で音声入力すると句読点（。、）が出力されない。
Whisper は `initial_prompt` に含まれるテキストのスタイルに出力を合わせる性質があるため、
句読点を含むデフォルトプロンプトを設定することで解決する。

## 原因

`whisper-provider.ts` の `generateInitialPrompt()` が空文字を返す場合（初回発話時など）、
Whisper が句読点なしで出力する傾向がある。

## アプローチ

**言語別デフォルトプロンプト**を追加する。

`generateInitialPrompt()` が空文字を返すケース（aggregatedTranscription も accessibilityContext もない場合）に、
言語に応じた句読点入りの短いテキストをフォールバックとして返す。

## 変更箇所

- `apps/desktop/src/pipeline/providers/transcription/whisper-provider.ts`
  - `generateInitialPrompt()` に `language` 引数を追加
  - 空文字フォールバック時に言語別デフォルトプロンプトを返す
  - `doTranscription()` で `language` を `generateInitialPrompt()` に渡す

## デフォルトプロンプト

```typescript
const languageDefaultPrompts: Record<string, string> = {
  ja: "当店の自慢は、時間をかけて仕込んだビーフカレーです。",
  zh: "你好，今天天气不错。",
  ko: "안녕하세요. 오늘 날씨가 좋네요.",
};
```

## リスク

- 低: 空プロンプト時のフォールバックのみ変更。既存の aggregatedTranscription/accessibilityContext 優先ロジックは変わらない。
- 2回目以降の発話は前回のトランスクリプション（句読点付き）が initial_prompt に入るため、自然に句読点が維持される。
