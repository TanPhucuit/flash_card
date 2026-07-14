import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/ui";
import { useAppData } from "./hooks/useAppData";
import { ListeningTestPage } from "./pages/ListeningTestPage";
import {
  CreateEditSetPage,
  DashboardPage,
  FlashcardsPage,
  LearnPage,
  MatchPage,
  MySetsPage,
  ProgressPage,
  SetDetailPage,
  SettingsPage,
  SpellPage,
  TestPage,
  WritePage,
  MobileAppPage,
} from "./pages/AppPages";

export type DataApi = ReturnType<typeof useAppData>;

export default function App() {
  const api = useAppData();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (isMobile) return <MobileAppPage api={api} />;

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage api={api} />} />
        <Route path="/sets" element={<MySetsPage api={api} />} />
        <Route path="/listening-test" element={<ListeningTestPage api={api} />} />
        <Route path="/sets/new" element={<CreateEditSetPage api={api} />} />
        <Route path="/sets/:setId" element={<SetDetailPage api={api} />} />
        <Route path="/sets/:setId/edit" element={<CreateEditSetPage api={api} />} />
        <Route path="/study/:setId/flashcards" element={<FlashcardsPage api={api} />} />
        <Route path="/study/:setId/learn" element={<LearnPage api={api} />} />
        <Route path="/study/:setId/write" element={<WritePage api={api} />} />
        <Route path="/study/:setId/spell" element={<SpellPage api={api} />} />
        <Route path="/study/:setId/test" element={<TestPage api={api} />} />
        <Route path="/study/:setId/match" element={<MatchPage api={api} />} />
        <Route path="/progress" element={<ProgressPage api={api} />} />
        <Route path="/settings" element={<SettingsPage api={api} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}
