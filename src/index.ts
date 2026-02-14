import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MEMU_BASE_URL = "https://api.memu.so";
const AGENT_ID = "claude-code";

function getConfig() {
  const apiKey = process.env.MEMU_API_KEY;
  const userId = process.env.MEMU_USER_ID;
  if (!apiKey) throw new Error("MEMU_API_KEY が設定されていません");
  if (!userId) throw new Error("MEMU_USER_ID が設定されていません");
  return { apiKey, userId };
}

async function memuFetch(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
) {
  const { apiKey } = getConfig();
  const method = options.method ?? "POST";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const fetchOptions: RequestInit = { method, headers };

  if (method !== "GET" && options.body) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${MEMU_BASE_URL}${path}`, fetchOptions);

  if (!res.ok) {
    const text = await res.text();
    switch (res.status) {
      case 401:
        throw new Error("認証エラー: API キーが無効です");
      case 422:
        throw new Error(`バリデーションエラー: ${text}`);
      case 429:
        throw new Error("レート制限に達しました。しばらく待ってから再試行してください");
      default:
        throw new Error(`MemU API エラー (${res.status}): ${text}`);
    }
  }

  return res.json();
}

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]).describe("発話者のロール"),
  content: z.string().describe("メッセージ内容"),
  name: z.string().optional().describe("表示名"),
  created_at: z.string().optional().describe("ISO 8601 タイムスタンプ"),
});

const server = new McpServer({
  name: "memu-v3",
  version: "2.0.0",
});

// memu_memorize: 会話を記憶として保存
server.tool(
  "memu_memorize",
  "会話を長期記憶として保存する。ユーザーとの会話から重要な情報（人物像、好み、経験、プロジェクト履歴など）を抽出して記憶する。最低3メッセージの会話形式で渡す。",
  {
    conversation: z
      .array(MessageSchema)
      .min(3)
      .describe(
        "会話メッセージの配列（最低3メッセージ）。例: [{role:'user',content:'...'},{role:'assistant',content:'...'},{role:'user',content:'...'}]"
      ),
    session_date: z
      .string()
      .optional()
      .describe("セッション日時（ISO 8601）。省略時は現在時刻"),
  },
  async ({ conversation, session_date }) => {
    const { userId } = getConfig();

    const result = await memuFetch("/api/v3/memory/memorize", {
      body: {
        conversation,
        user_id: userId,
        agent_id: AGENT_ID,
        agent_name: "Claude Code",
        session_date: session_date ?? new Date().toISOString(),
      },
    });

    return {
      content: [
        {
          type: "text" as const,
          text: result.task_id
            ? `記憶の保存を開始しました（task_id: ${result.task_id}, status: ${result.status ?? "PENDING"}）`
            : `結果: ${JSON.stringify(result)}`,
        },
      ],
    };
  }
);

// memu_memorize_status: 記憶保存タスクの状態確認
server.tool(
  "memu_memorize_status",
  "memorize タスクの進行状況を確認する。PENDING → PROCESSING → SUCCESS/FAILED の順に遷移する。",
  {
    task_id: z.string().describe("memorize で返された task_id"),
  },
  async ({ task_id }) => {
    const result = await memuFetch(
      `/api/v3/memory/memorize/status/${encodeURIComponent(task_id)}`,
      { method: "GET" }
    );

    const status = result.status ?? "UNKNOWN";
    const parts = [`ステータス: **${status}**`];
    if (result.created_at) parts.push(`開始: ${result.created_at}`);
    if (result.completed_at) parts.push(`完了: ${result.completed_at}`);

    return {
      content: [{ type: "text" as const, text: parts.join("\n") }],
    };
  }
);

// memu_retrieve: 記憶を検索
server.tool(
  "memu_retrieve",
  "ユーザーに関する過去の記憶をセマンティック検索する。テキストクエリまたは会話メッセージ配列で検索可能。会話配列を渡すとクエリが自動書き換えされ、より的確な検索結果が得られる。",
  {
    query: z
      .union([
        z.string().describe("検索クエリ（テキスト）"),
        z
          .array(MessageSchema)
          .describe("会話メッセージ配列（クエリ自動書き換え）"),
      ])
      .describe("検索クエリ（テキストまたは会話メッセージ配列）"),
  },
  async ({ query }) => {
    const { userId } = getConfig();

    const result = await memuFetch("/api/v3/memory/retrieve", {
      body: {
        user_id: userId,
        agent_id: AGENT_ID,
        query,
      },
    });

    const parts: string[] = [];

    if (result.rewritten_query) {
      parts.push(`> 書き換えクエリ: ${result.rewritten_query}`);
    }

    if (result.categories?.length) {
      parts.push("## カテゴリ");
      for (const cat of result.categories) {
        parts.push(`### ${cat.name}`);
        if (cat.description) parts.push(cat.description);
        if (cat.summary) parts.push(cat.summary);
      }
    }

    if (result.items?.length) {
      parts.push("\n## 記憶アイテム");
      for (const item of result.items) {
        const tag = item.memory_type ? `[${item.memory_type}]` : "";
        parts.push(`- ${tag} ${item.content}`);
      }
    }

    if (result.resources?.length) {
      parts.push("\n## リソース");
      for (const res of result.resources) {
        const label = res.caption ?? res.modality ?? "resource";
        parts.push(`- [${label}](${res.resource_url}): ${res.content ?? ""}`);
      }
    }

    const text =
      parts.length > 0
        ? parts.join("\n")
        : "関連する記憶は見つかりませんでした。";

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

// memu_categories: カテゴリ一覧取得
server.tool(
  "memu_categories",
  "保存されている記憶のカテゴリ一覧を取得する。各カテゴリにはサマリーが含まれ、蓄積された記憶の全体像を把握できる。",
  {},
  async () => {
    const { userId } = getConfig();

    const result = await memuFetch("/api/v3/memory/categories", {
      body: {
        user_id: userId,
        agent_id: AGENT_ID,
      },
    });

    if (!result.categories?.length) {
      return {
        content: [
          { type: "text" as const, text: "まだカテゴリがありません。" },
        ],
      };
    }

    const lines = result.categories.map(
      (cat: { name: string; description?: string; summary?: string }) => {
        const desc = cat.description ? `: ${cat.description}` : "";
        const summary = cat.summary ? `\n  ${cat.summary}` : "";
        return `- **${cat.name}**${desc}${summary}`;
      }
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `## 記憶カテゴリ一覧\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// memu_delete: 記憶の削除
server.tool(
  "memu_delete",
  "ユーザーの記憶を削除する。agent_id を指定するとそのエージェントの記憶のみ削除。省略するとユーザーの全記憶を削除する。破壊的操作のため、必ずユーザーの確認を取ってから実行すること。",
  {
    agent_id: z
      .string()
      .optional()
      .describe(
        "削除対象のエージェントID。省略するとユーザーの全記憶を削除"
      ),
  },
  async ({ agent_id }) => {
    const { userId } = getConfig();
    const body: Record<string, unknown> = { user_id: userId };
    if (agent_id) body.agent_id = agent_id;

    const result = await memuFetch("/api/v3/memory/delete", { body });

    return {
      content: [
        {
          type: "text" as const,
          text:
            typeof result === "string"
              ? result
              : `記憶を削除しました: ${JSON.stringify(result)}`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP サーバー起動エラー:", err);
  process.exit(1);
});
