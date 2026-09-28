import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { clinicCanShowUpiQr, clinicUpiPayeeName, buildUpiPayUri } from '@/domain/upiPay';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { paymentActions } from '@/domain/paymentState';
import { KebabMenu, menuItem, menuItemDestructive } from '@/components/ui';
import type { VisitCardData } from './types';

/** Row actions kebab — Repeat / Issue invoice / Edit visit / Split /
 *  Delete. Note lives on the status cell as + Note so it is not listed
 *  twice. Issue invoice moved in here (Billing & Notes Rebuild Phase 1,
 *  1.2) so the status cell/card can promote its one primary action
 *  (Collect) without a second competing button in the row. */
export function RowActionsMenu({
  data,
  onEdit,
  onSplit,
  onDelete,
  onInvoice,
  canInvoice,
}: {
  data: VisitCardData;
  onEdit?: () => void;
  onSplit?: () => void;
  onDelete: () => void;
  onInvoice?: () => void;
  canInvoice?: boolean;
}) {
  const clinic = useClinic();
  const canIssueInvoice =
    Boolean(canInvoice) &&
    Boolean(onInvoice) &&
    paymentActions(data.paymentState).includes('issue_invoice');
  const showReminder = canInvoice && paymentActions(data.paymentState).includes('take_payment');
  
  const hasMenu =
    data.canRepeat ||
    canIssueInvoice ||
    showReminder ||
    (data.canEdit && onEdit) ||
    (data.canSplit && onSplit) ||
    data.canDelete;
  if (!hasMenu) return null;

  const handleSendReminder = () => {
    const remainingPaise = data.billPaise - data.collectedPaise;
    const upiPayUri = clinicCanShowUpiQr(clinic)
      ? buildUpiPayUri({
          vpa: clinic.upiVpa ?? '',
          payeeName: clinicUpiPayeeName(clinic),
          amountPaise: remainingPaise,
          note: data.patientName,
        })
      : null;

    let text = `Hi ${data.patientName},\n\nThis is a reminder from ${clinic.name} regarding your pending bill for your visit on ${formatDateDM(data.visitDate)} of ${formatINR(remainingPaise)}.`;
    
    if (upiPayUri) {
      text += `\n\nYou can pay directly via UPI using this link:\n${upiPayUri}`;
    }

    const phone = data.patientPhone;
    if (!phone) {
      alert('Patient has no phone number on file');
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <KebabMenu>
      {(close) => (
        <>
          {data.canRepeat && (
            <Link
              to="/visits/new"
              search={{ repeatVisitId: data.visitId }}
              className={menuItem}
              onClick={close}
            >
              Repeat
            </Link>
          )}
          {canIssueInvoice && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                onInvoice!();
              }}
            >
              Issue invoice
            </button>
          )}
          {showReminder && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handleSendReminder();
              }}
            >
              Send WhatsApp reminder
            </button>
          )}
          {data.canEdit && onEdit && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                onEdit();
              }}
            >
              Edit visit
            </button>
          )}
          {data.canSplit && onSplit && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                onSplit();
              }}
            >
              {data.hasSplit ? 'Edit split' : 'Split revenue'}
            </button>
          )}
          {data.canDelete && (
            <button
              type="button"
              className={menuItemDestructive}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              Delete
            </button>
          )}
        </>
      )}
    </KebabMenu>
  );
}
