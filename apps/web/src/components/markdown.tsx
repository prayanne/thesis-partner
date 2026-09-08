"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
            >
              {children}
              {href?.startsWith("http") ? " ↗" : ""}
            </a>
          ),
          img: ({ src, alt }) => (
            <span className="form-hint">
              이미지 자동 로딩 차단: {alt || "외부 이미지"}
              {typeof src === "string" && /^https?:\/\//.test(src) && (
                <>
                  {" "}
                  ·{" "}
                  <a href={src} target="_blank" rel="noopener noreferrer">
                    직접 열기 ↗
                  </a>
                </>
              )}
            </span>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
