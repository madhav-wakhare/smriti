import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import "./index.css";
import Today from "./pages/Today";

// Today is the landing page and ships in the main bundle; the rest load on first visit.
const Tasks = lazy(() => import("./pages/Tasks"));
const Learn = lazy(() => import("./pages/Learn"));
const Revisit = lazy(() => import("./pages/Revisit"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Report = lazy(() => import("./pages/Report"));
const Trash = lazy(() => import("./pages/Trash"));
const Settings = lazy(() => import("./pages/Settings"));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Today />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="work" element={<Navigate to="/tasks" replace />} />
              <Route path="learn" element={<Learn />} />
              <Route path="revisit" element={<Revisit />} />
              <Route path="recall" element={<Navigate to="/revisit" replace />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="report" element={<Report />} />
              <Route path="trash" element={<Trash />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Today />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Once the first page is up and the browser is idle, fetch the other pages' code so a tab click is instant.
const preload = () =>
  [
    () => import("./pages/Tasks"),
    () => import("./pages/Learn"),
    () => import("./pages/Revisit"),
    () => import("./pages/Inbox"),
    () => import("./pages/Report"),
    () => import("./pages/Settings"),
    () => import("./pages/Trash"),
  ].forEach((load) => void load());
if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 3000 });
else setTimeout(preload, 1500);
