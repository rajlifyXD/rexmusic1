import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * Compatibility wrapper for the existing Rex UI. All buttons retain Rex's
 * original native styling; ReactDrops Bubble UI is reserved for selected sliders.
 */
const BubbleButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function BubbleButton({ type = 'button', ...props }, ref) {
    return <button {...props} type={type} ref={ref} />;
  },
);

BubbleButton.displayName = 'BubbleButton';
export default BubbleButton;
