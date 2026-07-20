import { create } from "zustand";
import type { Task, TaskStatus } from "@custom-type/downloader";

export type DownloadFilter = TaskStatus | "all";

type TaskMap = Record<string, Task>;

interface DownloadStoreState {
  taskIds: string[];
  tasksById: TaskMap;
  filter: DownloadFilter;
  hydrated: boolean;
  activeUrls: Set<string>;
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: string) => void;
  setFilter: (filter: DownloadFilter) => void;
  markHydrated: () => void;
  patchTask: (id: string, patch: Partial<Task>) => void;
  updateProgress: (id: string, progress: number, speed: number, eta?: number) => void;
  getActiveDownloadUrls: () => string[];
}

const mergeTask = (task: Task, patch: Partial<Task>): Task => ({ ...task, ...patch });

function buildActiveUrls(taskIds: string[], tasksById: TaskMap): Set<string> {
  const urls = new Set<string>();
  for (const id of taskIds) {
    const url = tasksById[id]?.firmware.url;
    if (url) urls.add(url);
  }
  return urls;
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  taskIds: [],
  tasksById: {},
  filter: "all",
  hydrated: false,
  activeUrls: new Set<string>(),
  setTasks: (tasks) =>
    set(() => {
      const taskIds = tasks.map((task) => task.id);
      const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task]));
      return { taskIds, tasksById, activeUrls: buildActiveUrls(taskIds, tasksById) };
    }),
  upsertTask: (task) =>
    set((state) => {
      const exists = !!state.tasksById[task.id];
      const taskIds = exists ? state.taskIds : [...state.taskIds, task.id];
      const tasksById = { ...state.tasksById, [task.id]: task };
      return { taskIds, tasksById, activeUrls: buildActiveUrls(taskIds, tasksById) };
    }),
  removeTask: (id) =>
    set((state) => {
      if (!state.tasksById[id]) return state;
      const { [id]: _, ...tasksById } = state.tasksById;
      const taskIds = state.taskIds.filter((taskId) => taskId !== id);
      return { taskIds, tasksById, activeUrls: buildActiveUrls(taskIds, tasksById) };
    }),
  setFilter: (filter) => set({ filter }),
  markHydrated: () => set({ hydrated: true }),
  patchTask: (id, patch) =>
    set((state) => {
      const task = state.tasksById[id];
      if (!task) return state;
      const newTask = mergeTask(task, patch);
      const tasksById = { ...state.tasksById, [id]: newTask };
      return { tasksById, activeUrls: buildActiveUrls(state.taskIds, tasksById) };
    }),
  updateProgress: (id, progress, speed, eta) =>
    set((state) => {
      const task = state.tasksById[id];
      if (!task) return state;
      return {
        tasksById: {
          ...state.tasksById,
          [id]: { ...task, progress, speed, eta },
        },
      };
    }),
  getActiveDownloadUrls: () => {
    return [...get().activeUrls];
  },
}));
