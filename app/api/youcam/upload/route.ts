// 브라우저에서 줄인 셀피(JPEG)를 받아 YouCam File API 로 올리고 file_id 를 돌려준다
import { YouCamError } from "@/lib/youcam/client";
import { liveClient } from "@/lib/youcam/service";

export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request body limit

export async function POST(req: Request) {
  const client = liveClient();
  if (!client) return Response.json({ error: "Live scanning is off in this deployment. Pick a demo persona." }, { status: 503 });
  const type = req.headers.get("content-type") ?? "";
  if (type !== "image/jpeg" && type !== "image/png") {
    return Response.json({ error: "Send the image as image/jpeg or image/png." }, { status: 415 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "Image must be between 1 byte and 4 MB after resizing." }, { status: 413 });
  }
  try {
    const fileId = await client.uploadImage(bytes, type, type === "image/png" ? "selfie.png" : "selfie.jpg");
    return Response.json({ fileId });
  } catch (err) {
    const status = err instanceof YouCamError ? err.status : 500;
    return Response.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: status >= 400 ? status : 502 });
  }
}
