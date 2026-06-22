import { useEffect } from "react";
import { HashRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/popover";
import { initThemeWatcher, ensureProfilesExist } from "@/lib/store";
import { writeError, writeLog } from "@/lib/log";
import { StartPage } from "@/pages/StartPage";
import { EditorPage } from "@/editor/EditorPage";
import { PresentationPage } from "@/presentation/PresentationPage";
import { PresentWindow } from "@/presentation/PresentWindow";

export default function App() {
  useEffect(() => {
    initThemeWatcher();
    ensureProfilesExist();
    writeLog("info", "app", "App started");

    const onError = (event: ErrorEvent) => {
      writeError("window", "Unhandled error", event.error ?? event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      writeError("window", "Unhandled promise rejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/editor/:id" element={<EditorPage />} />
          <Route path="/presentation/:id" element={<PresentationPage />} />
          <Route path="/present/:id" element={<PresentWindow />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            borderRadius: "10px",
            border: "1px solid var(--color-border)",
            background: "var(--color-popover)",
            color: "var(--color-popover-foreground)",
          },
        }}
      />
    </TooltipProvider>
  );
}
