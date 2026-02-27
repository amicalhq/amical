# CORE ルール（唯一の正は devkit 側）

このリポジトリの共通ルール（CORE）の **唯一の正** は、ローカルの devkit にあります。

- 正本: `~/development/devkit/docs/rules/CORE.md`

このリポジトリでは、環境依存のシンボリックリンクは壊れやすく、AI コーディングエージェントがリンク先探索に時間を要するため、
**本ファイルは案内専用** としています（ルール本文は devkit 側のみを更新してください）。

## 参照方法（macOS）

```sh
# 表示（ターミナル）
cat "$HOME/development/devkit/docs/rules/CORE.md"

# Finder で場所を開く
open -R "$HOME/development/devkit/docs/rules/CORE.md"
```

## 補足

- `~` はシェル展開のため、シンボリックリンク先に `~/...` の形で保存しても期待通りに動きません（作成時に実体パスへ展開されます）。
