import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";
import { cx, LeoBadge, LeoButton, LeoIcon } from "../../components/leo";
import {
  isSignalNativeResponse,
  SIGNAL_DEVICE_NAME,
  type SignalBridgeState,
  type SignalBridgeStatus,
  type SignalConversation,
  type SignalLinkSession,
  type SignalMessage,
  type SignalNativeRequest,
  type SignalNativeResponse,
} from "../../lib/signal-types";

type BusyAction =
  | "status"
  | "link"
  | "finish"
  | "conversations"
  | "messages"
  | "send"
  | "lock"
  | "unlink";

const EMPTY_STATUS: SignalBridgeStatus = {
  state: "stopped",
  runtime: "unknown",
  detail: "No live bridge status yet",
};

const STATE_LABELS: Record<SignalBridgeState, string> = {
  unlinked: "Unlinked",
  "missing-runtime": "Runtime missing",
  stopped: "Stopped",
  starting: "Starting",
  locked: "Locked",
  linking: "Linking",
  linked: "Linked",
  error: "Needs attention",
};

const STATE_BADGES: Record<
  SignalBridgeState,
  "neutral" | "primary" | "danger" | "success" | "warning" | "info"
> = {
  unlinked: "neutral",
  "missing-runtime": "warning",
  stopped: "neutral",
  starting: "info",
  locked: "warning",
  linking: "primary",
  linked: "success",
  error: "danger",
};

function isSignalBridgeState(value: unknown): value is SignalBridgeState {
  return (
    value === "missing-runtime" ||
    value === "unlinked" ||
    value === "stopped" ||
    value === "starting" ||
    value === "locked" ||
    value === "linking" ||
    value === "linked" ||
    value === "error"
  );
}

function normalizeStatus(value: Partial<SignalBridgeStatus> | undefined): SignalBridgeStatus {
  const state = isSignalBridgeState(value?.state) ? value.state : EMPTY_STATUS.state;
  return {
    state,
    runtime:
      typeof value?.runtime === "string" && value.runtime.trim()
        ? value.runtime
        : typeof value?.runtime === "object" &&
            value.runtime !== null &&
            "kind" in value.runtime &&
            typeof (value.runtime as { kind?: unknown }).kind === "string"
          ? (value.runtime as { kind: string }).kind
          : EMPTY_STATUS.runtime,
    profileLabel:
      typeof value?.profileLabel === "string" ? value.profileLabel : undefined,
    deviceName:
      typeof value?.deviceName === "string" ? value.deviceName : undefined,
    lastSeenAt:
      typeof value?.lastSeenAt === "string" ? value.lastSeenAt : undefined,
    detail:
      typeof value?.detail === "string" && value.detail.trim()
        ? value.detail
        : statusDetailForState(state),
    error: typeof value?.error === "string" ? value.error : undefined,
  };
}

function statusDetailForState(state: SignalBridgeState): string {
  switch (state) {
    case "missing-runtime":
      return "Install signal-cli before linking this device.";
    case "unlinked":
      return "No Signal device is linked to this local bridge.";
    case "locked":
      return "The encrypted local profile is locked.";
    case "linking":
      return "Scan the linked-device code from Signal on your phone.";
    case "linked":
      return "The local linked-device bridge is ready.";
    case "error":
      return "The bridge reported an error.";
    case "starting":
      return "Starting the local bridge container.";
    case "stopped":
    default:
      return "The bridge has not reported a live session.";
  }
}

function normalizeLink(payload: Extract<SignalNativeResponse, { type: "signal.link.start" }>): SignalLinkSession | null {
  const linkUri = payload.link?.linkUri ?? payload.linkUri;
  if (typeof linkUri !== "string" || !linkUri.trim()) return null;
  return {
    linkUri,
    qrData:
      typeof payload.link?.qrData === "string"
        ? payload.link.qrData
        : typeof payload.qrData === "string"
          ? payload.qrData
          : undefined,
    expiresAt:
      typeof payload.link?.expiresAt === "string"
        ? payload.link.expiresAt
        : typeof payload.expiresAt === "string"
          ? payload.expiresAt
          : undefined,
  };
}

function normalizeConversation(
  input: Partial<SignalConversation>,
  index: number,
): SignalConversation {
  const fallbackId = `conversation-${index}`;
  const id = typeof input.id === "string" && input.id.trim() ? input.id : fallbackId;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title
      : typeof input.recipient === "string" && input.recipient.trim()
        ? input.recipient
        : "Signal conversation";
  return {
    id,
    title,
    recipient: typeof input.recipient === "string" ? input.recipient : undefined,
    avatarLabel:
      typeof input.avatarLabel === "string" && input.avatarLabel.trim()
        ? input.avatarLabel.slice(0, 2).toUpperCase()
        : title.slice(0, 2).toUpperCase(),
    lastMessagePreview:
      typeof input.lastMessagePreview === "string"
        ? input.lastMessagePreview
        : undefined,
    lastTimestamp: input.lastTimestamp,
    unreadCount:
      typeof input.unreadCount === "number" && Number.isFinite(input.unreadCount)
        ? input.unreadCount
        : 0,
  };
}

function normalizeMessage(input: Partial<SignalMessage>, index: number): SignalMessage | null {
  const conversationId =
    typeof input.conversationId === "string" && input.conversationId.trim()
      ? input.conversationId
      : "";
  const body = typeof input.body === "string" ? input.body : "";
  const attachments = Array.isArray(input.attachments) ? input.attachments : undefined;
  if (!conversationId || (!body && !attachments?.length)) return null;
  const direction = input.direction === "outgoing" ? "outgoing" : "incoming";
  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id
        : `${conversationId}-${direction}-${index}-${Date.now()}`,
    conversationId,
    author:
      typeof input.author === "string" && input.author.trim()
        ? input.author
        : direction === "outgoing"
          ? "You"
          : "Signal",
    body,
    timestamp: input.timestamp ?? new Date().toISOString(),
    direction,
    status: input.status,
    attachments,
  };
}

function sortConversations(conversations: SignalConversation[]): SignalConversation[] {
  return [...conversations].sort((a, b) => {
    const aTime = toTime(a.lastTimestamp);
    const bTime = toTime(b.lastTimestamp);
    return bTime - aTime;
  });
}

function appendMessage(
  current: Record<string, SignalMessage[]>,
  message: SignalMessage,
): Record<string, SignalMessage[]> {
  const existing = current[message.conversationId] ?? [];
  if (existing.some((item) => item.id === message.id)) return current;
  return {
    ...current,
    [message.conversationId]: [...existing, message],
  };
}

function toTime(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTime(value: string | number | undefined): string {
  const time = toTime(value);
  if (!time) return "No activity";
  return new Date(time).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function runtimeLabel(runtime: SignalBridgeStatus["runtime"]): string {
  if (typeof runtime === "string" && runtime.trim()) return runtime;
  if (runtime && typeof runtime === "object" && typeof runtime.kind === "string") {
    return runtime.kind;
  }
  return "unknown";
}

function useSignalNativeBridge(
  onSignalResponse: (payload: SignalNativeResponse) => void,
) {
  const [connected, setConnected] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const responseRef = useRef(onSignalResponse);
  responseRef.current = onSignalResponse;

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.connect) {
      setBridgeError("Chrome runtime is unavailable in this context.");
      return;
    }

    const port = chrome.runtime.connect({ name: "ai-dev-sidebar" });
    portRef.current = port;

    const onMessage = (msg: any) => {
      if (msg?.type === "native-response") {
        setConnected(true);
        setBridgeError(null);
        if (isSignalNativeResponse(msg.payload)) {
          responseRef.current(msg.payload);
        } else if (msg.payload?.type === "error") {
          setBridgeError(String(msg.payload.data || "Native host error"));
        }
      } else if (msg?.type === "native-disconnected") {
        setConnected(false);
        setBridgeError(String(msg.error || "Native host disconnected"));
      }
    };

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      setConnected(false);
      portRef.current = null;
      const err = chrome.runtime.lastError?.message;
      if (err) setBridgeError(err);
    });

    try {
      port.postMessage({ type: "native-send", payload: { type: "ping" } });
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "Native host ping failed");
    }

    return () => {
      try {
        port.disconnect();
      } catch {
        // The background service worker may already have dropped the port.
      }
      if (portRef.current === port) portRef.current = null;
    };
  }, []);

  const send = useCallback((payload: SignalNativeRequest) => {
    const port = portRef.current;
    if (!port) {
      setConnected(false);
      setBridgeError("Native host bridge is not connected.");
      return false;
    }
    try {
      port.postMessage({ type: "native-send", payload });
      return true;
    } catch (error) {
      setConnected(false);
      setBridgeError(
        error instanceof Error ? error.message : "Native host bridge failed to send.",
      );
      return false;
    }
  }, []);

  return { connected, bridgeError, send };
}

export function SignalSection() {
  const [status, setStatus] = useState<SignalBridgeStatus>(EMPTY_STATUS);
  const [linkSession, setLinkSession] = useState<SignalLinkSession | null>(null);
  const [conversations, setConversations] = useState<SignalConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<
    Record<string, SignalMessage[]>
  >({});
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const handleSignalResponse = useCallback((payload: SignalNativeResponse) => {
    if ("ok" in payload && payload.ok === false) {
      setBusy(null);
      setNotice(payload.error || "Signal bridge request failed.");
      if (payload.type === "signal.status") {
        setStatus((current) => ({
          ...current,
          state: "error",
          error: payload.error,
          detail: payload.error || statusDetailForState("error"),
        }));
      }
      return;
    }

    switch (payload.type) {
      case "signal.status": {
        setStatus(normalizeStatus(payload.status));
        setBusy((current) => (current === "status" ? null : current));
        break;
      }
      case "signal.link.start": {
        const nextLink = normalizeLink(payload);
        setLinkSession(nextLink);
        setStatus((current) =>
          normalizeStatus({
            ...current,
            state: "linking",
            detail: nextLink
              ? "Linked-device link is ready to scan."
              : "Waiting for a linked-device URI from the bridge.",
          }),
        );
        setBusy(null);
        break;
      }
      case "signal.link.finish": {
        setLinkSession(null);
        setStatus(normalizeStatus(payload.status ?? { state: "linked" }));
        setBusy(null);
        setNotice("Signal linked-device bridge is ready.");
        break;
      }
      case "signal.conversations.list": {
        const normalized = sortConversations(
          (payload.conversations ?? []).map(normalizeConversation),
        );
        setConversations(normalized);
        setSelectedConversationId((current) => current ?? normalized[0]?.id ?? null);
        setBusy((current) => (current === "conversations" ? null : current));
        break;
      }
      case "signal.messages.list": {
        const normalized = (payload.messages ?? [])
          .map((message, index) =>
            normalizeMessage(
              { ...message, conversationId: message.conversationId ?? payload.conversationId },
              index,
            ),
          )
          .filter((message): message is SignalMessage => Boolean(message));
        const conversationId = payload.conversationId ?? normalized[0]?.conversationId;
        if (conversationId) {
          setMessagesByConversation((current) => ({
            ...current,
            [conversationId]: normalized,
          }));
        }
        setBusy((current) => (current === "messages" ? null : current));
        break;
      }
      case "signal.message.send": {
        const normalized =
          payload.message && payload.conversationId
            ? normalizeMessage(
                { ...payload.message, conversationId: payload.conversationId },
                0,
              )
            : payload.message
              ? normalizeMessage(payload.message, 0)
              : null;
        if (normalized) {
          setMessagesByConversation((current) => appendMessage(current, normalized));
        }
        setBusy((current) => (current === "send" ? null : current));
        setNotice("Message handed to the local Signal bridge.");
        break;
      }
      case "signal.message.received": {
        const normalized =
          payload.message && payload.conversationId
            ? normalizeMessage(
                { ...payload.message, conversationId: payload.conversationId },
                0,
              )
            : payload.message
              ? normalizeMessage(payload.message, 0)
              : null;
        if (normalized) {
          setMessagesByConversation((current) => appendMessage(current, normalized));
          setConversations((current) =>
            sortConversations(
              current.map((conversation) =>
                conversation.id === normalized.conversationId
                  ? {
                      ...conversation,
                      lastMessagePreview: normalized.body,
                      lastTimestamp: normalized.timestamp,
                      unreadCount:
                        conversation.id === selectedConversationId
                          ? conversation.unreadCount
                          : (conversation.unreadCount ?? 0) + 1,
                    }
                  : conversation,
              ),
            ),
          );
        }
        break;
      }
      case "signal.lock":
      case "signal.unlink": {
        setStatus(normalizeStatus(payload.status ?? { state: "locked" }));
        if (payload.type === "signal.unlink") {
          setLinkSession(null);
          setConversations([]);
          setSelectedConversationId(null);
          setMessagesByConversation({});
        }
        setBusy(null);
        break;
      }
      case "signal.attachments.get": {
        setBusy(null);
        if (payload.url) setNotice("Attachment is ready from the local bridge.");
        break;
      }
    }
  }, [selectedConversationId]);

  const {
    connected: nativePortConnected,
    bridgeError,
    send,
  } = useSignalNativeBridge(handleSignalResponse);

  const sendNative = useCallback(
    (payload: SignalNativeRequest, action: BusyAction) => {
      setBusy(action);
      setNotice(null);
      if (!send(payload)) setBusy(null);
    },
    [send],
  );

  const refreshStatus = useCallback(() => {
    sendNative({ type: "signal.status" }, "status");
  }, [sendNative]);

  const refreshConversations = useCallback(() => {
    sendNative({ type: "signal.conversations.list" }, "conversations");
  }, [sendNative]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status.state === "linked") refreshConversations();
  }, [refreshConversations, status.state]);

  useEffect(() => {
    if (bridgeError) {
      setBusy(null);
      setNotice(bridgeError);
    }
  }, [bridgeError]);

  useEffect(() => {
    let active = true;
    if (!linkSession?.linkUri) {
      setQrDataUrl(null);
      return () => {
        active = false;
      };
    }
    void QRCode.toDataURL(linkSession.linkUri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: { dark: "#111111", light: "#ffffff" },
    })
      .then((value) => {
        if (active) setQrDataUrl(value);
      })
      .catch((error) => {
        if (active) {
          setQrDataUrl(null);
          setNotice(
            error instanceof Error
              ? `Could not render Signal QR code: ${error.message}`
              : "Could not render Signal QR code.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [linkSession?.linkUri]);

  useEffect(() => {
    if (!selectedConversationId) return;
    sendNative(
      { type: "signal.messages.list", conversationId: selectedConversationId },
      "messages",
    );
  }, [selectedConversationId, sendNative]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === selectedConversationId) ??
      null,
    [conversations, selectedConversationId],
  );

  const selectedMessages = selectedConversationId
    ? messagesByConversation[selectedConversationId] ?? []
    : [];

  const submitMessage = (event: FormEvent) => {
    event.preventDefault();
    const body = composer.trim();
    if (!selectedConversationId || !body || busy === "send") return;
    setComposer("");
    sendNative(
      {
        type: "signal.message.send",
        conversationId: selectedConversationId,
        body,
      },
      "send",
    );
  };

  const copyLink = async () => {
    if (
      !linkSession?.linkUri ||
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      return;
    }
    try {
      await navigator.clipboard.writeText(linkSession.linkUri);
      setNotice("Signal linked-device URI copied.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `Could not copy Signal URI: ${error.message}`
          : "Could not copy Signal URI.",
      );
    }
  };

  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-fg"
      data-testid="signal-section"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <LeoIcon name="radio-checked" size={16} className="shrink-0 text-primary" />
            <h2 className="truncate text-sm font-semibold text-fg">Signal</h2>
          </div>
          <p className="truncate text-[11px] text-fg/45">
            Local linked-device bridge
          </p>
        </div>
        <LeoButton
          type="button"
          size="xs"
          variant="neutral"
          disabled={busy === "status"}
          onClick={refreshStatus}
        >
          {busy === "status" ? "Checking" : "Refresh"}
        </LeoButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div
          className="mb-4 rounded border border-border bg-card/30 p-3"
          data-testid="signal-status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <LeoIcon name="shield" size={16} className="shrink-0 text-primary" />
                <span className="truncate text-sm font-semibold text-fg">
                  Local Signal device
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-fg/50">
                {status.detail || statusDetailForState(status.state)}
              </p>
            </div>
            <LeoBadge variant={STATE_BADGES[status.state]}>
              {STATE_LABELS[status.state]}
            </LeoBadge>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <StatusTile label="Runtime" value={runtimeLabel(status.runtime)} />
            <StatusTile
              label="Profile"
              value={status.profileLabel || "Local bridge"}
            />
            <StatusTile
              label="Last seen"
              value={formatTime(status.lastSeenAt)}
            />
          </div>

          <p
            className="mt-3 rounded border border-warning/25 bg-warning/10 px-2 py-2 text-[11px] leading-5 text-fg/60"
            data-testid="signal-security-note"
          >
            Signal is linked through the local signal-cli profile. This tab keeps
            conversation content in memory only and does not sync it to extension
            storage, cloud APIs, AI features, or content scripts.
          </p>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-border bg-card/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-normal text-fg/35">
                  Link flow
                </div>
                <div className="mt-1 text-xs font-medium text-fg">
                  {linkSession ? "Ready to scan" : "No active link"}
                </div>
              </div>
              <LeoButton
                type="button"
                size="xs"
                variant="primary"
                disabled={busy === "link"}
                onClick={() =>
                  sendNative(
                    { type: "signal.link.start", deviceName: SIGNAL_DEVICE_NAME },
                    "link",
                  )
                }
              >
                {busy === "link" ? "Starting" : "Start link"}
              </LeoButton>
            </div>

            <div className="mt-3 rounded border border-dashed border-border bg-bg/35 p-3">
              {linkSession ? (
                <div className="space-y-2">
                  <div className="flex min-h-28 items-center justify-center rounded border border-border bg-white p-3 text-center text-[11px] leading-5 text-black/60">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="Signal linked-device QR code"
                        className="h-auto w-full max-w-56"
                      />
                    ) : (
                      "Rendering Signal linked-device QR code…"
                    )}
                  </div>
                  <input
                    readOnly
                    value={linkSession.linkUri}
                    aria-label="Signal linked-device URI"
                    className="w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[11px] text-fg outline-none"
                  />
                  <div className="flex gap-2">
                    <LeoButton type="button" size="xs" variant="neutral" onClick={() => void copyLink()}>
                      Copy URI
                    </LeoButton>
                    <LeoButton
                      type="button"
                      size="xs"
                      variant="success"
                      disabled={busy === "finish"}
                      onClick={() =>
                        sendNative(
                          {
                            type: "signal.link.finish",
                            deviceName: SIGNAL_DEVICE_NAME,
                          },
                          "finish",
                        )
                      }
                    >
                      Finish link
                    </LeoButton>
                  </div>
                  <p className="text-[10px] leading-4 text-fg/45">
                    On your phone, open Signal → Settings → Linked devices → Link new device, then scan this code. Do not open the URI as a web page.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] leading-5 text-fg/45">
                  Start a linked-device session to receive a Signal deep link.
                  Historical messages may not be available after linking; the
                  tab shows messages received by the bridge.
                </p>
              )}
            </div>
          </div>

          <div className="rounded border border-border bg-card/20 p-3">
            <div className="text-[10px] uppercase tracking-normal text-fg/35">
              Bridge controls
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <LeoButton
                type="button"
                size="xs"
                variant="neutral"
                disabled={busy === "conversations"}
                onClick={refreshConversations}
              >
                Load chats
              </LeoButton>
              <LeoButton
                type="button"
                size="xs"
                variant="warning"
                disabled={busy === "lock"}
                onClick={() => sendNative({ type: "signal.lock" }, "lock")}
              >
                Lock
              </LeoButton>
              <LeoButton
                type="button"
                size="xs"
                variant="danger"
                disabled={busy === "unlink"}
                onClick={() => sendNative({ type: "signal.unlink" }, "unlink")}
              >
                Unlink
              </LeoButton>
              <div className="rounded border border-border bg-bg/35 px-2 py-1.5 text-[11px] text-fg/45">
                {nativePortConnected ? "Native port online" : "Native port idle"}
              </div>
            </div>
            {notice ? (
              <p className="mt-3 rounded border border-border bg-bg/35 p-2 text-[11px] leading-5 text-fg/55" role="status">
                {notice}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid min-h-[420px] gap-3 lg:grid-cols-[minmax(180px,0.38fr)_minmax(0,1fr)]">
          <aside
            className="min-h-0 rounded border border-border bg-card/20"
            data-testid="signal-conversation-list"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-fg">Conversations</span>
              <span className="text-[10px] text-fg/35">{conversations.length}</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {conversations.length === 0 ? (
                <EmptyBlock text="No conversations loaded from the local bridge." />
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={cx(
                      "mb-1 flex w-full min-w-0 items-start gap-2 rounded border p-2 text-left transition-colors",
                      conversation.id === selectedConversationId
                        ? "border-primary/45 bg-primary/10"
                        : "border-border bg-bg/30 hover:border-primary/25 hover:bg-card/45",
                    )}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-border bg-bg/60 text-[10px] font-semibold text-fg/60">
                      {conversation.avatarLabel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-fg">
                          {conversation.title}
                        </span>
                        {conversation.unreadCount ? (
                          <span className="shrink-0 rounded-full bg-primary/20 px-1.5 text-[10px] text-primary">
                            {conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-fg/40">
                        {conversation.lastMessagePreview || "No preview"}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col rounded border border-border bg-card/20">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-fg">
                  {selectedConversation?.title || "No conversation selected"}
                </div>
                <div className="truncate text-[10px] text-fg/35">
                  {selectedConversation?.recipient ||
                    "Choose a conversation loaded from the bridge"}
                </div>
              </div>
              {selectedConversationId ? (
                <LeoButton
                  type="button"
                  size="xs"
                  variant="neutral"
                  disabled={busy === "messages"}
                  onClick={() =>
                    sendNative(
                      {
                        type: "signal.messages.list",
                        conversationId: selectedConversationId,
                      },
                      "messages",
                    )
                  }
                >
                  Reload
                </LeoButton>
              ) : null}
            </div>

            <div
              className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
              data-testid="signal-message-list"
            >
              {!selectedConversationId ? (
                <EmptyBlock text="Select a conversation to load messages from the local bridge." />
              ) : selectedMessages.length === 0 ? (
                <EmptyBlock text="No messages loaded for this conversation yet." />
              ) : (
                selectedMessages.map((message) => (
                  <article
                    key={message.id}
                    className={cx(
                      "max-w-[86%] rounded border px-3 py-2 text-[11px] leading-5",
                      message.direction === "outgoing"
                        ? "ml-auto border-primary/25 bg-primary/10 text-fg"
                        : "mr-auto border-border bg-bg/45 text-fg/70",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-fg/35">
                      <span className="truncate">{message.author}</span>
                      <span className="shrink-0">{formatTime(message.timestamp)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    {message.attachments?.length ? (
                      <div className="mt-2 space-y-1">
                        {message.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            className="flex w-full items-center gap-2 rounded border border-border bg-bg/40 px-2 py-1 text-left text-[10px] text-fg/50 hover:text-fg"
                            onClick={() =>
                              sendNative(
                                {
                                  type: "signal.attachments.get",
                                  messageId: message.id,
                                  attachmentId: attachment.id,
                                },
                                "messages",
                              )
                            }
                          >
                            <LeoIcon name="file-export" size={12} />
                            <span className="truncate">
                              {attachment.fileName || attachment.contentType || "Attachment"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>

            <form
              className="border-t border-border p-3"
              data-testid="signal-composer"
              onSubmit={submitMessage}
            >
              <label className="sr-only" htmlFor="signal-message-body">
                Message
              </label>
              <textarea
                id="signal-message-body"
                value={composer}
                onChange={(event) => setComposer(event.currentTarget.value)}
                disabled={!selectedConversationId}
                placeholder={
                  selectedConversationId
                    ? "Write a Signal message..."
                    : "Select a conversation first"
                }
                className="min-h-20 w-full resize-none rounded border border-border bg-bg/70 px-2 py-1.5 text-[11px] leading-5 text-fg outline-none placeholder:text-fg/30 focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-fg/35">
                  Sent through the local bridge only
                </span>
                <LeoButton
                  type="submit"
                  size="xs"
                  variant="primary"
                  disabled={!selectedConversationId || !composer.trim() || busy === "send"}
                >
                  {busy === "send" ? "Sending" : "Send"}
                </LeoButton>
              </div>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-bg/35 p-2">
      <div className="text-[10px] uppercase tracking-normal text-fg/35">
        {label}
      </div>
      <div className="mt-1 truncate text-xs font-medium text-fg">{value}</div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded border border-dashed border-border/70 bg-bg/25 p-3 text-center text-[11px] leading-5 text-fg/45">
      {text}
    </div>
  );
}
