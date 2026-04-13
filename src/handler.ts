import type { CreatePostParams, PagecordClient, ParsedPhoto } from "./types.ts";
import { parseMicropubRequest } from "./micropub.ts";

export interface HandlerConfig {
  /** Bearer token that Micropub clients must supply. */
  micropubToken: string;
  pagecord: PagecordClient;
  /** Base URL of this proxy, used to advertise the media endpoint. */
  proxyUrl: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function handleRequest(
  request: Request,
  config: HandlerConfig,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (!url.searchParams.has("q")) {
      const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="micropub" href="${config.proxyUrl}/">
</head>
<body></body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }
    return handleQuery(url, config.proxyUrl);
  }

  const authError = checkAuth(request, config.micropubToken);
  if (authError) return authError;

  if (request.method === "POST") {
    if (url.pathname === "/media") {
      return handleMediaUpload(request, config.pagecord);
    }
    return handlePost(request, config.pagecord);
  }

  return jsonError(405, "Method not allowed");
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function checkAuth(request: Request, expected: string): Response | null {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return jsonError(401, "Missing Authorization header");
  if (auth.slice(7).trim() !== expected) return jsonError(401, "Invalid token");
  return null;
}

// ---------------------------------------------------------------------------
// GET — Micropub queries
// ---------------------------------------------------------------------------

function handleQuery(url: URL, proxyUrl: string): Response {
  const q = url.searchParams.get("q");

  if (q === "config") {
    return Response.json({
      "media-endpoint": `${proxyUrl}/media`,
      "post-types": [
        { type: "note", name: "Note" },
        { type: "article", name: "Article" },
      ],
    });
  }

  if (q === "syndicate-to") {
    return Response.json({ "syndicate-to": [] });
  }

  return jsonError(400, `Unsupported query: ${q}`);
}

// ---------------------------------------------------------------------------
// POST / — create (or action)
// ---------------------------------------------------------------------------

async function handlePost(
  request: Request,
  pagecord: PagecordClient,
): Promise<Response> {
  const action = await detectAction(request.clone());

  if (action === "delete") return jsonError(501, "delete action is not yet implemented");
  if (action === "update") return jsonError(501, "update action is not yet implemented");

  const clonedForLogging = request.clone();
  const rawBody = await clonedForLogging.text();
  console.log("[micropub] raw body:", rawBody);
  const entry = await parseMicropubRequest(request);
  if (!entry) {
    return jsonError(400, "Could not parse micropub request or unsupported post type (only h-entry is supported)");
  }
  console.log("[micropub] parsed entry:", JSON.stringify(entry, null, 2));

  try {
    const attachments = await Promise.all(entry.photos.map((p) => resolveAndUpload(p, pagecord)));
    const attachmentTags = attachments.map(
      (a) => `<action-text-attachment sgid="${a.attachable_sgid}"></action-text-attachment>`,
    );

    const content = attachmentTags.length > 0
      ? `${entry.content}\n\n${attachmentTags.join("\n")}`
      : entry.content;

    const params: CreatePostParams = {
      title: entry.title,
      content,
      content_format: entry.contentFormat,
      status: entry.status,
      slug: entry.slug,
      published_at: entry.publishedAt,
      tags: entry.tags.length > 0 ? entry.tags.join(",") : undefined,
    };

    const postUrl = await pagecord.createPost(params);
    return new Response(null, { status: 201, headers: { Location: postUrl } });
  } catch (err) {
    return jsonError(502, `Pagecord API error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// POST /media — media endpoint
// ---------------------------------------------------------------------------

async function handleMediaUpload(
  request: Request,
  pagecord: PagecordClient,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonError(400, "Media uploads must be multipart/form-data");
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, 'Missing "file" field in form data');
  }

  try {
    const attachment = await pagecord.uploadAttachment(file, file.name || "upload");
    return new Response(null, { status: 201, headers: { Location: attachment.url } });
  } catch (err) {
    return jsonError(502, `Pagecord attachment error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function detectAction(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    return (await request.formData()).get("action") as string | null;
  }
  if (contentType.includes("application/json")) {
    const body = await request.json() as Record<string, unknown>;
    return (body.action as string) ?? null;
  }
  return null;
}

async function resolveAndUpload(
  photo: ParsedPhoto,
  pagecord: PagecordClient,
): Promise<{ attachable_sgid: string; url: string }> {
  if (photo.blob) {
    return pagecord.uploadAttachment(photo.blob, photo.filename);
  }

  if (photo.url) {
    const response = await fetch(photo.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch photo ${photo.url}: ${response.status}`);
    }
    return pagecord.uploadAttachment(await response.blob(), photo.filename);
  }

  throw new Error("ParsedPhoto has neither blob nor url");
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
