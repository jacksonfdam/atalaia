# MCP server

Atalaia speaks [Model Context Protocol](https://modelcontextprotocol.io) at `POST /mcp`, so a coding agent can ask what the console shows: what was found, which repository it lands in, through which dependency, and what to do about it.

It is part of the API process — no fourth service, no second copy of the queries. The tools are built over the same use cases the REST routes are.

## Connecting

The endpoint is authenticated by the same `API_KEY` as the rest of the API, sent either as `X-API-Key` or as `Authorization: Bearer <key>` for clients that only offer the second.

Claude Code:

```bash
claude mcp add --transport http atalaia http://localhost:3000/mcp \
  --header "X-API-Key: $API_KEY"
```

Anything reading `mcp.json` (Claude Desktop, Cursor, VS Code):

```json
{
  "mcpServers": {
    "atalaia": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "X-API-Key": "your-api-key" }
    }
  }
}
```

A quick check without a client at all:

```bash
curl -s http://localhost:3000/mcp \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A browser-based client also needs its origin in `CORS_ORIGINS`; a client that runs as a process (Claude Code, Claude Desktop, Cursor) does not.

The transport is **stateless**: one MCP server per request, no session to keep. `GET` and `DELETE` answer `405` — there is no server-initiated stream and no session to end. A restart therefore drops nothing, and a second API container can answer for the first.

## Tools

| Tool | What it answers |
|------|-----------------|
| `list_vulnerabilities` | Search the collected CVEs. `relevance=affecting` narrows to the ones that name something the fleet depends on; `relevance=infrastructure` to container images and CI actions. |
| `get_vulnerability` | One CVE in full: description, stored explanation, timeline, which repositories it reaches and through which dependency, and who owns them. |
| `explain_vulnerability` | Ask the configured model to write the plain-English explanation and store it. The one tool here that writes. |
| `query_by_technology` | Which still-open CVEs list any of these technologies as affected — for a stack not imported as a repository. |
| `get_stats` | Counts by severity, status, source and technology, activity, and how much of the database is about this fleet at all. |
| `list_repositories` | The monitored repositories with their exposure. `exposure=affected` narrows to the ones that are hit. |
| `get_repository` | One repository with its languages, topics and ecosystems. |
| `list_repository_dependencies` | Every parsed dependency with the latest published version, what is behind, and what nobody has looked up yet. |
| `list_repository_vulnerabilities` | Which CVEs reach one repository, through which dependency, version and manifest file. |
| `list_owners` | The people alerts route to, and what each of them owns. |
| `get_weekly_report` | The digest the weekly email sends. |
| `list_technologies` | The static stack filter in `config/technologies.json`. |

Repositories are addressed by numeric id or by URL — `"repository": "42"` and `"repository": "https://github.com/acme/api"` reach the same one.

Adding a tool is one entry in `src/interface/mcp/tools.js`; the server, the tests and this table read from that list.

## What it will not do

Everything except `explain_vulnerability` is declared `readOnlyHint`, and nothing here changes the state of a finding. Acknowledging, resolving, importing an organization and queueing a scan stay with the operator, in the console or the REST API — an agent that can close a finding is an agent that can close it for the wrong reason.

The honesty rules of the rest of Atalaia hold at this boundary too: a repository that has never been scanned reports `lastScannedAt: null` rather than reading as clean, a version that cannot be compared is `unknown` with a reason, and an unknown CVE comes back as a tool error the agent can act on rather than a protocol failure it cannot.

## Errors

A tool that fails answers with `isError` and the reason in plain text — `CVE-1999-9999 not found`, or whatever the model provider said when no model is configured. Bad arguments are refused by the tool's own schema before any query runs.
