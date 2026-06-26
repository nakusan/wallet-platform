import { logger } from '../infrastructure/logger/logger.js';

/** 默认 IPFS 网关，用于将 ipfs:// 转为 HTTP 可访问地址。 */
const IPFS_GATEWAY = 'https://ipfs.io/ipfs';
/** 默认 Arweave 网关，用于将 ar:// 转为 HTTP 可访问地址。 */
const ARWEAVE_GATEWAY = 'https://arweave.net';
/** 拉取链下 metadata JSON 的超时时间。 */
const FETCH_TIMEOUT_MS = 15_000;

export type ParsedNftMetadata = {
  metadataUri: string;
  name: string | null;
  imageUrl: string | null;
};

/**
 * 将链上 tokenURI / uri 解析为可 GET 的 HTTP URL，或保留 data: / 内联 JSON。
 * ERC1155 常见 `{id}` 占位符会替换为 64 位 hex tokenId。
 */
export function resolveMetadataUri(rawUri: string, tokenId: string): string {
  let uri = rawUri.trim();
  if (!uri) throw new Error('empty metadata URI');

  if (uri.includes('{id}')) {
    const hexId = BigInt(tokenId).toString(16).padStart(64, '0');
    uri = uri.replace(/\{id\}/gi, hexId);
  }

  // 内联 JSON，无需网关转换
  if (uri.startsWith('data:') || uri.startsWith('{')) return uri;

  if (uri.startsWith('ipfs://ipfs/')) {
    return `${IPFS_GATEWAY}/${uri.slice('ipfs://ipfs/'.length)}`;
  }
  if (uri.startsWith('ipfs://')) {
    return `${IPFS_GATEWAY}/${uri.slice('ipfs://'.length)}`;
  }

  if (uri.startsWith('ar://')) {
    return `${ARWEAVE_GATEWAY}/${uri.slice('ar://'.length)}`;
  }

  // 部分合约直接返回 CID 而非 ipfs:// 前缀
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44,}/.test(uri) || /^bafy/i.test(uri)) {
    return `${IPFS_GATEWAY}/${uri}`;
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  throw new Error(`unsupported metadata URI scheme: ${uri.slice(0, 32)}`);
}

/** 解析 data:application/json 或裸 JSON 字符串。 */
function parseInlineJson(uri: string): Record<string, unknown> | null {
  if (uri.startsWith('data:application/json;base64,')) {
    const payload = uri.slice('data:application/json;base64,'.length);
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as Record<string, unknown>;
  }
  if (uri.startsWith('data:application/json,')) {
    const payload = uri.slice('data:application/json,'.length);
    return JSON.parse(decodeURIComponent(payload)) as Record<string, unknown>;
  }
  if (uri.startsWith('{')) {
    return JSON.parse(uri) as Record<string, unknown>;
  }
  return null;
}

function pickString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

/** 从 metadata JSON 提取 name 与 image / image_url；image 字段同样走 URI 解析。 */
export function extractMetadataFields(
  json: Record<string, unknown>,
  tokenId: string,
): { name: string | null; imageUrl: string | null } {
  const name = pickString(json.name);
  const imageRaw = json.image ?? json.image_url;
  let imageUrl: string | null = null;

  if (typeof imageRaw === 'string' && imageRaw.trim()) {
    try {
      imageUrl = resolveMetadataUri(imageRaw, tokenId);
    } catch {
      // 无法解析 scheme 时保留原始字符串（可能是相对路径或特殊格式）
      imageUrl = imageRaw.trim();
    }
  }

  return { name, imageUrl };
}

/**
 * 拉取并解析 metadata 内容。
 * 优先尝试内联 JSON；否则 HTTP GET 远程 JSON；非 JSON 响应则视为直接图片 URL。
 */
export async function fetchMetadataFromUri(
  rawUri: string,
  tokenId: string,
): Promise<ParsedNftMetadata> {
  const resolved = resolveMetadataUri(rawUri, tokenId);
  const inline = parseInlineJson(resolved);
  if (inline) {
    logger.debug(
      { flow: 'metadata', tokenId, source: 'inline' },
      'metadata 为内联 JSON，跳过 HTTP 拉取',
    );
    return {
      metadataUri: rawUri,
      ...extractMetadataFields(inline, tokenId),
    };
  }

  if (!resolved.startsWith('http://') && !resolved.startsWith('https://')) {
    throw new Error(`cannot fetch metadata URI: ${rawUri.slice(0, 48)}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    logger.debug(
      { flow: 'metadata', tokenId, url: resolved.slice(0, 120) },
      '开始 HTTP 拉取 metadata',
    );
    const res = await fetch(resolved, { signal: controller.signal });
    if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const trimmed = text.trim();

    if (contentType.includes('json') || trimmed.startsWith('{')) {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const fields = extractMetadataFields(json, tokenId);
      logger.debug(
        { flow: 'metadata', tokenId, hasName: !!fields.name, hasImage: !!fields.imageUrl },
        'metadata JSON 解析完成',
      );
      return { metadataUri: rawUri, ...fields };
    }

    // 响应非 JSON 时，URL 本身即为图片资源
    logger.debug(
      { flow: 'metadata', tokenId, contentType },
      'metadata 响应非 JSON，按直接图片 URL 处理',
    );
    return { metadataUri: rawUri, name: null, imageUrl: resolved };
  } catch (err) {
    logger.debug(
      {
        flow: 'metadata',
        tokenId,
        url: resolved.slice(0, 120),
        err: err instanceof Error ? err.message : String(err),
      },
      'metadata HTTP 拉取失败',
    );
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
