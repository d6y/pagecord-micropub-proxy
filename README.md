# Micropub → Pagecord Proxy

A [Bunny Edge Scripting](https://docs.bunny.net/scripting) service that implements the [Micropub](https://www.w3.org/TR/micropub/) protocol and proxies posts to the [Pagecord API](https://github.com/d6y/pagecord/blob/main/docs/help-guide/api.md).

This lets you publish directly from **iA Writer** (or any Micropub client) to your Pagecord blog.

---

## How it works

```
iA Writer  →  POST /  (Micropub)  →  proxy  →  POST /posts  (Pagecord API)
                                              →  POST /attachments (images)
```

The proxy:
- Verifies a static Bearer token
- Parses Micropub `h-entry` posts (form-encoded, JSON, or multipart)
- Uploads any attached images to the Pagecord attachments API and embeds them as `<action-text-attachment>` tags
- Creates the post via the Pagecord API
- Returns a `201 Created` with a `Location` header pointing to the new post

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PAGECORD_API_KEY` | Yes | Your Pagecord API key (Settings → API in your dashboard) |
| `BLOG_URL` | Yes | Pagecord API base URL — `https://api.pagecord.com` |
| `MICROPUB_TOKEN` | Yes | A secret token you choose; configure the same value in iA Writer |
| `PROXY_URL` | Recommended | The public URL of this script (e.g. `https://micropub.example.com`). Used to advertise the media endpoint in `?q=config`. |

---

## Local development

Requires [Deno](https://deno.land/) 1.40+.

iA Writer requires HTTPS even for local servers. Set this up once with [mkcert](https://github.com/FiloSottile/mkcert):

```sh
brew install mkcert
mkcert -install                             # adds a trusted root CA to your keychain
cd /path/to/pagecord-micropub-proxy
mkcert micropub.test                        # creates micropub.test.pem + micropub.test-key.pem
echo "127.0.0.1 micropub.test" | sudo tee -a /etc/hosts
```

Then start the HTTPS mock server:

```sh
deno task dev:https
# Listening on https://micropub.test:8443
```

For non-iA-Writer testing (curl etc.) plain HTTP is fine:

```sh
deno task dev
# Listening on http://localhost:8000
```

All Pagecord API calls are intercepted by a mock client that logs what *would* be sent.

### Example requests

**Query config:**
```sh
curl -H "Authorization: Bearer test-token" \
  "http://localhost:8000/?q=config"
```

**Create a post (form-encoded):**
```sh
curl -X POST \
  -H "Authorization: Bearer test-token" \
  -d "h=entry&name=Hello+World&content=This+is+my+first+post&post-status=published" \
  http://localhost:8000/
```

**Create a post (JSON):**
```sh
curl -X POST \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"type":["h-entry"],"properties":{"name":["Hello"],"content":["Body text"],"post-status":["published"]}}' \
  http://localhost:8000/
```

**Upload an image via the media endpoint:**
```sh
curl -X POST \
  -H "Authorization: Bearer test-token" \
  -F "file=@photo.jpg" \
  http://localhost:8000/media
```

---

## Deployment to Bunny Edge Scripting

1. Create a new **Standalone Script** in your Bunny dashboard.
2. Connect your GitHub repository (or paste the code manually).
3. Set the environment variables / secrets:
   - `PAGECORD_API_KEY`
   - `BLOG_URL` → `https://api.pagecord.com`
   - `MICROPUB_TOKEN` → a strong random string
   - `PROXY_URL` → your script's public URL
4. Deploy. The entry point is `index.ts`.

---

## Configuring iA Writer

1. In iA Writer, go to **Settings → Accounts → Add Account → Micropub**.
2. Choose **Enter Token Manually**.
3. Enter your proxy URL (e.g. `https://micropub.example.com`) — this is the discovery URL.
4. Enter the value you set as `MICROPUB_TOKEN`.
5. Click **Add Account**.

iA Writer will:
- `GET /` to discover the Micropub endpoint via the `rel="micropub"` link tag
- `GET /?q=config` (with your token) to confirm the endpoint works and find the media endpoint

For local testing use `https://micropub.test:8443` (requires the mkcert setup above).

---

## Micropub property mapping

| Micropub property | Pagecord field |
|-------------------|----------------|
| `name` / `title` | `title` |
| `content` | `content` (sent as Markdown) |
| `post-status` | `status` (`published` or `draft`) |
| `published` | `published_at` |
| `category[]` | `tags` (comma-joined) |
| `mp-slug` / `slug` | `slug` |
| `photo[]` | Uploaded to `/attachments`, embedded as `<action-text-attachment>` |

Posts default to `draft` status unless `post-status=published` is sent.

---

## Notes

- The Pagecord API is not yet live. Once it is, no code changes should be needed — just set the environment variables and deploy.
- `action=update` and `action=delete` are not yet implemented (they return `501`).
- Images in the post body (inline Markdown `![](url)` syntax) are passed through as-is; only explicit `photo[]` properties are uploaded to Pagecord's attachment API.
