# MCP Server (bare bones)

A minimal TypeScript MCP server for this repository. It follows the stdio transport pattern and is easy to extend with new tools. Dockerized for local runs.

## Structure

```
/mcp
  ├─ src/
  │   ├─ index.ts         # server bootstrap
  │   ├─ types/           # minimal types and shims (MCP & Node)
  │   └─ tools/
  │       ├─ index.ts     # tool registry
  │       └─ ping.ts      # example tool
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

## Extend with new tools
- Add a file in `src/tools/your-tool.ts` exporting a Tool.
- Register it in `src/tools/index.ts`.
- Rebuild: `npm run build` (or re-run docker build).

## Security & best practices used
- Multi-stage Docker build to keep runtime small
- Non-root user in runtime image
- Minimal files copied to final image
- No ports exposed by default (stdio transport)

## Notes
This is intentionally minimal. If you want to add repo-specific tools (e.g., reading files in this monorepo or running tests), add them under `src/tools/` and surface them via the MCP Tool API.
