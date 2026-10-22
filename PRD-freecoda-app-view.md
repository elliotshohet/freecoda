# PRD: Freecoda browser app view

## 1. Summary

Redesign Freecoda’s `/app` as one clear, IDE-like browser workspace for solo developers who move between asking questions and working in a repository. The new view should make the next step easy to find, keep conversations and project tools in a shared frame, and make repository access obvious at all times.

## 3. Background

Freecoda supports general chat without repository access and project-scoped coding work with a project rail and file, change, preview, and output panels. Today, users move between Chat and Workspace modes inside `/app`. The request is to completely redo this view and make chat and project work feel like one browser IDE. The redesign should preserve the different access levels and each mode’s conversation state while making the overall layout easier to understand.

The first release focuses on the signed-in web app. No evidence from usability testing or analytics was supplied, so the design should be validated with solo developers before wider rollout.

## 4. Objective

Help solo developers understand where to ask general questions, where to work with a repository, and how to move between those jobs without losing their place. Keep repository access explicit and scoped to project work.

**Proposed key results** (planning targets, to confirm after a baseline):

- In usability tests, at least 8 of 10 solo developers correctly identify which mode has repository access without help.
- At least 8 of 10 complete three core tasks without moderator help: start a general chat, open a project file, and switch modes then resume the right conversation.
- Reduce median time to start those tasks by 25% against the current app view, with no increase in repository-context mistakes.

## 5. Market Segment(s)

**Solo developers who alternate between understanding code and changing it.** They handle planning, implementation, and review themselves, and need to move from a question to project work without coordinating with a team. They may be new to Freecoda and need clear signs about which data a message can use.

Constraints: general chat must not gain repository access implicitly; cloud project availability and GitHub access depend on account configuration; users must retain control over changes and publishing.

## 6. Value Proposition(s)

**Solo developers moving between questions and project work**

- **Who:** Developers building or maintaining a project on their own.
- **Why:** They need to understand a problem, make a change, and check the result without losing momentum.
- **What before:** Separate chat and project screens make it harder to see where to go next and can interrupt the work. IDEs and chat tools also split the conversation from the code or require separate setup.
- **How:** One persistent app frame brings conversation, project selection, and work panels together, while clearly showing whether a conversation has repository access.
- **What after:** Developers can find the right mode quickly, continue the right conversation, and inspect project work without losing their place.
- **Alternatives:** A code editor plus a separate AI chat, or a hosted coding workspace with its own assistant. Freecoda should be chosen for its connected chat and project workflow, clear access boundary, and browser-based continuity.

**Value proposition:** Freecoda gives solo developers one understandable place to ask, build, and inspect project work, while making it clear when repository context is in use.

## 7. Solution

### 7.1 UX / prototype

Use a persistent IDE frame rather than separate app screens:

```text
┌ project navigation ┬ conversation and composer ┬ files / preview / output ┐
└────────────────────┴───────────────────────────┴─────────────────────────┘
```

The selected conversation mode stays visible in the frame. On narrow screens, collapse project navigation and let users move between conversation and inspection panels without losing the current project or draft.

### 7.2 Key features

- **Persistent workspace frame:** Keep project navigation and work panels available while users switch between general chat and project work.
- **Clear access state:** Label general chat as repository-free and project conversations as connected to the selected project. Never pass repository context into general chat implicitly.
- **Conversation continuity:** Preserve each mode’s history and draft when switching.
- **Useful first-run state:** Offer clear paths to start a general conversation, open an existing project, or import a repository; explain what each path can access.
- **Responsive controls:** Keep the main conversation usable on mobile, with keyboard focus, readable contrast, and reduced-motion support.

### 7.3 Technology

Build on the existing Next.js `/app`, conversation components, and cloud workspace panels. This is a web UI redesign; no provider, storage, repository-permission, or project-run behavior changes are required for the first version.

### 7.4 Assumptions and open questions

- The primary audience is solo developers, as specified by the user.
- “Easier to use and intuitive to understand” will be measured through task completion, time to start, and correct understanding of repository access.
- The proposed 8-of-10 and 25% targets are starting hypotheses, not agreed commitments. Confirm them after testing a baseline with representative users.
- Confirm which project view should be shown when no project is selected and whether users expect the editor and conversation to remain visible together on small screens.

## 8. Release

**First version:** Redesign the signed-in browser app’s shared frame, conversation modes, first-run state, and mobile layout. Test the core tasks with solo developers, then refine labels and navigation from observed confusion.

**Later:** Consider user-adjustable panel sizes, shortcuts, and saved layouts after the shared view proves understandable.

**Not included:** Desktop and CLI redesigns, new AI or project capabilities, changes to repository permissions, team collaboration, or publishing behavior. A focused web implementation and one usability-test/polish cycle should be sufficient if existing app behavior is retained.
