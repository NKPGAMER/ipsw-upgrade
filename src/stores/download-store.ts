import { create } from "zustand";
import type { Task, TaskStatus } from "@/bind";

export type DownloadFilter = TaskStatus | "all";

type TaskMap = Record<string, Task>;

interface DownloadStoreState {
  taskIds: string[];
  tasksById: TaskMap;
  filter: DownloadFilter;
  hydrated: boolean;
  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  removeTask: (id: string) => void;
  setFilter: (filter: DownloadFilter) => void;
  markHydrated: () => void;
  patchTask: (id: string, patch: Partial<Task>) => void;
  getActiveDownloadUrls: () => string[];
}

const mergeTask = (task: Task, patch: Partial<Task>): Task => ({ ...task, ...patch });

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  taskIds: [],
  tasksById: {},
  filter: "all",
  hydrated: false,
  setTasks: (tasks) =>
    set(() => ({
      taskIds: tasks.map((task) => task.id),
      tasksById: Object.fromEntries(tasks.map((task) => [task.id, task])),
    })),
  upsertTask: (task) =>
    set((state) => ({
      taskIds: state.tasksById[task.id] ? state.taskIds : [...state.taskIds, task.id],
      tasksById: { ...state.tasksById, [task.id]: task },
    })),
  removeTask: (id) =>
    set((state) => {
      if (!state.tasksById[id]) return state;
      const { [id]: _, ...tasksById } = state.tasksById;
      return {
        taskIds: state.taskIds.filter((taskId) => taskId !== id),
        tasksById,
      };
    }),
  setFilter: (filter) => set({ filter }),
  markHydrated: () => set({ hydrated: true }),
  patchTask: (id, patch) =>
    set((state) => {
      const task = state.tasksById[id];
      if (!task) return state;
      return {
        tasksById: {
          ...state.tasksById,
          [id]: mergeTask(task, patch),
        },
      };
    }),
  getActiveDownloadUrls: () => {
    const state = get();
    return state.taskIds
      .map((id) => state.tasksById[id]?.firmware.url)
      .filter((url): url is string => Boolean(url));
  },
}));
