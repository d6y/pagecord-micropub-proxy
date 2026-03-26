import type { CreatePostParams, PagecordAttachment, PagecordClient } from "./types.ts";

// ---------------------------------------------------------------------------
// Real client — calls the live Pagecord API
// ---------------------------------------------------------------------------

export function makePagecordClient(apiBase: string, apiKey: string): PagecordClient {
  const authHeader = { Authorization: `Bearer ${apiKey}` };

  return {
    async createPost(params: CreatePostParams): Promise<string> {
      const body = new URLSearchParams(
        Object.entries(params).filter((e): e is [string, string] => e[1] != null),
      );

      const response = await fetch(`${apiBase}/posts`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Pagecord API error ${response.status}: ${await response.text()}`);
      }

      const location = response.headers.get("Location");
      if (location) return location;

      try {
        const data = await response.json() as Record<string, unknown>;
        if (typeof data.url === "string") return data.url;
      } catch {
        // ignore parse failure
      }

      return `${apiBase}/posts`;
    },

    async uploadAttachment(blob: Blob, filename: string): Promise<PagecordAttachment> {
      const form = new FormData();
      form.append("file", blob, filename);

      const response = await fetch(`${apiBase}/attachments`, {
        method: "POST",
        headers: authHeader,
        body: form,
      });

      if (!response.ok) {
        throw new Error(`Pagecord attachment error ${response.status}: ${await response.text()}`);
      }

      return response.json() as Promise<PagecordAttachment>;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock client — logs calls for local development
// ---------------------------------------------------------------------------

export function makeMockPagecordClient(
  log: (msg: string) => void = console.log,
): PagecordClient {
  return {
    async createPost(params: CreatePostParams): Promise<string> {
      log("[MOCK] POST /posts");
      log(JSON.stringify(params, null, 2));
      return "https://example.pagecord.com/posts/mock-post-" + Date.now();
    },

    async uploadAttachment(blob: Blob, filename: string): Promise<PagecordAttachment> {
      log(`[MOCK] POST /attachments  filename=${filename}  size=${blob.size} bytes`);
      return {
        attachable_sgid: "mock-sgid-" + Date.now(),
        url: `https://example.pagecord.com/attachments/${filename}`,
      };
    },
  };
}
