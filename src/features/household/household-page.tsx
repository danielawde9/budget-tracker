import { useCallback, useState } from 'react';
import { Crown, UserPlus } from 'lucide-react';

import type { Locale } from '../loans/types.js';
import { localizeHouseholdError } from './errors.js';
import { HouseholdConfirmDialog, InviteHouseholdDialog } from './household-dialogs.js';
import type { HouseholdGateway, HouseholdInvitation, HouseholdMembership, MemberRole } from './types.js';
import { useHousehold } from './use-household.js';
import { HouseholdSkeleton } from '../control-room/skeletons.js';
import { PageHeader } from '../control-room/page-header.js';
import './household-page.css';

interface HouseholdPageProps {
  readonly gateway: HouseholdGateway;
  readonly locale: Locale;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly userId: string;
  readonly userEmail: string | null;
  onSpaceUnavailable(): void;
}

type Confirmation =
  | { readonly kind: 'cancel'; readonly invitation: HouseholdInvitation }
  | { readonly kind: 'role'; readonly membership: HouseholdMembership; readonly role: MemberRole }
  | { readonly kind: 'remove'; readonly membership: HouseholdMembership }
  | { readonly kind: 'leave' };

const copy = {
  en: {
    loading: 'Loading household access', title: 'Household', memberTitle: 'Your household access',
    intro: 'Members and invitations for', memberIntro: 'Your access to', members: 'Members', invitations: 'Invitations', access: 'Your access',
    invite: 'Invite member', role: 'Role', status: 'Status', owner: 'Owner', member: 'Member', active: 'Active', revoked: 'Revoked', left: 'Left', self: 'You', shortPromote: 'Promote', shortDemote: 'Demote', shortRemove: 'Remove',
    pending: 'Pending', accepted: 'Accepted', cancelled: 'Cancelled', expired: 'Expired', created: 'Created', expires: 'Expires', ended: 'Ended',
    promote: 'Promote to owner', demote: 'Demote to member', remove: 'Remove access', cancelInvitation: 'Cancel invitation',
    leave: 'Leave household', selfDetails: 'Access details', loadMore: 'Load more', tryAgain: 'Try again', noMembers: 'No membership records are available.', noInvitations: 'No invitation records yet.',
    ownerAccess: 'You can invite members, change roles, and remove access.', memberAccess: 'You can view your access or leave this household.',
    close: 'Cancel', acknowledge: 'I understand this changes household access.', working: 'Applying…',
  },
  ar: {
    loading: 'تحميل المساحة المنزلية', title: 'المنزل', memberTitle: 'صلاحيتك المنزلية',
    intro: 'الأعضاء والدعوات في', memberIntro: 'صلاحيتك في', members: 'الأعضاء', invitations: 'الدعوات', access: 'صلاحيتك',
    invite: 'دعوة عضو', role: 'الدور', status: 'الحالة', owner: 'مالك', member: 'عضو', active: 'فعّال', revoked: 'ملغى', left: 'غادر', self: 'أنت', shortPromote: 'ترقية', shortDemote: 'تخفيض', shortRemove: 'إزالة',
    pending: 'قيد الانتظار', accepted: 'مقبولة', cancelled: 'ملغاة', expired: 'منتهية', created: 'أُنشئت', expires: 'تنتهي', ended: 'انتهت',
    promote: 'ترقية إلى مالك', demote: 'تخفيض إلى عضو', remove: 'إزالة الصلاحية', cancelInvitation: 'إلغاء الدعوة',
    leave: 'مغادرة المنزل', selfDetails: 'تفاصيل الصلاحية', loadMore: 'تحميل المزيد', tryAgain: 'حاول مجددًا', noMembers: 'لا توجد سجلات عضوية متاحة.', noInvitations: 'لا توجد سجلات دعوات بعد.',
    ownerAccess: 'يمكنك دعوة الأعضاء وتغيير أدوارهم وإزالة صلاحياتهم.', memberAccess: 'يمكنك عرض صلاحيتك أو مغادرة هذا المنزل.',
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
  const isOwner = household.status === 'owner-ready';
  const pageHeader = <PageHeader
    title={household.status === 'member-ready' ? text.memberTitle : text.title}
    subtitle={<>{isOwner ? text.intro : text.memberIntro} <bdi>{props.spaceName}</bdi></>}
    actions={isOwner
      ? <button type="button" className="cr-button cr-button--primary" onClick={() => { household.clearActionState(); setInviteOpen(true); }}><UserPlus aria-hidden size={17} />{text.invite}</button>
      : null}
  />;

  if (household.status === 'loading') {
    return <section className="household-workspace workspace-page">{pageHeader}<HouseholdSkeleton locale={props.locale} label={`${text.loading}…`} /></section>;
  }
  if (household.status === 'error') {
    return <section className="household-workspace workspace-page">{pageHeader}<div className="state-panel"><ErrorNotice error={household.error} locale={props.locale} /><button type="button" onClick={() => void household.retry()}>{text.tryAgain}</button></div></section>;
  }

  const actionError = <ErrorNotice error={household.actionError} locale={props.locale} />;
  const pending = household.actionPending !== null;

  function memberIdentity(membership: HouseholdMembership): string | null {
    return membership.email ?? (membership.isSelf ? props.userEmail : null);
  }

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
  return <section className="household-workspace workspace-page">
    {pageHeader}
    {actionError}
    {household.status === 'owner-ready' ? <div className="household-columns hh-sections">
      <section className="household-register cr-card" aria-labelledby="household-members-heading">
        <div className="cr-section-header"><h2 id="household-members-heading">{text.members}</h2><span className="cr-helper" aria-label={`${text.members}: ${household.members.length}${household.membersHasMore ? '+' : ''}`}>({household.members.length}{household.membersHasMore ? '+' : ''})</span></div>
        {household.members.length === 0 ? <p className="empty">{text.noMembers}</p> : <ul className="household-list hh-list">{household.members.map((membership) => {
          const identity = memberIdentity(membership);
          return <li key={membership.userId} className="household-row hh-member-row">
          <div className="household-identity hh-identity"><span className="hh-avatar" aria-hidden="true">{(identity ?? text.member).slice(0, 1).toLocaleUpperCase(props.locale)}</span><span className="hh-identity-copy">{identity ? <bdi>{identity}</bdi> : <span className="household-member-fallback">{text.member} <bdi>{membership.userId.slice(0, 8)}</bdi></span>}{membership.isSelf ? <span className="household-self mg-self-pill">{text.self}</span> : null}</span></div>
          <dl className="mg-meta"><div><dt>{text.role}</dt><dd>{text[membership.role]}</dd></div><div><dt>{text.status}</dt><dd>{text[membership.status]}</dd></div>{membership.endedAt ? <div><dt>{text.ended}</dt><dd>{formatDate(membership.endedAt)}</dd></div> : null}</dl>
          {!membership.isSelf && membership.status === 'active' ? <div className="household-actions">
            <button type="button" className="cr-button" aria-label={props.locale === 'en' ? `${membership.role === 'member' ? 'Promote' : 'Demote'} ${membership.userId} to ${membership.role === 'member' ? 'owner' : 'member'}` : `${membership.role === 'member' ? text.promote : text.demote} ${membership.userId}`} onClick={() => setConfirmation({ kind: 'role', membership, role: membership.role === 'member' ? 'owner' : 'member' })}>{membership.role === 'member' ? text.shortPromote : text.shortDemote}</button>
            <button type="button" className="cr-button cr-button--danger" aria-label={props.locale === 'en' ? `Remove ${membership.userId}` : `${text.remove} ${membership.userId}`} onClick={() => setConfirmation({ kind: 'remove', membership })}>{text.shortRemove}</button>
          </div> : null}
        </li>;
        })}</ul>}
        {household.membersHasMore ? <button type="button" className="button-secondary" disabled={pending} onClick={() => void household.loadMoreMembers()}>{text.loadMore}</button> : null}
      </section>
      <section className="household-register cr-card" aria-labelledby="household-invitations-heading">
        <div className="cr-section-header"><h2 id="household-invitations-heading">{text.invitations}</h2><span className="cr-helper" aria-label={`${text.invitations}: ${household.invitations.length}${household.invitationsHasMore ? '+' : ''}`}>({household.invitations.length}{household.invitationsHasMore ? '+' : ''})</span></div>
        {household.invitations.length === 0 ? <p className="empty">{text.noInvitations}</p> : <ul className="household-list hh-list">{household.invitations.map((invitation) => <li key={invitation.invitationId} className="household-row invitation-row hh-invitation-row">
          <span className={`status household-status status-${invitation.effectiveStatus}`}>{text[invitation.effectiveStatus]}</span>
          <dl className="mg-meta"><div><dt>{text.created}</dt><dd>{formatDate(invitation.createdAt)}</dd></div><div><dt>{text.expires}</dt><dd>{formatDate(invitation.expiresAt)}</dd></div></dl>
          {invitation.effectiveStatus === 'pending' || invitation.effectiveStatus === 'expired' ? <button type="button" className="cr-button cr-button--danger" aria-label={`${text.cancelInvitation} ${invitation.invitationId}`} onClick={() => setConfirmation({ kind: 'cancel', invitation })}>{text.cancelInvitation}</button> : null}
        </li>)}</ul>}
        {household.invitationsHasMore ? <button type="button" className="button-secondary" disabled={pending} onClick={() => void household.loadMoreInvitations()}>{text.loadMore}</button> : null}
      </section>
    </div> : null}
    <section className="household-register household-self-access cr-card hh-access" aria-labelledby="household-access-heading">
      <div className="cr-section-header hh-access-heading"><Crown aria-hidden size={22} /><h2 id="household-access-heading">{household.status === 'owner-ready' ? text.access : text.selfDetails}</h2></div>
      <p className="cr-helper">{household.status === 'owner-ready' ? text.ownerAccess : text.memberAccess}</p>
      <dl className="mg-meta"><div><dt>{text.role}</dt><dd>{text[household.self?.role ?? 'member']}</dd></div><div><dt>{text.status}</dt><dd>{text[household.self?.status ?? 'active']}</dd></div></dl>
      <footer className="household-leave hh-leave"><button type="button" className="cr-button cr-button--danger" onClick={() => setConfirmation({ kind: 'leave' })}>{text.leave}</button></footer>
    </section>
    {inviteOpen ? <InviteHouseholdDialog locale={props.locale} pending={pending} succeeded={household.actionSuccess === 'invitation-created'} error={actionError} onClose={closeInvite} onSubmit={(email) => household.createInvitation(email, props.locale)} /> : null}
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
