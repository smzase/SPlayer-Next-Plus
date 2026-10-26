/** 注册业务模块，供公共请求入口按名称路由 */

import type { NeteaseModule } from "../core/types";

import follow from "./follow";
import user_follow_mixed from "./user_follow_mixed";
import user_mutualfollow_get from "./user_mutualfollow_get";
import user_update from "./user_update";
import user_blacklist_update from "./user_blacklist_update";

// 登录 / 会话
import captcha_sent from "./captcha_sent";
import captcha_verify from "./captcha_verify";
import login from "./login";
import login_cellphone from "./login_cellphone";
import login_qr_check from "./login_qr_check";
import login_qr_create from "./login_qr_create";
import login_qr_key from "./login_qr_key";
import login_refresh from "./login_refresh";
import login_status from "./login_status";
import logout from "./logout";
import register_anonimous from "./register_anonimous";
import sso_login_token from "./sso_login_token";

// 用户
import cloud_match from "./cloud_match";
import user_account from "./user_account";
import user_cloud from "./user_cloud";
import user_cloud_del from "./user_cloud_del";
import cloud_upload_check from "./cloud_upload_check";
import cloud_nos_token from "./cloud_nos_token";
import cloud_upload_info from "./cloud_upload_info";
import cloud_pub from "./cloud_pub";
import cloud_upload_check_v2 from "./cloud_upload_check_v2";
import cloud_song_import from "./cloud_song_import";
import user_detail from "./user_detail";
import user_detail_new from "./user_detail_new";
import user_followeds from "./user_followeds";
import user_follows from "./user_follows";
import user_level from "./user_level";
import user_playlist from "./user_playlist";
import user_record from "./user_record";
import record_recent_song from "./record_recent_song";
import user_subcount from "./user_subcount";
import user_audio from "./user_audio";
import listen_data_realtime_report from "./listen_data_realtime_report";
import listen_data_report from "./listen_data_report";
import listen_data_song_play_rank from "./listen_data_song_play_rank";

// 消息
import pl_count from "./pl_count";
import msg_private from "./msg_private";
import msg_private_history from "./msg_private_history";
import msg_private_revoke from "./msg_private_revoke";
import msg_comments from "./msg_comments";
import msg_forwards from "./msg_forwards";
import msg_notices from "./msg_notices";
import send_text from "./send_text";
import send_image from "./send_image";

// 关注动态
import event_feed from "./event_feed";
import event_user_history from "./event_user_history";
import event_detail from "./event_detail";
import event_like from "./event_like";
import event_forward from "./event_forward";
import event_delete from "./event_delete";
import event_comments from "./event_comments";
import event_comment_add from "./event_comment_add";
import event_comment_delete from "./event_comment_delete";
import event_publish from "./event_publish";
import event_upload_image from "./event_upload_image";
import deviceinfo_center_upload from "./deviceinfo_center_upload";

import cloudsearch from "./cloudsearch";
import search from "./search";
import search_default from "./search_default";
import search_hot from "./search_hot";
import search_hot_detail from "./search_hot_detail";
import search_match from "./search_match";
import search_multimatch from "./search_multimatch";
import search_suggest from "./search_suggest";
import search_suggest_pc from "./search_suggest_pc";
import event_search from "./event_search";
import audio_match from "./audio_match";

import lyric from "./lyric";
import lyric_new from "./lyric_new";
import cloud_lyric_get from "./cloud_lyric_get";

import comment_music from "./comment_music";
import comment_hot from "./comment_hot";
import comment_add from "./comment_add";
import comment_reply from "./comment_reply";
import comment_delete from "./comment_delete";
import comment_like from "./comment_like";

import song_detail from "./song_detail";
import song_url from "./song_url";
import song_download_url from "./song_download_url";
import playmode_intelligence from "./playmode_intelligence";
import personal_fm from "./personal_fm";
import fm_trash from "./fm_trash";
import scrobble from "./scrobble";
import scrobble_v1 from "./scrobble_v1";
import recent_play from "./recent_play";
import recent_play_remove from "./recent_play_remove";

import recommend_songs from "./recommend_songs";
import personalized from "./personalized";
import recommend_resource from "./recommend_resource";
import top_artists from "./top_artists";
import album_new from "./album_new";

import playlist_detail from "./playlist_detail";
import playlist_create from "./playlist_create";
import playlist_delete from "./playlist_delete";
import playlist_tracks from "./playlist_tracks";
import playlist_subscribe from "./playlist_subscribe";
import playlist_name_update from "./playlist_name_update";
import playlist_desc_update from "./playlist_desc_update";
import playlist_order_update from "./playlist_order_update";
import likelist from "./likelist";
import like from "./like";
import like_v1 from "./like_v1";
import song_like from "./song_like";

import album from "./album";
import album_sub from "./album_sub";

import artists from "./artists";
import artist_album from "./artist_album";
import artist_songs from "./artist_songs";

import album_sublist from "./album_sublist";
import artist_sub from "./artist_sub";
import artist_sublist from "./artist_sublist";
import dj_detail from "./dj_detail";
import dj_program from "./dj_program";
import dj_program_search from "./dj_program_search";
import dj_sub from "./dj_sub";
import dj_sublist from "./dj_sublist";

export const modules: Record<string, NeteaseModule> = {
  captcha_sent,
  captcha_verify,
  login,
  login_cellphone,
  login_qr_check,
  login_qr_create,
  login_qr_key,
  login_refresh,
  login_status,
  logout,
  register_anonimous,
  sso_login_token,

  user_account,
  user_cloud,
  user_cloud_del,
  cloud_match,
  cloud_upload_check,
  cloud_nos_token,
  cloud_upload_info,
  cloud_pub,
  cloud_upload_check_v2,
  cloud_song_import,
  user_detail,
  user_detail_new,
  follow,
  user_follow_mixed,
  user_followeds,
  user_follows,
  user_level,
  user_mutualfollow_get,
  user_playlist,
  user_record,
  record_recent_song,
  user_subcount,
  user_update,
  user_blacklist_update,
  user_audio,
  listen_data_realtime_report,
  listen_data_report,
  listen_data_song_play_rank,

  pl_count,
  msg_private,
  msg_private_history,
  msg_private_revoke,
  msg_comments,
  msg_forwards,
  msg_notices,
  send_text,
  send_image,

  event_feed,
  event_user_history,
  event_detail,
  event_like,
  event_forward,
  event_delete,
  event_comments,
  event_comment_add,
  event_comment_delete,
  event_publish,
  event_upload_image,
  deviceinfo_center_upload,

  cloudsearch,
  search,
  search_default,
  search_hot,
  search_hot_detail,
  search_match,
  search_multimatch,
  search_suggest,
  search_suggest_pc,
  event_search,
  audio_match,

  lyric,
  lyric_new,
  cloud_lyric_get,

  comment_music,
  comment_hot,
  comment_add,
  comment_reply,
  comment_delete,
  comment_like,

  song_detail,
  song_url,
  song_download_url,
  playmode_intelligence,
  personal_fm,
  fm_trash,
  scrobble,
  scrobble_v1,
  recent_play,
  recent_play_remove,

  recommend_songs,
  personalized,
  recommend_resource,
  top_artists,
  album_new,

  playlist_detail,
  playlist_create,
  playlist_delete,
  playlist_tracks,
  playlist_subscribe,
  playlist_name_update,
  playlist_desc_update,
  playlist_order_update,
  likelist,
  like,
  like_v1,
  song_like,

  album,
  album_sub,

  artists,
  artist_album,
  artist_songs,

  album_sublist,
  artist_sub,
  artist_sublist,
  dj_detail,
  dj_program,
  dj_program_search,
  dj_sub,
  dj_sublist,
};
