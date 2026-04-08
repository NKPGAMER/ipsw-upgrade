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


// const freeSpace = await window.api.getDiskSpace(state.currentFolder);
//     const downloaded = data.localFiles.length;

//     elements.stats.downloadedCount.textContent = downloaded.toString();
//     elements.stats.storageUsed.textContent = utils.formatBytes(data.localFiles.reduce((total, num) => total + num.size, 0));
//     elements.stats.freeSpace.textContent = utils.formatBytes(freeSpace.available);

//     // Thêm cảnh báo màu sắc theo % dung lượng còn trống
//     const percentage = freeSpace.percentage;
//     const freeSpaceElement = elements.stats.freeSpace;

//     // Reset các class trước đó
//     freeSpaceElement.className = freeSpaceElement.className
//       .replace(/text-(red|yellow|green)-(500|600)/g, '')
//       .trim();

//     percentage >= 60
//       ? freeSpaceElement.classList.add(percentage >= 90 ? 'text-red-600' : 'text-yellow-500', 'font-semibold')
//       : freeSpaceElement.classList.add('text-green-600')