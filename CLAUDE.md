# CLAUDE.md

> This file stacks on top of the workspace root at `C:\Code\GitHub\`:
> - Root [`CLAUDE.md`](../../CLAUDE.md) -- voice, rules, routing map, references, skills, slash commands, conventions.
> - Root [`MEMORY.md`](../../MEMORY.md) -- live facts across repos.
> - Root [`STATUS.md`](../../STATUS.md) -- live PR/CI/security dashboard.
> - [`.claude/resources/`](../../.claude/resources/README.md) -- deep reference for collaboration, workflow, git, OSS, debugging, voice.
>
> Read those first. The guidance below only adds **repo-specific context** -- it does not override anything in the root.

## Project

Local-first MCP server for Indian income tax (FY 2025-26 / AY 2026-27): deterministic tax engine + document parsers exposed as MCP tools over stdio. Public OSS, npm package `itr-mcp`. Positioning: privacy-first -- everything runs on-device, unlike cloud finance MCPs (Fi/INDmoney).

## Stack

- **Language**: TypeScript 6 (strict, ESM, NodeNext)
- **Framework**: @modelcontextprotocol/sdk 1.29 (stdio transport only), zod 4
- **Database**: none -- rule packs are JSON files in `data/`
- **Package manager**: pnpm
- **Deploy target**: npm registry (`npx -y itr-mcp`); .mcpb Desktop bundle planned

## Run

```
pnpm install
pnpm build
node dist/index.js        # stdio MCP server
pnpm inspect              # MCP inspector UI
```

## Test

```
pnpm test         # engine golden files + in-memory MCP client round trips
pnpm lint         # biome
pnpm typecheck
```

## Entry points

- `src/index.ts` -- stdio bootstrap (banner adds the shebang via tsup)
- `src/server.ts` -- all tool registrations (the MCP surface)

## Key files

- `src/engine/compute.ts` -- the tax engine: slabs, 87A + marginal relief, CG rates, surcharge, cess. Pure functions; the LLM never does arithmetic
- `data/fy2025-26.json` -- rule pack: EVERY tax constant lives here, never inline in code
- `src/parsers/form26as.ts` -- caret-delimited TRACES text parser (tolerant, warnings[] over throws)
- `tests/engine.test.ts` -- golden cases pinned to published worked examples

## Gotchas

- **stdout is the MCP channel** -- all logging must go to stderr (`console.error`). One stray `console.log` breaks the protocol.
- Rules key off TRANSACTION DATES, not just FY: 23-Jul-2024 (CG rate flip), 1-Apr-2023 (debt MF s50AA), 1-Oct-2024 (buyback deemed dividend). Keep date boundaries in the rule pack when those land.
- 87A rebate NEVER offsets 111A/112A tax under the new regime (Finance Act 2025) -- the engine applies it to normal-income slab tax only. Tests pin this.
- SDK v2 (beta, stable ~2026-07-28) flips `registerTool` input schemas from raw zod shapes to `z.object()`. Schemas are centralized in `src/server.ts` for that migration.
- `data/` ships in the npm package (`files` field); `resolveDataDir()` in rulepack.ts probes both dist- and src-relative paths.
- FY 2026-27 pack (Budget 2026): Form 16 becomes Form 130, HRA metros 4 -> 8, buyback reverts to capital gains. New JSON pack + `availableYears()` update, no engine changes expected.

## Repo-specific rules

- Never add a network transport or telemetry -- local-only is the product.
- Tax constants only ever change via `data/*.json` + a CHANGELOG entry citing the source (Finance Act / CBDT circular / incometax.gov.in page).
- Every new tool: `annotations: { readOnlyHint: true, openWorldHint: false }`, zod-described inputs, `structuredContent` output, disclaimers on anything that computes tax.
- Parsers must be tolerant: collect `warnings[]`, never throw on layout surprises; errors must name the fix ("download the Text format from TRACES").
