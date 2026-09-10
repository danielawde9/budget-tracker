import { useCallback, useState } from 'react';

import type { Locale } from '../loans/types.js';
import { localizeHouseholdError } from './errors.js';
import { HouseholdConfirmDialog, InviteHouseholdDialog } from './household-dialogs.js';
import type { HouseholdGateway, HouseholdInvitation, HouseholdMembership, MemberRole } from './types.js';
import { useHousehold } from './use-household.js';

interface HouseholdPageProps {
  readonly gateway: HouseholdGateway;
  readonly locale: Locale;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly userId: string;
  onSpaceUnavailable(): void;
}

type Confirmation =
  | { readonly kind: 'cancel'; readonly invitation: HouseholdInvitation }
  | { readonly kind: 'role'; readonly membership: HouseholdMembership; readonly role: MemberRole }
  | { readonly kind: 'remove'; readonly membership: HouseholdMembership }
  | { readonly kind: 'leave' };

const copy = {
  en: {
    loading: 'Loading household access', title: 'Household access', memberTitle: 'Your household access',
    intro: 'Manage who can use this household through protected access commands.', members: 'Members', invitations: 'Invitations',
    invite: 'Invite member', role: 'Role', status: 'Status', owner: 'Owner', member: 'Member', active: 'Active', revoked: 'Revoked', left: 'Left', self: 'You',
    pending: 'Pending', accepted: 'Accepted', cancelled: 'Cancelled', expired: 'Expired', created: 'Created', expires: 'Expires', ended: 'Ended',
    promote: 'Promote to owner', demote: 'Demote to member', remove: 'Remove access', cancelInvitation: 'Cancel invitation',
    leave: 'Leave household', selfDetails: 'Access details', loadMore: 'Load more', tryAgain: 'Try again', noMembers: 'No membership records are available.', noInvitations: 'No invitation records yet.',
    close: 'Cancel', acknowledge: 'I understand this changes household access.', working: 'Applying…',
  },
  ar: {
    loading: 'تحميل المساحة المنزلية', title: 'إدارة المنزل', memberTitle: 'صلاحيتك المنزلية',
    intro: 'أدِر من يمكنه استخدام هذه المساحة عبر أوامر الصلاحيات المحمية.', members: 'الأعضاء', invitations: 'الدعوات',
    invite: 'دعوة عضو', role: 'الدور', status: 'الحالة', owner: 'مالك', member: 'عضو', active: 'فعّال', revoked: 'ملغى', left: 'غادر', self: 'أنت',
    pending: 'قيد الانتظار', accepted: 'مقبولة', cancelled: 'ملغاة', expired: 'منتهية', created: 'أُنشئت', expires: 'تنتهي', ended: 'انتهت',
    promote: 'ترقية إلى مالك', demote: 'تخفيض إلى عضو', remove: 'إزالة الصلاحية', cancelInvitation: 'إلغاء الدعوة',
    leave: 'مغادرة المنزل', selfDetails: 'تفاصيل الصلاحية', loadMore: 'تحميل المزيد', tryAgain: 'حاول مجددًا', noMembers: 'لا توجد سجلات عضوية متاحة.', noInvitations: 'لا توجد سجلات دعوات بعد.',
    close: 'إلغاء', acknowledge: 'أفهم أن هذا الإجراء يغيّر صلاحيات المنزل.', working: 'جارٍ التطبيق…',
  },
} as const;

function ErrorNotice({ error, locale }: { readonly error: ReturnType<typeof localizeHouseholdError> | null; readonly locale: Locale }) {
  if (!error) return null;
  const localized = localizeHouseholdError(error, locale);
  return <div className="error-notice" role="alert"><strong>{localized.message}</strong><p>{localized.recovery}</p></div>;
}

export function HouseholdPage(props: HouseholdPageProps) {
  const text = copy[props.locale];
  const household = useHousehold({ gateway: props.gateway, spaceId: props.spaceId, userId: props.userId, onSpaceUnavailable: props.onSpaceUnavailable });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const closeInvite = useCallback(() => { setInviteOpen(false); household.clearActionState(); }, [household]);
  const closeConfirmation = useCallback(() => { setConfirmation(null); household.clearActionState(); }, [household]);
  const formatDate = useCallback((value: string) => new Intl.DateTimeFormat(props.locale === 'ar' ? 'ar-LB' : 'en-US', { dateStyle: 'medium' }).format(new Date(value)), [props.locale]);

  if (household.status === 'loading') {
    return <div className="state-panel" role="status" aria-label={text.loading}>{text.loading}…</div>;
  }
  if (household.status === 'error') {
    return <section className="state-panel"><ErrorNotice error={household.error} locale={props.locale} /><button type="button" onClick={() => void household.retry()}>{text.tryAgain}</button></section>;
  }

  const actionError = <ErrorNotice error={household.actionError} locale={props.locale} />;
  const pending = household.actionPending !== null;

  async function confirmAction(): Promise<boolean> {
    if (!confirmation) return false;
    if (confirmation.kind === 'cancel') return household.cancelInvitation(confirmation.invitation.invitationId);
    if (confirmation.kind === 'role') return household.setMemberRole(confirmation.membership.userId, confirmation.role);
    if (confirmation.kind === 'remove') return household.removeMember(confirmation.membership.userId);
    return household.leave();
  }

  function confirmationCopy() {
    if (!confirmation) return null;
    if (confirmation.kind === 'cancel') return {
      title: text.cancelInvitation,
      label: text.cancelInvitation,
      description: <p>{text.cancelInvitation}: <bdi>{confirmation.invitation.invitationId}</bdi></p>,
      dangerous: true,
    };
    if (confirmation.kind === 'role') return {
      title: confirmation.role === 'owner' ? text.promote : text.demote,
      label: confirmation.role === 'owner' ? text.promote : text.demote,
      description: <p><bdi>{confirmation.membership.userId}</bdi></p>,
      dangerous: confirmation.role === 'member',
    };
    if (confirmation.kind === 'remove') return {
      title: text.remove,
      label: text.remove,
      description: <p>{text.remove}: <bdi>{confirmation.membership.userId}</bdi></p>,
      dangerous: true,
    };
    return { title: text.leave, label: text.leave, description: <p><bdi>{props.spaceName}</bdi></p>, dangerous: true };
  }

  const confirmationText = confirmationCopy();
  return <section className="household-workspace">
    <header className="topbar household-topbar">
      <div><h1>{household.status === 'owner-ready' ? text.title : text.memberTitle}</h1><p>{text.intro} <bdi>{props.spaceName}</bdi></p></div>
      {household.status === 'owner-ready' ? <button type="button" onClick={() => { household.clearActionState(); setInviteOpen(true); }}>{text.invite}</button> : null}
    </header>
    {actionError}
    {household.status === 'owner-ready' ? <div className="household-columns">
      <section className="household-register" aria-labelledby="household-members-heading">
        <h2 id="household-members-heading">{text.members}</h2>
        {household.members.length === 0 ? <p className="empty">{text.noMembers}</p> : <ul className="household-list">{household.members.map((membership) => <li key={membership.userId} className="household-row">
          <div className="household-identity"><bdi>{membership.userId}</bdi>{membership.isSelf ? <span className="household-self">{text.self}</span> : null}</div>
          <dl><div><dt>{text.role}</dt><dd>{text[membership.role]}</dd></div><div><dt>{text.status}</dt><dd>{text[membership.status]}</dd></div>{membership.endedAt ? <div><dt>{text.ended}</dt><dd>{formatDate(membership.endedAt)}</dd></div> : null}</dl>
          {!membership.isSelf && membership.status === 'active' ? <div className="household-actions">
            <button type="button" className="text-button" aria-label={props.locale === 'en' ? `${membership.role === 'member' ? 'Promote' : 'Demote'} ${membership.userId} to ${membership.role === 'member' ? 'owner' : 'member'}` : `${membership.role === 'member' ? text.promote : text.demote} ${membership.userId}`} onClick={() => setConfirmation({ kind: 'role', membership, role: membership.role === 'member' ? 'owner' : 'member' })}>{membership.role === 'member' ? text.promote : text.demote}</button>
            <button type="button" className="text-button danger-text" aria-label={props.locale === 'en' ? `Remove ${membership.userId}` : `${text.remove} ${membership.userId}`} onClick={() => setConfirmation({ kind: 'remove', membership })}>{text.remove}</button>
          </div> : null}
        </li>)}</ul>}
        {household.membersHasMore ? <button type="button" className="secondary" disabled={pending} onClick={() => void household.loadMoreMembers()}>{text.loadMore}</button> : null}
      </section>
      <section className="household-register" aria-labelledby="household-invitations-heading">
        <h2 id="household-invitations-heading">{text.invitations}</h2>
        {household.invitations.length === 0 ? <p className="empty">{text.noInvitations}</p> : <ul className="household-list">{household.invitations.map((invitation) => <li key={invitation.invitationId} className="household-row invitation-row">
          <div><span className={`status household-status status-${invitation.effectiveStatus}`}>{text[invitation.effectiveStatus]}</span><bdi>{invitation.invitationId}</bdi></div>
          <dl><div><dt>{text.created}</dt><dd>{formatDate(invitation.createdAt)}</dd></div><div><dt>{text.expires}</dt><dd>{formatDate(invitation.expiresAt)}</dd></div></dl>
          {invitation.effectiveStatus === 'pending' || invitation.effectiveStatus === 'expired' ? <button type="button" className="text-button danger-text" aria-label={`${text.cancelInvitation} ${invitation.invitationId}`} onClick={() => setConfirmation({ kind: 'cancel', invitation })}>{text.cancelInvitation}</button> : null}
        </li>)}</ul>}
        {household.invitationsHasMore ? <button type="button" className="secondary" disabled={pending} onClick={() => void household.loadMoreInvitations()}>{text.loadMore}</button> : null}
      </section>
    </div> : <section className="household-register household-self-access">
      <h2>{text.selfDetails}</h2>
      <dl><div><dt>{text.role}</dt><dd>{text[household.self?.role ?? 'member']}</dd></div><div><dt>{text.status}</dt><dd>{text[household.self?.status ?? 'active']}</dd></div></dl>
    </section>}
    <footer className="household-leave"><button type="button" className="secondary danger-text" onClick={() => setConfirmation({ kind: 'leave' })}>{text.leave}</button></footer>
    {inviteOpen ? <InviteHouseholdDialog locale={props.locale} pending={pending} succeeded={household.actionSuccess === 'invitation-created'} error={actionError} onClose={closeInvite} onSubmit={household.createInvitation} /> : null}
    {confirmation && confirmationText ? <HouseholdConfirmDialog
      title={confirmationText.title}
      description={confirmationText.description}
      confirmLabel={confirmationText.label}
      closeLabel={text.close}
      acknowledgement={text.acknowledge}
      pendingLabel={text.working}
      pending={pending}
      dangerous={confirmationText.dangerous}
      error={actionError}
      onClose={closeConfirmation}
      onConfirm={confirmAction}
    /> : null}
  </section>;
}
