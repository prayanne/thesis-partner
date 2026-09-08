"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function apiEnvelope<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      body?.error?.code ?? body?.code ?? "REQUEST_FAILED",
      body?.error?.message ??
        body?.detail ??
        "요청을 완료하지 못했습니다. 연결 상태를 확인해 주세요.",
      response.status,
    );
  }
  if (!body || !("data" in body))
    throw new ApiError(
      "INVALID_RESPONSE",
      "서버 응답 형식을 확인할 수 없습니다.",
      response.status,
    );
  return body;
}
export async function api<T>(path: string, init: RequestInit = {}) {
  return (await apiEnvelope<T>(path, init)).data;
}
export const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, version]);
  return { data, error, loading, reload, setData };
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
export function listOf<T>(value: T[] | { items: T[] } | null): T[] {
  return Array.isArray(value) ? value : (value?.items ?? []);
}
export const dateLabel = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
