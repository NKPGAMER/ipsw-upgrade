import { lazy, memo, Suspense, useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { SETTING_VERSION } from "./ui/welcome";

const Home = lazy(() => import("./ui/home"));
const Settings = lazy(() => import("./ui/setting"));
const Downloads = lazy(() => import("./ui/download"));
const SelectDevice = lazy(() => import("./ui/SelectDevice"));
const IPSWUpdateManager = lazy(() => import("./ui/IPSWUpdateManager"));
const AppUpdate = lazy(() => import("./ui/appUpdate"));
const Welcome = lazy(() => import("./ui/welcome"));

const LoadingScreen = memo(() => (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-slate-900 via-gray-900 to-slate-800 text-slate-200 font-sans">
        <div className="w-full max-w-[420px] rounded-3xl border border-slate-400/20 bg-slate-900/70 px-7! py-8! text-center shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-[14px]">
            <div className="mx-auto! mb-[18px]! h-14 w-14 animate-spin rounded-full border-4 border-slate-400/20 border-t-blue-400" />

            <h1 className="mb-2! text-[22px] font-bold">
                Đang tải giao diện
            </h1>

            <p className="m-0! leading-relaxed text-slate-400">
                Vui lòng chờ trong giây lát để ứng dụng khởi động.
            </p>
        </div>
    </div>
));

export default function App() {
    const [checking, setChecking] = useState(true);
    const [needSetup, setNeedSetup] = useState(false);

    useEffect(() => {
        window.store.get('settingVersion').then((storedVersion: string) => {
            if (storedVersion !== SETTING_VERSION) {
                setNeedSetup(true);
            }
            setChecking(false);
        }).catch(() => {
            setChecking(false);
        });
    }, []);

    if (checking) return <LoadingScreen />;

    return (
        <HashRouter>
            <Suspense fallback={<LoadingScreen />}>
                <Routes>
                    <Route path="/" element={needSetup ? <Navigate to="/welcome" replace /> : <Home />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/downloads" element={<Downloads />} />
                    <Route path="/selectDevice" element={<SelectDevice />} />
                    <Route path="/ipswUpdate" element={<IPSWUpdateManager />} />
                    <Route path="/appUpdate" element={<AppUpdate />} />
                    <Route path="/welcome" element={<Welcome />} />
                </Routes>
            </Suspense>
        </HashRouter>
    )
}