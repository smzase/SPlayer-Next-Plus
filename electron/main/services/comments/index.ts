import { callNetease } from "@main/apis/netease";

import { pickBestCandidate, type LyricCandidate } from "@main/apis/common/lyric/utils";
import { pluginRegistry, type PluginRuntime } from "@main/plugins/registry";
import { callMusicComment, callMusicSearch } from "@main/plugins/router";
import { pluginLog } from "@main/utils/logger";
import type {
  CommentAddArgs,
  CommentDeleteArgs,
  CommentLikeArgs,
  CommentQuery,
  CommentReplyArgs,
  CommentSource,
  CommentTarget,
  MusicCommentItem,
  MusicCommentPage,
} from "@shared/types/comment";
import type { MusicSearchCandidate } from "@shared/types/plugin";
import type { Track } from "@shared/types/player";
import {
  buildCommentSources,
  normalizeNeteaseCommentPage,
  normalizeNeteaseMutationComment,
} from "./data";

const NETEASE_SOURCE_ID = "builtin:netease";
const NETEASE_RESOURCE_TYPES: Record<CommentTarget["kind"], string> = {
  song: "R_SO_4_",
  playlist: "A_PL_0_",
  album: "R_AL_3_",
  radio: "A_DJ_1_",
};

const PLATFORM_TO_PLUGIN_SOURCE: Record<string, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface ParsedPluginSource {
  pluginId: string;
  source: string;
}

interface NeteaseCommentResource {
  id: string;
  threadId: string;
}

const parsePluginSource = (sourceId: string): ParsedPluginSource | null => {
  if (!sourceId.startsWith("plugin:")) return null;
  const rest = sourceId.slice("plugin:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  return {
    pluginId: rest.slice(0, sep),
    source: rest.slice(sep + 1),
  };
};

const toKeyword = (track: Track): string =>
  `${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`.trim();

const toPluginCandidate = (track: Track): MusicSearchCandidate => ({
  id: track.id,
  name: track.title,
  singer: track.artists.map((artist) => artist.name).join("/"),
  album: track.album?.name,
  durationMs: track.duration,
});

const findPluginMatch = async (
  rt: PluginRuntime,
  source: string,
  track: Track,
): Promise<MusicSearchCandidate | null> => {
  if (PLATFORM_TO_PLUGIN_SOURCE[track.source] === source && track.id)
    return toPluginCandidate(track);
  const keyword = toKeyword(track);
  if (!keyword) return null;
  const res = await callMusicSearch(rt, { source, keyword, limit: 20 });
  const list = res?.list ?? [];
  const candidates: LyricCandidate<MusicSearchCandidate>[] = list.map((item) => ({
    name: item.name,
    artist: item.singer ?? "",
    album: item.album,
    duration: item.durationMs,
    extra: item,
  }));
  return pickBestCandidate(candidates, track)?.extra ?? null;
};

const findNeteaseId = async (track: Track): Promise<string | null> => {
  if (track.source === "netease" && track.id) return track.id;
  const keyword = toKeyword(track);
  if (!keyword) return null;
  const { status, body } = await callNetease("search", {
    keywords: keyword,
    type: 1,
    limit: 20,
  });
  if (status !== 200) return null;
  const songs = body.result?.songs ?? [];
  const candidates: LyricCandidate<{ id: string }>[] = songs.map(
    (song: {
      id: string | number;
      name?: string;
      artists?: { name: string }[];
      album?: { name?: string };
      duration?: number;
    }) => ({
      name: song.name ?? "",
      artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
      album: song.album?.name,
      duration: song.duration,
      extra: { id: String(song.id) },
    }),
  );
  return pickBestCandidate(candidates, track)?.extra.id ?? null;
};

const resolveNeteaseResource = async (
  target: CommentTarget,
): Promise<NeteaseCommentResource | null> => {
  const id =
    target.kind === "song"
      ? await findNeteaseId(target.track)
      : target.source === "netease"
        ? target.id
        : null;
  if (!id) return null;
  return {
    id,
    threadId: `${NETEASE_RESOURCE_TYPES[target.kind]}${id}`,
  };
};

const requireNeteaseResource = async (target: CommentTarget): Promise<NeteaseCommentResource> => {
  const resource = await resolveNeteaseResource(target);
  if (!resource) throw new Error("无法匹配对应的网易云资源");
  return resource;
};

const assertWritableSource = (sourceId: string): void => {
  if (sourceId !== NETEASE_SOURCE_ID) throw new Error("当前评论来源不支持此操作");
};

const callCommentMutation = async (
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> => {
  const { status, body } = await callNetease(name, params);
  const code = Number(body?.code ?? status);
  if (status === 200 && code === 200) return body;
  throw new Error(body?.message ?? body?.msg ?? `netease ${code}`);
};

const getNeteaseComments = async (args: CommentQuery): Promise<MusicCommentPage> => {
  const resource = await resolveNeteaseResource(args.target);
  if (!resource) return { list: [], total: 0, page: args.page, limit: args.limit };

  const apiName = args.type === "hot" ? "comment_hot" : "comment_music";
  const { body } = await callNetease(apiName, {
    id: resource.id,
    type: NETEASE_RESOURCE_TYPES[args.target.kind],
    limit: args.limit,
    offset: (args.page - 1) * args.limit,
  });
  return normalizeNeteaseCommentPage(body, args.type, args.page, args.limit);
};

const getPluginComments = async (
  parsed: ParsedPluginSource,
  args: CommentQuery,
): Promise<MusicCommentPage> => {
  if (args.target.kind !== "song") throw new Error("plugin comments only support songs");
  const rt = pluginRegistry.getRuntime(parsed.pluginId);
  if (!rt || rt.status.state !== "ready") throw new Error("plugin comment source is not ready");
  try {
    const musicInfo = await findPluginMatch(rt, parsed.source, args.target.track);
    if (!musicInfo) return { list: [], total: 0, page: args.page, limit: args.limit };
    return await callMusicComment(rt, {
      source: parsed.source,
      musicInfo,
      type: args.type,
      page: args.page,
      limit: args.limit,
    });
  } catch (err) {
    pluginLog.warn(
      "matchComment failed",
      parsed.pluginId,
      parsed.source,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
};

const normalizeQuery = (args: CommentQuery): CommentQuery => ({
  ...args,
  page: Math.max(1, Math.floor(Number(args.page) || 1)),
  limit: Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(args.limit) || DEFAULT_LIMIT))),
});

/** 获取当前可用评论源 */
export const getCommentSources = (): CommentSource[] =>
  buildCommentSources(pluginRegistry.listInfo());

/** 获取歌曲、歌单或专辑评论 */
export const getComments = async (args: CommentQuery): Promise<MusicCommentPage> => {
  const query = normalizeQuery(args);
  if (query.sourceId === NETEASE_SOURCE_ID) return getNeteaseComments(query);
  const parsed = parsePluginSource(query.sourceId);
  if (parsed) return getPluginComments(parsed, query);
  throw new Error(`unknown comment source: ${query.sourceId}`);
};

/** 发布网易云资源评论 */
export const addComment = async (args: CommentAddArgs): Promise<MusicCommentItem | undefined> => {
  assertWritableSource(args.sourceId);
  const content = args.content.trim();
  if (!content) throw new Error("评论内容不能为空");
  const resource = await requireNeteaseResource(args.target);
  const body = await callCommentMutation("comment_add", {
    thread_id: resource.threadId,
    content,
  });
  return normalizeNeteaseMutationComment(body);
};

/** 回复网易云资源评论 */
export const replyComment = async (
  args: CommentReplyArgs,
): Promise<MusicCommentItem | undefined> => {
  assertWritableSource(args.sourceId);
  const content = args.content.trim();
  if (!content) throw new Error("回复内容不能为空");
  const resource = await requireNeteaseResource(args.target);
  const body = await callCommentMutation("comment_reply", {
    thread_id: resource.threadId,
    comment_id: args.commentId,
    content,
  });
  return normalizeNeteaseMutationComment(body);
};

/** 点赞或取消点赞网易云资源评论 */
export const likeComment = async (args: CommentLikeArgs): Promise<void> => {
  assertWritableSource(args.sourceId);
  const resource = await requireNeteaseResource(args.target);
  await callCommentMutation("comment_like", {
    thread_id: resource.threadId,
    comment_id: args.commentId,
    like: args.liked,
  });
};

/** 删除自己的网易云资源评论 */
export const deleteComment = async (args: CommentDeleteArgs): Promise<void> => {
  assertWritableSource(args.sourceId);
  const resource = await requireNeteaseResource(args.target);
  await callCommentMutation("comment_delete", {
    thread_id: resource.threadId,
    comment_id: args.commentId,
  });
};
