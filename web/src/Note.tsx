import { Icon } from "./icons";

/** 流水行标题旁的小标记（交易的 note: 元数据）：悬停显示全文，点开（或键盘回车）在行里展开。行本身是链接，所以点它不跳转。 */
export function NoteTag({ note, open, onToggle }: { note: string; open: boolean; onToggle: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={"note-tag" + (open ? " is-open" : "")}
      title={note}
      aria-label="细节"
      aria-expanded={open}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon name="note" size={12} stroke={2.2} />
    </span>
  );
}

/** 流水行里展开的细节全文。 */
export function NoteText({ note, className }: { note: string; className: string }) {
  return <span className={`note-text ${className}`}>{note}</span>;
}

/** 详情里摘要下方的细节，原样保留换行。 */
export function NoteBlock({ note, className = "" }: { note: string; className?: string }) {
  return (
    <section className={`note-block ${className}`.trim()} aria-label="细节">
      <span className="note-block-label">
        <Icon name="note" size={13} stroke={2.2} />
        细节
      </span>
      <span className="note-block-text">{note}</span>
    </section>
  );
}
