"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatMarkdownProps = {
  content: string;
  className?: string;
};

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
  return (
    <div className={["gpt-chat-md text-[15px] leading-[1.65] text-foreground/90", className].filter(Boolean).join(" ")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground/85">{children}</em>,
          ul: ({ children }) => <ul className="mb-3 space-y-2.5 last:mb-0">{children}</ul>,
          ol: ({ children }) => (
            <ol className="mb-3 space-y-2.5 last:mb-0 [counter-reset:gpt-ol]">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="relative pl-4 text-foreground/90">
              <div className="min-w-0 [&_p]:mb-1 [&_p:last-child]:mb-0">{children}</div>
            </li>
          ),
          h1: ({ children }) => (
            <h3 className="mb-2 mt-1 text-[17px] font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-1 text-[16px] font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-1 text-[15px] font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h4>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground/70"
            >
              {children}
            </a>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = Boolean(codeClassName?.includes("language-"));
            if (isBlock) {
              return (
                <code className="block whitespace-pre-wrap font-mono text-[13.5px] leading-relaxed text-foreground/90">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded-md bg-foreground/10 px-1.5 py-0.5 font-mono text-[13.5px] text-foreground">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-xl border border-border/50 bg-background/50 px-3 py-2.5 last:mb-0">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-foreground/20 pl-3 text-muted-foreground last:mb-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border/60" />,
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto last:mb-0">
              <table className="w-full min-w-[16rem] border-collapse text-left text-[14px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border/70 text-foreground">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border/40">{children}</tbody>,
          tr: ({ children }) => <tr className="align-top">{children}</tr>,
          th: ({ children }) => (
            <th className="px-2 py-1.5 font-semibold first:pl-0 last:pr-0">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1.5 text-foreground/90 first:pl-0 last:pr-0">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
