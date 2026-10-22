import type { Playlist, Track } from "@shared/types/player";
import { NeteaseApiError, netease as neteaseApi } from "@/apis/netease";
import { fetchCreatedPodcasts, fetchSubscribedPodcasts } from "@/apis/podcast/netease";
import type {
  UserConnection,
  UserConnectionKind,
  UserConnectionPage,
  UserPageProfile,
  UserPageResources,
  UserProfileUpdate,
} from "@/types/user-profile";
import type { NeteaseSong } from "@shared/types/platform/netease";
import { ensureOk, songToTrack, toPlaylist, withPicSize } from "@/utils/format/netease";

type RawRecord = Record<string, unknown>;

const PAGE_SIZE = 50;
const MAX_PLAYLIST_PAGES = 20;

export type UserListeningRankPeriod = "week" | "all";

const asRecord = (value: unknown): RawRecord | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : undefined;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const firstRecord = (...values: unknown[]): RawRecord => values.map(asRecord).find(Boolean) ?? {};

const firstNumber = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const number = Number(value);
    if (value !== "" && Number.isFinite(number)) return number;
  }
  return undefined;
};

const firstString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
};

const firstBoolean = (...values: unknown[]): boolean | undefined => {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 0 || value === 1) return Boolean(value);
  }
  return undefined;
};

/**
 * 从新旧用户详情响应中读取资料
 * @param body - 网易云用户详情响应
 * @param uid - 请求的用户 ID
 * @returns 用户主页资料
 */
export const normalizeUserPageProfile = (body: unknown, uid: number): UserPageProfile => {
  const root = asRecord(body) ?? {};
  const data = firstRecord(root.data, root.result);
  const profile = firstRecord(root.profile, data.profile, data.userProfile, root.userProfile, data);
  const userPoint = firstRecord(root.userPoint, data.userPoint);
  const followed = firstBoolean(profile.followed, data.followed) ?? false;
  const followedBy = firstBoolean(profile.followMe, data.followMe) ?? false;
  const artistId = firstNumber(profile.artistId, data.artistId, root.artistId);
  return {
    userId: firstNumber(profile.userId, profile.id, data.userId, uid) ?? uid,
    nickname: firstString(profile.nickname, profile.name) ?? String(uid),
    avatarUrl: withPicSize(firstString(profile.avatarUrl, profile.avatar, profile.picUrl), 300),
    artistId: artistId && artistId > 0 ? String(artistId) : undefined,
    signature: firstString(profile.signature, profile.description),
    gender: firstNumber(profile.gender) ?? 0,
    birthday: firstNumber(profile.birthday),
    province: firstNumber(profile.province),
    city: firstNumber(profile.city),
    follows: firstNumber(profile.follows, profile.followCount, data.follows) ?? 0,
    followeds: firstNumber(profile.followeds, profile.followerCount, data.followeds) ?? 0,
    eventCount: firstNumber(profile.eventCount, data.eventCount) ?? 0,
    playlistCount: firstNumber(profile.playlistCount, data.playlistCount) ?? 0,
    listenSongs: firstNumber(profile.listenSongs, data.listenSongs) ?? 0,
    level: firstNumber(root.level, data.level, userPoint.level),
    vipType: firstNumber(profile.vipType, data.vipType),
    followed,
    followedBy,
    mutual: firstBoolean(profile.mutual, data.mutual) ?? (followed && followedBy),
    blacklisted:
      firstBoolean(
        profile.blacklisted,
        profile.blacklist,
        profile.inBlacklist,
        data.blacklisted,
        data.blacklist,
      ) ?? false,
  };
};

/** 获取指定用户的主页资料 */
export const fetchUserPageProfile = async (
  uid: number,
  currentUserId = 0,
): Promise<UserPageProfile> => {
  let body: unknown;
  try {
    body = await neteaseApi.user_detail_new({ uid, timestamp: Date.now() });
  } catch {
    body = await neteaseApi.user_detail({ uid, timestamp: Date.now() });
  }
  ensureOk(body);
  const profile = normalizeUserPageProfile(body, uid);
  if (!currentUserId || currentUserId === uid) return profile;
  try {
    const relation = await neteaseApi.user_mutualfollow_get({ uid, timestamp: Date.now() });
    ensureOk(relation);
    const root = asRecord(relation) ?? {};
    const data = firstRecord(root.data, root.result);
    profile.mutual =
      firstBoolean(data.mutual, data.isMutual, root.mutual, root.isMutual) ?? profile.mutual;
  } catch {
    // 互关接口失败时保留用户详情中携带的关系状态
  }
  return profile;
};

const playlistPayload = (body: unknown): { items: unknown[]; more?: boolean } => {
  const root = asRecord(body) ?? {};
  const data = firstRecord(root.data, root.result);
  const items =
    [root.playlist, root.playlists, data.playlist, data.playlists, data.list, data.records]
      .map(asArray)
      .find((value) => value.length > 0) ?? [];
  return {
    items,
    more: firstBoolean(root.more, root.hasMore, data.more, data.hasMore),
  };
};

const fetchUserPlaylistGroups = async (
  uid: number,
): Promise<{ created: Playlist[]; collected: Playlist[] }> => {
  const rawItems: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
    const body = await neteaseApi.user_playlist({
      uid,
      limit: PAGE_SIZE,
      offset,
      timestamp: Date.now(),
    });
    ensureOk(body);
    const payload = playlistPayload(body);
    rawItems.push(...payload.items);
    if (payload.more === false || payload.items.length === 0 || payload.items.length < PAGE_SIZE) {
      break;
    }
    offset += payload.items.length;
  }
  const created: Playlist[] = [];
  const collected: Playlist[] = [];
  for (const value of rawItems) {
    const raw = asRecord(value);
    if (!raw) continue;
    const creator = firstRecord(raw.creator, raw.user);
    const ownerId = firstNumber(creator.userId, raw.userId);
    const playlist = toPlaylist(raw);
    if (ownerId === uid || firstBoolean(raw.subscribed) === false) created.push(playlist);
    else collected.push(playlist);
  }
  return { created, collected };
};

const privateResourceCodes = new Set([403, 10004]);

const resourceAccessForError = (cause: unknown): "private" | "unavailable" => {
  if (!(cause instanceof NeteaseApiError)) return "unavailable";
  const body = asRecord(cause.body);
  const code = firstNumber(body?.code, cause.status);
  return code !== undefined && privateResourceCodes.has(code) ? "private" : "unavailable";
};

const settleResource = async <T>(
  loader: () => Promise<T>,
  empty: T,
): Promise<{ data: T; access: "available" | "private" | "unavailable" }> => {
  try {
    return { data: await loader(), access: "available" };
  } catch (cause) {
    return { data: empty, access: resourceAccessForError(cause) };
  }
};

/** 获取用户主页的歌单与播客分组 */
export const fetchUserPageResources = async (
  uid: number,
  own: boolean,
): Promise<UserPageResources> => {
  const [playlists, createdPodcasts, collectedPodcasts] = await Promise.all([
    settleResource(() => fetchUserPlaylistGroups(uid), { created: [], collected: [] }),
    settleResource(() => fetchCreatedPodcasts(uid), []),
    own
      ? settleResource(() => fetchSubscribedPodcasts(), [])
      : Promise.resolve({ data: [], access: "private" as const }),
  ]);
  return {
    createdPlaylists: playlists.data.created,
    collectedPlaylists: playlists.data.collected,
    createdPodcasts: createdPodcasts.data,
    collectedPodcasts: collectedPodcasts.data,
    playlistAccess: playlists.access,
    createdPodcastsAccess: createdPodcasts.access,
    collectedPodcastsAccess: collectedPodcasts.access,
  };
};

/** 获取当前用户最近一周或所有时间的听歌排行 */
export const fetchUserListeningRank = async (
  uid: number,
  period: UserListeningRankPeriod,
): Promise<Track[]> => {
  const body = ensureOk(
    await neteaseApi.user_record({
      uid,
      type: period === "week" ? 1 : 0,
      timestamp: Date.now(),
    }),
  );
  const root = asRecord(body) ?? {};
  const records = asArray(period === "week" ? root.weekData : root.allData);
  return records.flatMap((value) => {
    const record = asRecord(value);
    const song = asRecord(record?.song);
    if (!record || !song) return [];
    return [
      {
        ...songToTrack(song as unknown as NeteaseSong),
        playCount: firstNumber(record.playCount) ?? 0,
      },
    ];
  });
};

const normalizeConnection = (value: unknown): UserConnection | undefined => {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const artist = asRecord(raw.artistInfo) ?? asRecord(raw.artist);
  const profile = firstRecord(raw.userProfile, raw.profile, raw.user, artist, raw);
  const id = firstNumber(profile.userId, profile.id, raw.followId, raw.userId, raw.id);
  const name = firstString(profile.nickname, profile.name, raw.nickname, raw.name);
  if (!id || !name) return undefined;
  const followed = firstBoolean(profile.followed, raw.followed) ?? false;
  const followedBy = firstBoolean(profile.followMe, raw.followMe) ?? false;
  const kind =
    artist || raw.resourceType === "artist" || raw.type === "artist" || raw.type === 2
      ? "artist"
      : "user";
  return {
    id,
    name,
    avatar: withPicSize(
      firstString(profile.avatarUrl, profile.img1v1Url, profile.picUrl, raw.avatarUrl),
      160,
    ),
    signature: firstString(profile.signature, profile.briefDesc, raw.signature),
    kind,
    followed,
    mutual: firstBoolean(profile.mutual, raw.mutual) ?? (followed && followedBy),
  };
};

const connectionPayload = (
  body: unknown,
): {
  items: UserConnection[];
  more: boolean;
  nextCursor?: number;
} => {
  const root = asRecord(body) ?? {};
  const data = firstRecord(root.data, root.result);
  const page = firstRecord(data.page, root.page);
  const values =
    [
      root.follow,
      root.followeds,
      root.users,
      data.follow,
      data.followeds,
      data.users,
      data.list,
      data.records,
      page.list,
      page.records,
    ]
      .map(asArray)
      .find((value) => value.length > 0) ?? [];
  return {
    items: values.flatMap((value) => {
      const item = normalizeConnection(value);
      return item ? [item] : [];
    }),
    more: firstBoolean(root.more, root.hasMore, data.more, data.hasMore, page.more) ?? false,
    nextCursor: firstNumber(data.cursor, data.nextCursor, page.cursor, page.nextCursor),
  };
};

/** 获取用户关注列表 */
export const fetchUserConnections = async (
  uid: number,
  kind: UserConnectionKind,
  own: boolean,
  cursor = 0,
): Promise<UserConnectionPage> => {
  if (own) {
    const scene = kind === "artist" ? 1 : kind === "user" ? 2 : 0;
    const body = await neteaseApi.user_follow_mixed({
      scene,
      cursor,
      size: 30,
      timestamp: Date.now(),
    });
    ensureOk(body);
    const payload = connectionPayload(body);
    return {
      items: payload.items.map((item) => ({ ...item, followed: true })),
      more: payload.more,
      nextCursor: payload.nextCursor,
    };
  }
  if (kind === "artist") return { items: [], more: false };
  const body = await neteaseApi.user_follows({
    uid,
    offset: cursor,
    limit: 30,
    timestamp: Date.now(),
  });
  ensureOk(body);
  const payload = connectionPayload(body);
  return {
    items: payload.items,
    more: payload.more || payload.items.length === 30,
    nextCursor: cursor + payload.items.length,
  };
};

/** 获取用户粉丝列表 */
export const fetchUserFollowers = async (uid: number, offset = 0): Promise<UserConnectionPage> => {
  const body = await neteaseApi.user_followeds({
    uid,
    offset,
    limit: 30,
    timestamp: Date.now(),
  });
  ensureOk(body);
  const payload = connectionPayload(body);
  return {
    items: payload.items,
    more: payload.more || payload.items.length === 30,
    nextCursor: offset + payload.items.length,
  };
};

/** 关注或取消关注用户 */
export const setUserFollowed = async (uid: number, followed: boolean): Promise<void> => {
  ensureOk(await neteaseApi.follow({ id: uid, t: followed ? 1 : 0, timestamp: Date.now() }));
};

/** 添加或解除用户黑名单 */
export const setUserBlacklisted = async (uid: number, blacklisted: boolean): Promise<void> => {
  ensureOk(
    await neteaseApi.user_blacklist_update({
      uid,
      blacklisted,
      timestamp: Date.now(),
    }),
  );
};

/** 更新当前账号资料 */
export const updateCurrentUserProfile = async (profile: UserProfileUpdate): Promise<void> => {
  ensureOk(await neteaseApi.user_update({ ...profile, timestamp: Date.now() }));
};
