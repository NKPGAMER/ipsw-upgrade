import { lazy, useContext } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell, LayoutContext } from "./ui/layout";
import { ErrorBoundarySection } from "./ui/ErrorBoundarySection";

const Home = lazy(() => import("./ui/home"));
const Settings = lazy(() => import("@pages/Settings/index"));
const Downloads = lazy(() => import("./ui/download"));
const SelectDevice = lazy(() => import("@pages/SelectDevice/index"));
const IPSWUpdateManager = lazy(() => import("./ui/IPSWUpdateManager"));
const AppUpdate = lazy(() => import("./ui/appUpdate"));
const Welcome = lazy(() => import("./ui/welcome"));

function SetupHomeGuard() {
  const { needSetup } = useContext(LayoutContext);
  if (needSetup) return <Navigate to="/welcome" replace />;
  return <Home />;
}

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<SetupHomeGuard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route
            path="/selectDevice"
            element={
              <ErrorBoundarySection>
                <SelectDevice />
              </ErrorBoundarySection>
            }
          />
          <Route
            path="/ipswUpdate"
            element={
              <ErrorBoundarySection>
                <IPSWUpdateManager />
              </ErrorBoundarySection>
            }
          />
          <Route path="/appUpdate" element={<AppUpdate />} />
          <Route path="/welcome" element={<Welcome />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
