# itr-mcp

Local-first MCP server for Indian income tax. Ask Claude your tax questions and get deterministic answers computed on your machine -- no accounts, no uploads, no cloud.

Works with Claude Desktop, Claude Code, and any MCP client.

## Why

Every Indian tax tool wants your data on their servers. The finance MCPs that exist (Fi Money, INDmoney) are cloud-hosted and expose zero tax tooling. itr-mcp flips it: your documents stay local, the LLM never does arithmetic, and every number comes from a versioned rule pack you can audit.

## Tools (v0.1)

| Tool | What it does |
| --- | --- |
| `compute_tax` | Full FY 2025-26 (AY 2026-27) computation: new/old regime slabs, standard deduction, 87A rebate with marginal relief, 111A (20%) / 112A (12.5% above 1.25L) capital gains, surcharge with the 15% gains cap, 4% cess |
| `compare_regimes` | Old vs new side by side, recommended regime, savings amount |
| `schedule_advance_tax` | Jun/Sep/Dec/Mar installment plan (15/45/75/100%) with shortfall tracking |
| `list_deductions` | Old-regime deduction checklist with statutory caps (80C, 80CCD(1B), 80D tiers, HRA metros) |
| `parse_form26as` | Parse the caret-delimited Form 26AS Text export from TRACES into structured TDS entries |
| `list_tax_years` | Supported fiscal years + AY 2026-27 filing deadlines |

All tools are read-only (`readOnlyHint: true`) and return typed `structuredContent`.

## Install

### Claude Code

```bash
claude mcp add itr-mcp -- npx -y itr-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "itr-mcp": {
      "command": "npx",
      "args": ["-y", "itr-mcp"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/Sagargupta16/itr-mcp
cd itr-mcp && pnpm install && pnpm build
node dist/index.js   # stdio server
```

## Example prompts

- "My CTC is 18L with 50K NPS through my employer -- which regime should I pick for FY 2025-26?"
- "I sold mutual funds with 3L long-term gains this year. What tax do I owe on them?"
- "My estimated tax is 2.4L and TDS covers 1.8L. Plan my advance tax installments."
- "Parse `C:/tax/26AS.txt` and total the TDS my employer deposited."

## Design principles

- **Local-only.** stdio transport, no network calls, no telemetry. Your PAN never leaves the process (and is masked in text output).
- **The LLM never does math.** Every rupee is computed by pure functions over `data/fy2025-26.json`. Golden-file tests pin the engine to published worked examples (the 12L zero-tax case, the 12,10,000 marginal-relief case, the 12,70,588 relief exhaustion point).
- **Year-parameterized.** Rules live in per-FY JSON packs. FY 2026-27 (Budget 2026: Form 16 renamed to Form 130, 8 HRA metros, buyback reversion) lands as a new pack, not code changes.
- **Not tax advice.** Every response carries disclaimers and the rule-pack version. Verify against the official utility before filing.

## Roadmap

- [x] **v0.1** -- tax engine (both regimes + CG + surcharge + cess), regime comparison, advance tax, deduction checklist, 26AS text parser
- [ ] **v0.2** -- `parse_ais` (encrypted AIS JSON), `parse_form16` (TRACES PDF), `reconcile_documents` (Form 16 vs AIS vs 26AS mismatch report -- the #1 cause of tax notices)
- [ ] **v0.3** -- mutual fund CAS via casparser, broker capital-gains statements (Zerodha tax P&L), capital gains aggregation
- [ ] **v0.4** -- draft ITR JSON export for the official offline utility, `.mcpb` one-click Claude Desktop bundle, MCP registry listing

## Development

```bash
pnpm install
pnpm test          # vitest: engine golden files + in-memory MCP client tests
pnpm build
pnpm inspect       # MCP inspector against dist/index.js
```

## Disclaimer

itr-mcp is an open-source calculator and document parser. It is not a substitute for professional tax advice, and it never files anything -- output is meant to be verified against the official income tax utility.

## License

[MIT](LICENSE)
