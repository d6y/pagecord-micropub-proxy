# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A [Micropub protocol](https://www.w3.org/TR/micropub/) proxy that bridges Micropub clients (like iA Writer) to [Pagecord](https://pagecord.com) blogs. Runs as a [Bunny Edge Script](https://docs.bunny.net/docs/edge-scripting-overview) in production and as a local Deno HTTP/HTTPS server for development.

## Commands

```bash
deno task dev          # HTTP dev server on localhost:8000 with mock Pagecord client
deno task dev:https    # HTTPS dev server on micropub.test:8443 with mock Pagecord client (requires mkcert setup)
deno task dev:live     # HTTPS dev server on micropub.test:8443 hitting the real Pagecord API
deno task build        # Bundle index.ts → dist/main.js for Bunny deployment (uses esbuild)
deno check local.ts    # TypeScript type-check (index.ts cannot be checked with Deno tooling)
deno task test         # Run tests
```

`dev:live` requires `PAGECORD_API_KEY` and `MICROPUB_TOKEN` to be set in the environment.

The HTTPS dev modes require mkcert certificates (`micropub.test.pem` and `micropub.test-key.pem`) and a `/etc/hosts` entry for `micropub.test`. See README for setup.

## Architecture

```
Micropub client → POST / → handler.ts → pagecord.ts → Pagecord API
```

**Entry points:**
- `index.ts` — Bunny Edge Script entry; uses `BunnySDK` globals, reads env vars, creates `PagecordClient`
- `local.ts` — Deno dev server; uses real `PagecordClient` if `PAGECORD_API_KEY` is set, otherwise `MockPagecordClient`

**Core modules (`src/`):**
- `handler.ts` — Routes all requests; GET `/` = discovery HTML, GET `/?q=config` = config JSON, POST `/` = create post, POST `/media` = upload image
- `micropub.ts` — Parses incoming Micropub requests across all three content types (JSON, form-encoded, multipart) into a normalized `ParsedEntry`
- `pagecord.ts` — `makePagecordClient` (real API, logs all requests/responses) and `makeMockPagecordClient` (dev logging); both implement `PagecordClient`
- `types.ts` — TypeScript interfaces for the domain model

## Key Behaviors

**Authentication:** All POST requests and `?q=` queries require `Authorization: Bearer <MICROPUB_TOKEN>`. Unauthenticated GET `/` returns discovery HTML.

**Pagecord API:** Posts are sent as JSON to `https://api.pagecord.com/posts`. After a successful create, the client redirects to `https://pagecord.com/app/posts`.

**Image handling:** Photos arrive as either `Blob` (multipart upload) or URL strings. The handler fetches URL-referenced images, uploads them to Pagecord's `/attachments` endpoint, then embeds them as `<action-text-attachment>` XML tags within post content.

**Tags:** iA Writer does not send YAML `tags` front matter as Micropub `category`. Instead, `#hashtags` written in the document body are sent as `<span class="hashtag">#word</span>` in the HTML. The proxy extracts these as tags and strips the hashtag paragraph from the content before forwarding to Pagecord.

**Property mapping (Micropub → Pagecord):**
- `name`/`title` → `title`
- `content` → `content` (HTML, with hashtag paragraphs stripped)
- `post-status` → `status` (`published` or `draft`)
- `published` → `published_at`
- `category`/`category[]` → `tags` (comma-joined); falls back to hashtags extracted from content
- `mp-slug`/`slug` → `slug`

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `PAGECORD_API_KEY` | Production + live dev | Bearer token for Pagecord API |
| `MICROPUB_TOKEN` | Production + live dev | Static token Micropub clients must supply |
| `PROXY_URL` | Production | Public URL of this proxy (advertised in `?q=config` response) |
| `HTTPS` | Local dev | Set to `"true"` to enable HTTPS (set automatically by `dev:https` and `dev:live` tasks) |
| `PORT` / `HOST` | Local dev | Override defaults |

The Pagecord API base URL (`https://api.pagecord.com`) is hardcoded — it is not configurable.

## Runtime Differences

The production entry point (`index.ts`) uses Bunny Edge Script globals (`BunnySDK`). These are not available in Deno — local dev uses `local.ts` exclusively. `index.ts` cannot be run or type-checked with standard Deno tooling.
