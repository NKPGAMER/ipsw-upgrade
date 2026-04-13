import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { createRoot } from "react-dom/client";
import "./index";

const Home = lazy(() => import("./ui/home"));
const Settings = lazy(() => import("./ui/setting"));
const Downloads = lazy(() => import("./ui/download"));
const SelectDevice = lazy(() => import("./ui/SelectDevice"));

createRoot(document.getElementById('root')!).render(
    <HashRouter>
        <Suspense fallback={<div>Loading...</div>}>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/downloads" element={<Downloads />} />
                <Route path="/selectDevice" element={<SelectDevice />}/>
            </Routes>
        </Suspense>
    </HashRouter>
);