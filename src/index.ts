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

async function memuFetch(path: string, body: Record<string, unknown>) {
  const { apiKey } = getConfig();
  const res = await fetch(`${MEMU_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MemU API エラー (${res.status}): ${text}`);
  }

  return res.json();
}

const server = new McpServer({
  name: "memu-v3",
  version: "1.0.0",
});

// memu_memorize: 会話・情報を記憶として保存
server.tool(
  "memu_memorize",
  "ユーザーに関する重要な情報を長期記憶として保存する。人物像、好み、経験、プロジェクト履歴など、次のセッションでも知っておくべき情報を保存する。",
  {
    content: z
      .string()
      .describe("保存する内容（ユーザーについて学んだこと）"),
    role: z
      .enum(["user", "assistant"])
      .default("user")
      .describe("発話者のロール"),
  },
  async ({ content, role }) => {
    const { userId } = getConfig();
    const now = new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d+Z$/, "");

    const result = await memuFetch("/api/v3/memory/memorize", {
      conversation: [
        {
          role,
          content: { text: content },
          created_at: now,
        },
      ],
      user_id: userId,
      agent_id: AGENT_ID,
    });

    const taskId = result.task_id;
    return {
      content: [
        {
          type: "text" as const,
          text: taskId
            ? `記憶の保存を開始しました（task_id: ${taskId}）。非同期で処理されます。`
            : `記憶を保存しました: ${JSON.stringify(result)}`,
        },
      ],
    };
  }
);

// memu_retrieve: クエリで関連記憶を検索
server.tool(
  "memu_retrieve",
  "ユーザーに関する過去の記憶を検索する。ユーザーの好み、経験、プロジェクト履歴などを思い出すために使う。",
  {
    query: z.string().describe("検索クエリ（自然言語）"),
  },
  async ({ query }) => {
    const { userId } = getConfig();

    const result = await memuFetch("/api/v3/memory/retrieve", {
      user_id: userId,
      agent_id: AGENT_ID,
      query,
    });

    const parts: string[] = [];

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
        parts.push(`- ${tag} ${item.summary}`);
      }
    }

    if (result.next_step_query) {
      parts.push(`\n## 追加検索の提案\n${result.next_step_query}`);
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

// memu_categories: カテゴリ一覧を取得
server.tool(
  "memu_categories",
  "MemU に保存されている記憶のカテゴリ一覧を取得する。どんな種類の記憶が蓄積されているかを確認するために使う。",
  {},
  async () => {
    const { userId } = getConfig();

    const result = await memuFetch("/api/v3/memory/categories", {
      user_id: userId,
      agent_id: AGENT_ID,
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP サーバー起動エラー:", err);
  process.exit(1);
});
