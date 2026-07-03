import type { CSSProperties, ReactElement } from "react";
import { keyframes, styled } from "styled-components";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Rail shimmer shown on a cold boot until the first thread list arrives.
export function createRailSkeleton(): ReactElement {
  const groups: number[][] = [[78, 60], [70, 84, 52], [66]];
  return (
    <RailSkeleton aria-hidden aria-label="Loading threads" data-rail-skeleton>
      {groups.map((rows, groupIndex) => (
        <RailSkeletonGroup key={groupIndex}>
          <RailSkeletonHeading style={{ width: "38%" } as CSSProperties} />
          {rows.map((width, rowIndex) => (
            <RailSkeletonRow key={rowIndex}>
              <RailSkeletonDot />
              <RailSkeletonLabel
                style={{ width: `${width}%` } as CSSProperties}
              />
            </RailSkeletonRow>
          ))}
        </RailSkeletonGroup>
      ))}
    </RailSkeleton>
  );
}

const railSkeletonAppear = keyframes`
  to {
    opacity: 1;
  }
`;

const railSkeletonShimmer = keyframes`
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
`;

const RailSkeleton = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 6px 14px;
  opacity: 0;
  animation: ${railSkeletonAppear} 0.12s ease 0.18s forwards;

  @media (prefers-reduced-motion: reduce) {
    opacity: 1;
    animation: none;
  }
`;

const RailSkeletonGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RailSkeletonBlock = styled.span`
  background: linear-gradient(
    90deg,
    rgba(var(--tide-ink-rgb), 0.06) 25%,
    rgba(var(--tide-ink-rgb), 0.13) 37%,
    rgba(var(--tide-ink-rgb), 0.06) 63%
  );
  background-size: 400% 100%;
  animation: ${railSkeletonShimmer} 1.4s ease infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const RailSkeletonHeading = styled(RailSkeletonBlock)`
  height: 8px;
  margin-bottom: 4px;
  border-radius: 4px;
`;

const RailSkeletonRow = styled.div`
  height: 22px;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const RailSkeletonDot = styled(RailSkeletonBlock)`
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border-radius: 5px;
`;

const RailSkeletonLabel = styled(RailSkeletonBlock)`
  height: 9px;
  border-radius: 4px;
`;
