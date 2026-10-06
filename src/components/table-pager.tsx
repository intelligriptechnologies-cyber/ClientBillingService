'use client';

/** Shared controls deliberately render above and below a register. */
export function TablePager({ total, page, pageSize, noun = 'records', onPage, onPageSize }: { total: number; page: number; pageSize: number; noun?: string; onPage(page: number): void; onPageSize(size: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const range = total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : `0 ${noun}`;
  return <div className="table-footer" data-testid="table-pager">
    <label>Rows per page <select className="select page-size" aria-label={`${noun} rows per page`} value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{[5, 10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
    <span>{range}</span>
    <div className="toolbar"><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="button button-secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>
  </div>;
}
