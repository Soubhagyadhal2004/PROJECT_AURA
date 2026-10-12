import { useCallback, useEffect, useState } from "react";
import "./App.scss";
import { LiveAPIProvider } from "./contexts/LiveAPIContext";
import Sidebar, { View } from "./components/Sidebar";
import AssistantView from "./views/AssistantView";
import MemoryView from "./views/MemoryView";
import MeetingView from "./views/MeetingView";
import SettingsPanel from "./components/SettingsPanel";
import { api, Health } from "./lib/api";

function App() {
  const [view, setView] = useState<View>("assistant");
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const refreshHealth = useCallback(() => {
    api
      .get<Health>("/api/health")
      .then((h) => {
        setHealth(h);
        setServerDown(false);
      })
      .catch(() => setServerDown(true));
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 8000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  const openHistory = (id: number | null) => {
    setHistoryId(id);
    setView("assistant");
  };

  return (
    <LiveAPIProvider>
      <div className="app">
        <Sidebar
          view={view}
          onView={(v) => {
            setView(v);
            if (v === "assistant") setHistoryId(null);
          }}
          historyId={historyId}
          onOpenHistory={openHistory}
          historyVersion={historyVersion}
          onOpenSettings={() => setSettingsOpen(true)}
          memoryReviews={health?.memoryReviews ?? 0}
        />
        <main className="main">
          {(serverDown || (health && !health.hasKey)) && (
            <div className="banner banner--warn" role="alert">
              <span className="material-symbols-outlined">warning</span>
              {serverDown ? (
                <span>
                  The AURA server isn't running, so chat, memory and meetings are unavailable. Start everything with{" "}
                  <code>npm run dev</code>.
                </span>
              ) : (
                <span>
                  No Gemini API key found. Add <code>GEMINI_API_KEY=…</code> to the <code>.env</code> file in the project
                  folder and restart the server.
                </span>
              )}
            </div>
          )}
          {view === "assistant" && (
            <AssistantView
              historyId={historyId}
              onCloseHistory={() => setHistoryId(null)}
              onHistoryChanged={() => setHistoryVersion((v) => v + 1)}
              historyVersion={historyVersion}
              memoryReviews={health?.memoryReviews ?? 0}
            />
          )}
          {view === "memory" && <MemoryView onReviewed={refreshHealth} />}
          {/* kept mounted so a meeting keeps recording while you look at other pages */}
          <MeetingView health={health} hidden={view !== "meeting"} />
        </main>
        <SettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          health={health}
          onDataChanged={() => {
            setHistoryVersion((v) => v + 1);
            refreshHealth();
          }}
        />
      </div>
    </LiveAPIProvider>
  );
}

export default App;
