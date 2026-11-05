import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, footer, width = 440 }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-x" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
