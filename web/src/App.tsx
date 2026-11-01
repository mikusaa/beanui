import { useCallback, useEffect, useRef, useState } from "react";
import { Accounts } from "./Accounts";
import { fetchStatus } from "./api";
import { DesktopBalance } from "./DesktopBalance";
import { DesktopIncome } from "./DesktopIncome";
import { DesktopJournal } from "./DesktopJournal";
import { DesktopOverview } from "./DesktopOverview";
import { Income } from "./Income";
import { Journal } from "./Journal";
import { useWide } from "./layout";
import { Overview } from "./Overview";
import { useLocation } from "./router";
import { Sidebar } from "./Sidebar";
import type { Tab } from "./TabBar";
import { Txn } from "./Txn";

// 流水原来在 /，旧链接带着筛选的转到 /journal
if (location.pathname === "/" && /[?&](q|account|category|tag|payee)=/.test(location.search)) {
  history.replaceState(history.state, "", "/journal" + location.search);
}

export function App() {
  const loc = useLocation();
  // 同一个地址，宽屏是侧栏加主区，窄屏是手机布局；断点见 layout.ts
  const wide = useWide();
  const [path, search = ""] = loc.split(/(?=\?)/);
  const txnId = path.startsWith("/txn/") ? decodeURIComponent(path.slice(5)) : null;
  // 窄屏的交易详情盖在打开它的那一屏上面；宽屏是流水右边的详情栏，从哪点进来都显示成流水
  const pane = wide && txnId != null;
  const base = useRef<Tab>("home");
  if (path === "/journal" || pane) base.current = "journal";
  else if (path === "/accounts") base.current = "accounts";
  else if (path === "/income") base.current = "income";
  else if (!txnId) base.current = "home";
  // 流水、账户和收支表第一次打开时才挂上，免得首页多查一次
  const seen = useRef(new Set<Tab>());
  seen.current.add(base.current);
  const [toast, setToast] = useState<string | null>(null);
  const [currency, setCurrency] = useState("CNY");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    fetchStatus()
      .then((s) => {
        setCurrency(s.currency);
        if (s.title) document.title = s.title;
      })
      .catch(() => {});
  }, []);

  const screen = (tab: Tab) => {
    const active = base.current === tab && (!txnId || pane);
    return {
      shown: base.current === tab,
      active,
      // 详情栏的地址 /txn/<id> 后面可以跟着流水的筛选；没跟时流水保持原来的筛选（如从概览的最近交易点进来）
      search: active && (!pane || search) ? search : null,
      onToast: showToast,
    };
  };

  // 有电脑版的屏宽屏时换成电脑版：概览、流水、资产负债表（手机上是账户页）、收支表
  const Home = wide ? DesktopOverview : Overview;
  const Balance = wide ? DesktopBalance : Accounts;
  const IncomeScreen = wide ? DesktopIncome : Income;

  const content = (
    <div className="app">
      {/* 各屏打开后一直挂着，切标签、进出详情页不丢滚动位置和筛选 */}
      <Home {...screen("home")} />
      {seen.current.has("journal") && (wide ? <DesktopJournal {...screen("journal")} selected={pane ? txnId : null} currency={currency} /> : <Journal {...screen("journal")} />)}
      {seen.current.has("accounts") && <Balance {...screen("accounts")} />}
      {seen.current.has("income") && <IncomeScreen {...screen("income")} />}
      {txnId && !pane && <Txn id={txnId} currency={currency} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );

  if (!wide) return content;
  return (
    <div className="desk">
      <Sidebar current={base.current} onToast={showToast} />
      {content}
    </div>
  );
}
