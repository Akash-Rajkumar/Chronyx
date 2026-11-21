import React from 'react';

export interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  circle = false,
}) => {
  return (
    <div
      className={`motion-safe:animate-pulse bg-white/[0.06] border border-white/[0.05] ${circle ? 'rounded-full' : 'rounded-[10px]'} ${className}`}
      style={{
        width: width,
        height: height,
      }}
      aria-hidden="true"
    />
  );
};
