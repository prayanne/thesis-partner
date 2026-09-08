import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>페이지를 찾을 수 없어요</h1>
      <p>주소가 변경되었거나 더 이상 사용할 수 없는 페이지입니다.</p>
      <Link className="button primary" href="/">
        라이브러리로 돌아가기
      </Link>
    </div>
  );
}
