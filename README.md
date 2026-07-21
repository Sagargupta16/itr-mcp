# itr-agent

[![npm](https://img.shields.io/npm/v/itr-agent?label=npm)](https://www.npmjs.com/package/itr-agent)
[![CI](https://github.com/Sagargupta16/itr-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Sagargupta16/itr-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-blueviolet)](https://modelcontextprotocol.io)

Local-first ITR filing agent for Indian income tax. Claude interviews you one question at a time, picks your ITR form, computes your tax deterministically on your machine, reconciles your documents, and walks you to the portal's submit button -- no accounts, no uploads, no cloud.

Works with Claude Desktop, Claude Code, and any MCP client. Formerly published as [`itr-mcp`](https://www.npmjs.com/package/itr-mcp).

```
You:    Help me file my ITR.
Claude: [file_my_itr] One question at a time. First: were you a resident of India
        for all of FY 2025-26?
You:    Yes, salaried, and I have vested US RSUs from my employer.
Claude: [recommend_itr_form] Foreign assets (Schedule FA) rule out ITR-1: you file
        ITR-2, due 2026-07-31. Next: how many employers this year?
```

## Why

Every Indian tax tool wants your data on their servers. itr-agent flips it: your documents stay local, the LLM never does arithmetic, and every number comes from a versioned rule pack you can audit. The agent layer drives the interview; the deterministic engine does the math.

**What it will never do:** submit the return for you. India has no public filing API -- returns are filed by you on [incometax.gov.in](https://www.incometax.gov.in) (or by an authorized ERI/CA). The agent takes you to that button with every number verified; you press it.

## The agent

`file_my_itr` (MCP prompt) runs the guided interview:

1. Residency, age band -- one question at a time
2. Income heads: salary, house property, capital gains, business/F&O, other sources
3. Disqualifier sweep: foreign RSUs/ESPP, director role, unlisted shares, ESOP deferral
4. Losses, current and brought-forward (they change the form)
5. `recommend_itr_form` -> the form, with rule-by-rule reasoning
6. `compare_regimes` -> the regime, with real numbers
7. `parse_ais` / `parse_form26as` / `reconcile_documents` -> fix mismatches BEFORE filing
8. `schedule_advance_tax` / `compute_interest_234` if applicable
9. `filing_checklist` -> schedule-by-schedule portal walkthrough, ending at e-verification

## Tools (v0.3)

| Tool | What it does |
| --- | --- |
| `recommend_itr_form` | ITR-1/2/3/4 selection with rule-by-rule reasoning and loss-continuity awareness: brought-forward business losses force ITR-3 even with zero current-year business income (Schedule CFL) |
| `filing_checklist` | Ordered, form-specific walkthrough: documents, reconciliation, computation, portal steps schedule by schedule, e-verification |
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
claude mcp add itr-agent -- npx -y itr-agent
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "itr-agent": {
      "command": "npx",
      "args": ["-y", "itr-agent"]
    }
  }
}
```

### From source

```bash
git clone https://github.com/Sagargupta16/itr-agent
cd itr-agent && pnpm install && pnpm build
node dist/index.js   # stdio server
```

### Migrating from itr-mcp

Same server, new name. Replace `itr-mcp` with `itr-agent` in your MCP config; the `itr-mcp` npm package is deprecated and frozen at v0.2.0.

## Example prompts

- "Help me file my ITR." (starts the guided interview)
- "I'm salaried with US RSUs and 2L of equity LTCG -- which ITR form am I supposed to file?"
- "My CTC is 18L with 50K NPS through my employer -- which regime should I pick for FY 2025-26?"
- "My estimated tax is 2.4L and TDS covers 1.8L. Plan my advance tax installments."
- "Parse `C:/tax/26AS.txt` and total the TDS my employer deposited."

## Scope and limitations

Honest boundaries, so you know before you rely on it:

- **Resident individuals, FY 2025-26 (AY 2026-27).** NRI/RNOR computation differs (the form recommendation accounts for residency, the tax engine assumes resident).
- **No filing.** There is no public API to submit an ITR; only you or an authorized ERI can file. The agent prepares and verifies everything, then hands over.
- **Not yet modeled:** business P&L computation (presumptive supported in advance-tax/interest logic), crypto/VDA (115BBH), loss set-off arithmetic ([#4](https://github.com/Sagargupta16/itr-agent/issues/4)), Schedule FA valuation ([#5](https://github.com/Sagargupta16/itr-agent/issues/5)).
- **Not tax advice.** Complex cases belong with a CA. Every output says so.

## Design principles

- **Local-only.** stdio transport, no network calls, no telemetry. Your PAN never leaves the process (and is masked in text output). AIS decryption happens entirely on-device with Node's crypto -- the reverse-engineered password scheme has un-peppered fallbacks and an explicit `password` override in case the format rotates.
- **The LLM never does math.** Every rupee is computed by pure functions over `data/fy2025-26.json`. Golden-file tests pin the engine to published worked examples (the 12L zero-tax case, the 12,10,000 marginal-relief case, the 12,70,588 relief exhaustion point).
- **The agent drives, the engine decides.** The interview sequencing is a prompt; every number and every form rule is deterministic code. Nothing is estimated.
- **Year-parameterized.** Rules live in per-FY JSON packs. FY 2026-27 (Budget 2026: Form 16 renamed to Form 130, 8 HRA metros, buyback reversion) lands as a new pack, not code changes.
- **Not tax advice.** Every response carries disclaimers and the rule-pack version. Verify against the official utility before filing.

## Roadmap

- [x] **v0.1** -- tax engine (both regimes + CG + surcharge + cess), regime comparison, advance tax, deduction checklist, 26AS text parser
- [x] **v0.2** -- `parse_ais` (encrypted AIS JSON, on-device decrypt), `reconcile_documents` (the #1-notice-trigger checks), 234B/234C interest with golden-case tests, HRA + 80GG calculators, old-regime 87A semantics fix
- [x] **v0.3** -- renamed to **itr-agent**; `recommend_itr_form` with loss-continuity awareness ([#3](https://github.com/Sagargupta16/itr-agent/issues/3)), `filing_checklist`, the `file_my_itr` guided interview prompt
- [ ] **v0.4** (priorities validated against a real AY 2026-27 filing) -- `compute_loss_setoff` (BFLA/CFL engine, [#4](https://github.com/Sagargupta16/itr-agent/issues/4)), `parse_form16` (TRACES PDF), broker capital-gains parsers -- Groww first, then Zerodha ([#7](https://github.com/Sagargupta16/itr-agent/issues/7))
- [ ] **v0.5** -- `compute_schedule_fa` (foreign assets/RSU, Rule 115 rates, [#5](https://github.com/Sagargupta16/itr-agent/issues/5)), portal quirks playbook ([#6](https://github.com/Sagargupta16/itr-agent/issues/6)), mutual fund CAS via casparser, draft ITR JSON export, `.mcpb` one-click Claude Desktop bundle, MCP registry listing

## Development

```bash
pnpm install
pnpm test          # vitest: engine golden files + in-memory MCP client tests
pnpm build
pnpm inspect       # MCP inspector against dist/index.js
```

## Disclaimer

itr-agent is an open-source calculator, document parser, and filing guide. It is not a substitute for professional tax advice, and it never files anything -- output is meant to be verified against the official income tax utility, and the return is always submitted by you on the portal.

## License

[MIT](LICENSE)
