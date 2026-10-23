import { LyricPlayer, type LyricLine, type LyricWord } from "@applemusic-like-lyrics/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface CapturedAnimation {
  target: Element;
  timing: KeyframeAnimationOptions;
}

describe("AMLL 词内长音衔接", () => {
  const animations: CapturedAnimation[] = [];
  const players: LyricPlayer[] = [];
  const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: function (
        this: Element,
        _frames: Keyframe[] | PropertyIndexedKeyframes | null,
        options: KeyframeAnimationOptions,
      ) {
        animations.push({ target: this, timing: options });
        return {
          id: options.id,
          currentTime: 0,
          playbackRate: 1,
          playState: "paused",
          effect: { getComputedTiming: () => options },
          play: vi.fn(),
          pause: vi.fn(),
          cancel: vi.fn(),
        };
      },
    });
  });

  afterEach(() => {
    for (const player of players) player.dispose();
    players.length = 0;
    animations.length = 0;
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  });

  /**
   * 用真实 AMLL 构建歌词行，并捕获交给浏览器的动画时序
   * @param words - 保留原始时间戳和注音的音节
   * @returns 构建后的歌词行与主歌词元素
   */
  const renderLine = (words: LyricWord[]) => {
    const player = new LyricPlayer();
    players.push(player);
    player.setOptimizeOptions({
      cleanUnintentionalOverlaps: false,
      tryAdvanceStartTime: false,
      syncMainAndBackgroundLines: false,
      normalizeSpaces: false,
      resetLineTimestamps: false,
    });
    const line: LyricLine = {
      words,
      startTime: words[0].startTime,
      endTime: words.at(-1)!.endTime,
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    };
    player.setLyricLines([line], line.startTime);
    const rendered = player.currentLyricGroups[0].mainLine;
    rendered.rebuildElement();
    return { rendered, main: rendered.getElement().firstElementChild! };
  };

  it("宝物共用错峰强调，物在自身高亮前开始放大，逐字时间保持不变", () => {
    const words: LyricWord[] = [
      { word: "宝", startTime: 140630, endTime: 143760 },
      { word: "物", startTime: 143760, endTime: 146500 },
    ];
    const { rendered, main } = renderLine(words);
    expect(main.children).toHaveLength(1);
    expect(main.firstElementChild!.children).toHaveLength(2);
    expect(rendered.getLine().words).toEqual(words);
    const bao = animations.find(({ timing }) => timing.id === "emphasize-word-宝-0")!;
    const wu = animations.find(({ timing }) => timing.id === "emphasize-word-物-1")!;
    expect(bao).toBeDefined();
    expect(wu).toBeDefined();
    expect(wu.timing.duration).toBe(bao.timing.duration);
    expect(wu.timing.delay).toBeGreaterThan(bao.timing.delay!);
    expect(140630 + wu.timing.delay!).toBeCloseTo(142038.8);
    expect(140630 + wu.timing.delay!).toBeLessThan(143760);
    expect(wu.timing.delay!).toBeLessThan(bao.timing.delay! + Number(bao.timing.duration));
    const normalFloat = animations.find(
      ({ target, timing }) => timing.id === "float-word" && target.textContent === "物",
    )!;
    expect(normalFloat.timing.delay).toBe(3130);
  });

  it("空格隔开的长音仍各自强调", () => {
    const { main } = renderLine([
      { word: "宝 ", startTime: 1000, endTime: 3000 },
      { word: "物", startTime: 3000, endTime: 5000 },
    ]);
    expect(main.textContent).toBe("宝 物");
    expect(animations.some(({ timing }) => timing.id === "emphasize-word-物-0")).toBe(true);
    expect(animations.some(({ timing }) => timing.id === "emphasize-word-物-1")).toBe(false);
  });

  it("短音节不会仅因词语总时长达到阈值而全部强调", () => {
    renderLine([
      { word: "宝", startTime: 1000, endTime: 1600 },
      { word: "物", startTime: 1600, endTime: 2200 },
    ]);
    expect(animations.some(({ timing }) => timing.id?.startsWith("emphasize-word"))).toBe(false);
  });

  it("保留带空格音节的逐词音译分配", () => {
    const { main } = renderLine([
      { word: "你好 世界", romanWord: "nihao shijie", startTime: 1000, endTime: 5000 },
      { word: " ", startTime: 5000, endTime: 5000 },
    ]);
    const roman = Array.from(main.querySelectorAll('[class*="romanWord"]'));
    expect(roman.map((element) => element.textContent)).toEqual(["nihao", "shijie"]);
  });

  it("注音音节跨分词边界时不拆分或丢失尾部文字", () => {
    const ruby = [{ word: "たからもの", startTime: 1000, endTime: 5000 }];
    const { rendered, main } = renderLine([
      { word: " 宝物を ", startTime: 1000, endTime: 5000, ruby },
      { word: "君", startTime: 5000, endTime: 6000 },
    ]);
    expect(rendered.getLine().words[0].ruby).toEqual(ruby);
    expect(main.textContent).toBe(" たからもの宝物を 君");
    expect(main.querySelector('[class*="rubyWord"]')?.textContent).toBe("たからもの");
  });
});
