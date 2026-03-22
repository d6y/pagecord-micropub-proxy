import type {
  CreatePostParams,
  IPagecordClient,
  PagecordAttachment,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Real client — calls the live Pagecord API
// ---------------------------------------------------------------------------

export class PagecordClient implements IPagecordClient {
  constructor(
    /** Base URL for the Pagecord API, e.g. https://api.pagecord.com */
    private readonly apiBase: string,
    private readonly apiKey: string,
  ) {}

  async createPost(params: CreatePostParams): Promise<string> {
    const body = new URLSearchParams();
    if (params.title) body.set("title", params.title);
    body.set("content", params.content);
    body.set("content_format", params.content_format);
    body.set("status", params.status);
    if (params.slug) body.set("slug", params.slug);
    if (params.published_at) body.set("published_at", params.published_at);
    if (params.tags) body.set("tags", params.tags);

    const response = await fetch(`${this.apiBase}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pagecord API error ${response.status}: ${text}`);
    }

    // Prefer Location header (standard REST 201 Created behaviour).
    const location = response.headers.get("Location");
    if (location) return location;

    // Fallback: parse JSON body for a URL field.
    try {
      const data = await response.json() as Record<string, unknown>;
      if (typeof data.url === "string") return data.url;
    } catch {
      // ignore parse failure
    }

    return `${this.apiBase}/posts`;
  }

  async uploadAttachment(blob: Blob, filename: string): Promise<PagecordAttachment> {
    const form = new FormData();
    form.append("file", blob, filename);

    const response = await fetch(`${this.apiBase}/attachments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Pagecord attachment error ${response.status}: ${text}`);
    }

    return response.json() as Promise<PagecordAttachment>;
  }
}

// ---------------------------------------------------------------------------
// Mock client — logs calls for local development / testing
// ---------------------------------------------------------------------------

export class MockPagecordClient implements IPagecordClient {
  constructor(
    private readonly log: (msg: string) => void = console.log,
  ) {}

  async createPost(params: CreatePostParams): Promise<string> {
    this.log("[MOCK] POST /posts");
    this.log(JSON.stringify(params, null, 2));
    return "https://example.pagecord.com/posts/mock-post-" + Date.now();
  }

  async uploadAttachment(blob: Blob, filename: string): Promise<PagecordAttachment> {
    this.log(`[MOCK] POST /attachments  filename=${filename}  size=${blob.size} bytes`);
    const sgid = "mock-sgid-" + Date.now();
    return {
      attachable_sgid: sgid,
      url: `https://example.pagecord.com/attachments/${filename}`,
    };
  }
}
