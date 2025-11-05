// HLS Proxy on Netlify Edge Functions
// يعالج ملفات M3U8 ويعيد كتابة روابط TS لتعمل عبر /proxy_ts

const REFERER = "https://iframe.mediadelivery.net/";
const BASE_ORIGIN = "https://iframe.mediadelivery.net";
const ORIGIN_CDN = "https://vz-99e5c202-ca5.b-cdn.net";

export default async (request: Request, context: any) => {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/proxy_ts") {
      return await handleTsProxy(url);
    } else {
      return await handleM3u8Request(url);
    }
  } catch (err: any) {
    // تم التعديل: استخدام concatenation بدلاً من template literal مع الأحرف العربية لتجنب خطأ التجميع
    return new Response("خطأ في المعالجة: " + err.message, { 
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }
};

/**
 * استخراج UUID من رابط الفيديو الكامل
 */
function extractVideoId(fullUrl: string): string | null {
  const uuidRegex = /(?:vz-99e5c202-ca5\.b-cdn\.net\/|\/)([a-f0-9-]{36})(?:\/|$)/i;
  const match = fullUrl.match(uuidRegex);
  return match ? match[1] : null;
}

/**
 * معالجة طلب ملف M3U8
 */
async function handleM3u8Request(url: URL): Promise<Response> {
  const fullVideoUrl = url.searchParams.get("videoUrl");
  if (!fullVideoUrl) {
    return new Response("يجب تمرير videoUrl بالرابط.", {
      status: 400,
      headers: { "Content-Type": "text/plain;charset=UTF-8", "Access-Control-Allow-Origin": "*" },
    });
  }

  const videoId = extractVideoId(fullVideoUrl);
  if (!videoId) {
    return new Response("كود الفيديو غير صالح.", {
      status: 400,
      headers: { "Content-Type": "text/plain;charset=UTF-8", "Access-Control-Allow-Origin": "*" },
    });
  }

  // نحاول أولاً الرابط الأساسي
  const primary = await fetchM3u8(fullVideoUrl, videoId, url.origin);
  if (primary) return primary;

  // لو فشل نحاول جودات أخرى
  const qualities = ["1080p", "720p", "480p", "360p"];
  for (const q of qualities) {
    const fallback = `${ORIGIN_CDN}/${videoId}/${q}/video.m3u8`;
    const res = await fetchM3u8(fallback, videoId, url.origin);
    if (res) return res;
  }

  return new Response("لم يتم العثور على الفيديو.", {
    status: 404,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

/**
 * جلب ملف M3U8 ومعالجة روابطه
 */
async function fetchM3u8(m3u8Url: string, videoId: string, origin: string): Promise<Response | null> {
  try {
    const res = await fetch(m3u8Url, {
      headers: {
        Referer: REFERER,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36",
      },
    });

    if (!res.ok) return null;
    let content = await res.text();

    const qualityMatch = m3u8Url.match(/\/[a-f0-9-]{36}\/([^/]+)\/video\.m3u8/i);
    const qualityPath = qualityMatch ? qualityMatch[1] : "";

    // إعادة كتابة روابط TS
    content = content.replace(/^(.+\.ts)$/gm, (m) => {
      const tsPath = `${qualityPath}/${m}`;
      return `${origin}/proxy_ts?videoId=${videoId}&ts=${encodeURIComponent(tsPath)}`;
    });

    // إعادة كتابة روابط M3U8 الداخلية (للجودات الأخرى)
    content = content.replace(/^(.+\.m3u8)$/gm, (m) => {
      const full = m3u8Url.substring(0, m3u8Url.lastIndexOf("/")) + "/" + m;
      return `${origin}/?videoUrl=${encodeURIComponent(full)}`;
    });

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return null;
  }
}

/**
 * تمرير مقاطع TS
 */
async function handleTsProxy(url: URL): Promise<Response> {
  const videoId = url.searchParams.get("videoId");
  const tsFile = url.searchParams.get("ts");

  if (!videoId || !tsFile) {
    return new Response("طلب غير صالح لـ TS", { status: 400 });
  }

  const tsPath = decodeURIComponent(tsFile);
  const tsUrl = `${ORIGIN_CDN}/${videoId}/${tsPath}`;

  try {
    const res = await fetch(tsUrl, {
      headers: {
        Referer: REFERER,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114 Safari/537.36",
      },
    });

    if (!res.ok) {
      return new Response("مقطع TS غير موجود.", { status: res.status });
    }

    // تمرير الاستجابة كما هي
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(res.body, { status: res.status, headers });
  } catch (err: any) {
    // تم التعديل: استخدام concatenation بدلاً من template literal مع الأحرف العربية لتجنب خطأ التجميع
    return new Response("خطأ في جلب TS: " + err.message, { status: 500 });
  }
}
