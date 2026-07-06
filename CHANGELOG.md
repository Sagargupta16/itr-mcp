# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.1.0] - 2026-07-06

### Added

- MCP server (stdio, SDK 1.29) with six read-only tools: `compute_tax`, `compare_regimes`, `schedule_advance_tax`, `list_deductions`, `parse_form26as`, `list_tax_years`
- Deterministic FY 2025-26 (AY 2026-27) tax engine: new/old regime slabs, standard deduction, 87A rebate with marginal relief (new regime), 111A 20% / 112A 12.5% capital gains with the 1.25L exemption, surcharge with 15% gains cap and 25% new-regime cap, 4% cess
- Versioned rule pack (`data/fy2025-26.json`) as the single source of every constant
- Form 26AS caret-delimited text parser with PII masking in text output
- Advance tax installment planner (15/45/75/100% cumulative) with shortfall tracking
- Test suite: 21 tests including golden cases (12L zero tax, 12,10,000 marginal relief, 12,70,588 exhaustion) and in-memory MCP client round trips
