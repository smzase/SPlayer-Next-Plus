/**
 * 上传笔记图片并生成动态图片信息
 */

import { fetchWithProxy } from "@main/utils/proxy";
import { cookieObjToString, cookieToJson } from "../core/cookie";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";
import type { RequestResponse } from "../core/response";

const IMAGE_BUCKET = "yyimgs";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const eventUploadImage: NeteaseModule = async (query, request) => {
  const bytes = query.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("图片数据无效");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 10 MB");

  const mimeType = String(query.mime_type || "");
  const extensionByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extensionByMime[mimeType];
  if (!ext) throw new Error("仅支持 JPEG、PNG、WebP 或 GIF 图片");

  const tokenResponse = await request(
    "/api/nos/token/alloc",
    {
      bucket: IMAGE_BUCKET,
      ext,
      filename: String(query.name || `event.${ext}`),
      local: false,
      nos_product: 0,
      return_body: '{"code":200,"size":"$(ObjectSize)"}',
      type: "other",
    },
    createOption(query, "weapi"),
  );
  const result = tokenResponse.body.result as
    { docId?: unknown; objectKey?: unknown; token?: unknown } | undefined;
  const objectKey = String(result?.objectKey || "");
  const token = String(result?.token || "");
  const imageId = String(result?.docId || "");
  if (!objectKey || !token || !imageId) throw new Error("获取图片上传凭证失败");

  const uploadResponse = await fetchWithProxy(
    `https://nosup-hz1.127.net/${IMAGE_BUCKET}/${objectKey}?offset=0&complete=true&version=1.0`,
    {
      method: "POST",
      headers: {
        "x-nos-token": token,
        "Content-Type": mimeType,
      },
      body: Uint8Array.from(bytes).buffer,
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!uploadResponse.ok) throw new Error(`图片上传失败（${uploadResponse.status}）`);

  const cookie = typeof query.cookie === "string" ? cookieToJson(query.cookie) : query.cookie || {};
  const compoundResponse = await fetchWithProxy(
    `https://music.163.com/upload/event/img/v1?imgid=${encodeURIComponent(imageId)}&format=${ext}`,
    {
      method: "POST",
      headers: {
        Cookie: cookieObjToString(cookie),
        Referer: "https://music.163.com/",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await compoundResponse.json()) as Record<string, unknown>;
  const response: RequestResponse = {
    status: Number(body.code || compoundResponse.status),
    body,
    cookie: [],
  };
  if (response.status !== 200) {
    throw new Error(String(body.message || body.msg || "生成动态图片信息失败"));
  }
  return response;
};

export default eventUploadImage;
