# itr-mcp

[![npm](https://img.shields.io/npm/v/itr-mcp?label=npm)](https://www.npmjs.com/package/itr-mcp)
[![CI](https://github.com/Sagargupta16/itr-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Sagargupta16/itr-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blueviolet)](https://modelcontextprotocol.io)

Local-first MCP server for Indian income tax. Ask Claude your tax questions and get deterministic answers computed on your machine -- no accounts, no uploads, no cloud.

Works with Claude Desktop, Claude Code, and any MCP client.

```
You:    My CTC is 18L with 50K employer NPS -- which regime for FY 2025-26?
Claude: [compare_regimes] New regime: 1,87,200. Old regime (with your deductions): 2,10,600.
        Recommended: new regime, saves Rs 23,400.

You:    And if I harvest 1.5L of long-term equity gains this year?
Claude: [compute_tax] LTCG 1,50,000 - 1,25,000 exemption = 25,000 taxable at 12.5% = Rs 3,125 + cess.
```

## Why

Every Indian tax tool wants your data on their servers. The finance MCPs that exist (Fi Money, INDmoney) are cloud-hosted and expose zero tax tooling. itr-mcp flips it: your documents stay local, the LLM never does arithmetic, and every number comes from a versioned rule pack you can audit.

## Tools (v0.2)

| Tool | What it does |
| --- | --- |
| `compute_tax` | Full FY 2025-26 (AY 2026-27) computation: new/old regime slabs, standard deduction, 87A rebate with marginal relief (old regime: total-income threshold, offsets 111A), 111A (20%) / 112A (12.5% above 1.25L) capital gains, surcharge with the 15% gains cap, 4% cess |
| `compare_regimes` | Old vs new side by side, recommended regime, savings amount |
| `schedule_advance_tax` | Jun/Sep/Dec/Mar installment plan (15/45/75/100%) with shortfall tracking |
| `compute_interest_234` | Sections 234B/234C interest with the statutory 12%/36% safe harbors and Rule 119A rounding (principal floored to Rs 100, part month = full month) |
| `compute_hra` | HRA exemption per Rule 2A, period-wise (least of three limbs; FY 2025-26 metros: Delhi/Mumbai/Kolkata/Chennai) + the 80GG alternative |
| `list_deductions` | Old-regime deduction checklist with statutory caps (80C, 80CCD(1B), 80D tiers, HRA metros) |
| `parse_form26as` | Parse the caret-delimited Form 26AS Text export from TRACES into structured TDS entries |
| `parse_ais` | Decrypt + parse the AIS JSON export on-device (AES-256-CBC/PBKDF2 with the password derived from PAN + DOB); normalized rows with label-matched amounts/dates/codes |
| `reconcile_documents` | Form 16 vs AIS vs 26AS mismatch report -- the checks that pre-empt 143(1)(a) intimations and 139(9) defect notices (TDS over-claim, missing employer, undeclared AIS interest/dividend) |
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

- **Local-only.** stdio transport, no network calls, no telemetry. Your PAN never leaves the process (and is masked in text output). AIS decryption happens entirely on-device with Node's crypto -- the reverse-engineered password scheme has un-peppered fallbacks and an explicit `password` override in case the format rotates.
- **The LLM never does math.** Every rupee is computed by pure functions over `data/fy2025-26.json`. Golden-file tests pin the engine to published worked examples (the 12L zero-tax case, the 12,10,000 marginal-relief case, the 12,70,588 relief exhaustion point).
- **Year-parameterized.** Rules live in per-FY JSON packs. FY 2026-27 (Budget 2026: Form 16 renamed to Form 130, 8 HRA metros, buyback reversion) lands as a new pack, not code changes.
- **Not tax advice.** Every response carries disclaimers and the rule-pack version. Verify against the official utility before filing.

## Roadmap

- [x] **v0.1** -- tax engine (both regimes + CG + surcharge + cess), regime comparison, advance tax, deduction checklist, 26AS text parser
- [x] **v0.2** -- `parse_ais` (encrypted AIS JSON, on-device decrypt), `reconcile_documents` (the #1-notice-trigger checks), 234B/234C interest with golden-case tests, HRA + 80GG calculators, old-regime 87A semantics fix
- [ ] **v0.3** (priorities validated against a real AY 2026-27 filing) -- `compute_loss_setoff` (BFLA/CFL engine, [#4](https://github.com/Sagargupta16/itr-mcp/issues/4)), `recommend_itr_form` with loss-continuity awareness ([#3](https://github.com/Sagargupta16/itr-mcp/issues/3)), `parse_form16` (TRACES PDF), broker capital-gains parsers -- Groww first, then Zerodha ([#7](https://github.com/Sagargupta16/itr-mcp/issues/7))
- [ ] **v0.4** -- `compute_schedule_fa` (foreign assets/RSU, Rule 115 rates, [#5](https://github.com/Sagargupta16/itr-mcp/issues/5)), portal quirks playbook ([#6](https://github.com/Sagargupta16/itr-mcp/issues/6)), mutual fund CAS via casparser, draft ITR JSON export, `.mcpb` one-click Claude Desktop bundle, MCP registry listing

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
