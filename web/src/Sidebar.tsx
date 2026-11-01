import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchStatus, type Status } from "./api";
import { firstChar } from "./format";
import { queryToUrl, useLastJournalQuery } from "./journalState";
import { navigate } from "./router";
import { ago, startSync, SYNC_LABEL, syncDetail, syncTone, useDataVersion, useNow, useSyncing } from "./sync";
import { tabUrl, type Tab } from "./TabBar";

/** more：不常用的，收在「更多」里 */
type Item = { tab: Tab | null; label: string; icon: ReactNode; more?: boolean };

// 导航照画布 Main / Desktop-Journal / Desktop-Balance 的侧栏，三屏一样。
// 资产负债表和手机的账户页是同一个地址 /accounts，收支表是 /income（手机底栏的「报表」），宽屏显示电脑版；tab 为空的还没做。
// 和手机底栏一样只露常用的四项，其余收进「更多」，窗口矮时侧栏不至于挤
const SECTIONS: { title: string | null; items: Item[] }[] = [
  {
    title: null,
    items: [
      { tab: "home", label: "概览", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
      { tab: "journal", label: "流水", icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
    ],
  },
  {
    title: "报表",
    items: [
      { tab: "accounts", label: "资产负债表", icon: <path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z" /> },
      { tab: "income", label: "收支表", icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
      { tab: null, label: "试算平衡", icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>, more: true },
    ],
  },
  {
    title: "投资",
    items: [
      { tab: null, label: "持仓", icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />, more: true },
      { tab: null, label: "商品与价格", icon: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></>, more: true },
    ],
  },
  {
    title: "工具",
    items: [
      { tab: null, label: "查询", icon: <path d="M4 17l6-5-6-5M12 19h8" />, more: true },
      { tab: null, label: "源文件", icon: <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5" />, more: true },
      { tab: null, label: "文档", icon: <path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" />, more: true },
      { tab: null, label: "事件", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>, more: true },
    ],
  },
];

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

// 「更多」展开没有，记在这台设备上
const MORE_KEY = "beanui.side.more";

function readMore(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 侧栏底部：NAS 当前提交和最后拉取时间，规则同手机首页的同步徽标；没有同步状态文件时照实说。
 *  NAS 上（can_sync）下面多一个「同步」按钮。 */
function SyncCard({ status, onToast }: { status: Status; onToast: (msg: string) => void }) {
  const now = useNow();
  const syncing = useSyncing();
  const sync = status.sync;
  const tone = sync ? syncTone(sync, now) : "none";
  const errors = (
    <span className={status.errors ? "side-errors" : undefined}>
      {status.errors} 个错误
    </span>
  );
  const detail = sync ? syncDetail(sync) : "没有找到账本仓库的 .git/sync-status，这里没开自动同步，读的是本机文件";
  return (
    <div className="side-sync">
      <button type="button" className="side-sync-info" title={detail} onClick={() => onToast(detail)}>
        <span className="side-sync-head">
          <span className={`sync-dot side-dot-${tone}`} aria-hidden="true" />
          <span className="side-sync-label">{sync ? SYNC_LABEL[tone as keyof typeof SYNC_LABEL] : "没有同步状态"}</span>
          {sync?.commit && <span className="num mono side-commit">{sync.commit}</span>}
        </span>
        <span>
          {sync ? `${ago(sync.time, now)}${sync.state === "error" ? "拉取失败" : "拉取"}` : "读本机文件"} · {errors}
        </span>
        {sync?.state === "error" && sync.message && <span className="side-sync-msg">{sync.message}</span>}
      </button>
      {sync?.can_sync && (
        <button type="button" className="side-sync-btn" title="从 GitHub 拉取最新账本" disabled={syncing} onClick={() => startSync(onToast)}>
          <svg className={syncing ? "spin" : undefined} aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
          </svg>
          {syncing ? "同步中…" : "同步"}
        </button>
      )}
    </div>
  );
}

/** 电脑端侧栏。current 是主区正在显示（或交易详情盖着）的那一屏。 */
export function Sidebar({ current, onToast }: { current: Tab; onToast: (msg: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [q, setQ] = useState("");
  const [more, setMoreState] = useState(readMore);
  const setMore = (open: boolean) => {
    setMoreState(open);
    try {
      localStorage.setItem(MORE_KEY, open ? "1" : "0");
    } catch {
      /* 存不了就只在这次打开时有效 */
    }
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const version = useDataVersion();

  // 在流水页时搜索框显示流水正在搜的词，在流水里清掉了这边也跟着清
  const journalQ = useLastJournalQuery().q;
  useEffect(() => {
    if (current === "journal") setQ(journalQ);
  }, [current, journalQ]);

  // 每分钟取一次同步状态，切回这个窗口时、手动同步完也取
  useEffect(() => {
    let ctrl = new AbortController();
    const load = () => {
      if (document.hidden) return;
      ctrl.abort();
      ctrl = new AbortController();
      fetchStatus(ctrl.signal)
        .then(setStatus)
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    document.addEventListener("visibilitychange", load);
    return () => {
      ctrl.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  },[version]);

  // ⌘K / Ctrl+K 跳到搜索框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = status?.title || "账本";

  return (
    <nav className="side" aria-label="主导航">
      <div className="side-book">
        <span className="side-logo" aria-hidden="true">
          {firstChar(title)}
        </span>
        <span className="side-book-text">
          <span className="side-title">{status ? title : " "}</span>
          <span className="side-file">{status?.file ?? " "}</span>
        </span>
      </div>

      {/* 搜全部时间的流水，结果在流水页；手机首页的搜索按钮也是搜全部 */}
      <form
        className="side-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          navigate(queryToUrl({ q: q.trim(), time: "all" }));
          searchRef.current?.blur();
        }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input ref={searchRef} type="search" placeholder="搜索收付方、科目" aria-label="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
        <kbd>{MAC ? "⌘K" : "Ctrl K"}</kbd>
      </form>

      {SECTIONS.map((s, i) => {
        // 收起时只留常用的；正在看的那一屏总是留着
        const items = s.items.filter((x) => more || !x.more || (x.tab && x.tab === current));
        if (!items.length) return null;
        return (
          <div key={i} className="side-section">
            {s.title && <span className="side-section-title">{s.title}</span>}
            {items.map(({ tab, label, icon }) => (
              <a
                key={label}
                href={tab ? tabUrl(tab) : "#"}
                className={"side-item" + (tab && tab === current ? " is-on" : "")}
                aria-current={tab && tab === current ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (!tab) onToast(`「${label}」还没做`);
                  else if (location.pathname + location.search !== tabUrl(tab)) navigate(tabUrl(tab));
                }}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {icon}
                </svg>
                {label}
              </a>
            ))}
          </div>
        );
      })}

      <button type="button" className="side-item side-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {more ? <path d="m6 15 6-6 6 6" /> : <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
        </svg>
        {more ? "收起" : "更多"}
      </button>

      {status && <SyncCard status={status} onToast={onToast} />}
    </nav>
  );
}
