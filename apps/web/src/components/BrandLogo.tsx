import Image from 'next/image';
import { cn } from '@/lib/utils';

export function BrandLogo({
  className,
  size = 40,
  priority = false,
}: {
  className?: string;
  size?: number;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="CastMe Pro"
      width={size}
      height={size}
      priority={priority}
      className={cn('object-contain', className)}
    />
  );
}
