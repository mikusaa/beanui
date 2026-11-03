import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import { fetchTxn, type DirectiveDetail, type TxnDetail } from "./api";
import { directiveCopyText, directiveFacts, directiveView, TypeTile } from "./Directive";
import { money, shortDate, txnAmount, weekday } from "./format";
import { CategoryTile, Icon, categoryStyle } from "./icons";
import { Mark } from "./Mark";
import { NoteBlock } from "./Note";
import { TicketCard } from "./Ticket";
import { goBack, navigate } from "./router";
import { useDataVersion } from "./sync";

/** 给 AI 会话的修改请求：文件、行号和这笔交易（或这条指令）的要点。 */
export function copyText(t: TxnDetail | DirectiveDetail): string {
  if (t.type !== "txn") return directiveCopyText(t);
  const postings = t.postings.map((p) => `${p.name} ${p.amount == null ? "" : money(p.amount)}`.trim()).join("，");
  const head = [t.payee, t.narration].filter(Boolean).join(" · ");
  return `请修改 ${t.source.file} 第 ${t.source.line} 行这笔交易（${t.date} ${head} · ${postings}）：`;
}

async function copy(text: string): Promise<void> {
  // 局域网 http 下没有 navigator.clipboard，被拒绝时也退回到选中文本复制
  if (navigator.clipboard && window.isSecureContext) {
    try {
      return await navigator.clipboard.writeText(text);
    } catch {
      /* 继续用下面的办法 */
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("复制失败");
}

export function commitTime(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = d.getFullYear() === new Date().getFullYear() ? `${p(d.getMonth() + 1)}-${p(d.getDate())}` : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一笔交易（或流水里一条其他指令）的详情、复制给 AI 和查看源文件的状态；手机详情页和电脑端的右侧详情栏共用。换一笔时回到顶部。 */
export function useTxnDetail(id: string, scrollRef: RefObject<HTMLElement | null>) {
  const [txn, setTxn] = useState<TxnDetail | DirectiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  const [showSource, setShowSource] = useState(false);
  const version = useDataVersion();

  useEffect(() => {
    const ctrl = new AbortController();
    setTxn(null);
    setError(null);
    setCopied("no");
    setShowSource(false);
    scrollRef.current?.scrollTo({ top: 0 });
    fetchTxn(id, ctrl.signal)
      .then(setTxn)
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [id, scrollRef, version]);

  const onCopy = () => {
    if (!txn) return;
    copy(copyText(txn))
      .then(() => setCopied("yes"))
      .catch(() => setCopied("failed"));
  };

  return { txn, error, copied, onCopy, showSource, setShowSource };
}

export const COPY_LABEL = { yes: "已复制，去 AI 会话粘贴", failed: "没能复制，请手动选中下面的文字", no: "复制给 AI 修改" };

export function Txn({ id, currency }: { id: string; currency: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { txn: entry, error, copied, onCopy, showSource, setShowSource } = useTxnDetail(id, scrollRef);
  const txn = entry?.type === "txn" ? entry : null;
  const directive = entry && entry.type !== "txn" ? entry : null;

  const amt = txn && txnAmount(txn, currency);
  const cat = txn?.category;

  // 源文件、提交、复制给 AI 和查看源文件，交易和其他指令一样
  const sourceMeta = entry && (
    <>
      <dt>来源</dt>
      <dd className="mono small wrap">
        {entry.source.file}:{entry.source.line}
      </dd>
      <dt>提交</dt>
      <dd className="mono small">{entry.commit ? `${entry.commit.hash} · ${commitTime(entry.commit.time)}` : "未提交"}</dd>
    </>
  );
  const actions = entry && (
    <section className="actions">
      <button type="button" className="btn-primary" onClick={onCopy}>
        {COPY_LABEL[copied]}
      </button>
      {copied !== "no" && (
        <div className="copy-preview">
          {copyText(entry)}
          <span className="muted">在这里写要怎么改</span>
        </div>
      )}
      <button type="button" className="btn-secondary" onClick={() => setShowSource((s) => !s)} aria-expanded={showSource}>
        {showSource ? "收起源文件" : "查看源文件"}
      </button>
      {showSource && (
        <pre className="source mono">
          <span className="source-path">
            {entry.source.file}:{entry.source.line}
          </span>
          {entry.source.text}
        </pre>
      )}
    </section>
  );
  const view = directive && directiveView(directive, currency);

  return (
    <div className="screen txn-screen">
      <div className="txn-bar">
        <a
          href="/"
          className="back"
          onClick={(e) => {
            e.preventDefault();
            goBack();
          }}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          流水
        </a>
      </div>

      <div className="txn-body" ref={scrollRef}>
        {error && <div className="notice">{error}</div>}
        {!entry && !error && <div className="notice">加载中…</div>}
        {directive && view && (
          <>
            <section className="hero">
              <span className="hero-mark">
                <Mark brand={directive.brand} fallback={directive.name} size={56} radius={17} fontSize={22} />
                <TypeTile view={view} size={26} radius={13} iconSize={14} stroke={2.4} className="badge hero-badge" />
              </span>
              <span className="hero-payee">{view.title}</span>
              {view.amount && <span className={`num hero-amount tone-${view.tone}`}>{view.amount}</span>}
              <span className="pills">
                <span className="pill pill-cat" style={{ ["--c" as string]: view.color }}>
                  <Icon name={view.icon} size={12} stroke={2.4} />
                  {view.label}
                </span>
                <span className="pill num">
                  {directive.date} {weekday(directive.date)}
                </span>
              </span>
            </section>

            <section className="card meta">
              <dl>
                {directiveFacts(directive).map(([label, value, mono]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd className={mono ? "mono small wrap" : "wrap"}>{value}</dd>
                  </Fragment>
                ))}
                {sourceMeta}
              </dl>
            </section>

            {actions}
          </>
        )}
        {txn && amt && (
          <>
            {txn.ticket ? (
              <section className="hero-ticket">
                <TicketCard t={txn} ticket={txn.ticket} currency={currency} />
                {txn.note && <NoteBlock note={txn.note} />}
                <span className="pills">
                  <span className="pill pill-cat" style={{ ["--c" as string]: categoryStyle(cat?.account).color }}>
                    <Icon name={categoryStyle(cat?.account).icon} size={12} stroke={2.4} />
                    {cat?.name ?? "转账"}
                  </span>
                  <span className="pill num">
                    {shortDate(txn.date)} {txn.ticket.refund ? "退" : "购"}
                  </span>
                  {txn.tags.map((tag) => (
                    <span key={tag} className="pill pill-tag">
                      #{tag}
                    </span>
                  ))}
                </span>
              </section>
            ) : (
              <section className="hero">
                <span className="hero-mark">
                  <Mark brand={txn.brand} fallback={txn.payee || txn.narration} size={56} radius={17} fontSize={22} />
                  <CategoryTile account={cat?.account} size={26} radius={13} iconSize={14} stroke={2.4} className="badge hero-badge" />
                </span>
                <span className="hero-payee">{txn.payee || txn.narration || "（无摘要）"}</span>
                {txn.payee && txn.narration && <span className="hero-narration">{txn.narration}</span>}
                <span className={`num hero-amount tone-${amt.tone}`}>{amt.text}</span>
                <span className="pills">
                  <span className="pill pill-cat" style={{ ["--c" as string]: categoryStyle(cat?.account).color }}>
                    <Icon name={categoryStyle(cat?.account).icon} size={12} stroke={2.4} />
                    {cat?.name ?? "转账"}
                  </span>
                  <span className="pill num">
                    {txn.date} {weekday(txn.date)}
                  </span>
                  {txn.tags.map((tag) => (
                    <span key={tag} className="pill pill-tag">
                      #{tag}
                    </span>
                  ))}
                </span>
              </section>
            )}
            {!txn.ticket && txn.note && <NoteBlock note={txn.note} className="note-card" />}

            <section className="card">
              <div className={"card-label" + (txn.balanced ? "" : " is-bad")}>分录 · {txn.balanced ? "已平衡" : "不平衡"}</div>
              {txn.postings.map((p, i) => (
                <div key={i} className="posting">
                  {p.group ? <CategoryTile account={p.account} size={32} radius={9} iconSize={16} /> : <Mark brand={p.brand} fallback={p.name} size={32} radius={9} fontSize={14} />}
                  <span className="posting-text">
                    <span className="posting-name">{p.name}</span>
                    <span className="mono posting-account">{p.account}</span>
                  </span>
                  <span className="num posting-amount">
                    {p.amount == null ? "" : money(p.amount)}
                    {p.currency && p.currency !== currency ? ` ${p.currency}` : ""}
                  </span>
                </div>
              ))}
            </section>

            <section className="card meta">
              <dl>
                <dt>状态</dt>
                <dd>
                  {txn.flag === "!" ? "待确认" : "已确认"} <span className="mono">{txn.flag}</span>
                </dd>
                {sourceMeta}
              </dl>
            </section>

            {actions}

            {txn.others.length > 0 && (
              <section className="others">
                <h2>{txn.payee || txn.brand?.name}的其他交易</h2>
                <div className="card">
                  {txn.others.map((o) => {
                    const a = txnAmount(o, currency);
                    return (
                      <a key={o.id} href={`/txn/${encodeURIComponent(o.id)}`} className="row row-small" onClick={(e) => (e.preventDefault(), navigate(`/txn/${encodeURIComponent(o.id)}`))}>
                        <CategoryTile account={o.category?.account} size={30} radius={9} iconSize={15} stroke={2.1} />
                        <span className="row-text">
                          <span className="row-title-plain">{o.narration || o.payee || "（无摘要）"}</span>
                          <span className="num row-sub">
                            {shortDate(o.date)} · {o.category?.name ?? "转账"}
                          </span>
                        </span>
                        <span className={`num amount tone-${a.tone}`}>{a.text}</span>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
