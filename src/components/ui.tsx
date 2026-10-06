'use client';
export function Status({status}:{status:string}){return <span className={`status status-${status}`}>{status}</span>}
export function PageTitle({eyebrow,title,children}:{eyebrow:string;title:string;children?:React.ReactNode}){return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{children}</header>}
