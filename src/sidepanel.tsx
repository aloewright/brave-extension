import { useEffect, useState } from "react";
import "./style.css";
import { SidebarRail } from "./components/SidebarRail";
import type { SectionId } from "./sections/types";
import { TerminalSection } from "./sections/terminal/TerminalSection";
import { InspectorSection } from "./sections/inspector/InspectorSection";
import { ExtensionsSection } from "./sections/extensions/ExtensionsSection";
import { SessionSection } from "./sections/session/SessionSection";
import { EmailSection } from "./sections/email/EmailSection";
import { QuickInfoSection } from "./sections/quick-info/QuickInfoSection";
import { PasswordsSection } from "./sections/passwords/PasswordsSection";
import { TechSection } from "./sections/tech/TechSection";
import { BookmarksSection } from "./sections/bookmarks/BookmarksSection";
import { CapturesSection } from "./sections/captures/CapturesSection";
import { CookiesSection } from "./sections/cookies/CookiesSection";
// import { RecorderSection } from "./sections/recorder/RecorderSection";
import { EyedropperSection } from "./sections/eyedropper/EyedropperSection";
import { TasksSection } from "./sections/tasks/TasksSection";
import { SettingsSection } from "./sections/settings/SettingsSection";
import { GitHubSection } from "./sections/github/GitHubSection";
// import { JoplinSection } from "./sections/joplin/JoplinSection";
import { AgentChatSection } from "./sections/agent-chat/AgentChatSection";
import { ConsentBanner } from "./components/ConsentBanner";

const ACTIVE_KEY = "ui.activeSection";

function SidePanel() {
  const [active, setActive] = useState<SectionId>("terminal");
  const [agentChatMounted, setAgentChatMounted] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(ACTIVE_KEY).then((res) => {
      const stored = res[ACTIVE_KEY] as SectionId | undefined;
      // Redirect removed/hidden sections so users do not land on a blank panel.
      const resolved =
        (stored as string) === "aiChat" || (stored as string) === "joplin"
          ? "session"
          : (stored as string) === "recorder"
          ? "captures"
          : stored;
      if (resolved) setActive(resolved);
    });
    // React to programmatic navigation (e.g. QuickActionsBar → Library/Recorder).
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local" || !changes[ACTIVE_KEY]) return;
      const next = changes[ACTIVE_KEY].newValue as string | undefined;
      // Mirror the initial-load redirect for removed/hidden sections.
      const resolved =
        next === "aiChat" || next === "joplin"
          ? "session"
          : next === "recorder"
          ? "captures"
          : (next as SectionId | undefined);
      if (resolved) setActive(resolved);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const change = (id: SectionId) => {
    setActive(id);
    void chrome.storage.local.set({ [ACTIVE_KEY]: id });
  };

  useEffect(() => {
    if (active === "agentChat") setAgentChatMounted(true);
  }, [active]);

  return (
    <div className="flex h-screen w-full flex-col overflow-x-hidden bg-bg font-sans text-fg">
      <ConsentBanner />
      <div className="flex-1 min-h-0 flex">
        <SidebarRail active={active} onChange={change} />
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/*
           * TerminalSection and PasswordsSection stay mounted across section switches so
           * they survive when the user navigates to another section in the rail.
           * Hidden via CSS when inactive; the other sections remain conditionally
           * rendered to keep their original mount/unmount semantics.
           */}
          <div
            className={`flex-1 min-h-0 flex flex-col ${active === "terminal" ? "" : "hidden"}`}
          >
            <TerminalSection active={active === "terminal"} />
          </div>
          <div
            className={`flex-1 min-h-0 flex flex-col ${active === "passwords" ? "" : "hidden"}`}
          >
            <PasswordsSection />
          </div>
          {active === "inspector" && <InspectorSection />}
          {active === "extensions" && <ExtensionsSection />}
          {active === "tech" && <TechSection />}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${active === "session" ? "" : "hidden"}`}
          >
            <SessionSection />
          </div>
          {active === "email" && <EmailSection />}
          {active === "quickInfo" && <QuickInfoSection />}
          {active === "tasks" && <TasksSection />}
          {active === "bookmarks" && <BookmarksSection />}
          {active === "captures" && <CapturesSection />}
          {active === "cookies" && <CookiesSection />}
          {/* {active === "recorder" && <RecorderSection />} */}
          {active === "eyedropper" && <EyedropperSection />}
          {/* {active === "joplin" && <JoplinSection />} */}
          {agentChatMounted && (
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${active === "agentChat" ? "" : "hidden"}`}
            >
              <AgentChatSection active={active === "agentChat"} />
            </div>
          )}
          {active === "github" && <GitHubSection />}
          {active === "settings" && <SettingsSection />}
        </main>
      </div>
    </div>
  );
}

export default SidePanel;
