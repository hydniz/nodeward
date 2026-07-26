import React, { useLayoutEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// the servers/services pages morph between two shapes instead of swapping:
//
//   table (full width)  ⇄  rail (left) + detail (right)
//
// The left pane is squeezed from full width down to the rail — the table
// inside it keeps its width and is clipped, so it slides out to the left —
// while the right pane grows from zero and pushes the detail in from the
// right. Driven with the web animations api on explicit pixel widths: css
// transitions between `1fr` and `330px` do not interpolate, and a class flip
// in the same frame as the mount has nothing to interpolate from either.
// The resting states stay in css, so a resize still lays out normally.
// ---------------------------------------------------------------------------
const DURATION = 360;
const EASE = 'cubic-bezier(0.22, 0.75, 0.2, 1)';

export default function MorphLayout({
  open, railWidth = 330, gap = 16, table, rail, detail,
}) {
  const box = useRef(null);
  const leftPane = useRef(null);
  const rightPane = useRef(null);
  const tableRef = useRef(null);
  const railRef = useRef(null);
  const detailRef = useRef(null);
  const lastDetail = useRef(detail);
  const first = useRef(true);
  const [flying, setFlying] = useState(false);
  const [frozen, setFrozen] = useState(null);

  if (detail) lastDetail.current = detail;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    if (first.current) {
      first.current = false;
      return undefined; // deep link: land in the final shape, no flight
    }
    const W = el.clientWidth;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // one column (phones) or reduced motion: just switch
    if (reduced || W <= railWidth + gap + 240) return undefined;

    const detailW = Math.max(260, W - railWidth - gap);
    const wide = [W, 0, 0];
    const split = [railWidth, detailW, gap];
    const [from, to] = open ? [wide, split] : [split, wide];
    const opt = { duration: DURATION, easing: EASE, fill: 'both' };

    setFlying(true);
    setFrozen({ table: W, detail: detailW });

    const pane = (node, a, b) => node?.animate(
      [{ flexBasis: `${a}px`, width: `${a}px` }, { flexBasis: `${b}px`, width: `${b}px` }],
      opt,
    );
    const running = [
      pane(leftPane.current, from[0], to[0]),
      pane(rightPane.current, from[1], to[1]),
      el.animate([{ columnGap: `${from[2]}px` }, { columnGap: `${to[2]}px` }], opt),
      tableRef.current?.animate(
        [{ opacity: open ? 1 : 0 }, { opacity: open ? 0 : 1 }],
        { duration: 260, easing: 'ease', fill: 'both' },
      ),
      railRef.current?.animate(
        [{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }],
        { duration: 280, easing: 'ease', fill: 'both' },
      ),
      detailRef.current?.animate([
        { opacity: open ? 0 : 1, transform: `translateX(${open ? 26 : 0}px)` },
        { opacity: open ? 1 : 0, transform: `translateX(${open ? 0 : 22}px)` },
      ], opt),
    ].filter(Boolean);

    const done = setTimeout(() => {
      running.forEach((a) => a.cancel());
      setFlying(false);
      setFrozen(null);
    }, DURATION);
    return () => {
      clearTimeout(done);
      running.forEach((a) => a.cancel());
      setFlying(false);
      setFrozen(null);
    };
  }, [open, railWidth, gap]);

  // both shapes stay mounted (css hides the inactive one), so the layout
  // effect above always finds real nodes to animate — mounting them only for
  // the flight would race with react's render passes
  const showSides = open || !!lastDetail.current;

  return (
    <div
      ref={box}
      className={`morph${open ? ' is-open' : ''}${flying ? ' is-flying' : ''}`}
      style={{ '--rail-w': `${railWidth}px`, '--morph-gap': `${gap}px` }}
    >
      <div className="morph-left" ref={leftPane}>
        <div
          className="morph-table"
          ref={tableRef}
          style={frozen ? { width: frozen.table } : undefined}
        >
          {table}
        </div>
        {showSides && (
          <div className="morph-rail" ref={railRef}>{rail}</div>
        )}
      </div>
      <div className="morph-right" ref={rightPane}>
        {showSides && (
          <div
            className="morph-detail"
            ref={detailRef}
            style={frozen ? { width: frozen.detail, flex: '0 0 auto' } : undefined}
          >
            {detail ?? lastDetail.current}
          </div>
        )}
      </div>
    </div>
  );
}
