import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const statusLabels = { confirmed: '可确认', conflict: '存在冲突', unknown: '尚无法确认' } as const;
