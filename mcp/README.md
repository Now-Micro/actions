# MCP Server (bare bones)

A minimal TypeScript MCP server for this repository. It follows the stdio transport pattern and is easy to extend with new tools. Dockerized for local runs.

## Structure

```
/mcp
  ├─ src/
  │   ├─ index.ts                   # server bootstrap (registers tools & resources)
  │   ├─ types/                     # minimal types and shims (MCP & Node)
  │   ├─ resources/
  │   │   ├─ actions-indexer.ts     # scans repo for composite actions (action.yml)
  │   │   └─ actions-store.ts       # in-memory index store
  │   └─ tools/                      # (legacy test tools removed)
  ├─ package.json
  ├─ tsconfig.json
  ├─ Dockerfile
  └─ docker-compose.yml
```

## Prereqs
- Node 18+ (for local dev) and npm
- Docker & Docker Compose

## Local dev (without Docker)
```powershell
cd mcp
npm ci
npm run dev
```
This runs the server with tsx. It communicates over stdio (no HTTP server by default).

If TypeScript reports missing MCP SDK subpath types during initial edits, we include minimal ambient shims in `src/types/shims.d.ts` to keep the project compiling; a full `npm ci` resolves real types.

## Build & run with Docker
```powershell
cd mcp
# Build image
docker compose build
# Run
docker compose up
```

Or using npm scripts:

```powershell
cd mcp
npm run dev:docker   # builds the image
npm run dev:docker:up  # brings the service up
```

## MCP resources for GitHub Actions

On startup, the server scans this monorepo for composite actions (action.yml) and exposes a discovery-friendly set of MCP resources:

- Catalog JSON (list):
  - URI: nowmicro-actions://actions/index
  - MIME: application/json
- Per‑action JSON detail:
  - URI: nowmicro-actions://actions/<slug>.json
  - MIME: application/json
- Per‑action Markdown detail (LLM-friendly):
  - URI: nowmicro-actions://actions/<slug>.md
  - MIME: text/markdown
- Search (resource template; if supported by the client):
  - URI template: nowmicro-actions://actions/search?q={query}
  - Returns a filtered JSON catalog

Notes
- <slug> is derived from the action folder path (e.g., dotnet/build → dotnet-build).
- The JSON detail includes a ready-to-paste uses string like Now-Micro/actions/dotnet/build@main and a minimal example snippet.

## Catalog tools (query and snippet helpers)

The server also provides small tools to make this catalog easier to use in chat UIs:

- search-actions
  - Args: { q?: string, query?: string }
  - Returns: a JSON array (as text) of catalog items matching the query.

- make-workflow-snippet
  - Args: { id?: string, slug?: string, values?: object, includeOptional?: boolean }
  - Behavior: Generates a YAML step for the selected action.
    - Required inputs are always included, using provided values or <REQUIRED> placeholders.
    - Optional inputs are included when includeOptional=true, or when a value is provided, or when the action defines a default.

- reindex-actions
  - Rebuilds the in-memory catalog (useful after adding/editing actions) and returns { ok: true, count }.

- list-actions / get-action (fallbacks)
  
- describe-action
  - Args: { id?: string, slug?: string }
  - Returns: Markdown with usage, inputs/outputs, and path.
  - Fallback helpers that return the catalog or a single action spec as JSON text (used when a client doesn’t support MCP resources).

## Use with VS Code / Copilot / Claude

MCP clients spawn the server process and speak stdio. To avoid corrupting the stdio stream, launch the server executable directly—do not wrap it with npm run or npx which print banners to stdout.

Recommended settings (user or workspace):

```jsonc
{
  "claude.mcpServers": {
    "nowmicro-actions": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "${workspaceFolder}/mcp"
    }
  }
}
```

Common pitfall: If you see errors like “Unexpected token '>' … is not valid JSON,” it means something (npm/npx banners) wrote to stdout. Switch to command: node and args: ["dist/index.js"].

## MCP Inspector quick start

1) Build once:
```powershell
cd mcp
npm ci
npm run build
```
2) In the Inspector, “Connect to Server” with:
   - Command: node
   - Args: ["dist/index.js"]
   - Cwd: <repo>/mcp
3) List resources → read nowmicro-actions://actions/index → call tools like search-actions or make-workflow-snippet.

## Extend with new tools
- Add a file in `src/tools/your-tool.ts` exporting a Tool and wire it up in `src/index.ts`.
- Prefer adding actions-centric utilities (e.g., more search filters, snippet variations) over generic demo tools.
- Rebuild: `npm run build` (or re-run docker build).

## Security & best practices used
- Multi-stage Docker build to keep runtime small
- Non-root user in runtime image
- Minimal files copied to final image
- No ports exposed by default (stdio transport)

## Notes
This is intentionally minimal. If you want to add repo-specific tools (e.g., reading files in this monorepo or running tests), add them under `src/tools/` and surface them via the MCP Tool API.
