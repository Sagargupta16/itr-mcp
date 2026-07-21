# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.3.0] - 2026-07-21

### Changed

- **Renamed `itr-mcp` -> `itr-agent`** (npm package, bin, GitHub repo, MCP server name). The `itr-mcp` npm package is deprecated and frozen at 0.2.0; update MCP configs to `npx -y itr-agent`. GitHub redirects the old repo URL.
- Positioning: filing agent, not just calculator -- the new prompt + tools guide a filer end to end, while the final submit stays with the taxpayer (no public filing API exists; only authorized ERIs may file on someone's behalf).

### Added

- `recommend_itr_form` ([#3](https://github.com/Sagargupta16/itr-agent/issues/3)): ITR-1/2/3/4 selection for individuals with rule-by-rule reasoning, ruled-out trail, deadlines and 234F late fees from the rule pack. Loss-continuity aware: brought-forward business/speculative losses force ITR-3 even with zero current-year business income (Schedule CFL), including the nil-business ITR-3 mechanics guidance (No Account Case zeros, nil Trading & P&L). Encodes the AY 2025-26 carve-in of 112A LTCG up to Rs 1.25L into ITR-1/ITR-4. Eligibility rules per incometax.gov.in "Which ITR is applicable" (AY 2026-27)
- `filing_checklist`: ordered, form-specific walkthrough (gather -> reconcile -> compute -> portal -> e-verify) with schedule-level portal steps per form and the explicit taxpayer-presses-submit boundary
- `file_my_itr` MCP prompt: the guided interview -- one question at a time, income heads, disqualifier sweep, losses, then form -> regime -> reconciliation -> checklist, all numbers from tools

### Fixed

- Stale test title ("lists all six tools") corrected to the actual twelve-tool surface

### Added

- `parse_ais`: on-device decryption (AES-256-CBC, PBKDF2-HMAC-SHA256 x1000, password derived from PAN + DOB with the reverse-engineered pepper + un-peppered fallbacks + explicit override) and normalization of the AIS JSON export -- taxpayer info + flat information rows with label-matched amounts/dates/codes, PAN masked in text output
- `reconcile_documents`: Form 16 vs AIS vs 26AS mismatch report (H1 TDS over-claim vs 26AS, H3 missing-employer TAN, H4/H5 undeclared AIS interest/dividend, M1 Form 16-vs-26AS per TAN, M3 gross-salary-vs-AIS) with tiered tolerances (Rs 10 statutory slack), skipped-check reporting, and notice-section mapping (143(1)(a), 139(9))
- `compute_interest_234`: sections 234B/234C with Rule 119A rounding (interest principal floored to Rs 100, part month = full month), statutory 12%/36% safe harbors measured back from 15%/45% when breached, presumptive single-installment mode -- pinned to 5 published golden cases (Suraj 920, Khushal 93, company 605, ClearTax 2,600, boundary 12%/11.99%)
- `compute_hra`: Rule 2A least-of-three, period-wise, salary = basic + retirement-forming DA + fixed-% turnover commission (Gestetner); FY 2025-26 metro list correctly 4 cities (the 8-city expansion is FY 2026-27); landlord-PAN warning above 1L rent; 80GG companion with its three limbs
- Rule pack 1.1.0: rounding hierarchy (288A/288B/119A), interest config with per-installment safe harbors, HRA + 80GG config, reconcile tolerances, TDS-section-to-income-head map

### Fixed

- Old-regime 87A semantics: the 5L threshold now tests TOTAL income including capital gains (was normal income only), and the rebate can offset 111A STCG tax under the old regime (s.112A(6) continues to bar 112A in both regimes) -- driven by rule-pack flags

### Changed

- Test suite grown to 47 tests including AIS encrypt/decrypt round-trips and all published interest/HRA golden cases

## [0.1.0] - 2026-07-06

### Added

- MCP server (stdio, SDK 1.29) with six read-only tools: `compute_tax`, `compare_regimes`, `schedule_advance_tax`, `list_deductions`, `parse_form26as`, `list_tax_years`
- Deterministic FY 2025-26 (AY 2026-27) tax engine: new/old regime slabs, standard deduction, 87A rebate with marginal relief (new regime), 111A 20% / 112A 12.5% capital gains with the 1.25L exemption, surcharge with 15% gains cap and 25% new-regime cap, 4% cess
- Versioned rule pack (`data/fy2025-26.json`) as the single source of every constant
- Form 26AS caret-delimited text parser with PII masking in text output
- Advance tax installment planner (15/45/75/100% cumulative) with shortfall tracking
- Test suite: 21 tests including golden cases (12L zero tax, 12,10,000 marginal relief, 12,70,588 exhaustion) and in-memory MCP client round trips
