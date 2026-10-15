import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from './Icons';
import { cx } from './utils';

export default function Row({ title, children, count = 0 }) {
  const ref = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update, count]);

  const page = (dir) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.92, behavior: 'smooth' });
  };

  const arrow = 'absolute top-9 bottom-9 z-40 flex w-[4%] min-w-[34px] items-center justify-center bg-black/55 text-white opacity-0 transition-all duration-200 hover:bg-black/75 group-hover/row:opacity-100';

  return (
    <section className="group/row relative mb-1 animate-fadeIn sm:mb-3">
      <h2 className="px-[4%] text-[1.05rem] font-bold text-[#e5e5e5] transition-colors hover:text-white sm:text-xl">{title}</h2>
      <div className="relative">
        {canLeft && (
          <button onClick={() => page(-1)} aria-label="Scroll left" className={cx(arrow, 'left-0 rounded-r')}>
            <ChevronLeft size={34} className="transition-transform hover:scale-125" />
          </button>
        )}
        <div
          ref={ref}
          onScroll={update}
          className="no-scrollbar -my-7 flex gap-1.5 overflow-x-auto px-[4%] py-9 sm:gap-2"
          style={{ scrollBehavior: 'smooth' }}
        >
          {children}
        </div>
        {canRight && (
          <button onClick={() => page(1)} aria-label="Scroll right" className={cx(arrow, 'right-0 rounded-l')}>
            <ChevronRight size={34} className="transition-transform hover:scale-125" />
          </button>
        )}
      </div>
    </section>
  );
}

export function RowSkeleton({ wide = false }) {
  return (
    <div className="mb-6 px-[4%]">
      <div className="skeleton mb-3 h-5 w-48 rounded" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={cx('skeleton flex-none rounded-[5px]', wide ? 'aspect-video w-[62%] sm:w-[40%] md:w-[29%] lg:w-[22%] xl:w-[18%]' : 'aspect-[2/3] w-[40%] sm:w-[28%] md:w-[21.5%] lg:w-[17.5%] xl:w-[15%] 2xl:w-[13%]')}
          />
        ))}
      </div>
    </div>
  );
}
