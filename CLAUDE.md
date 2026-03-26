# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A [Micropub protocol](https://www.w3.org/TR/micropub/) proxy that bridges Micropub clients (like iA Writer) to [Pagecord](https://pagecord.com) blogs. Runs as a [Bunny Edge Script](https://docs.bunny.net/docs/edge-scripting-overview) in production and as a local Deno HTTP/HTTPS server for development.

## Commands

```bash
deno task dev          # HTTP dev server on localhost:8000 with mock Pagecord client
deno task dev:https    # HTTPS dev server on micropub.test:8443 (requires mkcert setup)
deno check index.ts local.ts  # TypeScript type-check
```

The HTTPS dev mode requires mkcert certificates (`micropub.test.pem` and `micropub.test-key.pem`) and a `/etc/hosts` entry for `micropub.test`. See README for setup.

## Architecture

```
Micropub client → POST / → handler.ts → pagecord.ts → Pagecord API
```

**Entry points:**
- `index.ts` — Bunny Edge Script entry; uses `BunnySDK` globals, reads env vars, creates `PagecordClient`
- `local.ts` — Deno dev server; creates `MockPagecordClient` that logs instead of calling the API

**Core modules (`src/`):**
- `handler.ts` — Routes all requests; GET `/` = discovery HTML, GET `/?q=config` = config JSON, POST `/` = create post, POST `/media` = upload image
- `micropub.ts` — Parses incoming Micropub requests across all three content types (JSON, form-encoded, multipart) into a normalized `ParsedEntry`
- `pagecord.ts` — `PagecordClient` (real API) and `MockPagecordClient` (dev logging); both implement `IPagecordClient`
- `types.ts` — TypeScript interfaces for the domain model

## Key Behaviors

**Authentication:** All POST requests and `?q=` queries require `Authorization: Bearer <MICROPUB_TOKEN>`. Unauthenticated GET `/` returns discovery HTML.

**Image handling:** Photos arrive as either `Blob` (multipart upload) or URL strings. The handler fetches URL-referenced images, uploads them to Pagecord's `/attachments` endpoint, then embeds them as `<action-text-attachment>` XML tags within post content.

**Property mapping (Micropub → Pagecord):**
- `name`/`title` → `title`
- `content` → `content` (with embedded image tags)
- `post-status` → `status` (`published` or `draft`)
- `published` → `published_at`
- `category`/`category[]` → `tags` (comma-joined)
- `mp-slug`/`slug` → `slug`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAGECORD_API_KEY` | Bearer token for Pagecord API |
| `BLOG_URL` | Pagecord API base URL |
| `MICROPUB_TOKEN` | Static token Micropub clients must supply |
| `PROXY_URL` | Public URL of this proxy (advertised in `?q=config` response) |
| `HTTPS` | Set to `"true"` to enable HTTPS in local dev |
| `PORT` / `HOST` | Override defaults in local dev |

## Runtime Differences

The production entry point (`index.ts`) uses Bunny Edge Script globals (`BunnySDK`, `__requestHandler`). These are not available in Deno — local dev uses `local.ts` exclusively. When editing `index.ts`, be aware it cannot be run or type-checked with standard Deno tooling.
