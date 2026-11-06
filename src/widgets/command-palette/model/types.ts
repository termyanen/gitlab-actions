export interface Command {
  id: string;
  label: string;
  group: string;
  icon: string;
  hint?: string;
  action: () => void;
}
export interface SidebarLink {
  label: string;
  href: string;
}
export interface MrCommands {
  actions: () => { id: string; label: string; icon: string }[];
  run: (id: string) => void;
}
