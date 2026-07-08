import { lazy, memo, Suspense, useState, useEffect, Component } from "react";
import { motion, AnimatePresence } from "motion/react";
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { SETTING_VERSION } from "./ui/welcome";
import { useNetworkStatus } from "./core/useNetworkStatus";
import { ErrorBoundarySection } from "./ui/ErrorBoundarySection";

const Home = lazy(() => import("./ui/home"));
const Settings = lazy(() => import("./ui/setting"));
const Downloads = lazy(() => import("./ui/download"));
const SelectDevice = lazy(() => import("@pages/SelectDevice/index"));
const IPSWUpdateManager = lazy(() => import("./ui/IPSWUpdateManager"));
const AppUpdate = lazy(() => import("./ui/appUpdate"));
const Welcome = lazy(() => import("./ui/welcome"));

// ─── Error Boundary ──────────────────────────────────────────────────────────

interface EBState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: React.ReactNode }, EBState> {
  state: EBState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-apple-tile-3 text-white font-sans">
          <div className="w-full max-w-105 rounded-2xl border border-white/6 bg-apple-tile-1 px-7! py-8! text-center">
            <div className="mx-auto! mb-4.5! h-14 w-14 rounded-full bg-[#ff3b30]/15 flex items-center justify-center">
              <span className="text-3xl">&#9888;</span>
            </div>
            <h1 className="mb-2! text-[22px] font-semibold">
              Đã xảy ra lỗi
            </h1>
            <p className="m-0! mb-4! text-sm leading-relaxed text-apple-ink-muted-48 break-all">
              {this.state.error?.message || "Lỗi không xác định"}
            </p>
            <button
              onClick={this.handleReload}
              className="px-6 py-2 rounded-full bg-apple-primary hover:bg-apple-primary-focus text-white text-sm font-medium transition-colors cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const LoadingScreen = memo(() => (
    <div className="min-h-screen flex items-center justify-center bg-apple-tile-3 text-white font-sans">
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
));

LoadingScreen.displayName = "LoadingScreen";

function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();
    const online = useNetworkStatus();
    const [needSetup, setNeedSetup] = useState<boolean | null>(null);

    useEffect(() => {
        window.store.get('settingVersion').then((storedVersion: string) => {
            setNeedSetup(storedVersion !== SETTING_VERSION);
        }).catch(() => setNeedSetup(false));
    }, []);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key === "d") { e.preventDefault(); navigate("/downloads"); }
            if (mod && e.key === ",") { e.preventDefault(); navigate("/settings"); }
            if (mod && e.key === "f") { e.preventDefault(); document.querySelector<HTMLInputElement>("[role='searchbox']")?.focus(); }
            if (e.key === "Escape") navigate(-1);
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [navigate]);

    if (needSetup === null) return <LoadingScreen />;

    return (
        <>
            {!online && (
                <div className="fixed top-0 left-0 right-0 z-50 bg-[#ff9500] text-black text-center py-2 text-[13px] font-semibold">
                    Không có kết nối mạng. Một số chức năng có thể không hoạt động.
                </div>
            )}
            <Suspense fallback={<LoadingScreen />}>
                <ErrorBoundary>
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={location.pathname}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } }}
                            exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
                            style={{ minHeight: '100%' }}
                        >
                            <Routes location={location}>
                                <Route path="/" element={needSetup ? <Navigate to="/welcome" replace /> : <Home />} />
                                <Route path="/settings" element={<Settings />} />
                                <Route path="/downloads" element={<Downloads />} />
                                <Route path="/selectDevice" element={<ErrorBoundarySection><SelectDevice /></ErrorBoundarySection>} />
                                <Route path="/ipswUpdate" element={<ErrorBoundarySection><IPSWUpdateManager /></ErrorBoundarySection>} />
                                <Route path="/appUpdate" element={<AppUpdate />} />
                                <Route path="/welcome" element={<Welcome />} />
                            </Routes>
                        </motion.div>
                    </AnimatePresence>
                </ErrorBoundary>
            </Suspense>
        </>
    );
}

export default function App() {
    return (
        <HashRouter>
            <AppContent />
        </HashRouter>
    )
}
