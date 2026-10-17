"use client";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileCode2,
  GitBranch,
  ShieldCheck,
  Play,
  RotateCcw,
} from "lucide-react";
const modes = ["Build", "Fix", "Understand"] as const;
const examples = {
  Build: {
    prompt: "Add a dark mode toggle to my app",
    plan: "I’ll follow your existing theme and add a toggle.",
    file: "src/components/theme-toggle.tsx",
    lines: [
      '+ import { useTheme } from "./theme"',
      "+",
      "+ export function ThemeToggle() {",
      "+   const { theme, toggle } = useTheme()",
      "+   return (",
      "+     <button onClick={toggle}>",
      '+       {theme === "dark" ? "☀" : "☾"}',
      "+     </button>",
      "+   )",
      "+ }",
    ],
    done: "Theme toggle added. Your styles, respected.",
  },
  Fix: {
    prompt: "Fix the empty state in my project list",
    plan: "I found the missing empty state. Here’s the change.",
    file: "src/components/project-list.tsx",
    lines: [
      "  export function ProjectList({ projects }) {",
      "+   if (projects.length === 0) {",
      "+     return <EmptyState",
      '+       title="Your next project starts here"',
      "+       action={<CreateProject />}",
      "+     />",
      "+   }",
      "    return projects.map(renderProject)",
      "  }",
    ],
    done: "Empty state added. Existing projects still render.",
  },
  Understand: {
    prompt: "How does authentication work in this repo?",
    plan: "I traced the sign-in flow through three files.",
    file: "src/lib/auth.ts",
    lines: [
      "  Your authentication flow",
      "",
      "  sign-in.tsx → POST /api/auth/sign-in",
      "  auth.ts     → validates the session",
      "  proxy.ts    → protects private routes",
      "",
      "  Session cookies are HTTP-only.",
      "  GitHub is the configured provider.",
    ],
    done: "Three files read. No files changed.",
  },
};
export function TerminalDemo() {
  const [mode, setMode] = useState<(typeof modes)[number]>("Build");
  const [run, setRun] = useState(true);
  const e = examples[mode];
  return (
    <div className="terminal-wrap">
      <div className="terminal-shadow" />
      <div className="terminal">
        <div className="terminal-title">
          <div className="window-dots">
            <i />
            <i />
            <i />
          </div>
          <span>freecoda — my-next-project</span>
          <GitBranch size={13} />
        </div>
        <div className="terminal-body">
          <div className="terminal-context">
            <span className="mini-mark">fc</span> Freecoda{" "}
            <span className="terminal-version">local preview</span>
          </div>
          <div className="prompt">
            <ChevronRight size={15} />
            <span>{e.prompt}</span>
          </div>
          <div className="agent-line">
            <span className="agent-star">✳</span>
            <span>{e.plan}</span>
          </div>
          {run ? (
            <>
              <div className="code-panel">
                <div className="code-file">
                  <FileCode2 size={12} />
                  {e.file}
                  <span>
                    {mode === "Understand" ? "read only" : "+ new change"}
                  </span>
                </div>
                <pre>
                  {e.lines.map((l, i) => (
                    <span key={i} className={l.startsWith("+") ? "added" : ""}>
                      <b>{i + 1}</b>
                      {l}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </div>
              <div className="terminal-result">
                <Check size={13} />
                {e.done}
              </div>
            </>
          ) : (
            <div className="demo-paused">
              Ready when you are. Run the example to inspect the change.
            </div>
          )}
          <div className="terminal-bottom">
            <span>
              <ShieldCheck size={12} /> You approve every change
            </span>
            <button
              onClick={() => setRun(!run)}
              aria-label={run ? "Reset example" : "Run example"}
            >
              {run ? <RotateCcw size={12} /> : <Play size={12} />}
            </button>
          </div>
        </div>
      </div>
      <div className="terminal-caption">
        <div className="demo-tabs" aria-label="Example tasks">
          {modes.map((m) => (
            <button
              key={m}
              className={mode === m ? "active" : ""}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setRun(true);
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <span>Interactive illustration</span>
      </div>
    </div>
  );
}
