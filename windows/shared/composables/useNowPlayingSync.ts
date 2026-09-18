import type { Ref, ShallowRef } from "vue";
import type { LyricLine } from "@shared/types/lyrics";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";
import type { Track } from "@shared/types/player";
import { pickLatestActiveIndex } from "@shared/utils/lyricSync";
import { clampLastLineEnd } from "lyric-kit";

/** 同步偏差阈值 */
const SYNC_DRIFT_THRESHOLD = 300;

/** 提供给逐字高亮的非响应式当前播放时间 */
let currentNowPlayingMs = 0;

export const getNowPlayingCurrentMs = (): number => currentNowPlayingMs;

export interface NowPlayingSyncOptions {
  /** 选择当前主行索引的算法 */
  pickIndex: (lyric: LyricLine[], time: number) => number;
  /** 日志 / 错误前缀 */
  logTag: string;
  /** 是否为当前窗口维护独立背景歌词时间轴 */
  includeBackground?: boolean;
}

export interface NowPlayingSync {
  track: ShallowRef<Track | null>;
  lyric: ShallowRef<LyricLine[]>;
  backgroundLyric: ShallowRef<LyricLine[]>;
  playing: Ref<boolean>;
  primaryIndex: Ref<number>;
  backgroundIndex: Ref<number>;
}

/**
 * 播放状态同步
 * 拉取 / 订阅快照、维护播放锚点、RAF 高频更新 currentMs 与 primaryIndex
 */
export const useNowPlayingSync = (options: NowPlayingSyncOptions): NowPlayingSync => {
  const { pickIndex, logTag, includeBackground = false } = options;

  const track = shallowRef<Track | null>(null);
  const lyric = shallowRef<LyricLine[]>([]);
  const backgroundLyric = shallowRef<LyricLine[]>([]);
  const playing = ref(false);
  const primaryIndex = ref(-1);
  const backgroundIndex = ref(-1);

  let anchorPos = 0;
  let anchorPerf = 0;
  let anchorInitialized = false;
  let rafId: number | null = null;
  /** 当前曲目歌词偏移（ms，正值为歌词提前） */
  let lyricOffsetMs = 0;
  /** 当前播放速度倍率，插值时把墙钟时长换算到源时间 */
  let speed = 1.0;

  const resetAnchor = (positionMs: number, sendTimestamp: number): void => {
    const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
    anchorPos = positionMs + (playing.value ? ipcDelay : 0);
    anchorPerf = performance.now();
    // currentNowPlayingMs 始终是「叠加 offset 后的歌词时间」，与 syncOnce 保持一致
    currentNowPlayingMs = anchorPos + lyricOffsetMs;
    anchorInitialized = true;
  };

  // 倍速变化：先按旧 speed 把锚点推到当前再换挡，避免视觉跳变
  const applySpeed = (nextSpeed: number): void => {
    if (nextSpeed === speed) return;
    if (anchorInitialized && playing.value) {
      anchorPos += (performance.now() - anchorPerf) * speed;
      anchorPerf = performance.now();
    }
    speed = nextSpeed;
  };

  // 仅当与 RAF 插值的偏差超过阈值时才重置锚点，避免每次 5Hz 同步都打断动画
  const applyAnchor = (positionMs: number, sendTimestamp: number, nextSpeed: number): void => {
    applySpeed(nextSpeed);
    if (!anchorInitialized || !playing.value) {
      resetAnchor(positionMs, sendTimestamp);
      return;
    }
    const ipcDelay = Math.max(0, Date.now() - sendTimestamp);
    const candidate = positionMs + ipcDelay;
    const projected = anchorPos + (performance.now() - anchorPerf) * speed;
    if (Math.abs(candidate - projected) > SYNC_DRIFT_THRESHOLD) {
      resetAnchor(positionMs, sendTimestamp);
    }
  };

  const applySnapshot = (snap: NowPlayingSnapshot): void => {
    track.value = snap.track;
    const mainLines = snap.lyric.filter((line) => !line.isBG);
    lyric.value = clampLastLineEnd(mainLines, snap.track?.duration);
    const backgroundLines = includeBackground ? snap.lyric.filter((line) => line.isBG) : [];
    backgroundLyric.value = clampLastLineEnd(backgroundLines, snap.track?.duration);
    playing.value = snap.playing;
    speed = snap.speed;
    lyricOffsetMs = snap.lyricOffsetMs;
    primaryIndex.value = -1;
    backgroundIndex.value = -1;
    resetAnchor(snap.position, snap.sendTimestamp);
  };

  const syncOnce = (): void => {
    const next = playing.value ? anchorPos + (performance.now() - anchorPerf) * speed : anchorPos;
    currentNowPlayingMs = next + lyricOffsetMs;
    const idx = pickIndex(lyric.value, currentNowPlayingMs);
    if (idx !== primaryIndex.value) primaryIndex.value = idx;
    if (includeBackground) {
      const bgIdx = pickLatestActiveIndex(backgroundLyric.value, currentNowPlayingMs);
      if (bgIdx !== backgroundIndex.value) backgroundIndex.value = bgIdx;
    }
  };

  const tick = (): void => {
    if (document.hidden) {
      rafId = null;
      return;
    }
    syncOnce();
    rafId = playing.value ? requestAnimationFrame(tick) : null;
  };

  const kickTick = (): void => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(tick);
  };

  const handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      return;
    }
    syncOnce();
    kickTick();
  };

  const unsubscribers: Array<() => void> = [];

  onMounted(async () => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    try {
      const snap = await window.api.nowPlaying.requestSnapshot();
      applySnapshot(snap);
    } catch (error) {
      console.error(`[${logTag}] requestSnapshot failed`, error);
    }

    unsubscribers.push(
      window.api.nowPlaying.onLyricChange((snap) => {
        applySnapshot(snap);
        kickTick();
      }),
      window.api.nowPlaying.onPositionSync((data) => {
        playing.value = data.playing;
        applyAnchor(data.position, data.sendTimestamp, data.speed);
        kickTick();
      }),
      window.api.nowPlaying.onLyricOffsetChange(({ offsetMs }) => {
        lyricOffsetMs = offsetMs;
        // 暂停时主动重算一次
        syncOnce();
      }),
    );

    kickTick();
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const off of unsubscribers) off();
  });

  return { track, lyric, backgroundLyric, playing, primaryIndex, backgroundIndex };
};
