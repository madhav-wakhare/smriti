/** Shared queries and small hooks. Query keys start with the concept name, so one invalidate refreshes a concept. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, qs, type Capture, type Collection, type ObsidianStatus, type Quote, type Revisit, type Config, type Project, type Session, type Source, type Task, type Today } from "./api";

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => api.get<Config>("/config"), staleTime: 60_000 });
export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api.get<Project[]>("/projects") });
export const useToday = () => useQuery({ queryKey: ["today"], queryFn: () => api.get<Today>("/today") });
export const useRunning = () =>
  useQuery({ queryKey: ["sessions", "running"], queryFn: () => api.get<Session | null>("/sessions/running"), refetchInterval: 30_000 });

export const useTasks = (params: { status?: string; project_id?: number | null; planned_on?: string; parent_id?: number; tag?: string; q?: string } = {}) =>
  useQuery({ queryKey: ["tasks", params], queryFn: () => api.get<Task[]>(`/tasks${qs(params)}`) });
export const useSources = (params: { kind?: string; status?: string; tag?: string; q?: string } = {}) =>
  useQuery({ queryKey: ["sources", params], queryFn: () => api.get<Source[]>(`/sources${qs(params)}`) });
export const useCaptures = (status = "open") =>
  useQuery({ queryKey: ["captures", status], queryFn: () => api.get<Capture[]>(`/captures${qs({ status })}`) });
export const useObsidian = () => useQuery({ queryKey: ["obsidian"], queryFn: () => api.get<ObsidianStatus>("/obsidian"), staleTime: 60_000 });
export const useCollections = () => useQuery({ queryKey: ["collections"], queryFn: () => api.get<Collection[]>("/collections") });
export const useQuotes = () => useQuery({ queryKey: ["quotes"], queryFn: () => api.get<Quote[]>("/quotes"), staleTime: 60_000 });
export const useRevisits = (status = "active") =>
  useQuery({ queryKey: ["revisits", status], queryFn: () => api.get<Revisit[]>(`/revisits${qs({ status })}`) });

/** After any write: refresh everything that summarises data (today, report, counts). Cheap for a personal app. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

/** Ticks every second, for running timers. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A value kept in localStorage (per-browser UI preference). Survives a blocked storage. */
export function useLocalState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setV(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  return [v, set] as const;
}
