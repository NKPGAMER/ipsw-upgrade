import { useContext, useState, useEffect, type ReactNode, Suspense, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useLocation, useNavigate } from "react-router-dom";
import { LayoutContext, LayoutProvider } from "./LayoutContext";
import { ContentArea } from "./ContentArea";
import { useNetworkStatus } from "@/core/useNetworkStatus";
import { ErrorBoundarySection } from "../ErrorBoundarySection";
import { store } from "@/services/api";
import { SETTING_VERSION } from "@/constants";
import Titlebar from "../Titlebar";
import Sidebar from "../Sidebar";

const LoadingScreen = memo(function LoadingScreen() {
  return (
    <div className="h-full flex items-center justify-center bg-apple-tile-3 text-white font-sans">
      <div className="w-full max-w-105 rounded-2xl border border-white/6 bg-apple-tile-1 px-7! py-8! text-center">
        <div className="mx-auto! mb-4.5! h-14 w-14 animate-spin rounded-full border-4 border-white/6 border-t-apple-primary" />
        <h1 className="mb-2! text-[22px] font-semibold">
          Đang tải giao diện
        </h1>
        <p className="m-0! leading-relaxed text-apple-ink-muted-48">
          Vui lòng chờ trong giây lát để ứng dụng khởi động.
        </p>
      </div>
    </div>
  );
});

interface AppShellProps {
  children: ReactNode;
}

function ShellInner({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const online = useNetworkStatus();
  const { layout, needSetup } = useContext(LayoutContext);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "d") {
        e.preventDefault();
        navigate("/downloads");
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      }
      if (mod && e.key === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[role='searchbox']")?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigate]);

  const sidebarVisible = !needSetup && layout === "default";

  return (
    <div className="app-container">
      <Titlebar />

      {!online && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#ff9500] text-black text-center py-2 text-[13px] font-semibold">
          Không có kết nối mạng. Một số chức năng có thể không hoạt động.
        </div>
      )}

      <main className="app-main-content flex flex-row overflow-hidden">
        {sidebarVisible && <Sidebar />}
        <ContentArea>
          <Suspense fallback={<LoadingScreen />}>
            <ErrorBoundarySection>
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  className="size-full"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    transition: { duration: 0.12, ease: [0.4, 0, 0.2, 1] },
                  }}
                  exit={{
                    opacity: 0,
                    transition: { duration: 0.04, ease: [0.4, 0, 1, 1] },
                  }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </ErrorBoundarySection>
          </Suspense>
        </ContentArea>
      </main>
    </div>
  );
}

function AppShellInner({ children }: AppShellProps) {
  const [needSetup, setNeedSetup] = useState<boolean | null>(null);

  useEffect(() => {
    store
      .get("settingVersion")
      .then((storedVersion: string) => {
        setNeedSetup(storedVersion !== SETTING_VERSION);
      })
      .catch(() => setNeedSetup(false));
  }, []);

  if (needSetup === null) return <LoadingScreen />;

  return (
    <LayoutProvider needSetup={needSetup}>
      <ShellInner>{children}</ShellInner>
    </LayoutProvider>
  );
}

export function AppShell({ children }: AppShellProps) {
  return <AppShellInner>{children}</AppShellInner>;
}
