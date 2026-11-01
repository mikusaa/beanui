import type { ReactNode } from "react";
import { incomeUrl } from "./Income";
import { journalUrl } from "./journalState";
import { overviewUrl } from "./Overview";
import { navigate } from "./router";

export type Tab = "home" | "journal" | "accounts" | "income";

// 图标照画布 Phone-Home 的底部导航；「报表」进收支表（资产负债表在「账户」）
const TABS: { key: Tab | null; label: string; icon: ReactNode }[] = [
  { key: "home", label: "概览", icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  { key: "journal", label: "流水", icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /> },
  { key: "accounts", label: "账户", icon: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></> },
  { key: "income", label: "报表", icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /> },
  { key: null, label: "更多", icon: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></> },
];

// 两屏也引用这个文件，取地址要等到点击时；电脑侧栏也用它
const urls: Record<Tab, () => string> = { home: () => overviewUrl(), journal: () => journalUrl(), accounts: () => "/accounts", income: () => incomeUrl() };
export const tabUrl = (tab: Tab) => urls[tab]();

/** 点当前标签回到顶部；点别的标签切过去，保留那一屏上次的筛选。 */
export function TabBar({ current, onTop, onToast }: { current: Tab; onTop: () => void; onToast: (msg: string) => void }) {
  return (
    <nav className="tabbar" aria-label="底部导航">
      {TABS.map(({ key, label, icon }) => (
        <button
          type="button"
          key={label}
          className={"tab" + (key === current ? " is-on" : "")}
          aria-current={key === current ? "page" : undefined}
          onClick={() => (key === current ? onTop() : key ? navigate(urls[key]()) : onToast(`「${label}」还没做`))}
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
          {label}
        </button>
      ))}
    </nav>
  );
}
