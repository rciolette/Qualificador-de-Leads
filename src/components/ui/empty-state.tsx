import { type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

/** Estado vazio padronizado (Etapa 4 - Feedback/Estados). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-8 px-4 ${className}`}>
      {Icon && <Icon className="w-7 h-7 text-muted-foreground/40 mb-3" />}
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {description && (
        <div className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;