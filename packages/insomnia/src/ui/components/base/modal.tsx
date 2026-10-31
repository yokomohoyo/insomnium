import classnames from 'classnames';
import React, { createContext, forwardRef, ReactNode, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import { createKeybindingsHandler } from '../keydown-binder';
// Keep global z-index reference so that every modal will
// appear over top of an existing one.
let globalZIndex = 1000;

// what Tab can reach in a modal
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// the id of the modal's title, which its ModalHeader renders: the dialog's name
export const ModalTitleId = createContext<string | undefined>(undefined);

export interface ModalProps {
  centered?: boolean;
  tall?: boolean;
  wide?: boolean;
  skinny?: boolean;
  onShow?: Function;
  onHide?: Function;
  children?: ReactNode;
  className?: string;
}

export interface ModalHandle {
  show: (options?: { onHide?: () => void }) => void;
  hide: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}
export const Modal = forwardRef<ModalHandle, ModalProps>(({
  centered,
  children,
  className,
  onHide: onHideProp,
  onShow,
  skinny,
  tall,
  wide,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [zIndex, setZIndex] = useState(globalZIndex);
  const [onHideArgument, setOnHideArgument] = useState<() => void>();
  // where the focus was before the modal took it, to give it back on hide
  const returnFocus = useRef<HTMLElement | null>(null);

  const show: ModalHandle['show'] = useCallback(options => {
    // stored as a value (a function passed to a state setter is called as an
    // updater), and this show's only, not an earlier one's
    setOnHideArgument(() => options?.onHide);
    if (!containerRef.current?.contains(document.activeElement)) {
      returnFocus.current = document.activeElement as HTMLElement | null;
    }
    setOpen(true);
    setZIndex(globalZIndex++);
    onShow?.();
  }, [onShow]);

  const hide = useCallback(() => {
    setOpen(false);
    // back where it was, unless that's gone or the focus has moved on
    const back = returnFocus.current;
    returnFocus.current = null;
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body || containerRef.current?.contains(document.activeElement))) {
      setTimeout(() => back.focus());
    }
    if (typeof onHideProp === 'function') {
      onHideProp();
    }
    if (typeof onHideArgument === 'function') {
      onHideArgument();
    }
  }, [onHideProp, onHideArgument]);

  // the modal takes the focus as it opens, unless something in it has taken it
  // already (an input with autoFocus): it stayed behind the modal, so Tab went
  // through the page underneath
  useEffect(() => {
    if (open && containerRef.current && !containerRef.current.contains(document.activeElement)) {
      containerRef.current.focus();
    }
  }, [open]);

  // and Tab goes round what's in the modal, not out of it
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented || !containerRef.current) {
      return;
    }
    const focusable = [...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter(element => !element.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(element).display !== 'none');
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === containerRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useImperativeHandle(ref, () => ({
    show,
    hide,
    toggle: () => open ? hide() : show(),
    isOpen: () => open,
  }), [show, open, hide]);

  const classes = classnames(
    'modal',
    'theme--dialog',
    className,
    { 'modal--fixed-height': tall },
    { 'modal--wide': wide },
    { 'modal--skinny': skinny },
  );

  useEffect(() => {
    const closeElements = containerRef.current?.querySelectorAll('[data-close-modal]');

    for (const element of closeElements || []) {
      element.addEventListener('click', hide);
    }
  }, [hide, open]);

  const handleKeydown = createKeybindingsHandler({
    'Escape': () => {
      hide();
    },
  });
  useEffect(() => {
    document.body.addEventListener('keydown', handleKeydown);

    return () => {
      document.body.removeEventListener('keydown', handleKeydown);
    };
  }, [handleKeydown]);

  return (open ?
    <div
      ref={containerRef}
      onKeyDown={event => {
        trapTab(event);
        handleKeydown(event);
      }}
      tabIndex={-1}
      className={classes}
      style={{ zIndex }}
      aria-hidden={false}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="modal__backdrop overlay theme--transparent-overlay" data-close-modal />
      <div className={classnames('modal__content__wrapper', { 'modal--centered': centered })}>
        <div className="modal__content">
          <ModalTitleId.Provider value={titleId}>
            {children}
          </ModalTitleId.Provider>
        </div>
      </div>
    </div>
    : null
  );
});
Modal.displayName = 'Modal';
