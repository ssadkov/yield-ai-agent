"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ActionCard } from "@/components/agent/ActionCard";
import { ChatMarkdown } from "@/components/agent/ChatMarkdown";
import {
  clearChatHistory,
  historyFromUiMessages,
  loadChatHistory,
  saveChatHistory,
} from "@/lib/advisor/history";
import {
  makeUiMessage,
  runAdvisorTurn,
  startAdvisorSession,
  type AdvisorSession,
  type UiMessage,
} from "@/lib/advisor/runTurn";
import { verifyAnswer, type AttestationSummary } from "@/lib/advisor/nearProxy";
import { setAdvisorWallet } from "@/lib/advisor/tools";
import {
  DEFAULT_ADVISOR_MODEL,
  advisorModelShortLabel,
  loadPreferredOpenChatModel,
  savePreferredOpenChatModel,
  type OpenChatModel,
} from "@/lib/advisor/models";
import {
  CHAT_MODE_EMPTY_BLURB,
  CHAT_MODE_EMPTY_TITLE,
  CHAT_MODE_PLACEHOLDER,
  DEFAULT_CHAT_MODE,
  loadPreferredChatMode,
  savePreferredChatMode,
  suggestionsForMode,
  type ChatMode,
} from "@/lib/advisor/modes";
import { AnswerProofLine } from "@/components/agent/AnswerProofLine";
import { AdvisorModePicker } from "@/components/agent/AdvisorModePicker";
import { AdvisorModelPicker } from "@/components/agent/AdvisorModelPicker";
import { rememberInferenceIds } from "@/components/agent/AiPoolMeter";
import { CreditsPanel } from "@/components/agent/CreditsPanel";
import type { CreditsState } from "@/lib/credits/client";

const VERIFICATION_CENTER_URL = "https://docs.near.ai/cloud/verification/verification-center";

const PRIVATE_BRIEF =
  "Private AI: messages are encrypted in this browser to the attested model before they leave. Our server only forwards the ciphertext and cannot read the conversation.";

function PrivateBadge({
  attestation,
  model,
}: {
  attestation: AttestationSummary | null;
  model: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const verified = Boolean(attestation);
  const gpu =
    attestation?.gpuEvidence === "verified" ? "NVIDIA GPU evidence verified" : "no GPU evidence provided";

  const clearHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const show = () => {
    clearHide();
    setOpen(true);
  };

  const scheduleHide = () => {
    if (pinned) return;
    clearHide();
    hideTimer.current = window.setTimeout(() => setOpen(false), 140);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearHide(), []);

  return (
    <div
      className="relative"
      ref={panelRef}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={(event) => {
        if (!panelRef.current?.contains(event.relatedTarget as Node)) scheduleHide();
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setOpen(false);
            return;
          }
          setPinned(true);
          show();
        }}
        className={[
          "inline-flex h-7 items-center rounded-full border px-2.5 text-[12.5px] font-medium tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          verified
            ? "border-emerald-500/45 bg-white text-emerald-600 hover:bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/15"
            : "border-emerald-500/35 bg-white text-emerald-600/80 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300/80",
        ].join(" ")}
      >
        {verified ? "Private · TEE ✓" : "Private"}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Private AI"
          className="panel-popover absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl p-3.5 shadow-lg"
        >
          <p className="text-[14px] leading-relaxed text-foreground/90">{PRIVATE_BRIEF}</p>
          {attestation ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {model ?? "Model"} · Intel TDX {attestation.tcbStatus} · {gpu}. Checked in this browser.
            </p>
          ) : (
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              Nothing is sent until the model’s TEE attestation verifies in this browser.
            </p>
          )}
          <a
            href={VERIFICATION_CENTER_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-[13.5px] font-medium text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-300"
          >
            NEAR Verification Center
          </a>
        </div>
      ) : null}
    </div>
  );
}

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
      <span className="text-[14px] font-medium tracking-tight text-foreground/80">
        {label}
        <span className="gpt-chat-thinking-ellipsis" aria-hidden>
          …
        </span>
      </span>
    </div>
  );
}

type Histories = Record<ChatMode, UiMessage[]>;

const EMPTY_HISTORIES: Histories = { advisor: [], free: [] };

export function AdvisorChatShell() {
  const [input, setInput] = useState("");
  const [chosenMode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [credits, setCredits] = useState<{ state: CreditsState | null; wallet: string | null }>({
    state: null,
    wallet: null,
  });
  const [histories, setHistories] = useState<Histories>(EMPTY_HISTORIES);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferredModel, setPreferredModel] = useState<OpenChatModel>(DEFAULT_ADVISOR_MODEL);
  const [model, setModel] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<AttestationSummary | null>(null);
  const [checking, setChecking] = useState<Set<string>>(() => new Set());
  const sessionsRef = useRef<Record<ChatMode, AdvisorSession | null>>({ advisor: null, free: null });
  const bottomRef = useRef<HTMLDivElement>(null);
  const [streamId, setStreamId] = useState<string | null>(null);

  // Open chat needs USDC in the Safe or bought credits (the proxy enforces it for the uncensored
  // model). With credits off there is nothing to gate on, so it stays open.
  const openChatUnlocked =
    credits.state?.enabled === false ||
    Boolean(credits.wallet && credits.state?.signedIn && credits.state.wallet === credits.wallet && credits.state.openChat);
  const mode: ChatMode = chosenMode === "free" && !openChatUnlocked ? "advisor" : chosenMode;
  const onCreditsState = useCallback(
    (state: CreditsState | null, wallet: string | null) => setCredits({ state, wallet }),
    []
  );
  // The advisor's get_my_account tool reads the connected wallet's Safe.
  useEffect(() => setAdvisorWallet(credits.wallet), [credits.wallet]);

  const messages = histories[mode];

  const setModeMessages = (next: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])) => {
    setHistories((prev) => {
      const resolved = typeof next === "function" ? next(prev[mode]) : next;
      return { ...prev, [mode]: resolved };
    });
  };

  useEffect(() => {
    setHistories({
      advisor: loadChatHistory("advisor"),
      free: loadChatHistory("free"),
    });
    setMode(loadPreferredChatMode());
    setPreferredModel(loadPreferredOpenChatModel());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || busy) return;
    saveChatHistory(mode, messages);
  }, [messages, mode, hydrated, busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status, busy, mode]);

  const ensureSession = async (currentMode: ChatMode, currentMessages: UiMessage[]) => {
    const existing = sessionsRef.current[currentMode];
    if (existing && existing.mode === currentMode && (currentMode === "advisor" || existing.attested.model === preferredModel)) {
      return existing;
    }
    setStatus("Verifying TEE attestation");
    const session = await startAdvisorSession(
      historyFromUiMessages(currentMessages, currentMode),
      currentMode === "advisor" ? DEFAULT_ADVISOR_MODEL : preferredModel,
      currentMode
    );
    sessionsRef.current[currentMode] = session;
    setModel(session.attested.model);
    setAttestation(session.attested.attestation);
    return session;
  };

  const selectMode = (next: ChatMode) => {
    if (busy || next === mode) return;
    savePreferredChatMode(next);
    setMode(next);
    setError(null);
    setStreamId(null);
    const cached = sessionsRef.current[next];
    if (cached) {
      setModel(cached.attested.model);
      setAttestation(cached.attested.attestation);
    } else {
      setModel(null);
      setAttestation(null);
    }
  };

  const selectModel = (next: OpenChatModel) => {
    if (busy || next === preferredModel) return;
    savePreferredOpenChatModel(next);
    setPreferredModel(next);
    sessionsRef.current.free = null;
    if (mode === "free") {
      setModel(null);
      setAttestation(null);
    }
    setError(null);
  };

  const clearHistory = () => {
    if (busy) return;
    clearChatHistory(mode);
    sessionsRef.current[mode] = null;
    setModeMessages([]);
    setError(null);
    setModel(null);
    setAttestation(null);
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    const activeMode = mode;
    setError(null);
    setBusy(true);
    setInput("");
    const userMessage = makeUiMessage("user", text);
    const priorMessages = histories[activeMode];
    setHistories((prev) => ({ ...prev, [activeMode]: [...prev[activeMode], userMessage] }));

    const nextStreamId = makeUiMessage("assistant", "").id;
    setStreamId(nextStreamId);
    setHistories((prev) => ({
      ...prev,
      [activeMode]: [...prev[activeMode], { id: nextStreamId, role: "assistant", content: "" }],
    }));

    const patchActive = (updater: (list: UiMessage[]) => UiMessage[]) => {
      setHistories((prev) => ({ ...prev, [activeMode]: updater(prev[activeMode]) }));
    };

    try {
      const session = await ensureSession(activeMode, priorMessages);
      const result = await runAdvisorTurn({
        session,
        userText: text,
        onStatus: (next) => setStatus(next.replace(/…$/, "")),
        onAssistantDelta: (delta) => {
          patchActive((list) =>
            list.map((message) => (message.id === nextStreamId ? { ...message, content: delta } : message))
          );
        },
      });
      setModel(result.model);
      rememberInferenceIds(result.inferenceIds);
      patchActive((list) =>
        list.map((message) =>
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
      setChecking((prev) => new Set(prev).add(nextStreamId));
      void verifyAnswer(session.attested, result.evidence).then((proof) => {
        setChecking((prev) => {
          const next = new Set(prev);
          next.delete(nextStreamId);
          return next;
        });
        patchActive((list) =>
          list.map((message) => (message.id === nextStreamId ? { ...message, proof } : message))
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      setError(message);
      patchActive((list) => list.filter((item) => !(item.id === nextStreamId && !item.content)));
      sessionsRef.current[activeMode] = null;
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
  const suggestions = suggestionsForMode(mode);

  return (
    <section
      aria-label="Private advisor chat"
      className="panel-glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] sm:rounded-[28px]"
    >
      <div className="mx-auto flex w-full max-w-[800px] items-center justify-end gap-3 px-3.5 pb-1.5 pt-3.5 sm:px-5 sm:pb-2 sm:pt-5">
        <div className="flex shrink-0 items-center gap-1.5">
          {messages.length > 0 ? (
            <button
              type="button"
              aria-label="Clear chat history"
              title="Clear chat"
              disabled={busy}
              onClick={clearHistory}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
          <PrivateBadge attestation={attestation} model={model ? advisorModelShortLabel(model) : null} />
        </div>
      </div>

      <div className="scrollbar-hide flex-1 overflow-y-auto overscroll-contain px-3.5 pb-3 sm:px-5 sm:pb-4">
        {/* One readable column, centered, however wide the card is. */}
        <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col gap-3 sm:gap-4">
        {messages.length === 0 ? (
          <div className="flex min-h-[200px] flex-1 flex-col justify-center gap-5 sm:min-h-[260px] sm:gap-6">
            <div className="space-y-2">
              <p className="text-xl font-semibold tracking-tight text-foreground/90 sm:text-2xl">
                {CHAT_MODE_EMPTY_TITLE[mode]}
              </p>
              <p className="max-w-[420px] text-[15px] leading-relaxed text-muted-foreground">
                {CHAT_MODE_EMPTY_BLURB[mode]}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(suggestion)}
                  className="rounded-2xl border border-border/80 bg-muted/40 px-3.5 py-3 text-left text-[14px] leading-snug text-foreground/90 transition-colors hover:border-foreground/20 hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:px-4 sm:text-[15px]"
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
              className={["gpt-chat-enter flex", isUser ? "justify-end" : "justify-start"].join(" ")}
            >
              <div
                className={[
                  "min-w-0 text-[15px]",
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
                      <div className="rounded-2xl border border-border/60 bg-background/50 px-3 py-2.5 text-[13px]">
                        <p className="text-[12.5px] font-semibold tracking-tight text-foreground">Proposed plan</p>
                        <p className="mt-1 font-medium text-foreground/90">
                          {message.plan.amountUsdc} USDC → {message.plan.strategyId}
                        </p>
                        <p className="mt-1 text-muted-foreground">{message.plan.rationale}</p>
                      </div>
                    ) : null}
                    {message.actionCard ? <ActionCard card={message.actionCard} /> : null}
                    {message.proof || checking.has(message.id) ? (
                      <AnswerProofLine
                        proof={message.proof ?? "checking"}
                        attestation={attestation}
                        model={model}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {showThinking ? <ThinkingChip label={thinkingLabel} /> : null}

        {error ? (
          <div className="gpt-chat-enter rounded-2xl border border-danger/30 bg-danger/10 px-3.5 py-3 text-[15px] text-danger">
            {error}
          </div>
        ) : null}

        <div ref={bottomRef} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[800px]">
        <CreditsPanel onState={onCreditsState} />
      </div>

      <form
        className="mx-auto w-full max-w-[800px] px-3 pb-3 pt-1 sm:px-4 sm:pb-4"
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
            placeholder={CHAT_MODE_PLACEHOLDER[mode]}
            rows={2}
            disabled={busy}
            className="max-h-36 min-h-[48px] w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[52px]"
          />
          <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5 pt-0.5 sm:px-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <AdvisorModePicker
                value={mode}
                disabled={busy}
                openChatUnlocked={openChatUnlocked}
                onChange={selectMode}
              />
              {mode === "free" ? (
                <AdvisorModelPicker value={preferredModel} disabled={busy} onChange={selectModel} />
              ) : null}
            </div>
            {busy ? (
              <button
                type="button"
                disabled
                aria-label="Generating"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground"
              >
                <span className="h-3.5 w-3.5 rounded-[2px] bg-foreground/80" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
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
        <p className="mt-1.5 hidden px-1 text-center text-[11.5px] text-muted-foreground/70 sm:mt-2 sm:block">
          Enter to send · Shift+Enter for new line
        </p>
      </form>
    </section>
  );
}
