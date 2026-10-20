---
target: /Users/egg/Documents/freecoda/apps/desktop/src/renderer/index.html
total_score: 27
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
target_identity: "file:/Users/egg/Documents/freecoda/apps/desktop/src/renderer/index.html"
target_fingerprint: "sha256:7c6f9de3343caadb4c5895b9f6065759f8112eee9304211b4ef317ae467c803d"
target_path: /Users/egg/Documents/freecoda/apps/desktop/src/renderer/index.html
timestamp: 2026-10-20T12-46-59Z
slug: src-renderer-index-html
---
Method: dual-agent (A: /root/design_review; B: /root/evidence_review)

# Baseline design critique

Source-based heuristic scores; live web evidence supplements the independent review.

| Heuristic | Score /4 |
|---|---:|
| System status | 3 |
| Real-world match | 3 |
| User control | 3 |
| Consistency | 3 |
| Error prevention | 3 |
| Recognition | 2 |
| Efficiency | 3 |
| Minimalism | 2 |
| Recovery | 2 |
| Help | 3 |
| Total | 27/40 |

## Design specificity
Freecoda-specific trust, mode, account, queue and approval workflows give the product its identity. Preserve its restrained existing visual language.

## Working well
Explicit chat/project boundaries, clear approval scope, draft preservation and keyboard accelerators.

## Priority issues
P1: Dark shared keyboard focus blends into dark surfaces. P2: New chat is hidden in Workspace actions. Small secondary labels need a readability floor. Broader session navigation and operation-specific recovery remain follow-ups.
Use polish for this bounded pass.

## Evidence
Web detector: one conventional blockquote false positive. Desktop: 24 warnings and 9 advisories; fixed-height controls and later CSS overrides produce false positives. CLI: zero markup findings, not ANSI usability validation. Live signed-in web at 390px and 2748px has no horizontal overflow. Mutable overlay succeeded in temporary Neo tab, then cleaned up.

## Persona flags and emotional journey
Sam: weak dark keyboard focus. Jordan: hidden desktop New chat. Alex: short CLI approvals hide useful action context. Existing safeguards reassure users; unavailable service and integration states remain the main recovery friction.

## Minor observations
Navigation grouping, terminology and notice hierarchy need a separate deliberate pass; avoid changing product claims or flattening important safety information.

## Questions to consider
Can approval evidence remain visible at every supported size? Can users find New chat immediately?

Questions skipped: user already instructed implementation across all three clients; no further scope decision required.
