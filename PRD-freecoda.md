# PRD: Freecoda

## 1. Summary

Freecoda is a free assistant and coding agent for solo developers across browser, desktop, and terminal. This plan improves repeat use and grows sponsor revenue through visible, clearly labeled placements.

## 3. Background

Solo developers handle questions, code changes, testing, and review themselves. Freecoda combines general chat with repository-aware coding help, shared history, and explicit controls for project access, edits, and commands.

Freecoda is free forever and supported by direct sponsors. Its pricing page keeps ads out of code and assistant answers and rules out targeting with private code or conversations. Hosted AI is invite-only during beta with fair-use limits. The opportunity is to grow useful engagement and sponsor clicks within those expectations.

## 4. Objective

Help solo developers keep moving from a question to a reviewed code change in the client that suits them. Grow repeat use and sponsor revenue while preserving trust, task success, and the free product promise.

**Proposed key results.** Targets below are starting hypotheses; confirm them against a 28-day baseline before committing:

- Increase average engaged minutes per weekly active account by 20%, with no decline in completion of core chat and coding tasks.
- Increase viewable sponsor impressions per weekly active account by 25% across supported clients, without adding ads to code, assistant answers, or permission flows.
- Increase sponsor click-through rate by 15% while keeping sponsor identification clear and tracking based on placement events, not private code or conversation content.

## 5. Market Segment(s)

**Solo developers who understand, build, and review software themselves.** They move between open-ended questions, local projects, and hosted repositories. They need useful help without granting project access by accident.

The first version focuses on this segment across browser, desktop, and terminal. Small teams and organization-wide workflows can wait.

## 6. Value Proposition(s)

**Solo developers moving from an idea or question to working software**

- **Who:** Developers building or maintaining software on their own.
- **Why:** They need to solve a problem, make a change, and check the result without losing momentum.
- **What before:** They switch between chat, an editor, terminal, and repository tools; context and access boundaries can be unclear.
- **How:** Freecoda provides general chat and project-aware coding across clients, with shared history, explicit access, reviewed changes, and approved commands.
- **What after:** They continue across devices, know what the assistant can access, and review work before accepting it.
- **Alternatives:** A code editor with a separate AI chat, a hosted coding agent, or a self-configured local tool using a provider API key. Freecoda combines the common jobs in a free, open-source product without hiding repository access or approval steps.

**Value proposition:** Freecoda gives solo developers one free assistant for thinking, coding, and review across the tools they use, with control over project access and changes. Clearly labeled sponsors help keep the service free.

## 7. Solution

### 7.1 UX / key flow

Start with repository-free chat, or explicitly select a trusted folder or hosted project for coding. Keep its files, changes, previews, output, and conversation together across clients. Place clearly labeled sponsors separately from answers and generated code.

### 7.2 Key features

- **One assistant across clients:** General chat, coding help, shared history, and consistent language in browser, desktop, and terminal.
- **Clear project boundary:** Repository access starts only after explicit selection or trust. Keep file writes and shell commands behind their existing review and approval steps.
- **Complete coding loop:** Help users inspect a project, plan or build, review diffs, run approved actions, and check output before publishing.
- **Useful return path:** Preserve drafts, sync history, and explain offline and hosted-capacity states.
- **Sponsor-supported free access:** Use direct, clearly labeled placements with visible sponsor calls to action. Measure viewable impressions and clicks separately from assistant content.
- **Usability and trust checks:** Track task completion, time, return use, sponsor views, and clicks without sending private code or conversation content to sponsors.

### 7.3 Technology

Build on the existing Bun/TypeScript monorepo: Next.js web app, Electron desktop client, CLI, shared agent core, and contracts. Preserve the approved free-model routing and usage limits, account isolation, encryption, repository trust, and approval boundaries.

### 7.4 Assumptions and open questions

- Solo developers are the whole-product audience for this first plan, as specified by the user.
- “A lot of time” means engaged use that helps users finish work, not time caused by extra steps. Measure session time with task success and abandonment as guardrails.
- The proposed metric increases are hypotheses; confirm targets after collecting a baseline. Define a viewable sponsor impression consistently across web, desktop, and terminal.
- This draft assumes the current direct-sponsor model remains: clear labels, no sponsor content in code or assistant answers, and no targeting from private code or conversations. Confirm whether the user intends a broader ad model or a higher placement frequency that changes this promise.
- Revenue per click, sponsor demand, and acceptable placement frequency were not provided. Validate these before promising revenue impact.

## 8. Release

**First:** Improve the core workflow across clients, clarify access and approvals, and measure sponsor views and clicks consistently. Test usability and sponsor comprehension before increasing placement frequency.

**Later:** Expand placements or sponsor tools only after usability, return use, and sponsor performance support the change.

**Not in this release:** Team collaboration, paid plans, ads inside code or answers, targeting with private project data, or weaker repository and action approvals. One cross-client implementation and test/refine cycle is expected; timing depends on the chosen ad model and analytics coverage.
