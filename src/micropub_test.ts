import { assertEquals } from "@std/assert";
import { parseMicropubRequest } from "./micropub.ts";

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

Deno.test("JSON: parses basic h-entry with string content", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: ["Hello world"] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, "Hello world");
  assertEquals(entry?.contentFormat, "markdown");
});

Deno.test("JSON: parses content object with html key", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: "<p>Hello</p>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, "<p>Hello</p>");
  assertEquals(entry?.contentFormat, "html");
});

Deno.test("JSON: parses content object with markdown key", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ markdown: "**Hello**" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, "**Hello**");
  assertEquals(entry?.contentFormat, "markdown");
});

Deno.test("JSON: returns null for non-h-entry type", async () => {
  const req = jsonRequest({
    type: ["h-card"],
    properties: {},
  });
  assertEquals(await parseMicropubRequest(req), null);
});

Deno.test("JSON: returns null for missing type", async () => {
  const req = jsonRequest({ properties: {} });
  assertEquals(await parseMicropubRequest(req), null);
});

Deno.test("JSON: name property is not used as title", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { name: ["My Post"], content: ["body"] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, undefined);
});

Deno.test("JSON: parses published status", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { "post-status": ["published"], content: ["x"] },
  });
  assertEquals((await parseMicropubRequest(req))?.status, "published");
});

Deno.test("JSON: defaults to draft status", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: ["x"] },
  });
  assertEquals((await parseMicropubRequest(req))?.status, "draft");
});

Deno.test("JSON: parses mp-slug", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { "mp-slug": ["my-slug"], content: ["x"] },
  });
  assertEquals((await parseMicropubRequest(req))?.slug, "my-slug");
});

Deno.test("JSON: parses slug fallback", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { slug: ["alt-slug"], content: ["x"] },
  });
  assertEquals((await parseMicropubRequest(req))?.slug, "alt-slug");
});

Deno.test("JSON: parses categories into tags", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: ["x"], category: ["foo", "bar"] },
  });
  assertEquals((await parseMicropubRequest(req))?.tags, ["foo", "bar"]);
});

Deno.test("JSON: parses publishedAt", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: ["x"], published: ["2024-01-15T12:00:00Z"] },
  });
  assertEquals((await parseMicropubRequest(req))?.publishedAt, "2024-01-15T12:00:00Z");
});

Deno.test("JSON: parses photos as URL strings", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: {
      content: ["x"],
      photo: ["https://example.com/photo.jpg"],
    },
  });
  const photos = (await parseMicropubRequest(req))?.photos ?? [];
  assertEquals(photos.length, 1);
  assertEquals(photos[0].url, "https://example.com/photo.jpg");
  assertEquals(photos[0].filename, "photo.jpg");
});

Deno.test("JSON: parses photos as objects with value and alt", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: {
      content: ["x"],
      photo: [{ value: "https://example.com/img.png", alt: "A photo" }],
    },
  });
  const photos = (await parseMicropubRequest(req))?.photos ?? [];
  assertEquals(photos.length, 1);
  assertEquals(photos[0].url, "https://example.com/img.png");
  assertEquals(photos[0].alt, "A photo");
  assertEquals(photos[0].filename, "img.png");
});

Deno.test("JSON: ignores non-http photo strings", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: ["x"], photo: ["not-a-url"] },
  });
  assertEquals((await parseMicropubRequest(req))?.photos, []);
});

// ---------------------------------------------------------------------------
// Form / multipart parsing
// ---------------------------------------------------------------------------

Deno.test("form: parses basic h-entry", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "Hello from form");
  const req = formRequest(form);
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, "Hello from form");
  assertEquals(entry?.contentFormat, "markdown");
});

Deno.test("form: returns null when h != entry", async () => {
  const form = new FormData();
  form.set("h", "card");
  form.set("content", "x");
  assertEquals(await parseMicropubRequest(formRequest(form)), null);
});

Deno.test("form: returns null when h is missing", async () => {
  const form = new FormData();
  form.set("content", "x");
  assertEquals(await parseMicropubRequest(formRequest(form)), null);
});

Deno.test("form: name property is not used as title", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("name", "Post Title");
  form.set("content", "body");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.title, undefined);
});

Deno.test("form: parses post-status published", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.set("post-status", "published");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.status, "published");
});

Deno.test("form: defaults to draft when post-status absent", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.status, "draft");
});

Deno.test("form: parses mp-slug", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.set("mp-slug", "my-slug");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.slug, "my-slug");
});

Deno.test("form: parses category values into tags", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.append("category", "foo");
  form.append("category", "bar");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.tags, ["foo", "bar"]);
});

Deno.test("form: parses category[] values into tags", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.append("category[]", "baz");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.tags, ["baz"]);
});

Deno.test("form: combines category and category[] tags", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.append("category", "a");
  form.append("category[]", "b");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.tags, ["a", "b"]);
});

Deno.test("form: parses photo URL string", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.set("photo", "https://example.com/photo.jpg");
  const photos = (await parseMicropubRequest(formRequest(form)))?.photos ?? [];
  assertEquals(photos.length, 1);
  assertEquals(photos[0].url, "https://example.com/photo.jpg");
  assertEquals(photos[0].filename, "photo.jpg");
});

Deno.test("form: parses photo[] URL string", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.set("photo[]", "https://example.com/img.png");
  const photos = (await parseMicropubRequest(formRequest(form)))?.photos ?? [];
  assertEquals(photos.length, 1);
  assertEquals(photos[0].url, "https://example.com/img.png");
});

Deno.test("form: parses File as blob photo", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  const file = new File(["bytes"], "shot.jpg", { type: "image/jpeg" });
  form.set("photo", file);
  const photos = (await parseMicropubRequest(formRequest(form)))?.photos ?? [];
  assertEquals(photos.length, 1);
  assertEquals(photos[0].blob instanceof Blob, true);
  assertEquals(photos[0].filename, "shot.jpg");
});

Deno.test("form: ignores non-http photo strings", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "x");
  form.set("photo", "not-a-url");
  assertEquals((await parseMicropubRequest(formRequest(form)))?.photos, []);
});

// ---------------------------------------------------------------------------
// Hashtag extraction
// ---------------------------------------------------------------------------

Deno.test("JSON: extracts single hashtag from content and strips paragraph", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: {
      content: [{ html: '<p>Hello world.</p>\n\n<p><span class="hashtag">#dogs</span></p>' }],
    },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.tags, ["dogs"]);
  assertEquals(entry?.content, "<p>Hello world.</p>");
});

Deno.test("JSON: extracts multiple hashtags from single paragraph", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: {
      content: [{ html: '<p>Body.</p>\n\n<p><span class="hashtag">#writing</span> <span class="hashtag">#software</span> <span class="hashtag">#dogs</span></p>' }],
    },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.tags, ["writing", "software", "dogs"]);
  assertEquals(entry?.content, "<p>Body.</p>");
});

Deno.test("JSON: category tags take precedence over hashtags", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: {
      content: [{ html: '<p>Body.</p>\n\n<p><span class="hashtag">#dogs</span></p>' }],
      category: ["explicit"],
    },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.tags, ["explicit"]);
});

// ---------------------------------------------------------------------------
// Caption deduplication
// ---------------------------------------------------------------------------

Deno.test("JSON: uses action-text-attachment when sgid present in img src", async () => {
  const sgid = "abc123sgid";
  const url = `https://pagecord.com/blob.jpg#sgid=${encodeURIComponent(sgid)}`;
  const html = `<figure>\n<img src="${url}" alt="A squirrel." />\n<figcaption>A squirrel.</figcaption>\n</figure>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, `<action-text-attachment sgid="${sgid}" caption="A squirrel."></action-text-attachment>`);
});

Deno.test("JSON: escapes double quotes in action-text-attachment caption", async () => {
  const sgid = "abc123sgid";
  const url = `https://pagecord.com/blob.jpg#sgid=${encodeURIComponent(sgid)}`;
  const html = `<figure>\n<img src="${url}" alt="" />\n<figcaption>She said &quot;hello&quot;</figcaption>\n</figure>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes('caption="She said &quot;hello&quot;"'), true);
});

Deno.test("JSON: transforms captioned figure to Pagecord format", async () => {
  const html = `<figure>\n<img src="dog.jpg" alt="A dog running." />\n<figcaption>A dog running.</figcaption>\n</figure>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes('alt="'), false);
  assertEquals(entry?.content.includes('class="attachment attachment--preview"'), true);
  assertEquals(entry?.content.includes('class="attachment__caption"'), true);
});

Deno.test("JSON: preserves alt on img outside captioned figure", async () => {
  const html = `<p><img src="dog.jpg" alt="A dog." /></p>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes('alt="A dog."'), true);
});

Deno.test("JSON: strips duplicate caption paragraph after figure", async () => {
  const html = `<p>Intro.</p>\n\n<figure>\n<img src="dog.jpg" alt="" />\n<figcaption>A dog running.</figcaption>\n</figure>\n\n<p>A dog running.</p>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes("A dog running.</figcaption>"), true);
  assertEquals(entry?.content.includes("<p>A dog running.</p>"), false);
});

Deno.test("JSON: strips multiple duplicate captions", async () => {
  const html = `<figure>\n<figcaption>First caption.</figcaption>\n</figure>\n\n<p>First caption.</p>\n\n<figure>\n<figcaption>Second caption.</figcaption>\n</figure>\n\n<p>Second caption.</p>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes("<p>First caption.</p>"), false);
  assertEquals(entry?.content.includes("<p>Second caption.</p>"), false);
});

Deno.test("JSON: preserves paragraphs that don't match any caption", async () => {
  const html = `<figure>\n<figcaption>Caption text.</figcaption>\n</figure>\n\n<p>Caption text.</p>\n\n<p>Unrelated paragraph.</p>`;
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content.includes("<p>Unrelated paragraph.</p>"), true);
  assertEquals(entry?.content.includes("<p>Caption text.</p>"), false);
});

// ---------------------------------------------------------------------------
// Title extraction from heading
// ---------------------------------------------------------------------------

Deno.test("JSON: h1 at start of HTML becomes title and is stripped from content", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: "<h1>My Post Title</h1>\n\n<p>Body text.</p>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, "My Post Title");
  assertEquals(entry?.content.includes("<h1>"), false);
  assertEquals(entry?.content.includes("Body text."), true);
});

Deno.test("JSON: h2 at start of HTML becomes title and is stripped from content", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: "<h2>Section Title</h2>\n\n<p>Body.</p>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, "Section Title");
  assertEquals(entry?.content.includes("<h2>"), false);
});

Deno.test("JSON: no title when HTML has no heading", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { name: ["filename.md"], content: [{ html: "<p>Just a note.</p>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, undefined);
  assertEquals(entry?.content.includes("Just a note."), true);
});

Deno.test("JSON: heading not at start of content is not used as title", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: "<p>Intro.</p>\n\n<h1>Later Heading</h1>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, undefined);
  assertEquals(entry?.content.includes("<h1>Later Heading</h1>"), true);
});

Deno.test("JSON: heading with inline HTML has tags stripped for title", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: "<h1><em>Styled</em> Title</h1>\n\n<p>Body.</p>" }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, "Styled Title");
});

Deno.test("JSON: HTML entities in heading are decoded in title", async () => {
  const req = jsonRequest({
    type: ["h-entry"],
    properties: { content: [{ html: '<h1>My &quot;Pagecord test&quot; page</h1>\n\n<p>Body.</p>' }] },
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.title, 'My "Pagecord test" page');
});

Deno.test("form: markdown h1 at start becomes title and is stripped from content", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "# My Heading\n\nBody text.");
  const entry = await parseMicropubRequest(formRequest(form));
  assertEquals(entry?.title, "My Heading");
  assertEquals(entry?.content.includes("# My Heading"), false);
  assertEquals(entry?.content.includes("Body text."), true);
});

Deno.test("form: no title when markdown has no heading", async () => {
  const form = new FormData();
  form.set("h", "entry");
  form.set("content", "Just a note.");
  const entry = await parseMicropubRequest(formRequest(form));
  assertEquals(entry?.title, undefined);
});

// ---------------------------------------------------------------------------
// Content-type dispatch
// ---------------------------------------------------------------------------

Deno.test("dispatch: returns null for unsupported content-type", async () => {
  const req = new Request("https://example.com/", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "hello",
  });
  assertEquals(await parseMicropubRequest(req), null);
});

Deno.test("dispatch: routes application/x-www-form-urlencoded", async () => {
  const req = new Request("https://example.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "h=entry&content=hello",
  });
  const entry = await parseMicropubRequest(req);
  assertEquals(entry?.content, "hello");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequest(body: unknown): Request {
  return new Request("https://example.com/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(form: FormData): Request {
  return new Request("https://example.com/", {
    method: "POST",
    body: form,
  });
}
