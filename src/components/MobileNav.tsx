import { Icon } from "./ui";

export type MobileTab = "add" | "flashcard" | "learn" | "mix" | "reading";

const TABS: Array<{ tab: MobileTab; icon: string; label: string }> = [
  { tab: "add", icon: "add_circle", label: "Thêm từ" },
  { tab: "flashcard", icon: "style", label: "Flashcard" },
  { tab: "learn", icon: "school", label: "Learn" },
  { tab: "mix", icon: "layers", label: "Mix" },
  { tab: "reading", icon: "menu_book", label: "Reading" },
];

export function MobileNav({ active, onSelect }: { active?: MobileTab; onSelect: (tab: MobileTab) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-variant bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#202324]/95"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1 px-sm pt-sm">
        {TABS.map(({ tab, icon, label }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-bold transition active:scale-95 ${
              active === tab ? "bg-primary-fixed text-primary dark:bg-primary/25 dark:text-white" : "text-on-surface-variant dark:text-white/60"
            }`}
          >
            <Icon name={icon} filled={active === tab} /> {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
