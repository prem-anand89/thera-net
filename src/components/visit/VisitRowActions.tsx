import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { clinicCanShowUpiQr, clinicUpiPayeeName, buildUpiPayUri } from '@/domain/upiPay';
import { formatINR } from '@/domain/money';
import { formatDateDM } from '@/domain/fiscalYear';
import { paymentActions } from '@/domain/paymentState';
import { openPatientWhatsAppChat } from '@/lib/pdfShare';
import { feedbackService } from '@/services';
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
  // Direct ask, independent of the feedback flow's own nudge
  // (`VisitFeedbackLink`'s "⭐ Google review", which only shows after a
  // 5* response) — this one is for staff who already know the patient is
  // happy and don't want to wait for them to fill in internal feedback
  // first. Same `data.googleReviewUrl` field that nudge already uses, just
  // without its `request.googleReviewEligible` rating gate.
  const canAskGoogleReview = Boolean(data.googleReviewUrl);

  const hasMenu =
    data.canRepeat ||
    canIssueInvoice ||
    showReminder ||
    canAskGoogleReview ||
    (data.canEdit && onEdit) ||
    (data.canSplit && onSplit) ||
    data.canDelete;
  if (!hasMenu) return null;

  const handleAskGoogleReview = () => {
    void feedbackService.askForGoogleReview(
      clinic.id,
      data.patientName,
      data.patientPhone ?? null,
      clinic.name,
      data.googleReviewUrl!
    );
  };

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

    openPatientWhatsAppChat(text, data.patientPhone);
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
              Give bill
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
          {canAskGoogleReview && (
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                close();
                handleAskGoogleReview();
              }}
            >
              Ask for Google review
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
