"use client";
import { ErrorState } from "../components/ui";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page">
      <ErrorState
        error={
          new Error(
            "화면을 표시하지 못했습니다. 서버 상태와 응답 형식을 확인한 뒤 다시 불러오세요.",
          )
        }
        retry={reset}
      />
    </div>
  );
}
