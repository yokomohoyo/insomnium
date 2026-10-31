import classnames from 'classnames';
import React, { FC, memo, ReactNode, useContext } from 'react';

import { t } from '../../../common/i18n';
import { ModalTitleId } from './modal';

interface Props {
  children: ReactNode;
  hideCloseButton?: boolean;
  className?: string;
}

export const ModalHeader: FC<Props> = memo(({ hideCloseButton, className, children }) => {
  const titleId = useContext(ModalTitleId);
  let closeButton: null | JSX.Element = null;

  if (!hideCloseButton) {
    closeButton = (
      <button type="button" className="btn btn--compact modal__close-btn" data-close-modal="true" aria-label={t('Close dialog')}>
        <i className="fa fa-times" aria-hidden />
      </button>
    );
  }

  return (
    <div className={classnames('modal__header theme--dialog__header', className)}>
      <div id={titleId} className="modal__header__children">{children}</div>
      {closeButton}
    </div>
  );
});

ModalHeader.displayName = 'ModalHeader';
