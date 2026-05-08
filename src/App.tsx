import { lazy, memo, Suspense } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";

const Home = lazy(() => import("./ui/home"));
const Settings = lazy(() => import("./ui/setting"));
const Downloads = lazy(() => import("./ui/download"));
const SelectDevice = lazy(() => import("./ui/SelectDevice"));
const IPSWUpdateManager = lazy(() => import("./ui/IPSWUpdateManager"));
const Welcome = lazy(() => import("./ui/welcome"));

const LoadingScreen = memo(() => (
    <div
        style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0f172a 0%, #111827 50%, #1e293b 100%)",
            color: "#e2e8f0",
            fontFamily: "Inter, system-ui, sans-serif",
        }}
    >
        <div
            style={{
                width: "100%",
                maxWidth: 420,
                padding: "32px 28px",
                borderRadius: 24,
                background: "rgba(15, 23, 42, 0.72)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                boxShadow: "0 20px 60px rgba(0, 0, 0, 0.35)",
                textAlign: "center",
                backdropFilter: "blur(14px)",
            }}
        >
            <div
                style={{
                    width: 56,
                    height: 56,
                    margin: "0 auto 18px",
                    borderRadius: "50%",
                    border: "4px solid rgba(148, 163, 184, 0.22)",
                    borderTopColor: "#60a5fa",
                    animation: "ipsw-spin 1s linear infinite",
                }}
            />
            <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700 }}>Đang tải giao diện</h1>
            <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.6 }}>
                Vui lòng chờ trong giây lát để ứng dụng khởi động.
            </p>
        </div>
        <style>{`
            @keyframes ipsw-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `}</style>
    </div>
));

export default function App() {
    return (
        <HashRouter>
            <Suspense fallback={<LoadingScreen />}>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route path="/selectDevice" element={<SelectDevice />} />
                    <Route path="/ipswUpdate" element={<IPSWUpdateManager />} />
                    <Route path="/welcome" element={<Welcome />} />
                </Routes>
            </Suspense>
        </HashRouter>
    )
}