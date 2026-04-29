/**
 * Local development server.
 *
 * Runs the same handler logic as the Bunny Edge Script, but uses a mock
 * Pagecord client that logs calls instead of hitting the real API.
 *
 * Usage (mock, HTTPS — required by iA Writer):
 *   mkcert micropub.test          # run once in the project directory
 *   deno task dev
 *
 * Usage (live, HTTPS):
 *   PAGECORD_API_KEY=xxx MICROPUB_TOKEN=xxx deno task dev:live
 *
 * Custom token / port:
 *   MICROPUB_TOKEN=mytoken PORT=9000 deno run --allow-net --allow-env --allow-read local.ts
 */
import { handleRequest } from "./src/handler.ts";
import { makeMockPagecordClient, makePagecordClient } from "./src/pagecord.ts";

const MICROPUB_TOKEN = Deno.env.get("MICROPUB_TOKEN") ?? "test-token";
const HTTPS = Deno.env.get("HTTPS") === "true";
const PORT = parseInt(Deno.env.get("PORT") ?? (HTTPS ? "8443" : "8000"), 10);
const HOST = Deno.env.get("HOST") ?? (HTTPS ? "micropub.test" : "localhost");
const BRIDGE_URL = Deno.env.get("BRIDGE_URL") ?? `${HTTPS ? "https" : "http"}://${HOST}:${PORT}`;

const PAGECORD_API_BASE = "https://api.pagecord.com";
const PAGECORD_API_KEY = Deno.env.get("PAGECORD_API_KEY");

const live = !!PAGECORD_API_KEY;
const pagecord = live
  ? makePagecordClient(PAGECORD_API_BASE, PAGECORD_API_KEY)
  : makeMockPagecordClient((msg) => console.log("  " + msg));

console.log("=".repeat(60));
console.log(`Micropub → Pagecord bridge  (${live ? "LIVE" : "mock"} mode)`);
console.log("=".repeat(60));
console.log(`Listening on    ${BRIDGE_URL}`);
console.log(`Micropub token  ${MICROPUB_TOKEN}`);
console.log(`Media endpoint  ${BRIDGE_URL}/media`);
if (live) {
  console.log(`Pagecord API    ${PAGECORD_API_BASE}`);
} else {
  console.log("");
  console.log("Pagecord API calls are MOCKED — no posts will be created.");
}
console.log("");

const serveOptions: Deno.ServeOptions | Deno.ServeTlsOptions = HTTPS
  ? {
      port: PORT,
      cert: Deno.readTextFileSync(`${HOST}.pem`),
      key: Deno.readTextFileSync(`${HOST}-key.pem`),
    }
  : { port: PORT };

Deno.serve(serveOptions, async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const label = `${request.method} ${url.pathname}${url.search}`;
  console.log(`→ ${label}`);

  const response = await handleRequest(request, {
    micropubToken: MICROPUB_TOKEN,
    pagecord,
    bridgeUrl: BRIDGE_URL,
  });

  console.log(`← ${response.status}`);
  console.log("");

  return response;
});
