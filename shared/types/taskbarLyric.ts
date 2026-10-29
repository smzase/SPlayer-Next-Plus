import type { RepeatMode, ShuffleMode } from "./player";
import type { DragRightClickAction, LocaleCode } from "./settings";

/** 任务栏歌词统一播放模式 */
export type TaskbarPlayMode = "repeat-list" | "repeat-one" | "shuffle" | "sequential";

/** 任务栏播放列表展示项 */
export interface TaskbarQueueItem {
  id: string;
  title: string;
  artists: string;
  cover?: string;
}

/** 任务栏播放列表使用的轻量主题色板 */
export interface TaskbarThemeSnapshot {
  isDark: boolean;
  appearanceStyle: "solid" | "image";
  imageBackground: {
    src: string;
    blur: number;
    dim: number;
    scale: number;
  };
  primary: string;
  primaryContainer: string;
  surface: string;
  surfaceAlt: string;
  surfacePanel: string;
  surfaceBright: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
}

/** 主渲染进程同步给任务栏歌词的轻量播放快照 */
export interface TaskbarPlaybackSnapshot {
  items: TaskbarQueueItem[];
  currentTrackId: string | null;
  playMode: TaskbarPlayMode;
  playModeDisabled: boolean;
  /** 拖拽歌曲时的右键行为 */
  dragRightClickAction: DragRightClickAction;
  locale: LocaleCode;
  theme: TaskbarThemeSnapshot;
}

/** 统一播放模式对应的底层状态 */
export interface TaskbarPlayModeState {
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  sequential: boolean;
}
