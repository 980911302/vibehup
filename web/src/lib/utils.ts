import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui 风格类名合并工具 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
