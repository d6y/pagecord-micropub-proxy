import type { CreatePostParams, IPagecordClient, ParsedPhoto } from "./types.ts";
import { parseMicropubRequest } from "./micropub.ts";

export interface HandlerConfig {
  /** Bearer token that Micropub clients must supply. */
  micropubToken: string;
  pagecord: IPagecordClient;
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

  // GET / (no query): unauthenticated discovery. Return HTML with IndieAuth
  // link relations so Micropub clients (iA Writer) can confirm this is a valid
  // endpoint before the user has supplied a token.
  // GET /?q=…: authenticated Micropub queries.
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

  // POST requests require authentication.
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
  if (!auth.startsWith("Bearer ")) {
    return jsonError(401, "Missing Authorization header");
  }
  const token = auth.slice(7).trim();
  if (token !== expected) {
    return jsonError(401, "Invalid token");
  }
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
  pagecord: IPagecordClient,
): Promise<Response> {
  // Check for action parameter (update / delete) before trying to parse as entry.
  const contentType = request.headers.get("content-type") ?? "";
  const cloned = request.clone();

  let action: string | null = null;
  let url: string | null = null;

  if (contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")) {
    const form = await cloned.formData();
    action = form.get("action") as string | null;
    url = form.get("url") as string | null;
  } else if (contentType.includes("application/json")) {
    const body = await cloned.json() as Record<string, unknown>;
    action = (body.action as string) ?? null;
    url = (body.url as string) ?? null;
  }

  if (action === "delete") {
    return jsonError(501, "delete action is not yet implemented");
  }

  if (action === "update") {
    return jsonError(501, "update action is not yet implemented");
  }

  // Default: create
  const entry = await parseMicropubRequest(request);
  if (!entry) {
    return jsonError(400, "Could not parse micropub request or unsupported post type (only h-entry is supported)");
  }

  // Upload photos and collect Action Text attachment tags.
  const attachmentTags: string[] = [];
  for (const photo of entry.photos) {
    const attachment = await resolveAndUpload(photo, pagecord);
    attachmentTags.push(
      `<action-text-attachment sgid="${attachment.attachable_sgid}"></action-text-attachment>`,
    );
  }

  let content = entry.content;
  if (attachmentTags.length > 0) {
    content = `${content}\n\n${attachmentTags.join("\n")}`;
  }

  const params: CreatePostParams = {
    title: entry.title,
    content,
    content_format: entry.contentFormat,
    status: entry.status,
    slug: entry.slug,
    published_at: entry.publishedAt,
    tags: entry.tags.length > 0 ? entry.tags.join(",") : undefined,
  };

  try {
    const postUrl = await pagecord.createPost(params);
    return new Response(null, {
      status: 201,
      headers: { Location: postUrl },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Pagecord API error: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// POST /media — media endpoint
// ---------------------------------------------------------------------------

async function handleMediaUpload(
  request: Request,
  pagecord: IPagecordClient,
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
    return new Response(null, {
      status: 201,
      headers: { Location: attachment.url },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(502, `Pagecord attachment error: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * If a photo arrived as a URL (e.g. from a previous media-endpoint upload),
 * fetch the bytes so we can re-upload to Pagecord's attachments API.
 * If it arrived as a blob, use it directly.
 */
async function resolveAndUpload(
  photo: ParsedPhoto,
  pagecord: IPagecordClient,
): Promise<{ attachable_sgid: string; url: string }> {
  if (photo.blob) {
    return pagecord.uploadAttachment(photo.blob, photo.filename);
  }

  if (photo.url) {
    const response = await fetch(photo.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch photo ${photo.url}: ${response.status}`);
    }
    const blob = await response.blob();
    return pagecord.uploadAttachment(blob, photo.filename);
  }

  throw new Error("ParsedPhoto has neither blob nor url");
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
