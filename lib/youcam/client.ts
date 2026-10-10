// YouCam REST API 타입 클라이언트: 파일 업로드(presigned PUT)·태스크 생성·폴링·429 백오프·유닛 잔액 조회
import {
  TASK_PATH,
  type FileUploadTicket,
  type TaskKind,
  type TaskState,
  type TaskStatus,
} from "./types";

export const DEFAULT_BASE_URL = "https://yce-api-01.makeupar.com";

export class YouCamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "YouCamError";
  }
}

export interface YouCamClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Retries for 429 and 5xx on API calls (not on the presigned upload). */
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class YouCamClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly opts: YouCamClientOptions) {
    if (!opts.apiKey) throw new Error("YouCamClient needs an API key");
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      let json: any = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* non-JSON error page */
      }
      if (!res.ok) {
        throw new YouCamError(
          json?.error || json?.error_code || `YouCam ${method} ${path} failed with ${res.status}`,
          res.status,
          json?.error_code,
        );
      }
      return json as T;
    }
  }

  /** Step 1+2 of the File API: register the file, then PUT the bytes to the presigned URL. */
  async uploadImage(bytes: Uint8Array, contentType: "image/jpeg" | "image/png", fileName: string): Promise<string> {
    if (bytes.byteLength >= 10 * 1024 * 1024) {
      throw new YouCamError("Image must be under 10 MB", 400, "exceed_max_filesize");
    }
    const res = await this.request<{ data: { files: FileUploadTicket[] } }>("POST", "/s2s/v2.0/file", {
      files: [{ content_type: contentType, file_name: fileName, file_size: bytes.byteLength }],
    });
    const ticket = res?.data?.files?.[0];
    const put = ticket?.requests?.[0];
    if (!ticket?.file_id || !put?.url) throw new YouCamError("File API returned no upload URL", 502);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(put.headers ?? {})) headers[k] = String(v);
    const up = await this.fetchImpl(put.url, {
      method: put.method || "PUT",
      headers,
      body: bytes as unknown as BodyInit,
    });
    if (!up.ok) throw new YouCamError(`Upload to presigned URL failed with ${up.status}`, up.status);
    return ticket.file_id;
  }

  async createTask(kind: TaskKind, body: object): Promise<string> {
    const res = await this.request<{ data: { task_id: string } }>("POST", TASK_PATH[kind], body);
    const id = res?.data?.task_id;
    if (!id) throw new YouCamError(`No task_id for ${kind}`, 502);
    return id;
  }

  async getTask<R = unknown>(kind: TaskKind, taskId: string): Promise<TaskState<R>> {
    const res = await this.request<{
      data: { task_status: TaskStatus; results?: R; error?: string; error_message?: string };
    }>("GET", `${TASK_PATH[kind]}/${encodeURIComponent(taskId)}`);
    const d = res?.data;
    if (!d?.task_status) throw new YouCamError(`Malformed task status for ${kind}`, 502);
    return { status: d.task_status, results: d.results, error: d.error, errorMessage: d.error_message };
  }

  /** Polls until success/error. Docs recommend unhurried polling; tasks must be polled to not time out. */
  async waitForTask<R = unknown>(
    kind: TaskKind,
    taskId: string,
    { intervalMs = 2000, timeoutMs = 120_000 }: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<TaskState<R>> {
    const started = Date.now();
    for (;;) {
      const state = await this.getTask<R>(kind, taskId);
      if (state.status !== "running") return state;
      if (Date.now() - started > timeoutMs) throw new YouCamError(`${kind} task timed out`, 504, "timeout");
      await this.sleep(intervalMs);
    }
  }

  /** Available units summed over all unit buckets (GET /s2s/v1.0/client/credit, `results[].amount_dec`). */
  async getUnits(): Promise<number> {
    const res = await this.request<{ results?: { amount_dec?: number; amount?: number }[] }>(
      "GET",
      "/s2s/v1.0/client/credit",
    );
    if (!Array.isArray(res?.results)) throw new YouCamError("Could not read unit balance", 502);
    return res.results.reduce((sum, r) => sum + Number(r.amount_dec ?? r.amount ?? 0), 0);
  }
}
