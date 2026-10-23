import { cn } from '@/lib/utils';
export function Badge({ children, className }: React.PropsWithChildren<{ className?: string }>) { return <span className={cn('badge', className)}>{children}</span>; }
