import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    text: string;
    children: React.ReactElement<{ 'aria-describedby'?: string }>;
    placement?: 'top' | 'bottom';
}

const Tooltip: React.FC<TooltipProps> = ({ text, children, placement = 'top' }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState<React.CSSProperties>({});
    const trigger = useRef<HTMLSpanElement>(null);
    const popup = useRef<HTMLDivElement>(null);
    const id = useId();

    useLayoutEffect(() => {
        if (!isVisible) return;
        let frame = 0;
        const measure = () => {
            if (trigger.current && popup.current) {
                const bounds = trigger.current.getBoundingClientRect();
                const { width, height } = popup.current.getBoundingClientRect();
                let top = placement === 'top' ? bounds.top - height - 8 : bounds.bottom + 8;
                if (top < 8) top = bounds.bottom + 8;
                if (top + height > window.innerHeight - 8) top = bounds.top - height - 8;
                top = Math.max(8, top);
                const left = Math.max(8, Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - 8));
                setPosition(current => current.top === top && current.left === left ? current : { top, left });
            }
            // Follow triggers that move with a CSS transform, such as the sliding sidebar.
            frame = window.requestAnimationFrame(measure);
        };
        measure();
        return () => window.cancelAnimationFrame(frame);
    }, [isVisible, placement, text]);

    return <span ref={trigger} className="ui-tooltip-trigger"
        onPointerEnter={() => setIsVisible(true)} onPointerLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)} onBlur={() => setIsVisible(false)}
        onClickCapture={() => setIsVisible(false)}
        onKeyDown={event => { if (event.key === 'Escape') setIsVisible(false); }}>
        {React.cloneElement(children, { 'aria-describedby': isVisible ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })}
        {isVisible && createPortal(<div ref={popup} id={id} role="tooltip" className="ui-tooltip" style={position}>{text}</div>, document.body)}
    </span>;
};

export default Tooltip;
