import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools } from './tools.js';
import logger from '../../infrastructure/logger.js';

/**
 * Atalaia as an MCP server.
 *
 * An agent asking "is this CVE in our code, and what do we do about it" needs
 * the same three answers the console shows — what was found, where it lands,
 * and what to do — so the tools are built over the same use cases rather than
 * over a second copy of the queries.
 *
 * The server object is cheap and holds no connection of its own: one is built
 * per request, because the HTTP transport is stateless.
 */

const { version } = JSON.parse(
    fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')
);

const INSTRUCTIONS = `Atalaia watches public vulnerability feeds, filters them against the technologies this
fleet actually ships, and correlates the survivors with the imported GitHub repositories.

Start from list_vulnerabilities with relevance="affecting" — the feeds publish tens of thousands of CVEs
and almost none of them name something here. get_vulnerability then says which repositories a CVE reaches,
through which dependency, and who owns them.

What is claimed is what is known: a repository that has never been scanned reports lastScannedAt=null
rather than reading as clean, and a version that cannot be compared is "unknown" with a reason.

Nothing here changes the state of a finding. Acknowledging, resolving, importing and scanning stay with
the operator, in the console or the REST API.`;

/**
 * @param {object} cache postgresCache module (or a compatible stub)
 * @returns {McpServer}
 */
export function createMcpServer(cache) {
    const server = new McpServer(
        { name: 'atalaia', version },
        { instructions: INSTRUCTIONS, capabilities: { tools: {} } }
    );

    for (const tool of createTools(cache)) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
            },
            async args => {
                try {
                    const result = await tool.handler(args ?? {});
                    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
                } catch (error) {
                    // Returned as a tool error rather than thrown: the agent is
                    // the one who can act on "not found" or "no model
                    // configured", and a protocol-level failure hides it.
                    logger.warn({ tool: tool.name, err: error }, 'MCP tool failed');
                    return { isError: true, content: [{ type: 'text', text: error.message }] };
                }
            }
        );
    }

    return server;
}
