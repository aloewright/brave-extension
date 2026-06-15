export type SignalNativeRequest =
  | { type: "signal.status" }
  | { type: "signal.link.start"; deviceName: string }
  | { type: "signal.link.finish"; deviceName: string }
  | { type: "signal.conversations.list" }
  | { type: "signal.messages.list"; conversationId: string }
  | {
      type: "signal.message.send";
      conversationId: string;
      body: string;
      attachments?: SignalSendAttachment[];
    }
  | { type: "signal.attachments.get"; messageId: string; attachmentId: string }
  | { type: "signal.lock" }
  | { type: "signal.unlink" };

export type SignalBridgeState =
  | "unlinked"
  | "missing-runtime"
  | "stopped"
  | "starting"
  | "locked"
  | "linking"
  | "linked"
  | "error";

export interface SignalBridgeStatus {
  state: SignalBridgeState;
  profileLabel?: string;
  runtime?: "podman" | "docker" | "unknown" | string | { kind?: string };
  deviceName?: string;
  lastSeenAt?: string;
  detail?: string;
  error?: string;
}

export interface SignalLinkSession {
  linkUri: string;
  qrData?: string;
  expiresAt?: string;
}

export interface SignalConversation {
  id: string;
  title: string;
  recipient?: string;
  avatarLabel?: string;
  lastMessagePreview?: string;
  lastTimestamp?: string | number;
  unreadCount?: number;
}

export interface SignalAttachmentSummary {
  id: string;
  fileName?: string;
  contentType?: string;
  size?: number;
}

export interface SignalMessage {
  id: string;
  conversationId: string;
  author: string;
  body: string;
  timestamp: string | number;
  direction: "incoming" | "outgoing";
  status?: "pending" | "sent" | "delivered" | "failed";
  attachments?: SignalAttachmentSummary[];
}

export interface SignalSendAttachment {
  name: string;
  contentType: string;
  bytes: number;
}

export type SignalNativeResponse =
  | {
      type: "signal.status";
      ok?: boolean;
      status?: Partial<SignalBridgeStatus>;
      error?: string;
    }
  | {
      type: "signal.link.start";
      ok?: boolean;
      link?: Partial<SignalLinkSession>;
      linkUri?: string;
      qrData?: string;
      expiresAt?: string;
      error?: string;
    }
  | {
      type: "signal.link.finish";
      ok?: boolean;
      status?: Partial<SignalBridgeStatus>;
      error?: string;
    }
  | {
      type: "signal.conversations.list";
      ok?: boolean;
      conversations?: Partial<SignalConversation>[];
      error?: string;
    }
  | {
      type: "signal.messages.list";
      ok?: boolean;
      conversationId?: string;
      messages?: Partial<SignalMessage>[];
      error?: string;
    }
  | {
      type: "signal.message.send";
      ok?: boolean;
      conversationId?: string;
      message?: Partial<SignalMessage>;
      error?: string;
    }
  | {
      type: "signal.message.received";
      conversationId?: string;
      message?: Partial<SignalMessage>;
    }
  | {
      type: "signal.lock" | "signal.unlink";
      ok?: boolean;
      status?: Partial<SignalBridgeStatus>;
      error?: string;
    }
  | {
      type: "signal.attachments.get";
      ok?: boolean;
      messageId?: string;
      attachmentId?: string;
      url?: string;
      error?: string;
    }
  | {
      type: "signal.error";
      ok: false;
      code?: string;
      requestId?: string;
      error: string;
    };

export const SIGNAL_DEVICE_NAME = "Brave Dev Sidebar";

export const SIGNAL_NATIVE_TYPES = [
  "signal.status",
  "signal.link.start",
  "signal.link.finish",
  "signal.conversations.list",
  "signal.messages.list",
  "signal.message.send",
  "signal.message.received",
  "signal.attachments.get",
  "signal.error",
  "signal.lock",
  "signal.unlink",
] as const;

export function isSignalNativeResponse(
  payload: unknown,
): payload is SignalNativeResponse {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "type" in payload &&
    SIGNAL_NATIVE_TYPES.includes(
      (payload as { type?: string }).type as (typeof SIGNAL_NATIVE_TYPES)[number],
    )
  );
}
