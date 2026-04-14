import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleRequest, type HandlerConfig } from "./handler.ts";
import type { CreatePostParams, PagecordAttachment, PagecordClient } from "./types.ts";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMockClient() {
  const calls = {
    lastPost: null as CreatePostParams | null,
    lastAttachmentBlob: null as Blob | null,
    lastAttachmentFilename: null as string | null,
  };
  const postUrl = "https://example.pagecord.com/posts/123";
  const attachment: PagecordAttachment = {
    attachable_sgid: "sgid-abc",
    url: "https://cdn.example.com/photo.jpg",
  };

  const client: PagecordClient = {
    createPost: async (params) => { calls.lastPost = params; return postUrl; },
    uploadAttachment: async (blob, filename) => {
      calls.lastAttachmentBlob = blob;
      calls.lastAttachmentFilename = filename;
      return attachment;
    },
  };

  return { client, calls, postUrl, attachment };
}

function makeConfig(overrides?: Partial<HandlerConfig>): HandlerConfig {
  return {
    micropubToken: "secret",
    proxyUrl: "https://micropub.example.com",
    pagecord: makeMockClient().client,
    ...overrides,
  };
}

function authed(init?: RequestInit): RequestInit {
  return {
    ...init,
    headers: { Authorization: "Bearer secret", ...(init?.headers as Record<string, string>) },
  };
}

// ---------------------------------------------------------------------------
// GET / — discovery
// ---------------------------------------------------------------------------

Deno.test("GET / returns discovery HTML with micropub link", async () => {
  const res = await handleRequest(new Request("https://micropub.example.com/"), makeConfig());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html");
  assertStringIncludes(await res.text(), 'rel="micropub"');
});

Deno.test("GET / does not require authentication", async () => {
  const res = await handleRequest(new Request("https://micropub.example.com/"), makeConfig());
  assertEquals(res.status, 200);
});

// ---------------------------------------------------------------------------
// GET /?q= — queries
// ---------------------------------------------------------------------------

Deno.test("GET /?q=config returns media-endpoint and post-types", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/?q=config"),
    makeConfig(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body["media-endpoint"], "https://micropub.example.com/media");
  assertEquals(Array.isArray(body["post-types"]), true);
});

Deno.test("GET /?q=syndicate-to returns empty array", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/?q=syndicate-to"),
    makeConfig(),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json())["syndicate-to"], []);
});

Deno.test("GET /?q=unknown returns 400", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/?q=unknown"),
    makeConfig(),
  );
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

Deno.test("POST without Authorization header returns 401", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/", { method: "POST" }),
    makeConfig(),
  );
  assertEquals(res.status, 401);
});

Deno.test("POST with wrong token returns 401", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    }),
    makeConfig(),
  );
  assertEquals(res.status, 401);
});

// ---------------------------------------------------------------------------
// POST / — unsupported actions
// ---------------------------------------------------------------------------

Deno.test("POST with action=delete returns 501", async () => {
  const body = new URLSearchParams({ action: "delete", url: "https://example.com/post/1" });
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    }),
    makeConfig(),
  );
  assertEquals(res.status, 501);
});

Deno.test("POST with action=update returns 501", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", url: "https://example.com/post/1" }),
      }),
    }),
    makeConfig(),
  );
  assertEquals(res.status, 501);
});

// ---------------------------------------------------------------------------
// POST / — create post
// ---------------------------------------------------------------------------

Deno.test("POST JSON h-entry creates post and returns 201 with Location", async () => {
  const { client, calls, postUrl } = makeMockClient();

  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: ["h-entry"],
          properties: {
            name: ["My Post"],
            content: ["Hello world"],
            "post-status": ["published"],
            category: ["tag1", "tag2"],
            "mp-slug": ["my-post"],
          },
        }),
      }),
    }),
    makeConfig({ pagecord: client }),
  );

  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Location"), postUrl);
  assertEquals(calls.lastPost?.title, "My Post");
  assertEquals(calls.lastPost?.content, "Hello world");
  assertEquals(calls.lastPost?.status, "published");
  assertEquals(calls.lastPost?.tags, "tag1,tag2");
  assertEquals(calls.lastPost?.slug, "my-post");
});

Deno.test("POST form-encoded h-entry creates post and returns 201", async () => {
  const { client, calls } = makeMockClient();
  const body = new URLSearchParams({ h: "entry", content: "A note", "post-status": "published" });
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }),
    }),
    makeConfig({ pagecord: client }),
  );
  assertEquals(res.status, 201);
  assertEquals(calls.lastPost?.content, "A note");
});

Deno.test("POST unparseable body returns 400", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not micropub",
      }),
    }),
    makeConfig(),
  );
  assertEquals(res.status, 400);
});

Deno.test("POST with photo uploads attachment and embeds tag in content", async () => {
  const { client, calls } = makeMockClient();
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "Look at this");
  form.set("photo", new File(["img"], "shot.jpg", { type: "image/jpeg" }));

  const res = await handleRequest(
    new Request("https://micropub.example.com/", { ...authed({ method: "POST", body: form }) }),
    makeConfig({ pagecord: client }),
  );

  assertEquals(res.status, 201);
  assertStringIncludes(calls.lastPost?.content ?? "", "sgid-abc");
  assertStringIncludes(calls.lastPost?.content ?? "", "action-text-attachment");
  assertEquals(calls.lastAttachmentFilename, "shot.jpg");
});

Deno.test("POST Pagecord API error returns 502", async () => {
  const failingClient: PagecordClient = {
    createPost: () => Promise.reject(new Error("upstream down")),
    uploadAttachment: () => Promise.reject(new Error("upstream down")),
  };
  const res = await handleRequest(
    new Request("https://micropub.example.com/", {
      ...authed({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: ["h-entry"], properties: { content: ["x"] } }),
      }),
    }),
    makeConfig({ pagecord: failingClient }),
  );
  assertEquals(res.status, 502);
});

// ---------------------------------------------------------------------------
// POST /media — media endpoint
// ---------------------------------------------------------------------------

Deno.test("POST /media with valid file returns 201 with Location", async () => {
  const { client, calls, attachment } = makeMockClient();
  const form = new FormData();
  form.set("file", new File(["bytes"], "photo.jpg", { type: "image/jpeg" }));

  const res = await handleRequest(
    new Request("https://micropub.example.com/media", { ...authed({ method: "POST", body: form }) }),
    makeConfig({ pagecord: client }),
  );

  assertEquals(res.status, 201);
  assertEquals(res.headers.get("Location"), `${attachment.url}#sgid=${encodeURIComponent(attachment.attachable_sgid)}`);
  assertEquals(calls.lastAttachmentFilename, "photo.jpg");
});

Deno.test("POST /media without multipart returns 400", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/media", {
      ...authed({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    }),
    makeConfig(),
  );
  assertEquals(res.status, 400);
});

Deno.test("POST /media without file field returns 400", async () => {
  const form = new FormData();
  form.set("notfile", "oops");
  const res = await handleRequest(
    new Request("https://micropub.example.com/media", { ...authed({ method: "POST", body: form }) }),
    makeConfig(),
  );
  assertEquals(res.status, 400);
});

// ---------------------------------------------------------------------------
// Unsupported method
// ---------------------------------------------------------------------------

Deno.test("PUT returns 405", async () => {
  const res = await handleRequest(
    new Request("https://micropub.example.com/", { ...authed({ method: "PUT" }) }),
    makeConfig(),
  );
  assertEquals(res.status, 405);
});
