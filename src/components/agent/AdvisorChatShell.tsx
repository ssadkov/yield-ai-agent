"use client";

import { useEffect, useRef, useState } from "react";
import { ActionCard } from "@/components/agent/ActionCard";
import { ChatMarkdown } from "@/components/agent/ChatMarkdown";
import {
  clearAdvisorChatHistory,
  historyFromUiMessages,
  loadAdvisorChatHistory,
  saveAdvisorChatHistory,
} from "@/lib/advisor/history";
import {
  makeUiMessage,
  runAdvisorTurn,
  startAdvisorSession,
  type AdvisorSession,
  type UiMessage,
} from "@/lib/advisor/runTurn";
import type { AttestationSummary } from "@/lib/advisor/nearProxy";

const VERIFICATION_CENTER_URL = "https://docs.near.ai/cloud/verification/verification-center";

function attestationTitle(attestation: AttestationSummary, model: string | null): string {
  const gpu = attestation.gpuEvidence === "verified" ? "NVIDIA GPU evidence verified" : "no GPU evidence provided";
  return [
    `${model ?? "Model"}: NEAR TEE attestation verified in this browser`,
    `Intel TDX ${attestation.tcbStatus}, ${gpu}`,
    `Signer ${attestation.signingAddress}, bound to a fresh nonce`,
    "Messages are encrypted to the attested model key before they leave the browser.",
  ].join("\n");
}

const SUGGESTIONS = [
  "Where should I put 200 USDC on Solana?",
  "What’s the best USDC yield right now?",
  "Explain Kamino vs Exponent for USDC",
];

function ThinkingChip({ label }: { label: string }) {
  return (
    <div
      className="gpt-chat-thinking gpt-chat-enter inline-flex max-w-full items-center gap-2.5 rounded-full border border-border/70 bg-muted/40 px-3.5 py-2"
      aria-live="polite"
      aria-label={label}
    >
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
        <span aria-hidden className="gpt-chat-thinking-ring absolute inset-0 rounded-full border border-foreground/15" />
        <svg viewBox="0 0 24 24" className="relative h-3.5 w-3.5 text-foreground/80" fill="none" aria-hidden>
          <path
            d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
            fill="currentColor"
            opacity="0.95"
          />
          <path
            d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"
            fill="currentColor"
            opacity="0.7"
          />
        </svg>
      </span>
      <span className="text-[12.5px] font-medium tracking-tight text-foreground/80">
        {label}
        <span className="gpt-chat-thinking-ellipsis" aria-hidden>
          …
        </span>
      </span>
    </div>
  );
}

export function AdvisorChatShell() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationSummary | null>(null);
  const sessionRef = useRef<AdvisorSession | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  useEffect(() => {
    setMessages(loadAdvisorChatHistory());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || busy) return;
    saveAdvisorChatHistory(messages);
  }, [messages, hydrated, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, busy]);

  const ensureSession = async (currentMessages: UiMessage[]) => {
    if (sessionRef.current) return sessionRef.current;
    setStatus("Verifying TEE attestation");
    const session = await startAdvisorSession(historyFromUiMessages(currentMessages));
    sessionRef.current = session;
    setModel(session.attested.model);
    setAttestation(session.attested.attestation);
    return session;
  };

  const clearHistory = () => {
    if (busy) return;
    clearAdvisorChatHistory();
    sessionRef.current = null;
    setMessages([]);
    setError(null);
    setModel(null);
    setAttestation(null);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    const userMessage = makeUiMessage("user", text);
    const priorMessages = messages;
    setMessages((prev) => [...prev, userMessage]);

    const nextStreamId = makeUiMessage("assistant", "").id;
    setStreamId(nextStreamId);
    setMessages((prev) => [...prev, { id: nextStreamId, role: "assistant", content: "" }]);

    try {
      const session = await ensureSession(priorMessages);
      const result = await runAdvisorTurn({
        session,
        userText: text,
        onStatus: (next) => setStatus(next.replace(/…$/, "")),
        onAssistantDelta: (delta) => {
          setMessages((prev) =>
            prev.map((message) => (message.id === nextStreamId ? { ...message, content: delta } : message))
          );
        },
      });
      setModel(result.model);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === nextStreamId
            ? {
                ...message,
                content: result.assistantText,
                plan: result.plan ?? undefined,
                actionCard: result.actionCard ?? undefined,
              }
            : message
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      setError(message);
      setMessages((prev) => prev.filter((item) => !(item.id === nextStreamId && !item.content)));
      sessionRef.current = null;
      setAttestation(null);
    } finally {
      setBusy(false);
      setStatus(null);
      setStreamId(null);
    }
  };

  const streamingMessage = streamId ? messages.find((message) => message.id === streamId) : null;
  const waitingOnFirstToken = busy && (!streamingMessage || !streamingMessage.content);
  const showThinking = waitingOnFirstToken;
  const thinkingLabel =
    status?.startsWith("Tool:") ? status.replace(/^Tool:\s*/, "Using ") : status || "Thinking";

  return (
    <section
      aria-label="Private advisor chat"
      className="panel-glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] sm:rounded-[28px]"
    >
      <div className="flex items-center justify-between gap-3 px-3.5 pb-1.5 pt-3.5 sm:px-5 sm:pb-2 sm:pt-5">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background sm:h-10 sm:w-10">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
              <path
                d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
                fill="currentColor"
                opacity="0.95"
              />
              <path
                d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"
                fill="currentColor"
                opacity="0.7"
              />
            </svg>
            <span
              className={[
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
                busy ? "animate-pulse bg-foreground" : "bg-emerald-500",
              ].join(" ")}
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">Yield AI</h2>
            <p className="truncate text-xs text-muted-foreground">
              {busy ? thinkingLabel : model && attestation ? `${model} · TEE verified` : "Ask about yields & Safes"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 ? (
            <button
              type="button"
              aria-label="Clear chat history"
              title="Clear chat"
              disabled={busy}
              onClick={clearHistory}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                <path
                  d="M4 7h16M9 7V5h6v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          {attestation ? (
            <a
              href={VERIFICATION_CENTER_URL}
              target="_blank"
              rel="noreferrer"
              title={attestationTitle(attestation, model)}
              className="hidden rounded-full border border-emerald-500/40 bg-surface px-2.5 py-1 font-mono text-[10px] text-emerald-600 hover:underline sm:inline dark:text-emerald-400"
            >
              E2EE · TEE ✓
            </a>
          ) : (
            <span
              title="Nothing is sent until the model's TEE attestation verifies in this browser."
              className="hidden rounded-full border border-border/70 bg-surface px-2.5 py-1 font-mono text-[10px] text-muted-foreground sm:inline"
            >
              E2EE
            </span>
          )}
        </div>
      </div>

      <div className="scrollbar-hide flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 pb-3 sm:space-y-4 sm:px-5 sm:pb-4">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col justify-center gap-5 sm:min-h-[260px] sm:gap-6">
            <div className="space-y-2">
              <p className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">How can I help?</p>
              <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">
                Yields, Solana Safe routes, and a plan you sign yourself.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(suggestion)}
                  className="rounded-2xl border border-border/80 bg-muted/40 px-3.5 py-3 text-left text-[13px] leading-snug text-foreground/90 transition-colors hover:border-foreground/20 hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:px-4 sm:text-sm"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => {
          if (!message.content && !message.actionCard && message.role === "assistant") return null;
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={[
                "gpt-chat-enter flex",
                isUser ? "justify-end" : "justify-start",
              ].join(" ")}
            >
              <div
                className={[
                  "min-w-0 text-[13.5px]",
                  isUser
                    ? "max-w-[86%] whitespace-pre-wrap rounded-[20px] bg-foreground px-4 py-2.5 leading-relaxed text-background"
                    : "w-full rounded-[20px] border border-border/60 bg-muted/45 px-3 py-3 text-foreground sm:px-3.5 sm:py-3.5",
                ].join(" ")}
              >
                {isUser ? (
                  message.content
                ) : (
                  <div className="space-y-3">
                    {message.content ? <ChatMarkdown content={message.content} /> : null}
                    {message.plan ? (
                      <div className="rounded-2xl border border-border/60 bg-background/50 px-3 py-2.5 text-xs">
                        <p className="text-[11px] font-semibold tracking-tight text-foreground">Proposed plan</p>
                        <p className="mt-1 font-medium text-foreground/90">
                          {message.plan.amountUsdc} USDC → {message.plan.strategyId}
                        </p>
                        <p className="mt-1 text-muted-foreground">{message.plan.rationale}</p>
                      </div>
                    ) : null}
                    {message.actionCard ? <ActionCard card={message.actionCard} /> : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {showThinking ? <ThinkingChip label={thinkingLabel} /> : null}

        {error ? (
          <div className="gpt-chat-enter rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <form
        className="px-3 pb-3 pt-1 sm:px-4 sm:pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <div className="relative rounded-[20px] border border-border/80 bg-muted/30 p-1.5 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-foreground/25 focus-within:bg-background focus-within:shadow-md sm:rounded-[22px] sm:p-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Message Yield AI…"
            rows={2}
            disabled={busy}
            className="max-h-36 min-h-[48px] w-full resize-none bg-transparent px-3 py-2.5 pr-12 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[52px]"
          />
          <div className="absolute bottom-2 right-2 sm:bottom-2.5 sm:right-2.5">
            {busy ? (
              <button
                type="button"
                disabled
                aria-label="Generating"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground"
              >
                <span className="h-3.5 w-3.5 rounded-[2px] bg-foreground/80" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
                  <path
                    d="M5 12h12M13 6l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        <p className="mt-1.5 hidden px-1 text-center text-[10px] text-muted-foreground/70 sm:mt-2 sm:block">
          Enter to send · Shift+Enter for new line
        </p>
      </form>
    </section>
  );
}
