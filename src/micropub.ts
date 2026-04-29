import type { ContentFormat, ParsedEntry, ParsedPhoto, PostStatus } from "./types.ts";

/**
 * Parse an incoming Micropub POST request into a normalised entry.
 * Handles application/json, multipart/form-data, and
 * application/x-www-form-urlencoded bodies.
 *
 * Returns null if the body cannot be parsed or the post type is not h-entry.
 */
export async function parseMicropubRequest(
  request: Request,
): Promise<ParsedEntry | null> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return parseJsonEntry(await request.json());
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return parseFormEntry(await request.formData());
  }

  return null;
}

// ---------------------------------------------------------------------------
// Form / multipart parser (shared — FormData handles both encodings)
// ---------------------------------------------------------------------------

function parseFormEntry(form: FormData): ParsedEntry | null {
  const h = form.get("h");
  if (h !== "entry") return null;

  const photos: ParsedPhoto[] = [];

  for (const [key, value] of form.entries()) {
    if (isPhotoKey(key) && value instanceof File) {
      photos.push({ blob: value, filename: value.name || "photo.jpg" });
    }
    // Photo sent as a URL string (e.g. already uploaded via media endpoint)
    if (isPhotoKey(key) && typeof value === "string" && value.startsWith("http")) {
      photos.push({ url: value, filename: filenameFromUrl(value) });
    }
  }

  const rawStatus = getStr(form, "post-status") ?? getStr(form, "mp-post-status");
  const rawContent = getStr(form, "content") ?? "";
  const { title, content } = extractTitle(rawContent, "markdown");

  return {
    title,
    content,
    contentFormat: "markdown",
    status: toPostStatus(rawStatus),
    slug: getStr(form, "mp-slug") ?? getStr(form, "slug"),
    publishedAt: getStr(form, "published"),
    tags: [
      ...getStrs(form, "category"),
      ...getStrs(form, "category[]"),
    ],
    photos,
  };
}

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

function parseJsonEntry(body: unknown): ParsedEntry | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const type = b["type"];
  if (!Array.isArray(type) || !type.includes("h-entry")) return null;

  const props = (b["properties"] ?? {}) as Record<string, unknown[]>;

  // content can be a plain string or an object like { html: "..." } / { markdown: "..." }
  const rawContent = firstOf(props["content"]);
  let content = "";
  let contentFormat: ContentFormat = "markdown";

  if (typeof rawContent === "string") {
    content = rawContent;
  } else if (typeof rawContent === "object" && rawContent !== null) {
    const c = rawContent as Record<string, string>;
    if (c.html) {
      content = c.html;
      contentFormat = "html";
    } else if (c.markdown) {
      content = c.markdown;
    }
  }

  // Photos as URLs (files come through the media endpoint in the JSON flow)
  const photos: ParsedPhoto[] = [];
  for (const p of props["photo"] ?? []) {
    if (typeof p === "string" && p.startsWith("http")) {
      photos.push({ url: p, filename: filenameFromUrl(p) });
    } else if (typeof p === "object" && p !== null) {
      const po = p as Record<string, string>;
      if (po.value?.startsWith("http")) {
        photos.push({ url: po.value, filename: filenameFromUrl(po.value), alt: po.alt });
      }
    }
  }

  const rawStatus = firstOf(props["post-status"]) as string | undefined;
  const categoryTags = (props["category"] ?? []).filter((v): v is string => typeof v === "string");
  const { title, content: contentAfterTitle } = extractTitle(content, contentFormat);
  const { tags: hashTags, content: strippedContent } = extractHashtags(contentAfterTitle);
  const finalContent = transformCaptionedFigures(stripDuplicateCaptions(strippedContent));

  return {
    title,
    content: finalContent,
    contentFormat,
    status: toPostStatus(rawStatus),
    slug:
      (firstOf(props["mp-slug"]) as string | undefined) ??
      (firstOf(props["slug"]) as string | undefined),
    publishedAt: firstOf(props["published"]) as string | undefined,
    tags: categoryTags.length > 0 ? categoryTags : hashTags,
    photos,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStr(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" ? v : undefined;
}

function getStrs(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string");
}

function firstOf(arr: unknown[] | undefined): unknown {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

function isPhotoKey(key: string): boolean {
  return key === "photo" || key === "photo[]";
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractTitle(content: string, format: ContentFormat): { title: string | undefined; content: string } {
  if (format === "html") {
    const match = content.match(/^\s*<h[1-6]>([\s\S]*?)<\/h[1-6]>\s*/i);
    if (match) {
      const raw = match[1].replace(/<[^>]+>/g, "").trim();
      const title = raw ? decodeHtmlEntities(raw) : undefined;
      return { title, content: content.slice(match[0].length) };
    }
  } else {
    const match = content.match(/^#{1,6} (.+?)(?:\r?\n|$)/);
    if (match) {
      return { title: match[1].trim(), content: content.slice(match[0].length).trimStart() };
    }
  }
  return { title: undefined, content };
}

function extractHashtags(html: string): { tags: string[]; content: string } {
  const tags: string[] = [];
  const tagPattern = /<span class="hashtag">#(\w+)<\/span>/g;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    tags.push(match[1]);
  }
  // Remove <p> blocks that contain only hashtag spans (whitespace allowed)
  const content = html
    .replace(/<p>(\s*<span class="hashtag">#\w+<\/span>\s*)+<\/p>/g, "")
    .trim();
  return { tags, content };
}

function transformCaptionedFigures(html: string): string {
  return html.replace(/<figure>([\s\S]*?)<\/figure>/g, (match, inner) => {
    if (!/<figcaption>/.test(inner)) return match;

    const sgidMatch = inner.match(/src="[^"]*#sgid=([^"#]+)"/);
    const captionMatch = inner.match(/<figcaption>([\s\S]*?)<\/figcaption>/);

    if (sgidMatch && captionMatch) {
      const sgid = decodeURIComponent(sgidMatch[1]);
      const caption = captionMatch[1].trim().replace(/"/g, "&quot;");
      return `<action-text-attachment sgid="${sgid}" caption="${caption}"></action-text-attachment>`;
    }

    // Fallback for figures without a known sgid
    const transformed = inner
      .replace(/(<img\b[^>]*?)\s+alt="[^"]*"/g, "$1")
      .replace(/<figcaption>/g, `<figcaption class="attachment__caption">`);
    return `<figure class="attachment attachment--preview">${transformed}</figure>`;
  });
}

function stripDuplicateCaptions(html: string): string {
  const figcaptionPattern = /<figcaption>([\s\S]*?)<\/figcaption>/g;
  let result = html;
  let match;
  while ((match = figcaptionPattern.exec(html)) !== null) {
    const captionText = match[1].trim();
    if (captionText) {
      const escaped = captionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`<p>\\s*${escaped}\\s*<\\/p>`, "g"), "");
    }
  }
  return result.trim();
}

function toPostStatus(raw: string | undefined): PostStatus {
  return raw === "published" ? "published" : "draft";
}

function filenameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/");
    const last = parts[parts.length - 1];
    return last || "photo.jpg";
  } catch {
    return "photo.jpg";
  }
}
