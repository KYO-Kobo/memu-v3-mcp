# memu-v3-mcp

[MemU V3](https://memu.so) API と連携する Claude Code 用 MCP サーバー。

セッションをまたいでユーザーの人物像・好み・経験・プロジェクト履歴を記憶・検索できる。

## ツール

| ツール | 説明 |
|--------|------|
| `memu_memorize` | 会話を長期記憶として保存（最低3メッセージ） |
| `memu_memorize_status` | 記憶保存タスクの進行状況を確認 |
| `memu_retrieve` | セマンティック検索で関連記憶を取得 |
| `memu_categories` | 記憶カテゴリ一覧を取得 |
| `memu_delete` | ユーザーまたはエージェントの記憶を削除 |

## セットアップ

### 1. APIキーの取得

https://app.memu.so/api-key からAPIキーを取得し、シェルプロファイルに設定:

```bash
export MEMU_API_KEY="your_api_key_here"
```

### 2. インストール

```bash
git clone https://github.com/KYO-Kobo/memu-v3-mcp.git
cd memu-v3-mcp
npm install
```

### 3. Claude Code に登録

```bash
claude mcp add --scope user --transport stdio memu-v3 \
  -e MEMU_API_KEY='${MEMU_API_KEY}' \
  -e MEMU_USER_ID='your_user_id' \
  -- npx tsx /path/to/memu-v3-mcp/src/index.ts
```

### 4. 動作確認

Claude Code を起動して `/mcp` で `memu-v3` が認識されていることを確認。

## API 対応表

| ツール | エンドポイント | メソッド |
|--------|---------------|----------|
| `memu_memorize` | `/api/v3/memory/memorize` | POST |
| `memu_memorize_status` | `/api/v3/memory/memorize/status/{task_id}` | GET |
| `memu_retrieve` | `/api/v3/memory/retrieve` | POST |
| `memu_categories` | `/api/v3/memory/categories` | POST |
| `memu_delete` | `/api/v3/memory/delete` | POST |

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `MEMU_API_KEY` | Yes | MemU V3 の APIキー |
| `MEMU_USER_ID` | Yes | ユーザー識別子 |

## 技術スタック

- TypeScript + Node.js
- `@modelcontextprotocol/sdk` — MCP サーバー SDK
- MemU V3 REST API (`https://api.memu.so`)

## ライセンス

MIT
