"use client";

import { Fragment, useState, type ElementType, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import styles from "./markdown-message.module.css";

function safeHref(value: string) {
  try {
    const url = new URL(value, "https://freecoda.invalid");
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function Inline({ text }: { text: string }) {
  const token = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|!?\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\))/g;
  return <>{text.split(token).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`")) return <code className={styles.inlineCode} key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("_") && part.endsWith("_")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
    if (link) {
      const href = safeHref(link[3]);
      if (link[1]) return <span key={index} aria-label={link[2] || "image"}>[{link[2] || "image"}]</span>;
      return href ? <a key={index} href={href} title={link[4]} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{link[2]}</a> : <Fragment key={index}>{part}</Fragment>;
    }
    return part;
  })}</>;
}

function HighlightCode({ code, language }: { code: string; language: string }) {
  if (!/^(?:[cm]?[jt]sx?|json|py(?:thon)?|sh|bash|sql|css|html)$/i.test(language)) return <>{code}</>;
  const tokens = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|\b(?:const|let|var|function|return|if|else|for|while|class|import|from|export|async|await|def|True|False|None|true|false|null|select|from|where|insert|update|delete|create|table|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE)\b|\b\d+(?:\.\d+)?\b)/g;
  return <>{code.split(tokens).map((part, index) => {
    if (!part) return null;
    const kind = /^["'`]/.test(part) ? styles.string : /^(?:\/\/|\/\*|#)/.test(part) ? styles.comment : /^\d/.test(part) ? styles.number : /^(?:const|let|var|function|return|if|else|for|while|class|import|from|export|async|await|def|True|False|None|true|false|null|select|where|insert|update|delete|create|table)$/i.test(part) ? styles.keyword : "";
    return kind ? <span key={index} className={kind}>{part}</span> : part;
  })}</>;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  return <div className={styles.codeBlock}>
    <div className={styles.codeHeader}>
      <span>{language || "Code"}</span>
      <button type="button" aria-label="Copy code" onClick={async () => {
        try { await navigator.clipboard.writeText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
      }}>{copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? "Copied" : "Copy"}</span></button>
    </div>
    <pre><code><HighlightCode code={code} language={language} /></code></pre>
  </div>;
}

function isTableRule(line: string) {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function cells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

export function MarkdownMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
    if (fence) {
      const start = ++i;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) i++;
      const code = lines.slice(start, i).join("\n");
      if (i < lines.length) i++;
      blocks.push(<CodeBlock key={`code-${blocks.length}`} code={code} language={fence[1]} />);
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const Tag = `h${heading[1].length}` as ElementType;
      blocks.push(<Tag key={`heading-${blocks.length}`}><Inline text={heading[2]} /></Tag>);
      i++; continue;
    }
    const list = line.match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const ordered = /^\d/.test(list[1]);
      const Tag = ordered ? "ol" : "ul";
      const items: React.ReactNode[] = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s{0,3}([-+*]|\d+[.)])\s+(.+)$/);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        items.push(<li key={items.length}><Inline text={item[2]} /></li>);
        i++;
      }
      blocks.push(<Tag key={`list-${blocks.length}`}>{items}</Tag>);
      continue;
    }
    if (i + 1 < lines.length && line.includes("|") && isTableRule(lines[i + 1])) {
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(cells(lines[i++])); }
      blocks.push(<div className={styles.tableWrap} key={`table-${blocks.length}`}><table><thead><tr>{head.map((cell, n) => <th key={n}><Inline text={cell} /></th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{head.map((_, k) => <td key={k}><Inline text={row[k] || ""} /></td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: React.ReactNode[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(<p key={quote.length}><Inline text={lines[i++].replace(/^\s*>\s?/, "")} /></p>);
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{quote}</blockquote>);
      continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*#{1,6}\s/.test(lines[i]) && !/^\s{0,3}([-+*]|\d+[.)])\s+/.test(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && isTableRule(lines[i + 1]))) paragraph.push(lines[i++]);
    blocks.push(<p key={`p-${blocks.length}`}><Inline text={paragraph.join("\n")} /></p>);
  }
  return <div className={styles.markdown}>{blocks}</div>;
}
