"use client";

import { useMemo, useState } from "react";

const supportedMathPattern = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$/g;

export function normalizeKatexDisplayLatex(latex) {
  return String(latex ?? "")
    .replace(/\n\s*\n/g, "\n")
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_match, math) => `\\(${math.replace(/\s+/g, " ").trim()}\\)`)
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_match, math) => `\\[${math.trim()}\\]`)
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_match, math) => `$$${math.trim()}$$`);
}

export function parseSupportedMath(text) {
  const value = String(text ?? "");
  const parts = [];
  let lastIndex = 0;

  supportedMathPattern.lastIndex = 0;
  for (const match of value.matchAll(supportedMathPattern)) {
    const latex = match[0];
    const index = match.index;
    if (index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, index) });
    }
    parts.push({
      display: latex.startsWith("\\[") || latex.startsWith("$$"),
      type: "math",
      value: latex
    });
    lastIndex = index + latex.length;
  }

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }

  return parts;
}

export function MathCopySpan({ latex, display = false, children, onOpen }) {
  return (
    <span
      className={`math-copy ${display ? "math-copy-display" : "math-copy-inline"}`}
      role="button"
      tabIndex={0}
      title="Open LaTeX source"
      aria-label="Open LaTeX source"
      onClick={() => onOpen(latex)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(latex);
      }}
    >
      {children ?? latex}
    </span>
  );
}

export function MathLatexModal({ latex, onClose }) {
  const [copyLabel, setCopyLabel] = useState("Copy");
  if (!latex) return null;

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(latex);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    } catch (_error) {
      setCopyLabel("Unavailable");
      window.setTimeout(() => setCopyLabel("Copy"), 1200);
    }
  }

  return (
    <div className="math-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="math-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="math-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="math-modal-header">
          <h2 id="math-modal-title">LaTeX source</h2>
          <button type="button" className="math-modal-icon-button" onClick={onClose} aria-label="Close">
            x
          </button>
        </header>
        <textarea className="math-modal-source" value={latex} readOnly rows={8} />
        <footer className="math-modal-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" onClick={copyLatex}>
            {copyLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function MathText({ text, className = "", renderMath, normalizeDisplayLatex }) {
  const [activeLatex, setActiveLatex] = useState("");
  const parts = useMemo(() => parseSupportedMath(text), [text]);

  return (
    <>
      <span className={className}>
        {parts.map((part, index) => {
          if (part.type === "text") return <span key={index}>{part.value}</span>;

          const displayLatex = normalizeDisplayLatex ? normalizeDisplayLatex(part.value) : part.value;

          return (
            <MathCopySpan key={index} latex={part.value} display={part.display} onOpen={setActiveLatex}>
              {renderMath ? renderMath(displayLatex, part.value) : displayLatex}
            </MathCopySpan>
          );
        })}
      </span>
      <MathLatexModal latex={activeLatex} onClose={() => setActiveLatex("")} />
    </>
  );
}
