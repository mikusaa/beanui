import { useEffect, useMemo, useState, type ReactNode } from "react";

const POP_WIDTH = 320;

export type Option = { value: string; label: string; hint?: string; count?: number };

/** 弹层的外壳：底部弹出，电脑端给 anchor（点开它的按钮）时改成挂在按钮下面的下拉框；Esc 和点空白处关掉。
 *  onClear 有值时标题旁边出「清除」。 */
export function SheetFrame({
  title,
  onClose,
  onClear,
  anchor,
  width = POP_WIDTH,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  onClear?: () => void;
  anchor?: DOMRect;
  width?: number;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={"sheet-backdrop" + (anchor ? " is-pop" : "")} onClick={onClose}>
      <div
        className={"sheet" + (className ? " " + className : "")}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={anchor && { top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) }}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          {onClear && (
            <button type="button" className="link-btn" onClick={onClear}>
              清除
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** 单选列表；选项多时带搜索。给 values 时是多选：values 里的都标成选中，点一项只回调，开关由调用方管。 */
export function Sheet({
  title,
  options,
  value,
  values,
  onPick,
  onClose,
  clearable,
  anchor,
}: {
  title: string;
  options: Option[] | null;
  value: string;
  values?: string[];
  onPick: (v: string) => void;
  onClose: () => void;
  clearable: boolean;
  anchor?: DOMRect;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (options ?? []).filter((o) => !f || o.label.toLowerCase().includes(f) || o.hint?.toLowerCase().includes(f));
  }, [options, filter]);

  return (
    <SheetFrame title={title} onClose={onClose} onClear={clearable && value ? () => onPick("") : undefined} anchor={anchor}>
      {options && options.length > 12 && (
        <input className="sheet-search" type="search" autoFocus={Boolean(anchor)} placeholder="筛选" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`筛选${title}`} />
      )}
      <div className="sheet-list">
        {!options && <div className="sheet-empty">加载中…</div>}
        {options && !shown.length && <div className="sheet-empty">没有匹配的选项</div>}
        {shown.map((o) => (
          <button
            type="button"
            key={o.value}
            className={"sheet-item" + ((values ? values.includes(o.value) : o.value === value) ? " is-on" : "")}
            aria-pressed={values ? values.includes(o.value) : undefined}
            onClick={() => onPick(o.value)}
          >
            {values && <span className={"sheet-check" + (values.includes(o.value) ? " is-on" : "")} aria-hidden="true" />}
            <span className="sheet-label">
              <span>{o.label}</span>
              {o.hint && <span className="sheet-hint mono">{o.hint}</span>}
            </span>
            {o.count != null && <span className="num sheet-count">{o.count}</span>}
          </button>
        ))}
      </div>
    </SheetFrame>
  );
}
