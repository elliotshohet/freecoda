"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ArrowUpRight, Terminal } from "lucide-react";
import Link from "next/link";
import {
  CLI_INSTALL_COMMAND,
  CLI_PUBLISHED,
  CLI_SHELL_INSTALL_COMMAND,
  CLI_SHELL_INSTALLER_PUBLISHED,
  DESKTOP_PUBLISHED,
} from "@/lib/releases";

function InstallCommand({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { setCopied(false); setError(""); }, [command]);
  return <>
    <div className="install-command">
      <Terminal size={17} aria-hidden="true" />
      <code>{command}</code>
      <button type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={async () => {
        try {
          setError("");
          await navigator.clipboard.writeText(command);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
          setError("Copy was unavailable. Select and copy the command above.");
        }
      }}>
        {copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
      </button>
    </div>
    <span role="status" className={error ? "install-copy-status" : "sr-only"}>{copied ? "Install command copied." : error}</span>
  </>;
}

export function Install({ compact = false }: { compact?: boolean }) {
  const [localCommand, setLocalCommand] = useState<string | null>(null);
  useEffect(() => {
    const { protocol, hostname, port } = window.location;
    if (protocol !== "http:" || port !== "3010" || !["localhost", "127.0.0.1"].includes(hostname)) return;
    const abort = new AbortController();
    // Only known loopback origins may produce a shell command from page location.
    const host = hostname === "localhost" ? "localhost" : "127.0.0.1";
    void fetch("/install.sh", { cache: "no-store", signal: abort.signal })
      .then(async response => response.ok && (await response.text()).startsWith("#!/bin/sh"))
      .then(available => { if (available && !abort.signal.aborted) setLocalCommand(`curl -fsSL http://${host}:3010/install.sh | sh`); })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  const shell = Boolean(localCommand) || CLI_SHELL_INSTALLER_PUBLISHED;
  const command = localCommand || (CLI_SHELL_INSTALLER_PUBLISHED ? CLI_SHELL_INSTALL_COMMAND : CLI_INSTALL_COMMAND);
  return (
    <div className={compact ? "install compact" : "install"}>
      {localCommand && <p className="install-preview-label">Local shell installer preview · public deployment pending</p>}
      <InstallCommand command={command} label={localCommand ? "local preview install command" : "install command"} />
      {!CLI_SHELL_INSTALLER_PUBLISHED && !localCommand && <p className="install-preview-label">Shell installer deployment pending. This npm command uses the published CLI.</p>}
      <details className="install-alternatives">
        <summary>{shell ? "Prefer npm?" : "Preview the upcoming shell installer"}</summary>
        {shell ? <InstallCommand command={CLI_INSTALL_COMMAND} label="npm install command" /> : <>
          <code className="pending-shell-command">{CLI_SHELL_INSTALL_COMMAND}</code>
          <p>Public deployment pending. Use the working command above until this endpoint is published.</p>
        </>}
      </details>
      {(!compact || !CLI_PUBLISHED) && (
        <div className="install-note">
          {CLI_PUBLISHED ? "Node.js 22+" : "CLI publication processing"}{" "}<span>·</span>{" "}
          <Link href={CLI_PUBLISHED ? "/docs#installation" : "/app"}>{CLI_PUBLISHED ? "Installation guide" : "Use the browser beta"} <ArrowUpRight size={12} aria-hidden="true" /></Link>
        </div>
      )}
      {!compact && DESKTOP_PUBLISHED && <a className="desktop-install-link" href="/docs#desktop">Download the desktop beta <ArrowUpRight size={13} aria-hidden="true" /></a>}
    </div>
  );
}
