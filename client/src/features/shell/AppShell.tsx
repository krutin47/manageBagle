import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarRange, ChartNoAxesColumn, Inbox, LogOut, Moon, NotebookPen, Settings, Sun, Target } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { cx, Logo } from "../../components/ui";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/hooks";
import { useUser } from "../../lib/queries";

const NAV = [
  { to: "/", label: "Today", icon: Target, end: true },
  { to: "/planner", label: "Planner", icon: CalendarRange },
  { to: "/week", label: "Week", icon: ChartNoAxesColumn },
  { to: "/backlog", label: "Backlog", icon: Inbox },
  { to: "/review", label: "Review", icon: NotebookPen },
  { to: "/guide", label: "Guide", icon: BookOpen, desktopOnly: true },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

export function AppShell() {
  const user = useUser();
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const qc = useQueryClient();
  const [theme, setTheme] = useTheme();

  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    qc.setQueryData(["me"], null);
    navigate("/login", { replace: true });
  };

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo" aria-label="manageBagle — Today">
          <Logo />
        </NavLink>

        <nav aria-label="Main" className="nav">
          {NAV.map(({ to, label, icon: Icon, end, desktopOnly }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx("nav-item", isActive && "active", desktopOnly && "nav-desktop-only")}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-active" className="nav-active" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
                  <Icon size={18} aria-hidden />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="user-btn">
              <span className="avatar" aria-hidden>
                {initials(user.displayName)}
              </span>
              <span className="user-meta">
                <span className="user-name">{user.displayName}</span>
                <span className="user-email">{user.email}</span>
              </span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" side="top" align="start" sideOffset={8}>
                <DropdownMenu.Item className="menu-item" onSelect={() => navigate("/guide")}>
                  <BookOpen size={16} aria-hidden /> Guide
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => navigate("/settings")}>
                  <Settings size={16} aria-hidden /> Settings
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="menu-sep" />
                <DropdownMenu.Item className="menu-item" onSelect={signOut}>
                  <LogOut size={16} aria-hidden /> Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </aside>

      <main id="main" className="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            className="page"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
