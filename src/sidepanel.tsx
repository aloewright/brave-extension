import { useEffect, useState } from "react";
import "./style.css";
import { SidebarRail } from "./components/SidebarRail";
import type { SectionId } from "./sections/types";
import { TerminalSection } from "./sections/terminal/TerminalSection";
import { InspectorSection } from "./sections/inspector/InspectorSection";
import { PageStudioSection } from "./sections/page-studio/PageStudioSection";
import { ExtensionsSection } from "./sections/extensions/ExtensionsSection";
import { SessionSection } from "./sections/session/SessionSection";
import { PasswordVaultSection } from "./sections/passwords/PasswordVaultSection";
import { EmailSection } from "./sections/email/EmailSection";
import { SignalSection } from "./sections/signal/SignalSection";
import { QuickInfoSection } from "./sections/quick-info/QuickInfoSection";
// import { PerplexitySection } from "./sections/perplexity/PerplexitySection";
import { BookmarksSection } from "./sections/bookmarks/BookmarksSection";
import { CapturesSection } from "./sections/captures/CapturesSection";
import { CookiesSection } from "./sections/cookies/CookiesSection";
// import { RecorderSection } from "./sections/recorder/RecorderSection";
import { TasksSection } from "./sections/tasks/TasksSection";
import { SettingsSection } from "./sections/settings/SettingsSection";
import { GitHubSection } from "./sections/github/GitHubSection";
import { LexiconSection } from "./sections/lexicon/LexiconSection";
// import { JoplinSection } from "./sections/joplin/JoplinSection";
import { AgentChatSection } from "./sections/agent-chat/AgentChatSection";
import { ConsentBanner } from "./components/ConsentBanner";
import { applyAppearanceSettings } from "./lib/appearance";
import { getSettings } from "./storage";

const ACTIVE_KEY = "ui.activeSection";

function resolveStoredSection(
  section: string | undefined,
): SectionId | undefined {
  if (
    section === "aiChat" ||
    section === "joplin" ||
    section === "perplexity"
  ) {
    return "session";
  }
  if (section === "tech" || section === "eyedropper") return "inspector";
  if (section === "recorder") return "captures";
  return section as SectionId | undefined;
}

function SidePanel() {
  const [active, setActive] = useState<SectionId>("terminal");
  const [agentChatMounted, setAgentChatMounted] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(ACTIVE_KEY).then((res) => {
      const stored = res[ACTIVE_KEY] as SectionId | undefined;
      // Redirect removed/hidden sections so users do not land on a blank panel.
      const resolved = resolveStoredSection(stored);
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
      const resolved = resolveStoredSection(next);
      if (resolved) setActive(resolved);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    let mounted = true;
    getSettings().then((settings) => {
      if (mounted) applyAppearanceSettings(settings);
    });
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local" || !changes["ai-dev-settings"]) return;
      applyAppearanceSettings(changes["ai-dev-settings"].newValue);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const change = (id: SectionId) => {
    setActive(id);
    void chrome.storage.local.set({ [ACTIVE_KEY]: id });
  };

  useEffect(() => {
    if (active === "agentChat") setAgentChatMounted(true);
  }, [active]);

  return (
    <div className="app-shell flex h-screen w-full flex-col overflow-x-hidden text-fg">
      <ConsentBanner />
      <div className="flex-1 min-h-0 flex">
        <SidebarRail active={active} onChange={change} />
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/*
           * TerminalSection stays mounted across section switches so it survives when
           * the user navigates to another section in the rail.
           * Hidden via CSS when inactive; the other sections remain conditionally
           * rendered to keep their original mount/unmount semantics.
           */}
          <div
            className={`flex-1 min-h-0 flex flex-col ${active === "terminal" ? "" : "hidden"}`}
          >
            <TerminalSection active={active === "terminal"} />
          </div>
          {active === "inspector" && <InspectorSection />}
          {active === "pageStudio" && <PageStudioSection />}
          {active === "extensions" && <ExtensionsSection />}
          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${active === "session" ? "" : "hidden"}`}
          >
            <SessionSection />
          </div>
          {active === "passwords" && <PasswordVaultSection />}
          {active === "email" && <EmailSection />}
          {active === "signal" && <SignalSection />}
          {active === "quickInfo" && <QuickInfoSection />}
          {/* {active === "perplexity" && <PerplexitySection />} */}
          {active === "tasks" && <TasksSection />}
          {active === "bookmarks" && <BookmarksSection />}
          {active === "captures" && <CapturesSection />}
          {active === "cookies" && <CookiesSection />}
          {/* {active === "recorder" && <RecorderSection />} */}
          {/* {active === "joplin" && <JoplinSection />} */}
          {agentChatMounted && (
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${active === "agentChat" ? "" : "hidden"}`}
            >
              <AgentChatSection active={active === "agentChat"} />
            </div>
          )}
          {active === "github" && <GitHubSection />}
          {active === "lexicon" && <LexiconSection />}
          {active === "settings" && <SettingsSection />}
        </main>
      </div>
    </div>
  );
}

export default SidePanel;
