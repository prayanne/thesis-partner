"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import {
  Library,
  BookOpen,
  GraduationCap,
  Settings2,
  ArrowRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  LockKeyhole,
} from "lucide-react";
import { api, send, errorText } from "../lib/api";
import { ErrorState, Loading } from "./ui";

export function Workspace({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [session, setSession] = useState<boolean | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  function check() {
    setError(null);
    api<{ authenticated: boolean }>("/session")
      .then((v) => setSession(v.authenticated))
      .catch((e) => {
        if (e.status === 401) setSession(false);
        else setError(e);
      });
  }
  useEffect(() => {
    check();
    const expired = () => setSession(false);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  if (error)
    return (
      <main className="login-shell">
        <ErrorState error={error} retry={check} />
      </main>
    );
  if (session === null)
    return (
      <main className="login-shell">
        <Loading label="로컬 작업 공간을 확인하고 있어요" />
      </main>
    );
  if (!session) return <Login onSuccess={() => setSession(true)} />;
  const links = [
    { href: "/", label: "라이브러리", icon: Library },
    { href: "/wiki", label: "개념 위키", icon: BookOpen },
    { href: "/curriculum", label: "학습 커리큘럼", icon: GraduationCap },
  ];
  return (
    <div className={`workspace ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            t<span>p</span>
          </span>
          <span className="brand-name">
            thesis partner<small>나의 연구 작업 공간</small>
          </span>
        </Link>
        <button
          className="collapse-button icon-button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              title={label}
              className={
                path === href || (href === "/" && path.startsWith("/papers"))
                  ? "nav-link active"
                  : "nav-link"
              }
              href={href}
              key={href}
            >
              <Icon size={19} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="small-dot" />
          LOCAL WORKSPACE
          <p>
            읽은 논문이
            <br />
            나의 지식이 되는 곳.
          </p>
          <div className="orbital-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </div>
        </div>
        <div className="sidebar-bottom">
          <Link
            href="/settings"
            className={`nav-link ${path === "/settings" ? "active" : ""}`}
          >
            <Settings2 size={19} />
            <span>환경 설정</span>
          </Link>
          <button
            className="nav-link"
            onClick={async () => {
              try {
                await send("/session", "DELETE");
                setSession(false);
              } catch (e) {
                setError(e as Error);
              }
            }}
          >
            <LogOut size={18} />
            <span>잠그기</span>
          </button>
          <div className="profile">
            <span className="avatar">나</span>
            <div>
              개인 연구 공간<small>로컬에 연결됨</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <div className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            {path === "/"
              ? "Library"
              : path.startsWith("/papers")
                ? "Reader"
                : path === "/wiki"
                  ? "Wiki"
                  : path === "/curriculum"
                    ? "Curriculum"
                    : "Configuration"}
          </span>
          <span className="local-badge">
            <span className="small-dot" />
            Local
          </span>
        </div>
        <main id="main-content">{children}</main>
      </div>
    </div>
  );
}
function Login({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const value = token;
    setToken("");
    try {
      await send("/session", "POST", { token: value });
      onSuccess();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="login-story">
        <span className="brand-mark">
          t<span>p</span>
        </span>
        <span className="eyebrow">THESIS PARTNER</span>
        <h1>
          천천히 읽고,
          <br />
          깊이 연결하세요.
        </h1>
        <p>
          논문에서 시작해 개념과 실습으로 이어지는
          <br />
          당신만의 조용한 연구 작업 공간.
        </p>
        <div className="login-lines" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <LockKeyhole size={25} />
        <h2>내 작업 공간 열기</h2>
        <p>로컬 초기 설정에서 발급한 접속 토큰을 입력하세요.</p>
        <label>
          접속 토큰
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            required
            placeholder="로컬 접속 토큰"
          />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !token}>
          {busy ? "연결 중…" : "작업 공간 열기"}
          <ArrowRight size={17} />
        </button>
        <p className="form-hint">
          처음 사용한다면 터미널에서 <code>npm run setup:local</code>을 실행하고
          안내된 접속 토큰을 사용하세요. 토큰은 화면에 다시 표시하지 않습니다.
        </p>
      </form>
    </main>
  );
}
