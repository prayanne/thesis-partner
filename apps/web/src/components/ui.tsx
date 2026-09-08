"use client";
import { AlertCircle, LoaderCircle, BookOpen, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { ApiError } from "../lib/api";
export function Loading({ label = "불러오는 중" }: { label?: string }) {
  return (
    <div className="state loading" role="status">
      <LoaderCircle size={21} className="spin" />
      {label}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <div className="state error" role="alert">
      <AlertCircle size={22} />
      <div>
        <strong>
          {error instanceof ApiError && error.code === "NOT_IMPLEMENTED"
            ? "아직 연결되지 않은 기능입니다"
            : "요청을 완료하지 못했어요"}
        </strong>
        <p>{error.message}</p>
        {error instanceof ApiError && error.status === 409 && (
          <p>
            다른 화면에서 변경되었습니다. 최신 내용을 불러온 뒤 다시 수정해
            주세요.
          </p>
        )}
        {retry && (
          <button className="button small" onClick={retry}>
            다시 불러오기
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <BookOpen size={30} strokeWidth={1.25} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={close}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{actions}</div>
    </header>
  );
}
