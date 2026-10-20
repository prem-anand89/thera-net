export type CappedLane = { lane: number; lanes: number; /** A "+N" chip sits at this cluster's right edge. */ hasOverflow: boolean };
export type LaneOverflow = {
  /** Cluster start (minutes) and end, where the "+N" chip is drawn. */
  start: number;
  end: number;
  /** The appointments that did not get a lane, earliest first. */
  hiddenIds: string[];
};

/**
 * Side-by-side lanes with a cap, for a day column that holds several
 * therapists' appointments. Overlapping appointments form a cluster; a cluster
 * needing more than `maxLanes` lanes shows the first `maxLanes` lanes and
 * reports the rest as `overflow` (the grid draws one "+N" chip per cluster).
 */
export function capLanes(
  items: { id: string; start: number; end: number }[],
  maxLanes: number
): { visible: Map<string, CappedLane>; overflow: LaneOverflow[] } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const visible = new Map<string, CappedLane>();
  const overflow: LaneOverflow[] = [];
  let cluster: { id: string; start: number; end: number; lane: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    const capped = lanes > maxLanes;
    for (const item of cluster) {
      if (item.lane < maxLanes) visible.set(item.id, { lane: item.lane, lanes: Math.min(lanes, maxLanes), hasOverflow: capped });
    }
    if (capped) {
      overflow.push({
        start: Math.min(...cluster.map((c) => c.start)),
        end: Math.max(...cluster.map((c) => c.end)),
        hiddenIds: cluster.filter((c) => c.lane >= maxLanes).map((c) => c.id),
      });
    }
    cluster = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    const used = new Set(cluster.filter((c) => c.end > item.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane += 1;
    cluster.push({ id: item.id, start: item.start, end: item.end, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return { visible, overflow };
}
