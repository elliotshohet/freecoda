# Freecoda interface alignment

Reference review: 2026-10-19. The implementation is original Freecoda code and
assets, informed by the publicly rendered Freebuff interfaces. It does not claim
compatibility with Freebuff accounts, private workspaces, billing, or services.

| Surface | Inspected reference | Freecoda implementation |
| --- | --- | --- |
| Splash | https://freebuff.com/ | Bordered page frame, compact navigation, left-aligned headline/actions, large authentic desktop-source preview, working installation/download entries. |
| Web and chat | https://freebuff.com/app and https://freebuff.com/chat | Persistent conversation/workspace navigation, compact real thread controls, neutral transcript and focused composer using existing Freecoda chat and cloud APIs. |
| Desktop | Public desktop illustrations on the homepage | Compact navigation rail and project/thread sidebar, existing new-chat and workspace controls, conversation canvas, sponsor placement and composer. |
| CLI | https://freebuff.com/cli | Compact branded session header, actual transcript/tool output, bordered input and separate sponsor message. No undocumented reference commands are added. |
| Pricing | https://freebuff.com/plans (redirect from /pricing) | Comparable typographic hierarchy and clear allowances. Freecoda retains one free invite-only beta; paid tiers and hour-based quotas are not copied. |
| Advertising | https://freebuff.com/advertisers | Clear placement explanation and reviewed inquiry flow. No invented advertisers, reach metrics, promotional credits, conversion tracking, or self-service billing. |

The user explicitly chose to retain Freecoda's free beta and reviewed sponsor
inquiries. Native mobile applications, extra release architectures, proprietary
integrations, private reference conversations, and paid business terms are not
claimed or fabricated. Existing trust, approvals, account isolation, encryption,
free-model validation, and deletion semantics remain authoritative.

## Desktop visual provenance

`apps/web/public/images/freecoda-desktop-0.1.8-preview.webp` is a static BrowserOS Neo
rendering of the actual Freecoda desktop renderer HTML, CSS, and logo at
1480 by 950 pixels. Executable scripts and the Electron bridge were omitted.
Empty signed-out general-chat defaults and the package's actual development
version were applied from renderer initialization. There are no private accounts,
projects, messages, or invented task outcomes in the image. It is labeled a
**desktop interface preview**, not an installed-binary runtime screenshot.

## Verification boundaries

Web rendering, responsive navigation, account routing, GitHub OAuth, installer
bytes, typechecking, and builds are verified during delivery. Native packaging,
security, archive, and runtime checks must pass in CI at the exact release source.
Installed Windows/Linux update qualification is a separate receipt-producing
workflow. macOS automatic installation remains unavailable without Developer ID
signing and notarization. Publication and verification results belong in the
versioned changelog after completion.
