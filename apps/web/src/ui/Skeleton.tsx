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
      className={`animate-pulse bg-muted/10 ${circle ? 'rounded-full' : 'rounded-lg'} ${className}`}
      style={{
        width: width,
        height: height,
      }}
      aria-hidden="true"
    />
  );
};
