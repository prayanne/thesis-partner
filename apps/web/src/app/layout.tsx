import type { Metadata } from "next";
import { Workspace } from "../components/workspace";
import "./globals.css";
export const metadata: Metadata = {
  title: "Thesis Partner · 나의 연구 작업 공간",
  description:
    "논문 읽기, 개념 위키, 실습과 회고를 연결하는 로컬 연구 작업 공간",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문으로 건너뛰기
        </a>
        <Workspace>{children}</Workspace>
      </body>
    </html>
  );
}
