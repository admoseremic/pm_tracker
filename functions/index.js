// =============================================================================
// Firebase Functions entry point for the PM Tracker MCP server.
//
// Exposes a single HTTPS function called `mcp` that handles JSON-RPC requests
// from MCP clients via the Streamable HTTP transport. The function is wired
// to pm.trevorwithdata.com/mcp via a rewrite rule in firebase.json.
//
// The MCP server itself is built per-request (stateless mode) so the function
// can scale horizontally without session affinity. Each tool talks to the
// pm-kanban Firebase Realtime Database through the Admin SDK.
// =============================================================================

import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";

// Initialize the Admin SDK once at module load.
// `databaseURL` points the Admin SDK at the same Realtime DB the web app uses.
// In Cloud Functions, default credentials are picked up automatically; locally
// you can run `firebase emulators:start` or set GOOGLE_APPLICATION_CREDENTIALS.
initializeApp({
    databaseURL: "https://pm-kanban-default-rtdb.firebaseio.com",
});

// Single shared DB handle reused across requests for connection efficiency.
const db = getDatabase();

// Export the HTTPS function. The name `mcp` is referenced in firebase.json
// rewrites so requests to /mcp on pm.trevorwithdata.com land here.
export const mcp = onRequest(
    {
        region: "us-central1",
        // Generous-but-bounded resource limits. MCP tool calls are usually
        // sub-second DB lookups, but list_projects can scan the whole tree.
        memory: "256MiB",
        timeoutSeconds: 60,
        // CORS is permissive because Claude Code clients call this directly
        // from arbitrary machines. The endpoint has no auth, but neither does
        // the underlying Realtime DB (the API key + URL are in the public
        // app.js), so this doesn't change the security posture.
        cors: true,
        // No min instances — a small cold-start delay is fine for a tool that
        // runs interactively, and we don't want to pay to keep one warm.
        invoker: "public",
    },
    async (req, res) => {
        // Reject everything except POST. Streamable HTTP in stateless mode
        // doesn't use GET (which is for server-initiated SSE streams in the
        // stateful flow) or DELETE (which terminates a session).
        if (req.method !== "POST") {
            res.status(405).json({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Method not allowed." },
                id: null,
            });
            return;
        }

        // Build a fresh MCP server + transport for each request. This is the
        // recommended pattern for stateless mode — sharing instances across
        // concurrent requests would cause JSON-RPC ID collisions.
        const server = buildMcpServer(db);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless: no session resumption
            enableJsonResponse: true,      // return plain JSON, not SSE
        });

        try {
            await server.connect(transport);
            // handleRequest reads the JSON-RPC body, dispatches to the
            // registered tool/resource/prompt, and writes the response.
            // Firebase already parsed req.body for us, so we pass it through.
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error("MCP request failed:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        } finally {
            // Always tear down per-request resources so we don't leak
            // listeners or sockets.
            transport.close();
            server.close();
        }
    }
);
