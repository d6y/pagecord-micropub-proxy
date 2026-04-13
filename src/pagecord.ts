import type { CreatePostParams, PagecordAttachment, PagecordClient } from "./types.ts";

// ---------------------------------------------------------------------------
// Real client — calls the live Pagecord API
// ---------------------------------------------------------------------------

export function makePagecordClient(apiBase: string, apiKey: string): PagecordClient {
  const authHeader = { Authorization: `Bearer ${apiKey}` };

  return {
    async createPost(params: CreatePostParams): Promise<string> {
      const body = Object.fromEntries(
        Object.entries(params).filter(([, v]) => v != null),
      );

      console.log(`[pagecord] POST ${apiBase}/posts`, JSON.stringify(body));

      const response = await fetch(`${apiBase}/posts`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      console.log(`[pagecord] ${response.status}`, responseText);

      if (!response.ok) {
        throw new Error(`Pagecord API error ${response.status}: ${responseText}`);
      }

      return "https://pagecord.com/app/posts";
    },

    async uploadAttachment(blob: Blob, filename: string): Promise<PagecordAttachment> {
      const form = new FormData();
      form.append("file", blob, filename);

      console.log(`[pagecord] POST ${apiBase}/attachments  filename=${filename}  size=${blob.size} bytes`);

      const response = await fetch(`${apiBase}/attachments`, {
        method: "POST",
        headers: authHeader,
        body: form,
      });

      const responseText = await response.text();
      console.log(`[pagecord] ${response.status}`, responseText);

      if (!response.ok) {
        throw new Error(`Pagecord attachment error ${response.status}: ${responseText}`);
      }

      return JSON.parse(responseText) as PagecordAttachment;
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
