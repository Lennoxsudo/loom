/** Built-in rules template id for code graph guidance. */

export const GRAPH_RULES_TEMPLATE_ID = 'builtin:code-graph';

export const GRAPH_RULES_TEMPLATE_NAME = 'Code knowledge graph';

export const GRAPH_RULES_TEMPLATE_CONTENT = `## Code knowledge graph (built-in)

Prefer graph tools over grep/sym for call chains, architecture, and symbol lookup — structural answers in far fewer tokens.

### Index
- **Disk**: \`{app_data}/Loom/cbm/\` — persists across restarts; use \`graph_index status\` before re-indexing.
- **Scope**: entire \`repo_path\` tree, not open tabs. Auto-index on workspace open if enabled (Settings → Code graph).
- **Params**: omit \`repo_path\` = current workspace. \`project\` = CBM slug from \`list\` only when path mapping fails. Never \`project_id\`.

### Quick picks
| Question | Call |
|----------|------|
| Who calls X? | \`graph_trace\` trace · \`direction=inbound\` |
| What does X call? | \`graph_trace\` trace · \`direction=outbound\` |
| Full neighborhood | \`graph_trace\` trace · \`direction=both\` |
| Find symbol by name | \`graph_query\` search · \`name_pattern\` (+ optional \`label\` / \`file_pattern\`) |
| Read symbol source | \`graph_query\` snippet · \`qualified_name\` from search |
| Text inside symbol bodies | \`graph_query\` code · \`pattern\` (or \`search\` tool for raw files) |
| Architecture overview | \`graph_trace\` architecture |
| Edit blast radius | \`graph_trace\` changes (disk vs index snapshot — **not git**) |
| Multi-hop / cross-type | \`graph_query\` schema → \`query\` (Cypher MATCH) |

### Actions
| Tool | Actions |
|------|---------|
| \`graph_index\` | \`index\` · \`status\` · \`list\` · \`delete\` |
| \`graph_query\` | \`search\` · \`snippet\` · \`code\` · \`schema\` · \`query\` |
| \`graph_trace\` | \`trace\` · \`architecture\` · \`changes\` |

**search** — \`name_pattern\` + \`label\` + \`file_pattern\` are **AND**ed. \`qualified_name\` is snippet-only.

**trace** — direction relative to \`function_name\`: \`inbound\` = callers/referrers (edges TO it) · \`outbound\` = callees/deps (FROM it) · \`both\` (default). \`depth\` 1–5.

### Workflows
1. **Explore**: \`status\` → \`schema\` → \`search\` → \`snippet\`
2. **Trace**: \`search\` (exact name) → \`trace\` (\`both\`, depth 3)
3. **Custom graph**: \`schema\` → \`query\`

"Who calls X?" → \`graph_trace\` trace, not \`graph_query\` query.

Explore subagents: \`graph_query\` / \`graph_trace\` only — not \`graph_index\`.

### Edge types
CALLS · HTTP_CALLS · ASYNC_CALLS · IMPORTS · DEFINES · DEFINES_METHOD · HANDLES · IMPLEMENTS · OVERRIDE · USAGE · FILE_CHANGES_WITH · CONTAINS_FILE · CONTAINS_FOLDER · CONTAINS_PACKAGE

### Cypher (\`graph_query\` query)
MATCH/WHERE/RETURN only — not natural language. Run \`schema\` first. 200-row cap; use \`limit\` in RETURN.

\`\`\`
MATCH (a)-[r:HTTP_CALLS]->(b) RETURN a.name, b.name, r.url_path LIMIT 20
MATCH (f:Function) WHERE f.name =~ '.*Handler.*' RETURN f.name, f.file_path LIMIT 10
MATCH (a)-[r:CALLS]->(b) WHERE a.name = 'main' RETURN b.name LIMIT 20
\`\`\`

### Gotchas
1. \`trace\` needs exact \`function_name\` — \`search\` first if unsure.
2. \`outbound\` alone misses callers — use \`both\` for full context.
3. Search degree filters count nodes, not edge rows — use \`query\` to list HTTP_CALLS edges.
4. \`search\` paginates (~10 default) — set \`limit\` / \`offset\` when needed.
5. \`changes\` = disk vs last index, not git history.
`;
