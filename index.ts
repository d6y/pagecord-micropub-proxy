/**
 * Bunny Edge Scripting entry point.
 *
 * Required environment variables (set as Secrets in the Bunny dashboard):
 *   PAGECORD_API_KEY  — your Pagecord API key
 *   MICROPUB_TOKEN    — static Bearer token you configure in iA Writer
 *   BRIDGE_URL         — public URL of this script, e.g. https://micropub.example.com
 *                       (used to advertise the media endpoint in ?q=config)
 */
import * as BunnySDK from "@bunny.net/edgescript-sdk";
import { handleRequest } from "./src/handler.ts";
import { makePagecordClient } from "./src/pagecord.ts";

const PAGECORD_API_BASE = "https://api.pagecord.com";
const PAGECORD_API_KEY = Deno.env.get("PAGECORD_API_KEY") ?? "";
const MICROPUB_TOKEN = Deno.env.get("MICROPUB_TOKEN") ?? "";
const BRIDGE_URL = Deno.env.get("BRIDGE_URL") ?? "";

for (const [name, value] of [
  ["PAGECORD_API_KEY", PAGECORD_API_KEY],
  ["MICROPUB_TOKEN", MICROPUB_TOKEN],
] as [string, string][]) {
  if (!value) {
    console.error(`[micropub-bridge] Missing required environment variable: ${name}`);
  }
}

const pagecord = makePagecordClient(PAGECORD_API_BASE, PAGECORD_API_KEY);

BunnySDK.net.http.serve(async (request: Request): Promise<Response> => {
  return handleRequest(request, {
    micropubToken: MICROPUB_TOKEN,
    pagecord,
    bridgeUrl: BRIDGE_URL,
  });
});
