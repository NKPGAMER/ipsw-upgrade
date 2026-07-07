import { useState, useEffect } from "react";

export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const go = () => setOnline(true);
    const went = () => setOnline(false);
    window.addEventListener("online", go);
    window.addEventListener("offline", went);
    return () => {
      window.removeEventListener("online", go);
      window.removeEventListener("offline", went);
    };
  }, []);

  return online;
}
