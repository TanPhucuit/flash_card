import { NavLink, useNavigate } from "react-router-dom";
import { ReactNode } from "react";

export function Icon({ name, filled = false, className = "" }: { name: string; filled?: boolean; className?: string }) {
  return <span className={`material-symbols-outlined ${filled ? "icon-fill" : ""} ${className}`}>{name}</span>;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-primary hover:bg-primary-container text-on-primary shadow-level-2",
    secondary: "bg-surface-container-lowest border border-surface-variant text-on-surface hover:border-primary",
    ghost: "bg-transparent text-on-surface-variant hover:bg-surface-container",
    danger: "bg-error-container text-red-900 hover:opacity-90",
  };
  return (
    <button className={`inline-flex items-center justify-center gap-sm rounded-xl px-lg py-sm font-semibold transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-surface-variant bg-white p-lg shadow-level-1 dark:border-white/10 dark:bg-[#232627] ${className}`}>{children}</section>;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl border border-surface-variant bg-white px-md py-sm text-on-surface outline-none transition focus:border-secondary focus:ring-2 focus:ring-secondary/15 dark:bg-[#202324] dark:text-white ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-xl border border-surface-variant bg-white px-md py-sm text-on-surface outline-none transition focus:border-secondary focus:ring-2 focus:ring-secondary/15 dark:bg-[#202324] dark:text-white ${props.className ?? ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`w-full rounded-xl border border-surface-variant bg-white px-md py-sm text-on-surface outline-none transition focus:border-secondary focus:ring-2 focus:ring-secondary/15 dark:bg-[#202324] dark:text-white ${props.className ?? ""}`} />;
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-3 overflow-hidden rounded-full bg-primary-fixed dark:bg-white/10">
      <div className="h-full rounded-full bg-primary-container transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <Card className="flex min-h-56 flex-col items-center justify-center text-center">
      <Icon name="library_books" className="mb-sm text-5xl text-primary" />
      <h2 className="font-headline-md text-headline-md">{title}</h2>
      <p className="mt-xs max-w-xl text-on-surface-variant">{text}</p>
      <div className="mt-lg">{action}</div>
    </Card>
  );
}

const nav = [
  ["Dashboard", "/dashboard", "dashboard"],
  ["My Sets", "/sets", "library_books"],
  ["Progress", "/progress", "leaderboard"],
  ["Settings", "/settings", "settings"],
] as const;

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="app-shell flex min-h-screen bg-background text-on-background dark:bg-[#191c1d] dark:text-white">
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col gap-sm border-r border-surface-variant bg-surface p-md dark:border-white/10 dark:bg-[#202324] md:flex">
        <div className="mb-4 flex flex-col gap-xs px-md py-lg">
          <h1 className="font-headline-md text-headline-md font-bold text-primary dark:text-[#c3c0ff]">Local English</h1>
          <span className="font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant dark:text-white/60">Modern Academic</span>
        </div>
        <nav className="flex flex-1 flex-col gap-xs">
          {nav.map(([label, to, icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-md rounded-xl px-md py-sm transition-all ${isActive ? "bg-primary-container font-semibold text-white" : "text-on-surface-variant hover:bg-surface-container-high dark:text-white/70 dark:hover:bg-white/10"}`}>
              <Icon name={icon} filled={label === "Dashboard"} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Button variant="primary" onClick={() => navigate("/sets/new")}><Icon name="add" /> New Set</Button>
      </aside>
      <div className="flex min-h-screen flex-1 flex-col md:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-surface-variant bg-surface-bright/95 px-container-margin py-md backdrop-blur dark:border-white/10 dark:bg-[#202324]/95 md:hidden">
          <button onClick={() => navigate("/dashboard")} className="font-headline-md text-xl font-bold text-primary dark:text-[#c3c0ff]">Local English</button>
          <button onClick={() => navigate("/sets/new")} className="rounded-full bg-primary p-2 text-white shadow-level-2">
            <Icon name="add" />
          </button>
        </header>
        <main className="flex-1 overflow-x-hidden bg-pattern px-container-margin pb-28 pt-lg md:px-xl md:pb-xl md:pt-xl">
          {children}
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-4 border-t border-surface-variant bg-surface-bright/95 px-sm py-sm backdrop-blur dark:border-white/10 dark:bg-[#202324]/95 md:hidden">
          {nav.map(([label, to, icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `flex flex-col items-center justify-center gap-xs rounded-xl px-xs py-sm text-[11px] font-semibold transition ${isActive ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/65"}`}>
              <Icon name={icon} className="text-[22px]" />
              <span className="leading-none">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-lg flex flex-col justify-between gap-md md:flex-row md:items-end">
      <div>
        <h1 className="font-headline-lg text-2xl font-bold leading-8 md:text-headline-lg">{title}</h1>
        {subtitle ? <p className="mt-xs max-w-3xl text-on-surface-variant dark:text-white/65">{subtitle}</p> : null}
      </div>
      {action ? <div className="w-full md:w-auto [&>button]:w-full md:[&>button]:w-auto">{action}</div> : null}
    </div>
  );
}
