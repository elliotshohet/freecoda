"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ArrowUpRight, Terminal } from "lucide-react";
import Link from "next/link";
import {
  CLI_INSTALL_COMMAND,
  CLI_PUBLISHED,
  DESKTOP_PUBLISHED,
} from "@/lib/releases";
export function Install({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const command = CLI_INSTALL_COMMAND;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={compact ? "install compact" : "install"}>
      <div className="install-command">
        <Terminal size={17} />
        <code>{command}</code>
        <button
          aria-label={
            CLI_PUBLISHED
              ? "Copy install command"
              : "Copy upcoming install command"
          }
          onClick={async () => {
            try {
              setError("");
              await navigator.clipboard.writeText(command);
              setCopied(true);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1800);
            } catch {
              setCopied(false);
              setError(
                "Copy was unavailable. Select and copy the command above.",
              );
            }
          }}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <span role="status" className="sr-only">
        {copied ? "Install command copied." : error}
      </span>
      {(!compact || !CLI_PUBLISHED) && (
        <div className="install-note">
          {CLI_PUBLISHED ? "Node.js 22+" : "CLI publication processing"}{" "}
          <span>·</span>{" "}
          <Link href={CLI_PUBLISHED ? "/docs#installation" : "/app"}>
            {CLI_PUBLISHED ? "Installation guide" : "Use the browser beta"}{" "}
            <ArrowUpRight size={12} />
          </Link>
        </div>
      )}
      {!compact && DESKTOP_PUBLISHED && (
        <a className="desktop-install-link" href="/docs#desktop">
          Download the desktop beta{" "}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
